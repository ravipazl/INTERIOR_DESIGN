// Apply the default Living Room TV-wall finish on a server (e.g. live) — the
// same result a new upload gets (scripts/lib/living-finish.mjs):
//
//   TV drawer unit   drawer front → Wood 10002, bar handles → Wood 10012,
//                    body and top → plain white
//   TV back panel    the whole panel → Wood 10002
//   wall cladding    the whole slat → Wood 10002
//
// For the items uploaded BEFORE this rule existed. The finish is baked INTO the
// GLB files and recorded in the database (model defaults + placed parts that
// have no finish yet), so the 3D view, the Components panel and the BOQ all
// show it.
//
// Run from the backend folder:
//   npm run living-finishes:check     checks + dry run — changes NOTHING (default)
//   npm run living-finishes:apply     backs up, bakes, records, verifies
//   node scripts/production/living-finish-live.mjs --restore <run-log.json>
//
// Settings come from the backend .env (scripts/lib/env.mjs): MONGODB_URL,
// GLB_STORAGE_DIR, optionally WOOD_TEXTURE_DIR and CABINET_BACKUP_DIR. If a
// category has another name on a server, set LIVING_TV_UNIT_CATEGORY,
// LIVING_TV_PANEL_CATEGORY or LIVING_CLADDING_CATEGORY in the .env.
//
// Safe to run again: every bake starts from the file as it was before the FIRST
// run (kept in the backup folder), and a finish someone chose on a placed item
// is never replaced.

