// Sketchfab catalog search + import service.
//
// Three endpoints (Koa middleware, bypassing the Feathers service layer for
// the same reasons modelUpload / imageTo3d do):
//
//   GET  /sketchfab/search?q=&count=&license=    Proxy a Sketchfab search.
//                                                Returns trimmed metadata
//                                                (uid, name, thumbnail,
//                                                author, license, faceCount).
//   POST /sketchfab/import   { uid, categoryId, name?, stripTextures? }
//                                                Start an async import job
//                                                that downloads the GLB,
//                                                decodes EXT_meshopt_compression
//                                                with gltf-transform (three.js
//                                                r0.118 cannot read meshopt),
//                                                optionally strips textures,
//                                                saves to the frontend's
//                                                public folder, and inserts a
//                                                `models` row under the chosen
//                                                category. Returns { jobId }.
//   GET  /sketchfab/status/:id                   Poll job state — mirrors the
//                                                imageTo3d job tracker pattern.
//
// The SKETCHFAB_TOKEN env var is required for search + download (same token
// as the C:/GLB Python scraper used).

import path from 'path'
import fs from 'fs'
import url from 'url'
import { v4 as uuidv4 } from 'uuid'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import { measureDocumentMm, resolveDimensions } from '../../utils/measure-glb.js'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

const SKETCHFAB_API = 'https://api.sketchfab.com/v3'
const PUBLIC_URL_PREFIX = '/assets/models/glb'
const MAX_BYTES = Number(process.env.MAX_GLB_BYTES) || 50 * 1024 * 1024 // 50 MB
const DEFAULT_LICENSE = process.env.SKETCHFAB_LICENSE || 'by'

// -------- gltf-transform IO (configured once, reused per job) --------------
//
// The Meshopt decoder is registered as the dependency name gltf-transform
// looks up when EXT_meshopt_compression is encountered. The encoder is needed
// only for re-encoding — we never re-encode here (we DECODE so three.js can
// read it), but registering both is cheap and protects against future use.
//
// We deliberately do NOT register the Draco decoder: a model that needs Draco
// will throw on read, the import will fall back to the original buffer, and
// three.js can load it with its own DRACOLoader if configured client-side.

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder
})

// -------- in-memory job tracker (mirrors image-to-3d) ----------------------

const jobs = new Map()
const JOB_RETENTION_MS = 60 * 60 * 1000 // keep finished jobs for an hour

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
  Object.assign(job, patch, {
    finishedAt: Date.now(),
    lastUpdate: Date.now()
  })
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

// -------- Sketchfab API helpers --------------------------------------------

function pickThumb(thumbs) {
  if (!thumbs || !Array.isArray(thumbs.images)) return ''
  // Smallest image >=128px wide is enough for the result grid; fall back to
  // the largest if nothing meets that.
  const list = thumbs.images
    .slice()
    .sort((a, b) => (a.width || 0) - (b.width || 0))
  const pick = list.find((i) => (i.width || 0) >= 128) || list[list.length - 1]
  return (pick && pick.url) || ''
}

function trimSearchResult(m) {
  const user = m.user || {}
  const license = m.license || {}
  return {
    uid: m.uid,
    name: m.name || '',
    thumbnail: pickThumb(m.thumbnails),
    author: user.displayName || user.username || '',
    authorProfile: user.profileUrl || '',
    viewerUrl: m.viewerUrl || '',
    license: license.slug || license.label || '',
    licenseUrl: license.url || '',
    faceCount: m.faceCount || 0,
    animationCount: m.animationCount || 0,
    sizeBytes: ((m.archives && m.archives.glb) || {}).size || null
  }
}

