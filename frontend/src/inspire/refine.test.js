/**
 * Unit + benchmark tests for public/refine.js :: extractBestMask().
 * Runs under CRA's Jest (react-scripts test). The refinement pipeline lives in
 * public/ (loaded by the classic worker via importScripts), and is authored with
 * a CommonJS export guard so it can be required here.
 */
const {
  extractBestMask,
  largestConnectedComponent,
  morphologicalClosing,
  morphologicalOpening,
  validateMask,
  contourExtraction,
  simplifyPolygon,
  featherMask,
  benchmarkMetrics,
  refine,
} = require('../public/refine');

// |signed area| of a ring via the shoelace formula
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

describe('extractBestMask()', () => {
  it('de-interleaves the chosen channel from 3-channel data', () => {
    // 2x2 image, 3 channels, pixel-interleaved: [c0,c1,c2, c0,c1,c2, ...]
    // channel 1 across the 4 pixels = [1, 0, 1, 0]
    const data = new Uint8Array([
      0, 1, 0, // p0: c1 = 1
      0, 0, 1, // p1: c1 = 0
      1, 1, 0, // p2: c1 = 1
      0, 0, 1, // p3: c1 = 0
    ]);
    const out = extractBestMask(data, 2, 2, 3, 1);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual([1, 0, 1, 0]);
  });

  it('uses the single-channel fast path and normalizes 0/255', () => {
    const data = new Uint8Array([0, 255, 255, 0]);
    const out = extractBestMask(data, 2, 2, 1, 0);
    expect(Array.from(out)).toEqual([0, 1, 1, 0]);
  });

  it('normalizes any truthy value to exactly 1', () => {
    // 2x1 image, 3 channels, best = channel 0 → pixels [0, 200] → [0, 1]
    const data = [0, 7, 0, 200, 0, 0];
    const out = extractBestMask(data, 2, 1, 3, 0);
    expect(Array.from(out)).toEqual([0, 1]);
  });

  it('clamps an out-of-range bestIndex instead of throwing', () => {
    // 2x1 image, 2 channels: pixel data [c0,c1, c0,c1] = [1,0, 0,1]
    const data = new Uint8Array([1, 0, 0, 1]);
    expect(Array.from(extractBestMask(data, 2, 1, 2, 5))).toEqual([0, 1]); // clamp → ch-1 = 1
    expect(Array.from(extractBestMask(data, 2, 1, 2, -3))).toEqual([1, 0]); // clamp → 0
  });

  it('defaults a non-positive numMasks to 1', () => {
    const data = new Uint8Array([1, 0, 1, 0]);
    expect(Array.from(extractBestMask(data, 2, 2, 0, 0))).toEqual([1, 0, 1, 0]);
  });

  it('reuses a provided output buffer (zero allocation)', () => {
    const data = new Uint8Array([1, 0, 1, 0]);
    const out = new Uint8Array(4);
    const res = extractBestMask(data, 2, 2, 1, 0, out);
    expect(res).toBe(out);
    expect(Array.from(res)).toEqual([1, 0, 1, 0]);
  });

  it('throws TypeError on non-array-like data', () => {
    expect(() => extractBestMask(null, 2, 2, 1, 0)).toThrow(TypeError);
    expect(() => extractBestMask(undefined, 2, 2, 1, 0)).toThrow(TypeError);
  });

  it('throws RangeError on invalid dimensions', () => {
    expect(() => extractBestMask(new Uint8Array(4), 0, 2, 1, 0)).toThrow(RangeError);
    expect(() => extractBestMask(new Uint8Array(4), 2.5, 2, 1, 0)).toThrow(RangeError);
    expect(() => extractBestMask(new Uint8Array(4), -2, 2, 1, 0)).toThrow(RangeError);
  });

  it('throws RangeError when data is too short for width*height*numMasks', () => {
    expect(() => extractBestMask(new Uint8Array(3), 2, 2, 1, 0)).toThrow(RangeError);
    expect(() => extractBestMask(new Uint8Array(11), 2, 2, 3, 0)).toThrow(RangeError); // needs 12
  });

  it('is deterministic — identical inputs give byte-identical output', () => {
    const data = new Uint8Array([0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0]); // 2x2x3
    const a = extractBestMask(data, 2, 2, 3, 2);
    const b = extractBestMask(data, 2, 2, 3, 2);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('largestConnectedComponent()', () => {
  it('keeps the component containing the seed and drops the others', () => {
    // 5x1: two components {0,1} and {3,4}
    const mask = new Uint8Array([1, 1, 0, 1, 1]);
    expect(Array.from(largestConnectedComponent(mask, 5, 1, { seed: [4, 0] }))).toEqual([0, 0, 0, 1, 1]);
    expect(Array.from(largestConnectedComponent(mask, 5, 1, { seed: [0, 0] }))).toEqual([1, 1, 0, 0, 0]);
  });

  it('keeps the largest component when no seed is given', () => {
    // 5x1: {0,1,2} (size 3) and {4} (size 1)
    const mask = new Uint8Array([1, 1, 1, 0, 1]);
    expect(Array.from(largestConnectedComponent(mask, 5, 1))).toEqual([1, 1, 1, 0, 0]);
  });

  it('keeps the seed component even when it is NOT the largest', () => {
    // {0} (size 1) and {2,3,4} (size 3); click the small one
    const mask = new Uint8Array([1, 0, 1, 1, 1]);
    expect(Array.from(largestConnectedComponent(mask, 5, 1, { seed: [0, 0] }))).toEqual([1, 0, 0, 0, 0]);
  });

  it('seed on background → keeps the NEAREST component', () => {
    // components {0} and {4}; seed at x=1 (background) is nearer {0}
    const mask = new Uint8Array([1, 0, 0, 0, 1]);
    expect(Array.from(largestConnectedComponent(mask, 5, 1, { seed: [1, 0] }))).toEqual([1, 0, 0, 0, 0]);
    // seed at x=3 (background) is nearer {4}
    expect(Array.from(largestConnectedComponent(mask, 5, 1, { seed: [3, 0] }))).toEqual([0, 0, 0, 0, 1]);
  });

  it('respects 4- vs 8-connectivity for diagonal pixels', () => {
    // 2x2 diagonal: idx0 and idx3 touch only diagonally
    const mask = new Uint8Array([1, 0, 0, 1]);
    // 4-conn, no seed → two size-1 comps → first kept
    expect(Array.from(largestConnectedComponent(mask, 2, 2, { connectivity: 4 }))).toEqual([1, 0, 0, 0]);
    // 8-conn → single component → both kept
    expect(Array.from(largestConnectedComponent(mask, 2, 2, { connectivity: 8 }))).toEqual([1, 0, 0, 1]);
  });

  it('returns an all-zero mask for an empty input', () => {
    expect(Array.from(largestConnectedComponent(new Uint8Array(4), 2, 2, { seed: [0, 0] }))).toEqual([0, 0, 0, 0]);
  });

  it('falls back to largest when the seed is out of bounds (no throw)', () => {
    const mask = new Uint8Array([1, 1, 1, 0, 1]);
    expect(Array.from(largestConnectedComponent(mask, 5, 1, { seed: [99, 0] }))).toEqual([1, 1, 1, 0, 0]);
  });

  it('reuses a dirty output buffer safely (clears stale data)', () => {
    const mask = new Uint8Array([1, 1, 0, 0, 0]);
    const out = new Uint8Array(5).fill(1); // stale
    const res = largestConnectedComponent(mask, 5, 1, { seed: [0, 0], out });
    expect(res).toBe(out);
    expect(Array.from(res)).toEqual([1, 1, 0, 0, 0]);
  });

  it('validates inputs', () => {
    expect(() => largestConnectedComponent(null, 2, 2)).toThrow(TypeError);
    expect(() => largestConnectedComponent(new Uint8Array(4), 0, 2)).toThrow(RangeError);
    expect(() => largestConnectedComponent(new Uint8Array(3), 2, 2)).toThrow(RangeError);
  });

  it('benchmark: 1024x1024 mask within budget', () => {
    const w = 1024, h = 1024, n = w * h;
    const mask = new Uint8Array(n);
    // a big central blob + scattered speckle
    for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) mask[y * w + x] = 1;
    for (let k = 0; k < 500; k++) mask[(k * 1013) % n] = 1;
    const out = new Uint8Array(n);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    largestConnectedComponent(mask, w, h, { seed: [500, 500], out });
    const dt = now() - t0;
    expect(out[500 * w + 500]).toBe(1); // seed blob kept
    expect(out[0]).toBe(0); // corner speckle dropped
    expect(dt).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`largestConnectedComponent 1024x1024 (fast path): ${dt.toFixed(2)} ms`);
  });
});

describe('morphologicalClosing()', () => {
  it('fills a one-pixel gap (bridges within 2·r)', () => {
    // 3x1 [1,0,1] with r=1 → [1,1,1]
    expect(Array.from(morphologicalClosing(new Uint8Array([1, 0, 1]), 3, 1, 1))).toEqual([1, 1, 1]);
  });

  it('does NOT merge blobs farther apart than 2·r', () => {
    // 5x1 [1,0,0,0,1], r=1 → gap of 3 stays open
    expect(Array.from(morphologicalClosing(new Uint8Array([1, 0, 0, 0, 1]), 5, 1, 1))).toEqual([1, 0, 0, 0, 1]);
  });

  it('fills an interior hole in a 2-D shape', () => {
    // 5x5 solid with a single hole at the centre
    const w = 5, h = 5, mask = new Uint8Array(w * h).fill(1);
    mask[2 * w + 2] = 0; // centre hole
    const out = morphologicalClosing(mask, w, h, 1);
    expect(out[2 * w + 2]).toBe(1); // hole filled
    expect(Array.from(out).every((v) => v === 1)).toBe(true);
  });

  it('preserves an edge-touching object (border not eroded)', () => {
    // 3x3 solid → closing keeps every pixel (OOB treated as foreground for erode)
    const mask = new Uint8Array(9).fill(1);
    expect(Array.from(morphologicalClosing(mask, 3, 3, 1)).every((v) => v === 1)).toBe(true);
  });

  it('radius <= 0 is a no-op normalized copy', () => {
    expect(Array.from(morphologicalClosing(new Uint8Array([1, 0, 255, 0]), 4, 1, 0))).toEqual([1, 0, 1, 0]);
    expect(Array.from(morphologicalClosing(new Uint8Array([1, 0, 1]), 3, 1, -2))).toEqual([1, 0, 1]);
  });

  it('leaves a solid region unchanged (dilate+erode cancel)', () => {
    // a filled 3x3 block inside a 7x7 field, r=1 → same block
    const w = 7, h = 7, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    const out = morphologicalClosing(mask, w, h, 1);
    expect(Array.from(out)).toEqual(Array.from(mask));
  });

  it('does not mutate the input mask', () => {
    const mask = new Uint8Array([1, 0, 1]);
    const copy = Array.from(mask);
    morphologicalClosing(mask, 3, 1, 1);
    expect(Array.from(mask)).toEqual(copy);
  });

  it('reuses out + scratch buffers (no fresh allocation)', () => {
    const mask = new Uint8Array([1, 0, 1]);
    const out = new Uint8Array(3);
    const scratch = [new Uint8Array(3), new Uint8Array(3)];
    const res = morphologicalClosing(mask, 3, 1, 1, { out, scratch });
    expect(res).toBe(out);
    expect(Array.from(res)).toEqual([1, 1, 1]);
  });

  it('validates inputs', () => {
    expect(() => morphologicalClosing(null, 2, 2, 1)).toThrow(TypeError);
    expect(() => morphologicalClosing(new Uint8Array(4), 0, 2, 1)).toThrow(RangeError);
    expect(() => morphologicalClosing(new Uint8Array(3), 2, 2, 1)).toThrow(RangeError);
  });

  it('benchmark: 1024x1024 r=2 is radius-independent and within budget', () => {
    const w = 1024, h = 1024, n = w * h;
    const mask = new Uint8Array(n);
    for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) mask[y * w + x] = 1;
    for (let k = 0; k < 2000; k++) mask[((k * 5701) % n)] = 0; // pinholes
    const out = new Uint8Array(n);
    const scratch = [new Uint8Array(n), new Uint8Array(n)];
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    morphologicalClosing(mask, w, h, 2, { out, scratch });
    const dt = now() - t0;
    expect(out[500 * w + 500]).toBe(1);
    expect(dt).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`morphologicalClosing 1024x1024 r=2: ${dt.toFixed(2)} ms`);
  });
});

