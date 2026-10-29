// Save, in the database, the wood that is already baked into the 3D files of
// every kitchen cabinet, wardrobe and Living Room TV-wall item — so the BOQ's
// Material column and the Components panel name it instead of "—".
//
// Why: the upload baked the wood into each new GLB but did not record it, so
// the 3D view showed Wood 10002 while the BOQ listed no material at all. The
// upload now records it as it goes (auto-wood.js recordDefaultFinish); this
// fills in the models uploaded before.
//
// The 3D files are only READ. What is written, by record-baked-finish.mjs:
//   1. model defaults — every NEW placement of the model gets the finish;
//   2. parts of items ALREADY placed in projects, only where the part has no
//      finish yet (a finish someone chose is never replaced).
// The fronts get Wood 10002 and the handles Wood 10012 — exactly the woods in
// the file. Aluminium profile handles are not a catalogue finish and are left
// as they are.
//
// Run from the backend folder:
//   npm run finishes-record:check     dry run — changes NOTHING (default)
//   npm run finishes-record:apply     records; prints the undo command
//   node scripts/record-baked-finish.mjs --restore <backup.json>   (undo)

import { GLB_DIR, BACKUP_ROOT, BACKEND_DIR } from '../lib/env.mjs'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const APPLY = process.argv.includes('--apply')
const MANIFEST = path.join(BACKUP_ROOT, APPLY ? 'recorded-finishes.last-run.json' : 'recorded-finishes.dry-run.json')

const line = (t = '') => console.log(t)
const title = (t) => line(`\n━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}`)
const maskUrl = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@')
const loosely = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

async function main() {
  line(`Record baked finishes — ${APPLY ? 'APPLY' : 'CHECK ONLY (nothing will be changed)'}`)
  line(`   3D models: ${GLB_DIR}`)

  const { WOOD_CATEGORIES } = await import('../../src/services/model-upload/auto-wood.js')
  const { createIO, bakedParts } = await import('../lib/glb-wood-bake.mjs')
  const { default: config } = await import('config')
  const { MongoClient } = await import('mongodb')
  const mongoUrl = process.env.MONGODB_URL || config.get('mongodb')

  title('1. Find the models')
  const client = await MongoClient.connect(mongoUrl, { serverSelectionTimeoutMS: 8000 })
  let models
  const groupOf = new Map()
  try {
    const db = client.db()
    line(`   database: ${maskUrl(mongoUrl)} (db "${db.databaseName}")`)
    const cats = await db.collection('categories').find({}).project({ name: 1, parentCategoryId: 1 }).toArray()
    const byId = new Map(cats.map((c) => [String(c._id), c]))
    const wanted = new Set(WOOD_CATEGORIES.map(loosely))
    // The listed category the model sits in (its own or any above it), or null.
    const groupFor = (categoryId) => {
      let c = categoryId ? byId.get(String(categoryId)) : null
      for (let depth = 0; c && depth < 12; depth += 1) {
        if (wanted.has(loosely(c.name))) return c.name
        c = c.parentCategoryId ? byId.get(String(c.parentCategoryId)) : null
      }
      return null
    }
    models = (await db.collection('models').find({}).project({ name: 1, modelFileUrl: 1, categoryId: 1 }).toArray())
      .filter((m) => {
        const g = groupFor(m.categoryId)
        if (g) groupOf.set(String(m._id), g)
        return !!g
      })
  } finally {
    await client.close()
  }
  line(`   ${models.length} cabinet / wardrobe / TV-wall models`)

  title('2. Read the wood in each 3D file')
  const io = await createIO()
  const manifest = {}
  const perGroup = {}
  let plain = 0
  let missing = 0
  for (const m of models) {
    const file = String(m.modelFileUrl || '').split('/').pop()
    const full = path.join(GLB_DIR, file)
    const g = groupOf.get(String(m._id))
    perGroup[g] = perGroup[g] || { models: 0, withWood: 0 }
    perGroup[g].models += 1
    if (!file || !fs.existsSync(full)) {
      missing += 1
      continue
    }
    try {
      const parts = bakedParts(await io.read(full))
      if (!parts) {
        plain += 1
        continue
      }
      perGroup[g].withWood += 1
      manifest[file] = { modelId: String(m._id), name: String(m.name || '').trim(), shutters: parts.shutters, handles: parts.handles }
    } catch (e) {
      line(`   ✘ ${m.name}: cannot read ${file} — ${e.message}`)
    }
  }
  for (const [g, n] of Object.entries(perGroup)) line(`   ${g}: ${n.withWood} of ${n.models} carry wood`)
  if (plain) line(`   · ${plain} model(s) have no wood in the file (open units, uncoloured files) — nothing to record`)
  if (missing) line(`   ! ${missing} model(s) have no GLB file here — skipped`)
  fs.mkdirSync(BACKUP_ROOT, { recursive: true })
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))

  title(`3. ${APPLY ? 'Record' : 'Dry-run record of'} the finishes`)
  const code = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(BACKEND_DIR, 'scripts', 'record-baked-finish.mjs'), '--manifest', MANIFEST, ...(APPLY ? [] : ['--dry-run'])],
      { cwd: BACKEND_DIR, env: process.env, stdio: 'inherit' }
    )
    child.on('close', resolve)
  })
  if (code !== 0) {
    process.exitCode = 1
    return
  }
  line(APPLY
    ? '\n   Done. To undo, run record-baked-finish.mjs --restore with the "backup" file printed above.\n   Open the BOQ again (or F5) to see the materials.'
    : '\n   CHECK ONLY — nothing was changed.\n   To apply:  npm run finishes-record:apply')
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exit(1)
})
