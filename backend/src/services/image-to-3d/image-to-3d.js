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
import { measureDocumentMm, resolveDimensions } from '../../utils/measure-glb.js'
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
import {
  config as claudeBlenderConfig,
  generateCandidate,
  takeDailyAllowance,
  refundDailyAllowance,
  tempRoot,
  UserFacingError
} from './claude-blender.js'

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
    // Measure while parsed — the record below stored a fixed 500 mm
    // placeholder and the frontend scales the mesh to match it.
    const measured = measureDocumentMm(doc)
    const out = await glbIo.writeBinary(doc)
    return {
      buffer: Buffer.from(out),
      componentNames,
      measured,
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
      // Real measured size. This used to be a fixed [500, 500, 500] "generic
      // default" — but it is not inert: the frontend SCALES a placed model to
      // match its declared dimensions, so the placeholder shrank every import.
      // Falls back to the old placeholder only if the model cannot be measured.
      dimensions: resolveDimensions(processed.measured).dimensions,
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

// ───────────────────────── Claude + Blender engine ─────────────────────────
//
// Same job/poll mechanics as Tripo, but the job ends at stage "preview_ready"
// with a candidate model. Nothing is written to the catalogue until the user
// presses "Add to catalogue" (POST /image-to-3d/accept/:id).

const PREVIEW_DIR = path.join(IMAGE_STORAGE_DIR, 'ai-previews')

/** Signed-in user or null (a 401 is already written). Every run spends Anthropic credits. */
async function requireUser(app, ctx) {
  const token = String(ctx.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  if (token) {
    try {
      const { user } = await app
        .service('authentication')
        .create({ strategy: 'jwt', accessToken: token })
      if (user) return user
    } catch (_) {
      /* fall through */
    }
  }
  ctx.status = 401
  ctx.body = { error: 'unauthenticated', message: 'Sign in to use Claude + Blender.' }
  return null
}

const userIdOf = (user) => String(user?._id ?? user?.id ?? '')

// Fields the browser may see (the candidate's file paths stay on the server).
const publicJob = (job) => {
  const { _private, ...rest } = job
  return rest
}

function scheduleCleanup(dir) {
  setTimeout(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (_) {
      /* ignore */
    }
  }, JOB_RETENTION_MS).unref?.()
}

async function runClaudeBlenderJob(job, app, params) {
  const { imageBuffer, sizeMm, categoryId, categoryName, displayName, hint, user, savedImageRelUrl, placementType } = params
  const workDir = path.join(tempRoot(), job.id)
  const db = await app.get('mongodbClient')
  try {
    const cand = await generateCandidate(job, {
      imageBuffer,
      sizeMm,
      categoryName,
      name: displayName,
      hint,
      workDir
    })

    fs.mkdirSync(PREVIEW_DIR, { recursive: true })
    const previewName = `${job.id}.jpg`
    fs.writeFileSync(path.join(PREVIEW_DIR, previewName), cand.previewJpeg)

    // Can the model be read back, and do its parts line up with what we will store?
    const doc = await glbIo.readBinary(new Uint8Array(fs.readFileSync(cand.glbPath)))
    const componentNames = extractComponentNamesFromDoc(doc)
    const measured = measureDocumentMm(doc)
    const got = { w: measured?.widthMm, d: measured?.depthMm, h: measured?.heightMm }
    const within = (have, want) => Number.isFinite(have) && Math.abs(have - want) / want <= 0.02
    const checks = {
      sizeWithin2Percent: within(got.w, sizeMm.w) && within(got.d, sizeMm.d) && within(got.h, sizeMm.h),
      namedParts: componentNames.length >= 3 && componentNames.every((n) => !/^(mesh|cube|part)_?\d*$/i.test(n)),
      opens: componentNames.length > 0
    }

    job._private = {
      userId: userIdOf(user),
      glbPath: cand.glbPath,
      componentNames,
      measured,
      categoryId,
      displayName,
      placementType,
      savedImageRelUrl,
      script: cand.script
    }
    scheduleCleanup(workDir)
    finishJob(job, {
      stage: 'preview_ready',
      progress: 100,
      result: {
        previewUrl: `/uploads/images/ai-previews/${previewName}`,
        sizeMm: { w: Math.round(got.w), d: Math.round(got.d), h: Math.round(got.h) },
        requestedSizeMm: sizeMm,
        parts: componentNames,
        triangles: cand.info.triangles,
        fixRounds: cand.rounds,
        differences: cand.differences,
        plan: cand.plan,
        checks,
        tokens: cand.tokens,
        seconds: Math.round((Date.now() - job.startedAt) / 1000)
      }
    })
    console.log(
      `[claude-blender] job ${job.id} ready: ${componentNames.length} parts, ${cand.info.triangles} tris, ` +
        `${cand.rounds} fix round(s), ${cand.claudeCalls} Claude calls, ${cand.tokens.input}+${cand.tokens.output} tokens, ` +
        `${Math.round((Date.now() - job.startedAt) / 1000)} s`
    )
  } catch (err) {
    await refundDailyAllowance(db, userIdOf(user))
    console.error(`[claude-blender] job ${job.id} failed:`, err?.message || err)
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch (_) {
      /* ignore */
    }
    finishJob(job, {
      stage: 'error',
      error: err instanceof UserFacingError ? err.message : "Couldn't build a model from this photo. Please try again."
    })
  }
}

/** Save the previewed candidate: GLB file + `models` row + `model_components` rows. */
async function acceptCandidate(app, job, overrides) {
  const p = job._private
  const displayName = overrides.name || p.displayName
  const categoryId = overrides.categoryId || p.categoryId
  const buffer = fs.readFileSync(p.glbPath)

  ensureDirs()
  const filename = `${uuidv4()}_${sanitizeFilename(displayName)}.glb`
  fs.writeFileSync(path.join(GLB_STORAGE_DIR, filename), buffer)
  const modelFileUrl = `/assets/models/glb/${filename}`

  let moduleName = ''
  try {
    const cat = await app.service('categories').get(categoryId)
    moduleName = cat?.name || ''
  } catch (_) {
    /* ignore */
  }

  const now = new Date().toISOString()
  const db = await app.get('mongodbClient')
  const ins = await db.collection('models').insertOne({
    name: displayName,
    modelFileUrl,
    thumbnail: '',
    thumbnails: '',
    categoryId,
    dimensions: resolveDimensions(p.measured).dimensions,
    maxWidth: 9999,
    standardWidth: [1, 500, 9999],
    price: 0,
    type: Number.isFinite(p.placementType) ? p.placementType : 1,
    description: 'AI-generated from photo (Claude + Blender)',
    hardware: '',
    isPazlSupplied: true,
    isUserUploaded: true,
    isAiGenerated: true,
    aiEngine: 'claude-blender',
    sourceImageUrl: p.savedImageRelUrl,
    moduleName,
    sizeBytes: buffer.length,
    createdAt: now,
    updatedAt: now
  })
  const modelId = String(ins.insertedId)

  // One row per real part. Part names are the GLB's own node names — they are what the
  // runtime mesh names will be, which is what the colour picker and the BOQ key on.
  const cNow = new Date().toISOString()
  const docs = p.componentNames.map((name, i) => ({
    modelId,
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
  if (docs.length) await db.collection('model_components').insertMany(docs)

  return { modelId, modelFileUrl, name: displayName, categoryId, componentsInserted: docs.length }
}

export const imageTo3d = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /image-to-3d/options — what the "Claude + Blender" engine offers this user right now
    if (ctx.method === 'GET' && ctx.path === '/image-to-3d/options') {
      const cfg = claudeBlenderConfig()
      const user = await requireUser(app, ctx)
      if (!user) return
      let used = 0
      try {
        const db = await app.get('mongodbClient')
        const row = await db.collection('ai_model_usage').findOne({
          userId: userIdOf(user),
          day: new Date().toISOString().slice(0, 10),
          engine: 'claude-blender'
        })
        used = row?.count || 0
      } catch (_) {
        /* show 0 */
      }
      ctx.status = 200
      ctx.body = {
        claudeBlender: {
          enabled: cfg.enabled && !!process.env.ANTHROPIC_API_KEY,
          dailyLimit: cfg.dailyLimit,
          usedToday: used
        }
      }
      return
    }

    // POST /image-to-3d/accept/:id — user pressed "Add to catalogue"
    if (ctx.method === 'POST' && ctx.path.startsWith('/image-to-3d/accept/')) {
      const user = await requireUser(app, ctx)
      if (!user) return
      const id = ctx.path.substring('/image-to-3d/accept/'.length)
      const job = jobs.get(id)
      if (!job || !job._private) {
        ctx.status = 404
        ctx.body = { error: 'not_found', message: 'This preview has expired. Generate it again.' }
        return
      }
      if (job._private.userId !== userIdOf(user)) {
        ctx.status = 403
        ctx.body = { error: 'forbidden', message: 'This preview belongs to someone else.' }
        return
      }
      if (job.accepted) {
        ctx.status = 200
        ctx.body = job.accepted
        return
      }
      try {
        const body = ctx.request.body || {}
        job.accepted = await acceptCandidate(app, job, {
          name: body.name && String(body.name).trim(),
          categoryId: body.categoryId
        })
        ctx.status = 200
        ctx.body = job.accepted
      } catch (err) {
        console.error('[claude-blender] accept failed:', err?.message || err)
        ctx.status = 500
        ctx.body = { error: 'accept_failed', message: "Couldn't add the model to the catalogue. Please try again." }
      }
      return
    }

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
      ctx.body = publicJob(job)
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

    // ── Claude + Blender engine (Tripo below is untouched) ──
    if (String(body.engine || '').toLowerCase() === 'claude-blender') {
      // A request refused below must not leave its photo behind on disk.
      const dropPhoto = () => fs.rmSync(savedPath, { force: true })
      const user = await requireUser(app, ctx)
      if (!user) return dropPhoto()
      const cfg = claudeBlenderConfig()
      if (!cfg.enabled) {
        // 400, not 503: the app's HTTP client treats 5xx as a crash and 401/403 as "signed out"
        ctx.status = 400
        ctx.body = { error: 'engine_off', message: 'Claude + Blender is switched off right now.' }
        return dropPhoto()
      }
      const sizeMm = { w: Number(body.widthMm), d: Number(body.depthMm), h: Number(body.heightMm) }
      if (![sizeMm.w, sizeMm.d, sizeMm.h].every((v) => Number.isFinite(v) && v > 0)) {
        ctx.status = 400
        ctx.body = {
          error: 'size_required',
          message: 'Enter the real width, depth and height in mm — Claude + Blender builds to that exact size.'
        }
        return dropPhoto()
      }
      const db = await app.get('mongodbClient')
      const allowance = await takeDailyAllowance(db, userIdOf(user))
      if (!allowance.ok) {
        ctx.status = 429
        ctx.body = {
          error: 'daily_limit',
          message: `Daily limit reached (${allowance.limit} Claude + Blender models). It resets at midnight UTC.`
        }
        return dropPhoto()
      }
      let categoryName = ''
      try {
        categoryName = (await app.service('categories').get(categoryId))?.name || ''
      } catch (_) {
        /* name is optional */
      }
      const cbJob = newJob()
      cbJob.engine = 'claude-blender'
      ctx.status = 202
      ctx.body = { jobId: cbJob.id, status: 'queued', usedToday: allowance.used, dailyLimit: allowance.limit }
      runClaudeBlenderJob(cbJob, app, {
        imageBuffer: file.buffer,
        sizeMm,
        categoryId,
        categoryName,
        displayName,
        hint: body.hint && String(body.hint).slice(0, 300),
        user,
        savedImageRelUrl,
        placementType
      })
      return
    }

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
