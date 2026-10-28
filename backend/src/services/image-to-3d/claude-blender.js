// "Claude + Blender" photo -> GLB engine (alternative to Tripo).
//
//   photo + real size (W x D x H mm)
//     -> Claude looks at the photo and writes a Blender (bpy) script
//     -> the script is safety-checked and run in headless Blender (blender/build.py)
//     -> Blender renders the result; Claude compares render and photo and fixes
//        the script (at most MAX_FIX_ROUNDS times)
//     -> a candidate GLB + preview picture. NOTHING is saved to the catalogue
//        here — image-to-3d.js does that only when the user presses "Add".
//
// Why a script instead of a mesh generator: every part is its own named object
// (what a quotation prices), the overall size is exact, and the result is
// editable text. See blender/build.py for the safety rules the script runs under.

import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import url from 'url'
import sharp from 'sharp'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const BUILD_PY = path.join(__dirname, 'blender', 'build.py')
const PREVIEW_PY = path.join(__dirname, 'blender', 'preview.py')

const MAX_FIX_ROUNDS = 3
const BUILD_TIMEOUT_MS = 90 * 1000
const PREVIEW_TIMEOUT_MS = 240 * 1000
const MAX_PHOTO_EDGE = 1600
const SIZE_LIMITS_MM = { min: 30, max: 6000 }
const NL = String.fromCharCode(10)

export const config = () => ({
  // Blender is the machine's own — BLENDER_BIN, same variable the render service uses.
  blender: process.env.BLENDER_BIN || 'blender',
  model: process.env.CLAUDE_BLENDER_MODEL || process.env.FLOORPLAN_AI_MODEL || 'claude-opus-4-8',
  // on/off switch: CLAUDE_BLENDER_ENABLED=false turns the engine off without a deploy of code
  enabled: String(process.env.CLAUDE_BLENDER_ENABLED || 'true').toLowerCase() !== 'false',
  dailyLimit: Number(process.env.CLAUDE_BLENDER_DAILY_LIMIT) || 20
})

let client = null
const getClient = () => (client ||= new Anthropic({ timeout: 5 * 60 * 1000, maxRetries: 2 }))

export class UserFacingError extends Error {
  constructor(message) {
    super(message)
    this.userFacing = true
  }
}

// ───────────────────────────── small helpers ─────────────────────────────

// Blender must not see our secrets: it runs code an AI wrote.
function cleanEnv() {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASS|MONGO|URI|URL|AUTH|SMTP|DATABASE/i.test(k)) continue
    env[k] = v
  }
  return env
}

