// AI render — MyArchitectAI.
//
// Sends a PICTURE of the 3D view (framed in the app's camera step) to
// MyArchitectAI and saves the photorealistic result next to the other renders.
// Also runs the follow-up tools on a render: relight, style transfer, edit by
// prompt, upscale and animate.
//
//   POST /ai-render                 { image, prompt?, outputFormat? } -> 202 { jobId }   (original interior render)
//   POST /ai-render/run             { op, ... } -> 202 { jobId }                       (every tool, see runOp)
//   POST /ai-render/auto-prompt     { image | sourceUrl } -> 200 { prompt, balance, cost }
//   GET  /ai-render/status/:id      current stage + result on done
//   GET  /ai-render/balance         remaining balance in USD (free; also proves the key)
//
// Every route needs a signed-in user: the key spends real money.
//
// Env (backend/.env — NEVER a REACT_APP_* var, which ships to the browser):
//   MYARCHITECT_API_KEY   required; sent as the `x-api-key` header
//   MYARCHITECT_BASE      default https://api.myarchitectai.com/v1
//   MYARCHITECT_FORMAT    default jpg   (webp | jpg | png | avif)
//
// API rules this follows (api-1.json):
//   - A 200 is a success only when the body has `output`; `error` means the job
//     failed and was refunded (cost 0).
//   - 429 (5 req/s, burst 20) and 502 are never charged: retry with backoff.
//   - Bodies are capped at 10 MB; 413 comes back as plain text.

import fs from 'fs'
import path from 'path'
import url from 'url'
import { v4 as uuidv4 } from 'uuid'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const BASE = (process.env.MYARCHITECT_BASE || 'https://api.myarchitectai.com/v1').replace(/\/$/, '')
const DEFAULT_FORMAT = process.env.MYARCHITECT_FORMAT || 'jpg'
const ALLOWED_FORMATS = ['webp', 'jpg', 'png', 'avif']
const apiKey = () => process.env.MYARCHITECT_API_KEY || ''

// Same folder as the Blender renders (backend/public/uploads/renders), which the
// static middleware serves at /uploads/renders/<name>. The AI renders used to be
// written to backend/uploads/renders — outside public — so their links 404'd.
const RENDER_STORAGE_DIR =
  process.env.RENDER_STORAGE_DIR || path.resolve(__dirname, '../../../public/uploads/renders')

// Their cap is 10 MB for the whole JSON body; leave room for the other fields.
const MAX_BODY_IMAGE_BYTES = Number(process.env.MYARCHITECT_MAX_BYTES || 9 * 1024 * 1024)

const JOB_RETENTION_MS = 30 * 60 * 1000
const jobs = new Map()

// Allowed values, straight from the API schema.
const INTERIOR_LIGHTING = ['midday_light', 'golden_light', 'blue_hour_light', 'ambient_light', 'warm_lamps', 'dimmed_mood']
const TIME_OF_DAY = ['early_morning', 'midday', 'overcast_day', 'golden_hour', 'sunset', 'blue_hour', 'night', 'starry_night', 'northern_lights', 'southern_lights']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const WEATHER = ['clear', 'overcast', 'rain', 'fog', 'snow']

