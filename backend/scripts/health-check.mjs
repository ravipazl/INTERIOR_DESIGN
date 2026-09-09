// One command that tells you whether this installation is actually sound.
//
//   node scripts/health-check.mjs
//
// WHY THIS EXISTS
// ---------------
// Several fixes in this project live in files that are UNTRACKED by git, and
// they have repeatedly disappeared — taking working features with them, quietly.
// Nothing announces it: the app still starts, and the damage only shows up later
// as a missing model, an empty panel, or a wrong price in a quote.
//
// Every check below corresponds to a real failure that has happened here, so a
// FAIL line names a symptom you would otherwise have to rediscover by hand.
//
// Read-only. It never writes to the database or changes a file.
// Node's punycode DeprecationWarning comes from a transitive dependency and has
// nothing to do with this project. Printed mid-report it looks like a finding,
// which is the opposite of what a health check should do.
process.noDeprecation = true

import fs from 'fs'
import path from 'path'
import url from 'url'
import { MongoClient } from 'mongodb'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..', '..')
const MONGO = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const DB = process.env.MONGO_DB || 'interior-design'
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3400'
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3040'

let pass = 0
let fail = 0
const failures = []

const ok = (label, detail = '') => {
  pass++
  console.log(`  PASS  ${label}${detail ? '  ' + detail : ''}`)
}
const bad = (label, detail, symptom) => {
  fail++
  failures.push(symptom)
  console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`)
  console.log(`        -> ${symptom}`)
}

const section = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`)

// A file must exist; optionally it must also contain a marker string.
const checkFile = (rel, label, symptom, marker) => {
  const p = path.join(REPO, rel)
  if (!fs.existsSync(p)) return bad(label, rel, symptom)
  if (marker && !fs.readFileSync(p, 'utf8').includes(marker)) {
    return bad(label, `${rel} (present, fix missing)`, symptom)
  }
  ok(label)
}

const http = async (u) => {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) })
    return r.status
  } catch {
    return 0
  }
}

console.log(`repo : ${REPO}`)
console.log(`db   : ${DB}`)

// ---------------------------------------------------------------------------
section('1. Static files (these have gone missing before)')
// ---------------------------------------------------------------------------
checkFile(
  'frontend/public/sam.worker.js',
  'SAM worker',
  '"Select an object" dies with an uninformative bare Error event.'
)
checkFile(
  'frontend/public/refine.js',
  'refine.js (the worker importScripts it)',
  'The SAM worker loads and then fails on its first line.'
)
checkFile(
  'frontend/public/assets/icons/translateGroup.svg',
  '2D editor move-handle icon',
  'The move handle renders blank in the Floor Plan editor.'
)
{
  const glb = path.join(REPO, 'frontend/public/assets/models/glb')
  const n = fs.existsSync(glb) ? fs.readdirSync(glb).length : 0
  if (n > 400) ok('3D model files', `${n} .glb`)
  else
    bad(
      '3D model files',
      `${n} found`,
      'Furniture 404s in the 3D view — the GLB library is not in git and must be copied in separately.'
    )
}

// ---------------------------------------------------------------------------
section('2. Code fixes (each one has been reverted at least once)')
// ---------------------------------------------------------------------------
checkFile(
  'backend/src/utils/string-id-service.js',
  'Catalog id lookups (String _id)',
  'Finish rates fall back to DEFAULTS -> wrong prices in the BOQ, plus hundreds of NotFound errors per generation.',
  'StringIdMongoService'
)
checkFile(
  'backend/src/services/categories/categories.class.js',
  'Catalog services use it',
  'Same as above — the helper exists but nothing uses it.',
  'StringIdMongoService'
)
checkFile(
  'frontend/src/react-app/services/ProjectManager.ts',
  'Scene saved when an item is added',
  'A newly added model is treated as an orphan on reload and silently dropped from the BOQ.',
  'HISTORY_TITLES.FLOOR_ITEM_ADDED'
)
checkFile(
  'backend/src/services/projects/projects.js',
  'Projects scoped to their owner',
  'DATA LEAK: any logged-in user can list every project in the system.',
  'limitProjectsToViewer'
)
checkFile(
  'backend/src/image-edit-proxy.js',
  'Image-edit proxy',
  'Remove object / background removal / text-select all fail.',
  'PREFIX'
)
checkFile(
  'frontend/src/inspire/services/projectService.js',
  'No duplicate projects on create',
  'Every new project is stored TWICE (ObjectId + String _id) and the copies drift apart.',
  'mirrorsToSelf'
)
checkFile(
  'frontend/src/inspire/pages/Dashboard/AdminDashboard/Projects.jsx',
  'Admin project list auto-refreshes',
  "The admin never sees the architect's changes without a manual reload.",
  'visibilitychange'
)

