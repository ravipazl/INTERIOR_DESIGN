// Poly Haven catalog search + import service.
//
// Poly Haven (polyhaven.com) is a free, CC0 asset library with an OPEN API —
// no token, no signup, no attribution required. This mirrors the Sketchfab
// service so the frontend can offer it as a second "source" in the same
// search modal.
//
// Endpoints (Koa middleware, same pattern as sketchfab.js):
//   GET  /polyhaven/search?q=&count=   Fetch Poly Haven's model list (cached),
//                                      filter by keyword against name/tags/
//                                      categories, return trimmed metadata.
//   POST /polyhaven/import  { id, categoryId, name?, type?, stripTextures? }
//                                      Async job: fetch the model's file list,
//                                      download the multi-file glTF (.gltf +
//                                      .bin + textures), PACK it into a single
//                                      GLB with gltf-transform, run the same
//                                      three.js-r0.118 sanitisation as
//                                      sketchfab, save it, and insert a `models`
//                                      row. Returns { jobId }.
//   GET  /polyhaven/status/:id         Poll job state.
//
// No token needed — Poly Haven's API is fully open.

import path from 'path'
import fs from 'fs'
import url from 'url'
import { v4 as uuidv4 } from 'uuid'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

const POLYHAVEN_API = 'https://api.polyhaven.com'
const THUMB_BASE = 'https://cdn.polyhaven.com/asset_img/thumbs'
const PUBLIC_URL_PREFIX = '/assets/models/glb'
const MAX_BYTES = Number(process.env.MAX_GLB_BYTES) || 60 * 1024 * 1024 // 60 MB
// Which glTF texture resolution to import. 1k keeps files small; Poly Haven
// also offers 2k/4k. Overridable via env.
const PREFERRED_RES = process.env.POLYHAVEN_RES || '1k'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder
})

// -------- in-memory caches + job tracker ------------------------------------

const jobs = new Map()
const JOB_RETENTION_MS = 60 * 60 * 1000
let assetsCache = null // { at: number, list: [...] }
const ASSETS_TTL_MS = 10 * 60 * 1000

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
  return String(name || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80)
}

function ensureDirs() {
  if (!fs.existsSync(GLB_STORAGE_DIR)) {
    fs.mkdirSync(GLB_STORAGE_DIR, { recursive: true })
  }
}

// -------- Poly Haven API helpers --------------------------------------------

async function loadAssets() {
  if (assetsCache && Date.now() - assetsCache.at < ASSETS_TTL_MS) {
    return assetsCache.list
  }
  const resp = await fetch(`${POLYHAVEN_API}/assets?type=models`)
  if (!resp.ok) throw new Error(`Poly Haven assets failed: HTTP ${resp.status}`)
  const json = await resp.json()
  const list = Object.entries(json).map(([id, a]) => ({
    id,
    name: a.name || id,
    categories: a.categories || [],
    tags: a.tags || [],
    authors: a.authors ? Object.keys(a.authors) : [],
    dimensions: a.dimensions || null // [x, y, z] mm (Y-up)
  }))
  assetsCache = { at: Date.now(), list }
  return list
}

function trimResult(a) {
  return {
    uid: a.id, // reuse "uid" so the frontend card shape matches Sketchfab
    name: a.name,
    thumbnail: `${THUMB_BASE}/${a.id}.png?height=256`,
    author: a.authors[0] || '',
    authorProfile: '',
    viewerUrl: `https://polyhaven.com/a/${a.id}`,
    license: 'CC0',
    licenseUrl: 'https://polyhaven.com/license',
    faceCount: 0,
    animationCount: 0,
    sizeBytes: null
  }
}

async function polyhavenSearch({ query, count }) {
  const all = await loadAssets()
  const q = String(query || '').trim().toLowerCase()
  const terms = q.split(/\s+/).filter(Boolean)
  const scored = []
  for (const a of all) {
    const hay = [a.name, ...(a.categories || []), ...(a.tags || [])]
      .join(' ')
      .toLowerCase()
    // Every search term must appear somewhere (name / category / tag).
    if (terms.every((t) => hay.includes(t))) scored.push(a)
  }
  const lim = Math.max(1, Math.min(48, Number(count) || 24))
  return scored.slice(0, lim).map(trimResult)
}

// -------- GLB packing + sanitisation ----------------------------------------

