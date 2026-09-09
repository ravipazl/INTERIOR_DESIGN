// Objaverse catalog browse + import service.
//
// Objaverse (allenai/objaverse @ Hugging Face) has no search API and its
// metadata is too sharded to browse live, so we serve a pre-built local index
// (scripts/build-objaverse-index.mjs → objaverse-furniture-index.json) that
// already holds ONLY commercial-licensed (by / by-sa / cc0) furniture objects.
//
//   GET  /objaverse/categories                 Furniture categories + counts.
//   GET  /objaverse/browse?category=&start=    Page of objects in a category
//                                              (uid, name, license, author,
//                                              thumbnail, glbUrl).
//   POST /objaverse/import { uid, categoryId, name?, stripTextures?, type?,
//                            credit }           Download the GLB from Hugging
//                                              Face, decode Draco/meshopt, drop
//                                              the extensions r0.118 can't read,
//                                              rename Mesh_N, save + insert a
//                                              `models` row. → { jobId }
//   GET  /objaverse/status/:id                 Poll job state.
//
// No API key needed (Hugging Face is open). CC-BY objects require crediting the
// author, so the author + Sketchfab viewer URL are stored with each import.

import path from 'path'
import fs from 'fs'
import url from 'url'
import { v4 as uuidv4 } from 'uuid'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import { measureDocumentMm, resolveDimensions } from '../../utils/measure-glb.js'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import draco3d from 'draco3d'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

const HF_BASE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main'
const PUBLIC_URL_PREFIX = '/assets/models/glb'
const MAX_BYTES = Number(process.env.MAX_GLB_BYTES) || 60 * 1024 * 1024 // 60 MB
const INDEX_FILE = path.join(__dirname, 'objaverse-furniture-index.json')

// Curated furniture categories to expose. The index was built with a loose
// regex that let a few non-furniture categories in (e.g. "chili_(vegetable)"
// matched "vege-table-"); this whitelist keeps the browse list clean without a
// rebuild. Order roughly by how common the item is in interiors.
const CATEGORY_WHITELIST = [
  'sofa', 'sofa_bed', 'armchair', 'chair', 'rocking_chair', 'folding_chair',
  'deck_chair', 'stool', 'step_stool', 'music_stool', 'footstool', 'ottoman',
  'bench', 'table', 'coffee_table', 'dining_table', 'kitchen_table', 'desk',
  'cabinet', 'file_cabinet', 'bookcase', 'dresser', 'wardrobe', 'bed',
  'bunk_bed', 'highchair', 'lamp', 'table_lamp', 'lampshade', 'pool_table',
  'table-tennis_table'
]

// GLB URL pattern for the SSRF guard on import (host + shape are fixed).
function glbUrlFor(folder, uid) {
  return `${HF_BASE}/glbs/${folder}/${uid}.glb`
}
const HF_GLB_RE =
  /^https:\/\/huggingface\.co\/datasets\/allenai\/objaverse\/resolve\/main\/glbs\/[\w-]+\/[a-f0-9]+\.glb$/i

// -------- load the pre-built index once ------------------------------------

let INDEX = null // { byUid: Map, byCategory: Map<string, object[]>, counts }
function loadIndex() {
  if (INDEX) return INDEX
  if (!fs.existsSync(INDEX_FILE)) {
    INDEX = { missing: true, byUid: new Map(), byCategory: new Map() }
    console.warn(
      `[objaverse] index not found at ${INDEX_FILE} — run scripts/build-objaverse-index.mjs`
    )
    return INDEX
  }
  const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  const byUid = new Map()
  const byCategory = new Map()
  for (const o of raw.objects || []) {
    byUid.set(o.uid, o)
    for (const c of o.categories || []) {
      if (!byCategory.has(c)) byCategory.set(c, [])
      byCategory.get(c).push(o)
    }
  }
  INDEX = { byUid, byCategory, builtAt: raw.builtAt }
  console.log(
    `[objaverse] loaded index: ${byUid.size} objects, ${byCategory.size} categories`
  )
  return INDEX
}