describe('morphologicalOpening()', () => {
  it('removes an isolated speck', () => {
    // 5x5 background with a single foreground pixel at the centre → r=1 wipes it
    const w = 5, h = 5, mask = new Uint8Array(w * h);
    mask[2 * w + 2] = 1;
    expect(Array.from(morphologicalOpening(mask, w, h, 1)).every((v) => v === 0)).toBe(true);
  });

  it('removes a thin nub but keeps the body', () => {
    // 7x7: a solid 3x3 block at [2..4]x[2..4] plus a 1px nub sticking out at (5,3)
    const w = 7, h = 7, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    mask[3 * w + 5] = 1; // nub
    const out = morphologicalOpening(mask, w, h, 1);
    expect(out[3 * w + 3]).toBe(1); // body centre kept
    expect(out[2 * w + 2]).toBe(1); // body corner restored by dilate
    expect(out[3 * w + 5]).toBe(0); // nub removed
    expect(out[0]).toBe(0);
  });

  it('leaves a solid region unchanged (erode+dilate cancel)', () => {
    const w = 7, h = 7, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    expect(Array.from(morphologicalOpening(mask, w, h, 1))).toEqual(Array.from(mask));
  });

  it('preserves an edge-touching solid object', () => {
    // 3x3 fully-foreground image → no small parts → opening leaves it intact
    const mask = new Uint8Array(9).fill(1);
    expect(Array.from(morphologicalOpening(mask, 3, 3, 1)).every((v) => v === 1)).toBe(true);
  });

  it('radius <= 0 is a no-op normalized copy', () => {
    expect(Array.from(morphologicalOpening(new Uint8Array([1, 0, 255, 0]), 4, 1, 0))).toEqual([1, 0, 1, 0]);
    expect(Array.from(morphologicalOpening(new Uint8Array([1, 0, 1]), 3, 1, -1))).toEqual([1, 0, 1]);
  });

  it('does not mutate the input mask', () => {
    const w = 5, h = 5, mask = new Uint8Array(w * h);
    mask[2 * w + 2] = 1;
    const copy = Array.from(mask);
    morphologicalOpening(mask, w, h, 1);
    expect(Array.from(mask)).toEqual(copy);
  });

  it('reuses out + scratch buffers (no fresh allocation)', () => {
    const w = 5, h = 5, mask = new Uint8Array(w * h);
    mask[2 * w + 2] = 1;
    const out = new Uint8Array(w * h);
    const scratch = [new Uint8Array(w * h), new Uint8Array(w * h)];
    const res = morphologicalOpening(mask, w, h, 1, { out, scratch });
    expect(res).toBe(out);
    expect(Array.from(res).every((v) => v === 0)).toBe(true);
  });

  it('validates inputs', () => {
    expect(() => morphologicalOpening(null, 2, 2, 1)).toThrow(TypeError);
    expect(() => morphologicalOpening(new Uint8Array(4), 0, 2, 1)).toThrow(RangeError);
    expect(() => morphologicalOpening(new Uint8Array(3), 2, 2, 1)).toThrow(RangeError);
  });

  it('benchmark: 1024x1024 r=1 within budget', () => {
    const w = 1024, h = 1024, n = w * h;
    const mask = new Uint8Array(n);
    for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) mask[y * w + x] = 1; // body
    for (let k = 0; k < 3000; k++) mask[((k * 7919) % n)] = 1; // speckle
    const out = new Uint8Array(n);
    const scratch = [new Uint8Array(n), new Uint8Array(n)];
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    morphologicalOpening(mask, w, h, 1, { out, scratch });
    const dt = now() - t0;
    expect(out[500 * w + 500]).toBe(1); // body kept
    expect(out[0]).toBe(0); // corner speck gone
    expect(dt).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`morphologicalOpening 1024x1024 r=1: ${dt.toFixed(2)} ms`);
  });
});

