// Shared steps for baking a wood finish INTO a cabinet GLB, so the item loads
// already coloured and the app never applies a texture at load time.
//
// The same approach as scripts/tall-units-bake-finish.mjs (verified there in
// three.js 0.118): world-scale box UVs, one material per finish marked with
// `extras.bakedTexture` (the app compares it with the saved finish and skips the
// repaint), and every mesh wrapped in its own empty group so the app's part
// numbering (Mesh_0…N, in load order) cannot change.

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { createRequire } from 'module'
import path from 'path'
import { GLB_DIR, WOOD_DIR, BACKUP_ROOT } from './env.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const draco3d = require('draco3d')

// Folders come from lib/env.mjs (GLB_STORAGE_DIR etc.), so the same scripts run
// on a local PC and on the live server.
export { GLB_DIR, WOOD_DIR, BACKUP_ROOT }

export const WOOD = {
  shutter: {
    label: 'Wood 10002',
    image: '10002.jpg',
    // Same path as the finishing's texture.fileUrl (see the extras marker).
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg',
    maxEdge: 1024, // big visible panel — keep full detail
    tileM: 2.1, // one image covers a whole door → no repeat seam
    materialName: 'Shutter - Wood 10002'
  },
  handle: {
    label: 'Wood 10012',
    image: '10012.jpg',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg',
    maxEdge: 256, // tiny part — a small image is plenty
    tileM: 0.35,
    materialName: 'Handle - Wood 10012'
  }
}

export async function createIO() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })
}

export async function loadWoodImage(part) {
  return sharp(path.join(WOOD_DIR, part.image))
    .resize({ width: part.maxEdge, height: part.maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
}

function transformPoint(m, p) {
  return [0, 1, 2].map((a) => m[a] * p[0] + m[4 + a] * p[1] + m[8 + a] * p[2] + m[12 + a])
}

function transformDir(m, d) {
  return [0, 1, 2].map((a) => m[a] * d[0] + m[4 + a] * d[1] + m[8 + a] * d[2])
}

/**
 * One row per PRIMITIVE, depth-first — the order three.js creates meshes and
 * the app names them Mesh_0…N. Box in millimetres.
 */
export function partRows(doc) {
  const rows = []
  const walk = (node) => {
    const mesh = node.getMesh()
    if (mesh) {
      const w = node.getWorldMatrix()
      for (const prim of mesh.listPrimitives()) {
        const min = [Infinity, Infinity, Infinity]
        const max = [-Infinity, -Infinity, -Infinity]
        const pos = prim.getAttribute('POSITION')
        // MEASURE THE VERTICES THIS PART ACTUALLY USES.
        //
        // Walking the whole POSITION accessor is right only while each part has
        // an accessor of its own. Some exporters give every mesh in the file ONE
        // shared vertex buffer and let each primitive pick its faces out of it
        // with its own indices — an 11-part tall unit arriving as 11 KB rather
        // than 70 KB. Measured by the accessor, all eleven parts then came back
        // the size of the whole cabinet (400 x 2080 x 630), so no part looked
        // like a thin door or a small handle, detectByShape found nothing, and
        // the upload was stored with the exporter's grey still on it.
        //
        // Reading through the indices costs nothing on a normal export — there
        // the indices reach every vertex of the accessor anyway, so every part
        // measures exactly as it did before and the baked catalogue is
        // untouched.
        const idx = prim.getIndices()
        const count = idx ? idx.getCount() : pos.getCount()
        for (let i = 0; i < count; i++) {
          const v = idx ? idx.getScalar(i) : i
          const p = transformPoint(w, pos.getElement(v, []))
          for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], p[a])
            max[a] = Math.max(max[a], p[a])
          }
        }
        rows.push({
          index: rows.length,
          node,
          prim,
          name: node.getName() || '',
          size: max.map((v, a) => Math.round((v - min[a]) * 1000)),
          centre: max.map((v, a) => Math.round(((v + min[a]) / 2) * 1000))
        })
      }
    }
    node.listChildren().forEach(walk)
  }
  doc.getRoot().listScenes().forEach((s) => s.listChildren().forEach(walk))
  return rows
}

/**
 * Parts that already carry a baked wood finish (a file baked earlier, e.g.
 * copied from another machine): { shutters, handles } row indices, or null when
 * the file has no baked finish. Such a file must not be treated as an original.
 */
export function bakedParts(doc) {
  const rows = partRows(doc)
  const pick = (label) =>
    rows
      .filter((r) => r.prim.getMaterial()?.getExtras()?.bakedFinish === label)
      .map((r) => r.index)
  const shutters = pick(WOOD.shutter.label)
  const handles = pick(WOOD.handle.label)
  return shutters.length || handles.length ? { shutters, handles } : null
}

export function signature(doc) {
  return partRows(doc)
    .map((r) => r.size.join('x'))
    .join('|')
}

