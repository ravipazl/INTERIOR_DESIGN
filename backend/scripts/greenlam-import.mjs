// Put the Greenlam catalogue into the database: its styles, its materials,
// and their pictures.
//
//   node scripts/greenlam-import.mjs --from <dir>              # dry run
//   node scripts/greenlam-import.mjs --from <dir> --write
//   node scripts/greenlam-import.mjs --undo <backup.json>
//
// NOTHING IS WRITTEN WITHOUT --write. A real run saves a backup first and
// prints its path; --undo reverses exactly that run.
//
// <dir> is the extraction folder holding decors-styled.json and tiles/.
//
// WHAT IT TOUCHES, AND WHAT IT MUST NOT
//
// Only the Greenlam brand. Merino's 466 materials, the brandless originals,
// every other brand, every rate and every BOQ figure are left alone.
//
// Rows are keyed on {brandId, categoryId, decorCode}, so running it twice
// updates rather than duplicates. The Merino import had no such key and left
// 254 duplicates behind; this one cannot.
//
// A grade is created per style with parentCategoryId set to Laminates and
// brandId set to Greenlam, which is the shape Merino's grades already have.
// Both matter: without the parent the grade never appears in the Style list
// at all, and without the brand it would be offered under every brand.
//
// AND ONE GRADE MUST HOLD ONE BRAND. The swatch grid filters on category
// alone — it does not check the brand — so a grade shared between two brands
// would show them mixed together. Greenlam therefore gets its own grades
// rather than being added to Merino's.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(HERE, '..', '..', 'frontend', 'public')

const args = process.argv.slice(2)
const val = (f, d = null) =>
  args.indexOf(f) !== -1 ? args[args.indexOf(f) + 1] : d
// Each brand's pictures live in their own folder. Defaults to greenlam, the
// brand this was written for; --tiledir virgo reuses it for another.
const TILE_REL = `assets/rooms/textures/library/${val('--tiledir', 'greenlam')}`
const TILE_DIR = path.join(PUBLIC_DIR, TILE_REL)
const WRITE = args.includes('--write')
const FROM = val('--from')
const UNDO = val('--undo')
const BRAND_NAME = val('--brand', 'Greenlam')
const TYPE_NAME = val('--type', 'Laminates')
const TILE_CM = Number(val('--tilecm', '30'))

const die = (m) => {
  console.error('ERROR:', m)
  process.exit(1)
}

