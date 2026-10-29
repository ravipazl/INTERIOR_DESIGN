// The default finish for the Living Room's TV wall, shared by the upload and
// the scripts:
//
//   TV drawer unit   drawer front → Wood 10002, bar handles → Wood 10012,
//                    body and top → plain white
//   TV back panel    the whole panel → Wood 10002
//   wall cladding    the whole slat → Wood 10002
//
// The TV drawer unit is a cabinet whose only front is a 327 mm drawer front,
// below the kitchen's 500 mm "shutter" height — the wardrobe rules already
// read it right (front, 96 mm bar handles), so it uses them. A back panel or a
// cladding slat is one flat board with nothing else on it, so all of it takes
// the wood.

import { Logger } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'
import { partRows, orderLikeThree, bakeDoc, isGlass } from './glb-wood-bake.mjs'
import { finishWardrobeDoc } from './wardrobe-finish.mjs'

// One wood image covers this much (metres): a 2438 mm cladding slat fits in
// one, with no repeat seam across it.
const PANEL_TILE_M = 2.5

export const LIVING_RULES = {
  // Category name (matched loosely, at any level above the model) → rule.
  'TV Draw Unit': 'cabinet',
  'Tv back panel': 'panel',
  'wall cladding': 'panel'
}

/** Whole item in Wood 10002. Returns { buffer, parts } or null (nothing to finish). */
export async function finishPanelDoc(io, doc, images) {
  orderLikeThree(doc)
  const rows = partRows(doc)
  const shutters = rows.filter((r) => !isGlass(r)).map((r) => r.index)
  if (!shutters.length) return null
  const out = await bakeDoc(io, doc, { shutters, handles: [] }, images, { shutter: PANEL_TILE_M })
  const finished = await io.readBinary(out)
  finished.setLogger(new Logger(Logger.Verbosity.WARN))
  await finished.transform(prune())
  return { buffer: Buffer.from(await io.writeBinary(finished)), parts: { shutters, handles: [], profiles: [] } }
}

/** Finish a doc by its rule ('cabinet' or 'panel'). Same contract as above. */
export function finishLivingDoc(rule, io, doc, images) {
  return rule === 'panel' ? finishPanelDoc(io, doc, images) : finishWardrobeDoc(io, doc, images)
}
