// Create the Virgo brand and its grades, so they can be priced in the Rate
// Card. Materials and pictures are a separate, later step.
//
//   node scripts/virgo-grades.mjs --index <index.json>            # dry run
//   node scripts/virgo-grades.mjs --index <index.json> --write
//   node scripts/virgo-grades.mjs --undo <backup.json>
//
// NOTHING IS WRITTEN WITHOUT --write. A real run records every id it creates
// and --undo removes exactly those.
//
// A grade here is a SURFACE FINISH (SHG, SF, SMT ...). Virgo's catalogue has
// no named collections — its index lists only design, name, finish and page —
// and a laminate's price varies by finish, which is what a rate is entered
// against.
//
// Each grade is created under the Laminates type with brandId = Virgo, the
// shape Merino's and Greenlam's grades already have. Existing rows are found
// by {brandId, name} and left alone, so running it twice creates nothing new.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const val = (f, d = null) =>
  args.indexOf(f) !== -1 ? args[args.indexOf(f) + 1] : d
const WRITE = args.includes('--write')
const INDEX = val('--index')
const UNDO = val('--undo')
const BRAND_NAME = val('--brand', 'Virgo')
const TYPE_NAME = val('--type', 'Laminates')

const die = (m) => {
  console.error('ERROR:', m)
  process.exit(1)
}

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  if (UNDO) {
    const b = JSON.parse(fs.readFileSync(UNDO, 'utf8'))
    const cats = b.createdCategoryIds?.length
      ? (
          await db
            .collection('finishing_categories')
            .deleteMany({ _id: { $in: b.createdCategoryIds } })
        ).deletedCount
      : 0
    const brands = b.createdBrandId
      ? (
          await db
            .collection('finishing_brands')
            .deleteOne({ _id: b.createdBrandId })
        ).deletedCount
      : 0
    console.log(`Undone: ${cats} grade(s) and ${brands} brand deleted.`)
    await client.close()
    return
  }

  if (!INDEX) die('give --index <index.json>')
  const decors = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
  const counts = new Map()
  for (const d of decors)
    for (const f of d.finishes || []) counts.set(f, (counts.get(f) || 0) + 1)
  const finishes = [...counts.keys()].sort(
    (a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b)
  )

  const parent = await db
    .collection('finishing_categories')
    .findOne({ name: new RegExp(`^${TYPE_NAME}$`, 'i') })
  if (!parent || parent.parentCategoryId) die(`no top-level type ${TYPE_NAME}`)

  let brand = await db
    .collection('finishing_brands')
    .findOne({ name: new RegExp(`^${BRAND_NAME}$`, 'i') })
  const sample = await db.collection('finishing_brands').findOne({})
  console.log('existing brand row shape:', Object.keys(sample || {}).join(', '))
  console.log(`brand ${BRAND_NAME}: ${brand ? 'exists ' + brand._id : 'CREATE'}`)
  console.log(`type  ${parent.name} (${parent._id})`)

  const existing = brand
    ? await db
        .collection('finishing_categories')
        .find({ brandId: brand._id })
        .toArray()
    : []
  const have = new Set(existing.map((c) => String(c.name).toLowerCase()))
  const toCreate = finishes.filter((f) => !have.has(f.toLowerCase()))

  console.log(`\nGRADES (${finishes.length})`)
  for (const f of finishes)
    console.log(
      `  ${have.has(f.toLowerCase()) ? 'exists' : 'CREATE'}  ${f.padEnd(7)} ${counts.get(f)} décors`
    )

  if (!WRITE) {
    console.log('\nDry run. Nothing written. Re-run with --write.')
    await client.close()
    return
  }

  const now = new Date().toISOString()
  const backup = { at: now, createdBrandId: null, createdCategoryIds: [] }
  if (!brand) {
    brand = { _id: uuidv4(), name: BRAND_NAME, createdAt: now, updatedAt: now }
    await db.collection('finishing_brands').insertOne(brand)
    backup.createdBrandId = brand._id
  }
  for (const f of toCreate) {
    const doc = {
      _id: uuidv4(),
      name: f,
      parentCategoryId: parent._id,
      brandId: brand._id,
      type: 'wall',
      createdAt: now,
      updatedAt: now,
    }
    await db.collection('finishing_categories').insertOne(doc)
    backup.createdCategoryIds.push(doc._id)
  }
  const file = path.join(HERE, `virgo-grades-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8')
  console.log(
    `\nBrand ${backup.createdBrandId ? 'created' : 'already existed'}; ` +
      `${backup.createdCategoryIds.length} grade(s) created.`
  )
  console.log(`Undo with: node scripts/virgo-grades.mjs --undo "${file}"`)
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
