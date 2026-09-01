// Orbit-video service.
//
// Takes the room exported by the app (.glb) and turns it into a short MP4 that
// orbits once from inside the room, using the HyperFrames composition in
// ../../../video/. The MP4 is served from the same public folder as the stills.
//
//   POST /video               multipart "model" (.glb) -> { jobId }
//   GET  /video/status/:id    stage + { videoUrl } when done
//
// WHAT THIS IS NOT: the video is drawn by Three.js in a headless browser — the
// same renderer that draws the app's 3D view — with image-based lighting and
// filmic tone mapping to close the gap. It is NOT Cycles. A photorealistic
// animation would mean running Cycles once per frame: 360 frames at ~20 min is
// about five days for twelve seconds. The UI should say so.
//
// The composition folder is a TEMPLATE and is never rendered in place: each job
// copies it to its own temp directory before dropping the model in, so two
// people rendering at once cannot overwrite each other's room.glb.

import path from 'path'
import fs from 'fs'
import os from 'os'
import url from 'url'
import { spawn } from 'child_process'
import multer from '@koa/multer'
import { v4 as uuidv4 } from 'uuid'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// The HyperFrames project template (index.html, hyperframes.json, vendored three).
const TEMPLATE_DIR = path.resolve(__dirname, '../../../video')

// Where MP4s are written — the same folder the stills use, so both are served
// by the existing static mount at /uploads/renders/...
const VIDEO_STORAGE_DIR =
  process.env.RENDER_STORAGE_DIR ||
  path.resolve(__dirname, '../../../public/uploads/renders')

/**
 * Folders to put on the child's PATH so HyperFrames can find ffmpeg/ffprobe.
 *
 * HyperFrames shells out to both and only ever looks on PATH, so whatever we
 * spawn has to be able to see them. Rather than depend on the host having them
 * installed — which differs between a Windows laptop and a Linux server, and is
 * the sort of thing that works locally then fails in production — the binaries
 * come from ffmpeg-static/ffprobe-static. npm downloads the build matching
 * whatever machine runs `npm install`, so dev and live need no configuration
 * and no .env entry.
 *
 * The two packages install to different directories, hence a list. FFMPEG_DIR
 * is still honoured and takes priority, so an operator can point at a
 * system build (a non-GPL one, say) without a code change.
 */
const FFMPEG_PATH_DIRS = [
  process.env.FFMPEG_DIR,
  ffmpegPath ? path.dirname(ffmpegPath) : null,
  ffprobeStatic?.path ? path.dirname(ffprobeStatic.path) : null
].filter(Boolean)

const MAX_GLB_BYTES = 200 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_GLB_BYTES }
})

const jobs = new Map()
const JOB_RETENTION_MS = 60 * 60 * 1000

function newJob() {
  const id = uuidv4()
  const job = {
    id,
    stage: 'queued', // queued -> rendering -> done | error
    progress: null,
    result: null, // { videoUrl } on success
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
  if (!fs.existsSync(VIDEO_STORAGE_DIR)) {
    fs.mkdirSync(VIDEO_STORAGE_DIR, { recursive: true })
  }
}

/**
 * Put `dir` at the front of the child's PATH.
 *
 * Windows names the variable `Path`, not `PATH`, and which casing Node hands us
 * depends on how the server was launched (`npm start` gives `Path`, a direct
 * `node src` gives `PATH`). Spreading process.env into a plain object keeps
 * whatever casing arrived, so blindly assigning `env.PATH` can leave the child
 * holding BOTH `Path` and `PATH` — and Windows then resolves neither, so even
 * `npx` goes missing. Always write back to the key that is already there.
 */
function prependToPath(env, dirs) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
  const prefix = dirs.join(path.delimiter)
  env[key] = env[key] ? `${prefix}${path.delimiter}${env[key]}` : prefix
}

// One at a time. HyperFrames drives a headless browser and encodes video; two
// concurrent runs would fight over cores and both finish slower than if they
// had queued.
let queueTail = Promise.resolve()
let pending = 0

function enqueueVideo(job, params) {
  pending += 1
  job.queuePosition = pending
  queueTail = queueTail.then(async () => {
    pending -= 1
    job.queuePosition = 0
    await runVideoJob(job, params)
  })
  return queueTail
}

/** Copy the composition template into `dest`, minus anything job-specific. */
function copyTemplate(dest) {
  fs.cpSync(TEMPLATE_DIR, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src)
      // Never carry a previous job's model or output across.
      return base !== 'room.glb' && base !== 'renders' && base !== 'node_modules'
    }
  })
}

/**
 * Newest .mp4 under `dir`.
 *
 * HyperFrames names its output with a timestamp
 * (`pazl-3d_2026-07-20_17-15-25.mp4`), so there is no fixed filename to look
 * for — take whichever appeared last.
 */
