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

const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

const MODEL = process.env.FLOORPLAN_AI_MODEL || 'claude-opus-4-8'
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

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

async function vectorize(buffer, mimetype) {
  const b64 = buffer.toString('base64')
  const isPdf =
    mimetype === 'application/pdf' || (!mimetype && buffer.slice(0, 4).toString() === '%PDF')

  const fileBlock = isPdf
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 }
      }
    : {
        type: 'image',
        source: { type: 'base64', media_type: mimetype || 'image/png', data: b64 }
      }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROMPT }] }],
    output_config: { format: { type: 'json_schema', schema: FLOORPLAN_SCHEMA } }
  })

  const textBlock = res.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('Model returned no structured output')
  return JSON.parse(textBlock.text)
}

export const floorplanAi = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/floorplan-ai' || ctx.method !== 'POST') return next()

    try {
      await upload.single('plan')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = { error: 'upload_failed', message: err.message || String(err) }
      return
    }

    const file = ctx.request.file
    if (!file) {
      ctx.status = 400
      ctx.body = { error: 'no_file', message: 'multipart field "plan" (pdf/image) is required' }
      return
    }

    try {
      const result = await vectorize(file.buffer, file.mimetype)
      ctx.status = 200
      ctx.body = result // { units, walls, rooms }
    } catch (err) {
      console.error('[floorplan-ai] failed:', err?.message || err)
      ctx.status = 502
      ctx.body = { error: 'vectorize_failed', message: err?.message || String(err) }
    }
  })
}
