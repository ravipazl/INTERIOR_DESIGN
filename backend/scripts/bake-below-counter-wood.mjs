// Bake shutter + handle wood INTO the Below Counter Storage GLBs (same as the
// tall units): shutter / drawer fronts → Wood 10002, handles → Wood 10012.
//
//   node scripts/bake-below-counter-wood.mjs --dry-run   check only, write nothing
//   node scripts/bake-below-counter-wood.mjs             bake (originals backed up once)
//   node scripts/bake-below-counter-wood.mjs --restore   put the originals back
//
// Every run bakes from the ORIGINAL backup, never from an already-baked file.
// Writes a manifest (model file → part numbers) that
// record-baked-finish.mjs uses to record the finish for the panel and BOQ.
//
// How parts are found:
//   • "BC …" units name their parts in the file ("Shutter", "Drawer 2 Shutter",
//     "Shelf Handle", …) → matched by name.
//   • "Base unit / Oil pullout / Corner" units have unnamed parts → by shape:
//       shutter = front board: ≤ 25 mm deep, ≥ 200 mm wide, ≥ 500 mm high,
//                 the frontmost such board (one board covers all drawers);
//       handle  = small bar: thinnest side ≤ 12 mm, longest side ≤ 120 mm.
//     Corner units have no separate door board → handles only.
// Skipped: "Base unit 600x600 left opening shutter - handle colour" — the file
// already carries its own colours/textures.

import fs from 'fs'
import path from 'path'
import url from 'url'
import { MongoClient } from 'mongodb'
import config from 'config'
import {
  GLB_DIR,
  createIO,
  loadWoodImage,
  partRows,
  orderLikeThree,
  bakeDoc,
  WOOD
} from './lib/glb-wood-bake.mjs'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const BACKUP_DIR = path.resolve(__dirname, '../../backups/glb-original-below-counter')
const MANIFEST = path.join(BACKUP_DIR, 'baked-parts.json')
const CATEGORY_NAME = 'Below Counter Storage'
const SKIP_NAMES = [/handle colour/i]

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const RESTORE = args.includes('--restore')

function detectByName(rows) {
  const shutters = rows.filter((r) => /shutter/i.test(r.name)).map((r) => r.index)
  const handles = rows.filter((r) => /handle/i.test(r.name)).map((r) => r.index)
  return { shutters, handles }
}

function detectByShape(rows) {
  const boards = rows.filter((r) => r.size[2] <= 25 && r.size[0] >= 200 && r.size[1] >= 500)
  const frontZ = Math.max(...boards.map((r) => r.centre[2]))
  // The frontmost board(s). A back panel is also thin but sits at the back.
  const shutters = boards.filter((r) => r.centre[2] >= frontZ - 5 && r.centre[2] > 0).map((r) => r.index)
  const handles = rows
    .filter((r) => {
      const s = [...r.size].sort((a, b) => a - b)
      return s[0] <= 12 && s[2] <= 120
    })
    .map((r) => r.index)
  return { shutters, handles }
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
      .find({ categoryId: String(cat._id) })
      .project({ name: 1, modelFileUrl: 1 })
      .toArray()
  } finally {
    await client.close()
  }

  const io = await createIO()
  const images = { shutter: await loadWoodImage(WOOD.shutter), handle: await loadWoodImage(WOOD.handle) }
  if (!DRY) fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {}

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
      // Part numbers must follow the app's (three.js) order, not the file's.
      orderLikeThree(doc)
      const rows = partRows(doc)
      const named = rows.some((r) => /shutter|handle/i.test(r.name))
      const parts = named ? detectByName(rows) : detectByShape(rows)
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
      report.bytes = `${sourceBytes} → ${out.byteLength}`
      console.log(JSON.stringify({ ...report, status: DRY ? 'OK (dry run)' : 'BAKED' }))
    } catch (e) {
      console.log(JSON.stringify({ ...report, status: 'ERROR — live file untouched', error: e.message }))
    }
  }
  if (!DRY) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
    console.log('originals + manifest in', BACKUP_DIR)
  }
}

main()