function newestMp4(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .map((f) => {
      const full = path.join(dir, f)
      return { full, mtime: fs.statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return files.length ? files[0].full : null
}

function runHyperframes(workDir, job) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    if (FFMPEG_PATH_DIRS.length) prependToPath(env, FFMPEG_PATH_DIRS)

    let child
    try {
      // `npx --yes` so a fresh server does not stall on an install prompt.
      child = spawn('npx', ['--yes', 'hyperframes@0.7.60', 'render'], {
        cwd: workDir,
        env,
        shell: process.platform === 'win32',
        windowsHide: true
      })
    } catch (e) {
      reject(e)
      return
    }

    let tail = ''
    const absorb = (buf) => {
      const text = buf.toString()
      tail = (tail + text).slice(-4000)
      job.log = (job.log || '') + text
      const m =
        text.match(/(\d+)\s*\/\s*(\d+)\s*frames?/i) ||
        text.match(/frame\s+(\d+)\s*\/\s*(\d+)/i)
      if (m) {
        job.progress = Math.round((Number(m[1]) / Number(m[2])) * 100)
        job.lastUpdate = Date.now()
      }
      // ffmpeg missing is the most common deployment failure and HyperFrames
      // still exits 0, so catch it explicitly rather than shipping a blank video.
      if (/FFmpeg not found|FFprobe not found/i.test(text)) {
        job.ffmpegMissing = true
      }
    }
    child.stdout.on('data', absorb)
    child.stderr.on('data', absorb)

    child.on('error', reject)
    child.on('close', (code) => {
      if (job.ffmpegMissing) {
        reject(
          new Error(
            'ffmpeg/ffprobe not found. They ship with the app via ' +
              'ffmpeg-static/ffprobe-static, so this usually means `npm install` ' +
              'could not download them (no internet at install time). Reinstall, ' +
              'or set FFMPEG_DIR to a folder holding ffmpeg and ffprobe.'
          )
        )
        return
      }
      code === 0
        ? resolve()
        : reject(new Error(`hyperframes exited ${code}: ${tail.slice(-800)}`))
    })
  })
}

async function runVideoJob(job, { glbBuffer }) {
  let workDir
  try {
    job.stage = 'rendering'
    job.lastUpdate = Date.now()
    ensureDirs()

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pazl-video-'))
    copyTemplate(workDir)
    const assetsDir = path.join(workDir, 'assets')
    fs.mkdirSync(assetsDir, { recursive: true })
    fs.writeFileSync(path.join(assetsDir, 'room.glb'), glbBuffer)

    await runHyperframes(workDir, job)

    const produced = newestMp4(path.join(workDir, 'renders'))
    if (!produced) {
      throw new Error('hyperframes finished but produced no .mp4')
    }
    // A blank composition still encodes to a valid file, just a tiny one — a
    // 1080p orbit is megabytes. Catch it here rather than handing the user a
    // black video and no explanation.
    const bytes = fs.statSync(produced).size
    if (bytes < 100 * 1024) {
      throw new Error(
        `video came out at ${Math.round(bytes / 1024)} KB, which means the ` +
          `composition rendered blank — check the job log for 404s on the ` +
          `vendored three.js or a failed room.glb load`
      )
    }

    const outName = `${job.id}.mp4`
    fs.copyFileSync(produced, path.join(VIDEO_STORAGE_DIR, outName))

    finishJob(job, {
      stage: 'done',
      progress: 100,
      result: { videoUrl: `/uploads/renders/${outName}` }
    })
  } catch (err) {
    finishJob(job, { stage: 'error', error: err?.message || String(err) })
  } finally {
    if (workDir) await removeWorkDir(workDir)
  }
}

/**
 * Delete a job's temp directory, retrying briefly.
 *
 * On Windows the headless browser can still hold a handle for a moment after it
 * reports exit, and rmSync then fails with EBUSY. Observed in testing, not
 * theoretical. Without the retry every render would quietly leave a few hundred
 * MB of template behind in %TEMP%.
 */
async function removeWorkDir(dir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (err) {
      if (attempt === 4) {
        console.warn(`[PAZL VIDEO] could not remove ${dir}: ${err.message}`)
        return
      }
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
}

export const video = (app) => {
  ensureDirs()

  app.use(async (ctx, next) => {
    // GET /video/status/:id
    if (ctx.method === 'GET' && ctx.path.startsWith('/video/status/')) {
      const id = ctx.path.substring('/video/status/'.length)
      const job = jobs.get(id)
      if (!job) {
        ctx.status = 404
        ctx.body = { error: 'not_found', message: `Job ${id} not found` }
        return
      }
      ctx.status = 200
      // The raw log can be megabytes; the frontend only needs the state.
      const { log, ...safe } = job
      ctx.body = safe
      return
    }

    // POST /video
    if (ctx.path !== '/video' || ctx.method !== 'POST') {
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

    const job = newJob()
    ctx.status = 202
    ctx.body = { jobId: job.id, status: 'queued', queuePosition: job.queuePosition }

    enqueueVideo(job, { glbBuffer: file.buffer })
  })
}
