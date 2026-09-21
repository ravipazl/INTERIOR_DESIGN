// Apply the cabinet shutter + handle finishes on a server (e.g. live) — the
// same result as on the development PC:
//
//   Tall Units                          shutter → Wood 10002, handle → Wood 10012
//   Below Counter Storage (incl. Corner Units, Base units, Oil pull-outs, BC units)
//   Wall Units (glass unit: door frame only)
//
// The finish is baked INTO the GLB files and recorded in the database (model
// defaults + placed parts that have no finish yet), so the 3D view, the
// Components panel and the BOQ all show it.
//
// Run from the backend folder:
//   npm run cabinet-finishes:check     checks + dry run — changes NOTHING (default)
//   npm run cabinet-finishes:apply     backs up, bakes, records, verifies
//   node scripts/production/apply-cabinet-finishes.mjs --restore <run-log.json>
//
// Settings are read from the backend .env (see scripts/lib/env.mjs):
//   MONGODB_URL, GLB_STORAGE_DIR, and optionally WOOD_TEXTURE_DIR,
//   CABINET_BACKUP_DIR.
//
// Safe to run again: every bake starts from the ORIGINAL file kept in the backup
// folder, finishes already recorded are left alone, and a finish someone chose
// on a placed item is never replaced.

import { GLB_DIR, WOOD_DIR, BACKUP_ROOT, BACKEND_DIR } from '../lib/env.mjs'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const RESTORE_LOG = args.indexOf('--restore') !== -1 ? args[args.indexOf('--restore') + 1] : null
const SCRIPTS = path.join(BACKEND_DIR, 'scripts')

const CATEGORIES = [
  { name: 'Below Counter Storage', folder: 'glb-original-below-counter' },
  { name: 'Wall Unit', folder: 'glb-original-wall-unit' }
]
const TALL_FOLDER = 'glb-original-tall-units'
const FINISHES = [
  { name: 'Wood 10002', image: '10002.jpg', fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg' },
  { name: 'Wood 10012', image: '10012.jpg', fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg' }
]

const line = (t = '') => console.log(t)
const title = (t) => line(`\n━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}`)
const maskUrl = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@')

/** Run one of the scripts; prints its output and returns it. Throws on failure. */
function run(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), ...scriptArgs], {
      cwd: BACKEND_DIR,
      env: process.env
    })
    let out = ''
    const onData = (d) => {
      const text = d.toString()
      out += text
      text
        .split(/\r?\n/)
        .filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation/.test(l))
        .forEach((l) => line('   ' + l))
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${script} ${scriptArgs.join(' ')} failed (exit ${code})`))
    )
  })
}

/** JSON lines a bake script printed (one per model). */
const jsonLines = (out) =>
  out
    .split(/\r?\n/)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)

/** The "backup" file a record script reports. */
const backupFileOf = (out) => {
  const m = out.match(/"backup":\s*"((?:[^"\\]|\\.)*)"/)
  return m ? JSON.parse(`"${m[1]}"`) : null
}

async function preflight() {
  title('1. Checks')
  const problems = []
  const ok = (t) => line(`   ✔ ${t}`)
  const bad = (t) => {
    line(`   ✘ ${t}`)
    problems.push(t)
  }

  const major = Number(process.versions.node.split('.')[0])
  major >= 16 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} — 16 or newer is needed`)

  for (const dep of ['@gltf-transform/core', '@gltf-transform/extensions', 'draco3d', 'sharp', 'mongodb', 'config', 'uuid']) {
    try {
      await import(dep)
    } catch (e) {
      bad(`package "${dep}" is not installed — run "npm install" in the backend folder`)
    }
  }

  if (!fs.existsSync(GLB_DIR)) bad(`3D model folder not found: ${GLB_DIR} (set GLB_STORAGE_DIR in the backend .env)`)
  else {
    const count = fs.readdirSync(GLB_DIR).filter((f) => f.endsWith('.glb')).length
    try {
      fs.accessSync(GLB_DIR, fs.constants.W_OK)
      ok(`3D model folder: ${GLB_DIR} (${count} GLB files, writable)`)
    } catch {
      bad(`3D model folder is not writable: ${GLB_DIR}`)
    }
  }

  for (const f of FINISHES) {
    fs.existsSync(path.join(WOOD_DIR, f.image))
      ? ok(`wood image ${f.image} in ${WOOD_DIR}`)
      : bad(`wood image ${f.image} not found in ${WOOD_DIR} (set WOOD_TEXTURE_DIR)`)
  }

  try {
    fs.mkdirSync(BACKUP_ROOT, { recursive: true })
    fs.accessSync(BACKUP_ROOT, fs.constants.W_OK)
    ok(`backup folder: ${BACKUP_ROOT}`)
  } catch {
    bad(`backup folder is not writable: ${BACKUP_ROOT} (set CABINET_BACKUP_DIR)`)
  }

  // Database: connection, the two finishes, the categories and tall-unit files.
  const { default: config } = await import('config')
  const { MongoClient } = await import('mongodb')
  const mongoUrl = process.env.MONGODB_URL || config.get('mongodb')
  let client
  try {
    client = await MongoClient.connect(mongoUrl, { serverSelectionTimeoutMS: 8000 })
    const db = client.db()
    ok(`database: ${maskUrl(mongoUrl)} (db "${db.databaseName}")`)
    for (const f of FINISHES) {
      const row = await db.collection('finishings').findOne({ name: f.name, type: 'wall' })
      if (!row) bad(`finish "${f.name}" (wall) is missing in the database`)
      else if (row.texture?.fileUrl !== f.fileUrl) bad(`finish "${f.name}" uses ${row.texture?.fileUrl}, expected ${f.fileUrl}`)
      else ok(`finish "${f.name}" found`)
    }
    for (const c of CATEGORIES) {
      const cat = await db.collection('categories').findOne({ name: c.name })
      if (!cat) {
        bad(`category "${c.name}" is missing in the database`)
        continue
      }
      const models = await db
        .collection('models')
        .find({ categoryId: { $in: [String(cat._id), cat._id] } })
        .project({ modelFileUrl: 1 })
        .toArray()
      const present = models.filter((m) => fs.existsSync(path.join(GLB_DIR, String(m.modelFileUrl || '').split('/').pop())))
      ok(`category "${c.name}": ${models.length} models, ${present.length} GLB files present`)
    }
    const tall = await db.collection('categories').findOne({ name: 'Tall Units' })
    tall ? ok('category "Tall Units" found') : line('   ! category "Tall Units" not found — the tall units are matched by file name')
  } catch (e) {
    bad(`database not reachable: ${maskUrl(mongoUrl)} — ${e.message}`)
  } finally {
    await client?.close()
  }

  if (problems.length) {
    line(`\n   Stopped: ${problems.length} problem(s) above. Nothing was changed.`)
    process.exit(1)
  }
}