/** Box-projected UVs in real metres; V follows height on vertical faces. */
function writeWorldUVs(doc, node, prim, tileM) {
  const w = node.getWorldMatrix()
  const pos = prim.getAttribute('POSITION')
  const nor = prim.getAttribute('NORMAL')
  const uv = new Float32Array(pos.getCount() * 2)
  for (let i = 0; i < pos.getCount(); i++) {
    const p = transformPoint(w, pos.getElement(i, []))
    const n = nor ? transformDir(w, nor.getElement(i, [])) : [0, 0, 1]
    const ax = Math.abs(n[0])
    const ay = Math.abs(n[1])
    const az = Math.abs(n[2])
    let u
    let v
    if (az >= ax && az >= ay) {
      u = p[0]
      v = -p[1]
    } else if (ax >= ay) {
      u = p[2]
      v = -p[1]
    } else {
      u = p[0]
      v = p[2]
    }
    uv[i * 2] = u / tileM
    uv[i * 2 + 1] = v / tileM
  }
  const buffer = doc.getRoot().listBuffers()[0]
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
}

/**
 * Reorder siblings the way three.js (0.118 GLTFLoader) ADDS them: a node joins
 * its parent only once it has loaded, and an empty node (no mesh) loads before
 * any node with a mesh. So in the ORIGINAL file an empty group of meshes (e.g. a
 * sink + tap) lands before its mesh siblings, whatever the file order says.
 * Putting empty nodes first (each group keeping its own order) makes the file
 * order equal the app's part numbering. Call this BEFORE picking parts by index.
 */
export function orderLikeThree(doc) {
  const reorder = (parent) => {
    const kids = parent.listChildren()
    const empty = kids.filter((k) => !k.getMesh())
    const withMesh = kids.filter((k) => k.getMesh())
    kids.forEach((k) => parent.removeChild(k))
    ;[...empty, ...withMesh].forEach((k) => parent.addChild(k))
    kids.forEach((k) => reorder(k))
  }
  doc.getRoot().listScenes().forEach((scene) => reorder(scene))
}

/** Wrap every mesh node in an empty group so load order = file order (see file header). */
export function keepLoadOrder(doc) {
  const wrapChildren = (parent) => {
    const kids = parent.listChildren()
    kids.forEach((k) => parent.removeChild(k))
    for (const k of kids) {
      if (k.getMesh()) {
        const group = doc.createNode(`${k.getName() || 'part'}_group`)
        group.addChild(k)
        parent.addChild(group)
      } else {
        parent.addChild(k)
      }
      wrapChildren(k)
    }
  }
  doc.getRoot().listScenes().forEach((scene) => wrapChildren(scene))
}

/**
 * Apply the wood to the chosen parts (row indices) of an already-read doc.
 * Returns the new GLB bytes, verified: same parts in the same order and the
 * materials really applied — otherwise throws and nothing should be written.
 */
export async function bakeDoc(io, doc, { shutters, handles }, images) {
  const before = signature(doc)
  const rows = partRows(doc)
  const base = rows[0]?.prim.getMaterial() || null
  const make = (part, image) => {
    const tex = doc.createTexture(part.label).setImage(image).setMimeType('image/jpeg')
    return doc
      .createMaterial(part.materialName)
      .setBaseColorFactor([1, 1, 1, 1])
      .setBaseColorTexture(tex)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.75)
      .setDoubleSided(base ? base.getDoubleSided() : true)
      .setExtras({ bakedFinish: part.label, bakedTexture: part.fileUrl })
  }
  const jobs = [
    [shutters, shutters.length ? make(WOOD.shutter, images.shutter) : null, WOOD.shutter],
    [handles, handles.length ? make(WOOD.handle, images.handle) : null, WOOD.handle]
  ]
  for (const [indices, material, part] of jobs) {
    for (const i of indices) {
      const row = rows[i]
      // A mesh used by more than one node would be recoloured everywhere and
      // its UVs computed for one placement only — give this node its own copy.
      const mesh = row.node.getMesh()
      if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) {
        row.node.setMesh(mesh.clone())
      }
    }
  }
  // Re-read rows after any clone so every row points at its node's own mesh.
  const fresh = partRows(doc)
  for (const [indices, material, part] of jobs) {
    for (const i of indices) {
      const { node, prim } = fresh[i]
      writeWorldUVs(doc, node, prim, part.tileM)
      prim.setMaterial(material)
    }
  }
  keepLoadOrder(doc)
  // Draco-compressed input is written back uncompressed (no encoder needed).
  doc
    .getRoot()
    .listExtensionsUsed()
    .filter((e) => e.extensionName === 'KHR_draco_mesh_compression')
    .forEach((e) => e.dispose())
  const out = await io.writeBinary(doc)

  const check = await io.readBinary(out)
  if (signature(check) !== before) throw new Error('part order/size changed')
  const checkRows = partRows(check)
  for (const [indices, , part] of jobs) {
    for (const i of indices) {
      if (checkRows[i].prim.getMaterial()?.getName() !== part.materialName) {
        throw new Error(`material not applied to Mesh_${i}`)
      }
    }
  }
  return out
}

