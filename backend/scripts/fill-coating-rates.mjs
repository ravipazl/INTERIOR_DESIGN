// Add coating rates for a brand's grades that do not have one yet.
//
//   node scripts/fill-coating-rates.mjs --brand Royaltouch                 # list what is missing
//   node scripts/fill-coating-rates.mjs --brand Royaltouch --rate 250      # dry run at ₹250
//   node scripts/fill-coating-rates.mjs --brand Royaltouch --rate 250 --write
//   node scripts/fill-coating-rates.mjs --brand Royaltouch --rates rates.json --write
//   node scripts/fill-coating-rates.mjs --undo <backup.json>
//
// NOTHING IS WRITTEN WITHOUT --write, AND NO PRICE IS ASSUMED. A rate is a
// commercial decision; the script has no default and refuses to write without
// one being given.
//
// A RATE ALREADY ENTERED IS NEVER TOUCHED. A grade is skipped if any rate row
// exists for that brand and grade, whatever its price — including ones typed
// in by hand in the Rate Card. Only grades with no row at all are filled, so
// running this twice adds nothing the second time.
//
// --rates <file> takes { "GRADE NAME": price, ... } for grades priced
// differently; --rate is then the price for any grade the file does not name.
//
// New rows copy the shape of a row the Rate Card itself created (same fields,
// database-generated id), so they edit and delete from that screen like any
// other.

import './lib/env.mjs'
import { MongoClient, ObjectId } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const val = (f, d = null) => (args.indexOf(f) !== -1 ? args[args.indexOf(f) + 1] : d)
const WRITE = args.includes('--write')
const BRAND = val('--brand')
const RATE = val('--rate') !== null ? Number(val('--rate')) : null
const RATES_FILE = val('--rates')
const UNDO = val('--undo')
const mask = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@')

const main = async () => {
  const uri = process.env.MONGODB_URL || config.get('mongodb')
  console.log('database:', mask(uri))
  const client = await MongoClient.connect(uri)
  const db = client.db()
  const P = db.collection('finishing_pricing')

  if (UNDO) {
    const b = JSON.parse(fs.readFileSync(UNDO, 'utf8'))
    const r = await P.deleteMany({ _id: { $in: b.createdIds.map((i) => new ObjectId(i)) } })
    console.log(`Undone: ${r.deletedCount} rate(s) removed.`)
    await client.close()
    return
  }
  if (!BRAND) throw new Error('give --brand <name>')

  const brand = await db
    .collection('finishing_brands')
    .findOne({ name: new RegExp(`^${BRAND}$`, 'i') })
  if (!brand) throw new Error(`no brand named ${BRAND}`)

  const grades = await db
    .collection('finishing_categories')
    .find({ brandId: brand._id })
    .toArray()
  /**
   * COMPARED AS TEXT, NOT BY DATABASE EQUALITY.
   *
   * A brand made in the Rate Card's Manage lists has an ObjectId for its id,
   * but the Rate Card saves that id onto a rate row as a plain string. To the
   * database those are two different values, so asking it for "rates of this
   * brand" returned none — and this script's first dry run reported 0 of 104
   * priced when 41 had been typed in by hand. Written at that point it would
   * have given every one of them a duplicate.
   *
   * So every rate is read and matched here on the text of the id, which is the
   * same whichever way it happens to be stored.
   */
  const existing = (await P.find({}).toArray()).filter(
    (r) => String(r.finishingBrandId) === String(brand._id)
  )
  const priced = new Set(existing.map((r) => String(r.finishingCategoryId)))
  const missing = grades
    .filter((g) => !priced.has(String(g._id)))
    .sort((a, b) => a.name.localeCompare(b.name))

  console.log(`brand   : ${brand.name}`)
  console.log(`grades  : ${grades.length}`)
  console.log(`priced  : ${grades.length - missing.length}  (left exactly as they are)`)
  console.log(`missing : ${missing.length}`)
  if (existing[0]) console.log('row shape:', Object.keys(existing[0]).join(', '))

  const perGrade = RATES_FILE ? JSON.parse(fs.readFileSync(RATES_FILE, 'utf8')) : {}
  const priceFor = (g) => {
    const hit = Object.keys(perGrade).find((k) => k.trim().toLowerCase() === g.name.trim().toLowerCase())
    const p = hit !== undefined ? Number(perGrade[hit]) : RATE
    return p > 0 ? p : null
  }

  console.log('')
  const plan = []
  for (const g of missing) {
    const p = priceFor(g)
    plan.push({ g, p })
    console.log(`  ${g.name.padEnd(18)} ${p === null ? '— no price given' : '₹' + p}`)
  }
  const ready = plan.filter((x) => x.p !== null)
  const unpriced = plan.length - ready.length

  if (!missing.length) {
    console.log('Every grade already has a rate. Nothing to do.')
    await client.close()
    return
  }
  if (!ready.length) {
    console.log('\nNo price given. Add --rate <n> (and/or --rates <file>) to see the plan priced.')
    await client.close()
    return
  }
  if (!WRITE) {
    console.log(`\nDry run: ${ready.length} rate(s) would be added` +
      (unpriced ? `, ${unpriced} left without a price` : '') + '. Nothing written. Add --write.')
    await client.close()
    return
  }

  // Copy the fields of a row the Rate Card made, so nothing it expects is missing.
  const template = existing[0] || {}
  const now = new Date().toISOString()
  const stamp = (v) => (template.createdAt instanceof Date ? new Date(now) : typeof template.createdAt === 'number' ? Date.now() : now)
  const createdIds = []
  for (const { g, p } of ready) {
    // Ids as strings, exactly as the Rate Card writes them — a row carrying
    // an ObjectId here would be one the BOQ's lookup (which is handed strings
    // off the part) could never find.
    const doc = {
      finishingCategoryId: String(g._id),
      finishingBrandId: String(brand._id),
      pricePerSqft: p
    }
    if ('createdAt' in template) doc.createdAt = stamp()
    if ('updatedAt' in template) doc.updatedAt = stamp()
    const r = await P.insertOne(doc)
    createdIds.push(String(r.insertedId))
  }
  const file = path.join(HERE, `fill-coating-rates-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify({ at: now, brand: brand.name, createdIds }, null, 1), 'utf8')
  console.log(`\nAdded ${createdIds.length} rate(s).` + (unpriced ? ` ${unpriced} grade(s) still have no price.` : ''))
  console.log(`Undo with: node scripts/fill-coating-rates.mjs --undo "${file}"`)
  await client.close()
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