/** Re-open every baked file and confirm the wood is on the expected parts. */
async function verify(expected) {
  title('4. Verify baked files')
  const { createIO, partRows } = await import('../lib/glb-wood-bake.mjs')
  const io = await createIO()
  let good = 0
  const failed = []
  for (const e of expected) {
    const file = path.join(GLB_DIR, e.file)
    try {
      const rows = partRows(await io.read(file))
      const has = (i, label) => rows[i]?.prim.getMaterial()?.getExtras()?.bakedFinish === label
      const okShutters = e.shutters.every((i) => has(i, 'Wood 10002'))
      const okHandles = e.handles.every((i) => has(i, 'Wood 10012'))
      if (okShutters && okHandles) good++
      else failed.push(`${e.name}: wood not found on the expected parts`)
    } catch (err) {
      failed.push(`${e.name}: cannot read ${e.file} — ${err.message}`)
    }
  }
  line(`   ✔ ${good} file(s) verified`)
  failed.forEach((f) => line(`   ✘ ${f}`))
  return failed
}

async function restore(logFile) {
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'))
  title('Restore original GLB files')
  await run('bake-tall-unit-wood.mjs', ['--restore'])
  for (const c of CATEGORIES) await run('bake-category-wood.mjs', ['--category', c.name, '--restore'])
  title('Undo recorded finishes')
  if (log.recordBackups?.tall) await run('record-tall-unit-finish.mjs', ['--restore', log.recordBackups.tall])
  for (const f of log.recordBackups?.categories || []) await run('record-baked-finish.mjs', ['--restore', f])
  line('\n   Done. Ask users to refresh the page (Ctrl+F5).')
}