describe('validateMask()', () => {
  it('hard-fails an empty mask', () => {
    const r = validateMask(new Uint8Array(100), 10, 10);
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('empty');
    expect(r.metrics.area).toBe(0);
    expect(r.metrics.bbox).toBeNull();
  });

  it('hard-fails a too-small mask', () => {
    // 10x10, a 3x3 block (area 9); default minArea floor is 64
    const w = 10, h = 10, mask = new Uint8Array(w * h);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) mask[y * w + x] = 1;
    const r = validateMask(mask, w, h);
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('too_small');
    expect(r.metrics.area).toBe(9);
  });

  it('hard-fails a too-large mask (background grab)', () => {
    const mask = new Uint8Array(100).fill(1); // 10x10 all foreground
    const r = validateMask(mask, 10, 10);
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('too_large');
  });

  it('passes a healthy single-object mask', () => {
    // 20x20 with a 6x6 block, thresholds relaxed for the small test image
    const w = 20, h = 20, mask = new Uint8Array(w * h);
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) mask[y * w + x] = 1;
    const r = validateMask(mask, w, h, { minArea: 4, seed: [7, 7] });
    expect(r.valid).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.metrics.area).toBe(36);
    expect(r.metrics.componentCount).toBe(1);
    expect(r.metrics.seedInside).toBe(true);
    expect(r.metrics.bbox).toEqual({ x: 5, y: 5, w: 6, h: 6 });
  });

  it('hard-fails when the seed is outside the mask (missing_click)', () => {
    const w = 20, h = 20, mask = new Uint8Array(w * h);
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) mask[y * w + x] = 1;
    const r = validateMask(mask, w, h, { minArea: 4, seed: [0, 0] });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('missing_click');
    expect(r.metrics.seedInside).toBe(false);
  });

  it('soft-warns on a disconnected mask but stays valid', () => {
    // two separate blocks
    const w = 20, h = 20, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    for (let y = 12; y <= 15; y++) for (let x = 12; x <= 15; x++) mask[y * w + x] = 1;
    const r = validateMask(mask, w, h, { minArea: 4 });
    expect(r.valid).toBe(true);
    expect(r.warnings).toContain('disconnected');
    expect(r.metrics.componentCount).toBe(2);
  });

  it('allowMultipleComponents suppresses the disconnected warning', () => {
    const w = 20, h = 20, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    for (let y = 12; y <= 15; y++) for (let x = 12; x <= 15; x++) mask[y * w + x] = 1;
    const r = validateMask(mask, w, h, { minArea: 4, allowMultipleComponents: true });
    expect(r.warnings).not.toContain('disconnected');
  });

  it('soft-warns when the mask touches many borders', () => {
    // a full left column touches left + top + bottom = 3 borders (not right)
    const w = 10, h = 10, mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) mask[y * w + 0] = 1;
    const r = validateMask(mask, w, h, { minArea: 4, maxAreaFraction: 0.99 });
    expect(r.metrics.touchedBorders).toBe(3);
    expect(r.warnings).toContain('border_touch');
  });

  it('does not mutate the input mask', () => {
    const mask = new Uint8Array([1, 0, 1, 0]);
    const copy = Array.from(mask);
    validateMask(mask, 2, 2, { minArea: 1 });
    expect(Array.from(mask)).toEqual(copy);
  });

  it('validates inputs', () => {
    expect(() => validateMask(null, 2, 2)).toThrow(TypeError);
    expect(() => validateMask(new Uint8Array(4), 0, 2)).toThrow(RangeError);
    expect(() => validateMask(new Uint8Array(3), 2, 2)).toThrow(RangeError);
  });

  it('benchmark: 1024x1024 within budget', () => {
    const w = 1024, h = 1024, n = w * h;
    const mask = new Uint8Array(n);
    for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) mask[y * w + x] = 1;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const r = validateMask(mask, w, h, { seed: [500, 500] });
    const dt = now() - t0;
    expect(r.valid).toBe(true);
    expect(r.metrics.componentCount).toBe(1);
    expect(dt).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`validateMask 1024x1024: ${dt.toFixed(2)} ms`);
  });
});

