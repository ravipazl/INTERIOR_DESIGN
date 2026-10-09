// Load the laminate brand catalogues (Merino, Greenlam, Virgo) on a server —
// the same grades, materials and pictures as on the development PC.
//
// Run from the backend folder:
//   npm run laminate-catalogue:check     checks + dry run — changes NOTHING (default)
//   npm run laminate-catalogue:apply     writes, then verifies
//   npm run laminate-catalogue:verify    read-only report of what is there
//   node scripts/production/laminate-catalogue-live.mjs --apply --rates
//   node scripts/production/laminate-catalogue-live.mjs --restore <run-log.json>
//
// Settings come from the backend .env (scripts/lib/env.mjs): MONGODB_URL.
// The database it will touch is printed first, with the password hidden.
//
// WHAT IT DOES
//
// Reads scripts/production/data/laminate-catalogue.json and, for each brand:
// finds the brand by name (creating it only if absent), creates its grades
// under the finish type they belong to, and creates its materials in those
// grades, each pointing at a picture that ships in the repo.
//
// WHY IT IS SAFE TO RUN, AND TO RUN AGAIN
//
//  - Everything is matched BY NAME on this server. The data file carries no
//    ids, because ids are different on every machine.
//  - A grade is identified by brand + type + name; a material by brand +
//    grade + décor code. One that already exists is updated in place, never
//    duplicated — a second run creates nothing.
//  - It only ever touches rows belonging to the brands in the data file.
//    Materials with no brand, other brands, saved projects and BOQ figures are
//    not read for writing at all.
//  - --apply saves a run log first. --restore <log> deletes exactly what that
//    run created and puts back exactly what it changed.
//
// RATES ARE OPT-IN (--rates). Prices are a commercial decision and a server
// may already carry its own; without the flag none are written. With it, a
// rate is added only where that brand + grade has none — an existing rate is
// never overwritten.
//
// ORDER MATTERS ON LIVE: run this BEFORE the new frontend goes out. The new
// material panel lists a brand's own grades; until those exist a brand has
// nothing to offer.

import { REPO_DIR, BACKUP_ROOT } from '../lib/env.mjs'
import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(HERE, 'data', 'laminate-catalogue.json')
// Where the app serves /assets from. Set TEXTURE_PUBLIC_DIR if the server
// serves a built bundle from somewhere other than frontend/public.
const PUBLIC_DIR = process.env.TEXTURE_PUBLIC_DIR
  ? path.resolve(process.env.TEXTURE_PUBLIC_DIR)
  : path.join(REPO_DIR, 'frontend', 'public')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const VERIFY = args.includes('--verify')
const RATES = args.includes('--rates')
const ALLOW_MISSING = args.includes('--allow-missing-pictures')
const RESTORE = args.indexOf('--restore') !== -1 ? args[args.indexOf('--restore') + 1] : null

