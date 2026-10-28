// The default finish for a WARDROBE, shared by the upload and the scripts.
//
//   door / drawer front      → Wood 10002 (same as the kitchen shutters)
//   bar handle or knob       → Wood 10012 (same as the kitchen handles)
//   aluminium profile handle → aluminium (a plain metal colour, no texture)
//   glass                    → left as it is
//   everything else          → plain white body
//
// Why wardrobes need their own rules, measured on the 203 wardrobes uploaded:
//   • their bar handles are 300 mm long; the kitchen rule stops at 200 mm, so
//     a single-shutter wardrobe kept a white handle;
//   • the kitchen rule looks for a profile handle only when no bar was found,
//     so a fluted wardrobe with a drawer knob inside kept a white profile —
//     and one without a drawer got its aluminium profile painted wood;
//   • open units have no door, only a 218 mm drawer front, which is below the
//     kitchen's 500 mm "shutter" height, so they stayed all white.
// Changing the shared kitchen rules would move parts on cabinets already in
// use, so these live here and are used only for wardrobe categories.
//
// The rules read only the parts' sizes and positions, so the same file comes
// out the same whether it is an original export or one finished before.

import { Logger } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'
import { partRows, orderLikeThree, bakeDoc, isGlass } from './glb-wood-bake.mjs'

export const ALUMINIUM = {
  label: 'Aluminium',
  materialName: 'Handle - Aluminium',
  // Light satin grey. The 3D view has no reflection map, so a fully metallic
  // material would render near black; a little metalness keeps the sheen.
  color: [0.62, 0.64, 0.66, 1],
  metallic: 0.2,
  roughness: 0.4
}

const THIN = 25 // a door, drawer front or profile is at most this deep (mm)
const MIN_FRONT_W = 120 // narrower than this is not a door or drawer front
const DOOR_H = 500 // a door is at least this tall; a drawer front is shorter
const DRAWER_H = 100 // shorter than this is a rail or shelf edge, not a front
const BAR_THIN = 12 // a bar handle or knob is this thin on its thinnest side
const BAR_LONG = 400 // wardrobe bar handles are 300 mm; the kitchen's stop at 200
const SLIM = 60 // a profile strip is narrower than this
const ALONG = 0.4 // and runs at least this share of the door (see glb-wood-bake)

/**
 * Which parts get which finish: { shutters, handles, profiles } row indices.
 * `rows` must come from partRows() after orderLikeThree().
 */
export function detectWardrobeParts(rows) {
  const plain = rows.filter((r) => !isGlass(r))
  const isBar = (r) => {
    const s = [...r.size].sort((a, b) => a - b)
    return s[0] <= BAR_THIN && s[2] <= BAR_LONG
  }
  const bars = plain.filter(isBar)
  const boards = plain.filter((r) => !isBar(r) && r.size[2] <= THIN && r.size[0] >= MIN_FRONT_W && r.size[1] >= DRAWER_H)
  // Front = the side the fronts face (+Z for these exports, −Z for some others).
  const avgZ = [...boards, ...bars].reduce((t, r) => t + r.centre[2], 0) / ([...boards, ...bars].length || 1)
  const front = avgZ < 0 ? -1 : 1
  const z = (r) => front * r.centre[2]

  // Doors: the frontmost tall boards (a back panel is tall and thin too, but at the back).
  const tall = boards.filter((r) => r.size[1] >= DOOR_H && z(r) > 0)
  const frontZ = tall.length ? Math.max(...tall.map(z)) : null
  const doors = tall.filter((r) => z(r) >= frontZ - 5)
  // Drawer fronts: shorter boards in the front half — inside a shuttered unit
  // as well as on an open one, so every drawer matches.
  const drawers = boards.filter((r) => r.size[1] < DOOR_H && z(r) > 0)

  // Profile handles: a slim strip running along a door, in the door's plane.
  let profiles = []
  if (doors.length) {
    const doorW = Math.max(...doors.map((r) => r.size[0]))
    const doorH = Math.max(...doors.map((r) => r.size[1]))
    const taken = new Set([...doors, ...drawers, ...bars].map((r) => r.index))
    profiles = plain
      .filter((r) => !taken.has(r.index) && r.size[2] <= THIN && z(r) >= frontZ - 5)
      .filter(
        (r) =>
          (r.size[0] <= SLIM && r.size[1] >= doorH * ALONG) || // upright, beside the door
          (r.size[1] <= SLIM && r.size[0] >= doorW * ALONG) // flat, along the top
      )
  }
  const ids = (list) => list.map((r) => r.index).sort((a, b) => a - b)
  return {
    shutters: ids([...doors, ...drawers]),
    handles: ids(bars.filter((r) => z(r) > 0)),
    profiles: ids(profiles)
  }
}

/** Does this file already carry the wardrobe finish (from the upload or a script)? */
export function hasWardrobeFinish(doc) {
  return doc
    .getRoot()
    .listMaterials()
    .some((m) => m.getExtras()?.bakedFinish === ALUMINIUM.label || m.getExtras()?.wardrobeFinish === true)
}

/**
 * Finish a wardrobe doc. Returns { buffer, parts } or null when the file has
 * nothing to finish (an open unit with no drawer is only a white body).
 * Throws if the result would not match — the caller then keeps the old file.
 */
export async function finishWardrobeDoc(io, doc, images) {
  orderLikeThree(doc)
  const rows = partRows(doc)
  const parts = detectWardrobeParts(rows)
  if (!parts.shutters.length && !parts.handles.length && !parts.profiles.length) return null

  const plain = doc
    .createMaterial('default material')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0.1)
    .setRoughnessFactor(0.9)
    .setDoubleSided(true)
    .setExtras({ wardrobeFinish: true })
  const alu = doc
    .createMaterial(ALUMINIUM.materialName)
    .setBaseColorFactor(ALUMINIUM.color)
    .setMetallicFactor(ALUMINIUM.metallic)
    .setRoughnessFactor(ALUMINIUM.roughness)
    .setDoubleSided(true)
    .setExtras({ bakedFinish: ALUMINIUM.label })
  const wood = new Set([...parts.shutters, ...parts.handles])
  const profiles = new Set(parts.profiles)
  rows.forEach((r, i) => {
    if (isGlass(r)) return
    if (profiles.has(i)) r.prim.setMaterial(alu)
    else if (!wood.has(i)) r.prim.setMaterial(plain)
  })

  const out = await bakeDoc(io, doc, { shutters: parts.shutters, handles: parts.handles }, images)

  // Drop the materials and textures nothing uses any more, then check the
  // profiles really carry the aluminium.
  const finished = await io.readBinary(out)
  // Quiet: prune would print a line per file, burying a script's report.
  finished.setLogger(new Logger(Logger.Verbosity.WARN))
  await finished.transform(prune())
  const check = partRows(finished)
  for (const i of parts.profiles) {
    if (check[i]?.prim.getMaterial()?.getName() !== ALUMINIUM.materialName) {
      throw new Error(`aluminium not applied to Mesh_${i}`)
    }
  }
  return { buffer: Buffer.from(await io.writeBinary(finished)), parts }
}
