// Bake the shutter + handle wood finish INTO the tall unit GLB files, so the
// item loads already coloured (no texture is applied at load time).
//
//   shutter → Wood 10002   handle → Wood 10012
//
// Safe to re-run: the ORIGINAL file is copied to BACKUP_DIR once, and every run
// bakes from that original — never from an already-baked file.
//
//   node scripts/tall-units-bake-finish.mjs            bake
//   node scripts/tall-units-bake-finish.mjs --dry-run  check only, write nothing
//   node scripts/tall-units-bake-finish.mjs --restore  put the originals back
//
// Parts are found by SHAPE, not by name: inside these files the node names are
// out of order (file "Mesh_4" is the app's Mesh_5), so names are unreliable.
//   shutter = tall thin panel (> 1.5 m high, ≤ 25 mm thick) at the FRONT
//   handle  = the smallest part
// A file is skipped (left untouched) if its shape does not match that pattern.
// A file that is ALREADY baked (e.g. copied from another machine) is left as it
// is and never saved as an "original".
// Which files: every model in the catalogue category "Tall Units", looked up in
// THIS machine's database — file names differ between machines (they start
// with an id made at upload), so they are never hard-coded. A model whose file
// already has its own colours / textures is skipped.
// Writes baked-parts.last-run.json (baked-parts.dry-run.json for --dry-run):
// model file → part numbers, used by record-baked-finish.mjs.
// Folders and database come from lib/env.mjs (the backend .env).

import { GLB_DIR, WOOD_DIR, BACKUP_ROOT } from './lib/env.mjs'
import { MongoClient } from 'mongodb'
import config from 'config'
import { createIO } from './lib/glb-wood-bake.mjs'
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const BACKUP_DIR = path.join(BACKUP_ROOT, 'glb-original-tall-units')
const CATEGORY_NAME = 'Tall Units'
const LAST_RUN = path.join(BACKUP_DIR, 'baked-parts.last-run.json')
const DRY_RUN_LIST = path.join(BACKUP_DIR, 'baked-parts.dry-run.json')

/** The models of the "Tall Units" category: [{ modelId, name, file }]. */
async function tallUnitModels() {
  const client = await MongoClient.connect(process.env.MONGODB_URL || config.get('mongodb'))
  try {
    const db = client.db()
    const cat = await db.collection('categories').findOne({ name: CATEGORY_NAME })
    if (!cat) throw new Error(`category "${CATEGORY_NAME}" not found`)
    const models = await db
      .collection('models')
      // categoryId is stored as a string here; accept an ObjectId too.
      .find({ categoryId: { $in: [String(cat._id), cat._id] } })
      .project({ name: 1, modelFileUrl: 1 })
      .toArray()
    return models
      .map((m) => ({
        modelId: String(m._id),
        name: String(m.name || '').trim(),
        file: String(m.modelFileUrl || '').split('/').pop()
      }))
      .filter((m) => m.file.endsWith('.glb'))
  } finally {
    await client.close()
  }
}

/** A file whose parts already carry their own colours / textures (not ours). */
function hasOwnColours(doc) {
  return doc
    .getRoot()
    .listMeshes()
    .some((mesh) =>
      mesh.listPrimitives().some((p) => {
        const mat = p.getMaterial()
        if (!mat || mat.getExtras()?.bakedFinish) return false
        const white = mat.getBaseColorFactor().slice(0, 3).every((v) => v > 0.98)
        return !!mat.getBaseColorTexture() || !white
      })
    )
}

const PARTS = {
  shutter: {
    label: 'Wood 10002',
    image: '10002.jpg',
    // Same path as the finishing's texture.fileUrl — the app compares the two
    // to know the finish is already in the file and skip repainting it.
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg',
    maxEdge: 1024, // big visible panel — keep full detail
    tileM: 2.1 // one image ≈ the whole door height → no repeat seam on the shutter
  },
  handle: {
    label: 'Wood 10012',
    image: '10012.jpg',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg',
    maxEdge: 256, // tiny part — a small image is plenty and keeps the file light
    tileM: 0.35
  }
}

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const RESTORE = args.includes('--restore')

// Reads every GLB format (incl. Draco-compressed files, e.g. Kitchen Tall Unit),
// so such a file is checked and skipped instead of failing to open.
const io = await createIO()

/** Mesh nodes in depth-first order — the same order three.js names Mesh_0…N. */
function meshNodesInOrder(doc) {
  const out = []
  const walk = (n) => {
    if (n.getMesh()) out.push(n)
    n.listChildren().forEach(walk)
  }
  doc.getRoot().listScenes().forEach((s) => s.listChildren().forEach(walk))
  return out
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  ]
}

function transformDir(m, d) {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2]
  ]
}

