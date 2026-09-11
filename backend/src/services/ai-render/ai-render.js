// AI render — MyArchitectAI.
//
// A second render path alongside Blender. Blender renders the actual 3D model;
// this sends a PICTURE of the current 3D view to MyArchitectAI and gets a
// photorealistic image back. Seconds rather than minutes, and no GLB export,
// no Blender install, no camera JSON — but the result is an image *like* the
// room rather than a render *of* the model, so it is offered alongside the
// Blender path rather than replacing it.
//
//   POST /ai-render             { image, prompt?, outputFormat? } -> 202 { jobId }
//   GET  /ai-render/status/:id  current stage + result ({ imageUrl }) on done
//   GET  /ai-render/balance     remaining credits (free call; also proves the key)
//
// Env (backend/.env — NEVER a REACT_APP_* var, which ships to the browser):
//   MYARCHITECT_API_KEY   required; sent as the `x-api-key` header
//   MYARCHITECT_BASE      default https://api.myarchitectai.com/v1
//   MYARCHITECT_FORMAT    default jpg   (webp | jpg | png | avif)
//
// The job shape and the /uploads/renders storage deliberately mirror
// services/render/render.js, so the frontend polls and displays both the same
// way and finished images land in the same place.

import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const BASE = (process.env.MYARCHITECT_BASE || 'https://api.myarchitectai.com/v1').replace(/\/$/, '')
const API_KEY = process.env.MYARCHITECT_API_KEY || ''
const DEFAULT_FORMAT = process.env.MYARCHITECT_FORMAT || 'jpg'
const ALLOWED_FORMATS = ['webp', 'jpg', 'png', 'avif']

// Same directory the Blender renders go to, so both show up in render history
// and are served by the same static route.
const RENDER_STORAGE_DIR =
  process.env.RENDER_STORAGE_DIR || path.join(process.cwd(), 'uploads', 'renders')

// Their docs put a size limit on the request; base64 inflates a payload by ~⅓,
// so a large PNG screenshot overshoots easily. Reject early with a message the
// UI can act on rather than letting their API return a bare 413.
const MAX_IMAGE_BYTES = Number(process.env.MYARCHITECT_MAX_BYTES || 8 * 1024 * 1024)

const JOB_RETENTION_MS = 30 * 60 * 1000
const jobs = new Map()