async function main() {
  line(`Cabinet finishes — ${RESTORE_LOG ? 'RESTORE' : APPLY ? 'APPLY' : 'CHECK ONLY (nothing will be changed)'}`)
  line(`   3D models: ${GLB_DIR}`)
  line(`   backups:   ${BACKUP_ROOT}`)

  if (RESTORE_LOG) {
    await restore(path.resolve(RESTORE_LOG))
    return
  }

  await preflight()
  const dry = APPLY ? [] : ['--dry-run']

  title(`2. ${APPLY ? 'Bake' : 'Dry-run bake of'} the shutter + handle wood into the GLB files`)
  const expected = []
  const problems = []
  const warnings = []
  const collect = (out) =>
    jsonLines(out).forEach((j) => {
      const what = `${j.model || j.file}: ${j.status}`
      if (/ERROR|ABORTED/.test(j.status || '')) problems.push(what)
      else if (/MISSING/.test(j.status || '')) warnings.push(what)
    })

  line(' • Tall Units')
  const tallOut = await run('bake-tall-unit-wood.mjs', dry)
  collect(tallOut)
  for (const j of jsonLines(tallOut)) {
    if (j.shutter && j.handle) {
      expected.push({ name: j.file, file: j.file, shutters: [Number(j.shutter.slice(5))], handles: [Number(j.handle.slice(5))] })
    }
  }

  const lists = []
  for (const c of CATEGORIES) {
    line(` • ${c.name}`)
    collect(await run('bake-category-wood.mjs', ['--category', c.name, ...dry]))
    const list = path.join(BACKUP_ROOT, c.folder, APPLY ? 'baked-parts.last-run.json' : 'baked-parts.dry-run.json')
    lists.push(list)
    if (fs.existsSync(list)) {
      for (const [file, e] of Object.entries(JSON.parse(fs.readFileSync(list, 'utf8')))) {
        expected.push({ name: e.name, file, shutters: e.shutters, handles: e.handles })
      }
    }
  }

  title(`3. ${APPLY ? 'Record' : 'Dry-run record of'} the finish in the database`)
  const recordBackups = { tall: null, categories: [] }
  line(' • Tall Units')
  const tallRec = await run('record-tall-unit-finish.mjs', dry)
  recordBackups.tall = backupFileOf(tallRec)
  for (const list of lists) {
    if (!fs.existsSync(list)) continue
    line(` • ${path.basename(path.dirname(list))}`)
    const out = await run('record-baked-finish.mjs', ['--manifest', list, ...dry])
    const b = backupFileOf(out)
    if (b) recordBackups.categories.push(b)
    const skipped = out.match(/"skipped":\s*\[([\s\S]*?)\]/)
    if (skipped && skipped[1].trim()) problems.push(`finish not recorded for some parts — see "skipped" above`)
  }

  if (!APPLY) {
    title('Result')
    line(`   ${expected.length} cabinet GLB file(s) would be baked / are already baked.`)
    problems.forEach((p) => line(`   ✘ ${p}`))
    warnings.forEach((w) => line(`   ! ${w} (skipped)`))
    line('\n   CHECK ONLY — nothing was changed.')
    line('   To apply:  npm run cabinet-finishes:apply')
    if (problems.length) process.exitCode = 1
    return
  }

  const verifyFailed = await verify(expected)
  const logFile = path.join(BACKUP_ROOT, `cabinet-finishes-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(
    logFile,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        glbDir: GLB_DIR,
        glbBackups: [TALL_FOLDER, ...CATEGORIES.map((c) => c.folder)].map((f) => path.join(BACKUP_ROOT, f)),
        recordBackups,
        files: expected.map((e) => e.file),
        problems: [...problems, ...verifyFailed]
      },
      null,
      2
    )
  )

  title('Result')
  line(`   ${expected.length} cabinet GLB file(s) baked and recorded.`)
  ;[...problems, ...verifyFailed].forEach((p) => line(`   ✘ ${p}`))
  warnings.forEach((w) => line(`   ! ${w} (skipped)`))
  line(`   Undo everything with:`)
  line(`     node scripts/production/apply-cabinet-finishes.mjs --restore "${logFile}"`)
  line('   Ask users to refresh the page (Ctrl+F5) to load the new 3D files.')
  if (problems.length || verifyFailed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exit(1)
})
