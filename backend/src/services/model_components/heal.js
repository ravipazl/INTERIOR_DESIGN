// Self-heal for model_components.
//
// The Components panel reads a model's parts from the `model_components`
// collection. Those rows are normally created when a model is uploaded — but a
// model can end up with NONE (uploaded before that code existed, an import path
// that never created them, or a mesh-count that came back 0 at upload). When
// that happens the panel shows "No modifiable components" and, until now, the
// only fix was to run a manual seed script.
//
// This module removes that manual step: whenever the app asks for a model's
// components and finds ZERO, we read that model's GLB, count its meshes, and
// create the rows on the spot — so the model heals itself the first time it is
// opened. Fully guarded and non-fatal: any problem just leaves the result empty
// exactly as before, never blocking the read.

import fs from 'fs'
import path from 'path'
import url from 'url'
import { ObjectId } from 'mongodb'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// The SAME folder the upload service writes GLBs into, so we read from exactly
// where they were stored (honours the GLB_STORAGE_DIR override too).
const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

const GLTF_MAGIC = 0x46546c67 // "glTF"
const GLB_JSON_CHUNK = 0x4e4f534a // "JSON"

/**
 * Count meshes in a GLB buffer. three.js makes one Mesh per glTF *primitive*,
 * and the seed/upload name them Mesh_0..Mesh_N by that count — so we count
 * primitives to match. Returns 0 on any parse problem.
 */
function countPrimitives(buf) {
  try {
    if (!buf || buf.length < 12 || buf.readUInt32LE(0) !== GLTF_MAGIC) return 0
    const total = buf.readUInt32LE(8)
    let off = 12
    let gltf = null
    while (off + 8 <= total && off + 8 <= buf.length) {
      const clen = buf.readUInt32LE(off)
      const ctype = buf.readUInt32LE(off + 4)
      if (ctype === GLB_JSON_CHUNK) {
        gltf = JSON.parse(buf.slice(off + 8, off + 8 + clen).toString('utf8'))
        break
      }
      off += 8 + clen
    }
    if (!gltf || !Array.isArray(gltf.meshes)) return 0
    let n = 0
    for (const m of gltf.meshes) n += (m.primitives || []).length
    return n
  } catch (_) {
    return 0
  }
}

// modelIds currently being healed, so two concurrent reads of the same model
// can't both insert and produce duplicate Mesh_0 rows.
const inFlight = new Set()

/**
 * Ensure `modelId` has model_components; create them from its GLB if it has
 * none. Safe to call on every find — it no-ops the instant components exist.
 */
export async function ensureModelComponents(app, modelId) {
  const id = String(modelId || '')
  if (!id || inFlight.has(id)) return

  const db = await app.get('mongodbClient')
  const components = db.collection('model_components')

  if ((await components.countDocuments({ modelId: id })) > 0) return

  inFlight.add(id)
  try {
    // Re-check inside the lock — another request may have just healed it.
    if ((await components.countDocuments({ modelId: id })) > 0) return

    let model = null
    try {
      model = await db.collection('models').findOne({ _id: new ObjectId(id) })
    } catch (_) {
      return // not a valid ObjectId
    }
    if (!model) return

    const urlPath = model.modelFileUrl || ''
    if (!urlPath.startsWith('/')) {
      console.warn(`[model_components heal] ${id}: modelFileUrl missing/invalid`)
      return
    }

    const glbPath = path.join(GLB_STORAGE_DIR, path.basename(urlPath))
    if (!fs.existsSync(glbPath)) {
      console.warn(`[model_components heal] ${id}: GLB not on disk (${glbPath})`)
      return
    }

    const meshCount = countPrimitives(fs.readFileSync(glbPath))
    if (meshCount <= 0) {
      console.warn(`[model_components heal] ${id}: GLB has 0 meshes`)
      return
    }

    const now = new Date().toISOString()
    // Same shape the upload service and seed script produce. modelId MUST be a
    // STRING — the app queries by string modelId; an ObjectId here misses.
    const comps = Array.from({ length: meshCount }, (_, i) => ({
      modelId: id,
      name: `Mesh_${i}`,
      meshName: `Mesh_${i}`,
      meshIndex: i,
      componentType: 'external',
      defaultFinishingId: null,
      defaultFinishingBrandId: null,
      defaultExternalFinishGrainDirection: 'Horizontal',
      modelDefaultValues: [],
      createdAt: now,
      updatedAt: now
    }))
    await components.insertMany(comps)
    console.log(
      `[model_components heal] created ${meshCount} components for model ${id}`
    )
  } catch (err) {
    console.warn(
      `[model_components heal] ${id}: skipped (${err?.message || err})`
    )
  } finally {
    inFlight.delete(id)
  }
}

/**
 * Pull a single modelId out of the query, whichever shape it arrives in. The
 * app sends `$and[0][modelId]=X`, which parses to { $and: [ { modelId: X } ] },
 * but a plain { modelId: X } is also supported.
 */
function extractModelId(q) {
  if (!q) return null
  if (typeof q.modelId === 'string') return q.modelId
  if (Array.isArray(q.$and)) {
    for (const clause of q.$and) {
      if (clause && typeof clause.modelId === 'string') return clause.modelId
    }
  }
  return null
}

/**
 * FeathersJS before-find hook: if the query targets a single modelId that has
 * no components yet, create them from the GLB before the find runs — so the
 * find returns the freshly-created rows. Never blocks the read.
 */
export const healBeforeFind = async (context) => {
  try {
    const modelId = extractModelId(context.params?.query)
    if (modelId) {
      await ensureModelComponents(context.app, modelId)
    }
  } catch (_) {
    /* non-fatal — a heal failure must never break a read */
  }
  return context
}