// Poly Haven ships glTF as SEPARATE files (.gltf JSON + .bin + texture jpgs).
// gltf-transform can read that as an in-memory JSONDocument if we hand it the
// parsed JSON plus a { uri: Uint8Array } resource map, then writeBinary() packs
// everything into one self-contained GLB.
async function fetchBuffer(u) {
  const resp = await fetch(u)
  if (!resp.ok) throw new Error(`download failed: HTTP ${resp.status} (${u})`)
  return new Uint8Array(await resp.arrayBuffer())
}

const SAFE_MATERIAL_EXTENSIONS = new Set(['KHR_materials_unlit'])
const COMPRESSION_EXTENSIONS = new Set([
  'EXT_meshopt_compression',
  'KHR_draco_mesh_compression'
])

function dropUnsafeExtensions(doc) {
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    const n = ext.extensionName
    if (COMPRESSION_EXTENSIONS.has(n) || !SAFE_MATERIAL_EXTENSIONS.has(n)) {
      ext.dispose()
    }
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

function stripAllTextures(doc) {
  const setters = [
    'setBaseColorTexture',
    'setMetallicRoughnessTexture',
    'setNormalTexture',
    'setOcclusionTexture',
    'setEmissiveTexture'
  ]
  for (const mat of doc.getRoot().listMaterials()) {
    for (const fn of setters) {
      if (typeof mat[fn] === 'function') mat[fn](null)
    }
  }
  for (const tex of doc.getRoot().listTextures()) tex.dispose()
}

// Predict three.js GLTFLoader mesh names → one row per mesh in model_components.
function extractComponentNamesFromDoc(doc) {
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

// Download the model's files, pick a resolution, pack into a GLB Buffer.
async function downloadAndPack(id, { stripTextures }) {
  const resp = await fetch(`${POLYHAVEN_API}/files/${encodeURIComponent(id)}`)
  if (!resp.ok) throw new Error(`Poly Haven files failed: HTTP ${resp.status}`)
  const files = await resp.json()
  const gltfByRes = files.gltf
  if (!gltfByRes || typeof gltfByRes !== 'object') {
    throw new Error('No glTF files for this model')
  }
  const res =
    (gltfByRes[PREFERRED_RES] && PREFERRED_RES) || Object.keys(gltfByRes)[0]
  const entry = gltfByRes[res] && gltfByRes[res].gltf
  if (!entry || !entry.url) throw new Error(`No glTF at resolution ${res}`)

  // Main .gltf JSON + every included resource (.bin + textures), keyed by the
  // relative path gltf-transform expects to match against buffer/image uris.
  const gltfJson = JSON.parse(Buffer.from(await fetchBuffer(entry.url)).toString('utf8'))
  const resources = {}
  let total = entry.size || 0
  for (const [relPath, info] of Object.entries(entry.include || {})) {
    if (stripTextures && /\.(jpg|jpeg|png|webp)$/i.test(relPath)) {
      // Skip texture downloads entirely when stripping — the .gltf still
      // references them, so we drop those refs after load (stripAllTextures).
      continue
    }
    resources[relPath] = await fetchBuffer(info.url)
    total += info.size || resources[relPath].length
    if (total > MAX_BYTES) {
      throw new Error(
        `Model is over the ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB limit`
      )
    }
  }

  const doc = await io.readJSON({ json: gltfJson, resources })
  dropAnimationsAndMorphTargets(doc)
  dropUnsafeExtensions(doc)
  renameMeshesSequentially(doc)
  if (stripTextures) stripAllTextures(doc)
  await doc.transform(prune())
  const componentNames = extractComponentNamesFromDoc(doc)
  const out = await io.writeBinary(doc)
  return { buffer: Buffer.from(out), componentNames }
}

// -------- import job --------------------------------------------------------

async function runImport(job, app, params) {
  const { id, displayName, categoryId, stripTextures, placementType, credit } =
    params
  try {
    job.stage = 'downloading_glb'
    job.lastUpdate = Date.now()
    const { buffer: processed, componentNames } = await downloadAndPack(id, {
      stripTextures
    })

    job.stage = 'saving'
    job.lastUpdate = Date.now()
    const safe = sanitizeFilename(displayName || id) + '.glb'
    const filename = `${uuidv4()}_${safe}`
    const fullPath = path.join(GLB_STORAGE_DIR, filename)
    fs.writeFileSync(fullPath, processed)
    const modelFileUrl = `${PUBLIC_URL_PREFIX}/${filename}`

    let moduleName = ''
    try {
      const cat = await app.service('categories').get(categoryId)
      moduleName = (cat && cat.name) || ''
    } catch (_) {
      /* not fatal */
    }

    // Real-world dimensions when Poly Haven provides them: their array is
    // [X, Y, Z] mm in glTF Y-up, and pazl stores [HEIGHT, WIDTH, DEPTH] mm.
    // Look them up from the cached assets list by id (no client dependency).
    let d = credit && Array.isArray(credit.dimensions) ? credit.dimensions : null
    if (!d) {
      try {
        const all = await loadAssets()
        const found = all.find((x) => x.id === id)
        if (found && Array.isArray(found.dimensions)) d = found.dimensions
      } catch (_) {
        /* non-fatal — fall back to the default cube below */
      }
    }
    const dims =
      d && d.length === 3
        ? [Math.round(d[1]), Math.round(d[0]), Math.round(d[2])]
        : [500, 500, 500]
    const width = dims[1] || 500

    const now = new Date().toISOString()
    const doc = {
      name: displayName || safe.replace(/\.glb$/i, ''),
      modelFileUrl,
      thumbnail: '',
      thumbnails: '',
      categoryId,
      dimensions: dims,
      maxWidth: Math.max(width, 9999),
      standardWidth: [1, width, 9999],
      price: 0,
      type: Number.isFinite(placementType) ? placementType : 1,
      description: 'Imported from Poly Haven (CC0)',
      hardware: '',
      isPazlSupplied: true,
      isUserUploaded: true,
      isFromPolyHaven: true,
      polyHavenId: id,
      // CC0 needs no attribution, but we still record the author + source for
      // reference so the origin travels with the model.
      polyHavenAuthor: (credit && credit.author) || '',
      polyHavenUrl: (credit && credit.viewerUrl) || '',
      polyHavenLicense: 'CC0',
      moduleName,
      sizeBytes: processed.length,
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

    // Seed one model_components row per mesh (string modelId — pazl queries by
    // string) so the object panel's Components section works after import.
    let componentsInserted = 0
    if (componentNames.length && db) {
      try {
        const compNow = new Date().toISOString()
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
          createdAt: compNow,
          updatedAt: compNow
        }))
        const cIns = await db
          .collection('model_components')
          .insertMany(componentDocs)
        componentsInserted = cIns.insertedCount || componentDocs.length
      } catch (e) {
        console.warn(
          `[polyhaven] model_components seeding failed for ${id}: ${
            e && e.message
          }`
        )
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
        polyHavenId: id,
        sizeBytes: processed.length,
        componentsInserted
      }
    })
  } catch (err) {
    finishJob(job, {
      stage: 'error',
      error: (err && err.message) || String(err)
    })
  }
}