import { GLB_DIR, WOOD_DIR, BACKUP_ROOT, BACKEND_DIR } from '../lib/env.mjs'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const RESTORE_LOG = args.indexOf('--restore') !== -1 ? args[args.indexOf('--restore') + 1] : null
const BACKUP_DIR = path.join(BACKUP_ROOT, 'glb-original-living')
const MANIFEST = path.join(BACKUP_DIR, APPLY ? 'baked-parts.last-run.json' : 'baked-parts.dry-run.json')
const GROUPS = [
  { label: 'TV drawer units', name: process.env.LIVING_TV_UNIT_CATEGORY || 'TV Draw Unit', rule: 'cabinet' },
  { label: 'TV back panels', name: process.env.LIVING_TV_PANEL_CATEGORY || 'Tv back panel', rule: 'panel' },
  { label: 'Wall cladding', name: process.env.LIVING_CLADDING_CATEGORY || 'wall cladding', rule: 'panel' }
]
const FINISHES = [
  { name: 'Wood 10002', image: '10002.jpg', fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg' },
  { name: 'Wood 10012', image: '10012.jpg', fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg' }
]

const line = (t = '') => console.log(t)
const title = (t) => line(`\n━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}`)
const maskUrl = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@')
const fileOf = (m) => String(m.modelFileUrl || '').split('/').pop()
const loosely = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Run another script; prints its output and returns it. Throws on failure. */
function run(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(BACKEND_DIR, 'scripts', script), ...scriptArgs], {
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

/**
 * The models of every category called `name`, and of everything below it.
 *
 * Matched loosely, and only at the TOP of a run of same-named categories:
 * "Tv back panel" holds a sub-category also called "Tv back panel", and taking
 * that one alone would miss its sibling "Tv back panel - groove".
 */
async function modelsNamed(db, name) {
  const cats = await db.collection('categories').find({}).project({ name: 1, parentCategoryId: 1 }).toArray()
  const byId = new Map(cats.map((c) => [String(c._id), c]))
  const hits = cats.filter((c) => loosely(c.name) === loosely(name))
  const tops = hits.filter((c) => {
    const parent = c.parentCategoryId ? byId.get(String(c.parentCategoryId)) : null
    return !(parent && loosely(parent.name) === loosely(name))
  })
  if (!tops.length) return null
  const ids = new Set(tops.map((c) => String(c._id)))
  for (let grew = true; grew; ) {
    grew = false
    for (const c of cats) {
      if (c.parentCategoryId && ids.has(String(c.parentCategoryId)) && !ids.has(String(c._id))) {
        ids.add(String(c._id))
        grew = true
      }
    }
  }
  const { ObjectId } = await import('mongodb')
  const any = [...ids].flatMap((id) => (/^[a-f0-9]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id]))
  return db.collection('models').find({ categoryId: { $in: any } }).project({ name: 1, modelFileUrl: 1 }).toArray()
}

/** Checks; returns [{ group, models }]. Exits when anything is wrong. */
async function preflight() {
  title('1. Checks')
  const problems = []
  const ok = (t) => line(`   ✔ ${t}`)
  const bad = (t) => {
    line(`   ✘ ${t}`)
    problems.push(t)
  }

  for (const dep of ['@gltf-transform/core', '@gltf-transform/functions', 'draco3d', 'sharp', 'mongodb', 'config']) {
    try {
      await import(dep)
    } catch (e) {
      bad(`package "${dep}" is not installed — run "npm install" in the backend folder`)
    }
  }
  if (!fs.existsSync(GLB_DIR)) bad(`3D model folder not found: ${GLB_DIR} (set GLB_STORAGE_DIR in the backend .env)`)
  else {
    try {
      fs.accessSync(GLB_DIR, fs.constants.W_OK)
      ok(`3D model folder: ${GLB_DIR} (writable)`)
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
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    fs.accessSync(BACKUP_DIR, fs.constants.W_OK)
    ok(`backup folder: ${BACKUP_DIR}`)
  } catch {
    bad(`backup folder is not writable: ${BACKUP_DIR} (set CABINET_BACKUP_DIR)`)
  }

  const { default: config } = await import('config')
  const { MongoClient } = await import('mongodb')
  const mongoUrl = process.env.MONGODB_URL || config.get('mongodb')
  let client
  const found = []
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
    for (const group of GROUPS) {
      const models = await modelsNamed(db, group.name)
      if (!models) {
        bad(`${group.label}: no category called "${group.name}" (set its name in backend/.env — see the top of this script)`)
        continue
      }
      const present = models.filter((m) => fs.existsSync(path.join(GLB_DIR, fileOf(m))))
      ok(`${group.label} → category "${group.name}": ${models.length} models, ${present.length} GLB files present`)
      found.push({ group, models })
    }
  } catch (e) {
    bad(`database not reachable: ${maskUrl(mongoUrl)} — ${e.message}`)
  } finally {
    await client?.close()
  }

  if (problems.length) {
    line(`\n   Stopped: ${problems.length} problem(s) above. Nothing was changed.`)
    process.exit(1)
  }
  return found
}

/** Bake every file (or only report, on a dry run). */
async function bake(found) {
  title(`2. ${APPLY ? 'Bake' : 'Dry-run bake of'} the finish into the GLB files`)
  const { createIO, loadWoodImage, WOOD } = await import('../lib/glb-wood-bake.mjs')
  const { finishLivingDoc } = await import('../lib/living-finish.mjs')
  const io = await createIO()
  const images = { shutter: await loadWoodImage(WOOD.shutter), handle: await loadWoodImage(WOOD.handle) }
  const manifest = {}
  const result = { baked: [], plain: [], missing: [], errors: [] }

  for (const { group, models } of found) {
    line(` • ${group.label}`)
    for (const m of models) {
      const name = String(m.name || '').trim()
      const file = fileOf(m)
      const live = path.join(GLB_DIR, file)
      const backup = path.join(BACKUP_DIR, file)
      if (!file || (!fs.existsSync(live) && !fs.existsSync(backup))) {
        result.missing.push(name)
        line(`   ! ${name}: GLB file missing (skipped)`)
        continue
      }
      try {
        // Always from the file as it was before the first run.
        const source = fs.existsSync(backup) ? backup : live
        const finished = await finishLivingDoc(group.rule, io, await io.read(source), images)
        if (!finished) {
          result.plain.push(name)
          line(`   · ${name}: nothing to colour (left as it is)`)
          continue
        }
        const { shutters, handles } = finished.parts
        if (APPLY) {
          if (!fs.existsSync(backup)) fs.copyFileSync(live, backup)
          const tmp = live + '.tmp'
          fs.writeFileSync(tmp, finished.buffer)
          fs.renameSync(tmp, live)
        }
        // record-baked-finish.mjs reads shutters + handles.
        manifest[file] = { modelId: String(m._id), name, shutters, handles }
        result.baked.push(name)
        line(`   ✔ ${name}: ${shutters.length} part(s) Wood 10002, ${handles.length} handle(s) Wood 10012`)
      } catch (e) {
        result.errors.push(`${name}: ${e.message}`)
        line(`   ✘ ${name}: ${e.message} — file left untouched`)
      }
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  return { manifest, result }
}

/** Re-open every baked file and confirm the wood is on the expected parts. */
async function verify(manifest) {
  title('4. Verify baked files')
  const { createIO, partRows } = await import('../lib/glb-wood-bake.mjs')
  const io = await createIO()
  let good = 0
  const failed = []
  for (const [file, e] of Object.entries(manifest)) {
    try {
      const rows = partRows(await io.read(path.join(GLB_DIR, file)))
      const has = (i, label) => rows[i]?.prim.getMaterial()?.getExtras()?.bakedFinish === label
      if (e.shutters.every((i) => has(i, 'Wood 10002')) && e.handles.every((i) => has(i, 'Wood 10012'))) good++
      else failed.push(`${e.name}: wood not found on the expected parts`)
    } catch (err) {
      failed.push(`${e.name}: cannot read ${file} — ${err.message}`)
    }
  }
  line(`   ✔ ${good} file(s) verified`)
  failed.forEach((f) => line(`   ✘ ${f}`))
  return failed
}

async function restore(logFile) {
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'))
  title('Restore the Living Room GLB files')
  let n = 0
  for (const file of log.files || []) {
    const backup = path.join(BACKUP_DIR, file)
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, path.join(GLB_DIR, file))
      n++
    }
  }
  line(`   ✔ ${n} file(s) restored`)
  if (log.recordBackup) {
    title('Undo recorded finishes')
    await run('record-baked-finish.mjs', ['--restore', log.recordBackup])
  }
  line('\n   Done. Ask users to refresh the page (Ctrl+F5).')
}

async function main() {
  line(`Living Room finishes — ${RESTORE_LOG ? 'RESTORE' : APPLY ? 'APPLY' : 'CHECK ONLY (nothing will be changed)'}`)
  line(`   3D models: ${GLB_DIR}`)
  line(`   backups:   ${BACKUP_DIR}`)
  if (RESTORE_LOG) {
    await restore(path.resolve(RESTORE_LOG))
    return
  }

  const found = await preflight()
  const { manifest, result } = await bake(found)

  title(`3. ${APPLY ? 'Record' : 'Dry-run record of'} the wood in the database`)
  const out = await run('record-baked-finish.mjs', ['--manifest', MANIFEST, ...(APPLY ? [] : ['--dry-run'])])
  const problems = [...result.errors]
  const skipped = out.match(/"skipped":\s*\[([\s\S]*?)\]/)
  if (skipped && skipped[1].trim()) problems.push('finish not recorded for some parts — see "skipped" above')

  const summary = () => {
    line(`   ${result.baked.length} item(s) ${APPLY ? 'finished' : 'would be finished'}, ${result.plain.length} left as they are, ${result.missing.length} missing file(s).`)
    problems.forEach((p) => line(`   ✘ ${p}`))
  }
  if (!APPLY) {
    title('Result')
    summary()
    line('\n   CHECK ONLY — nothing was changed.')
    line('   To apply:  npm run living-finishes:apply')
    if (problems.length) process.exitCode = 1
    return
  }

  problems.push(...(await verify(manifest)))
  const m = out.match(/"backup":\s*"((?:[^"\\]|\\.)*)"/)
  const logFile = path.join(BACKUP_ROOT, `living-finishes-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(
    logFile,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        glbDir: GLB_DIR,
        glbBackup: BACKUP_DIR,
        recordBackup: m ? JSON.parse(`"${m[1]}"`) : null,
        files: Object.keys(manifest),
        problems
      },
      null,
      2
    )
  )
  title('Result')
  summary()
  line('   Undo everything with:')
  line(`     node scripts/production/living-finish-live.mjs --restore "${logFile}"`)
  line('   Ask users to refresh the page (Ctrl+F5) to load the new 3D files.')
  if (problems.length) process.exitCode = 1
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exit(1)
})