/** World-space box (metres) of one mesh node. */
function nodeBox(node) {
  const w = node.getWorldMatrix()
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    for (let i = 0; i < pos.getCount(); i++) {
      const p = transformPoint(w, pos.getElement(i, []))
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p[a])
        max[a] = Math.max(max[a], p[a])
      }
    }
  }
  const size = max.map((v, a) => v - min[a])
  const centre = max.map((v, a) => (v + min[a]) / 2)
  return { size, centre }
}

/** Shape-based part detection; returns null when the file doesn't fit. */
function findParts(nodes) {
  const boxes = nodes.map((n, i) => ({ i, node: n, ...nodeBox(n) }))
  const tallPanels = boxes.filter(
    (b) => b.size[1] > 1.5 && Math.min(...b.size) <= 0.025
  )
  if (tallPanels.length < 2) return null
  // FRONT = the panel furthest along +Z (the back panel sits at −Z).
  const shutter = [...tallPanels].sort((a, b) => b.centre[2] - a.centre[2])[0]
  const vol = (b) => b.size[0] * b.size[1] * b.size[2]
  const handle = [...boxes].sort((a, b) => vol(a) - vol(b))[0]
  if (shutter.i === handle.i) return null
  // The handle must sit on the front of the shutter.
  if (handle.centre[2] < shutter.centre[2]) return null
  return { shutter, handle }
}

/**
 * Box-projected UVs in real-world metres, so the grain has the same scale on
 * every face and never stretches. Grain in both wood images runs top→bottom,
 * so V always follows height (Y) on the vertical faces.
 */
function writeWorldUVs(doc, node, tileM) {
  const w = node.getWorldMatrix()
  for (const prim of node.getMesh().listPrimitives()) {
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
        v = -p[1] // front/back face: across = X, along grain = height
      } else if (ax >= ay) {
        u = p[2]
        v = -p[1] // side face: across = depth, along grain = height
      } else {
        u = p[0]
        v = p[2] // top/bottom edge
      }
      uv[i * 2] = u / tileM
      uv[i * 2 + 1] = v / tileM
    }
    const buffer = doc.getRoot().listBuffers()[0]
    const acc = doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer)
    prim.setAttribute('TEXCOORD_0', acc)
  }
}