describe('contourExtraction()', () => {
  it('returns no rings for an empty mask', () => {
    expect(contourExtraction(new Uint8Array(25), 5, 5)).toEqual([]);
  });

  it('traces a single-pixel mask as one closed 4-vertex ring', () => {
    const w = 5, h = 5, mask = new Uint8Array(w * h);
    mask[2 * w + 2] = 1;
    const rings = contourExtraction(mask, w, h);
    expect(rings.length).toBe(1);
    expect(rings[0].length).toBe(4); // diamond around the pixel
    // MS uses edge-midpoint crossings → a single pixel is a diamond of area 0.5
    // (= pixel area 1 − 4 convex-corner bevels of 0.125).
    expect(ringArea(rings[0])).toBeCloseTo(0.5, 5);
  });

  it('traces a solid 3x3 block as one ring enclosing its area', () => {
    const w = 7, h = 7, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    const rings = contourExtraction(mask, w, h);
    expect(rings.length).toBe(1);
    expect(ringArea(rings[0])).toBeCloseTo(8.5, 5); // 9 − 0.5 (MS convex bevels)
  });

  it('produces two rings (outer + hole) for a shape with a hole', () => {
    // 5x5 solid with the centre pixel removed → outer ring + inner hole ring
    const w = 5, h = 5, mask = new Uint8Array(w * h).fill(1);
    mask[2 * w + 2] = 0;
    const rings = contourExtraction(mask, w, h);
    expect(rings.length).toBe(2);
    const areas = rings.map(ringArea).sort((a, b) => b - a);
    expect(areas[0]).toBeCloseTo(24.5, 5); // outer: 25 − 0.5
    expect(areas[1]).toBeCloseTo(0.5, 5); // hole: 1px diamond
  });

  it('produces one ring per disconnected blob', () => {
    const w = 10, h = 5, mask = new Uint8Array(w * h);
    mask[2 * w + 2] = 1; // blob A
    mask[2 * w + 7] = 1; // blob B (separate)
    expect(contourExtraction(mask, w, h).length).toBe(2);
  });

  it('handles an edge-touching object (virtual border → closed ring)', () => {
    // single pixel in the top-left corner
    const w = 5, h = 5, mask = new Uint8Array(w * h);
    mask[0] = 1;
    const rings = contourExtraction(mask, w, h);
    expect(rings.length).toBe(1);
    expect(ringArea(rings[0])).toBeCloseTo(0.5, 5); // corner pixel diamond
  });

  it('does not mutate the input mask', () => {
    const mask = new Uint8Array([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    const copy = Array.from(mask);
    contourExtraction(mask, 3, 3);
    expect(Array.from(mask)).toEqual(copy);
  });

  it('is deterministic', () => {
    const w = 7, h = 7, mask = new Uint8Array(w * h);
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) mask[y * w + x] = 1;
    expect(JSON.stringify(contourExtraction(mask, w, h))).toBe(
      JSON.stringify(contourExtraction(mask, w, h))
    );
  });

  it('validates inputs', () => {
    expect(() => contourExtraction(null, 2, 2)).toThrow(TypeError);
    expect(() => contourExtraction(new Uint8Array(4), 0, 2)).toThrow(RangeError);
    expect(() => contourExtraction(new Uint8Array(3), 2, 2)).toThrow(RangeError);
  });

  it('benchmark: 1024x1024 blob within budget', () => {
    const w = 1024, h = 1024, n = w * h;
    const mask = new Uint8Array(n);
    for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) mask[y * w + x] = 1;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const rings = contourExtraction(mask, w, h);
    const dt = now() - t0;
    expect(rings.length).toBe(1);
    expect(Math.abs(ringArea(rings[0]) - 600 * 600)).toBeLessThan(2); // ~360000 − 0.5 (MS)
    expect(dt).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`contourExtraction 1024x1024: ${dt.toFixed(2)} ms`);
  });
});

