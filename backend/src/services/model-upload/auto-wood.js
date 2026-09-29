// Put the default shutter and handle wood into a cabinet GLB as it is uploaded.
//
// The same finish the bake script applies (Shutter - Wood 10002, Handle - Wood
// 10012), applied by exactly the same rules — the detection and the baking both
// come from scripts/lib/glb-wood-bake.mjs, so a cabinet looks the same whether
// its wood was applied here or from the command line.
//
// Why at upload: the script can only finish the models that exist when it runs,
// so every GLB added afterwards renders white until someone remembers to run it
// again. Doing it here means there is nothing to remember.
//
// Nothing about this is required for an upload to succeed. Every failure — a
// file that will not parse, a missing wood image, a category that cannot be
// read — leaves the uploaded file exactly as it arrived and logs why.

import { prune } from '@gltf-transform/functions'
import {
  createIO,
  loadWoodImage,
  partRows,
  orderLikeThree,
  bakeDoc,
  bakedParts,
  detectByName,
  detectByShape,
  isGlass,
  WOOD
} from '../../../scripts/lib/glb-wood-bake.mjs'

/**
 * The top-level categories whose models get the default wood.
 *
 * Matched against EVERY category from the model's own one up to the root, so a
 * model in KITCHEN > Wall Unit > Solid Shutters > Handle is covered by "Wall
 * Unit" without naming each leaf. Names are matched loosely (case, spaces and
 * punctuation ignored) because the same unit is called "Tall Unit" on one
 * server and "Tall Units" on another.
 */
const WOOD_CATEGORIES = [
  'Below Counter Storage',
  'Storage Unit',
  'Base Unit',
  'Sink Unit',
  'Corner Unit',
  'Oil pullout',
  'Tall Units',
  'Wall Unit',
  'Above Counter Storage',
  'Wardrobe',
  'Single Wardrobe',
  'Double Wardrobe'
]

// Models the bake script leaves alone by name, mirrored here so both paths
// agree: a "handle colour" model ships with its own colours already.
const SKIP_NAMES = [/handle colour/i]

const loosely = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
const WANTED = new Set(WOOD_CATEGORIES.map(loosely))

/**
 * Is this category — or any category above it — one that gets the wood?
 * Returns the matching category's name, or null. Never throws.
 */
export const woodCategoryFor = async (app, categoryId) => {
  let id = categoryId
  // A category tree is a handful of levels; the cap is only so a cycle in the
  // data cannot spin here forever.
  for (let depth = 0; depth < 12 && id; depth += 1) {
    let cat
    try {
      cat = await app.service('categories').get(id)
    } catch (e) {
      return null
    }
    if (!cat) return null
    if (WANTED.has(loosely(cat.name))) return cat.name
    id = cat.parentCategoryId
  }
  return null
}

/**
 * Everything that is not the door, the handle or glass becomes plain white.
 *
 * A cabinet is a white carcass with a wood front. Exported from Blender with
 * its textures baked in, a tall unit arrives with its sides, shelves and back
 * carrying a dark wood — 13 images and 2.8 MB — while the base units, exported
 * plain, weigh 72 KB. Applying the wood alone left the two looking nothing
 * alike, because the difference was never the finish; it was everything around
 * it. This makes an uploaded cabinet look the same whichever way it was
 * exported, and the discarded textures take the file size with them.
 *
 * Matches the material the plain exports already use, down to its values:
 * name "default material", doubleSided, metallic 0.1, roughness 0.9.
 */
const plainCarcass = (doc, rows, keep) => {
  const plain = doc
    .createMaterial('default material')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0.1)
    .setRoughnessFactor(0.9)
    .setDoubleSided(true)
  let changed = 0
  rows.forEach((row, i) => {
    if (keep.has(i)) return
    const had = row.prim.getMaterial()
    if (had === plain) return
    row.prim.setMaterial(plain)
    changed += 1
  })
  return changed
}

/**
 * Return the GLB with the wood baked in, or null to leave it as it is.
 *
 * null means "nothing to do", not "something went wrong": a file already
 * carrying this finish is left alone, and so is one with no shutter or handle
 * to find — an open shelf, say.
 */
export const bakeWood = async (buffer, modelName = '') => {
  if (SKIP_NAMES.some((re) => re.test(modelName))) return null

  const io = await createIO()
  const doc = await io.readBinary(new Uint8Array(buffer))

  // Already finished, by this or by the script: leave it.
  if (bakedParts(doc)) return null

  // Part numbers must follow three.js's order, the same as the script, or the
  // wood would land on a different mesh than the one that was measured.
  orderLikeThree(doc)
  const rows = partRows(doc)
  const named = rows.some((r) => /shutter|handle/i.test(r.name))
  // A NEW CABINET ARRIVES IN THE HOUSE COLOURS, whatever the file shipped with.
  //
  // The bake script skips any part that already carries a texture, so it can
  // never paint over a finish somebody chose. That is right for a catalogue
  // already in use, and wrong here: a cabinet exported from Blender with its
  // textures baked in — 11 images and 2.8 MB for one tall unit — has a "look"
  // that is the exporter's, not a decision, and it arrived looking nothing like
  // the rest of the catalogue. So an upload only protects GLASS, which wood
  // would plainly ruin.
  const eligible = (r) => !isGlass(r)
  // The name reaches detectByShape for its corner-door case: an L-shaped
  // corner front is not the thin flat board the usual rule looks for.
  const parts = named
    ? detectByName(rows, eligible)
    : detectByShape(rows, modelName, eligible)
  if (!parts.shutters.length && !parts.handles.length) return null

  // Keep the parts that get the wood, and the glass; everything else goes
  // plain white — see plainCarcass.
  const keep = new Set([...parts.shutters, ...parts.handles])
  rows.forEach((r, i) => { if (isGlass(r)) keep.add(i) })
  const stripped = plainCarcass(doc, rows, keep)

  const images = {
    shutter: await loadWoodImage(WOOD.shutter),
    handle: await loadWoodImage(WOOD.handle)
  }
  const out = await bakeDoc(io, doc, parts, images)
  if (!stripped) return Buffer.from(out)

  // Drop what nothing points at any more — AFTER the wood is on, not before.
  // The door and the handle still carried the exporter's materials up to that
  // moment, so pruning earlier kept them, and their textures with them: the
  // difference between a 138 KB file and a 75 KB one.
  const finished = await io.readBinary(out)
  await finished.transform(prune())
  return Buffer.from(await io.writeBinary(finished))
}

/**
 * The whole step, for the upload route: decide, bake, and say what happened.
 * Always returns a buffer — the original one whenever the wood is not applied.
 */
export const applyDefaultWood = async (app, buffer, categoryId, modelName = '') => {
  let category = null
  try {
    category = await woodCategoryFor(app, categoryId)
    if (!category) return { buffer, applied: false, reason: 'category not a cabinet' }
    const baked = await bakeWood(buffer, modelName)
    if (!baked) return { buffer, applied: false, reason: 'no plain shutter or handle to finish', category }
    return { buffer: baked, applied: true, category, bytes: [buffer.length, baked.length] }
  } catch (e) {
    // An upload must never fail because of this.
    console.error('model-upload ~ default wood not applied:', e && e.message)
    return { buffer, applied: false, reason: `error: ${e && e.message}`, category }
  }
}
