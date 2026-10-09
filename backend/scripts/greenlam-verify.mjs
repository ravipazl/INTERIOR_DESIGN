// READ ONLY. Checks the Greenlam data is actually usable in the designer,
// and reports the failures that the UI would not protect you from.
//
//   node scripts/greenlam-verify.mjs
//
// Each check corresponds to something a designer would otherwise discover by
// finding a blank swatch, a flat grey cabinet, or the wrong brand's wood in
// a quotation.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(HERE, '..', '..', 'frontend', 'public')
const BRAND = process.argv[2] || 'Greenlam'

const ok = (s) => console.log('  PASS  ' + s)
const bad = (s) => console.log('  FAIL  ' + s)
const note = (s) => console.log('        ' + s)

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()
  let failures = 0

  const brand = await db
    .collection('finishing_brands')
    .findOne({ name: new RegExp(`^${BRAND}$`, 'i') })
  if (!brand) {
    console.log(`No brand named ${BRAND}.`)
    await client.close()
    return
  }
  const cats = await db.collection('finishing_categories').find({}).toArray()
  const catById = new Map(cats.map((c) => [String(c._id), c]))
  const mats = await db
    .collection('finishings')
    .find({ brandId: brand._id })
    .toArray()
  const grades = cats.filter((c) => String(c.brandId) === String(brand._id))

  console.log(`${brand.name}: ${grades.length} grade(s), ${mats.length} material(s)\n`)

  // 1. Every grade hangs off a top-level type. Without a parent it never
  //    reaches the Style dropdown, however many materials it holds.
  const orphanGrades = grades.filter((g) => !g.parentCategoryId)
  if (orphanGrades.length) {
    failures++
    bad(`${orphanGrades.length} grade(s) have no parent type — they will never appear`)
    orphanGrades.forEach((g) => note(g.name))
  } else ok('every grade hangs off a type')

  // 2. Every material sits in a grade that belongs to the same brand.
  //    The swatch grid filters on category alone, so a material in another
  //    brand's grade shows up under that brand.
  const wrongGrade = mats.filter((m) => {
    const c = catById.get(String(m.categoryId))
    return !c || String(c.brandId) !== String(brand._id)
  })
  if (wrongGrade.length) {
    failures++
    bad(`${wrongGrade.length} material(s) sit in a grade not owned by ${brand.name}`)
    wrongGrade.slice(0, 10).forEach((m) =>
      note(`${m.name} -> ${catById.get(String(m.categoryId))?.name || '(missing grade)'}`)
    )
  } else ok(`every material is in one of ${brand.name}'s own grades`)

  // 3. No grade holds two brands — the mixing the grid cannot prevent.
  const allMats = await db.collection('finishings').find({}).toArray()
  const brandsPerCat = new Map()
  for (const m of allMats) {
    const k = String(m.categoryId)
    if (!brandsPerCat.has(k)) brandsPerCat.set(k, new Set())
    brandsPerCat.get(k).add(String(m.brandId || ''))
  }
  const mixed = [...brandsPerCat.entries()].filter(([, s]) => s.size > 1)
  if (mixed.length) {
    failures++
    bad(`${mixed.length} grade(s) hold more than one brand's materials`)
    mixed.slice(0, 10).forEach(([k, s]) =>
      note(`${catById.get(k)?.name || k}: ${s.size} brands`)
    )
  } else ok('no grade mixes two brands')

  // 4. Every picture actually exists on disk. A missing file is a blank
  //    swatch with no error anywhere.
  const missing = mats.filter((m) => {
    const u = m?.texture?.fileUrl
    return !u || !fs.existsSync(path.join(PUBLIC_DIR, String(u).replace(/^\//, '')))
  })
  if (missing.length) {
    failures++
    bad(`${missing.length} material(s) have no picture on disk`)
    missing.slice(0, 10).forEach((m) => note(`${m.name} ${m?.texture?.fileUrl || '(none)'}`))
  } else ok('every material has a picture on disk')

  // 5. A tile size, or the texture is stretched over the whole panel and
  //    reads as a flat colour.
  const noTile = mats.filter((m) => !(Number(m.tileCm) > 0))
  if (noTile.length) {
    bad(`${noTile.length} material(s) have no tileCm — these render stretched`)
  } else ok('every material has a tile size')

  // 6. Rates. Not needed for the style to appear, but without one the BOQ
  //    has no price for it.
  let rates = []
  try {
    rates = await db.collection('rates').find({}).toArray()
  } catch (e) {
    rates = []
  }
  const priced = new Set(
    rates.filter((r) => r.finishingCategoryId).map((r) => String(r.finishingCategoryId))
  )
  const unpriced = grades.filter((g) => !priced.has(String(g._id)))
  if (unpriced.length) {
    note(`${unpriced.length} grade(s) have no coating rate (BOQ will not price them):`)
    unpriced.forEach((g) => note('   ' + g.name))
  } else ok('every grade has a coating rate')

  console.log('\nPer grade:')
  for (const g of grades) {
    const n = mats.filter((m) => String(m.categoryId) === String(g._id)).length
    console.log(`  ${g.name.padEnd(16)} ${String(n).padStart(4)} materials` +
      (priced.has(String(g._id)) ? '' : '   (no rate)'))
  }

  console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll structural checks passed.')
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
