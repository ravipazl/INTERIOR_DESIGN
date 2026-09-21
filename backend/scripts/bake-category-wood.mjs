// Bake shutter + handle wood INTO every GLB of a catalogue category (same as the
// tall units): shutter / drawer fronts → Wood 10002, handles → Wood 10012.
//
//   node scripts/bake-category-wood.mjs --category "Wall Unit" --dry-run
//   node scripts/bake-category-wood.mjs --category "Wall Unit"
//   node scripts/bake-category-wood.mjs --category "Wall Unit" --restore
//   node scripts/bake-category-wood.mjs --only "Corner unit"   (just matching models)
//   (--category defaults to "Below Counter Storage")
//
// Every run bakes from the ORIGINAL backup, never from an already-baked file.
// Writes a manifest (model file → part numbers) that
// record-baked-finish.mjs uses to record the finish for the panel and BOQ;
// baked-parts.last-run.json holds only the models of the latest run.
//
// How parts are found:
//   • Files that name their parts ("Shutter", "Drawer 2 Shutter", "Shelf
//     Handle", …) → matched by name.
//   • Files with unnamed parts → by shape:
//       handle  = small bar: thinnest side ≤ 12 mm, longest side ≤ 120 mm;
//       shutter = front board: ≤ 25 mm deep, ≥ 200 mm wide, ≥ 500 mm high,
//                 the frontmost such board (one board covers all drawers).
//                 "Front" is the side the handles are on — some files face −Z.
//     Corner units: the door is L-shaped (two leaves in one part), so it is not
//     a flat board — the door is the tall part that is not the body (the
//     largest part).
//   • A part that already has its own look (a texture, a coloured or named
//     material such as glass) is never recoloured.
// Skipped whole: models whose name matches SKIP_NAMES — the file already
// carries its own colours/textures.
// A file that is ALREADY baked (e.g. copied from another machine) is left as it
// is and never saved as an "original"; its parts still go into the manifest.
// Folders and database come from lib/env.mjs (the backend .env).

import './lib/env.mjs'
import fs from 'fs'
import path from 'path'
import { MongoClient } from 'mongodb'
import config from 'config'
import {
  GLB_DIR,
  BACKUP_ROOT,
  bakedParts,
  createIO,
  loadWoodImage,
  partRows,
  orderLikeThree,
  bakeDoc,
  WOOD
} from './lib/glb-wood-bake.mjs'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const RESTORE = args.includes('--restore')
const argValue = (flag) => (args.indexOf(flag) !== -1 ? args[args.indexOf(flag) + 1] : null)
const ONLY = argValue('--only')
const CATEGORY_NAME =
  args.indexOf('--category') !== -1 ? args[args.indexOf('--category') + 1] : 'Below Counter Storage'