function trimForClient(o) {
  return {
    // `uid` mirrors the Sketchfab result shape the modal renders.
    uid: o.uid,
    name: o.name,
    thumbnail: o.thumbnail || '',
    author: o.author || '',
    authorProfile: o.viewerUrl || '',
    viewerUrl: o.viewerUrl || '',
    license: o.license || '',
    licenseUrl:
      o.license === 'cc0'
        ? 'https://creativecommons.org/publicdomain/zero/1.0/'
        : `https://creativecommons.org/licenses/${o.license}/4.0/`,
    faceCount: o.faceCount || 0
  }
}

// -------- gltf-transform IO (lazy — Draco decoder init is async) -----------

let _ioPromise = null
async function getIO() {
  if (_ioPromise) return _ioPromise
  _ioPromise = (async () => {
    const [decoder, encoder] = await Promise.all([
      draco3d.createDecoderModule(),
      draco3d.createEncoderModule()
    ])
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'draco3d.decoder': decoder,
      'draco3d.encoder': encoder,
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder
    })
  })()
  return _ioPromise
}

// -------- in-memory job tracker --------------------------------------------

const jobs = new Map()
const JOB_RETENTION_MS = 60 * 60 * 1000

function newJob() {
  const id = uuidv4()
  const job = {
    id,
    stage: 'queued',
    progress: null,
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    lastUpdate: Date.now()
  }
  jobs.set(id, job)
  return job
}
function finishJob(job, patch) {
  Object.assign(job, patch, { finishedAt: Date.now(), lastUpdate: Date.now() })
  setTimeout(() => jobs.delete(job.id), JOB_RETENTION_MS).unref?.()
}
function sanitizeFilename(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
}
function ensureDirs() {
  if (!fs.existsSync(GLB_STORAGE_DIR)) fs.mkdirSync(GLB_STORAGE_DIR, { recursive: true })
}

async function fetchGlbBuffer(u, maxBytes) {
  const resp = await fetch(u)
  if (!resp.ok) throw new Error(`GLB download failed: HTTP ${resp.status}`)
  const ab = await resp.arrayBuffer()
  if (ab.byteLength > maxBytes) {
    throw new Error(
      `GLB is ${(ab.byteLength / 1024 / 1024).toFixed(1)} MB — limit is ${(
        maxBytes / 1024 / 1024
      ).toFixed(0)} MB`
    )
  }
  return Buffer.from(ab)
}

// -------- GLB sanitisation (same as sketchfab/smithsonian) -----------------

const SAFE_MATERIAL_EXTENSIONS = new Set(['KHR_materials_unlit'])
const COMPRESSION_EXTENSIONS = new Set([
  'EXT_meshopt_compression',
  'KHR_draco_mesh_compression'
])

