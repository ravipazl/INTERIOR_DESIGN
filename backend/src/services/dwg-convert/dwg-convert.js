// DWG → DXF for the CAD floor-plan import.
//
//   POST /dwg-to-dxf   multipart field "drawing" (.dwg)   →   the DXF's bytes
//
// DWG is AutoCAD's closed binary format; the browser reads DXF. This turns one
// into the other with LibreDWG's `dwg2dxf` (free, open source), so a DWG is
// imported by exactly the same reader as a DXF. The program is run as its own
// process on the server: set DWG2DXF_PATH to it, or have `dwg2dxf` on PATH.
// Without it, the route says so and the app asks for a DXF instead.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import multer from '@koa/multer'

const MAX_BYTES = 60 * 1024 * 1024 // 60 MB, as the app's own limit
const TIMEOUT_MS = 120 * 1000
const converter = () => process.env.DWG2DXF_PATH || 'dwg2dxf'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

const log = (id, ...parts) => console.log(`[dwg-to-dxf] #${id}`, ...parts)
let requestSeq = 0

/** Signed-in user or null (and a 401 already written) — as the AI import's check. */
async function requireUser(app, ctx) {
  const token = String(ctx.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (token) {
    try {
      const { user } = await app.service('authentication').create({ strategy: 'jwt', accessToken: token })
      if (user) return user
    } catch (_) {
      /* fall through */
    }
  }
  ctx.status = 401
  ctx.body = { error: 'unauthenticated', message: 'Sign in to import a drawing.' }
  return null
}

const fail = (ctx, status, error, message) => {
  ctx.status = status
  ctx.body = { error, message }
}

/** Run the converter; resolves with its exit error (or null) and output. */
const run = (args) =>
  new Promise((resolve) => {
    execFile(converter(), args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
    )
  })

export const dwgConvert = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/dwg-to-dxf' || ctx.method !== 'POST') return next()
    const id = ++requestSeq
    log(id, 'request received')
    if (!(await requireUser(app, ctx))) return

    try {
      await upload.single('drawing')(ctx, async () => {})
    } catch (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      log(id, `stopped: upload failed — ${tooBig ? 'file over 60 MB' : err.message || err}`)
      return fail(
        ctx,
        tooBig ? 413 : 400,
        'upload_failed',
        tooBig ? 'This drawing is too large (max 60 MB).' : "The drawing couldn't be uploaded. Please try again."
      )
    }
    const file = ctx.request.file
    if (!file) return fail(ctx, 400, 'no_file', 'multipart field "drawing" (.dwg) is required')
    // Every DWG starts with its version: "AC1015", "AC1032"…
    if (file.buffer.slice(0, 4).toString('latin1') !== 'AC10') {
      log(id, `stopped: "${file.originalname}" is not a DWG`)
      return fail(ctx, 400, 'not_dwg', "This file isn't a DWG drawing.")
    }
    log(id, `"${file.originalname}" ${(file.size / 1048576).toFixed(1)} MB, version ${file.buffer.slice(0, 6).toString('latin1')}`)

    const dir = await mkdtemp(path.join(tmpdir(), 'dwg-'))
    const input = path.join(dir, 'drawing.dwg')
    const output = path.join(dir, 'drawing.dxf')
    try {
      await writeFile(input, file.buffer)
      const started = Date.now()
      const { err, stderr } = await run(['-y', '-o', output, input])
      if (err && err.code === 'ENOENT') {
        log(id, `stopped: converter "${converter()}" not found`)
        return fail(
          ctx,
          501,
          'converter_missing',
          "DWG import isn't set up on this server yet. Save the drawing as DXF in AutoCAD and import that."
        )
      }
      // The converter reports what it could not carry over and may exit with
      // an error even so; what counts is a DXF with something in it.
      const made = await stat(output).catch(() => null)
      if (!made || made.size < 100) {
        log(id, `failed in ${Date.now() - started} ms: ${(err && (err.killed ? 'timed out' : err.message)) || 'no DXF'}; ${stderr.slice(-300)}`)
        return fail(
          ctx,
          422,
          'convert_failed',
          "This DWG couldn't be read. Save it as DXF in AutoCAD and import that."
        )
      }
      log(id, `converted in ${Date.now() - started} ms: ${(made.size / 1048576).toFixed(1)} MB DXF`)
      ctx.status = 200
      ctx.type = 'application/dxf'
      ctx.body = await readFile(output)
    } catch (err) {
      console.error(`[dwg-to-dxf] #${id} failed:`, err?.message || err)
      fail(ctx, 500, 'convert_failed', "This DWG couldn't be read. Save it as DXF in AutoCAD and import that.")
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
}