describe('simplifyPolygon()', () => {
  it('collapses collinear edge points to the 4 corners of a square', () => {
    // square 0..2 with a midpoint on each edge (8 points)
    const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
    const out = simplifyPolygon(ring, 0.5);
    expect(out.length).toBe(4);
    // the 4 corners are preserved (order-independent set check)
    const set = out.map((p) => p.join(',')).sort();
    expect(set).toEqual(['0,0', '0,2', '2,0', '2,2']);
  });

  it('preserves the shape area after simplification', () => {
    const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
    expect(ringArea(simplifyPolygon(ring, 0.5))).toBeCloseTo(ringArea(ring), 5);
  });

  it('keeps a real corner that exceeds epsilon', () => {
    // an L-ish path with a genuine corner at [2,2]
    const ring = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 4], [0, 4]];
    const out = simplifyPolygon(ring, 0.5);
    // corner [2,2] must survive (dropping it would cut the notch)
    expect(out.some((p) => p[0] === 2 && p[1] === 2)).toBe(true);
  });

  it('reduces the vertex count of a dense near-straight edge', () => {
    // 50 points along y≈0 with sub-epsilon jitter → a near-straight line
    const ring = [];
    for (let i = 0; i <= 50; i++) ring.push([i, (i % 2) * 0.05]);
    ring.push([25, 20]); // one real bump so it's a closed 2-D ring
    const out = simplifyPolygon(ring, 0.5);
    expect(out.length).toBeLessThan(ring.length);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('returns a copy for rings of length <= 3', () => {
    const ring = [[0, 0], [1, 0], [0, 1]];
    const out = simplifyPolygon(ring, 1);
    expect(out).toEqual(ring);
    expect(out).not.toBe(ring);
    expect(out[0]).not.toBe(ring[0]); // deep copy of points
  });

  it('epsilon <= 0 drops only exactly-collinear points', () => {
    const ring = [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]]; // [1,0] is collinear
    const out = simplifyPolygon(ring, 0);
    expect(out.some((p) => p[0] === 1 && p[1] === 0)).toBe(false); // collinear dropped
    expect(out.length).toBe(4);
  });

  it('does not mutate the input ring', () => {
    const ring = [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]];
    const snapshot = JSON.stringify(ring);
    simplifyPolygon(ring, 0.5);
    expect(JSON.stringify(ring)).toBe(snapshot);
  });

  it('is deterministic', () => {
    const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
    expect(JSON.stringify(simplifyPolygon(ring, 0.4))).toBe(
      JSON.stringify(simplifyPolygon(ring, 0.4))
    );
  });

  it('validates inputs', () => {
    expect(() => simplifyPolygon(null, 1)).toThrow(TypeError);
    expect(() => simplifyPolygon(undefined, 1)).toThrow(TypeError);
  });

  it('benchmark: 10k-vertex ring within budget', () => {
    // a jagged circle with 10000 vertices
    const N = 10000, ring = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const r = 300 + (i % 2 ? 1 : 0); // tiny sub-epsilon jitter
      ring.push([500 + r * Math.cos(t), 500 + r * Math.sin(t)]);
    }
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const out = simplifyPolygon(ring, 2);
    const dt = now() - t0;
    expect(out.length).toBeLessThan(N);
    expect(out.length).toBeGreaterThan(3);
    expect(dt).toBeLessThan(30);
    // eslint-disable-next-line no-console
    console.log(`simplifyPolygon 10k→${out.length}: ${dt.toFixed(2)} ms`);
  });
});

describe('featherMask()', () => {
  it('radius <= 0 returns a hard 0/255 alpha', () => {
    const out = featherMask(new Uint8Array([1, 0, 1, 0]), 4, 1, 0);
    expect(Array.from(out)).toEqual([255, 0, 255, 0]);
  });

  it('ramps monotonically across a straight edge', () => {
    // 8x1 half-plane: left foreground, right background; r=1
    const out = featherMask(new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0]), 8, 1, 1);
    expect(out[0]).toBe(255);   // interior opaque
    expect(out[2]).toBe(255);   // still interior
    expect(out[3]).toBe(170);   // inside edge (avg of 255,255,0 = 170)
    expect(out[4]).toBe(85);    // outside edge (avg of 255,0,0 = 85)
    expect(out[5]).toBe(0);     // background
    expect(out[3]).toBeGreaterThan(out[4]);
    expect(out[4]).toBeGreaterThan(out[5]);
  });

  it('keeps the interior opaque and far background transparent', () => {
    // 9x9 with a 3x3 block at [3..5]; corner (0,0) is > r px from the block
    const w = 9, h = 9, mask = new Uint8Array(w * h);
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) mask[y * w + x] = 1;
    const out = featherMask(mask, w, h, 1);
    expect(out[4 * w + 4]).toBe(255); // opaque core
    expect(out[0]).toBe(0);           // far background stays transparent
    // a pixel just outside the block edge is partially transparent (feathered)
    expect(out[4 * w + 6]).toBeGreaterThan(0);
    expect(out[4 * w + 6]).toBeLessThan(255);
  });

  it('does not feather a solid object against the image frame', () => {
    // 3x3 fully foreground → every alpha stays 255 (in-bounds neighbourhood all fg)
    const out = featherMask(new Uint8Array(9).fill(1), 3, 3, 1);
    expect(Array.from(out).every((v) => v === 255)).toBe(true);
  });

  it('emits values only in [0,255] and does not mutate the mask', () => {
    const w = 6, h = 6, mask = new Uint8Array(w * h);
    for (let y = 2; y <= 3; y++) for (let x = 2; x <= 3; x++) mask[y * w + x] = 1;
    const copy = Array.from(mask);
    const out = featherMask(mask, w, h, 2);
    expect(Array.from(out).every((v) => v >= 0 && v <= 255)).toBe(true);
    expect(Array.from(mask)).toEqual(copy); // mask untouched (render-only)
  });

  it('reuses out + scratch buffers (no fresh allocation)', () => {
    const mask = new Uint8Array([1, 1, 0, 0]);
    const out = new Uint8ClampedArray(4);
    const scratch = new Float32Array(4);
    const res = featherMask(mask, 4, 1, 1, { out, scratch });
    expect(res).toBe(out);
  });

  it('validates inputs', () => {
    expect(() => featherMask(null, 2, 2, 1)).toThrow(TypeError);
    expect(() => featherMask(new Uint8Array(4), 0, 2, 1)).toThrow(RangeError);
    expect(() => featherMask(new Uint8Array(3), 2, 2, 1)).toThrow(RangeError);
  });

  it('benchmark: 1024x1024 r=3 is radius-independent and within budget', () => {
    const w = 1024, h = 1024, n = w * h;
    const mask = new Uint8Array(n);
    for (let y = 200; y < 800; y++) for (let x = 200; x < 800; x++) mask[y * w + x] = 1;
    const out = new Uint8ClampedArray(n);
    const scratch = new Float32Array(n);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    featherMask(mask, w, h, 3, { out, scratch }); // warm up the JIT (first selection in prod)
    const t0 = now();
    featherMask(mask, w, h, 3, { out, scratch });
    const dt = now() - t0;
    expect(out[500 * w + 500]).toBe(255); // core opaque
    expect(out[0]).toBe(0); // far corner transparent
    expect(dt).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`featherMask 1024x1024 r=3 (warm): ${dt.toFixed(2)} ms`);
  });
});

