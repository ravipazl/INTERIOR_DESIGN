// Photorealistic render service.
//
// Takes the room exported by the app (.glb) + the current camera, renders it
// with headless Blender (Cycles, CPU) via ../../../render/render.py, and serves
// the resulting PNG from the backend's public folder.
//
// Two endpoints (mirrors image-to-3d):
//   POST /render                start a render job, returns { jobId }
//   GET  /render/status/:id     current stage + result ({ imageUrl }) on done
//
// Renders are CPU-heavy, so jobs run ONE AT A TIME through a simple queue —
// the POST returns immediately with stage "queued"; the frontend polls /status.

import path from 'path'
import fs from 'fs'
import os from 'os'
import url from 'url'
import { spawn } from 'child_process'
import multer from '@koa/multer'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Blender binary — override with BLENDER_BIN on the server if not on PATH.
const BLENDER_BIN = process.env.BLENDER_BIN || 'blender'
// The render script lives at the backend root: pazl-design-backend/render/.
const RENDER_SCRIPT = path.resolve(__dirname, '../../../render/render.py')
// Optional HDRI for realistic lighting — set RENDER_HDRI to an .hdr path.
const RENDER_HDRI = process.env.RENDER_HDRI || ''
// Selectable lighting environments (the sky the room is lit by). Each name maps
// to render/environments/<name>.hdr. The frontend sends `settings.environment`;
// an unknown or missing name simply falls through to render.py's own default.
const ENVIRONMENTS_DIR = path.resolve(__dirname, '../../../render/environments')
const ENVIRONMENTS = ['daylight', 'sunset', 'night', 'forest', 'overcast', 'studio']

/** Absolute path of a named environment HDRI, or null if it isn't available. */
function resolveEnvironment(name) {
  if (!name) return null
  const key = String(name).toLowerCase()
  // Whitelist first: `name` arrives from the client, so never let it build a
  // path of its own (../../etc) — only these six literals can ever be used.
  if (!ENVIRONMENTS.includes(key)) {
    console.warn(`[render] unknown environment "${name}" — ignoring`)
    return null
  }
  const file = path.join(ENVIRONMENTS_DIR, `${key}.hdr`)
  if (fs.existsSync(file)) return file
  // Say so. This returned null silently, render.py fell back to whatever .hdr
  // it could find, and every one of the six choices produced an identical
  // image — a picker that looked like it worked and did nothing. A missing
  // file is a deployment problem and should be visible as one.
  console.warn(
    `[render] environment "${key}" selected but ${key}.hdr is missing from ` +
      `${ENVIRONMENTS_DIR} — falling back to the default sky`
  )
  return null
}
// Where rendered PNGs are written (served statically at /uploads/renders/...).
const RENDER_STORAGE_DIR =
  process.env.RENDER_STORAGE_DIR ||
  path.resolve(__dirname, '../../../public/uploads/renders')

const MAX_GLB_BYTES = 200 * 1024 * 1024 // 200 MB (textured rooms can be big)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_GLB_BYTES }
})

// In-memory job tracker, same shape/cleanup as image-to-3d.
const jobs = new Map()
const JOB_RETENTION_MS = 60 * 60 * 1000

function newJob() {
  const id = uuidv4()
  const job = {
    id,
    stage: 'queued', // queued -> rendering -> done | error
    progress: null,
    result: null, // { imageUrl } on success
    error: null,
    queuePosition: null,
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

// --- single-slot render queue (CPU-heavy: never run two at once) ----------
let queueTail = Promise.resolve()
let pending = 0

function enqueueRender(job, params) {
  pending += 1
  job.queuePosition = pending
  queueTail = queueTail.then(async () => {
    pending -= 1
    job.queuePosition = 0
    await runRenderJob(job, params)
  })
  return queueTail
}

/** Per-material overrides from the app's Materials panel: { name: {type,…} }. */
function normaliseMaterials(materials) {
  if (!materials || typeof materials !== 'object' || Array.isArray(materials)) {
    return null
  }
  const out = {}
  for (const [name, spec] of Object.entries(materials)) {
    if (!name || !spec || typeof spec !== 'object') continue
    const entry = {}
    if (spec.type) entry.type = String(spec.type).toLowerCase()
    // Colour must be a #rrggbb hex — never trust a client string as-is.
    if (typeof spec.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.color)) {
      entry.color = spec.color.toLowerCase()
    }
    // Sliders are optional and must stay inside 0..1 — they come from a client.
    for (const key of ['roughness', 'metallic', 'transmission']) {
      const v = Number(spec[key])
      if (Number.isFinite(v)) entry[key] = Math.min(Math.max(v, 0), 1)
    }
    if (Object.keys(entry).length) out[String(name)] = entry
  }
  return Object.keys(out).length ? out : null
}

/**
 * RGB white-balance multiplier for a colour temperature (Tanner Helland),
 * luminance-normalised so it shifts warm/cool WITHOUT changing brightness.
 * ~[1,1,1] at 6500 K; lower Kelvin = warmer, higher = cooler.
 */
function kelvinRgb(kelvin) {
  const t = Math.max(1000, Math.min(12000, kelvin)) / 100
  let r, g, b
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }
  if (t >= 66) b = 255
  else if (t <= 19) b = 0
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const rgb = [r, g, b].map((c) => Math.max(0, Math.min(255, c)) / 255)
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  return lum > 1e-4 ? rgb.map((c) => c / lum) : rgb
}

