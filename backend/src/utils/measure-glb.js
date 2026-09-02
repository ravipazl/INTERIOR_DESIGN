// Measure a glTF/GLB model's real-world size.
//
// Search-imported models (Sketchfab / Objaverse / image-to-3d) were all written
// to the catalog with a hard-coded `dimensions: [500, 500, 500]` placeholder.
// That is not inert: when the item is placed, the frontend SCALES the mesh to
// match its declared dimensions (see viewer3d-state-interface.js — "match the
// LARGEST of the GLB's bounding-box extents to the LARGEST of the catalog
// dimensions"). So a 2 m sofa was shrunk to 500 mm and appeared doll-sized.
//
// The importer already has the parsed document in hand when it writes that
// record, so measuring costs nothing extra.

import { getBounds } from '@gltf-transform/core'

// glTF declares model units to be METRES.
const MM_PER_UNIT = 1000

// Anything outside this range is not furniture. Scraped models are the reason:
// they are frequently authored in centimetres, inches or arbitrary units, so a
// measurement can land wildly wrong. Outside these bounds we say "unknown"
// rather than write a number we do not believe.
// These exist to catch UNIT errors, which are wrong by a factor of ~1000 (a
// model authored in centimetres reads as 205 m; one in millimetres as 2050 m).
// They are not meant to judge whether something is "furniture-sized", so the
// window is deliberately generous — a long fitted wardrobe run is legitimately
// several metres, and rejecting it would send it back to the 500 mm placeholder.
const MIN_PLAUSIBLE_MM = 20 // 2 cm — a small knob or handle
const MAX_PLAUSIBLE_MM = 8000 // 8 m — a long fitted run

/**
 * Bounding-box size of a parsed glTF document, in millimetres.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {{ widthMm:number, heightMm:number, depthMm:number, plausible:boolean } | null}
 *   null when the document has no measurable geometry.
 */
export function measureDocumentMm(doc) {
  try {
    const root = doc?.getRoot?.()
    if (!root) return null
    const scene = root.getDefaultScene?.() || root.listScenes?.()[0]
    if (!scene) return null

    const b = getBounds(scene)
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return null

    const sx = (b.max[0] - b.min[0]) * MM_PER_UNIT
    const sy = (b.max[1] - b.min[1]) * MM_PER_UNIT
    const sz = (b.max[2] - b.min[2]) * MM_PER_UNIT
    if (![sx, sy, sz].every((v) => Number.isFinite(v) && v > 0)) return null

    // X is width, Y is height (glTF is Y-up), Z is depth.
    const widthMm = Math.round(sx)
    const heightMm = Math.round(sy)
    const depthMm = Math.round(sz)

    const largest = Math.max(widthMm, heightMm, depthMm)
    const plausible =
      largest >= MIN_PLAUSIBLE_MM && largest <= MAX_PLAUSIBLE_MM

    return { widthMm, heightMm, depthMm, plausible }
  } catch (e) {
    return null
  }
}

/**
 * The `dimensions` array to store on a catalog model.
 *
 * pazl stores dimensions as [HEIGHT, WIDTH, DEPTH] in mm — the order used by
 * model-upload, the one importer that always recorded real sizes.
 *
 * Precedence: an explicit override from the import dialog, then the measured
 * size, then the legacy placeholder. The placeholder is only ever reached when
 * the model cannot be measured or measures implausibly — in which case a wrong
 * guess is no better than the old behaviour, and the user can correct it in
 * Properties.
 *
 * @param {object|null} measured   result of measureDocumentMm
 * @param {object} [override]      { widthMm, heightMm, depthMm } from the UI
 * @returns {{ dimensions:number[], source:'override'|'measured'|'placeholder' }}
 */
export function resolveDimensions(measured, override) {
  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }
  const oW = num(override?.widthMm)
  const oH = num(override?.heightMm)
  const oD = num(override?.depthMm)
  if (oW && oH && oD) {
    return { dimensions: [oH, oW, oD], source: 'override' }
  }
  if (measured && measured.plausible) {
    return {
      dimensions: [measured.heightMm, measured.widthMm, measured.depthMm],
      source: 'measured',
    }
  }
  return { dimensions: [500, 500, 500], source: 'placeholder' }
}
