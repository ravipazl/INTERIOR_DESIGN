// Image-to-3D: accept a photo + category, run it through Tripo, save the
// resulting GLB to the frontend's public folder, insert a `models` row.
//
// Two endpoints:
//   POST /image-to-3d              start a generation job, returns { jobId }
//   GET  /image-to-3d/status/:id   returns current stage/progress/result
//
// The job runs asynchronously on the backend. Frontend polls /status until
// it sees stage === "done" (result populated) or stage === "error".

import path from 'path'
import fs from 'fs'
import url from 'url'
import multer from '@koa/multer'
import { v4 as uuidv4 } from 'uuid'
import { ObjectId } from 'mongodb'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import {
  uploadImageToTripo,
  createImageToModelTask,
  createRetopoTask,
  pollTask,
  extractUrl,
  isGlb,
  downloadAsBuffer
} from './tripo.js'

// gltf-transform IO used only to read the saved GLB and enumerate its
// meshes — we don't re-write the Tripo output, just inspect it so we can
// seed one `model_components` row per Mesh. Without those rows the object
// panel's Components section shows "No modifiable components" and the
// texture-apply UI has nothing to target. (Same root cause we fix on the
// Sketchfab import path.)
const glbIo = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// Predict three.js GLTFLoader naming: one THREE.Mesh per Primitive, named
// after its parent Node, suffixed by primitive index for multi-primitive
// Meshes. The same logic lives in sketchfab.js — kept duplicated here so
// the two services stay independent.
async function extractMeshComponentNames(buffer) {
  try {
    const doc = await glbIo.readBinary(new Uint8Array(buffer))
    return extractComponentNamesFromDoc(doc)
  } catch (e) {
    console.warn(
      `[image-to-3d] mesh name extraction failed: ${(e && e.message) || e}`
    )
    return []
  }
}