/**
 * Apply the flat colour grade (Enscape's Image tab) to the finished PNG with
 * sharp: temperature, saturation, highlights, shadows, vignette. Done here
 * rather than in Blender's compositor because sharp behaves identically on
 * every Blender version. Neutral values are a no-op — the file is only rewritten
 * when at least one knob was actually moved. Fully guarded: a failure logs and
 * leaves the original render untouched.
 */
async function applyColorGrade(outPath, settings, job) {
  const kelvin = Number(settings?.temperature)
  const saturation = Number(settings?.saturation)
  const highlights = Number(settings?.highlights)
  const shadows = Number(settings?.shadows)
  const vignette = Number(settings?.vignette)
  const contrast = Number(settings?.contrast)
  const autoContrast = !!settings?.autoContrast

  const hasTemp = Number.isFinite(kelvin) && Math.abs(kelvin - 6500) > 1
  const hasSat = Number.isFinite(saturation) && Math.abs(saturation - 1) > 0.01
  const hasHi = Number.isFinite(highlights) && Math.abs(highlights) > 0.01
  const hasSh = Number.isFinite(shadows) && Math.abs(shadows) > 0.01
  const hasVig = Number.isFinite(vignette) && vignette > 0.01
  const hasContrast = Number.isFinite(contrast) && Math.abs(contrast) > 0.01
  if (
    !hasTemp &&
    !hasSat &&
    !hasHi &&
    !hasSh &&
    !hasVig &&
    !hasContrast &&
    !autoContrast
  )
    return

  try {
    const input = fs.readFileSync(outPath)
    const meta = await sharp(input).metadata()
    let img = sharp(input)

    // Auto-contrast: stretch the histogram to use the full range first, so any
    // manual grade below sits on top of an already-balanced image.
    if (autoContrast) img = img.normalise()

    // Temperature tint × highlights slope, a shadows offset, AND contrast — all
    // folded into ONE linear pass (out = in*a + b per channel). Contrast pivots
    // around mid-grey: out = in*c + 127.5*(1-c); composed with the tint/slope it
    // becomes a_final = tint*slope*c, b_final = off*c + 127.5*(1-c). Sized to the
    // image's channels so an alpha channel is passed through untouched.
    if (hasTemp || hasHi || hasSh || hasContrast) {
      const tint = hasTemp ? kelvinRgb(kelvin) : [1, 1, 1]
      const slope = 1 + (hasHi ? highlights * 0.3 : 0)
      const off = hasSh ? shadows * 25 : 0 // ~0.1 on a 0..255 scale
      const c = hasContrast ? 1 + contrast / 100 : 1 // -100..100 -> 0..2
      const cb = 127.5 * (1 - c)
      const ch = meta.channels || 3
      const a = []
      const b = []
      for (let i = 0; i < ch; i += 1) {
        a.push(i < 3 ? tint[i] * slope * c : 1)
        b.push(i < 3 ? off * c + cb : 0)
      }
      img = img.linear(a, b)
    }

    if (hasSat) img = img.modulate({ saturation })

    if (hasVig && meta.width && meta.height) {
      // A radial gradient: white (no change) in the centre, darkening to the
      // corners, multiplied into the image.
      const k = Math.round(255 * (1 - Math.min(1, vignette)))
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">` +
          `<defs><radialGradient id="v" cx="50%" cy="50%" r="72%">` +
          `<stop offset="55%" stop-color="rgb(255,255,255)"/>` +
          `<stop offset="100%" stop-color="rgb(${k},${k},${k})"/>` +
          `</radialGradient></defs>` +
          `<rect width="100%" height="100%" fill="url(#v)"/></svg>`
      )
      img = img.composite([{ input: svg, blend: 'multiply' }])
    }

    const isJpeg = /\.jpe?g$/i.test(outPath)
    const buf = await (isJpeg ? img.jpeg({ quality: 92 }) : img.png()).toBuffer()
    fs.writeFileSync(outPath, buf)
    console.log('[render] colour grade applied')
    if (job) job.log = (job.log || '') + '[render] colour grade applied\n'
  } catch (e) {
    console.warn('[render] colour grade skipped:', e?.message)
    if (job) {
      job.log = (job.log || '') + `[render] colour grade skipped: ${e?.message}\n`
    }
  }
}

