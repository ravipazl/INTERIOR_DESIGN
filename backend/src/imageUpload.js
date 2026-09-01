// Server-side image upload (replaces the old s3Upload.js / DigitalOcean Spaces).
//
// Why this file exists:
//   • The app previously uploaded user/AI images to DO Spaces via presigned
//     URLs. We've migrated to self-hosted storage on the server.
//   • Images are saved to a local directory (IMAGE_STORAGE_DIR) and served
//     by nginx at IMAGE_PUBLIC_BASE_URL.
//   • Both the user upload endpoint (POST /upload) AND the AI generator
//     (which downloads Replicate output) share the same disk-write helper.
//
// Environment variables:
//   IMAGE_STORAGE_DIR      Absolute dir where image files are written.
//                          Default: ./uploads/images (relative — dev convenience).
//   IMAGE_PUBLIC_BASE_URL  Public URL prefix that nginx maps to the storage
//                          dir. Default: "" (relative — works for local dev
//                          if you serve the folder yourself).
//   MAX_IMAGE_BYTES        Max upload size in bytes. Default: 25 MB.

import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'

const IMAGE_STORAGE_DIR =
  process.env.IMAGE_STORAGE_DIR || './uploads/images'
const IMAGE_PUBLIC_BASE_URL =
  process.env.IMAGE_PUBLIC_BASE_URL || ''
const MAX_IMAGE_BYTES =
  Number(process.env.MAX_IMAGE_BYTES) || 25 * 1024 * 1024 // 25 MB

// Make sure the dir exists before any upload happens.
function ensureStorageDir() {
  if (!fs.existsSync(IMAGE_STORAGE_DIR)) {
    fs.mkdirSync(IMAGE_STORAGE_DIR, { recursive: true })
  }
}

// Build a sanitised, unique filename from an arbitrary user-supplied name.
function makeKey(originalName) {
  const safe = String(originalName || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-180) // keep total length reasonable
  return `${uuidv4()}-${safe}`
}

// Public URL the frontend should use to fetch the saved image.
function publicUrlFor(key) {
  if (!IMAGE_PUBLIC_BASE_URL) return `/images/${key}` // local-dev relative
  return `${IMAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
}

// Save a raw Buffer (used by the AI generator after it downloads Replicate
// output). Returns the same shape the upload endpoint returns.
export async function saveImageBuffer(buffer, originalName) {
  ensureStorageDir()
  const key = makeKey(originalName)
  const fullPath = path.join(IMAGE_STORAGE_DIR, key)
  await fs.promises.writeFile(fullPath, buffer)
  return { key, url: publicUrlFor(key) }
}

// Multer middleware that writes the uploaded file straight to disk under
// IMAGE_STORAGE_DIR with a sanitised UUID-prefixed filename.
const multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDir()
    cb(null, IMAGE_STORAGE_DIR)
  },
  filename: (_req, file, cb) => {
    cb(null, makeKey(file.originalname))
  },
})

export const uploadMiddleware = multer({
  storage: multerStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'))
    }
  },
})

// Build the JSON response after multer has written the file.
export function buildUploadResponse(req) {
  if (!req.file) return null
  return {
    key: req.file.filename,
    url: publicUrlFor(req.file.filename),
    size: req.file.size,
    mimetype: req.file.mimetype,
    originalName: req.file.originalname,
  }
}

export { IMAGE_STORAGE_DIR, IMAGE_PUBLIC_BASE_URL, publicUrlFor }