describe('extractBestMask() — benchmark', () => {
  it('extracts a 1024x1024x3 mask well within budget', () => {
    const w = 1024;
    const h = 1024;
    const ch = 3;
    const data = new Uint8Array(w * h * ch);
    for (let i = 0; i < data.length; i += ch) data[i + 1] = 1; // channel 1 = all foreground
    const out = new Uint8Array(w * h);

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const RUNS = 5;
    const t0 = now();
    for (let r = 0; r < RUNS; r++) extractBestMask(data, w, h, ch, 1, out);
    const perRun = (now() - t0) / RUNS;

    expect(out[0]).toBe(1); // sanity: it actually extracted channel 1
    expect(perRun).toBeLessThan(50); // generous CI budget; ~1–5 ms in practice
    // eslint-disable-next-line no-console
    console.log(`extractBestMask 1024x1024x3: ${perRun.toFixed(2)} ms/run`);
  });
});

describe('benchmarkMetrics()', () => {
  // Build a filled rectangle mask.
  function rect(w, h, x0, y0, x1, y1) {
    const m = new Uint8Array(w * h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
    return m;
  }

  it('reports area, areaFraction and bbox', () => {
    const w = 100, h = 100;
    const mask = rect(w, h, 20, 30, 39, 49); // 20x20 = 400 px
    const r = benchmarkMetrics(mask, w, h);
    expect(r.area).toBe(400);
    expect(r.areaFraction).toBeCloseTo(400 / 10000, 6);
    expect(r.bbox).toEqual({ x: 20, y: 30, w: 20, h: 20 });
  });

  it('computes perimeter as the boundary-pixel count', () => {
    const w = 100, h = 100;
    const mask = rect(w, h, 20, 20, 29, 29); // 10x10 solid interior-away-from-edge
    const r = benchmarkMetrics(mask, w, h);
    // A solid 10x10 block: the outer ring of pixels is the boundary = 10*4 - 4 = 36.
    expect(r.perimeter).toBe(36);
  });

  it('a solid square scores higher smoothness than a jagged shape of equal area', () => {
    const w = 64, h = 64;
    const solid = rect(w, h, 20, 20, 29, 29); // compact 100 px
    // Jagged: a comb of vertical 1px teeth — same-ish area, much larger perimeter.
    const jag = new Uint8Array(w * h);
    let placed = 0;
    for (let x = 10; x < 54 && placed < 100; x += 2) {
      for (let y = 20; y < 30 && placed < 100; y++) { jag[y * w + x] = 1; placed++; }
    }
    const sSolid = benchmarkMetrics(solid, w, h).subscores.smoothness;
    const sJag = benchmarkMetrics(jag, w, h).subscores.smoothness;
    expect(sSolid).toBeGreaterThan(sJag);
  });

  it('counts connected components (8-connectivity)', () => {
    const w = 50, h = 50;
    const mask = new Uint8Array(w * h);
    // two separate 3x3 blocks
    for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) mask[y * w + x] = 1;
    for (let y = 30; y < 33; y++) for (let x = 30; x < 33; x++) mask[y * w + x] = 1;
    const r = benchmarkMetrics(mask, w, h);
    expect(r.componentCount).toBe(2);
    expect(r.subscores.singleComponent).toBeCloseTo(0.5, 6);
  });

  it('single component gives singleComponent = 1', () => {
    const w = 40, h = 40;
    const r = benchmarkMetrics(rect(w, h, 10, 10, 19, 19), w, h);
    expect(r.componentCount).toBe(1);
    expect(r.subscores.singleComponent).toBe(1);
  });

  it('IoU fidelity: identical masks → 1, disjoint → 0', () => {
    const w = 40, h = 40;
    const a = rect(w, h, 5, 5, 14, 14);
    const same = rect(w, h, 5, 5, 14, 14);
    const disjoint = rect(w, h, 25, 25, 34, 34);
    expect(benchmarkMetrics(a, w, h, { rawMask: same }).iou).toBeCloseTo(1, 6);
    expect(benchmarkMetrics(a, w, h, { rawMask: disjoint }).iou).toBe(0);
  });

  it('IoU fidelity: half-overlap → 1/3', () => {
    const w = 40, h = 40;
    const a = rect(w, h, 10, 10, 19, 10); // 10 px row
    const b = rect(w, h, 15, 10, 24, 10); // 10 px row, overlaps 5
    // inter=5, union=15 → 1/3
    expect(benchmarkMetrics(a, w, h, { rawMask: b }).iou).toBeCloseTo(1 / 3, 6);
  });

  it('accepts a single ring and reports vertex/ring counts + validPolygon', () => {
    const w = 20, h = 20;
    const ring = [[2, 2], [10, 2], [10, 10], [2, 10]]; // CCW-ish square, 4 verts
    const r = benchmarkMetrics(rect(w, h, 2, 2, 9, 9), w, h, { polygon: ring });
    expect(r.ringCount).toBe(1);
    expect(r.polygonVertices).toBe(4);
    expect(r.subscores.validPolygon).toBe(1);
  });

  it('accepts an array of rings (outer + hole)', () => {
    const w = 20, h = 20;
    const outer = [[1, 1], [12, 1], [12, 12], [1, 12]];
    const hole = [[4, 4], [8, 4], [8, 8]];
    const r = benchmarkMetrics(rect(w, h, 1, 1, 11, 11), w, h, { polygon: [outer, hole] });
    expect(r.ringCount).toBe(2);
    expect(r.polygonVertices).toBe(7);
    expect(r.subscores.validPolygon).toBe(1);
  });

  it('degenerate polygon (a ring < 3 vertices) → validPolygon 0', () => {
    const w = 20, h = 20;
    const r = benchmarkMetrics(rect(w, h, 2, 2, 9, 9), w, h, { polygon: [[[2, 2], [9, 9]]] });
    expect(r.subscores.validPolygon).toBe(0);
  });

  it('area plausibility: mid-range area is fully plausible, tiny/huge are penalized', () => {
    const w = 200, h = 200, n = w * h; // 40000 px
    const good = rect(w, h, 20, 20, 119, 119); // 100x100 = 10000 → 25% → plausible
    const rGood = benchmarkMetrics(good, w, h);
    expect(rGood.subscores.areaPlausibility).toBe(1);

    // Fills the whole canvas → above maxAreaFraction → 0.
    const huge = new Uint8Array(n).fill(1);
    expect(benchmarkMetrics(huge, w, h).subscores.areaPlausibility).toBe(0);
  });

  it('composite qualityScore is 0–100 and higher for a clean vs messy mask', () => {
    const w = 100, h = 100;
    const clean = rect(w, h, 30, 30, 69, 69); // solid, single component, ~16% area
    const rawSame = rect(w, h, 30, 30, 69, 69);
    const ring = [[30, 30], [69, 30], [69, 69], [30, 69]];
    const cleanScore = benchmarkMetrics(clean, w, h, { rawMask: rawSame, polygon: ring }).qualityScore;

    // Messy: two disconnected blobs, poor fidelity to the raw single blob.
    const messy = new Uint8Array(w * h);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) messy[y * w + x] = 1;
    for (let y = 80; y < 90; y++) for (let x = 80; x < 90; x++) messy[y * w + x] = 1;
    const messyScore = benchmarkMetrics(messy, w, h, { rawMask: rawSame, polygon: ring }).qualityScore;

    expect(cleanScore).toBeGreaterThanOrEqual(0);
    expect(cleanScore).toBeLessThanOrEqual(100);
    expect(cleanScore).toBeGreaterThan(messyScore);
  });

  it('renormalizes weights when rawMask/polygon are absent', () => {
    const w = 50, h = 50;
    const mask = rect(w, h, 10, 10, 29, 29);
    const r = benchmarkMetrics(mask, w, h); // no rawMask, no polygon
    expect(r.subscores.fidelity).toBeNull();
    expect(r.subscores.validPolygon).toBeNull();
    expect(r.iou).toBeNull();
    expect(r.ringCount).toBeNull();
    // score still a clean 0–100 from the three pixel-only subscores
    expect(r.qualityScore).toBeGreaterThanOrEqual(0);
    expect(r.qualityScore).toBeLessThanOrEqual(100);
  });

  it('empty mask always scores 0, even when the raw mask is also empty', () => {
    const w = 30, h = 30;
    const empty = new Uint8Array(w * h);
    const r = benchmarkMetrics(empty, w, h, { rawMask: new Uint8Array(w * h) });
    expect(r.area).toBe(0);
    expect(r.bbox).toBeNull();
    expect(r.componentCount).toBe(0);
    expect(r.qualityScore).toBe(0);
  });

  it('passes a validateMask() result through verbatim', () => {
    const w = 40, h = 40;
    const mask = rect(w, h, 10, 10, 29, 29);
    const validation = validateMask(mask, w, h, { seed: [15, 15] });
    const r = benchmarkMetrics(mask, w, h, { validation });
    expect(r.validation).toBe(validation);
  });

  it('is deterministic (byte-identical repeated calls)', () => {
    const w = 80, h = 80;
    const mask = rect(w, h, 15, 15, 54, 54);
    const raw = rect(w, h, 16, 16, 55, 55);
    const ring = [[15, 15], [54, 15], [54, 54], [15, 54]];
    const a = benchmarkMetrics(mask, w, h, { rawMask: raw, polygon: ring });
    const b = benchmarkMetrics(mask, w, h, { rawMask: raw, polygon: ring });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('throws on invalid input', () => {
    expect(() => benchmarkMetrics(null, 4, 4)).toThrow(TypeError);
    expect(() => benchmarkMetrics(new Uint8Array(16), 0, 4)).toThrow(RangeError);
    expect(() => benchmarkMetrics(new Uint8Array(4), 4, 4)).toThrow(RangeError);
  });
});

describe('refine() — orchestrator', () => {
  // A solid disc of radius R centered at (cx,cy) in a w*h frame.
  function disc(w, h, cx, cy, R) {
    const m = new Uint8Array(w * h);
    const R2 = R * R;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= R2) m[y * w + x] = 1;
      }
    }
    return m;
  }

  it('returns the full contract on a clean selection', () => {
    const w = 128, h = 128;
    const mask = disc(w, h, 64, 64, 30);
    const r = refine(mask, w, h, [64, 64]);
    expect(r.ok).toBe(true);
    expect(r.noSelection).toBe(false);
    // contract keys
    expect(r.rle).not.toBeNull();
    expect(r.polygon).not.toBeNull();
    expect(r.alpha).not.toBeNull();
    expect(r.bbox).not.toBeNull();
    expect(r.validation).toBeDefined();
    expect(r.metrics).not.toBeNull();
    // full-size wire-compatible outputs
    expect(r.mask.length).toBe(w * h);
    expect(r.alpha.length).toBe(w * h);
    expect(r.polygon.rings.length).toBeGreaterThanOrEqual(1);
    expect(r.metrics.qualityScore).toBeGreaterThan(0);
  });

  it('does NOT mutate the input mask (raw stays intact for IoU)', () => {
    const w = 64, h = 64;
    const mask = disc(w, h, 32, 32, 15);
    const before = mask.slice();
    refine(mask, w, h, [32, 32]);
    expect(Array.from(mask)).toEqual(Array.from(before));
  });

  it('the render-only alpha leaves the returned mask binary', () => {
    const w = 96, h = 96;
    const r = refine(disc(w, h, 48, 48, 20), w, h, [48, 48]);
    for (let i = 0; i < r.mask.length; i++) {
      expect(r.mask[i] === 0 || r.mask[i] === 1).toBe(true);
    }
    // alpha has soft (non-0/255) values somewhere on the edge
    let soft = 0;
    for (let i = 0; i < r.alpha.length; i++) if (r.alpha[i] > 0 && r.alpha[i] < 255) soft++;
    expect(soft).toBeGreaterThan(0);
  });

  it('RLE round-trips back to the refined mask', () => {
    const w = 80, h = 80;
    const r = refine(disc(w, h, 40, 40, 18), w, h, [40, 40]);
    const { counts } = r.rle;
    const decoded = new Uint8Array(w * h);
    let idx = 0, val = 0;
    for (let c = 0; c < counts.length; c++) {
      for (let k = 0; k < counts[c]; k++) decoded[idx++] = val;
      val ^= 1;
    }
    expect(idx).toBe(w * h);
    expect(Array.from(decoded)).toEqual(Array.from(r.mask));
  });

  it('keeps only the clicked blob (largest-CC integrated)', () => {
    const w = 100, h = 100;
    const mask = new Uint8Array(w * h);
    // big blob around (25,25), small distractor around (80,80)
    for (let y = 15; y < 36; y++) for (let x = 15; x < 36; x++) mask[y * w + x] = 1;
    for (let y = 78; y < 83; y++) for (let x = 78; x < 83; x++) mask[y * w + x] = 1;
    const r = refine(mask, w, h, [25, 25]);
    expect(r.ok).toBe(true);
    expect(r.metrics.componentCount).toBe(1);
    // the distractor corner is gone
    expect(r.mask[80 * w + 80]).toBe(0);
  });

  it('hard-fails to a typed no-selection on an empty mask', () => {
    const w = 64, h = 64;
    const r = refine(new Uint8Array(w * h), w, h, [10, 10]);
    expect(r.ok).toBe(false);
    expect(r.noSelection).toBe(true);
    expect(r.reasons).toContain('empty');
    expect(r.mask).toBeNull();
    expect(r.rle).toBeNull();
    expect(r.polygon).toBeNull();
    expect(r.alpha).toBeNull();
    expect(r.metrics).toBeNull();
  });

  it('hard-fails to no-selection when the whole frame is selected (too_large)', () => {
    const w = 64, h = 64;
    const r = refine(new Uint8Array(w * h).fill(1), w, h, [32, 32]);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('too_large');
  });

  it('emits per-stage timings that sum to total', () => {
    const w = 96, h = 96;
    const r = refine(disc(w, h, 48, 48, 20), w, h, [48, 48]);
    const t = r.timings;
    const sum = t.largestCC + t.close + t.open + t.validate +
      t.contour + t.simplify + t.feather + t.rle + t.metrics;
    expect(t.total).toBeCloseTo(sum, 3);
    for (const k of Object.keys(t)) expect(t[k]).toBeGreaterThanOrEqual(0);
  });

  it('polygon vertices land in a sensible budget after simplification', () => {
    const w = 128, h = 128;
    const r = refine(disc(w, h, 64, 64, 40), w, h, [64, 64]);
    // outer ring simplified — not the hundreds of marching-squares vertices
    expect(r.polygon.rings[0].length).toBeLessThan(120);
    expect(r.polygon.rings[0].length).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic apart from timings', () => {
    const w = 96, h = 96;
    const mask = disc(w, h, 48, 48, 22);
    const a = refine(mask, w, h, [48, 48]);
    const b = refine(mask.slice(), w, h, [48, 48]);
    const strip = (r) => {
      const { timings, ...rest } = r;
      return JSON.stringify(rest, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
    };
    expect(strip(a)).toBe(strip(b));
  });

  it('honours option overrides (connectivity, radii, epsilon)', () => {
    const w = 96, h = 96;
    const mask = disc(w, h, 48, 48, 20);
    const r = refine(mask, w, h, [48, 48], {
      connectivity: 8, closeRadius: 1, openRadius: 1, featherRadius: 1, epsilon: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.polygon.epsilon).toBe(2);
  });

  it('benchmark: 1024x1024 typical object within the selection budget', () => {
    const w = 1024, h = 1024;
    const mask = disc(w, h, 512, 512, 250); // ~19% of frame
    refine(mask, w, h, [512, 512]); // warm up JIT (first selection in prod)
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const r = refine(mask, w, h, [512, 512]);
    const dt = now() - t0;
    expect(r.ok).toBe(true);
    expect(dt).toBeLessThan(200); // end-to-end selection budget (worker, off main thread)
    // eslint-disable-next-line no-console
    console.log(`refine 1024x1024 r=250: ${dt.toFixed(2)} ms (total field ${r.timings.total.toFixed(2)})`);
  });

  it('throws on invalid input', () => {
    expect(() => refine(null, 4, 4, [0, 0])).toThrow(TypeError);
    expect(() => refine(new Uint8Array(16), 0, 4, [0, 0])).toThrow(RangeError);
    expect(() => refine(new Uint8Array(4), 4, 4, [0, 0])).toThrow(RangeError);
  });
});