// Serialise Blender runs: each one uses all CPU cores.
let blenderChain = Promise.resolve()
function runBlender(args, timeoutMs, cwd) {
  const run = () =>
    new Promise((resolve) => {
      let out = ''
      let timedOut = false
      const child = spawn(config().blender, args, { cwd, env: cleanEnv(), windowsHide: true })
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
      const eat = (d) => {
        out += d.toString()
        if (out.length > 200000) out = out.slice(-100000)
      }
      child.stdout.on('data', eat)
      child.stderr.on('data', eat)
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ ok: false, timedOut: false, out: `could not start Blender: ${e.message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0 && !timedOut, timedOut, out })
      })
    })
  const p = blenderChain.then(run, run)
  blenderChain = p.catch(() => {})
  return p
}

async function prepareImage(buffer) {
  try {
    const out = await sharp(buffer, { limitInputPixels: 400e6 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: MAX_PHOTO_EDGE, height: MAX_PHOTO_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
    return out
  } catch (_) {
    throw new UserFacingError("This photo couldn't be opened. Try a JPG or PNG.")
  }
}

const imageBlock = (jpeg) => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') }
})

// ───────────────────────────── prompts ─────────────────────────────

const SYSTEM = `You are a 3D modeller for an interior-design and quotation tool. You turn a photo of a furniture / fixture item into a Blender Python (bpy) script that builds it from simple parts.

HOW YOUR SCRIPT RUNS
- You write only the BODY of a script. No imports (rejected), no file access, no os/sys, no lights/cameras. Variables, loops, lists, def and lambda are fine.
- Already available: bpy, math, mathutils, Vector, and these helpers (all lengths in METRES):
    mat(name, (r,g,b), rough=0.5, metal=0.0)            -> a PBR material, colours 0..1
    box(name, (sx,sy,sz), (x,y,z), material, bevel=0.0, soft=0)   -> a box centred at (x,y,z). bevel = rounded-edge width in m. soft=1..3 smooths it into a cushion (use for soft furniture).
    cyl(name, radius, depth, (x,y,z), material, rot=(rx,ry,rz), verts=24)  -> a cylinder along Z; rotate with rot (radians).
    sphere(name, radius, (x,y,z), material, scale=(1,1,1))  -> a sphere / ellipsoid.
  W, D, H are the item's stated overall width, depth, height in metres.
- Axes: X = width (left-right as seen from the front), Y = depth, Z = up. The FRONT of the item faces -Y; the back is +Y. Build the front on the -Y side.
- After your script runs, everything is automatically centred, put on the floor and scaled to exactly W x D x H. So build with the right PROPORTIONS (use W, D, H) — if your own proportions are far off, the item gets visibly stretched.

WHAT MAKES A GOOD MODEL
- One object per real part, named like a quotation would list it, in snake_case: side_left, back_panel, drawer_front_1, door_left, seat_cushion_1, backrest, handle_bar_1, shelf_2, worktop. Name legs and feet leg_1, leg_2 ... (they are priced separately). Never name parts "cube", "mesh" or "part".
- Match the photo: the same number of doors, drawers, shelves, cushions, legs; the same handle style; the same proportions between parts; the same colours (sample them from the photo into mat()). Use at most 6 materials.
- Typically 10 to 60 parts. Do not model tiny screws or hundreds of repeated items; do not leave out parts that are visible.
- Hollow things (cabinets, drawers) should really be built from panels (sides, bottom, back, top) so the inside is not solid when a door is open. Keep it simple but physically sensible.
- Soft furniture: use box(..., bevel=0.03..0.06, soft=2). Hard furniture: bevel 0.002..0.006 for crisp edges. Keep triangle counts modest.`

const GENERATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plan', 'script'],
  properties: {
    plan: { type: 'string', description: 'Two or three sentences: what the item is and the parts you will build.' },
    script: { type: 'string', description: 'The Python script body.' }
  }
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'differences', 'script'],
  properties: {
    verdict: { type: 'string', enum: ['good', 'fix'] },
    differences: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete differences between the photo and the render (empty if good).'
    },
    script: { type: 'string', description: 'The complete corrected script body when verdict is "fix"; empty string when "good".' }
  }
}

function specText({ categoryName, name, hint, sizeMm }) {
  const lines = [
    `Item: ${name || categoryName || 'furniture item'}${categoryName ? ` (category: ${categoryName})` : ''}`,
    `Stated overall size: width ${sizeMm.w} mm x depth ${sizeMm.d} mm x height ${sizeMm.h} mm.`
  ]
  if (hint) lines.push(`Note from the user: ${hint}`)
  return lines.join('\n')
}

async function callClaude({ content, schema, label }) {
  const started = Date.now()
  const res = await getClient().messages.create({
    model: config().model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } }
  })
  console.log(
    `[claude-blender] ${label}: ${((Date.now() - started) / 1000).toFixed(1)} s, ` +
      `in ${res.usage?.input_tokens ?? '?'} / out ${res.usage?.output_tokens ?? '?'} tokens (stop: ${res.stop_reason})`
  )
  const textBlock = res.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('Claude returned no answer')
  const parsed = JSON.parse(textBlock.text)
  return { parsed, usage: res.usage || {} }
}

// ───────────────────────────── build + preview ─────────────────────────────

async function buildGlb(dir, script, sizeMm, tag) {
  const scriptPath = path.join(dir, `script_${tag}.py`)
  const glbPath = path.join(dir, `model_${tag}.glb`)
  const infoPath = path.join(dir, `info_${tag}.json`)
  fs.writeFileSync(scriptPath, script, 'utf8')
  const r = await runBlender(
    ['-b', '--factory-startup', '-P', BUILD_PY, '--', scriptPath, glbPath, infoPath, sizeMm.w, sizeMm.d, sizeMm.h].map(String),
    BUILD_TIMEOUT_MS,
    dir
  )
  if (r.timedOut) return { ok: false, error: `the script took longer than ${BUILD_TIMEOUT_MS / 1000} s to run` }
  let info = null
  try {
    info = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
  } catch (_) {
    /* no info written */
  }
  if (!info) {
    const tail = r.out.split('\n').filter(Boolean).slice(-8).join('\n')
    return { ok: false, error: `Blender failed to run the script:\n${tail}` }
  }
  if (!info.ok) return { ok: false, error: info.error }
  if (!fs.existsSync(glbPath)) return { ok: false, error: 'Blender did not write a GLB file' }
  return { ok: true, info, glbPath }
}

// Two views side by side: front three-quarter + straight on.
async function renderPreview(dir, glbPath, tag) {
  const prefix = path.join(dir, `view_${tag}`)
  const r = await runBlender(
    ['-b', '--factory-startup', '-P', PREVIEW_PY, '--', glbPath, prefix, '35,0'],
    PREVIEW_TIMEOUT_MS,
    dir
  )
  const a = `${prefix}_0.png`
  const b = `${prefix}_1.png`
  if (!r.ok || !fs.existsSync(a) || !fs.existsSync(b)) {
    throw new Error(r.timedOut ? 'The preview render timed out' : 'The preview render failed')
  }
  const left = await sharp(a).resize(640, 640).toBuffer()
  const right = await sharp(b).resize(640, 640).toBuffer()
  const sheet = await sharp({ create: { width: 1280, height: 640, channels: 3, background: '#ffffff' } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 640, top: 0 }
    ])
    .jpeg({ quality: 88 })
    .toBuffer()
  return sheet
}

// ───────────────────────────── the job ─────────────────────────────

/**
 * Photo -> candidate model. `job` is the in-memory job record (stage/progress are
 * updated in place for the status endpoint). Returns the candidate; the caller
 * decides what to do with it.
 *
 * @returns {{ glbPath, previewJpeg, info, rounds, plan, differences, claudeCalls, tokens }}
 */
export async function generateCandidate(job, { imageBuffer, sizeMm, categoryName, name, hint, workDir }) {
  const cfg = config()
  if (!cfg.enabled) throw new UserFacingError('Claude + Blender is switched off right now.')
  if (!process.env.ANTHROPIC_API_KEY) throw new UserFacingError('Claude + Blender is not set up on this server yet.')
  for (const [k, v] of Object.entries(sizeMm)) {
    if (!Number.isFinite(v) || v < SIZE_LIMITS_MM.min || v > SIZE_LIMITS_MM.max) {
      throw new UserFacingError(
        `Enter the real size in mm (${SIZE_LIMITS_MM.min}–${SIZE_LIMITS_MM.max}). "${k}" is not valid.`
      )
    }
  }
  fs.mkdirSync(workDir, { recursive: true })

  const step = (stage, extra = {}) => {
    job.stage = stage
    job.lastUpdate = Date.now()
    Object.assign(job, extra)
  }
  const tokens = { input: 0, output: 0 }
  let claudeCalls = 0
  const track = (u) => {
    claudeCalls += 1
    tokens.input += u.input_tokens || 0
    tokens.output += u.output_tokens || 0
  }

  step('reading_photo', { round: 0 })
  const photo = await prepareImage(imageBuffer)
  const spec = specText({ categoryName, name, hint, sizeMm })

  // 1. first script
  step('writing_script', { round: 0 })
  const first = await callClaude({
    label: 'script',
    schema: GENERATE_SCHEMA,
    content: [
      imageBlock(photo),
      { type: 'text', text: `${spec}\n\nBuild this item. Write the script body.` }
    ]
  })
  track(first.usage)
  let script = first.parsed.script
  const plan = first.parsed.plan
  let differences = []

  // `good` = the latest script that built AND rendered. A fix that fails to build never throws away a
  // model that already worked.
  let good = null
  let fixes = 0
  // up to: 1 initial build + MAX_FIX_ROUNDS fixes
  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    step('building', { round })
    const built = await buildGlb(workDir, script, sizeMm, String(round))
    if (!built.ok) {
      console.warn(`[claude-blender] round ${round}: build failed: ${String(built.error).split(NL)[0]}`)
      if (good || round === MAX_FIX_ROUNDS) break
      step('fixing', { round })
      const fix = await callClaude({
        label: `repair ${round + 1}`,
        schema: GENERATE_SCHEMA,
        content: [
          imageBlock(photo),
          {
            type: 'text',
            text: [
              spec,
              `Your script failed:${NL}${built.error}`,
              `Here is the script:${NL}${NL}${script}`,
              'Return the complete corrected script body.'
            ].join(NL + NL)
          }
        ]
      })
      track(fix.usage)
      script = fix.parsed.script
      fixes += 1
      continue
    }

    step('rendering', { round })
    const sheet = await renderPreview(workDir, built.glbPath, String(round))
    good = { built, sheet, script }
    if (round === MAX_FIX_ROUNDS) break

    step('comparing', { round })
    const f = built.info.fit_factor
    const stretched = Math.max(f.width, f.depth, f.height) > 1.15 || Math.min(f.width, f.depth, f.height) < 0.87
    const review = await callClaude({
      label: `review ${round + 1}`,
      schema: REVIEW_SCHEMA,
      content: [
        { type: 'text', text: 'REFERENCE PHOTO:' },
        imageBlock(photo),
        { type: 'text', text: 'BLENDER RENDER OF YOUR MODEL (left: front three-quarter, right: straight from the front):' },
        imageBlock(sheet),
        {
          type: 'text',
          text: [
            spec,
            `Built size ${built.info.size_mm.width} x ${built.info.size_mm.depth} x ${built.info.size_mm.height} mm, ` +
              `${built.info.parts.length} parts: ${built.info.parts.join(', ')}.${NL}` +
              `Stretch applied to reach the stated size: width x${f.width}, depth x${f.depth}, height x${f.height}` +
              (stretched ? ' — that is a lot; correct your own proportions so these are close to 1.0.' : '.'),
            'Compare the render with the photo: orientation (front faces the camera on the right view), proportions, ' +
              'number of doors / drawers / cushions / legs / shelves, handle style, colours and materials, missing or ' +
              'extra parts. If it is a faithful match answer verdict "good". Otherwise answer "fix", list the concrete ' +
              'differences and return the COMPLETE corrected script body (not a diff). Be strict about real ' +
              'differences, not about tiny details.',
            `Current script:${NL}${NL}${script}`
          ].join(NL + NL)
        }
      ]
    })
    track(review.usage)
    differences = review.parsed.differences || []
    if (review.parsed.verdict === 'good' || !review.parsed.script.trim()) {
      differences = review.parsed.verdict === 'good' ? [] : differences
      break
    }
    script = review.parsed.script
    fixes += 1
  }

  if (!good) {
    throw new UserFacingError(
      "Couldn't build a working model from this photo. Try a clearer photo of the whole item, or use Tripo."
    )
  }

  return {
    glbPath: good.built.glbPath,
    previewJpeg: good.sheet,
    info: good.built.info,
    script: good.script,
    rounds: fixes,
    plan,
    differences,
    claudeCalls,
    tokens
  }
}

// ───────────────────────────── daily limit ─────────────────────────────

const dayKey = () => new Date().toISOString().slice(0, 10)

/** Counts one generation for this user today. Returns { ok, used, limit }. */
export async function takeDailyAllowance(db, userId) {
  const limit = config().dailyLimit
  const col = db.collection('ai_model_usage')
  const key = { userId: String(userId), day: dayKey(), engine: 'claude-blender' }
  const doc = await col.findOneAndUpdate(
    key,
    { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date().toISOString() } },
    { upsert: true, returnDocument: 'after' }
  )
  const used = (doc?.value ?? doc)?.count ?? 1
  if (used > limit) {
    await col.updateOne(key, { $inc: { count: -1 } })
    return { ok: false, used: used - 1, limit }
  }
  return { ok: true, used, limit }
}

export async function refundDailyAllowance(db, userId) {
  try {
    await db
      .collection('ai_model_usage')
      .updateOne({ userId: String(userId), day: dayKey(), engine: 'claude-blender' }, { $inc: { count: -1 } })
  } catch (_) {
    /* best effort */
  }
}

export const tempRoot = () => path.join(os.tmpdir(), 'pazl-claude-blender')
