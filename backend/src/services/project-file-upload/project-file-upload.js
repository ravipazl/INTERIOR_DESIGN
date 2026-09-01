// POST /project-file-upload  (Koa route, mirrors thumbnail-upload's pattern)
//
// Stores a client document / image / audio recording for a project and returns
// its public URL + metadata. The frontend then creates a `projectitems` record
// pointing at the returned fileUrl (with type / title / note).
//
// multipart/form-data:
//   file        the binary (.pdf; images .png .jpg .jpeg .webp .gif;
//               audio .mp3 .wav .m4a .ogg .aac; video .webm .mp4 .mov .m4v .avi .mkv)
//   projectId   the project this file belongs to (required)
//
// Writes to:
//   pazl-design-frontend/public/assets/project-files/<projectId>/<uuid><ext>
// Served by the frontend at /assets/project-files/...

import path from 'path'
import fs from 'fs'
import url from 'url'
import crypto from 'crypto'
import multer from '@koa/multer'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Store in the design BACKEND's own public/ folder so the backend (3334) serves
// the files. Both the 3D app and the Inspire admin talk to this backend, so a
// single backend-served URL works cross-origin for both.
const STORAGE_DIR =
  process.env.PROJECT_FILES_DIR ||
  path.resolve(__dirname, '../../../public/assets/project-files')

const MAX_BYTES = Number(process.env.MAX_PROJECT_FILE_BYTES) || 50 * 1024 * 1024 // 50 MB
const PUBLIC_URL_PREFIX = '/assets/project-files'
const ALLOWED_EXT = [
  '.pdf',
  // images
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  // audio
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.aac',
  // video (.webm doubles as audio/video)
  '.webm',
  '.mp4',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv'
]

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

const sanitize = (id) => String(id).replace(/[^a-zA-Z0-9._-]+/g, '_')

export const projectFileUpload = (app) => {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
  }

  app.use(async (ctx, next) => {
    if (ctx.path !== '/project-file-upload' || ctx.method !== 'POST') {
      return next()
    }

    try {
      await upload.single('file')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = { error: 'upload_failed', message: err.message || String(err) }
      return
    }

    const file = ctx.request.file
    if (!file) {
      ctx.status = 400
      ctx.body = { error: 'no_file', message: 'multipart field "file" is required' }
      return
    }

    const body = ctx.request.body || {}
    const projectId = body.projectId
    if (!projectId) {
      ctx.status = 400
      ctx.body = { error: 'missing_projectId', message: 'projectId is required' }
      return
    }

    const ext = path.extname(file.originalname || '').toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) {
      ctx.status = 400
      ctx.body = {
        error: 'wrong_extension',
        message: `Unsupported file type ${ext}. Allowed: ${ALLOWED_EXT.join(' ')}`
      }
      return
    }

    const dir = path.join(STORAGE_DIR, sanitize(projectId))
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const filename = `${crypto.randomUUID()}${ext}`
      fs.writeFileSync(path.join(dir, filename), file.buffer)
      ctx.status = 200
      ctx.body = {
        fileUrl: `${PUBLIC_URL_PREFIX}/${sanitize(projectId)}/${filename}`,
        mimeType: file.mimetype,
        size: file.size,
        originalName: file.originalname
      }
    } catch (err) {
      ctx.status = 500
      ctx.body = { error: 'write_failed', message: err.message || String(err) }
    }
  })
}
