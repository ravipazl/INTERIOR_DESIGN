// POST /model-upload   (Koa route, bypasses Feathers service abstraction)
//
// Accepts one .glb file at a time via multipart/form-data:
//   file        the .glb binary
//   name        display name (defaults to filename minus extension)
//   categoryId  Mongo _id of the sub-category to attach to (required)
//   type        1=Floor, 2=Wall, 3=Tall (default: 1)
//   width       mm (default: 450)
//   price       (default: 0)
//   description (default: '')
//
// Writes the file to:
//   pazl-design-frontend/public/assets/models/glb/<uuid>_<safe>.glb
// Inserts a row into `models` collection. Returns the new row.

import path from 'path'
import fs from 'fs'
import url from 'url'
import multer from '@koa/multer'
import { v4 as uuidv4 } from 'uuid'
import gltfPipeline from 'gltf-pipeline'

const { processGlb } = gltfPipeline

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

const MAX_BYTES = Number(process.env.MAX_GLB_BYTES) || 25 * 1024 * 1024 // 25 MB
const PUBLIC_URL_PREFIX = '/assets/models/glb'
const GLTF_MAGIC = 0x46546c67 // "glTF" little-endian uint32

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function isGlbBuffer(buf) {
  if (!buf || buf.length < 4) return false
  return buf.readUInt32LE(0) === GLTF_MAGIC
}

const GLB_JSON_CHUNK = 0x4e4f534a // "JSON"

function centerAndCountGlb(buf) {
  try {
    if (!buf || buf.length < 12 || buf.readUInt32LE(0) !== GLTF_MAGIC) {
      return { buffer: buf, meshCount: 0 }
    }
    const total = buf.readUInt32LE(8)
    const chunks = []
    let gltf = null
    let off = 12
    while (off + 8 <= total && off + 8 <= buf.length) {
      const clen = buf.readUInt32LE(off)
      const ctype = buf.readUInt32LE(off + 4)
      const data = buf.slice(off + 8, off + 8 + clen)
      chunks.push({ type: ctype, data })
      if (ctype === GLB_JSON_CHUNK && !gltf) {
        gltf = JSON.parse(data.toString('utf8'))
      }
      off += 8 + clen
    }
    if (!gltf || !Array.isArray(gltf.meshes) || !Array.isArray(gltf.accessors)) {
      return { buffer: buf, meshCount: 0 }
    }

    // meshCount = total primitives (three.js makes one Mesh per primitive).
    let meshCount = 0
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity
    for (const m of gltf.meshes) {
      for (const p of m.primitives || []) {
        meshCount++
        const ai = p.attributes && p.attributes.POSITION
        if (ai == null) continue
        const a = gltf.accessors[ai]
        if (!a || !a.min || !a.max) continue
        mnx = Math.min(mnx, a.min[0]); mxx = Math.max(mxx, a.max[0])
        mnz = Math.min(mnz, a.min[2]); mxz = Math.max(mxz, a.max[2])
      }
    }

    if (Number.isFinite(mnx) && Number.isFinite(mnz)) {
      const cx = (mnx + mxx) / 2
      const cz = (mnz + mxz) / 2
      const roots =
        (gltf.scenes && gltf.scenes[gltf.scene || 0] && gltf.scenes[gltf.scene || 0].nodes) || []
      const rootIdx = roots.length ? roots[0] : null
      const rootNode = rootIdx != null && gltf.nodes ? gltf.nodes[rootIdx] : null
      // Only shift when meaningfully off-center AND the root has no baked matrix
      // (a matrix would need full decomposition — skip to stay safe).
      if (rootNode && !rootNode.matrix && (Math.abs(cx) > 1e-4 || Math.abs(cz) > 1e-4)) {
        const t = rootNode.translation || [0, 0, 0]
        rootNode.translation = [t[0] - cx, t[1], t[2] - cz]

        let json = Buffer.from(JSON.stringify(gltf), 'utf8')
        const pad = (4 - (json.length % 4)) % 4
        if (pad) json = Buffer.concat([json, Buffer.alloc(pad, 0x20)])
        const ji = chunks.findIndex((c) => c.type === GLB_JSON_CHUNK)
        chunks[ji] = { type: GLB_JSON_CHUNK, data: json }

        let bodyLen = 0
        for (const c of chunks) bodyLen += 8 + c.data.length
        const out = Buffer.alloc(12 + bodyLen)
        out.writeUInt32LE(GLTF_MAGIC, 0)
        out.writeUInt32LE(2, 4)
        out.writeUInt32LE(12 + bodyLen, 8)
        let o = 12
        for (const c of chunks) {
          out.writeUInt32LE(c.data.length, o)
          out.writeUInt32LE(c.type, o + 4)
          c.data.copy(out, o + 8)
          o += 8 + c.data.length
        }
        return { buffer: out, meshCount }
      }
    }
    return { buffer: buf, meshCount }
  } catch (err) {
    return { buffer: buf, meshCount: 0 }
  }
}