async function runRenderJob(job, { glbBuffer, camera, settings }) {
  let workDir
  try {
    job.stage = 'rendering'
    job.lastUpdate = Date.now()

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pazl-render-'))
    const glbPath = path.join(workDir, 'room.glb')
    fs.writeFileSync(glbPath, glbBuffer)

    let cameraPath = null
    if (camera && camera.position) {
      cameraPath = path.join(workDir, 'camera.json')
      fs.writeFileSync(cameraPath, JSON.stringify(camera))
    }

    // File extension follows the chosen format (render.py writes exactly here).
    const isJpeg = String(settings?.format || '').toUpperCase() === 'JPEG'
    const outName = `${job.id}.${isJpeg ? 'jpg' : 'png'}`
    const outPath = path.join(RENDER_STORAGE_DIR, outName)

    // The user's chosen sky wins; then a server-wide RENDER_HDRI override; then
    // nothing, and render.py falls back to whatever .hdr sits in render/.
    const envHdri = resolveEnvironment(settings?.environment)
    const hdri =
      envHdri || (RENDER_HDRI && fs.existsSync(RENDER_HDRI) ? RENDER_HDRI : null)

    // render.py picks the overrides file out by its *name*, so it must contain
    // "material" — the camera is the other .json argument.
    let materialsPath = null
    const materials = normaliseMaterials(settings?.materials)
    if (materials) {
      materialsPath = path.join(workDir, 'materials.json')
      fs.writeFileSync(materialsPath, JSON.stringify(materials))
    }

    const args = ['-b', '-P', RENDER_SCRIPT, '--', glbPath, outPath]
    if (hdri) args.push(hdri)
    if (cameraPath) args.push(cameraPath)
    if (materialsPath) args.push(materialsPath)

    // Quality overrides are passed to render.py via env (it reads these).
    const env = { ...process.env }
    if (settings?.samples) env.PAZL_SAMPLES = String(settings.samples)
    if (settings?.width) env.PAZL_RES_X = String(settings.width)
    if (settings?.height) env.PAZL_RES_Y = String(settings.height)
    if (settings?.view) env.PAZL_VIEW = String(settings.view)
    if (settings?.engine) env.PAZL_ENGINE = String(settings.engine)
    if (settings?.format) env.PAZL_FORMAT = String(settings.format)
    if (settings?.exposure !== undefined && settings?.exposure !== null)
      env.PAZL_EXPOSURE = String(settings.exposure)
    if (settings?.denoise !== undefined)
      env.PAZL_DENOISE = settings.denoise ? '1' : '0'
    // 3D "finish" effects that must happen inside Blender (they depend on the
    // scene, not the flat image): depth of field and sky rotation. render.py
    // defaults both to off. The colour grades are applied AFTER, on the PNG.
    const num = (v) => (v === undefined || v === null ? null : Number(v))
    if (Number.isFinite(num(settings?.dof)))
      env.PAZL_DOF = String(settings.dof)
    if (Number.isFinite(num(settings?.skyRotation)))
      env.PAZL_SKY_ROTATION = String(settings.skyRotation)
    if (settings?.whiteBackground) env.PAZL_WHITE_BG = '1'
    // Lighting controls (Enscape's Atmosphere tab). Sun time -1 = off.
    if (Number.isFinite(num(settings?.sunTime)))
      env.PAZL_SUN_TIME = String(settings.sunTime)
    if (Number.isFinite(num(settings?.sunDir)))
      env.PAZL_SUN_DIR = String(settings.sunDir)
    if (Number.isFinite(num(settings?.artificialLight)))
      env.PAZL_LIGHT_SCALE = String(settings.artificialLight)

    await runBlenderWithEnv(args, env, job)

    if (!fs.existsSync(outPath)) {
      throw new Error('Blender finished but produced no image')
    }

    // Flat colour grade (Enscape's Image tab): temperature, saturation,
    // highlights, shadows, vignette — done on the finished PNG with sharp so it
    // is identical on every Blender version (the compositor node API is not).
    // Neutral values are a no-op, so an untouched render is never re-encoded.
    await applyColorGrade(outPath, settings, job)

    finishJob(job, {
      stage: 'done',
      progress: 100,
      result: { imageUrl: `/uploads/renders/${outName}` }
    })
  } catch (err) {
    finishJob(job, { stage: 'error', error: err?.message || String(err) })
  } finally {
    // Keep the last run's Blender output next to the rendered images. The work
    // directory is wiped below, so without this the only record of what Blender
    // actually did disappears the moment the render finishes — which makes a
    // render that came out wrong impossible to diagnose after the fact.
    try {
      if (job?.log) {
        // Named after the job so each render keeps its own log. A single
        // shared file is overwritten by the next render — including a quick
        // preview run straight after — so the log for the render you actually
        // want to look at is routinely gone by the time you look.
        fs.writeFileSync(
          path.join(RENDER_STORAGE_DIR, `${job.id}.log`),
          job.log
        )
      }
    } catch (_) {
      /* diagnostics only — never fail a render over the log */
    }
    // Optionally keep the exact inputs Blender was given. A render that comes
    // out wrong cannot be reproduced from the image and the log alone — you
    // need the scene itself. Off by default so normal runs leave nothing
    // behind; set PAZL_KEEP_INPUTS=1 when investigating.
    if (process.env.PAZL_KEEP_INPUTS === '1' && workDir) {
      try {
        for (const name of ['room.glb', 'camera.json', 'materials.json']) {
          const from = path.join(workDir, name)
          if (fs.existsSync(from)) {
            fs.copyFileSync(from, path.join(RENDER_STORAGE_DIR, `${job.id}-${name}`))
          }
        }
        console.log(`[render] kept inputs for job ${job.id}`)
      } catch (e) {
        console.warn('[render] could not keep inputs:', e?.message)
      }
    }
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true })
      } catch (_) {
        /* ignore */
      }
    }
  }
}