// WHICH PARTS GET THE WOOD.
//
// Shared by the bake script and by the upload service, so an uploaded GLB is
// finished by exactly the same rules as one baked from the command line — two
// copies of this would drift, and a cabinet would then look different
// depending on how its wood was applied.

/** A part whose material already gives it its own look (texture, colour, glass…). */
export function hasOwnLook(row) {
  const mat = row.prim.getMaterial()
  if (!mat) return false
  const white = mat.getBaseColorFactor().slice(0, 3).every((v) => v > 0.98)
  // "default material.001" / ".002" are the duplicate names an export writes
  // when the same plain material is copied — still a plain material, so a
  // cabinet using them must not be skipped as "already has its own look".
  const plainName = /^(default material(\.\d+)?)?$/i.test(mat.getName() || '')
  return !!mat.getBaseColorTexture() || !white || !plainName
}

export function detectByName(rows, eligible = (r) => !hasOwnLook(r)) {
  const plain = rows.filter(eligible)
  const shutters = plain.filter((r) => /shutter/i.test(r.name)).map((r) => r.index)
  const handles = plain.filter((r) => /handle/i.test(r.name)).map((r) => r.index)
  return { shutters, handles }
}

/**
 * A part that must never be painted over: glass.
 *
 * Wood on a glass front is simply wrong, and unlike a wooden texture it is not
 * a matter of taste — so this holds even where a caller has asked to override
 * whatever the file shipped with.
 */
export function isGlass(row) {
  const mat = row.prim.getMaterial()
  if (!mat) return false
  if (mat.getAlphaMode && mat.getAlphaMode() === 'BLEND') return true
  if (mat.getBaseColorFactor && mat.getBaseColorFactor()[3] < 0.95) return true
  return /glass/i.test(mat.getName() || '')
}

/**
 * `eligible` decides which parts may take the wood, and is the ONLY difference
 * between the two callers. The bake script leaves anything that already has its
 * own look alone (the default). An upload passes a looser test, because a
 * cabinet exported from Blender with its textures baked in has a "look" that is
 * simply the exporter's, not a finish anyone chose — and the whole point of the
 * upload step is that a new cabinet arrives in the house colours.
 */
export function detectByShape(rows, modelName = '', eligible = (r) => !hasOwnLook(r)) {
  const plain = rows.filter(eligible)
  const handleRows = plain.filter((r) => {
    const s = [...r.size].sort((a, b) => a - b)
    // A handle is a VERY thin bar: 12 mm on its thinnest side does nearly all
    // the work here — a shutter is 18, a side panel more. The length limit was
    // 120 mm, which quietly missed longer bar handles (a 10 x 160 x 30 handle
    // on a tall unit kept the exporter's colour while its door was finished).
    // 200 mm covers the long bars without reaching anything else: every other
    // part of a cabinet is thicker than 12 mm.
    return s[0] <= 12 && s[2] <= 200
  })
  // Front = the side the handles sit on (+Z for most files, −Z for some).
  const avgHandleZ = handleRows.reduce((t, r) => t + r.centre[2], 0) / (handleRows.length || 1)
  const front = avgHandleZ < 0 ? -1 : 1
  // ≥ 120 mm wide, not 200: a 150 mm oil pull-out has a real shutter too.
  // Still a thin (≤ 25 mm), tall (≥ 500 mm) board, so side panels and
  // worktops — which are deep, not thin-and-tall — are still excluded.
  const boards = plain.filter((r) => r.size[2] <= 25 && r.size[0] >= 120 && r.size[1] >= 500)
  const frontZ = Math.max(...boards.map((r) => front * r.centre[2]))
  // The frontmost board(s). A back panel is also thin but sits at the back.
  let shutters = boards
    .filter((r) => front * r.centre[2] >= frontZ - 5 && front * r.centre[2] > 0)
    .map((r) => r.index)
  if (!shutters.length && /corner/i.test(modelName)) {
    // L-shaped corner door: tall (≥ 500 mm), not a handle, not the body.
    const volume = (r) => r.size[0] * r.size[1] * r.size[2]
    const handleIdx = new Set(handleRows.map((r) => r.index))
    const others = plain.filter((r) => !handleIdx.has(r.index))
    const body = others.reduce((a, r) => (!a || volume(r) > volume(a) ? r : a), null)
    shutters = others.filter((r) => r !== body && r.size[1] >= 500).map((r) => r.index)
  }
  return { shutters, handles: handleRows.map((r) => r.index) }
}