describe('worker seam (extractBestMask → refine → wire-compatible result)', () => {
  // Reproduces exactly what public/sam.worker.js does between the raw SAM output
  // and postMessage, so the integration is verified without the CDN model.
  function seam(interleaved, w, h, numMasks, best, normX, normY) {
    const single = extractBestMask(interleaved, w, h, numMasks, best);
    const seed = [Math.round(normX * w), Math.round(normY * h)];
    const refined = refine(single, w, h, seed);
    const cleanArr = refined.ok ? refined.mask : new Uint8Array(w * h);
    return {
      width: w,
      height: h,
      numMasks: 1,
      bestIndex: 0,
      score: 0.9,
      data: cleanArr,
      noSelection: !refined.ok,
    };
  }

  it('produces a single-channel result the existing drawMask can consume', () => {
    const w = 96, h = 96, numMasks = 3, best = 1;
    // interleaved SAM data: channel 1 = a filled disc, other channels = noise.
    const data = new Uint8Array(w * h * numMasks);
    const cx = 48, cy = 48, R2 = 22 * 22;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        data[numMasks * i + 0] = (x + y) & 1;             // channel 0 noise
        const inDisc = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= R2;
        data[numMasks * i + 1] = inDisc ? 1 : 0;          // channel 1 = object
        data[numMasks * i + 2] = 0;
      }
    }
    const res = seam(data, w, h, numMasks, best, 0.5, 0.5);

    expect(res.numMasks).toBe(1);
    expect(res.bestIndex).toBe(0);
    expect(res.noSelection).toBe(false);
    // drawMask indexes maskData[numMasks*i + bestIndex] === maskData[i]
    const md = res.data;
    expect(md[cy * w + cx]).toBe(1); // center selected
    expect(md[0]).toBe(0);           // far corner not selected
    // values are strictly binary (overlay compares === 1)
    for (let i = 0; i < md.length; i++) expect(md[i] === 0 || md[i] === 1).toBe(true);
  });

  it('a background/misclick seed still yields a valid or clean no-selection result', () => {
    const w = 64, h = 64, numMasks = 1, best = 0;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) data[y * w + x] = 1;
    // click far from the blob (nearest-component policy in largest-CC handles it)
    const res = seam(data, w, h, numMasks, best, 0.05, 0.05);
    // either a real single-channel mask or an all-zero no-selection — never garbage
    expect(res.numMasks).toBe(1);
    const md = res.data;
    for (let i = 0; i < md.length; i++) expect(md[i] === 0 || md[i] === 1).toBe(true);
  });
});
