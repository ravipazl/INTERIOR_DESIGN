// Write the laminate brand catalogues out of THIS machine's database into a
// data file that lives in the repo, so they can be loaded on another server.
//
//   node scripts/production/laminate-catalogue-export.mjs
//
// READ ONLY against the database. It writes one file:
//   scripts/production/data/laminate-catalogue.json
//
// WHY THIS EXISTS
//
// The Merino, Greenlam and Virgo catalogues were built on a development PC by
// reading the makers' PDFs. The rows went straight into the local database and
// nowhere else — so a `git push` carried the code and the pictures to the
// server and left the catalogue behind, with nothing for the new code to show.
// A database is not in git; this file is.
//
// EVERYTHING IS WRITTEN BY NAME, NEVER BY ID. Ids are made up fresh on each
// machine: the Laminates type, a brand, a grade all have different ids on the
// live server. A file full of this PC's ids would attach every material to
// nothing. The loader looks each name up on the server it is run on.
//
// Only brands that actually own materials are exported. A brand row with no
// catalogue behind it is not something this file should create elsewhere.

import '../lib/env.mjs'
import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(HERE, 'data')
const OUT = path.join(OUT_DIR, 'laminate-catalogue.json')
const mask = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@')

const main = async () => {
  const uri = process.env.MONGODB_URL || config.get('mongodb')
  console.log('reading from:', mask(uri))
  const client = await MongoClient.connect(uri)
  const db = client.db()

  const brands = await db.collection('finishing_brands').find({}).toArray()
  const cats = await db.collection('finishing_categories').find({}).toArray()
  const mats = await db.collection('finishings').find({}).toArray()
  const catById = new Map(cats.map((c) => [String(c._id), c]))
  const brandById = new Map(brands.map((b) => [String(b._id), b]))

  const owning = brands.filter((b) =>
    mats.some((m) => String(m.brandId) === String(b._id))
  )

  const out = { exportedAt: new Date().toISOString(), brands: [] }
  const problems = []

  for (const b of owning) {
    const grades = cats.filter((c) => String(c.brandId) === String(b._id))
    const mine = mats.filter((m) => String(m.brandId) === String(b._id))
    const entry = { name: b.name, grades: [], materials: [] }

    for (const g of grades) {
      const parent = catById.get(String(g.parentCategoryId))
      if (!parent) {
        problems.push(`grade "${g.name}" of ${b.name} has no parent type`)
        continue
      }
      entry.grades.push({ name: g.name, type: parent.name, kind: g.type || 'wall' })
    }

    for (const m of mine) {
      const g = catById.get(String(m.categoryId))
      if (!g || String(g.brandId) !== String(b._id)) {
        problems.push(`material "${m.name}" of ${b.name} is not in one of its own grades`)
        continue
      }
      if (!m?.texture?.fileUrl) {
        problems.push(`material "${m.name}" of ${b.name} has no picture`)
        continue
      }
      entry.materials.push({
        grade: g.name,
        name: m.name,
        decorCode: m.decorCode || '',
        finishCodes: m.finishCodes || [],
        color: m.color || '',
        fileUrl: m.texture.fileUrl,
        tileCm: Number(m.tileCm) || 0,
        kind: m.type || 'wall'
      })
    }
    entry.materials.sort(
      (a, c) => a.grade.localeCompare(c.grade) || a.name.localeCompare(c.name)
    )
    out.brands.push(entry)
  }

  // Coating rates for these brands' grades, by name. Optional on the other
  // side (--rates): prices are a commercial decision, and a server may
  // already carry its own.
  out.rates = []
  const pricing = await db.collection('finishing_pricing').find({}).toArray()
  for (const r of pricing) {
    const b = brandById.get(String(r.finishingBrandId))
    const g = catById.get(String(r.finishingCategoryId))
    if (!b || !g) continue
    if (!owning.some((o) => String(o._id) === String(b._id))) continue
    if (String(g.brandId) !== String(b._id)) continue
    out.rates.push({ brand: b.name, grade: g.name, pricePerSqft: Number(r.pricePerSqft) || 0 })
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8')

  for (const b of out.brands) {
    console.log(
      `  ${b.name.padEnd(10)} ${String(b.grades.length).padStart(3)} grades  ` +
        `${String(b.materials.length).padStart(4)} materials`
    )
  }
  console.log(`  rates: ${out.rates.length}`)
  if (problems.length) {
    console.log(`\n${problems.length} row(s) left out:`)
    problems.slice(0, 20).forEach((p) => console.log('  - ' + p))
  }
  console.log('\nwritten:', OUT)
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