// Existing backup folder names are kept so --restore still finds them.
const BACKUP_FOLDERS = { 'Below Counter Storage': 'glb-original-below-counter' }
const BACKUP_DIR = path.join(
  BACKUP_ROOT,
  BACKUP_FOLDERS[CATEGORY_NAME] ||
    `glb-original-${CATEGORY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
)
const MANIFEST = path.join(BACKUP_DIR, 'baked-parts.json')
const LAST_RUN = path.join(BACKUP_DIR, 'baked-parts.last-run.json')
// What a --dry-run would bake (so the finish step can be checked too).
const DRY_RUN_LIST = path.join(BACKUP_DIR, 'baked-parts.dry-run.json')
const SKIP_NAMES = [/handle colour/i]

/** A part whose material already gives it its own look (texture, colour, glass…). */
function hasOwnLook(row) {
  const mat = row.prim.getMaterial()
  if (!mat) return false
  const white = mat.getBaseColorFactor().slice(0, 3).every((v) => v > 0.98)
  const plainName = /^(default material)?$/i.test(mat.getName() || '')
  return !!mat.getBaseColorTexture() || !white || !plainName
}

function detectByName(rows) {
  const plain = rows.filter((r) => !hasOwnLook(r))
  const shutters = plain.filter((r) => /shutter/i.test(r.name)).map((r) => r.index)
  const handles = plain.filter((r) => /handle/i.test(r.name)).map((r) => r.index)
  return { shutters, handles }
}

function detectByShape(rows, modelName = '') {
  const plain = rows.filter((r) => !hasOwnLook(r))
  const handleRows = plain.filter((r) => {
    const s = [...r.size].sort((a, b) => a - b)
    return s[0] <= 12 && s[2] <= 120
  })
  // Front = the side the handles sit on (+Z for most files, −Z for some).
  const avgHandleZ = handleRows.reduce((t, r) => t + r.centre[2], 0) / (handleRows.length || 1)
  const front = avgHandleZ < 0 ? -1 : 1
  const boards = plain.filter((r) => r.size[2] <= 25 && r.size[0] >= 200 && r.size[1] >= 500)
  const frontZ = Math.max(...boards.map((r) => front * r.centre[2]))
  // The frontmost board(s). A back panel is also thin but sits at the back.
  let shutters = boards
    .filter((r) => front * r.centre[2] >= frontZ - 5 && front * r.centre[2] > 0)
    .map((r) => r.index)
  if (!shutters.length && /corner/i.test(modelName)) {
    // L-shaped corner door: tall (≥ 500 mm), not a handle, not the body.
    const volume = (r) => r.size[0] * r.size[1] * r.size[2]
    const handleIdx = new Set(handleRows.map((r) => r.index))
    const others = plain.filter((r) => !handleIdx.has(r.index))
    const body = others.reduce((a, r) => (!a || volume(r) > volume(a) ? r : a), null)
    shutters = others.filter((r) => r !== body && r.size[1] >= 500).map((r) => r.index)
  }
  return { shutters, handles: handleRows.map((r) => r.index) }
}

async function main() {
  if (RESTORE) {
    const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.glb')) : []
    for (const f of files) {
      fs.copyFileSync(path.join(BACKUP_DIR, f), path.join(GLB_DIR, f))
      console.log('restored', f)
    }
    if (!files.length) console.log('no backups found')
    return
  }

  const client = await MongoClient.connect(process.env.MONGODB_URL || config.get('mongodb'))
  let models
  try {
    const db = client.db()
    const cat = await db.collection('categories').findOne({ name: CATEGORY_NAME })
    if (!cat) throw new Error(`category "${CATEGORY_NAME}" not found`)
    models = await db
      .collection('models')
      // categoryId is stored as a string here; accept an ObjectId too.
      .find({ categoryId: { $in: [String(cat._id), cat._id] } })
      .project({ name: 1, modelFileUrl: 1 })
      .toArray()
    if (ONLY) models = models.filter((m) => m.name.toLowerCase().includes(ONLY.toLowerCase()))
  } finally {
    await client.close()
  }

  const io = await createIO()
  const images = { shutter: await loadWoodImage(WOOD.shutter), handle: await loadWoodImage(WOOD.handle) }
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {}
  const lastRun = {}

  for (const m of models) {
    const name = m.name.trim()
    const file = String(m.modelFileUrl || '').split('/').pop()
    const live = path.join(GLB_DIR, file)
    const backup = path.join(BACKUP_DIR, file)
    const report = { model: name }
    try {
      if (SKIP_NAMES.some((re) => re.test(name))) {
        console.log(JSON.stringify({ ...report, status: 'SKIPPED (already has its own colours)' }))
        continue
      }
      if (!fs.existsSync(live) && !fs.existsSync(backup)) {
        console.log(JSON.stringify({ ...report, status: 'MISSING FILE' }))
        continue
      }
      const source = fs.existsSync(backup) ? backup : live
      const sourceBytes = fs.statSync(source).size
      const doc = await io.read(source)
      // No original kept and the live file is already baked: leave it as it is.
      const already = source === live ? bakedParts(doc) : null
      if (already) {
        lastRun[file] = { modelId: String(m._id), name, ...already }
        if (!DRY) manifest[file] = lastRun[file]
        console.log(JSON.stringify({ ...report, status: 'ALREADY BAKED (left as it is)', shutters: already.shutters.map((i) => `Mesh_${i}`), handles: already.handles.map((i) => `Mesh_${i}`) }))
        continue
      }
      // Part numbers must follow the app's (three.js) order, not the file's.
      orderLikeThree(doc)
      const rows = partRows(doc)
      const named = rows.some((r) => /shutter|handle/i.test(r.name))
      const parts = named ? detectByName(rows) : detectByShape(rows, name)
      report.by = named ? 'name' : 'shape'
      report.shutters = parts.shutters.map((i) => `Mesh_${i} ${rows[i].size.join('x')}`)
      report.handles = parts.handles.map((i) => `Mesh_${i} ${rows[i].size.join('x')}`)
      if (!parts.shutters.length && !parts.handles.length) {
        console.log(JSON.stringify({ ...report, status: 'SKIPPED (no shutter/handle found)' }))
        continue
      }
      const out = await bakeDoc(io, doc, parts, images)
      if (!DRY) {
        if (!fs.existsSync(backup)) fs.copyFileSync(live, backup)
        const tmp = live + '.tmp'
        fs.writeFileSync(tmp, Buffer.from(out))
        fs.renameSync(tmp, live)
        manifest[file] = { modelId: String(m._id), name, shutters: parts.shutters, handles: parts.handles }
      }
      lastRun[file] = { modelId: String(m._id), name, shutters: parts.shutters, handles: parts.handles }
      report.bytes = `${sourceBytes} → ${out.byteLength}`
      console.log(JSON.stringify({ ...report, status: DRY ? 'OK (dry run)' : 'BAKED' }))
    } catch (e) {
      console.log(JSON.stringify({ ...report, status: 'ERROR — live file untouched', error: e.message }))
    }
  }
  if (!DRY) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
    fs.writeFileSync(LAST_RUN, JSON.stringify(lastRun, null, 2))
    console.log('originals + manifest in', BACKUP_DIR)
  } else {
    fs.writeFileSync(DRY_RUN_LIST, JSON.stringify(lastRun, null, 2))
  }
}

main()
