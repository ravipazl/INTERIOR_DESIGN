// Shared steps for baking a wood finish INTO a cabinet GLB, so the item loads
// already coloured and the app never applies a texture at load time.
//
// The same approach as scripts/bake-tall-unit-wood.mjs (verified there in
// three.js 0.118): world-scale box UVs, one material per finish marked with
// `extras.bakedTexture` (the app compares it with the saved finish and skips the
// repaint), and every mesh wrapped in its own empty group so the app's part
// numbering (Mesh_0…N, in load order) cannot change.

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { createRequire } from 'module'
import path from 'path'
import url from 'url'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const draco3d = require('draco3d')

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
export const FRONTEND_PUBLIC = path.resolve(__dirname, '../../../frontend/public')
export const GLB_DIR = path.join(FRONTEND_PUBLIC, 'assets/models/glb')
const WOOD_DIR = path.join(FRONTEND_PUBLIC, 'assets/rooms/textures/library/wooden_grains')

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
        for (let i = 0; i < pos.getCount(); i++) {
          const p = transformPoint(w, pos.getElement(i, []))
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