// ---------------------------------------------------------------------------
section('3. Services responding')
// ---------------------------------------------------------------------------
{
  const s = await http(`${BACKEND}/image-edit/api/health`)
  if (s === 401) ok('Backend + proxy auth gate', 'HTTP 401 (correct: needs a login)')
  else if (s === 0) bad('Backend', 'not responding', 'The API is down — start it with: npm run dev')
  else if (s === 404)
    bad('Image-edit proxy', 'HTTP 404', 'The backend is running OLD code — restart it to load the proxy.')
  else ok('Backend + proxy', `HTTP ${s}`)
}
{
  const s = await http('http://127.0.0.1:8199/api/health')
  if (s === 200) ok('Python image service', 'HTTP 200')
  else
    bad(
      'Python image service',
      s ? `HTTP ${s}` : 'not responding',
      'Remove object / background removal will fail. Start it with: npm run image-service'
    )
}
{
  const s = await http(`${FRONTEND}/sam.worker.js`)
  if (s === 200) ok('Frontend serving static files', 'HTTP 200')
  else bad('Frontend', s ? `HTTP ${s}` : 'not responding', 'Start it with: npm start (in frontend/)')
}

// ---------------------------------------------------------------------------
section('4. Data')
// ---------------------------------------------------------------------------
const client = new MongoClient(MONGO)
await client.connect()
const db = client.db(DB)

for (const [col, min, symptom] of [
  ['models', 1, 'The Explore panel shows no items.'],
  ['categories', 1, 'Models have no category.'],
  ['settings', 1, 'GET /settings/installationRatePerSqft returns 404.']
]) {
  const n = await db.collection(col).countDocuments()
  if (n >= min) ok(`${col} seeded`, `${n} documents`)
  else bad(`${col} EMPTY`, `${n} documents`, symptom + ' Run: node scripts/seed-catalog.mjs')
}

// Duplicate project ids (same hex, different BSON type)
{
  const projects = await db.collection('projects').find({}, { projection: { _id: 1 } }).toArray()
  const seen = new Map()
  const dupes = []
  for (const p of projects) {
    const k = String(p._id)
    if (seen.has(k)) dupes.push(k)
    else seen.set(k, true)
  }
  if (!dupes.length) ok('No duplicate projects', `${projects.length} project(s)`)
  else
    bad(
      'Duplicate projects',
      dupes.join(', '),
      'One project stored twice (ObjectId + String _id). The two copies drift apart and both show in the admin list.'
    )
}

// Scene / isActive disagreement
{
  let stranded = 0
  for (const fp of await db.collection('floorplans').find({}).toArray()) {
    let scene = fp.scene
    if (typeof scene === 'string') {
      try {
        scene = JSON.parse(scene)
      } catch {
        continue
      }
    }
    const ids = new Set((scene?.items || []).map((i) => i?.dbid).filter(Boolean))
    const models = await db
      .collection('furnished_models')
      .find({ floorPlanId: String(fp._id) })
      .toArray()
    stranded += models.filter((m) => ids.has(String(m._id)) && m.isActive !== true).length
  }
  if (!stranded) ok('Scene and BOQ agree')
  else
    bad(
      'Scene / BOQ mismatch',
      `${stranded} item(s)`,
      'Items visible in Furnish but missing from Production. Run: node scripts/reconcile-scene-items.mjs --apply'
    )
}

await client.close()

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64))
console.log(`${pass} passed, ${fail} failed`)
if (fail) {
  console.log('\nWhat is broken right now:')
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  console.log(
    '\nMost of these come back after an untracked file is deleted.\nCommitting the work is what stops it recurring.'
  )
}
process.exit(fail ? 1 : 0)