// Pure helper — given an already-loaded gltf-transform doc, predict the
// runtime three.js mesh names. Reused by extractMeshComponentNames AND by
// processTripoGlb after the rename step.
function extractComponentNamesFromDoc(doc) {
  const out = []
  const seen = new Set()
  let fallback = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const base = node.getName() || mesh.getName() || `Mesh_${fallback++}`
    const prims = mesh.listPrimitives()
    const names =
      prims.length <= 1 ? [base] : prims.map((_, i) => `${base}_${i}`)
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

// -------- Tripo GLB sanitisation (parity with sketchfab.js) ----------------
//
// Tripo GLBs are usually clean — no fancy PBR extensions, no animations —
// so this pass is mostly about renaming meshes to "Mesh_0", "Mesh_1", ...
// so the Components panel reads cleanly AND the runtime mesh names match
// what we store in `model_components.meshName`. (Without that match the
// color picker writes to a row whose meshName isn't in the loaded scene,
// and the colour never appears.)
//
// Sanitisation runs inside a try/catch — on ANY failure we fall back to
// saving the original Tripo buffer unchanged so the import still completes.

const SAFE_MATERIAL_EXTENSIONS = new Set(['KHR_materials_unlit'])
const COMPRESSION_EXTENSIONS = new Set([
  'EXT_meshopt_compression',
  'KHR_draco_mesh_compression'
])

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

function dropUnsafeExtensions(doc) {
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    const n = ext.extensionName
    if (COMPRESSION_EXTENSIONS.has(n) || !SAFE_MATERIAL_EXTENSIONS.has(n)) {
      ext.dispose()
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

async function processTripoGlb(buffer) {
  try {
    const doc = await glbIo.readBinary(new Uint8Array(buffer))
    dropAnimationsAndMorphTargets(doc)
    dropUnsafeExtensions(doc)
    renameMeshesSequentially(doc)
    const componentNames = extractComponentNamesFromDoc(doc)
    const out = await glbIo.writeBinary(doc)
    return {
      buffer: Buffer.from(out),
      componentNames,
      ok: true
    }
  } catch (e) {
    console.warn(
      `[image-to-3d] processTripoGlb failed: ${
        (e && e.message) || e
      }; saving original Tripo GLB unchanged`
    )
    return { buffer, componentNames: [], ok: false }
  }
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const IMAGE_STORAGE_DIR =
  process.env.IMAGE_STORAGE_DIR ||
  path.resolve(__dirname, '../../../public/uploads/images')

const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES }
})

// In-memory job tracker. Keyed by jobId. Frontend polls /status to read.
// Entries are cleaned up 1 hour after completion to free memory.
const jobs = new Map()
const JOB_RETENTION_MS = 60 * 60 * 1000

function newJob() {
  const id = uuidv4()
  const job = {
    id,
    stage: 'queued',
    progress: null,
    result: null, // populated on success: { modelId, modelFileUrl, name, ... }
    error: null, // populated on failure
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
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function ensureDirs() {
  if (!fs.existsSync(IMAGE_STORAGE_DIR)) {
    fs.mkdirSync(IMAGE_STORAGE_DIR, { recursive: true })
  }
  if (!fs.existsSync(GLB_STORAGE_DIR)) {
    fs.mkdirSync(GLB_STORAGE_DIR, { recursive: true })
  }
}

async function runJob(job, app, params) {
  const {
    imageBuffer,
    imageMime,
    imageExt,
    fileType,
    savedImageRelUrl,
    categoryId,
    displayName,
    faceLimit,
    texture,
    placementType
  } = params

  try {
    // 1. Upload image to Tripo
    job.stage = 'uploading_image'
    job.lastUpdate = Date.now()
    const imageToken = await uploadImageToTripo(
      imageBuffer,
      `image.${imageExt}`,
      imageMime
    )

    // 2. Create image_to_model task
    job.stage = 'base_creating'
    job.lastUpdate = Date.now()
    const baseTaskId = await createImageToModelTask(imageToken, fileType, {
      smartMesh: true,
      faceLimit,
      texture
    })

    // 3. Poll base task
    const baseData = await pollTask(baseTaskId, job, 'base')
    const baseGlbUrl = extractUrl(
      baseData,
      'pbr_model',
      'model',
      'base_model',
      'smart_low_poly_model',
      'low_poly_model'
    )

    // 4. Create retopo (convert_model) task
    job.stage = 'retopo_creating'
    job.lastUpdate = Date.now()
    const retopoTaskId = await createRetopoTask(baseTaskId, {
      faceLimit,
      texture
    })

    // 5. Poll retopo task
    const retopoData = await pollTask(retopoTaskId, job, 'retopo')
    const retopoGlbUrl = extractUrl(retopoData, 'pbr_model', 'rendered_image')

    // 6. Pick the GLB to download
    const glbUrl = isGlb(retopoGlbUrl)
      ? retopoGlbUrl
      : isGlb(baseGlbUrl)
        ? baseGlbUrl
        : null
    if (!glbUrl) {
      throw new Error(
        'Neither base nor retopo task returned a GLB URL. Tripo response missing pbr_model.'
      )
    }

    // 7. Download GLB
    job.stage = 'downloading_glb'
    job.lastUpdate = Date.now()
    const glbBuffer = await downloadAsBuffer(glbUrl)

    // 7b. Sanitise — rename meshes to Mesh_N + drop animations / unsafe
    //     extensions. On failure, processTripoGlb returns the ORIGINAL
    //     buffer untouched so the import still completes.
    const processed = await processTripoGlb(glbBuffer)
    const bufferToWrite = processed.buffer
    let preExtractedNames = processed.componentNames

    // 8. Save GLB to frontend public folder
    const safeName = sanitizeFilename(displayName)
    const filename = `${uuidv4()}_${safeName}.glb`
    const fullPath = path.join(GLB_STORAGE_DIR, filename)
    fs.writeFileSync(fullPath, bufferToWrite)
    const modelFileUrl = `/assets/models/glb/${filename}`

    // 9. Look up category for moduleName
    let moduleName = ''
    try {
      const cat = await app.service('categories').get(categoryId)
      moduleName = cat?.name || ''
    } catch (_) {
      /* ignore */
    }

    // 10. Insert models row
    const now = new Date().toISOString()
    const doc = {
      name: displayName,
      modelFileUrl,
      thumbnail: '',
      thumbnails: '',
      categoryId,
      dimensions: [500, 500, 500], // generic default; auto-scale fits on load
      maxWidth: 9999,
      standardWidth: [1, 500, 9999],
      price: 0,
      type: Number.isFinite(placementType) ? placementType : 1,
      description: 'AI-generated from photo',
      hardware: '',
      isPazlSupplied: true,
      isUserUploaded: true,
      isAiGenerated: true,
      sourceImageUrl: savedImageRelUrl,
      tripoBaseTaskId: baseTaskId,
      tripoRetopoTaskId: retopoTaskId,
      moduleName,
      sizeBytes: bufferToWrite.length,
      sizeBytesOriginal: glbBuffer.length,
      createdAt: now,
      updatedAt: now
    }
    const db = await app.get('mongodbClient')
    const ins = await db.collection('models').insertOne(doc)
    // String(...) for the same reason sketchfab.js does it — see comment
    // there. Keeps modelId on the new model_components rows as a real
    // string so the frontend's string query finds them.
    const newModelId = String(ins.insertedId)

    // Seed one `model_components` row per Mesh, matching the seeded-catalog
    // shape EXACTLY (meshName, meshIndex, componentType, defaultFinishingId,
    // …) — without those fields the color picker writes into nothing and
    // colour never appears. Same fix the Sketchfab import already applies.
    let componentsInserted = 0
    try {
      // Prefer names from the sanitised doc (Mesh_0, Mesh_1, …). If
      // sanitisation failed, fall back to extracting from the raw Tripo
      // buffer so the panel still populates.
      let componentNames = preExtractedNames
      if (!componentNames.length) {
        componentNames = await extractMeshComponentNames(bufferToWrite)
      }
      if (componentNames.length) {
        const cNow = new Date().toISOString()
        const modelIdStr = String(newModelId)
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
          createdAt: cNow,
          updatedAt: cNow
        }))
        const cIns = await db
          .collection('model_components')
          .insertMany(componentDocs)
        componentsInserted = cIns.insertedCount || componentDocs.length
        console.log(
          `[image-to-3d] inserted ${componentsInserted} model_components (Mesh_N rows) for model ${modelIdStr}; sanitised=${processed.ok}`
        )
      }
    } catch (e) {
      console.warn(
        `[image-to-3d] model_components seeding failed: ${
          (e && e.message) || e
        }`
      )
    }

    finishJob(job, {
      stage: 'done',
      progress: 100,
      result: {
        modelId: newModelId,
        modelFileUrl,
        name: displayName,
        categoryId,
        baseTaskId,
        retopoTaskId,
        sourceImageUrl: savedImageRelUrl,
        componentsInserted
      }
    })
  } catch (err) {
    finishJob(job, {
      stage: 'error',
      error: err?.message || String(err)
    })
  }
}

