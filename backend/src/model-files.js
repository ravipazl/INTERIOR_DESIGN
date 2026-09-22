// Serves uploaded 3D models and their thumbnails straight from the folders the
// upload services write them into:
//
//   GET /assets/models/glb/<file>.glb          → GLB_STORAGE_DIR/<file>.glb
//   GET /assets/models/thumbnails/<file>.png   → THUMB_STORAGE_DIR/<file>.png
//
// Why: model-upload saves to GLB_STORAGE_DIR and stores the link
// "/assets/models/glb/<file>", which the website (nginx) is expected to serve
// from that same folder. When the web server serves /assets from a different
// folder (e.g. the frontend build), every newly uploaded model is a 404 and
// "Add" fails. Serving the files from here, with the SAME folder settings the
// uploads use, means the backend can always hand back what it saved; the app
// falls back to this route (via the API address) when the website returns 404.
//
// Read-only, file name only (no sub-folders, no "..").

import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Same defaults as services/model-upload and services/thumbnail-upload.
const GLB_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(__dirname, '../../pazl-design-frontend/public/assets/models/glb')
const THUMB_DIR =
  process.env.THUMB_STORAGE_DIR ||
  path.resolve(__dirname, '../../pazl-design-frontend/public/assets/models/thumbnails')

const ROUTES = [
  { prefix: '/assets/models/glb/', dir: GLB_DIR, ext: { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' } },
  {
    prefix: '/assets/models/thumbnails/',
    dir: THUMB_DIR,
    ext: { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
  }
]

export const modelFiles = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next()
    const route = ROUTES.find((r) => ctx.path.startsWith(r.prefix))
    if (!route) return next()

    let name
    try {
      name = decodeURIComponent(ctx.path.slice(route.prefix.length))
    } catch (_) {
      return next()
    }
    const type = route.ext[path.extname(name).toLowerCase()]
    if (!name || name !== path.basename(name) || name.startsWith('.') || !type) return next()

    const file = path.join(route.dir, name)
    let stat
    try {
      stat = await fs.promises.stat(file)
    } catch (_) {
      return next() // not here → normal 404
    }
    if (!stat.isFile()) return next()

    ctx.type = type
    ctx.length = stat.size
    ctx.lastModified = stat.mtime
    ctx.set('Cache-Control', 'public, max-age=86400')
    ctx.body = ctx.method === 'HEAD' ? null : fs.createReadStream(file)
  })
}
