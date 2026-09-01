// Upload service — direct server-side image upload (POST /upload, multipart
// field "file"). PORTED TO KOA for the merged backend: the AI backend was
// Express (app.post + req/res); this backend is Feathers/Koa, so it mounts a
// Koa middleware and uses @koa/multer, mirroring the render / project-file
// -upload services here. Response shape is unchanged so the frontend still maps
// { key, url, size, mimetype, originalName } onto its DB save.
import koaMulter from '@koa/multer'
import { saveImageBuffer } from '../../imageUpload.js'

const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES) || 25 * 1024 * 1024

const imageMulter = koaMulter({
  storage: koaMulter.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  }
})

export const upload = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/upload' || ctx.method !== 'POST') return next()

    // JWT check before parsing/saving the file.
    const token = (ctx.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) {
      ctx.status = 401
      ctx.body = { message: 'Missing JWT' }
      return
    }
    try {
      const { user } = await app.service('authentication').create({
        strategy: 'jwt',
        accessToken: token
      })
      if (!user) {
        ctx.status = 401
        ctx.body = { message: 'Invalid JWT' }
        return
      }
    } catch (err) {
      ctx.status = 401
      ctx.body = { message: err?.message || 'Authentication failed' }
      return
    }

    // Parse the multipart body (memory storage → we write it ourselves).
    try {
      await imageMulter.single('file')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = { message: err.message || String(err) }
      return
    }

    const file = ctx.request.file || ctx.file
    if (!file) {
      ctx.status = 400
      ctx.body = { message: 'No file uploaded — expected multipart field "file"' }
      return
    }

    const saved = await saveImageBuffer(file.buffer, file.originalname)
    ctx.status = 200
    ctx.body = {
      key: saved.key,
      url: saved.url,
      size: file.size,
      mimetype: file.mimetype,
      originalName: file.originalname
    }
  })
}