export const modelUpload = (app) => {
  // Ensure target dir exists
  if (!fs.existsSync(GLB_STORAGE_DIR)) {
    fs.mkdirSync(GLB_STORAGE_DIR, { recursive: true })
  }

  app.use(async (ctx, next) => {
    if (ctx.path !== '/model-upload' || ctx.method !== 'POST') {
      return next()
    }

    try {
      await upload.single('file')(ctx, async () => {})
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
      ctx.body = { error: 'no_file', message: 'multipart field "file" is required' }
      return
    }

    if (!file.originalname.toLowerCase().endsWith('.glb')) {
      ctx.status = 400
      ctx.body = { error: 'wrong_extension', message: 'Only .glb files are accepted' }
      return
    }

    if (!isGlbBuffer(file.buffer)) {
      ctx.status = 400
      ctx.body = {
        error: 'invalid_glb',
        message: 'File does not start with glTF magic bytes — not a valid GLB'
      }
      return
    }

    
    const body = ctx.request.body || {}
    const categoryId = body.categoryId
    if (!categoryId) {
      ctx.status = 400
      ctx.body = { error: 'missing_categoryId', message: 'categoryId is required' }
      return
    }

    // We expect clients to upload pre-decoded GLBs (no compression). We do NOT
    // run gltf-pipeline here, because passing dracoOptions actually ENABLES
    // Draco compression on the output — the opposite of what we want for old
    // Three.js compatibility. The file is written as-is.
    //
    // If clients ever upload meshopt / Draco / quantized files in the future,
    // the right place to decompress is gltf-transform (which the user runs
    // offline via the C:/GLB/decoded batch pipeline). Doing it server-side
    // would require @gltf-transform/core as a backend dependency.
    // Auto-center the GLB (X & Z) and count its meshes — server-side, so EVERY
    // upload is fixed automatically regardless of the client. Defensive: falls
    // back to the original buffer on any parse issue.
    const centered = centerAndCountGlb(file.buffer)
    const bufferToWrite = centered.buffer
    const autoMeshCount = centered.meshCount
    const wasNormalized = false
    const normalizationWarning = null

    // Generate filename + write to frontend's public folder
    const safeOriginal = sanitizeFilename(file.originalname)
    const filename = `${uuidv4()}_${safeOriginal}`
    const fullPath = path.join(GLB_STORAGE_DIR, filename)
    try {
      fs.writeFileSync(fullPath, bufferToWrite)
    } catch (err) {
      ctx.status = 500
      ctx.body = {
        error: 'write_failed',
        message: `Failed to write GLB to ${fullPath}: ${err.message}`
      }
      return
    }

    const modelFileUrl = `${PUBLIC_URL_PREFIX}/${filename}`
    const width = Number(body.width) || 450
    // Height / Depth now come from the upload form (measured from the GLB or
    // typed by the user). Fall back to the old placeholders if not supplied so
    // older clients keep working.
    const height = Number(body.height) || 815
    const depth = Number(body.depth) || 550
    const price = Number(body.price) || 0
    const type = Number(body.type) || 1

    // Look up the category to fill moduleName
    let moduleName = ''
    try {
      const cat = await app.service('categories').get(categoryId)
      moduleName = cat?.name || ''
    } catch (e) {
      // category lookup failure isn't fatal — keep going
    }

    const baseName = (body.name && String(body.name).trim()) || safeOriginal.replace(/\.glb$/i, '')

    const now = new Date().toISOString()
    const doc = {
      _id: undefined, // let Mongo assign
      name: baseName,
      modelFileUrl,
      thumbnail: '',
      thumbnails: '',
      categoryId,
      // pazl stores dimensions as [HEIGHT, WIDTH, DEPTH] in mm.
      dimensions: [height, width, depth],
      maxWidth: width,
      standardWidth: [width],
      price,
      type,
      description: body.description ? String(body.description) : '',
      hardware: '',
      isPazlSupplied: true,
      isUserUploaded: true,
      sourceCode: '',
      moduleName,
      createdAt: now,
      updatedAt: now,
      sizeBytes: bufferToWrite.length,
      sizeBytesOriginal: file.size,
      wasNormalized,
      normalizationWarning: normalizationWarning || undefined
    }
    delete doc._id

    let created
    let db
    try {
      // Bypass the service's schema validator (it has strict required fields).
      // Write directly to the underlying Mongo collection.
      db = await app.get('mongodbClient')
      const result = await db.collection('models').insertOne(doc)
      created = { _id: result.insertedId.toString(), ...doc }
    } catch (err) {
      // Roll back the file write so we don't leave orphans on disk
      try { fs.unlinkSync(fullPath) } catch (_) {}
      ctx.status = 500
      ctx.body = {
        error: 'db_insert_failed',
        message: err.message || String(err)
      }
      return
    }

    // Create one editable component per mesh (Mesh_0, Mesh_1, …) so uploaded
    // models get modifiable materials just like the built-in ones. meshCount is
    // measured in the browser (same recursive order the engine names meshes).
    // Fully additive + non-fatal: on any error the model still uploads exactly
    // as before, so nothing existing is affected.
    // Prefer the server-counted meshes (robust — no client dependency); fall
    // back to a client-supplied meshCount if the server parse found none.
    const meshCount = Math.max(
      0,
      Math.floor(autoMeshCount || Number(body.meshCount) || 0)
    )
    if (meshCount > 0) {
      try {
        const compNow = new Date().toISOString()
        const comps = Array.from({ length: meshCount }, (_, i) => ({
          // MUST be a STRING — the app queries model_components by string
          // modelId. Storing an ObjectId here makes the lookup miss and the
          // panel show "No modifiable components" even though rows exist.
          modelId: String(created._id),
          name: `Mesh_${i}`,
          meshName: `Mesh_${i}`,
          meshIndex: i,
          componentType: 'external',
          defaultFinishingId: null,
          defaultFinishingBrandId: null,
          defaultExternalFinishGrainDirection: 'Horizontal',
          modelDefaultValues: [],
          createdAt: compNow,
          updatedAt: compNow
        }))
        await db.collection('model_components').insertMany(comps)
      } catch (compErr) {
        console.error('[model-upload] model_components create failed:', compErr?.message || compErr)
      }
    }

    ctx.status = 201
    ctx.body = created
  })
}