async function loadImage(part) {
  const src = path.join(WOOD_DIR, part.image)
  return sharp(src)
    .resize({ width: part.maxEdge, height: part.maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
}

function woodMaterial(doc, base, name, texture, part) {
  const mat = doc
    .createMaterial(name)
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(texture)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.75)
    .setDoubleSided(base ? base.getDoubleSided() : true)
    // three.js copies extras into material.userData on load.
    .setExtras({ bakedFinish: part.label, bakedTexture: part.fileUrl })
  return mat
}

/**
 * The app names parts Mesh_0…N in the order three.js ADDS them to the scene.
 * three.js (0.118 GLTFLoader) adds a node only once its mesh + material have
 * loaded, so a part with an image texture lands LAST — the shutter would turn
 * from Mesh_5 into Mesh_10 and no longer match its saved component row.
 *
 * Wrapping every mesh in its own empty group fixes the order: empty groups all
 * load at the same instant, so they are added in file order, and each holds a
 * single mesh, so a depth-first walk still meets the meshes in file order no
 * matter when each one finishes loading. World positions are unchanged (the
 * group has no transform).
 */
function keepLoadOrder(doc) {
  const wrap = (parent) => {
    const kids = parent.listChildren()
    if (!kids.some((k) => k.getMesh())) {
      kids.forEach((k) => wrap(k))
      return
    }
    kids.forEach((k) => parent.removeChild(k))
    for (const k of kids) {
      if (k.getMesh()) {
        const group = doc.createNode(`${k.getName() || 'part'}_group`)
        group.addChild(k)
        parent.addChild(group)
      } else {
        wrap(k)
        parent.addChild(k)
      }
    }
  }
  doc.getRoot().listScenes().forEach((scene) => {
    const top = scene.listChildren()
    if (top.some((k) => k.getMesh())) {
      top.forEach((k) => scene.removeChild(k))
      for (const k of top) {
        if (k.getMesh()) {
          const group = doc.createNode(`${k.getName() || 'part'}_group`)
          group.addChild(k)
          scene.addChild(group)
        } else {
          wrap(k)
          scene.addChild(k)
        }
      }
    } else {
      top.forEach((k) => wrap(k))
    }
  })
}

function signature(nodes) {
  return nodes
    .map((n) => nodeBox(n).size.map((v) => Math.round(v * 1000)).join('x'))
    .join('|')
}

async function bakeOne(file, images) {
  const live = path.join(GLB_DIR, file)
  const backup = path.join(BACKUP_DIR, file)
  if (!fs.existsSync(live) && !fs.existsSync(backup)) {
    return { file, status: 'MISSING' }
  }
  if (!fs.existsSync(backup)) {
    // No original kept yet: make sure the live file IS an original.
    const current = await io.read(live)
    const currentNodes = meshNodesInOrder(current)
    const partWith = (label) =>
      currentNodes.findIndex((n) =>
        n.getMesh().listPrimitives().some((p) => p.getMaterial()?.getExtras()?.bakedFinish === label)
      )
    const shutterAt = partWith(PARTS.shutter.label)
    const handleAt = partWith(PARTS.handle.label)
    if (shutterAt !== -1 || handleAt !== -1) {
      return {
        file,
        status: 'ALREADY BAKED (left as it is)',
        ...(shutterAt !== -1 && handleAt !== -1
          ? { shutter: `Mesh_${shutterAt}`, handle: `Mesh_${handleAt}` }
          : {})
      }
    }
    if (!DRY) fs.copyFileSync(live, backup)
  }
  // Always bake from the untouched original.
  const source = fs.existsSync(backup) ? backup : live
  const doc = await io.read(source)
  const nodes = meshNodesInOrder(doc)
  const before = signature(nodes)
  const parts = findParts(nodes)
  if (hasOwnColours(doc)) return { file, status: 'SKIPPED (already has its own colours)' }
  if (!parts) return { file, status: 'SKIPPED (shape not recognised)' }

  const baseMat = parts.shutter.node.getMesh().listPrimitives()[0].getMaterial()
  const texShutter = doc
    .createTexture('Wood 10002')
    .setImage(images.shutter)
    .setMimeType('image/jpeg')
  const texHandle = doc
    .createTexture('Wood 10012')
    .setImage(images.handle)
    .setMimeType('image/jpeg')
  const matShutter = woodMaterial(doc, baseMat, 'Shutter - Wood 10002', texShutter, PARTS.shutter)
  const matHandle = woodMaterial(doc, baseMat, 'Handle - Wood 10012', texHandle, PARTS.handle)

  for (const [key, mat] of [
    ['shutter', matShutter],
    ['handle', matHandle]
  ]) {
    const node = parts[key].node
    // Never edit a mesh another node also uses — that would recolour both.
    if (node.getMesh().listParents().filter((p) => p.propertyType === 'Node').length > 1) {
      node.setMesh(node.getMesh().clone())
    }
    writeWorldUVs(doc, node, PARTS[key].tileM)
    node.getMesh().listPrimitives().forEach((p) => p.setMaterial(mat))
  }

  keepLoadOrder(doc)

  const out = await io.writeBinary(doc)

  // Verify the baked file before it replaces the live one.
  const check = await io.readBinary(out)
  const checkNodes = meshNodesInOrder(check)
  const after = signature(checkNodes)
  if (after !== before) {
    return { file, status: 'ABORTED (part order/size changed — live file untouched)' }
  }
  const matOf = (i) => checkNodes[i].getMesh().listPrimitives()[0].getMaterial()?.getName()
  const ok =
    matOf(parts.shutter.i) === 'Shutter - Wood 10002' &&
    matOf(parts.handle.i) === 'Handle - Wood 10012'
  if (!ok) return { file, status: 'ABORTED (materials not applied — live file untouched)' }

  if (!DRY) {
    const tmp = live + '.tmp'
    fs.writeFileSync(tmp, Buffer.from(out))
    fs.renameSync(tmp, live)
  }
  return {
    file,
    status: DRY ? 'OK (dry run, not written)' : 'BAKED',
    shutter: `Mesh_${parts.shutter.i}`,
    handle: `Mesh_${parts.handle.i}`,
    bytes: `${fs.statSync(source).size} → ${out.byteLength}`
  }
}

async function main() {
  if (RESTORE) {
    // Every original kept here goes back (whatever this machine calls the files).
    const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.glb')) : []
    for (const file of files) {
      fs.copyFileSync(path.join(BACKUP_DIR, file), path.join(GLB_DIR, file))
      console.log('restored', file)
    }
    if (!files.length) console.log('no backups found')
    return
  }
  const models = await tallUnitModels()
  console.log(`category "${CATEGORY_NAME}": ${models.length} model(s)`)
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const images = {
    shutter: await loadImage(PARTS.shutter),
    handle: await loadImage(PARTS.handle)
  }
  console.log(
    `textures: shutter ${images.shutter.length} bytes, handle ${images.handle.length} bytes`
  )
  const list = {}
  for (const m of models) {
    try {
      const r = await bakeOne(m.file, images)
      console.log(JSON.stringify({ model: m.name, ...r }))
      if (r.shutter && r.handle) {
        list[m.file] = {
          modelId: m.modelId,
          name: m.name,
          shutters: [Number(r.shutter.slice(5))],
          handles: [Number(r.handle.slice(5))]
        }
      }
    } catch (e) {
      console.log(JSON.stringify({ model: m.name, file: m.file, status: 'ERROR — live file untouched', error: e.message }))
    }
  }
  fs.writeFileSync(DRY ? DRY_RUN_LIST : LAST_RUN, JSON.stringify(list, null, 2))
  if (!DRY) console.log('originals kept in', BACKUP_DIR)
}

main()
