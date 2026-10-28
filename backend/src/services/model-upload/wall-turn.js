// Turn a wall-mounted model so its long side runs ALONG the wall.
//
// The engine hangs a wall item with its X axis along the wall and its Z axis
// pointing into the room. A model exported the other way round (an AC whose
// 780 mm length is on Z) hangs with its narrow end on the wall and its body
// sticking straight out into the room, and had to be turned by hand every time.
//
// Doing it here, once, in the file itself means every "+ Add", drop and copy
// gets it right with no change to the engine. The turn is -90° about the
// vertical axis, the same turn the Rotate button gives such a model by hand.
//
// Only a clear case is turned: depth at least 1.5 × width. A kitchen wall
// cabinet (300 wide, 350 deep) is nowhere near that, and cabinets are skipped
// by the caller anyway. Any failure leaves the file exactly as it arrived.

import { getBounds } from '@gltf-transform/core'
import { createIO } from '../../../scripts/lib/glb-wood-bake.mjs'

const MIN_DEPTH_TO_WIDTH = 1.5
// -90° about Y: x' = -z, z' = x.
const TURN = [0, -Math.SQRT1_2, 0, Math.SQRT1_2]

/**
 * @returns {Promise<{buffer: Buffer, turned: boolean, reason?: string}>}
 */
export async function turnAlongWall(buffer) {
  try {
    const io = await createIO()
    const doc = await io.readBinary(new Uint8Array(buffer))
    const root = doc.getRoot()
    const scene = root.getDefaultScene() || root.listScenes()[0]
    if (!scene) return { buffer, turned: false, reason: 'no scene' }

    const b = getBounds(scene)
    const width = b.max[0] - b.min[0]
    const depth = b.max[2] - b.min[2]
    if (!(width > 0 && depth > 0)) return { buffer, turned: false, reason: 'empty bounds' }
    if (depth < width * MIN_DEPTH_TO_WIDTH) {
      return { buffer, turned: false, reason: 'already wider than deep' }
    }

    // Wrap the scene's top nodes in one turned node, so nothing inside —
    // names, materials, mesh order — changes.
    const turn = doc.createNode('wall_turn').setRotation(TURN)
    for (const child of scene.listChildren()) {
      scene.removeChild(child)
      turn.addChild(child)
    }
    scene.addChild(turn)

    const out = await io.writeBinary(doc)
    return { buffer: Buffer.from(out), turned: true }
  } catch (e) {
    return { buffer, turned: false, reason: `error: ${e && e.message}` }
  }
}