export const imageTo3d = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /image-to-3d/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/image-to-3d/status/')) {
      const id = ctx.path.substring('/image-to-3d/status/'.length)
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

    // POST /image-to-3d
    if (ctx.path !== '/image-to-3d' || ctx.method !== 'POST') {
      return next()
    }

    try {
      await upload.single('image')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = {
        error: 'upload_failed',
        message: err.message || String(err)
      }
      return
    }

    const file = ctx.request.file
    if (!file) {
      ctx.status = 400
      ctx.body = {
        error: 'no_image',
        message: 'multipart field "image" is required'
      }
      return
    }
    const body = ctx.request.body || {}
    const categoryId = body.categoryId
    if (!categoryId) {
      ctx.status = 400
      ctx.body = {
        error: 'missing_categoryId',
        message: 'categoryId is required'
      }
      return
    }

    // Validate image
    const originalName = file.originalname || 'image.jpg'
    const ext = originalName.split('.').pop().toLowerCase()
    if (!ALLOWED_EXTS.has(ext)) {
      ctx.status = 400
      ctx.body = {
        error: 'invalid_extension',
        message: `Only ${[...ALLOWED_EXTS].join('/')} supported`
      }
      return
    }
    const fileType = ext === 'jpg' ? 'jpeg' : ext

    // Save image to backend public/uploads/images
    const savedName = `${uuidv4()}.${ext}`
    const savedPath = path.join(IMAGE_STORAGE_DIR, savedName)
    fs.writeFileSync(savedPath, file.buffer)
    const savedImageRelUrl = `/uploads/images/${savedName}`

    const displayName =
      (body.name && String(body.name).trim()) ||
      `AI generated ${new Date().toISOString().substring(0, 19)}`
    const faceLimit = Number(body.faceLimit) || 5000
    // Default: no texture (smaller GLB, mesh-only). Frontend can opt in by
    // sending texture="true" in the multipart body.
    const texture =
      String(body.texture || '').toLowerCase() === 'true' ||
      body.texture === true ||
      body.texture === 1 ||
      body.texture === '1'

    // Placement type — 1=Floor (default), 2=Wall, 3=InWall, 4=Roof,
    // 7=InWallFloor, 8=InFloor, 9=WallFloor. See sketchfab.js for the full
    // mapping; pazl's Factory picks the right Item subclass on placement.
    const placementType = (() => {
      const n = Number(body.type)
      return Number.isFinite(n) && n >= 0 ? n : 1
    })()

    // Create job + start async
    const job = newJob()
    ctx.status = 202
    ctx.body = { jobId: job.id, status: 'queued' }

    // Fire-and-forget — job updates itself in `jobs` map
    runJob(job, app, {
      imageBuffer: file.buffer,
      imageMime: file.mimetype,
      imageExt: ext,
      fileType,
      savedImageRelUrl,
      categoryId,
      displayName,
      faceLimit,
      texture,
      placementType
    })
  })
}