async function sketchfabSearch({ query, count, license, cursor }) {
  const token = process.env.SKETCHFAB_TOKEN
  if (!token) {
    throw new Error('SKETCHFAB_TOKEN is not set on the server (.env)')
  }

  // Sketchfab caps results per request, so "Load more" paginates: each response
  // carries a `next` URL for the following page. When the client sends that URL
  // back as `cursor`, fetch it as-is (the query/filters are already baked into
  // it). Only ever follow a genuine Sketchfab API URL — never an arbitrary one
  // the client made up — so this can't be turned into a server-side request
  // forgery.
  let url
  if (cursor && /^https:\/\/api\.sketchfab\.com\//.test(cursor)) {
    url = cursor
  } else {
    const params = new URLSearchParams({
      q: query,
      type: 'models',
      downloadable: 'true',
      count: String(Math.max(1, Math.min(48, Number(count) || 24)))
    })
    if (license) params.set('license', license)
    url = `${SKETCHFAB_API}/search?${params}`
  }

  const resp = await fetch(url, {
    headers: { Authorization: `Token ${token}` }
  })
  if (!resp.ok) {
    throw new Error(`Sketchfab search failed: HTTP ${resp.status}`)
  }
  const json = await resp.json()
  return {
    results: (json.results || []).map(trimSearchResult),
    next: json.next || null // opaque "next page" URL, or null at the end
  }
}

async function sketchfabDownloadUrl(uid) {
  const token = process.env.SKETCHFAB_TOKEN
  if (!token) {
    throw new Error('SKETCHFAB_TOKEN is not set on the server (.env)')
  }
  const resp = await fetch(`${SKETCHFAB_API}/models/${uid}/download`, {
    headers: { Authorization: `Token ${token}` }
  })
  if (!resp.ok) {
    throw new Error(`Sketchfab download-info failed: HTTP ${resp.status}`)
  }
  const json = await resp.json()
  const glb = json.glb || json.gltf
  if (!glb || !glb.url) {
    throw new Error('Sketchfab returned no GLB URL for this model')
  }
  return glb.url
}

async function fetchGlbBuffer(url, maxBytes) {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`GLB download failed: HTTP ${resp.status}`)
  }
  const ab = await resp.arrayBuffer()
  if (ab.byteLength > maxBytes) {
    throw new Error(
      `GLB is ${(ab.byteLength / 1024 / 1024).toFixed(1)} MB — limit is ${(
        maxBytes /
        1024 /
        1024
      ).toFixed(0)} MB`
    )
  }
  return Buffer.from(ab)
}

// -------- GLB post-processing ----------------------------------------------
//
// Decoding strategy: gltf-transform's io.readBinary() automatically *expands*
// every accessor that lived inside EXT_meshopt_compression as part of loading,
// so the in-memory Document is already uncompressed. Re-saving with the
// extension dropped from extensionsUsed produces a plain glTF buffer that
// three.js r0.118 reads natively — same end state as gltfpack's `-cc` decode.
//
// Sanitisation strategy (the other half): Sketchfab GLBs routinely carry
// modern PBR material extensions (KHR_materials_specular / _transmission /
// _volume / _iridescence / _sheen / …) that three.js r0.118 (Aug 2020)
// doesn't know about. Loading them produces broken shaders that pollute
// the WebGL program cache — and the symptom is that textures stop applying
// to *already loaded* items and selection becomes flaky. We strip every
// material extension except KHR_materials_unlit, drop animations + morph
// targets (which keep the raycaster cache stale), and namespace every Node /
// Mesh / Material with the model's Sketchfab UID so its names cannot collide
// with the existing catalog's mesh-name lookups.

const SAFE_MATERIAL_EXTENSIONS = new Set(['KHR_materials_unlit'])
const COMPRESSION_EXTENSIONS = new Set([
  'EXT_meshopt_compression',
  'KHR_draco_mesh_compression'
])

function dropCompressionAndUnsafeExtensions(doc) {
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
      const targets = prim.listTargets()
      for (const t of targets) {
        prim.removeTarget(t)
        t.dispose()
      }
    }
  }
}

// Rename every Node-with-Mesh in document order to "Mesh_0", "Mesh_1", … so
// the runtime mesh names match pazl's seeded-catalog convention exactly
// (underscore, not space — the UI renders it as "Mesh 0" cosmetically).
// Cross-item name collisions don't matter because pazl scopes its mesh
// lookups to each Physical3DItem's own __loadedItem subtree (see
// BlueprintInterface.highlightMeshes).
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