const undo = async (db, file) => {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'))
  let mats = 0
  let cats = 0
  if (b.createdMaterialIds?.length) {
    mats = (
      await db
        .collection('finishings')
        .deleteMany({ _id: { $in: b.createdMaterialIds } })
    ).deletedCount
  }
  // Materials that already existed were updated, not created: put the fields
  // this run changed back exactly as they were found.
  for (const m of b.updatedMaterials || []) {
    await db
      .collection('finishings')
      .updateOne({ _id: m._id }, { $set: m.before })
  }
  if (b.createdCategoryIds?.length) {
    cats = (
      await db
        .collection('finishing_categories')
        .deleteMany({ _id: { $in: b.createdCategoryIds } })
    ).deletedCount
  }
  console.log(
    `Undone: ${mats} material(s) deleted, ` +
      `${(b.updatedMaterials || []).length} restored, ${cats} grade(s) deleted.`
  )
  console.log('Tile files were left in place; they are harmless unreferenced.')
}

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  if (UNDO) {
    await undo(db, UNDO)
    await client.close()
    return
  }
  if (!FROM) die('give --from <extraction dir> (holding decors-styled.json)')

  const rowsPath = path.join(FROM, 'decors-styled.json')
  if (!fs.existsSync(rowsPath)) die(`not found: ${rowsPath}`)
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'))

  const brand = await db
    .collection('finishing_brands')
    .findOne({ name: new RegExp(`^${BRAND_NAME}$`, 'i') })
  if (!brand) die(`no brand named ${BRAND_NAME}`)

  const parent = await db
    .collection('finishing_categories')
    .findOne({ name: new RegExp(`^${TYPE_NAME}$`, 'i') })
  if (!parent) die(`no type named ${TYPE_NAME}`)
  if (parent.parentCategoryId) die(`${TYPE_NAME} is not a top-level type`)

  console.log(`brand : ${brand.name} (${brand._id})`)
  console.log(`type  : ${parent.name} (${parent._id})`)
  console.log(`rows  : ${rows.length}`)

  // Only rows that are usable: a style, a code, and a picture that exists.
  const usable = []
  const skipped = { noStyle: 0, noName: 0, noTile: 0 }
  for (const r of rows) {
    if (!r.style) {
      skipped.noStyle++
      continue
    }
    if (!r.name) {
      skipped.noName++
      continue
    }
    if (!r.tile || !fs.existsSync(path.join(FROM, 'tiles', r.tile))) {
      skipped.noTile++
      continue
    }
    usable.push(r)
  }
  console.log(
    `usable: ${usable.length}   skipped: ` +
      `${skipped.noStyle} without a style, ${skipped.noName} without a name, ` +
      `${skipped.noTile} without a picture`
  )

  const styles = [...new Set(usable.map((r) => r.style))].sort()
  const existingCats = await db
    .collection('finishing_categories')
    .find({ brandId: brand._id, parentCategoryId: parent._id })
    .toArray()
  const catByName = new Map(
    existingCats.map((c) => [String(c.name).toLowerCase(), c])
  )

  console.log('\nGRADES')
  const plannedCats = []
  for (const s of styles) {
    const found = catByName.get(s.toLowerCase())
    const n = usable.filter((r) => r.style === s).length
    console.log(`  ${found ? 'exists ' : 'CREATE '} ${s} (${n} materials)`)
    if (!found) plannedCats.push(s)
  }

  const existingMats = await db
    .collection('finishings')
    .find({ brandId: brand._id })
    .toArray()
  const matKey = (categoryId, code) => `${categoryId}::${code}`
  const matByKey = new Map(
    existingMats.map((m) => [matKey(m.categoryId, m.decorCode), m])
  )
  console.log(
    `\nMATERIALS: ${usable.length} in file, ${existingMats.length} already ` +
      `under ${brand.name}`
  )

  if (!WRITE) {
    console.log('\nDry run. Nothing written. Re-run with --write.')
    await client.close()
    return
  }

  fs.mkdirSync(TILE_DIR, { recursive: true })
  const backup = {
    at: new Date().toISOString(),
    brandId: brand._id,
    createdCategoryIds: [],
    createdMaterialIds: [],
    updatedMaterials: [],
  }

  const now = new Date().toISOString()
  for (const s of plannedCats) {
    const doc = {
      _id: uuidv4(),
      name: s,
      parentCategoryId: parent._id,
      brandId: brand._id,
      type: 'wall',
      createdAt: now,
      updatedAt: now,
    }
    await db.collection('finishing_categories').insertOne(doc)
    backup.createdCategoryIds.push(doc._id)
    catByName.set(s.toLowerCase(), doc)
  }

  let created = 0
  let updated = 0
  let copied = 0
  for (const r of usable) {
    const cat = catByName.get(r.style.toLowerCase())
    const dest = path.join(TILE_DIR, r.tile)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(FROM, 'tiles', r.tile), dest)
      copied++
    }
    const fileUrl = `/${TILE_REL}/${r.tile}`
    const existing = matByKey.get(matKey(cat._id, r.code))
    if (existing) {
      backup.updatedMaterials.push({
        _id: existing._id,
        before: {
          name: existing.name,
          texture: existing.texture,
          color: existing.color,
          finishCodes: existing.finishCodes,
          tileCm: existing.tileCm,
        },
      })
      await db.collection('finishings').updateOne(
        { _id: existing._id },
        {
          $set: {
            name: r.name,
            texture: { fileUrl },
            color: r.color || existing.color || '',
            // Every surface finish this décor is sold in, as Merino's rows
            // carry theirs. One material per décor, not one per finish.
            finishCodes: r.finishes?.length ? r.finishes : [r.finish],
            tileCm: TILE_CM,
            updatedAt: now,
          },
        }
      )
      updated++
    } else {
      const doc = {
        _id: uuidv4(),
        name: r.name,
        categoryId: cat._id,
        brandId: brand._id,
        type: 'wall',
        texture: { fileUrl },
        color: r.color || '',
        pricePerSqFt: 0,
        decorCode: r.code,
        finishCodes: r.finishes?.length ? r.finishes : [r.finish],
        tileCm: TILE_CM,
        createdAt: now,
        updatedAt: now,
      }
      await db.collection('finishings').insertOne(doc)
      backup.createdMaterialIds.push(doc._id)
      created++
    }
  }

  const file = path.join(HERE, `greenlam-import-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8')
  console.log(
    `\nGrades created: ${backup.createdCategoryIds.length}\n` +
      `Materials created: ${created}   updated: ${updated}\n` +
      `Tiles copied: ${copied} -> ${TILE_DIR}`
  )
  console.log(`\nBackup: ${file}`)
  console.log(`Undo with: node scripts/greenlam-import.mjs --undo "${file}"`)
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