// spawn variant that takes an env (kept separate so runBlender stays simple)
function runBlenderWithEnv(args, env, job) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(BLENDER_BIN, args, { windowsHide: true, env })
    } catch (e) {
      reject(e)
      return
    }
    let stderr = ''
    // Blender's own diagnostics ([PAZL RENDER] ... mesh counts, camera
    // placement, HDRI path, warnings) were being read purely for the progress
    // percentage and then dropped, so nothing ever reached the console. A
    // render that comes back wrong looked identical to one that came back
    // right. Keep the progress parsing, and surface the diagnostics.
    child.stdout.on('data', (d) => {
      const text = d.toString()
      const m = text.match(/Sample\s+(\d+)\/(\d+)/)
      if (m) {
        job.progress = Math.round((Number(m[1]) / Number(m[2])) * 100)
        job.lastUpdate = Date.now()
      }
      for (const line of text.split('\n')) {
        if (line.includes('[PAZL RENDER]')) console.log(line.trim())
      }
      job.log = (job.log || '') + text
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      job.log = (job.log || '') + d.toString()
    })
    child.on('error', (e) => reject(e))
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Blender exited ${code}: ${stderr.slice(-800)}`))
    )
  })
}

export const render = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /render/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/render/status/')) {
      const id = ctx.path.substring('/render/status/'.length)
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

    // POST /render
    if (ctx.path !== '/render' || ctx.method !== 'POST') {
      return next()
    }

    try {
      await upload.single('model')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = { error: 'upload_failed', message: err.message || String(err) }
      return
    }

    const file = ctx.request.file
    if (!file) {
      ctx.status = 400
      ctx.body = {
        error: 'no_model',
        message: 'multipart field "model" (.glb) is required'
      }
      return
    }

    const body = ctx.request.body || {}
    let camera = null
    let settings = null
    try {
      if (body.camera) camera = JSON.parse(body.camera)
    } catch (_) {
      /* ignore bad camera -> auto-frame */
    }
    try {
      if (body.settings) settings = JSON.parse(body.settings)
    } catch (_) {
      /* ignore */
    }

    const job = newJob()
    ctx.status = 202
    ctx.body = { jobId: job.id, status: 'queued', queuePosition: job.queuePosition }

    // Queue it (serialised) — fire and forget; frontend polls /render/status.
    enqueueRender(job, { glbBuffer: file.buffer, camera, settings })
  })
}
