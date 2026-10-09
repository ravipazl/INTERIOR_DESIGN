// Put the Merino catalogue back together: its grades, its materials' links,
// and their pictures.
//
// WHY A RESTORE AND NOT AN IMPORT
//
// The 481 Merino materials are still in the database, correct in every
// respect — name, décor code, surface codes, brand. What was lost is the ten
// GRADES they belonged to and the picture FILES they pointed at. So this does
// not re-import anything: it recreates the grades, points each material back
// at the right one using its own décor code, and relinks the pictures.
//
// Re-importing instead would have produced 481 duplicates.
//
//   node scripts/merino-restore.mjs --decors decors.json            # dry run
//   node scripts/merino-restore.mjs --decors decors.json --write
//   node scripts/merino-restore.mjs --undo <backup.json>
//
// Nothing is written without --write. A real run records every id it creates
// and every link it changes, so --undo reverses exactly this run.
//
// It only ever touches materials whose brand is Merino. The 508 original
// materials, every other brand, every rate and every BOQ figure are untouched.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d = null) => (args.indexOf(f) !== -1 ? args[args.indexOf(f) + 1] : d)

const DECORS = val('--decors')
const BRAND_NAME = val('--brand', 'Merino')
const WRITE = has('--write')
const UNDO = val('--undo')
const TILE_DIR = val(
  '--tiles',
  path.join('..', 'frontend', 'public', 'assets', 'rooms', 'textures', 'library', 'merino')
)
const TILE_URL = val('--tile-url', '/assets/rooms/textures/library/merino')

const EXTS = ['png', 'jpg', 'jpeg', 'webp']

const undo = async (db, file) => {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'))
  let cats = 0
  if (b.categoryIds?.length) {
    cats = (await db.collection('finishing_categories').deleteMany({ _id: { $in: b.categoryIds } }))
      .deletedCount
  }
  // Put every material back exactly as it was found.
  let mats = 0
  for (const m of b.materials || []) {
    await db.collection('finishings').updateOne(
      { _id: m._id },
      { $set: { categoryId: m.categoryId, texture: m.texture } }
    )
    mats++
  }
  console.log(JSON.stringify({ undo: file, gradesRemoved: cats, materialsRestored: mats }, null, 2))
}

const run = async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URL || config.get('mongodb'))
  const db = client.db()

  if (UNDO) {
    await undo(db, UNDO)
    await client.close()
    return
  }
  if (!DECORS || !fs.existsSync(DECORS)) {
    console.error('Pass the extracted décors with --decors <file.json>')
    process.exit(1)
  }

  const brand = await db.collection('finishing_brands').findOne({ name: BRAND_NAME })
  if (!brand) {
    console.error(`No finishing brand named "${BRAND_NAME}".`)
    process.exit(1)
  }
  // The type the grades hang under. Never created here: inventing a second
  // "Laminates" would split the catalogue in two.
  const type = await db
    .collection('finishing_categories')
    .findOne({ name: /^laminates$/i, parentCategoryId: null })
  if (!type) {
    console.error('No top-level "Laminates" type to restore under.')
    process.exit(1)
  }

  const payload = JSON.parse(fs.readFileSync(DECORS, 'utf8'))
  const decors = payload.decors || payload
  const sectionOf = new Map(decors.map((d) => [String(d.code), d.section]))
  const sections = [...new Set(decors.map((d) => d.section))]

  // --- 1. the grades ---
  const existing = await db
    .collection('finishing_categories')
    .find({ brandId: String(brand._id) })
    .toArray()
  const byName = new Map(existing.map((c) => [c.name, c]))
  const now = new Date().toISOString()
  const newCats = []
  for (const name of sections) {
    if (byName.has(name)) continue
    const row = {
      _id: uuidv4(),
      name,
      parentCategoryId: String(type._id),
      brandId: String(brand._id),
      type: type.type || 'wall',
      createdAt: now,
      updatedAt: now
    }
    newCats.push(row)
    byName.set(name, row)
  }

  // --- 2. the materials: grade link + picture ---
  const materials = await db
    .collection('finishings')
    .find({ brandId: String(brand._id) })
    .toArray()

  const tileFor = (code) =>
    EXTS.map((e) => `${code}.${e}`).find((f) => fs.existsSync(path.join(TILE_DIR, f))) || null

  const changes = []
  let noSection = 0
  let noTile = 0
  for (const m of materials) {
    const code = String(m.decorCode || '')
    const section = sectionOf.get(code)
    if (!section) {
      // A material whose code is not in the catalogue file: left exactly as it
      // is rather than guessed into a grade.
      noSection++
      continue
    }
    const cat = byName.get(section)
    const file = tileFor(code)
    if (!file) noTile++
    const wantCat = String(cat._id)
    const wantTex = file ? { fileUrl: `${TILE_URL}/${file}` } : m.texture || { fileUrl: '' }
    const sameCat = String(m.categoryId) === wantCat
    const sameTex = (m.texture?.fileUrl || '') === (wantTex.fileUrl || '')
    if (sameCat && sameTex) continue
    changes.push({
      _id: m._id,
      name: m.name,
      from: { categoryId: m.categoryId, texture: m.texture || { fileUrl: '' } },
      to: { categoryId: wantCat, texture: wantTex }
    })
  }

  const perGrade = {}
  for (const s of sections) {
    const id = String(byName.get(s)._id)
    perGrade[s] = changes.filter((c) => c.to.categoryId === id).length
  }

  const report = {
    mode: WRITE ? 'WRITE' : 'dry run (nothing written)',
    brand: `${BRAND_NAME} (${brand._id})`,
    type: `${type.name} (${type._id})`,
    gradesToCreate: newCats.length,
    gradesAlreadyThere: sections.length - newCats.length,
    materialsFound: materials.length,
    materialsToRelink: changes.length,
    materialsWithNoCodeInFile: noSection,
    materialsWithNoPictureFile: noTile,
    perGrade
  }

  if (!WRITE) {
    console.log(JSON.stringify(report, null, 2))
    console.log('\nNothing was written. Re-run with --write to apply.')
    await client.close()
    return
  }

  const backup = path.join(
    'scripts',
    `merino-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  )
  fs.writeFileSync(
    backup,
    JSON.stringify(
      {
        at: now,
        categoryIds: newCats.map((c) => c._id),
        materials: changes.map((c) => ({ _id: c._id, ...c.from }))
      },
      null,
      1
    )
  )

  if (newCats.length) await db.collection('finishing_categories').insertMany(newCats)
  for (const c of changes) {
    // eslint-disable-next-line no-await-in-loop
    await db
      .collection('finishings')
      .updateOne({ _id: c._id }, { $set: { ...c.to, updatedAt: now } })
  }

  console.log(JSON.stringify({ ...report, backup }, null, 2))
  console.log(`\nTo reverse exactly this run: node scripts/merino-restore.mjs --undo ${backup}`)
  await client.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
