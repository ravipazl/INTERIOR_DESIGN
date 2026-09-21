// Settings for the cabinet-finish scripts, read the same way the backend reads
// them (src/load-env.js): the backend's `.env` is loaded if it exists, and
// values already set in the environment win.
//
// Import this FIRST in a script (before `config`), so MONGODB_URL from `.env`
// is seen by node-config.
//
//   MONGODB_URL        database (else config/default.json)
//   GLB_STORAGE_DIR    folder the app serves /assets/models/glb from — the same
//                      setting the model upload uses
//   WOOD_TEXTURE_DIR   folder holding 10002.jpg / 10012.jpg (optional)
//   CABINET_BACKUP_DIR where original GLBs + undo files are kept (optional)

import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
export const BACKEND_DIR = path.resolve(__dirname, '../..')
export const REPO_DIR = path.resolve(BACKEND_DIR, '..')

const envPath = path.join(BACKEND_DIR, '.env')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })

const FRONTEND_PUBLIC = path.join(REPO_DIR, 'frontend/public')

export const GLB_DIR = process.env.GLB_STORAGE_DIR
  ? path.resolve(process.env.GLB_STORAGE_DIR)
  : path.join(FRONTEND_PUBLIC, 'assets/models/glb')

// The wood images: the explicit setting, else the frontend's public folder,
// else next to the GLB folder (…/assets/models/glb → …/assets/rooms/…).
const WOOD_SUBPATH = 'rooms/textures/library/wooden_grains'
export const WOOD_DIR = (() => {
  if (process.env.WOOD_TEXTURE_DIR) return path.resolve(process.env.WOOD_TEXTURE_DIR)
  const candidates = [
    path.join(FRONTEND_PUBLIC, 'assets', WOOD_SUBPATH),
    path.resolve(GLB_DIR, '../..', WOOD_SUBPATH)
  ]
  return candidates.find((d) => fs.existsSync(path.join(d, '10002.jpg'))) || candidates[0]
})()

export const BACKUP_ROOT = process.env.CABINET_BACKUP_DIR
  ? path.resolve(process.env.CABINET_BACKUP_DIR)
  : path.join(REPO_DIR, 'backups')
