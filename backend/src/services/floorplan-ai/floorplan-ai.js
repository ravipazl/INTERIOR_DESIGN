// Floor-plan AI import. Accepts a floor-plan PDF or image, asks Claude (vision +
// structured output) to vectorize the WALL centerlines + rooms, and returns:
//   { units: "mm"|"cm", walls: [{x1,y1,x2,y2}], rooms: [{name,cx,cy}] }
//
//   POST /floorplan-ai   multipart field "plan" (.pdf or image)
//
// The frontend turns walls[] into corners+walls and loads it into the editor as
// an editable DRAFT (the user refines exact positions afterward).

import Anthropic from '@anthropic-ai/sdk'
import multer from '@koa/multer'
import sharp from 'sharp'

const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

const MODEL = process.env.FLOORPLAN_AI_MODEL || 'claude-opus-4-8'
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB
// Images are resized to at most this many px on the long side before they go to
// Claude: phone photos / scans (e.g. 6000×4500, 12 MB) are rejected by the API
// ("image exceeds … maximum"), and this is still sharp enough to read the
// dimension labels on a plan.
const MAX_IMAGE_EDGE = 2400

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

const FLOORPLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['units', 'walls', 'rooms', 'openings'],
  properties: {
    units: { type: 'string', enum: ['mm', 'cm'] },
    walls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x1', 'y1', 'x2', 'y2'],
        properties: {
          x1: { type: 'number' },
          y1: { type: 'number' },
          x2: { type: 'number' },
          y2: { type: 'number' }
        }
      }
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'cx', 'cy'],
        properties: {
          name: { type: 'string' },
          cx: { type: 'number' },
          cy: { type: 'number' }
        }
      }
    },
    // Door / window openings. Each is given by its CENTRE point (same coordinate
    // system + units as the walls) and its width, so the app can place it on the
    // nearest wall without depending on wall ordering.
    openings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'cx', 'cy', 'width'],
        properties: {
          type: { type: 'string', enum: ['door', 'window'] },
          cx: { type: 'number' },
          cy: { type: 'number' },
          width: { type: 'number' }
        }
      }
    }
  }
}

const PROMPT = `You are a floor-plan vectorizer. The attached file is an architectural floor plan.

Return the structural WALL centerlines, the rooms, and the door/window
openings. IGNORE furniture, fixtures, plumbing, dimension lines/arrows,
hatching, and text annotations.

Rules:
- Output each wall as a straight centerline segment [x1,y1,x2,y2].
- Use the printed dimension labels (e.g. "3000mm", "2440") to set the scale and
  output coordinates in millimetres. If no dimensions are legible, estimate a
  realistic residential scale.
- Keep walls axis-aligned where the drawing is orthogonal.
- Where walls MEET at a corner, give them the SAME endpoint coordinates so they
  connect (shared corners form closed rooms).
- For each enclosed room, output its name (from the label) and a point (cx,cy)
  inside it.
- For each door and window, output an "opening": its TYPE ("door" or "window"),
  its CENTRE point (cx,cy) lying ON the wall it sits in, and its WIDTH. Doors are
  typically 700-1000mm wide; windows 600-1800mm. Detect the swing-arc symbol for
  doors and the thin double-line break in a wall for windows.
- Return empty arrays for rooms/openings if none are legible. Do not invent them.
- Origin is the top-left; x increases right, y increases down.`

/**
 * Any uploaded image → a JPEG Claude accepts: turned upright (phone EXIF),
 * flattened onto white (transparent PNGs), at most MAX_IMAGE_EDGE px on the
 * long side. Small images are not enlarged.
 */
async function prepareImage(buffer) {
  try {
    const out = await sharp(buffer, { limitInputPixels: 400e6 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
    return { data: out, mediaType: 'image/jpeg' }
  } catch (err) {
    const e = new Error("This image couldn't be opened. Try a PNG, JPG or PDF of the plan.")
    e.userFacing = true
    throw e
  }
}

// Step-by-step log lines in the backend terminal, so a failed import shows
// exactly where it stopped: [floorplan-ai] #id step …
const log = (id, ...parts) => console.log(`[floorplan-ai] #${id}`, ...parts)
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`
let requestSeq = 0

async function vectorize(buffer, mimetype, id = '-') {
  const isPdf =
    mimetype === 'application/pdf' || buffer.slice(0, 4).toString() === '%PDF'

  let fileBlock
  if (isPdf) {
    fileBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') }
    }
  } else {
    const img = await prepareImage(buffer)
    log(id, `image prepared for AI: ${mb(img.data.length)} JPEG`)
    fileBlock = {
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data.toString('base64') }
    }
  }

  log(id, `sending to AI (${MODEL}, ${isPdf ? 'PDF' : 'image'})…`)
  const started = Date.now()
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROMPT }] }],
    output_config: { format: { type: 'json_schema', schema: FLOORPLAN_SCHEMA } }
  })

  log(id, `AI answered in ${((Date.now() - started) / 1000).toFixed(1)} s (stop: ${res.stop_reason})`)
  const textBlock = res.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('Model returned no structured output')
  return JSON.parse(textBlock.text)
}

/**
 * Signed-in user or null (and a 401 already written). Every call spends
 * Anthropic credits, so only signed-in users may use it — same check as
 * AI render (/ai-render) and /upload. The app already sends the token.
 */
async function requireUser(app, ctx) {
  const token = String(ctx.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    ctx.status = 401
    ctx.body = { error: 'unauthenticated', message: 'Sign in to use AI import.' }
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

export const floorplanAi = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/floorplan-ai' || ctx.method !== 'POST') return next()
    const id = ++requestSeq
    log(id, 'request received')

    // Login first — before the file is read or Claude is called.
    if (!(await requireUser(app, ctx))) {
      log(id, `stopped: not signed in (${ctx.status})`)
      return
    }

    try {
      await upload.single('plan')(ctx, async () => {})
    } catch (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      log(id, `stopped: upload failed — ${tooBig ? 'file over 20 MB' : err.message || err}`)
      ctx.status = tooBig ? 413 : 400
      ctx.body = {
        error: 'upload_failed',
        message: tooBig
          ? 'This file is too large (max 20 MB). Try a smaller image or PDF of the plan.'
          : "The file couldn't be uploaded. Please try again."
      }
      return
    }

    const file = ctx.request.file
    if (!file) {
      log(id, 'stopped: no file in the request')
      ctx.status = 400
      ctx.body = { error: 'no_file', message: 'multipart field "plan" (pdf/image) is required' }
      return
    }

    log(id, `file "${file.originalname}" ${file.mimetype || '?'} ${mb(file.size)}`)
    try {
      const result = await vectorize(file.buffer, file.mimetype, id)
      log(
        id,
        `done: ${result?.walls?.length || 0} walls, ${result?.rooms?.length || 0} rooms, ` +
          `${result?.openings?.length || 0} doors/windows (units ${result?.units})`
      )
      ctx.status = 200
      ctx.body = result // { units, walls, rooms }
    } catch (err) {
      // Full detail in the server log; a plain message for the user.
      console.error(`[floorplan-ai] #${id} failed:`, err?.message || err)
      ctx.status = 502
      ctx.body = {
        error: 'vectorize_failed',
        message: err?.userFacing
          ? err.message
          : "Couldn't read this plan. Try a clearer image or PDF of the floor plan."
      }
    }
  })
}
