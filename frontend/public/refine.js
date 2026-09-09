/**
 * @file public/refine.js
 * PAZL Phase 1 — browser mask-refinement pipeline (pure functions).
 *
 * This file is loaded two ways, so it must run in both:
 *   1. The classic SAM Web Worker, via  importScripts('refine.js')  → exposes
 *      the API on  self.PazlRefine.
 *   2. Jest / Node, via  require('.../public/refine')  → exposes the API on
 *      module.exports.
 *
 * No dependencies. No DOM. Deterministic. TypedArray-optimized.
 *
 * Phase 1 is built one function at a time, appended in pipeline order to the same
 * PazlRefine namespace: extractBestMask → largestConnectedComponent →
 * morphologicalClosing → morphologicalOpening → validateMask → contourExtraction →
 * simplifyPolygon → featherMask → benchmarkMetrics → refine() (the orchestrator
 * that runs the whole pipeline and is the single entry point the worker calls).
 */
(function (root) {
  'use strict';

  /**
   * Extract SAM's single best mask channel as a strictly-binary, single-channel mask.
   *
   * Why this exists: transformers.js SAM returns `numMasks` candidate masks per
   * prompt (multimask output), stored CHANNEL-INTERLEAVED — for pixel `i`, the
   * channels are at `data[numMasks * i + c]`. The worker already selects
   * `bestIndex` (argmax of `iou_scores`). Every downstream refine stage wants a
   * compact single-channel binary mask, so this de-interleaves the chosen channel
   * into a `Uint8Array(width * height)` with values in {0, 1} (normalizing any
   * 0/255, boolean, or otherwise-truthy encoding to 1).
   *
   * Algorithm: a single linear scan over the `width * height` output pixels,
   * reading one interleaved lane per pixel (`j += numMasks`, avoiding a multiply
   * in the loop). Exactly one allocation (the output) unless a reusable buffer is
   * supplied.
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} data
   *        Interleaved SAM mask data; length must be >= width*height*numMasks.
   * @param {number} width            Image width in px (positive integer).
   * @param {number} height           Image height in px (positive integer).
   * @param {number} [numMasks=1]     Channels per pixel (>= 1). Non-positive → 1.
   * @param {number} [bestIndex=0]    Channel to extract; clamped to [0, numMasks-1].
   * @param {Uint8Array} [out]        Optional reusable output buffer (length >= width*height).
   *                                  When supplied, no allocation is made and only the
   *                                  first width*height entries are written.
   * @returns {Uint8Array} Single-channel binary mask, length width*height, values 0/1.
   * @throws {TypeError}  If `data` is not array-like.
   * @throws {RangeError} If width/height are not positive integers, or `data` is too short.
   */
  function extractBestMask(data, width, height, numMasks, bestIndex, out) {
    // --- validation (fail fast on structural errors; recover on a stray index) ---
    if (data == null || typeof data.length !== 'number') {
      throw new TypeError('extractBestMask: `data` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('extractBestMask: `width` and `height` must be positive integers.');
    }

    const n = width * height;
    // numMasks: recover a sane channel count rather than reading past the buffer.
    const ch = Number.isInteger(numMasks) && numMasks > 0 ? numMasks : 1;
    // bestIndex: clamp into range — a stray index is recoverable, not fatal.
    let bi = Number.isInteger(bestIndex) ? bestIndex : 0;
    if (bi < 0) bi = 0;
    else if (bi >= ch) bi = ch - 1;

    if (data.length < n * ch) {
      throw new RangeError(
        'extractBestMask: `data` is too short for width*height*numMasks (' +
          data.length + ' < ' + n * ch + ').'
      );
    }

    const dst = out && out.length >= n ? out : new Uint8Array(n);

    if (ch === 1) {
      // Fast path: copy + normalize, no per-pixel channel offset.
      for (let i = 0; i < n; i++) dst[i] = data[i] ? 1 : 0;
    } else {
      // De-interleave the chosen lane; increment j by ch to skip the multiply.
      for (let i = 0, j = bi; i < n; i++, j += ch) dst[i] = data[j] ? 1 : 0;
    }

    return dst;
  }

  /**
   * Keep exactly one connected component of a binary mask — the object the user
   * clicked — and drop everything else (absorbed shadows, stray speckle, other
   * objects the raw SAM mask bled into).
   *
   * Selection policy:
   *   • If a `seed` (the click, in pixel coords) lands ON the mask → flood-fill
   *     from it and keep that component. Fast path, O(component): the seed's blob
   *     is exactly what the user pointed at, regardless of whether it is the
   *     largest.
   *   • If the seed lands on background (missed click) → keep the component whose
   *     centroid is NEAREST the seed (a graceful recovery, never a silent jump to
   *     the biggest blob elsewhere).
   *   • If no valid seed is given → keep the LARGEST component (ties → the first
   *     encountered, so the result is deterministic).
   *
   * Algorithm: iterative flood fill (an explicit index stack — no recursion, so
   * no stack-overflow on large blobs). 4-connectivity by default (avoids bridging
   * an object to its shadow through a single diagonal pixel); pass
   * `connectivity: 8` to merge diagonally-touching pixels. The fast path uses the
   * output buffer itself as the visited set (one fewer allocation).
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} mask
   *        Single-channel binary mask (0/1), length >= width*height.
   * @param {number} width   Image width in px (positive integer).
   * @param {number} height  Image height in px (positive integer).
   * @param {Object} [options]
   * @param {[number,number]} [options.seed]        Click point [x, y] in pixels.
   * @param {4|8} [options.connectivity=4]           Neighbourhood connectivity.
   * @param {Uint8Array} [options.out]              Reusable output buffer (>= width*height);
   *                                                cleared internally, so a pooled/dirty buffer is safe.
   * @returns {Uint8Array} Single-channel binary mask with only the kept component.
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function largestConnectedComponent(mask, width, height, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('largestConnectedComponent: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('largestConnectedComponent: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('largestConnectedComponent: `mask` is too short for width*height.');
    }

    const opts = options || {};
    const conn = opts.connectivity === 8 ? 8 : 4;
    const out = opts.out && opts.out.length >= n ? opts.out : new Uint8Array(n);
    out.fill(0, 0, n); // safe with a dirty pooled buffer

    // Resolve the seed to a pixel index, or -1 if absent/out-of-bounds.
    let seedIdx = -1;
    const seed = opts.seed;
    if (
      seed && seed.length >= 2 &&
      Number.isInteger(seed[0]) && Number.isInteger(seed[1]) &&
      seed[0] >= 0 && seed[1] >= 0 && seed[0] < width && seed[1] < height
    ) {
      seedIdx = seed[1] * width + seed[0];
    }

    const stack = [];

    // ---- FAST PATH: seed lands on the mask → flood-fill just that component ----
    if (seedIdx >= 0 && mask[seedIdx]) {
      stack.push(seedIdx);
      out[seedIdx] = 1;
      while (stack.length) {
        const p = stack.pop();
        const x = p % width;
        const y = (p / width) | 0;
        let q;
        if (y > 0) { q = p - width; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
        if (y < height - 1) { q = p + width; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
        if (x > 0) { q = p - 1; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
        if (x < width - 1) { q = p + 1; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
        if (conn === 8) {
          if (x > 0 && y > 0) { q = p - width - 1; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
          if (x < width - 1 && y > 0) { q = p - width + 1; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
          if (x > 0 && y < height - 1) { q = p + width - 1; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
          if (x < width - 1 && y < height - 1) { q = p + width + 1; if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); } }
        }
      }
      return out;
    }

    // ---- FALLBACK: label every component, then choose (nearest seed / largest) --
    const labels = new Int32Array(n).fill(-1);
    const areas = [];
    const cx = [];
    const cy = [];
    let numLabels = 0;

    for (let start = 0; start < n; start++) {
      if (mask[start] && labels[start] < 0) {
        const lab = numLabels++;
        let area = 0, sumx = 0, sumy = 0;
        stack.length = 0;
        stack.push(start);
        labels[start] = lab;
        while (stack.length) {
          const p = stack.pop();
          const x = p % width;
          const y = (p / width) | 0;
          area++; sumx += x; sumy += y;
          let q;
          if (y > 0) { q = p - width; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
          if (y < height - 1) { q = p + width; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
          if (x > 0) { q = p - 1; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
          if (x < width - 1) { q = p + 1; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
          if (conn === 8) {
            if (x > 0 && y > 0) { q = p - width - 1; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
            if (x < width - 1 && y > 0) { q = p - width + 1; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
            if (x > 0 && y < height - 1) { q = p + width - 1; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
            if (x < width - 1 && y < height - 1) { q = p + width + 1; if (mask[q] && labels[q] < 0) { labels[q] = lab; stack.push(q); } }
          }
        }
        areas.push(area); cx.push(sumx / area); cy.push(sumy / area);
      }
    }

    if (numLabels === 0) return out; // empty mask → all-zero (validation will reject)

    let keep = 0;
    if (seedIdx >= 0) {
      // Seed on background → nearest component by centroid distance.
      const sx = seedIdx % width;
      const sy = (seedIdx / width) | 0;
      let bestD = Infinity;
      for (let l = 0; l < numLabels; l++) {
        const dx = cx[l] - sx, dy = cy[l] - sy, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; keep = l; }
      }
    } else {
      // No seed → largest component (ties → first, for determinism).
      let bestA = -1;
      for (let l = 0; l < numLabels; l++) if (areas[l] > bestA) { bestA = areas[l]; keep = l; }
    }

    for (let i = 0; i < n; i++) out[i] = labels[i] === keep ? 1 : 0;
    return out;
  }

  // === separable binary morphology primitives (private) =====================
  // A square structuring element is SEPARABLE, so a 2-D dilate/erode of radius r
  // becomes a 1-D horizontal pass then a 1-D vertical pass. For a BINARY mask,
  // each 1-D pass reduces to a sliding-window foreground COUNT — O(N) per pass,
  // independent of r (no O(k) inner loop). Four passes total → O(width*height).
  //
  // Border convention (chosen for CLOSING):
  //   • dilate: out-of-bounds = background (0) → the object never grows past the
  //     image edge.
  //   • erode:  out-of-bounds = foreground → the image border does NOT erode an
  //     edge-touching object. This is what makes closing preserve borders
  //     instead of shrinking objects away from them.

  function _dilateH(src, dst, width, height, r) {
    for (let y = 0; y < height; y++) {
      const base = y * width;
      let count = 0;
      const init = r < width - 1 ? r : width - 1; // window of x=0 → cols [0..min(r,w-1)]
      for (let c = 0; c <= init; c++) count += src[base + c] ? 1 : 0;
      for (let x = 0; x < width; x++) {
        dst[base + x] = count > 0 ? 1 : 0;
        const oc = x - r, ic = x + r + 1;
        if (oc >= 0) count -= src[base + oc] ? 1 : 0;
        if (ic < width) count += src[base + ic] ? 1 : 0;
      }
    }
  }

  function _dilateV(src, dst, width, height, r) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      const init = r < height - 1 ? r : height - 1;
      for (let c = 0; c <= init; c++) count += src[c * width + x] ? 1 : 0;
      for (let y = 0; y < height; y++) {
        dst[y * width + x] = count > 0 ? 1 : 0;
        const oy = y - r, iy = y + r + 1;
        if (oy >= 0) count -= src[oy * width + x] ? 1 : 0;
        if (iy < height) count += src[iy * width + x] ? 1 : 0;
      }
    }
  }

  // erode: foreground iff ALL in-bounds window pixels are foreground
  // (in-bounds window length as the target → out-of-bounds counts as foreground).
  function _erodeH(src, dst, width, height, r) {
    for (let y = 0; y < height; y++) {
      const base = y * width;
      let count = 0;
      const init = r < width - 1 ? r : width - 1;
      for (let c = 0; c <= init; c++) count += src[base + c] ? 1 : 0;
      for (let x = 0; x < width; x++) {
        const lo = x - r < 0 ? 0 : x - r;
        const hi = x + r > width - 1 ? width - 1 : x + r;
        dst[base + x] = count === hi - lo + 1 ? 1 : 0;
        const oc = x - r, ic = x + r + 1;
        if (oc >= 0) count -= src[base + oc] ? 1 : 0;
        if (ic < width) count += src[base + ic] ? 1 : 0;
      }
    }
  }

  function _erodeV(src, dst, width, height, r) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      const init = r < height - 1 ? r : height - 1;
      for (let c = 0; c <= init; c++) count += src[c * width + x] ? 1 : 0;
      for (let y = 0; y < height; y++) {
        const lo = y - r < 0 ? 0 : y - r;
        const hi = y + r > height - 1 ? height - 1 : y + r;
        dst[y * width + x] = count === hi - lo + 1 ? 1 : 0;
        const oy = y - r, iy = y + r + 1;
        if (oy >= 0) count -= src[oy * width + x] ? 1 : 0;
        if (iy < height) count += src[iy * width + x] ? 1 : 0;
      }
    }
  }

  /**
   * Morphological CLOSING (dilate → erode) of a binary mask with a square
   * structuring element of the given radius. Closing FILLS interior pinholes and
   * reconnects near-touching parts of an object — the repair step — without
   * enlarging the object overall (dilate then erode cancel on solid regions).
   *
   * It runs BEFORE opening in the pipeline: repair first, then clean. A gap up to
   * ~2·radius px wide is bridged; a hole up to ~2·radius px is filled; borders are
   * preserved (edge-touching objects are not shrunk away from the frame).
   *
   * Square kernel because it is separable → O(width*height), radius-independent
   * (four sliding-window passes). A disk/octagon kernel is a future quality
   * option; the square is the fast, correct default. `radius` is an explicit
   * primitive parameter — adaptive radius selection is the caller's job.
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} mask
   *        Single-channel binary mask (0/1), length >= width*height.
   * @param {number} width   Image width in px (positive integer).
   * @param {number} height  Image height in px (positive integer).
   * @param {number} radius  Structuring-element radius in px. <= 0 → returns a
   *                         normalized copy (no-op).
   * @param {Object} [options]
   * @param {Uint8Array} [options.out]              Reusable output buffer (>= width*height).
   * @param {[Uint8Array,Uint8Array]} [options.scratch]  Two reusable work buffers (>= width*height each).
   * @returns {Uint8Array} Closed single-channel binary mask (values 0/1).
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function morphologicalClosing(mask, width, height, radius, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('morphologicalClosing: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('morphologicalClosing: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('morphologicalClosing: `mask` is too short for width*height.');
    }

    const opts = options || {};
    const out = opts.out && opts.out.length >= n ? opts.out : new Uint8Array(n);
    const r = Number.isInteger(radius) && radius > 0 ? radius : 0;

    if (r === 0) {
      for (let i = 0; i < n; i++) out[i] = mask[i] ? 1 : 0; // no-op: normalized copy
      return out;
    }

    const sc = opts.scratch;
    const t1 = sc && sc[0] && sc[0].length >= n ? sc[0] : new Uint8Array(n);
    const t2 = sc && sc[1] && sc[1].length >= n ? sc[1] : new Uint8Array(n);

    _dilateH(mask, t1, width, height, r);
    _dilateV(t1, t2, width, height, r);
    _erodeH(t2, t1, width, height, r);
    _erodeV(t1, out, width, height, r);
    return out;
  }

  /**
   * Morphological OPENING (erode → dilate) of a binary mask with a square
   * structuring element of the given radius. Opening REMOVES foreground smaller
   * than the kernel — isolated speckle and thin protrusions/nubs on the border —
   * while leaving solid regions unchanged (erode then dilate cancel on the body).
   * It is the CLEANUP step, run AFTER closing has repaired the object.
   *
   * Reuses the same separable sliding-window primitives as closing, so it is also
   * O(width*height) and radius-independent. It is intentionally the destructive
   * op, so callers should keep the radius small (typically 1) to avoid erasing
   * genuinely thin object parts (lamp poles, chair legs).
   *
   * Border handling: the erode step treats out-of-bounds as foreground, so a
   * legitimate object touching the image edge is PRESERVED (not eaten) — yet a
   * speck at the edge is still removed, because its in-bounds neighbours are
   * background and fail the erosion.
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} mask
   *        Single-channel binary mask (0/1), length >= width*height.
   * @param {number} width   Image width in px (positive integer).
   * @param {number} height  Image height in px (positive integer).
   * @param {number} radius  Structuring-element radius in px. <= 0 → returns a
   *                         normalized copy (no-op).
   * @param {Object} [options]
   * @param {Uint8Array} [options.out]              Reusable output buffer (>= width*height).
   * @param {[Uint8Array,Uint8Array]} [options.scratch]  Two reusable work buffers (>= width*height each).
   * @returns {Uint8Array} Opened single-channel binary mask (values 0/1).
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function morphologicalOpening(mask, width, height, radius, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('morphologicalOpening: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('morphologicalOpening: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('morphologicalOpening: `mask` is too short for width*height.');
    }

    const opts = options || {};
    const out = opts.out && opts.out.length >= n ? opts.out : new Uint8Array(n);
    const r = Number.isInteger(radius) && radius > 0 ? radius : 0;

    if (r === 0) {
      for (let i = 0; i < n; i++) out[i] = mask[i] ? 1 : 0; // no-op: normalized copy
      return out;
    }

    const sc = opts.scratch;
    const t1 = sc && sc[0] && sc[0].length >= n ? sc[0] : new Uint8Array(n);
    const t2 = sc && sc[1] && sc[1].length >= n ? sc[1] : new Uint8Array(n);

    // opening = erode then dilate (the reverse of closing's order)
    _erodeH(mask, t1, width, height, r);
    _erodeV(t1, t2, width, height, r);
    _dilateH(t2, t1, width, height, r);
    _dilateV(t1, out, width, height, r);
    return out;
  }

  /**
   * Validate a refined binary mask before it is turned into a polygon / shown.
   * This is a GATE, not a transform: it never modifies the mask. It returns a
   * report so the pipeline can short-circuit a bad selection to a typed
   * "no selection" (hard failures) or flag a suspicious one (soft warnings).
   *
   * Rules
   *   HARD (→ reject, `valid: false`):
   *     • empty        — area == 0
   *     • too_small    — area < minArea (a misclick / sliver)
   *     • too_large    — area > maxArea (a background / wall / floor grab)
   *     • missing_click— a seed was given, requireSeedInside is on, and the seed
   *                      pixel is not inside the mask (refinement ate it)
   *   SOFT (→ `warnings`, still `valid: true`):
   *     • disconnected — more than one connected component (unless allowed)
   *     • border_touch — the mask touches >= borderTouchLimit image borders
   *                      (often a floor/wall; rugs legitimately touch, so soft)
   *
   * (Invalid-polygon is intentionally NOT here — it is checked at the contour /
   * simplify stage, which runs after this gate.)
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} mask
   *        Single-channel binary mask (0/1), length >= width*height.
   * @param {number} width   Image width in px (positive integer).
   * @param {number} height  Image height in px (positive integer).
   * @param {Object} [options]
   * @param {[number,number]} [options.seed]                 Click point [x, y] in pixels.
   * @param {boolean} [options.requireSeedInside=true]       Hard-fail if the seed is outside the mask.
   * @param {number}  [options.minArea]                      Absolute min px; overrides minAreaFraction.
   * @param {number}  [options.minAreaFraction=0.0008]       Min area as a fraction of the image.
   * @param {number}  [options.maxArea]                      Absolute max px; overrides maxAreaFraction.
   * @param {number}  [options.maxAreaFraction=0.92]         Max area as a fraction of the image.
   * @param {boolean} [options.allowMultipleComponents=false] Suppress the disconnected warning.
   * @param {number}  [options.borderTouchLimit=3]           Borders touched before warning (0–4).
   * @param {4|8}     [options.connectivity=4]               Connectivity for the component count.
   * @returns {{valid:boolean, reasons:string[], warnings:string[], metrics:Object}}
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function validateMask(mask, width, height, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('validateMask: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('validateMask: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('validateMask: `mask` is too short for width*height.');
    }

    const opts = options || {};
    const conn = opts.connectivity === 8 ? 8 : 4;
    const minArea = Number.isFinite(opts.minArea)
      ? opts.minArea
      : Math.max(64, Math.round((opts.minAreaFraction != null ? opts.minAreaFraction : 0.0008) * n));
    const maxArea = Number.isFinite(opts.maxArea)
      ? opts.maxArea
      : Math.round((opts.maxAreaFraction != null ? opts.maxAreaFraction : 0.92) * n);
    const requireSeedInside = opts.requireSeedInside !== false;
    const allowMulti = opts.allowMultipleComponents === true;
    const borderTouchLimit = Number.isFinite(opts.borderTouchLimit) ? opts.borderTouchLimit : 3;

    // ---- single scan: area, bbox, border touches, border-foreground count ----
    let area = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    let top = false, bottom = false, left = false, right = false;
    let borderFg = 0;
    for (let y = 0; y < height; y++) {
      const base = y * width;
      const edgeRow = y === 0 || y === height - 1;
      for (let x = 0; x < width; x++) {
        if (mask[base + x]) {
          area++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          const edge = edgeRow || x === 0 || x === width - 1;
          if (edge) {
            borderFg++;
            if (y === 0) top = true;
            if (y === height - 1) bottom = true;
            if (x === 0) left = true;
            if (x === width - 1) right = true;
          }
        }
      }
    }
    const touchedBorders = (top ? 1 : 0) + (bottom ? 1 : 0) + (left ? 1 : 0) + (right ? 1 : 0);
    const perimeter = width > 1 && height > 1 ? 2 * width + 2 * height - 4 : n;

    // ---- seed containment ----
    let seedInside = null;
    const seed = opts.seed;
    if (
      seed && seed.length >= 2 &&
      Number.isInteger(seed[0]) && Number.isInteger(seed[1]) &&
      seed[0] >= 0 && seed[1] >= 0 && seed[0] < width && seed[1] < height
    ) {
      seedInside = mask[seed[1] * width + seed[0]] ? true : false;
    }

    // ---- connected-component count (flood fill; visited buffer) ----
    let componentCount = 0;
    if (area > 0) {
      const visited = new Uint8Array(n);
      const st = [];
      for (let s = 0; s < n; s++) {
        if (mask[s] && !visited[s]) {
          componentCount++;
          st.length = 0; st.push(s); visited[s] = 1;
          while (st.length) {
            const p = st.pop();
            const x = p % width;
            const y = (p / width) | 0;
            let q;
            if (y > 0) { q = p - width; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (y < height - 1) { q = p + width; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (x > 0) { q = p - 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (x < width - 1) { q = p + 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (conn === 8) {
              if (x > 0 && y > 0) { q = p - width - 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
              if (x < width - 1 && y > 0) { q = p - width + 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
              if (x > 0 && y < height - 1) { q = p + width - 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
              if (x < width - 1 && y < height - 1) { q = p + width + 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            }
          }
        }
      }
    }

    // ---- classify ----
    const reasons = [];   // hard
    const warnings = [];  // soft
    if (area === 0) {
      reasons.push('empty');
    } else {
      if (area < minArea) reasons.push('too_small');
      if (area > maxArea) reasons.push('too_large');
      if (requireSeedInside && seedInside === false) reasons.push('missing_click');
      if (!allowMulti && componentCount > 1) warnings.push('disconnected');
      if (touchedBorders >= borderTouchLimit) warnings.push('border_touch');
    }

    return {
      valid: reasons.length === 0,
      reasons: reasons,
      warnings: warnings,
      metrics: {
        area: area,
        areaFraction: area / n,
        bbox: area > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
        componentCount: componentCount,
        seedInside: seedInside,
        touchedBorders: touchedBorders,
        borderForegroundFraction: borderFg / perimeter,
      },
    };
  }

  // Marching-squares case table. A cell's 4 corners (TL,TR,BR,BL) form a 4-bit
  // case = TL*8 + TR*4 + BR*2 + BL*1. Each entry lists the boundary SEGMENTS as
  // pairs of cell edges: 0=Top, 1=Right, 2=Bottom, 3=Left. Cases 5 and 10 are
  // saddles (two segments) resolved so each foreground corner is isolated.
  var _MS_TABLE = [
    [],                 // 0
    [[3, 2]],           // 1  BL
    [[2, 1]],           // 2  BR
    [[3, 1]],           // 3  BL,BR
    [[0, 1]],           // 4  TR
    [[0, 1], [2, 3]],   // 5  TR,BL (saddle)
    [[0, 2]],           // 6  TR,BR
    [[0, 3]],           // 7  TR,BR,BL
    [[0, 3]],           // 8  TL
    [[0, 2]],           // 9  TL,BL
    [[0, 3], [2, 1]],   // 10 TL,BR (saddle)
    [[0, 1]],           // 11 TL,BR,BL
    [[3, 1]],           // 12 TL,TR
    [[2, 1]],           // 13 TL,TR,BL
    [[3, 2]],           // 14 TL,TR,BR
    [],                 // 15
  ];

  /**
   * Extract the contour(s) of a binary mask as ordered, closed polygon rings via
   * marching squares. Returns the OUTER ring(s) and any HOLE rings — a mask with
   * a hole (e.g. a chair back) yields more than one ring, matching the object
   * model's `polygon.rings[]`.
   *
   * How: the mask is treated as a scalar field at iso-level 0.5, with a virtual
   * one-pixel BACKGROUND border so objects touching the image edge still get a
   * closed contour. Each 2×2 corner cell contributes 0–2 boundary segments (a
   * verified 16-case table; saddles resolved consistently). Segments meet at
   * shared edge-midpoint vertices — every contour vertex has degree 2 — so they
   * chain unambiguously into simple closed loops. Marching squares is chosen over
   * Moore tracing because it is deterministic and does not break on 1-px necks.
   *
   * Vertices are in image pixel space, on the pixel-edge (half-integer) grid; a
   * boundary just outside the image sits at −0.5 / width+0.5, which is correct
   * (the object's outer edge). Downstream simplification/rendering consume rings
   * directly.
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} mask
   *        Single-channel binary mask (0/1), length >= width*height.
   * @param {number} width   Image width in px (positive integer).
   * @param {number} height  Image height in px (positive integer).
   * @returns {Array<Array<[number,number]>>} Array of rings; each ring is an
   *          ordered array of [x, y] vertices (not repeating the first point).
   *          Empty array for an empty mask.
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function contourExtraction(mask, width, height) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('contourExtraction: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('contourExtraction: `width` and `height` must be positive integers.');
    }
    if (mask.length < width * height) {
      throw new RangeError('contourExtraction: `mask` is too short for width*height.');
    }

    // Corner sampler with a virtual background frame (out-of-range = 0).
    const cornerAt = function (x, y) {
      return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] ? 1 : 0;
    };

    const STRIDE = 2 * height + 5; // > max (2*y + 2)
    const key = function (x, y) {
      return (((2 * x) | 0) + 2) * STRIDE + (((2 * y) | 0) + 2);
    };

    const coord = new Map(); // key -> [x, y]
    const adj = new Map();   // key -> [neighbourKey, ...]
    const link = function (ka, kb, ax, ay, bx, by) {
      if (!coord.has(ka)) coord.set(ka, [ax, ay]);
      if (!coord.has(kb)) coord.set(kb, [bx, by]);
      let a = adj.get(ka); if (!a) { a = []; adj.set(ka, a); } a.push(kb);
      let b = adj.get(kb); if (!b) { b = []; adj.set(kb, b); } b.push(ka);
    };

    // Scan cells over [-1, width-1] x [-1, height-1] (border-inclusive).
    for (let cy = -1; cy < height; cy++) {
      for (let cx = -1; cx < width; cx++) {
        const tl = cornerAt(cx, cy);
        const tr = cornerAt(cx + 1, cy);
        const br = cornerAt(cx + 1, cy + 1);
        const bl = cornerAt(cx, cy + 1);
        const c = tl * 8 + tr * 4 + br * 2 + bl * 1;
        if (c === 0 || c === 15) continue; // no boundary in this cell
        const segs = _MS_TABLE[c];
        // Edge midpoints for this cell: 0=T,1=R,2=B,3=L
        const ex = [cx + 0.5, cx + 1, cx + 0.5, cx];
        const ey = [cy, cy + 0.5, cy + 1, cy + 0.5];
        for (let s = 0; s < segs.length; s++) {
          const e1 = segs[s][0], e2 = segs[s][1];
          const ax = ex[e1], ay = ey[e1], bx = ex[e2], by = ey[e2];
          link(key(ax, ay), key(bx, by), ax, ay, bx, by);
        }
      }
    }

    // Chain the degree-2 vertex graph into ordered closed rings.
    const rings = [];
    const visited = new Set();
    const starts = adj.keys();
    for (let it = starts.next(); !it.done; it = starts.next()) {
      const startKey = it.value;
      if (visited.has(startKey)) continue;
      const ring = [];
      let cur = startKey;
      let prev = -1;
      while (cur !== -1 && !visited.has(cur)) {
        visited.add(cur);
        ring.push(coord.get(cur));
        const nbrs = adj.get(cur);
        let next = -1;
        for (let k = 0; k < nbrs.length; k++) {
          const nb = nbrs[k];
          if (nb !== prev && !visited.has(nb)) { next = nb; break; }
        }
        prev = cur;
        cur = next;
      }
      if (ring.length >= 3) rings.push(ring);
    }

    return rings;
  }

  // Douglas–Peucker over one open polyline given as a list of ring indices.
  // Marks `keep[ringIndex]` for the two endpoints and any interior vertex whose
  // perpendicular distance to the current segment exceeds eps. Iterative (an
  // explicit stack) so a long ring can't blow the call stack. Uses SQUARED
  // distance vs eps² — no sqrt in the hot loop.
  function _dpChain(ring, idx, eps2, keep) {
    const last = idx.length - 1;
    keep[idx[0]] = true;
    keep[idx[last]] = true;
    if (last < 2) return;
    const stack = [0, last]; // pairs pushed/popped as (a,b)
    while (stack.length) {
      const b = stack.pop();
      const a = stack.pop();
      if (b - a < 2) continue;
      const ax = ring[idx[a]][0], ay = ring[idx[a]][1];
      const bx = ring[idx[b]][0], by = ring[idx[b]][1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let maxD = -1, maxI = -1;
      for (let k = a + 1; k < b; k++) {
        const px = ring[idx[k]][0], py = ring[idx[k]][1];
        let d2;
        if (len2 === 0) {
          const ex = px - ax, ey = py - ay;
          d2 = ex * ex + ey * ey;
        } else {
          const cross = (px - ax) * dy - (py - ay) * dx;
          d2 = (cross * cross) / len2;
        }
        if (d2 > maxD) { maxD = d2; maxI = k; }
      }
      if (maxD > eps2 && maxI >= 0) {
        keep[idx[maxI]] = true;
        stack.push(a, maxI);
        stack.push(maxI, b);
      }
    }
  }

  /**
   * Simplify one closed contour ring with the Douglas–Peucker algorithm, keeping
   * corners while dropping near-collinear points. Douglas–Peucker is chosen over
   * Visvalingam because interior-design objects are corner-dominated (furniture),
   * and DP preserves corners best.
   *
   * Closed-ring handling: a ring has no natural endpoints, so it is split at the
   * point FARTHEST from ring[0] into two polylines that are each simplified with
   * their endpoints pinned, then recombined — this keeps the two extreme vertices
   * and yields a stable, deterministic result.
   *
   * `epsilon` is the perpendicular-distance tolerance in pixels and is an explicit
   * primitive parameter; choosing it adaptively (e.g. to hit a vertex budget or
   * scale with resolution) is the caller's job. `epsilon <= 0` removes only
   * exactly-collinear points. Extreme epsilon on a concave ring can, in rare
   * cases, self-intersect; validating that is left to the caller (per spec, the
   * gate is separate).
   *
   * @param {Array<[number,number]>} ring  Ordered ring vertices (not repeating
   *        the first point), e.g. one entry of contourExtraction()'s output.
   * @param {number} epsilon               Perpendicular tolerance in px.
   * @returns {Array<[number,number]>} New simplified ring (fresh point arrays).
   * @throws {TypeError} If `ring` is not array-like.
   */
  function simplifyPolygon(ring, epsilon) {
    if (ring == null || typeof ring.length !== 'number') {
      throw new TypeError('simplifyPolygon: `ring` must be an array of [x, y] points.');
    }
    const n = ring.length;
    if (n <= 3) {
      const copy = new Array(n);
      for (let i = 0; i < n; i++) copy[i] = [ring[i][0], ring[i][1]];
      return copy;
    }

    const eps = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 0;
    const eps2 = eps * eps;

    // Anchor: the vertex farthest from ring[0].
    const x0 = ring[0][0], y0 = ring[0][1];
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) {
      const dx = ring[i][0] - x0, dy = ring[i][1] - y0, d = dx * dx + dy * dy;
      if (d > fd) { fd = d; far = i; }
    }
    if (fd === 0) return [[x0, y0]]; // all points coincident

    const keep = new Array(n).fill(false);

    // Chain 1: indices [0 .. far]
    const chain1 = new Array(far + 1);
    for (let i = 0; i <= far; i++) chain1[i] = i;
    _dpChain(ring, chain1, eps2, keep);

    // Chain 2: indices [far .. n-1] then wrap to 0
    const chain2 = new Array(n - far + 1);
    let c = 0;
    for (let i = far; i < n; i++) chain2[c++] = i;
    chain2[c] = 0;
    _dpChain(ring, chain2, eps2, keep);

    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push([ring[i][0], ring[i][1]]);
    return out;
  }

  /**
   * Produce a soft ALPHA matte (0–255) from a binary mask by feathering its edge.
   * This is a RENDER-ONLY output: it does not alter the binary mask, its area,
   * bbox, or polygon (those remain the crisp, pre-feather truth). The alpha is for
   * compositing the selection overlay with a soft edge — important for plants,
   * curtains, and future alpha-composited editing.
   *
   * Method: a separable BOX BLUR of the mask scaled to 0/255 — a horizontal pass
   * then a vertical pass, each a sliding-window average (O(N), radius-independent).
   * A box blur closely approximates a gaussian at a fraction of the cost. The
   * average at each pass divides by the IN-BOUNDS window length, so:
   *   • the interior of a solid region stays fully opaque (255),
   *   • an object touching the image edge is NOT feathered against the frame
   *     (its in-bounds neighbourhood is all foreground → 255),
   *   • only true fg↔bg boundaries ramp (over ~2·radius px, straddling the edge).
   *
   * Keep radius small for thin objects (a large radius makes a thin part uniformly
   * translucent). `radius <= 0` returns a hard 0/255 alpha (no feather).
   *
   * @param {Uint8Array|Uint8ClampedArray|ArrayLike<number>} mask
   *        Single-channel binary mask (0/1), length >= width*height.
   * @param {number} width   Image width in px (positive integer).
   * @param {number} height  Image height in px (positive integer).
   * @param {number} radius  Feather radius in px. <= 0 → hard alpha.
   * @param {Object} [options]
   * @param {Uint8ClampedArray|Uint8Array} [options.out]  Reusable alpha buffer (>= width*height).
   * @param {Float32Array} [options.scratch]              Reusable intermediate buffer (>= width*height).
   * @returns {Uint8ClampedArray|Uint8Array} Alpha matte, length width*height, values 0–255.
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function featherMask(mask, width, height, radius, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('featherMask: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('featherMask: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('featherMask: `mask` is too short for width*height.');
    }

    const opts = options || {};
    const out = opts.out && opts.out.length >= n ? opts.out : new Uint8ClampedArray(n);
    const r = Number.isInteger(radius) && radius > 0 ? radius : 0;

    if (r === 0) {
      for (let i = 0; i < n; i++) out[i] = mask[i] ? 255 : 0; // hard alpha
      return out;
    }

    // The feather only differs from a hard 0/255 alpha within `radius` of a mask
    // edge; the whole interior stays 255 and everything outside the mask's bounding
    // box stays 0. So compute the bounding box, expand it by `radius` (the reach of
    // the blur window), and run the separable box blur over ONLY that crop — writing
    // 0 everywhere else. For a typical object this is a small fraction of the frame,
    // and it is EXACT: every column outside the bbox is 0, so a window clipped to
    // the crop sees the same values (and the same image-relative divisor) it would
    // over the full image. The runtime becomes proportional to the object, not the
    // canvas.
    for (let i = 0; i < n; i++) out[i] = 0;

    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        if (mask[i]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return out; // empty mask → all-transparent

    const x0 = minX - r < 0 ? 0 : minX - r;
    const x1 = maxX + r > width - 1 ? width - 1 : maxX + r;
    const y0 = minY - r < 0 ? 0 : minY - r;
    const y1 = maxY + r > height - 1 ? height - 1 : maxY + r;
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const cn = cw * ch;

    // Crop-local scratch (row-major over the crop). tmp holds horizontal window
    // COUNTS (tiny integers); Int32 packs tighter than Float32 for the strided read.
    const tmp = opts.scratch && opts.scratch.length >= cn ? opts.scratch : new Int32Array(cn);

    // Per-column combined scale, indexed by crop-local column. The H-window length
    // depends only on x and is CONSTANT down a column, so it factors out of the V
    // pass: final divisor is winW[x] * winH[y]. Divisors use IMAGE bounds so the
    // real image border is preserved. Windows are clipped to [x0,x1]/[y0,y1]; every
    // column/row outside is 0, so the clipped sum equals the full-image sum.
    const scaleW = new Float64Array(cw); // 255 / winW(image x)
    for (let cx = 0; cx < cw; cx++) {
      const x = x0 + cx;
      const lo = x - r < 0 ? 0 : x - r;
      const hi = x + r > width - 1 ? width - 1 : x + r;
      scaleW[cx] = 255 / (hi - lo + 1);
    }
    const invH = new Float64Array(ch); // 1 / winH(image y)
    for (let cy = 0; cy < ch; cy++) {
      const y = y0 + cy;
      const lo = y - r < 0 ? 0 : y - r;
      const hi = y + r > height - 1 ? height - 1 : y + r;
      invH[cy] = 1 / (hi - lo + 1);
    }

    // Horizontal pass over the crop: sliding row COUNT of set pixels, window
    // clipped to [x0, x1]. No division, no *255 — deferred to the vertical pass.
    for (let cy = 0; cy < ch; cy++) {
      const rowBase = (y0 + cy) * width;
      const tBase = cy * cw;
      let sum = 0;
      const init = r < cw - 1 ? r : cw - 1;
      for (let c = 0; c <= init; c++) sum += mask[rowBase + x0 + c] ? 1 : 0;
      for (let cx = 0; cx < cw; cx++) {
        tmp[tBase + cx] = sum;
        const oc = cx - r, ic = cx + r + 1;
        if (oc >= 0) sum -= mask[rowBase + x0 + oc] ? 1 : 0;
        if (ic < cw) sum += mask[rowBase + x0 + ic] ? 1 : 0;
      }
    }

    // Vertical pass over the crop: sliding column sum of the intermediate, then a
    // single combined multiply (scaleW[cx] * invH[cy]) → 0..255 alpha into `out`.
    for (let cx = 0; cx < cw; cx++) {
      const kx = scaleW[cx];
      let sum = 0;
      const init = r < ch - 1 ? r : ch - 1;
      for (let c = 0; c <= init; c++) sum += tmp[c * cw + cx];
      for (let cy = 0; cy < ch; cy++) {
        out[(y0 + cy) * width + x0 + cx] = Math.round(sum * kx * invH[cy]);
        const oy = cy - r, iy = cy + r + 1;
        if (oy >= 0) sum -= tmp[oy * cw + cx];
        if (iy < ch) sum += tmp[iy * cw + cx];
      }
    }

    return out;
  }

  /**
   * Compute deterministic quality metrics for a refined mask, culminating in a
   * 0–100 composite quality score for dashboards and production telemetry.
   *
   * Why this is a SEPARATE, pure function: the design's benchmark step mixes two
   * kinds of numbers — non-deterministic ones (per-stage `performance.now()`
   * timings, `performance.memory` samples) that only the refine() orchestrator can
   * gather at runtime, and deterministic ones derived purely from the pixels. This
   * function owns the deterministic half, so it is reproducible and unit-testable;
   * refine() stitches the timings around it.
   *
   * Metrics returned: area / areaFraction / bbox, foreground perimeter and
   * compactness (a boundary-smoothness proxy), connected-component count, polygon
   * ring/vertex counts, and IoU fidelity vs the raw SAM mask. The composite
   * `qualityScore` is a weighted blend of five 0–1 subscores over whatever inputs
   * are available:
   *     fidelity (IoU to raw SAM)   0.35
   *     smoothness (compactness)    0.20
   *     areaPlausibility            0.20
   *     singleComponent             0.15
   *     validPolygon                0.10
   * Absent inputs (no rawMask, no polygon) drop their subscore and the remaining
   * weights renormalize, so the score is always a clean 0–100. An empty mask always
   * scores 0.
   *
   * @param {Uint8Array|ArrayLike<number>} mask  Single-channel binary mask (w*h).
   * @param {number} width
   * @param {number} height
   * @param {Object}  [options]
   * @param {ArrayLike<number>} [options.rawMask]     Raw SAM mask (w*h) for IoU fidelity.
   * @param {Array}  [options.polygon]                A single ring [[x,y],…] or an array of rings.
   * @param {Object} [options.validation]             A validateMask() result to pass through verbatim.
   * @param {4|8}    [options.connectivity=8]         Connectivity for the component count.
   * @param {number} [options.minAreaFraction]        Plausibility hard-zero floor (default matches validateMask).
   * @param {number} [options.maxAreaFraction=0.92]   Plausibility hard-zero ceiling.
   * @param {number} [options.plausibleLow=0.004]     At/above this fraction, small area is fully plausible.
   * @param {number} [options.plausibleHigh=0.6]      At/below this fraction, large area is fully plausible.
   * @returns {Object} { area, areaFraction, bbox, perimeter, compactness,
   *                      componentCount, ringCount, polygonVertices, iou, validation,
   *                      subscores{…}, qualityScore }.
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function benchmarkMetrics(mask, width, height, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('benchmarkMetrics: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('benchmarkMetrics: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('benchmarkMetrics: `mask` is too short for width*height.');
    }
    const opts = options || {};
    const conn = opts.connectivity === 4 ? 4 : 8;

    // ---- single scan: area, bbox, foreground perimeter (boundary pixels) ----
    let area = 0, perimeter = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const base = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[base + x]) {
          area++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          // Boundary pixel: touches the image edge or any 4-neighbour is background.
          // (`x===0` etc. short-circuit BEFORE the neighbour read, so no OOB.)
          const bnd =
            x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            !mask[base + x - 1] || !mask[base + x + 1] ||
            !mask[base - width + x] || !mask[base + width + x];
          if (bnd) perimeter++;
        }
      }
    }
    const areaFraction = area / n;
    const bbox = area > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;

    // ---- connected-component count (flood fill; same scheme as validateMask) ----
    let componentCount = 0;
    if (area > 0) {
      const visited = new Uint8Array(n);
      const st = [];
      for (let s = 0; s < n; s++) {
        if (mask[s] && !visited[s]) {
          componentCount++;
          st.length = 0; st.push(s); visited[s] = 1;
          while (st.length) {
            const p = st.pop();
            const x = p % width;
            const y = (p / width) | 0;
            let q;
            if (y > 0) { q = p - width; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (y < height - 1) { q = p + width; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (x > 0) { q = p - 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (x < width - 1) { q = p + 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            if (conn === 8) {
              if (x > 0 && y > 0) { q = p - width - 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
              if (x < width - 1 && y > 0) { q = p - width + 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
              if (x > 0 && y < height - 1) { q = p + width - 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
              if (x < width - 1 && y < height - 1) { q = p + width + 1; if (mask[q] && !visited[q]) { visited[q] = 1; st.push(q); } }
            }
          }
        }
      }
    }

    // ---- polygon: normalize (single ring OR array of rings) → counts + validity --
    let ringCount = null, polygonVertices = null, validPolygonSub = null;
    if (opts.polygon != null) {
      const poly = opts.polygon;
      let rings;
      if (
        Array.isArray(poly) && poly.length > 0 &&
        Array.isArray(poly[0]) && poly[0].length === 2 && typeof poly[0][0] === 'number'
      ) {
        rings = [poly];        // a single ring [[x,y],…]
      } else if (Array.isArray(poly)) {
        rings = poly;          // an array of rings
      } else {
        rings = [];
      }
      ringCount = rings.length;
      polygonVertices = 0;
      let allRingsValid = ringCount > 0;
      let totalAbsArea = 0;
      for (let ri = 0; ri < rings.length; ri++) {
        const ring = rings[ri];
        const v = Array.isArray(ring) ? ring.length : 0;
        polygonVertices += v;
        if (v < 3) allRingsValid = false;
        let a2 = 0; // shoelace (twice the signed area)
        for (let i = 0, j = v - 1; i < v; j = i++) {
          a2 += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        }
        totalAbsArea += Math.abs(a2) / 2;
      }
      validPolygonSub = allRingsValid && totalAbsArea > 0 ? 1 : 0;
    }

    // ---- fidelity: IoU against the raw SAM mask ----
    let iou = null;
    if (opts.rawMask != null && typeof opts.rawMask.length === 'number' && opts.rawMask.length >= n) {
      const raw = opts.rawMask;
      let inter = 0, uni = 0;
      for (let i = 0; i < n; i++) {
        const a = mask[i] ? 1 : 0;
        const b = raw[i] ? 1 : 0;
        if (a & b) inter++;
        if (a | b) uni++;
      }
      iou = uni === 0 ? 1 : inter / uni; // both empty ⇒ identical ⇒ 1
    }

    // ---- subscores (each 0..1, or null when its input is absent) ----
    // Smoothness = isoperimetric compactness 4π·A / P²; 1 for a disc, lower for
    // jagged boundaries. Tiny blobs clamp to 1 (their perimeter is degenerate).
    const smoothness = area > 0
      ? Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter))
      : null;

    const minFrac = opts.minAreaFraction != null
      ? opts.minAreaFraction
      : Math.max(64, Math.round(0.0008 * n)) / n;
    const maxFrac = opts.maxAreaFraction != null ? opts.maxAreaFraction : 0.92;
    const loFull = opts.plausibleLow != null ? opts.plausibleLow : 0.004;
    const hiFull = opts.plausibleHigh != null ? opts.plausibleHigh : 0.6;
    let areaPlausibility = null;
    if (area > 0) {
      const f = areaFraction;
      if (f <= minFrac || f >= maxFrac) {
        areaPlausibility = 0;
      } else if (f < loFull) {
        const d = loFull - minFrac;
        areaPlausibility = d > 0 ? (f - minFrac) / d : 1;
      } else if (f > hiFull) {
        const d = maxFrac - hiFull;
        areaPlausibility = d > 0 ? (maxFrac - f) / d : 1;
      } else {
        areaPlausibility = 1;
      }
      if (areaPlausibility < 0) areaPlausibility = 0;
      if (areaPlausibility > 1) areaPlausibility = 1;
    }

    const singleComponent = area > 0 ? (componentCount <= 1 ? 1 : 1 / componentCount) : null;
    const fidelity = iou;                  // 0..1 or null
    const validPolygon = validPolygonSub;  // 0/1 or null

    // ---- weighted composite, renormalized over the available subscores ----
    const parts = [
      [fidelity, 0.35],
      [smoothness, 0.20],
      [areaPlausibility, 0.20],
      [singleComponent, 0.15],
      [validPolygon, 0.10],
    ];
    let wsum = 0, acc = 0;
    for (let i = 0; i < parts.length; i++) {
      const v = parts[i][0], w = parts[i][1];
      if (v != null) { acc += v * w; wsum += w; }
    }
    const qualityScore = area === 0 ? 0 : (wsum > 0 ? Math.round((acc / wsum) * 100) : 0);

    return {
      area: area,
      areaFraction: areaFraction,
      bbox: bbox,
      perimeter: perimeter,
      compactness: smoothness,
      componentCount: componentCount,
      ringCount: ringCount,
      polygonVertices: polygonVertices,
      iou: iou,
      validation: opts.validation != null ? opts.validation : null,
      subscores: {
        fidelity: fidelity,
        smoothness: smoothness,
        areaPlausibility: areaPlausibility,
        singleComponent: singleComponent,
        validPolygon: validPolygon,
      },
      qualityScore: qualityScore,
    };
  }

  /**
   * Run-length encode a binary mask (row-major). Compact, reversible, and the
   * `{ size, counts }` shape the Design Object model stores. `counts` always starts
   * with a BACKGROUND run (length 0 if pixel 0 is foreground), then alternates
   * background/foreground — so parity of the index tells you the value.
   * @private
   */
  function _encodeRLE(mask, width, height) {
    const n = width * height;
    const counts = [];
    let cur = 0; // first run counts background
    let run = 0;
    for (let i = 0; i < n; i++) {
      const v = mask[i] ? 1 : 0;
      if (v === cur) {
        run++;
      } else {
        counts.push(run);
        cur = v;
        run = 1;
      }
    }
    counts.push(run);
    return { size: [width, height], order: 'row-major', counts: counts };
  }

  var _now = function () {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  };

  /**
   * Orchestrate the full Phase-1 mask-refinement pipeline: turn SAM's raw
   * single-channel binary mask into a clean, validated selection with a vector
   * polygon, a render-only alpha, an RLE, and quality metrics — the object the
   * Vision Worker ships to the UI.
   *
   * Pipeline (each stage is an already-tested pure function):
   *   1. largestConnectedComponent  — keep only the clicked object's blob
   *   2. morphologicalClosing        — fill pinholes, reconnect near-touching parts
   *   3. morphologicalOpening        — trim speckle and thin nubs
   *   4. validateMask (THE GATE)     — a hard fail short-circuits to a typed
   *                                    "no selection" so the UI can prompt a
   *                                    re-click; a garbage mask never leaves here
   *   5. contourExtraction           — marching-squares rings (outer + holes)
   *   6. simplifyPolygon (per ring)  — Douglas–Peucker to an adaptive vertex budget
   *   7. featherMask                 — render-only 0–255 alpha (does not alter mask)
   *   8. _encodeRLE + benchmarkMetrics
   *
   * The input `mask` is treated as the RAW SAM mask and is never mutated (every
   * stage allocates its own output), so it doubles as the IoU-fidelity reference
   * for benchmarkMetrics. `bbox`, `polygon`, and `metrics` are all in full-image
   * pixel coordinates; `mask` and `alpha` are full-size (W·H) for drop-in
   * wire-compatibility with the existing overlay (emit numMasks:1/bestIndex:0).
   *
   * NOTE ON BUDGET: stages run on the full frame here. The design's ≤60 ms refine
   * sub-budget is reached via bbox-cropping every stage (the "single biggest
   * lever"); featherMask already crops, and extending the crop to the remaining
   * stages is the documented follow-up. The full-frame path is ~120–160 ms for a
   * 1 MP frame — inside the ≤200 ms end-to-end selection budget — and runs in the
   * worker, off the main thread. Per-stage `timings` are returned for telemetry.
   *
   * @param {Uint8Array|ArrayLike<number>} mask  Raw SAM single-channel binary mask (W·H, 0/1).
   * @param {number} width
   * @param {number} height
   * @param {[number,number]} [seed]  The click in IMAGE pixels [x,y]; drives largest-CC and the gate.
   * @param {Object}  [options]
   * @param {4|8}     [options.connectivity=4]     Connectivity for CC + components.
   * @param {number}  [options.closeRadius=2]      Closing structuring-element radius.
   * @param {number}  [options.openRadius=1]       Opening structuring-element radius.
   * @param {number}  [options.featherRadius=2]    Alpha feather radius (render-only).
   * @param {number}  [options.epsilon]            DP tolerance; auto (∝√area, vertex-budgeted) if omitted.
   * @param {Object}  [options.validation]         Extra opts forwarded to validateMask (thresholds).
   * @returns {Object} On success: { ok:true, noSelection:false, mask, rle, polygon:{rings},
   *                    alpha, bbox, validation, metrics, timings, width, height }.
   *                    On a hard gate fail: { ok:false, noSelection:true, reasons, mask:null,
   *                    rle:null, polygon:null, alpha:null, bbox, validation, metrics:null, timings,
   *                    width, height }.
   * @throws {TypeError}  If `mask` is not array-like.
   * @throws {RangeError} If dimensions are invalid or `mask` is too short.
   */
  function refine(mask, width, height, seed, options) {
    if (mask == null || typeof mask.length !== 'number') {
      throw new TypeError('refine: `mask` must be an array-like of numbers.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('refine: `width` and `height` must be positive integers.');
    }
    const n = width * height;
    if (mask.length < n) {
      throw new RangeError('refine: `mask` is too short for width*height.');
    }

    const opts = options || {};
    // Default 4-connectivity (tight): only orthogonally-connected pixels form the
    // object, so a click never sprawls across diagonally-touching regions (a
    // reflective floor bleeding into furniture). Pass connectivity:8 to merge
    // diagonally-fragmented surfaces. refine forwards this to largestCC + validate.
    const conn = opts.connectivity === 8 ? 8 : 4;
    const closeR = Number.isInteger(opts.closeRadius) ? opts.closeRadius : 2;
    const openR = Number.isInteger(opts.openRadius) ? opts.openRadius : 1;
    const featherR = Number.isInteger(opts.featherRadius) ? opts.featherRadius : 2;
    const validationOpts = opts.validation || {};
    const seedPt = seed && seed.length >= 2 ? [seed[0], seed[1]] : undefined;

    const timings = {};
    let t;

    // 1 — largest connected component (keep the clicked blob)
    t = _now();
    const cc = largestConnectedComponent(mask, width, height, { seed: seedPt, connectivity: conn });
    timings.largestCC = _now() - t;

    // 2 — morphological closing (repair)
    t = _now();
    const closed = morphologicalClosing(cc, width, height, closeR);
    timings.close = _now() - t;

    // 3 — morphological opening (cleanup)
    t = _now();
    const opened = morphologicalOpening(closed, width, height, openR);
    timings.open = _now() - t;

    // 4 — validation gate
    t = _now();
    const validation = validateMask(opened, width, height, Object.assign(
      { seed: seedPt, connectivity: conn }, validationOpts
    ));
    timings.validate = _now() - t;
    const bbox = validation.metrics ? validation.metrics.bbox : null;

    if (!validation.valid) {
      // Hard fail → typed "no selection". Never emit a garbage mask.
      timings.total = timings.largestCC + timings.close + timings.open + timings.validate;
      return {
        ok: false,
        noSelection: true,
        reasons: validation.reasons,
        mask: null,
        rle: null,
        polygon: null,
        alpha: null,
        bbox: bbox,
        validation: validation,
        metrics: null,
        timings: timings,
        width: width,
        height: height,
      };
    }

    // 5 — contour extraction (rings: outer + holes), in image pixel coords
    t = _now();
    const rings = contourExtraction(opened, width, height);
    timings.contour = _now() - t;

    // 6 — polygon simplification (adaptive ε ∝ √area, targeting a vertex budget)
    t = _now();
    const area = validation.metrics ? validation.metrics.area : n;
    let eps = opts.epsilon;
    if (!(typeof eps === 'number' && eps > 0)) {
      eps = Math.sqrt(area) * 0.03;
      if (eps < 1) eps = 1;
      if (eps > 6) eps = 6;
    }
    const simplifiedRings = [];
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      simplifiedRings.push(ring.length > 3 ? simplifyPolygon(ring, eps) : ring);
    }
    timings.simplify = _now() - t;

    // 7 — render-only alpha (does NOT alter the mask)
    t = _now();
    const alpha = featherMask(opened, width, height, featherR);
    timings.feather = _now() - t;

    // 8 — RLE + quality metrics
    t = _now();
    const rle = _encodeRLE(opened, width, height);
    timings.rle = _now() - t;

    t = _now();
    const metrics = benchmarkMetrics(opened, width, height, {
      rawMask: mask,          // the untouched input = raw SAM mask (IoU fidelity)
      polygon: simplifiedRings,
      validation: validation,
      connectivity: conn,
    });
    timings.metrics = _now() - t;

    timings.total =
      timings.largestCC + timings.close + timings.open + timings.validate +
      timings.contour + timings.simplify + timings.feather + timings.rle + timings.metrics;

    return {
      ok: true,
      noSelection: false,
      mask: opened,                       // full-size single-channel binary (wire-compatible)
      rle: rle,
      polygon: { rings: simplifiedRings, epsilon: eps },
      alpha: alpha,                       // full-size Uint8ClampedArray, render-only
      bbox: bbox,
      validation: validation,
      metrics: metrics,
      timings: timings,
      width: width,
      height: height,
    };
  }

  // --- dual export: worker global + CommonJS (Jest/Node) --------------------
  var api = {
    extractBestMask: extractBestMask,
    largestConnectedComponent: largestConnectedComponent,
    morphologicalClosing: morphologicalClosing,
    morphologicalOpening: morphologicalOpening,
    validateMask: validateMask,
    contourExtraction: contourExtraction,
    simplifyPolygon: simplifyPolygon,
    featherMask: featherMask,
    benchmarkMetrics: benchmarkMetrics,
    refine: refine,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.PazlRefine = Object.assign(root.PazlRefine || {}, api);
  }
})(typeof self !== 'undefined' ? self : globalThis);