// -------- Koa wiring --------------------------------------------------------

export const polyHaven = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /polyhaven/search?q=...&count=...
    if (ctx.method === 'GET' && ctx.path === '/polyhaven/search') {
      const q = String(ctx.query.q || '').trim()
      if (!q) {
        ctx.status = 400
        ctx.body = { error: 'missing_query', message: 'Query parameter "q" is required' }
        return
      }
      try {
        const results = await polyhavenSearch({ query: q, count: ctx.query.count })
        ctx.status = 200
        ctx.body = { results }
      } catch (e) {
        ctx.status = 500
        ctx.body = { error: 'search_failed', message: (e && e.message) || String(e) }
      }
      return
    }

    // GET /polyhaven/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/polyhaven/status/')) {
      const id = ctx.path.substring('/polyhaven/status/'.length)
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

    // POST /polyhaven/import
    if (ctx.method === 'POST' && ctx.path === '/polyhaven/import') {
      const body = ctx.request.body || {}
      const id = String(body.id || body.uid || '').trim()
      const categoryId = String(body.categoryId || '').trim()
      if (!id || !categoryId) {
        ctx.status = 400
        ctx.body = { error: 'missing_fields', message: 'id and categoryId are required' }
        return
      }
      const displayName = String(body.name || '').trim() || id
      // Poly Haven models are textured CC0 assets — keep textures by default
      // (that's the whole point). Client may still opt to strip.
      const stripTextures =
        body.stripTextures === true ||
        body.stripTextures === 'true' ||
        body.stripTextures === 1 ||
        body.stripTextures === '1'
      const placementType = (() => {
        const n = Number(body.type)
        return Number.isFinite(n) && n >= 0 ? n : 1
      })()
      const credit = body.credit && typeof body.credit === 'object' ? body.credit : null

      const job = newJob()
      ctx.status = 202
      ctx.body = { jobId: job.id, status: 'queued' }

      runImport(job, app, {
        id,
        displayName,
        categoryId,
        stripTextures,
        placementType,
        credit
      })
      return
    }

    return next()
  })
}
