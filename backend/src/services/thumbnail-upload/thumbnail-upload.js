// POST /thumbnail-upload   (Koa route, mirrors model-upload's pattern)
//
// Sets / changes the preview image (thumbnail) of an existing model. Used by:
//   • Method 1 — the in-app "Upload Image" button on a model card.
//   • The snapshot flow (sends a captured PNG to this same endpoint).
//
// Accepts one image at a time via multipart/form-data:
//   file      the image binary (.png .jpg .jpeg .webp)
//   modelId   Mongo _id of the model to attach the image to (required)
//
// Writes the file to:
//   pazl-design-frontend/public/assets/models/thumbnails/<modelId>.<ext>
// Updates models.<thumbnail|thumbnails> with the public URL. Returns the URL.
//
// NOTE: This is purely ADDITIVE. It only ever sets the `thumbnail`/`thumbnails`
// fields on an existing model and writes into the thumbnails folder. It does
// not touch any other service, route, or field.

import path from 'path'
import fs from 'fs'
import url from 'url'
import multer from '@koa/multer'
import { ObjectId } from 'mongodb'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Same public folder the old catalog thumbnails already live in, and the same
// folder the frontend serves at /assets/models/thumbnails.
const THUMB_STORAGE_DIR =
  process.env.THUMB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/thumbnails'
  )

const MAX_BYTES = Number(process.env.MAX_THUMB_BYTES) || 8 * 1024 * 1024 // 8 MB
const PUBLIC_URL_PREFIX = '/assets/models/thumbnails'
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

// The `models` collection holds BOTH string ids (seeded/imported) and real
// ObjectIds (some user rows). Match either form so the update always lands.
function buildIdQuery(id) {
  const or = [{ _id: id }]
  if (typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) {
    try {
      or.push({ _id: new ObjectId(id) })
    } catch (_) {}
  }
  return { $or: or }
}

function pickExtension(originalname) {
  const ext = path.extname(originalname || '').toLowerCase()
  return ALLOWED_EXT.includes(ext) ? ext : null
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, '_')
}

export const thumbnailUpload = (app) => {
  // Ensure target dir exists (the old catalog already created it, but be safe).
  if (!fs.existsSync(THUMB_STORAGE_DIR)) {
    fs.mkdirSync(THUMB_STORAGE_DIR, { recursive: true })
  }

  app.use(async (ctx, next) => {
    if (ctx.path !== '/thumbnail-upload' || ctx.method !== 'POST') {
      return next()
    }

    try {
      await upload.single('file')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = {
        error: 'upload_failed',
        message: err.message || String(err)
      }
      return
    }

    const file = ctx.request.file
    if (!file) {
      ctx.status = 400
      ctx.body = { error: 'no_file', message: 'multipart field "file" is required' }
      return
    }

    const body = ctx.request.body || {}
    const modelId = body.modelId
    if (!modelId) {
      ctx.status = 400
      ctx.body = { error: 'missing_modelId', message: 'modelId is required' }
      return
    }

    const ext = pickExtension(file.originalname)
    if (!ext) {
      ctx.status = 400
      ctx.body = {
        error: 'wrong_extension',
        message: 'Only .png .jpg .jpeg .webp images are accepted'
      }
      return
    }

    // Confirm the model exists before writing anything.
    let db
    let existing
    try {
      db = await app.get('mongodbClient')
      existing = await db.collection('models').findOne(buildIdQuery(modelId))
    } catch (err) {
      ctx.status = 500
      ctx.body = { error: 'db_error', message: err.message || String(err) }
      return
    }
    if (!existing) {
      ctx.status = 404
      ctx.body = { error: 'model_not_found', message: `No model with _id ${modelId}` }
      return
    }

    // Deterministic filename keyed by modelId so a re-upload overwrites cleanly.
    const filename = `${sanitizeId(modelId)}${ext}`
    const fullPath = path.join(THUMB_STORAGE_DIR, filename)
    try {
      fs.writeFileSync(fullPath, file.buffer)
    } catch (err) {
      ctx.status = 500
      ctx.body = {
        error: 'write_failed',
        message: `Failed to write thumbnail to ${fullPath}: ${err.message}`
      }
      return
    }

    const thumbnailUrl = `${PUBLIC_URL_PREFIX}/${filename}`

    // If the model previously pointed at a DIFFERENT thumbnail file inside our
    // own folder (e.g. a .png being replaced by a .jpg), remove the orphan.
    try {
      const prev = existing.thumbnail
      if (
        prev &&
        prev !== thumbnailUrl &&
        prev.startsWith(PUBLIC_URL_PREFIX + '/')
      ) {
        const prevName = prev.slice((PUBLIC_URL_PREFIX + '/').length)
        const prevPath = path.join(THUMB_STORAGE_DIR, prevName)
        if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath)
      }
    } catch (_) {
      // orphan cleanup is best-effort, never fatal
    }

    try {
      await db.collection('models').updateOne(buildIdQuery(modelId), {
        $set: {
          thumbnail: thumbnailUrl,
          thumbnails: thumbnailUrl,
          updatedAt: new Date().toISOString()
        }
      })
    } catch (err) {
      ctx.status = 500
      ctx.body = { error: 'db_update_failed', message: err.message || String(err) }
      return
    }

    ctx.status = 200
    ctx.body = { _id: modelId, thumbnail: thumbnailUrl, thumbnails: thumbnailUrl }
  })
}