// Distinct material names from the doc, in stable order. We seed one
// model_components row per material so the Material panel (Core Material /
// Exterior / Interior) has a target — matching what the seeded catalog has.
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
  // Clear texture refs on every material first, then dispose every texture so
  // prune() can release the now-unreferenced images + samplers + bufferViews.
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

// Predict three.js GLTFLoader naming: one THREE.Mesh per Primitive, named
// after its parent Node — suffixed by primitive index when a Node's Mesh
// owns more than one primitive. These names go into model_components so the
// component panel + texture targeting lights up after import.
export function extractComponentNamesFromDoc(doc) {
  const out = []
  const seen = new Set()
  let fallback = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const base = node.getName() || mesh.getName() || `Mesh_${fallback++}`
    const prims = mesh.listPrimitives()
    const names =
      prims.length <= 1
        ? [base]
        : prims.map((_, i) => `${base}_${i}`)
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

async function processGlb(buffer, { stripTextures }) {
  const doc = await io.readBinary(new Uint8Array(buffer))
  dropAnimationsAndMorphTargets(doc)
  dropCompressionAndUnsafeExtensions(doc)
  renameMeshesSequentially(doc)
  if (stripTextures) stripAllTextures(doc)
  // Drop unreferenced resources left behind by the above passes.
  await doc.transform(prune())
  const componentNames = extractComponentNamesFromDoc(doc)
  const materialNames = extractMaterialNamesFromDoc(doc)
  // Measure while the document is already parsed — the catalog record below
  // used to store a fixed 500 mm placeholder, and the frontend SCALES the mesh
  // to match it, which is what made imported models appear doll-sized.
  const measured = measureDocumentMm(doc)
  const out = await io.writeBinary(doc)
  return { buffer: Buffer.from(out), componentNames, materialNames, measured }
}

// -------- import job --------------------------------------------------------

async function runImport(job, app, params) {
  const {
    uid,
    displayName,
    categoryId,
    stripTextures,
    credit,
    placementType,
    // Optional { widthMm, heightMm, depthMm } typed in the import dialog. When
    // absent (the normal case) the measured size is used.
    dimensionOverride
  } = params
  try {
    job.stage = 'fetching_url'
    job.lastUpdate = Date.now()
    const glbUrl = await sketchfabDownloadUrl(uid)

    job.stage = 'downloading_glb'
    job.lastUpdate = Date.now()
    const original = await fetchGlbBuffer(glbUrl, MAX_BYTES)

    job.stage = 'decoding'
    job.lastUpdate = Date.now()
    let processed = original
    let componentNames = []
    let materialNames = []
    let measured = null
    let processedOk = false
    try {
      const r = await processGlb(original, { stripTextures })
      processed = r.buffer
      componentNames = r.componentNames
      materialNames = r.materialNames
      measured = r.measured
      processedOk = true
      console.log(
        `[sketchfab] processGlb OK for ${uid}: ${original.length} -> ${processed.length} bytes, ${componentNames.length} mesh names, ${materialNames.length} material names`
      )
    } catch (e) {
      // Decode/sanitise failed — keep the original. three.js may still load
      // it (or fail gracefully). Surface the warning so the operator knows.
      console.warn(
        `[sketchfab] processGlb failed for ${uid}, saving original: ${
          e && e.message
        }`
      )
      job.lastUpdate = Date.now()
    }

    // Fallback: even if sanitisation threw, try to read the original GLB once
    // more JUST to extract mesh names — so the Components panel still works
    // for the import. (Selection / texture-apply on other items may still
    // suffer the pre-fix pollution problem, but the model is at least
    // editable.)
    if (!processedOk && !componentNames.length) {
      try {
        const fallbackDoc = await io.readBinary(new Uint8Array(original))
        componentNames = extractComponentNamesFromDoc(fallbackDoc)
        materialNames = extractMaterialNamesFromDoc(fallbackDoc)
        console.log(
          `[sketchfab] fallback extracted ${componentNames.length} mesh + ${materialNames.length} material names from original for ${uid}`
        )
      } catch (e) {
        console.warn(
          `[sketchfab] fallback name extraction also failed for ${uid}: ${
            e && e.message
          }`
        )
      }
    }

    job.stage = 'saving'
    job.lastUpdate = Date.now()
    const safe = sanitizeFilename(displayName || uid) + '.glb'
    const filename = `${uuidv4()}_${safe}`
    const fullPath = path.join(GLB_STORAGE_DIR, filename)
    fs.writeFileSync(fullPath, processed)
    const modelFileUrl = `${PUBLIC_URL_PREFIX}/${filename}`

    // Look up the category for the moduleName field (same as model-upload).
    let moduleName = ''
    try {
      const cat = await app.service('categories').get(categoryId)
      moduleName = (cat && cat.name) || ''
    } catch (_) {
      /* not fatal */
    }

    // Real size instead of the old fixed [500, 500, 500]. The frontend SCALES a
    // placed model to match its declared dimensions, so the placeholder was
    // shrinking every imported model — a 2 m sofa came in at 500 mm. Falls back
    // to the placeholder only when the model cannot be measured or measures
    // implausibly (scraped files are not always authored in metres).
    const resolvedDims = resolveDimensions(measured, dimensionOverride)
    console.log(
      `[sketchfab] dimensions for ${uid}: [${resolvedDims.dimensions.join(
        ', '
      )}] mm (source: ${resolvedDims.source})`
    )

    const now = new Date().toISOString()
    const doc = {
      name: displayName || safe.replace(/\.glb$/i, ''),
      modelFileUrl,
      thumbnail: '',
      thumbnails: '',
      categoryId,
      dimensions: resolvedDims.dimensions,
      maxWidth: 9999,
      standardWidth: [1, 500, 9999],
      price: 0,
      type: Number.isFinite(placementType) ? placementType : 1,
      description: 'Imported from Sketchfab',
      hardware: '',
      isPazlSupplied: true,
      isUserUploaded: true,
      isFromSketchfab: true,
      sketchfabUid: uid,
      // CC-BY attribution — required by the upstream license for the
      // licenses we filter on. Stored on the model so the frontend can
      // surface it next to the item.
      sketchfabAuthor: (credit && credit.author) || '',
      sketchfabAuthorUrl: (credit && credit.authorProfile) || '',
      sketchfabModelUrl: (credit && credit.viewerUrl) || '',
      sketchfabLicense: (credit && credit.license) || '',
      sketchfabLicenseUrl: (credit && credit.licenseUrl) || '',
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
      // String(...) guarantees a real string even if some driver versions
      // hand back an ObjectId-like wrapper from .toString(). pazl's seeded
      // catalog stores modelId as a string; staying consistent so the
      // frontend's string-keyed `modelcomponents?$and[0][modelId]=…` query
      // actually matches our rows.
      created = { _id: String(ins.insertedId), ...doc }
    } catch (err) {
      // Roll back the file so we don't leave an orphan GLB on disk.
      try {
        fs.unlinkSync(fullPath)
      } catch (_) {}
      throw new Error(
        `DB insert failed: ${(err && err.message) || String(err)}`
      )
    }

    // Seed one `model_components` row per mesh so the object panel's
    // "Components" section + per-mesh texture targeting light up after
    // import. Without this the panel shows "No modifiable components" and
    // texture-apply has nothing to target.
    let componentsInserted = 0
    console.log(
      `[sketchfab] about to seed components for model ${created._id} (uid ${uid}): ${componentNames.length} names`
    )
    if (componentNames.length && db) {
      try {
        const now = new Date().toISOString()
        const modelIdStr = String(created._id) // belt-and-suspenders
        // Match the seeded-catalog row shape exactly — the color/texture
        // picker writes UPDATES to defaultFinishingId / modelDefaultValues
        // on these rows and looks up the target via meshName + componentType.
        // Without these fields the write has nothing to land on, which is
        // why color "applies" but never shows.
        const componentDocs = componentNames.map((name, i) => ({
          modelId: modelIdStr,
          name, // "Mesh_0"
          meshName: name, // pazl looks up the runtime mesh by this
          meshIndex: i,
          componentType: 'external',
          defaultFinishingId: null,
          defaultFinishingBrandId: null,
          defaultExternalFinishGrainDirection: 'Horizontal',
          modelDefaultValues: [],
          createdAt: now,
          updatedAt: now
        }))
        console.log(
          `[sketchfab] inserting ${componentDocs.length} components (Mesh_N rows); first modelId=${componentDocs[0].modelId} (typeof=${typeof componentDocs[0].modelId})`
        )
        const cIns = await db
          .collection('model_components')
          .insertMany(componentDocs)
        componentsInserted = cIns.insertedCount || componentDocs.length
        console.log(
          `[sketchfab] inserted ${componentsInserted} model_components for model ${modelIdStr}`
        )
      } catch (e) {
        // Non-fatal: the model still works without modifiable components.
        console.warn(
          `[sketchfab] model_components seeding failed for ${uid}: ${
            e && e.message
          }`
        )
      }
    } else if (!componentNames.length) {
      console.warn(
        `[sketchfab] no component names extracted for ${uid} — Components panel will be empty`
      )
    }

    finishJob(job, {
      stage: 'done',
      progress: 100,
      result: {
        modelId: created._id,
        modelFileUrl,
        name: doc.name,
        categoryId,
        sketchfabUid: uid,
        sizeBytes: processed.length,
        sizeBytesOriginal: original.length,
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

export const sketchfab = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /sketchfab/search?q=...&count=...&license=...
    if (ctx.method === 'GET' && ctx.path === '/sketchfab/search') {
      const q = String(ctx.query.q || '').trim()
      if (!q) {
        ctx.status = 400
        ctx.body = {
          error: 'missing_query',
          message: 'Query parameter "q" is required'
        }
        return
      }
      const licenseParam = String(
        ctx.query.license != null ? ctx.query.license : DEFAULT_LICENSE
      )
      try {
        const { results, next } = await sketchfabSearch({
          query: q,
          count: ctx.query.count,
          license: licenseParam === 'any' ? null : licenseParam,
          cursor: ctx.query.cursor
        })
        ctx.status = 200
        ctx.body = { results, next }
      } catch (e) {
        ctx.status = 500
        ctx.body = {
          error: 'search_failed',
          message: (e && e.message) || String(e)
        }
      }
      return
    }

    // GET /sketchfab/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/sketchfab/status/')) {
      const id = ctx.path.substring('/sketchfab/status/'.length)
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

    // POST /sketchfab/import
    if (ctx.method === 'POST' && ctx.path === '/sketchfab/import') {
      const body = ctx.request.body || {}
      const uid = String(body.uid || '').trim()
      const categoryId = String(body.categoryId || '').trim()
      if (!uid || !categoryId) {
        ctx.status = 400
        ctx.body = {
          error: 'missing_fields',
          message: 'uid and categoryId are required'
        }
        return
      }
      const displayName =
        String(body.name || '').trim() || `Sketchfab ${uid.slice(0, 6)}`
      const stripTextures =
        body.stripTextures === true ||
        body.stripTextures === 'true' ||
        body.stripTextures === 1 ||
        body.stripTextures === '1'
      // Placement type — 1=Floor (default), 2=Wall, 3=InWall, 4=Roof,
      // 7=InWallFloor, 8=InFloor, 9=WallFloor. Pazl's WallItem class
      // automatically docks the dragged item to the wall surface when
      // type=2, so an AC / lamp / mirror with type=2 will mount itself
      // to whatever wall the cursor hits.
      const placementType = (() => {
        const n = Number(body.type)
        return Number.isFinite(n) && n >= 0 ? n : 1
      })()
      const credit =
        body.credit && typeof body.credit === 'object' ? body.credit : null

      // Optional manual size from the import dialog. Any missing/invalid value
      // falls through to the measured size.
      const dimensionOverride =
        body.dimensions && typeof body.dimensions === 'object'
          ? {
              widthMm: Number(body.dimensions.widthMm),
              heightMm: Number(body.dimensions.heightMm),
              depthMm: Number(body.dimensions.depthMm)
            }
          : null

      const job = newJob()
      ctx.status = 202
      ctx.body = { jobId: job.id, status: 'queued' }

      runImport(job, app, {
        uid,
        displayName,
        categoryId,
        stripTextures,
        credit,
        placementType,
        dimensionOverride
      })
      return
    }

    return next()
  })
}
