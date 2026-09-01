// Tripo API client — Node port of C:/SKETHUP/backend/services/tripo.py
//
// Three responsibilities:
//   1. uploadImageToTripo(buffer, filename, mime) → image_token
//   2. createImageToModelTask(imageToken, fileType, opts) → task_id
//   3. createRetopoTask(baseTaskId, opts) → task_id
//   4. pollTask(taskId, jobTracker?, stageLabel?) → task data on success
//   5. extractUrl(data, ...keys) → URL string or null

import axios from 'axios'
import FormData from 'form-data'

// All env vars are read at function-call time (not module load) because
// dotenv.config() runs AFTER `import` statements resolve in ESM. If we
// captured the values into top-level consts they would all be undefined.

function tripoBase() {
  return process.env.TRIPO_BASE || 'https://api.tripo3d.ai/v2/openapi'
}
function tripoModelVersion() {
  return process.env.TRIPO_MODEL_VERSION || 'v2.5-20250123'
}
function pollIntervalMs() {
  return (Number(process.env.TRIPO_POLL_INTERVAL_SEC) || 3) * 1000
}
function pollTimeoutMs() {
  return (Number(process.env.TRIPO_POLL_TIMEOUT_SEC) || 600) * 1000
}

function authHeaders() {
  const key = process.env.TRIPO_API_KEY
  if (!key) {
    throw new Error(
      'TRIPO_API_KEY is not set in pazl-design-backend/.env. Add it and restart the backend.'
    )
  }
  return { Authorization: `Bearer ${key}` }
}

export function isGlb(url) {
  if (!url) return false
  const lower = String(url).split('?', 1)[0].toLowerCase()
  return lower.endsWith('.glb') || lower.endsWith('.gltf')
}

/**
 * Look for a URL under output.{key} OR result.{key}.url for each key.
 * Mirrors SKETHUP's extract_url helper.
 */
export function extractUrl(data, ...keys) {
  const output = data?.output || {}
  const result = data?.result || {}
  for (const key of keys) {
    const v = output[key]
    if (typeof v === 'string' && v) return v
    const nested = result[key]
    if (nested && typeof nested === 'object') {
      const u = nested.url
      if (typeof u === 'string' && u) return u
    }
  }
  return null
}

export async function uploadImageToTripo(buffer, filename, mime) {
  const form = new FormData()
  form.append('file', buffer, { filename, contentType: mime })
  const res = await axios.post(`${tripoBase()}/upload/sts`, form, {
    headers: { ...authHeaders(), ...form.getHeaders() },
    timeout: 120000
  })
  const token = res.data?.data?.image_token
  if (!token) {
    throw new Error(
      `Tripo /upload/sts did not return an image_token. Response: ${JSON.stringify(
        res.data
      )}`
    )
  }
  return token
}

export async function createImageToModelTask(
  imageToken,
  fileType,
  { smartMesh = true, faceLimit = 5000, texture = false } = {}
) {
  const body = {
    type: 'image_to_model',
    model_version: tripoModelVersion(),
    file: { type: fileType, file_token: imageToken },
    texture: Boolean(texture),
    auto_size: true
  }
  if (smartMesh) {
    body.smart_low_poly = true
    body.face_limit = faceLimit
  }
  const res = await axios.post(`${tripoBase()}/task`, body, {
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    timeout: 60000,
    validateStatus: () => true
  })
  if (res.status >= 400) {
    throw new Error(
      `Tripo image_to_model rejected (HTTP ${res.status}): ${JSON.stringify(
        res.data
      )} \nSent body: ${JSON.stringify(body)}`
    )
  }
  const taskId = res.data?.data?.task_id
  if (!taskId) throw new Error('Tripo image_to_model: no task_id in response')
  return taskId
}

export async function createRetopoTask(
  baseTaskId,
  { faceLimit = 5000, texture = false } = {}
) {
  const body = {
    type: 'convert_model',
    format: 'OBJ',
    original_model_task_id: baseTaskId,
    face_limit: faceLimit
  }
  // Only include texture_size if textures are requested — otherwise Tripo
  // may still bake a texture pass we don't want.
  if (texture) {
    body.texture_size = 4096
  }
  const res = await axios.post(`${tripoBase()}/task`, body, {
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    timeout: 60000,
    validateStatus: () => true
  })
  if (res.status >= 400) {
    throw new Error(
      `Tripo convert_model rejected (HTTP ${res.status}): ${JSON.stringify(
        res.data
      )}`
    )
  }
  const taskId = res.data?.data?.task_id
  if (!taskId) throw new Error('Tripo convert_model: no task_id in response')
  return taskId
}

/**
 * Poll a Tripo task until success / failure / timeout.
 * Optionally updates a tracker object so the frontend can poll progress.
 */
export async function pollTask(taskId, jobTracker, stageLabel) {
  const start = Date.now()
  const timeoutMs = pollTimeoutMs()
  const intervalMs = pollIntervalMs()
  while (Date.now() - start < timeoutMs) {
    const res = await axios.get(`${tripoBase()}/task/${taskId}`, {
      headers: authHeaders(),
      timeout: 30000
    })
    const data = res.data?.data || {}
    const status = data.status
    const pct = Number.isFinite(data.progress) ? Number(data.progress) : null

    if (jobTracker && stageLabel) {
      jobTracker.stage = `${stageLabel}: ${status}${pct != null ? ` (${pct}%)` : ''}`
      jobTracker.progress = pct
      jobTracker.lastUpdate = Date.now()
    }

    if (status === 'success') return data
    if (status === 'failed' || status === 'cancelled' || status === 'banned') {
      throw new Error(
        `Tripo task ${status}: ${JSON.stringify(data)}`
      )
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Tripo task ${taskId} timed out after ${timeoutMs}ms`)
}

/**
 * Download a remote URL (Tripo CDN) as a Buffer.
 */
export async function downloadAsBuffer(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180000
  })
  return Buffer.from(res.data)
}