function newJob(op) {
  const id = uuidv4()
  const job = {
    id,
    op,
    stage: 'queued', // queued -> rendering -> done | error
    step: null, // human label of the step in progress
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

function ensureDirs() {
  if (!fs.existsSync(RENDER_STORAGE_DIR)) {
    fs.mkdirSync(RENDER_STORAGE_DIR, { recursive: true })
  }
}

/** Turn an HTTP status into something an architect can act on. */
function describeHttpError(status, bodyText) {
  switch (status) {
    case 401:
    case 403:
      return 'The AI render service rejected the API key. Check MYARCHITECT_API_KEY in backend/.env and that the key is active.'
    case 402:
      return 'The MyArchitectAI balance has run out. Top up in the MyArchitectAI portal — nothing was charged.'
    case 413:
      return 'The image is too large for the AI render service (10 MB limit). Use a smaller image.'
    case 429:
      return 'The AI render service is busy (rate limit). Wait a moment and try again.'
    case 500:
    case 502:
    case 503:
      return 'The AI render service is having trouble. Try again shortly — nothing was charged.'
    default:
      return `AI render failed (HTTP ${status}). ${String(bodyText || '').slice(0, 200)}`
  }
}

/** Rough byte size of a data: URI payload, without decoding it. */
function dataUriBytes(image) {
  const comma = image.indexOf(',')
  if (comma < 0) return 0
  return Math.floor(((image.length - comma - 1) * 3) / 4)
}

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' }

/**
 * An image the API can read: a data: URI, a public https URL, or one of OUR
 * renders (/uploads/renders/<file>) — which their servers cannot reach, so it is
 * inlined as base64. Throws a readable error otherwise.
 */
function resolveImage(input, label = 'image') {
  if (!input || typeof input !== 'string') throw new Error(`"${label}" is required.`)
  if (input.startsWith('data:image/')) {
    if (dataUriBytes(input) > MAX_BODY_IMAGE_BYTES) throw new Error(`The ${label} is too large (over 9 MB).`)
    return input
  }
  if (input.startsWith('https://')) return input
  const m = input.match(/^\/uploads\/renders\/([A-Za-z0-9._-]+)$/)
  if (m) {
    const file = path.join(RENDER_STORAGE_DIR, m[1])
    if (!fs.existsSync(file)) throw new Error(`The ${label} file no longer exists on the server.`)
    const ext = path.extname(file).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext]
    if (!mime) throw new Error(`The ${label} must be an image (jpg, png, webp or avif).`)
    const buf = fs.readFileSync(file)
    if (buf.length * 4 / 3 > MAX_BODY_IMAGE_BYTES) {
      throw new Error(`The ${label} is too large to send (over 9 MB once encoded). Use a smaller render — 8K images can't be sent back.`)
    }
    return `data:${mime};base64,${buf.toString('base64')}`
  }
  throw new Error(`"${label}" must be a data:image/... URI, an https URL or a saved render.`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * POST one API endpoint. Retries 429 / 502 / 503 (never charged) with
 * exponential backoff + jitter. Returns the parsed body when it holds `output`;
 * throws a readable error otherwise.
 */
async function callApi(endpoint, body) {
  const key = apiKey()
  if (!key) throw new Error('MYARCHITECT_API_KEY is not set. Add it to backend/.env and restart the backend.')
  const delays = [1000, 2000, 4000, 8000]
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < delays.length) {
      await sleep(delays[attempt] + Math.floor(Math.random() * 400))
      continue
    }
    const text = await res.text().catch(() => '')
    if (!res.ok) throw new Error(describeHttpError(res.status, text))
    let data
    try {
      data = JSON.parse(text || '{}')
    } catch (_) {
      throw new Error('The AI render service returned an unreadable response.')
    }
    // A 200 is a success ONLY with `output`. `error` = failed after the stream
    // opened, already refunded.
    if (data?.error) {
      if (/forbid|unauthor|invalid.*key/i.test(String(data.error))) throw new Error(describeHttpError(403))
      const ref = data.requestId ? ` (request #${data.requestId} — nothing was charged)` : ''
      const err = new Error(`AI render failed: ${data.error}${ref}`)
      err.balance = data.balance
      throw err
    }
    if (data?.output === undefined || data?.output === null) {
      throw new Error('The AI render service returned no result.')
    }
    return data
  }
}

const firstOutput = (data) => (Array.isArray(data.output) ? data.output[0] : data.output)

/** Copy a result from THEIR host to ours (their links may expire). */
async function saveOutput(remoteUrl, name) {
  const res = await fetch(remoteUrl)
  if (!res.ok) throw new Error(`Could not download the AI result (HTTP ${res.status}).`)
  const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  let ext = EXT_BY_MIME[mime]
  if (!ext) {
    const m = String(remoteUrl).split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
    ext = m ? m[1].toLowerCase() : 'jpg'
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  ensureDirs()
  const outName = `${name}.${ext}`
  fs.writeFileSync(path.join(RENDER_STORAGE_DIR, outName), buffer)
  return { url: `/uploads/renders/${outName}`, mimeType: mime || MIME_BY_EXT[ext] || 'application/octet-stream' }
}

/** Keep the captured 3D view on our server so History can compare against it. */
function saveSourceIfInline(image, name) {
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return null
  const m = image.match(/^data:(image\/[a-z+]+);base64,(.*)$/i)
  if (!m) return null
  const ext = EXT_BY_MIME[m[1].toLowerCase()] || 'jpg'
  ensureDirs()
  const outName = `${name}.${ext}`
  fs.writeFileSync(path.join(RENDER_STORAGE_DIR, outName), Buffer.from(m[2], 'base64'))
  return `/uploads/renders/${outName}`
}

const pick = (value, allowed) => (allowed.includes(value) ? value : undefined)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : undefined)

/** Validate a /ai-render/run body and build the API calls it needs. */
function planOp(body) {
  const op = body.op
  const format = ALLOWED_FORMATS.includes(body.outputFormat) ? body.outputFormat : DEFAULT_FORMAT
  switch (op) {
    case 'render': {
      const scene = body.sceneType === 'exterior' ? 'exterior' : 'interior'
      const image = resolveImage(body.image || body.sourceUrl, 'view')
      const steps = [
        { label: `Rendering ${scene}`, endpoint: `/render/${scene}`, body: { image, outputFormat: format, prompt: text(body.prompt) } }
      ]
      // Scene context: one relight step after the render.
      const atmosphere =
        scene === 'interior'
          ? pick(body.lighting, INTERIOR_LIGHTING) && { sceneType: 'interior', lighting: body.lighting }
          : (() => {
              const a = {
                sceneType: 'exterior',
                timeOfDay: pick(body.timeOfDay, TIME_OF_DAY),
                season: pick(body.season, SEASONS),
                weather: pick(body.weather, WEATHER)
              }
              return a.timeOfDay || a.season || a.weather ? a : null
            })()
      if (atmosphere) steps.push({ label: 'Setting the lighting', endpoint: '/set-atmosphere', chain: true, body: atmosphere })
      return { steps, source: image, kind: 'image' }
    }
    case 'style': {
      const image = resolveImage(body.image || body.sourceUrl, 'view')
      const referenceImage = resolveImage(body.referenceImage, 'reference image')
      const strength = Number(body.strength)
      return {
        source: image,
        kind: 'image',
        steps: [
          {
            label: 'Applying the style',
            endpoint: '/style-transfer',
            body: {
              image,
              referenceImage,
              outputFormat: format,
              prompt: text(body.prompt),
              negativePrompt: text(body.negativePrompt),
              styleTransferStrength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : undefined
            }
          }
        ]
      }
    }
    case 'upscale': {
      const image = resolveImage(body.image || body.sourceUrl, 'image')
      const target = body.targetResolution === '8k' ? '8k' : '4k'
      let f = ['webp', 'jpg', 'png'].includes(body.outputFormat) ? body.outputFormat : 'jpg'
      if (target === '8k' && f === 'png') f = 'jpg' // png isn't available at 8K
      return { source: image, kind: 'image', steps: [{ label: `Upscaling to ${target.toUpperCase()}`, endpoint: '/upscale', body: { image, targetResolution: target, outputFormat: f } }] }
    }
    case 'edit': {
      const image = resolveImage(body.image || body.sourceUrl, 'image')
      const prompt = text(body.prompt)
      if (!prompt) throw new Error('Describe the change you want.')
      return {
        source: image,
        kind: 'image',
        steps: [
          {
            label: 'Applying the edit',
            endpoint: '/edit-by-prompt',
            body: { image, prompt, referenceImage: body.referenceImage ? resolveImage(body.referenceImage, 'reference image') : undefined }
          }
        ]
      }
    }
    case 'animate': {
      const startFrameUrl = resolveImage(body.image || body.sourceUrl, 'start frame')
      const prompt = text(body.prompt)
      if (!prompt) throw new Error('Describe the camera motion.')
      return {
        source: startFrameUrl,
        kind: 'video',
        steps: [
          {
            label: 'Animating (about a minute)',
            endpoint: '/animate',
            body: { startFrameUrl, prompt, endFrameUrl: body.endFrameUrl ? resolveImage(body.endFrameUrl, 'end frame') : undefined }
          }
        ]
      }
    }
    default:
      throw new Error(`Unknown AI operation "${op}".`)
  }
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

// keepSource: remember what the result was made from, for History's compare.
// `savedSource` is a render already on our server — reused, never copied again.
async function runPlan(job, plan, keepSource, savedSource) {
  try {
    job.stage = 'rendering'
    job.progress = 5
    job.lastUpdate = Date.now()
    let output = null
    let last = null
    let cost = 0
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      job.step = step.label
      job.progress = Math.round(5 + (80 * i) / plan.steps.length)
      job.lastUpdate = Date.now()
      const body = clean(step.chain ? { image: output, ...step.body } : step.body)
      last = await callApi(step.endpoint, body)
      cost += Number(last.cost) || 0
      output = firstOutput(last)
      if (!output) throw new Error('The AI render service returned no result.')
    }
    job.step = 'Saving'
    job.progress = 90
    job.lastUpdate = Date.now()
    const saved = await saveOutput(output, `ai-${job.id}`)
    const reuse = typeof savedSource === 'string' && /^\/uploads\/renders\/[A-Za-z0-9._-]+$/.test(savedSource)
    const sourceUrl = keepSource ? (reuse ? savedSource : saveSourceIfInline(plan.source, `ai-${job.id}-source`)) : null
    finishJob(job, {
      stage: 'done',
      step: null,
      progress: 100,
      result: {
        kind: plan.kind,
        imageUrl: plan.kind === 'image' ? saved.url : undefined,
        videoUrl: plan.kind === 'video' ? saved.url : undefined,
        mimeType: saved.mimeType,
        sourceUrl,
        balance: last?.balance,
        cost: Math.round(cost * 100) / 100,
        requestId: last?.requestId
      }
    })
  } catch (err) {
    finishJob(job, { stage: 'error', step: null, error: err?.message || String(err), balance: err?.balance })
  }
}

/** Signed-in user or null (and a 401 already written). */
async function requireUser(app, ctx) {
  const token = String(ctx.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    ctx.status = 401
    ctx.body = { error: 'unauthenticated', message: 'Sign in to use AI render.' }
    return null
  }
  try {
    const { user } = await app.service('authentication').create({ strategy: 'jwt', accessToken: token })
    if (user) return user
  } catch (_) {
    /* fall through */
  }
  ctx.status = 401
  ctx.body = { error: 'unauthenticated', message: 'Your session has expired. Sign in again.' }
  return null
}

export const aiRender = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    if (!ctx.path.startsWith('/ai-render')) return next()

    // GET /ai-render/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/ai-render/status/')) {
      if (!(await requireUser(app, ctx))) return
      const id = ctx.path.substring('/ai-render/status/'.length)
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

    // GET /ai-render/balance — free, and proves the key without spending.
    if (ctx.method === 'GET' && ctx.path === '/ai-render/balance') {
      if (!(await requireUser(app, ctx))) return
      if (!apiKey()) {
        ctx.status = 200
        ctx.body = { configured: false, message: 'MYARCHITECT_API_KEY is not set.' }
        return
      }
      try {
        const res = await fetch(`${BASE}/balance`, {
          method: 'POST',
          headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json' },
          body: '{}'
        })
        const raw = await res.text()
        if (!res.ok) {
          ctx.status = 200
          ctx.body = { configured: true, ok: false, message: describeHttpError(res.status, raw) }
          return
        }
        let data = {}
        try {
          data = JSON.parse(raw || '{}')
        } catch (_) {
          ctx.status = 200
          ctx.body = { configured: true, ok: false, message: 'The AI render service returned an unreadable response.' }
          return
        }
        if (data.error) {
          const forbidden = /forbid|unauthor|invalid.*key/i.test(String(data.error))
          ctx.status = 200
          ctx.body = {
            configured: true,
            ok: false,
            message: forbidden
              ? 'The AI render service rejected the API key. Activate the key in the MyArchitectAI portal, or check MYARCHITECT_API_KEY.'
              : `The AI render service reported: ${data.error}`
          }
          return
        }
        ctx.status = 200
        ctx.body = { configured: true, ok: true, ...data }
      } catch (err) {
        ctx.status = 200
        ctx.body = { configured: true, ok: false, message: err?.message || String(err) }
      }
      return
    }

    if (ctx.method !== 'POST') return next()
    const body = ctx.request.body || {}

    // POST /ai-render/auto-prompt — describe the view as a prompt ($0.01).
    if (ctx.path === '/ai-render/auto-prompt') {
      if (!(await requireUser(app, ctx))) return
      try {
        const image = resolveImage(body.image || body.sourceUrl, 'view')
        const data = await callApi('/auto-prompt', { image })
        ctx.status = 200
        ctx.body = { prompt: String(data.output || ''), balance: data.balance, cost: data.cost }
      } catch (err) {
        ctx.status = 400
        ctx.body = { error: 'auto_prompt_failed', message: err?.message || String(err) }
      }
      return
    }

    // POST /ai-render/run — every tool.
    if (ctx.path === '/ai-render/run') {
      if (!(await requireUser(app, ctx))) return
      let plan
      try {
        plan = planOp(body)
      } catch (err) {
        ctx.status = 400
        ctx.body = { error: 'bad_request', message: err?.message || String(err) }
        return
      }
      const job = newJob(body.op)
      ctx.status = 202
      ctx.body = { jobId: job.id, status: 'queued' }
      // Keep the captured view for renders / styles, so History can compare.
      // render / style / edit all produce a picture OF the view, so remember
      // what they were made from and History can show before ↔ after.
      runPlan(job, plan, ['render', 'style', 'edit'].includes(body.op), body.image ? null : body.sourceUrl)
      return
    }

    // POST /ai-render — the original interior render (kept for older callers).
    if (ctx.path === '/ai-render') {
      if (!(await requireUser(app, ctx))) return
      const image = body.image
      if (!image || typeof image !== 'string') {
        ctx.status = 400
        ctx.body = { error: 'no_image', message: '"image" is required — a data:image/... base64 URI or a public https URL' }
        return
      }
      let plan
      try {
        plan = planOp({ op: 'render', sceneType: 'interior', image, prompt: body.prompt, outputFormat: body.outputFormat })
      } catch (err) {
        ctx.status = /large/i.test(String(err?.message)) ? 413 : 400
        ctx.body = { error: 'bad_image', message: err?.message || String(err) }
        return
      }
      const job = newJob('render')
      ctx.status = 202
      ctx.body = { jobId: job.id, status: 'queued' }
      runPlan(job, plan, false)
      return
    }

    return next()
  })
}