function dropCompressionAndUnsafeExtensions(doc) {
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    const n = ext.extensionName
    if (COMPRESSION_EXTENSIONS.has(n) || !SAFE_MATERIAL_EXTENSIONS.has(n)) ext.dispose()
  }
}
function dropAnimationsAndMorphTargets(doc) {
  for (const anim of doc.getRoot().listAnimations()) anim.dispose()
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const t of prim.listTargets()) {
        prim.removeTarget(t)
        t.dispose()
      }
    }
  }
}
function renameMeshesSequentially(doc) {
  let counter = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const newName = `Mesh_${counter++}`
    node.setName(newName)
    mesh.setName(newName)
  }
}
function extractMaterialNamesFromDoc(doc) {
  const out = []
  const seen = new Set()
  for (const mat of doc.getRoot().listMaterials()) {
    const n = mat.getName() || 'defaultMaterial'
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}
function stripAllTextures(doc) {
  const setters = [
    'setBaseColorTexture', 'setMetallicRoughnessTexture', 'setNormalTexture',
    'setOcclusionTexture', 'setEmissiveTexture'
  ]
  for (const mat of doc.getRoot().listMaterials()) {
    for (const fn of setters) if (typeof mat[fn] === 'function') mat[fn](null)
  }
  for (const tex of doc.getRoot().listTextures()) tex.dispose()
}
export function extractComponentNamesFromDoc(doc) {
  const out = []
  const seen = new Set()
  let fallback = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const base = node.getName() || mesh.getName() || `Mesh_${fallback++}`
    const prims = mesh.listPrimitives()
    const names = prims.length <= 1 ? [base] : prims.map((_, i) => `${base}_${i}`)
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
async function processGlb(buffer, { stripTextures }) {
  const io = await getIO()
  const doc = await io.readBinary(new Uint8Array(buffer))
  dropAnimationsAndMorphTargets(doc)
  dropCompressionAndUnsafeExtensions(doc)
  renameMeshesSequentially(doc)
  if (stripTextures) stripAllTextures(doc)
  await doc.transform(prune())
  const componentNames = extractComponentNamesFromDoc(doc)
  const materialNames = extractMaterialNamesFromDoc(doc)
  // Measure while the document is parsed — the record below stored a fixed
  // 500 mm placeholder, and the frontend scales the mesh to match it.
  const measured = measureDocumentMm(doc)
  const out = await io.writeBinary(doc)
  return { buffer: Buffer.from(out), componentNames, materialNames, measured }
}

// -------- import job --------------------------------------------------------

async function runImport(job, app, params) {
  const { uid, glbUrl, displayName, categoryId, stripTextures, credit, placementType } =
    params
  try {
    job.stage = 'downloading_glb'
    job.lastUpdate = Date.now()
    const original = await fetchGlbBuffer(glbUrl, MAX_BYTES)

    job.stage = 'decoding'
    job.lastUpdate = Date.now()
    let processed = original
    let componentNames = []
    let measured = null
    let processedOk = false
    try {
      const r = await processGlb(original, { stripTextures })
      processed = r.buffer
      componentNames = r.componentNames
      measured = r.measured
      processedOk = true
      console.log(
        `[objaverse] processGlb OK ${uid}: ${original.length} -> ${processed.length} bytes, ${componentNames.length} meshes`
      )
    } catch (e) {
      console.warn(`[objaverse] processGlb failed for ${uid}: ${e && e.message}`)
    }
    if (!processedOk && !componentNames.length) {
      try {
        const io = await getIO()
        const d = await io.readBinary(new Uint8Array(original))
        componentNames = extractComponentNamesFromDoc(d)
      } catch (_) {}
    }

    job.stage = 'saving'
    job.lastUpdate = Date.now()
    const safe = sanitizeFilename(displayName || uid) + '.glb'
    const filename = `${uuidv4()}_${safe}`
    const fullPath = path.join(GLB_STORAGE_DIR, filename)
    fs.writeFileSync(fullPath, processed)
    const modelFileUrl = `${PUBLIC_URL_PREFIX}/${filename}`

    let moduleName = ''
    try {
      const cat = await app.service('categories').get(categoryId)
      moduleName = (cat && cat.name) || ''
    } catch (_) {}

    const now = new Date().toISOString()
    const lic = (credit && credit.license) || ''
    const doc = {
      name: displayName || safe.replace(/\.glb$/i, ''),
      modelFileUrl,
      thumbnail: '',
      thumbnails: '',
      categoryId,
      dimensions: resolveDimensions(measured).dimensions,
      maxWidth: 9999,
      standardWidth: [1, 500, 9999],
      price: 0,
      type: Number.isFinite(placementType) ? placementType : 1,
      description: 'Imported from Objaverse',
      hardware: '',
      isPazlSupplied: true,
      isUserUploaded: true,
      isFromObjaverse: true,
      objaverseUid: uid,
      // CC-BY requires crediting the author; store it so credit travels along.
      objaverseAuthor: (credit && credit.author) || '',
      objaverseModelUrl: (credit && credit.viewerUrl) || '',
      objaverseLicense: lic,
      objaverseLicenseUrl:
        lic === 'cc0'
          ? 'https://creativecommons.org/publicdomain/zero/1.0/'
          : lic
          ? `https://creativecommons.org/licenses/${lic}/4.0/`
          : '',
      moduleName,
      sizeBytes: processed.length,
      sizeBytesOriginal: original.length,
      createdAt: now,
      updatedAt: now
    }

    let created
    let db
    try {
      db = await app.get('mongodbClient')
      const ins = await db.collection('models').insertOne(doc)
      created = { _id: String(ins.insertedId), ...doc }
    } catch (err) {
      try {
        fs.unlinkSync(fullPath)
      } catch (_) {}
      throw new Error(`DB insert failed: ${(err && err.message) || String(err)}`)
    }

    let componentsInserted = 0
    if (componentNames.length && db) {
      try {
        const cnow = new Date().toISOString()
        const modelIdStr = String(created._id)
        const componentDocs = componentNames.map((name, i) => ({
          modelId: modelIdStr,
          name,
          meshName: name,
          meshIndex: i,
          componentType: 'external',
          defaultFinishingId: null,
          defaultFinishingBrandId: null,
          defaultExternalFinishGrainDirection: 'Horizontal',
          modelDefaultValues: [],
          createdAt: cnow,
          updatedAt: cnow
        }))
        const cIns = await db.collection('model_components').insertMany(componentDocs)
        componentsInserted = cIns.insertedCount || componentDocs.length
      } catch (e) {
        console.warn(`[objaverse] component seeding failed for ${uid}: ${e && e.message}`)
      }
    }

    finishJob(job, {
      stage: 'done',
      progress: 100,
      result: {
        modelId: created._id,
        modelFileUrl,
        name: doc.name,
        categoryId,
        componentsInserted
      }
    })
  } catch (err) {
    finishJob(job, { stage: 'error', error: (err && err.message) || String(err) })
  }
}

// -------- Koa wiring --------------------------------------------------------

export const objaverse = (app) => {
  ensureDirs()
  loadIndex()

  app.use(async (ctx, next) => {
    // GET /objaverse/categories
    if (ctx.method === 'GET' && ctx.path === '/objaverse/categories') {
      const idx = loadIndex()
      const cats = CATEGORY_WHITELIST.map((c) => ({
        category: c,
        label: c.replace(/_/g, ' '),
        count: (idx.byCategory.get(c) || []).length
      })).filter((c) => c.count > 0)
      ctx.status = 200
      ctx.body = { categories: cats }
      return
    }

    // GET /objaverse/browse?category=&start=
    if (ctx.method === 'GET' && ctx.path === '/objaverse/browse') {
      const idx = loadIndex()
      const category = String(ctx.query.category || '').trim()
      if (!category) {
        ctx.status = 400
        ctx.body = { error: 'missing_category', message: 'category is required' }
        return
      }
      const all = idx.byCategory.get(category) || []
      const start = Math.max(0, Number(ctx.query.start) || 0)
      const PAGE = 24
      const page = all.slice(start, start + PAGE)
      ctx.status = 200
      ctx.body = {
        results: page.map(trimForClient),
        next: start + PAGE < all.length ? start + PAGE : null,
        total: all.length
      }
      return
    }

    // GET /objaverse/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/objaverse/status/')) {
      const id = ctx.path.substring('/objaverse/status/'.length)
      const job = jobs.get(id)
      if (!job) {
        ctx.status = 404
        ctx.body = { error: 'not_found', message: `Job ${id} not found` }
        return
      }
      ctx.status = 200
      ctx.body = job
      return
    }

    // POST /objaverse/import
    if (ctx.method === 'POST' && ctx.path === '/objaverse/import') {
      const idx = loadIndex()
      const body = ctx.request.body || {}
      const uid = String(body.uid || '').trim()
      const categoryId = String(body.categoryId || '').trim()
      if (!uid || !categoryId) {
        ctx.status = 400
        ctx.body = { error: 'missing_fields', message: 'uid and categoryId are required' }
        return
      }
      const obj = idx.byUid.get(uid)
      if (!obj) {
        ctx.status = 404
        ctx.body = { error: 'unknown_uid', message: 'uid not in the Objaverse index' }
        return
      }
      const glbUrl = glbUrlFor(obj.folder, uid)
      if (!HF_GLB_RE.test(glbUrl)) {
        ctx.status = 400
        ctx.body = { error: 'bad_url', message: 'resolved GLB url failed validation' }
        return
      }
      const displayName = String(body.name || '').trim() || obj.name || `Objaverse ${uid.slice(0, 6)}`
      const stripTextures =
        body.stripTextures === true || body.stripTextures === 'true' ||
        body.stripTextures === 1 || body.stripTextures === '1'
      const placementType = (() => {
        const n = Number(body.type)
        return Number.isFinite(n) && n >= 0 ? n : 1
      })()
      // Credit is taken from the trusted server index, not the client.
      const credit = {
        author: obj.author,
        viewerUrl: obj.viewerUrl,
        license: obj.license
      }

      const job = newJob()
      ctx.status = 202
      ctx.body = { jobId: job.id, status: 'queued' }
      runImport(job, app, {
        uid, glbUrl, displayName, categoryId, stripTextures, credit, placementType
      })
      return
    }

    return next()
  })
}