function newJob() {
  const id = uuidv4()
  const job = {
    id,
    stage: 'queued', // queued -> rendering -> done | error
    progress: null,
    result: null, // { imageUrl, balance, cost, requestId } on success
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

/**
 * Turn an HTTP status into something an architect can act on.
 *
 * "Render failed" tells them nothing. Out of credits is an admin problem, a
 * rejected key is a configuration problem, and only 429 is worth retrying.
 */
function describeHttpError(status, bodyText) {
  switch (status) {
    case 401:
    case 403:
      return 'The AI render service rejected the API key. Check MYARCHITECT_API_KEY and that the key is active.'
    case 402:
      return 'AI render credits have run out. Top up the MyArchitectAI account to continue.'
    case 413:
      return 'The captured view is too large for the AI render service. Capture at a smaller size.'
    case 429:
      return 'The AI render service is rate limiting us. Wait a moment and try again.'
    case 500:
    case 502:
    case 503:
      return 'The AI render service is having trouble. Try again shortly.'
    default:
      return `AI render failed (HTTP ${status}). ${String(bodyText || '').slice(0, 200)}`
  }
}

/** Rough byte size of a data: URI payload, without decoding it. */
function dataUriBytes(image) {
  const comma = image.indexOf(',')
  if (comma < 0) return 0
  // 4 base64 chars -> 3 bytes.
  return Math.floor(((image.length - comma - 1) * 3) / 4)
}

async function runAiRender(job, { image, prompt, outputFormat }) {
  try {
    if (!API_KEY) {
      throw new Error(
        'MYARCHITECT_API_KEY is not set. Add it to backend/.env and restart the backend.'
      )
    }
    job.stage = 'rendering'
    job.progress = 10
    job.lastUpdate = Date.now()

    const format = ALLOWED_FORMATS.includes(outputFormat) ? outputFormat : DEFAULT_FORMAT
    const body = { image, outputFormat: format }
    if (prompt && String(prompt).trim()) body.prompt = String(prompt).trim()

    const res = await fetch(`${BASE}/render/interior`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(describeHttpError(res.status, text))
    }

    const data = await res.json()

    // A 200 does NOT mean success. Their documentation is explicit: inspect the
    // body — it carries `output` when the generation succeeded and `error` when
    // the job failed after the response stream opened. A failed job is refunded
    // (cost 0). Checking only res.ok would save a broken render and report done.
    if (data?.error) {
      // A rejected key arrives here as a 200 with { error: "Forbidden" }, which
      // is a setup problem rather than a render problem — say which.
      if (/forbid|unauthor|invalid.*key/i.test(String(data.error))) {
        throw new Error(describeHttpError(403))
      }
      throw new Error(`AI render failed: ${data.error}`)
    }
    const remoteUrl = Array.isArray(data?.output) ? data.output[0] : null
    if (!remoteUrl) {
      throw new Error('AI render returned no image.')
    }

    job.progress = 70
    job.lastUpdate = Date.now()

    // Download it. `output` is a URL on THEIR host; keeping only that link would
    // leave render history pointing at a third party that may expire it, so the
    // image is copied next to the Blender renders and served from here.
    const imgRes = await fetch(remoteUrl)
    if (!imgRes.ok) {
      throw new Error(`Could not download the AI render (HTTP ${imgRes.status}).`)
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer())

    ensureDirs()
    const outName = `ai-${job.id}.${format}`
    fs.writeFileSync(path.join(RENDER_STORAGE_DIR, outName), buffer)

    finishJob(job, {
      stage: 'done',
      progress: 100,
      result: {
        imageUrl: `/uploads/renders/${outName}`,
        balance: data.balance,
        cost: data.cost,
        requestId: data.requestId
      }
    })
  } catch (err) {
    finishJob(job, { stage: 'error', error: err?.message || String(err) })
  }
}

export const aiRender = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /ai-render/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/ai-render/status/')) {
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

    // GET /ai-render/balance — free, and the only way to prove the key works
    // without spending a credit. The UI calls this when the panel opens.
    if (ctx.method === 'GET' && ctx.path === '/ai-render/balance') {
      if (!API_KEY) {
        ctx.status = 200
        ctx.body = { configured: false, message: 'MYARCHITECT_API_KEY is not set.' }
        return
      }
      try {
        const res = await fetch(`${BASE}/balance`, {
          method: 'POST',
          headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
          body: '{}'
        })
        const text = await res.text()
        if (!res.ok) {
          ctx.status = 200
          ctx.body = { configured: true, ok: false, message: describeHttpError(res.status, text) }
          return
        }
        // A 200 is not a success here either. A rejected key comes back as
        // HTTP 200 with { error: "Forbidden" }, so trusting the status alone
        // would report the key as working and only fail later, mid-render,
        // after the architect had already framed the shot.
        let data = {}
        try {
          data = JSON.parse(text || '{}')
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

    // POST /ai-render
    if (ctx.path !== '/ai-render' || ctx.method !== 'POST') {
      return next()
    }

    const body = ctx.request.body || {}
    const image = body.image

    if (!image || typeof image !== 'string') {
      ctx.status = 400
      ctx.body = {
        error: 'no_image',
        message: '"image" is required — a data:image/... base64 URI or a public https URL'
      }
      return
    }
    // A local render is not reachable from their servers, so a bare path could
    // never work; say so rather than letting it fail confusingly downstream.
    if (!image.startsWith('data:image/') && !image.startsWith('https://')) {
      ctx.status = 400
      ctx.body = {
        error: 'bad_image',
        message: '"image" must be a data:image/... base64 URI or a public https URL'
      }
      return
    }
    if (image.startsWith('data:image/') && dataUriBytes(image) > MAX_IMAGE_BYTES) {
      ctx.status = 413
      ctx.body = {
        error: 'image_too_large',
        message: 'The captured view is too large. Capture as JPEG with the long edge around 1536px.'
      }
      return
    }

    const job = newJob()
    ctx.status = 202
    ctx.body = { jobId: job.id, status: 'queued' }

    // Fire and forget; the frontend polls /ai-render/status/:id. Not queued the
    // way Blender is — that queue exists because Blender saturates the CPU, and
    // this is a network call.
    runAiRender(job, {
      image,
      prompt: body.prompt,
      outputFormat: body.outputFormat
    })
  })
}