const line = (t = '') => console.log(t)
const title = (t) => line(`\n━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}`)
const mask = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@')
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
const onDisk = (fileUrl) =>
  fs.existsSync(path.join(PUBLIC_DIR, String(fileUrl).replace(/^\//, '')))

const restore = async (db, file) => {
  const log = JSON.parse(fs.readFileSync(file, 'utf8'))
  const del = async (coll, ids) =>
    ids?.length ? (await db.collection(coll).deleteMany({ _id: { $in: ids } })).deletedCount : 0
  // Rate ids are ObjectIds, written to the log as strings.
  let rates = 0
  if (log.createdRateIds?.length) {
    const { ObjectId } = await import('mongodb')
    rates = (
      await db
        .collection('finishing_pricing')
        .deleteMany({ _id: { $in: log.createdRateIds.map((i) => new ObjectId(i)) } })
    ).deletedCount
  }
  const mats = await del('finishings', log.createdMaterialIds)
  for (const m of log.updatedMaterials || []) {
    await db.collection('finishings').updateOne({ _id: m._id }, { $set: m.before })
  }
  const grades = await del('finishing_categories', log.createdGradeIds)
  const brands = await del('finishing_brands', log.createdBrandIds)
  line(
    `Restored: ${mats} material(s) deleted, ${(log.updatedMaterials || []).length} put back, ` +
      `${grades} grade(s), ${brands} brand(s), ${rates} rate(s) deleted.`
  )
}

const main = async () => {
  const uri = process.env.MONGODB_URL || config.get('mongodb')
  title('Target')
  line(`database : ${mask(uri)}`)
  line(`pictures : ${PUBLIC_DIR}`)
  line(`mode     : ${RESTORE ? 'RESTORE' : VERIFY ? 'verify (read only)' : APPLY ? 'APPLY' : 'check (dry run, changes nothing)'}`)

  const client = await MongoClient.connect(uri)
  const db = client.db()
  const B = db.collection('finishing_brands')
  const C = db.collection('finishing_categories')
  const F = db.collection('finishings')

  if (RESTORE) {
    await restore(db, RESTORE)
    await client.close()
    return
  }

  if (!fs.existsSync(DATA)) throw new Error(`data file not found: ${DATA}`)
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'))
  line(`data     : ${path.relative(REPO_DIR, DATA)} (exported ${data.exportedAt})`)

  const allCats = await C.find({}).toArray()
  const allBrands = await B.find({}).toArray()
  const types = allCats.filter((c) => !c.parentCategoryId)

  // ── checks ──────────────────────────────────────────────────────────────
  title('Checks')
  let blocked = false
  const needTypes = [...new Set(data.brands.flatMap((b) => b.grades.map((g) => g.type)))]
  const typeByName = new Map()
  for (const t of needTypes) {
    const hits = types.filter((c) => same(c.name, t))
    if (hits.length === 1) {
      typeByName.set(t.toLowerCase(), hits[0])
      line(`  ok    finish type "${t}" found`)
    } else {
      blocked = true
      line(`  STOP  finish type "${t}": ${hits.length} found, need exactly 1`)
    }
  }
  const missingPics = []
  for (const b of data.brands)
    for (const m of b.materials) if (!onDisk(m.fileUrl)) missingPics.push(`${b.name}: ${m.fileUrl}`)
  if (missingPics.length) {
    line(`  ${ALLOW_MISSING ? 'warn ' : 'STOP '} ${missingPics.length} picture(s) not found under the pictures folder`)
    missingPics.slice(0, 5).forEach((p) => line(`          ${p}`))
    line('          (pull the repo first, or set TEXTURE_PUBLIC_DIR to the folder the site serves)')
    if (!ALLOW_MISSING) blocked = true
  } else {
    line('  ok    every picture is on disk')
  }

  // ── plan ────────────────────────────────────────────────────────────────
  title(VERIFY ? 'What is there' : 'Plan')
  const plan = []
  let totalNew = 0
  for (const b of data.brands) {
    const brand = allBrands.find((x) => same(x.name, b.name)) || null
    const myGrades = brand ? allCats.filter((c) => String(c.brandId) === String(brand._id)) : []
    const myMats = brand ? await F.find({ brandId: brand._id }).toArray() : []
    const gradeOf = (g) =>
      myGrades.find(
        (c) =>
          same(c.name, g.name) &&
          String(c.parentCategoryId) === String(typeByName.get(g.type.toLowerCase())?._id)
      )
    const newGrades = b.grades.filter((g) => !gradeOf(g))
    const matKey = (catId, m) => `${catId}::${m.decorCode || m.name}`
    const have = new Set(myMats.map((m) => matKey(m.categoryId, m)))
    let newMats = 0
    let oldMats = 0
    for (const m of b.materials) {
      const g = gradeOf(b.grades.find((x) => x.name === m.grade) || { name: m.grade, type: '' })
      if (g && have.has(matKey(g._id, m))) oldMats++
      else newMats++
    }
    totalNew += newGrades.length + newMats + (brand ? 0 : 1)
    line(
      `  ${b.name.padEnd(10)} brand ${brand ? 'exists' : 'CREATE'}   ` +
        `grades ${String(b.grades.length - newGrades.length).padStart(3)} there, ${String(newGrades.length).padStart(3)} to create   ` +
        `materials ${String(oldMats).padStart(4)} there, ${String(newMats).padStart(4)} to create`
    )
    plan.push({ b, brand })
  }

  if (VERIFY) {
    title('Verdict')
    line(totalNew === 0 && !missingPics.length
      ? '  Complete: every brand, grade and material in the data file is on this server, with its picture.'
      : `  NOT complete: ${totalNew} row(s) missing, ${missingPics.length} picture(s) missing.`)
    await client.close()
    return
  }
  if (blocked) {
    line('\nStopped by the checks above. Nothing was changed.')
    await client.close()
    process.exit(1)
  }
  if (!APPLY) {
    line(`\nDry run: nothing was changed. ${totalNew} row(s) would be created.`)
    line('To write:  npm run laminate-catalogue:apply')
    await client.close()
    return
  }

  // ── apply ───────────────────────────────────────────────────────────────
  title('Apply')
  const now = new Date().toISOString()
  const log = {
    at: now,
    database: mask(uri),
    createdBrandIds: [],
    createdGradeIds: [],
    createdMaterialIds: [],
    updatedMaterials: [],
    createdRateIds: []
  }
  fs.mkdirSync(BACKUP_ROOT, { recursive: true })
  const logFile = path.join(BACKUP_ROOT, `laminate-catalogue-${now.replace(/[:.]/g, '-')}.json`)
  const saveLog = () => fs.writeFileSync(logFile, JSON.stringify(log, null, 1), 'utf8')
  saveLog() // on disk BEFORE the first write, and rewritten as it goes

  const gradeIdByKey = new Map() // "brand::grade" → the grade row on this server
  for (const { b, brand: found } of plan) {
    let brand = found
    if (!brand) {
      brand = { _id: uuidv4(), name: b.name, createdAt: now, updatedAt: now }
      await B.insertOne(brand)
      log.createdBrandIds.push(brand._id)
    }
    const mine = await C.find({ brandId: brand._id }).toArray()
    for (const g of b.grades) {
      const type = typeByName.get(g.type.toLowerCase())
      let row = mine.find(
        (c) => same(c.name, g.name) && String(c.parentCategoryId) === String(type._id)
      )
      if (!row) {
        row = {
          _id: uuidv4(),
          name: g.name,
          parentCategoryId: type._id,
          brandId: brand._id,
          type: g.kind || 'wall',
          createdAt: now,
          updatedAt: now
        }
        await C.insertOne(row)
        log.createdGradeIds.push(row._id)
      }
      gradeIdByKey.set(`${b.name}::${g.name}`.toLowerCase(), row)
    }
    saveLog()

    const existing = await F.find({ brandId: brand._id }).toArray()
    const byKey = new Map(existing.map((m) => [`${m.categoryId}::${m.decorCode || m.name}`, m]))
    let made = 0
    let kept = 0
    for (const m of b.materials) {
      const grade = gradeIdByKey.get(`${b.name}::${m.grade}`.toLowerCase())
      if (!grade) continue
      const fields = {
        name: m.name,
        texture: { fileUrl: m.fileUrl },
        color: m.color || '',
        finishCodes: m.finishCodes || [],
        ...(m.tileCm > 0 ? { tileCm: m.tileCm } : {})
      }
      const old = byKey.get(`${grade._id}::${m.decorCode || m.name}`)
      if (old) {
        log.updatedMaterials.push({
          _id: old._id,
          before: {
            name: old.name,
            texture: old.texture,
            color: old.color,
            finishCodes: old.finishCodes,
            tileCm: old.tileCm
          }
        })
        await F.updateOne({ _id: old._id }, { $set: { ...fields, updatedAt: now } })
        kept++
      } else {
        const doc = {
          _id: uuidv4(),
          ...fields,
          categoryId: grade._id,
          brandId: brand._id,
          type: m.kind || 'wall',
          pricePerSqFt: 0,
          decorCode: m.decorCode || '',
          createdAt: now,
          updatedAt: now
        }
        await F.insertOne(doc)
        log.createdMaterialIds.push(doc._id)
        made++
      }
    }
    saveLog()
    line(`  ${b.name.padEnd(10)} materials created ${made}, already there ${kept}`)

    if (RATES) {
      const P = db.collection('finishing_pricing')
      let added = 0
      for (const r of (data.rates || []).filter((x) => same(x.brand, b.name))) {
        const grade = gradeIdByKey.get(`${r.brand}::${r.grade}`.toLowerCase())
        if (!grade || !(r.pricePerSqft > 0)) continue
        const has = await P.findOne({ finishingCategoryId: grade._id, finishingBrandId: brand._id })
        if (has) continue // a rate already on the server is never overwritten
        const res = await P.insertOne({
          finishingCategoryId: grade._id,
          finishingBrandId: brand._id,
          pricePerSqft: r.pricePerSqft,
          createdAt: now,
          updatedAt: now
        })
        log.createdRateIds.push(String(res.insertedId))
        added++
      }
      saveLog()
      line(`  ${''.padEnd(10)} rates added ${added}`)
    }
  }

  title('Done')
  line(`run log : ${logFile}`)
  line(`undo    : node scripts/production/laminate-catalogue-live.mjs --restore "${logFile}"`)
  line('now run : npm run laminate-catalogue:verify')
  if (!RATES) line('rates were NOT written. Enter them in the Rate Card, or re-run with --apply --rates.')
  await client.close()
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exit(1)
})
