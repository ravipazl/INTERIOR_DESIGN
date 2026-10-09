// READ ONLY. For each brand, how many pictured materials it has and which
// grades (styles) they fall into — i.e. exactly what the Style dropdown will
// offer once it is filtered by brand.
//
//   node scripts/brand-style-matrix.mjs
//
// Also counts materials carrying no brand at all, because those are the ones
// that decide whether a brand's list comes out narrow or falls back to wide.

import { MongoClient } from 'mongodb'
import config from 'config'

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  const brands = await db.collection('finishing_brands').find({}).toArray()
  const cats = await db.collection('finishing_categories').find({}).toArray()
  const mats = await db.collection('finishings').find({}).toArray()

  const catById = new Map(cats.map((c) => [String(c._id), c]))
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]))

  const pictured = mats.filter((m) => m?.texture?.fileUrl)
  console.log('Materials total:', mats.length, ' with a picture:', pictured.length)

  const noBrand = pictured.filter((m) => !m.brandId)
  console.log('Pictured materials with NO brand:', noBrand.length)
  console.log('')

  const rows = []
  for (const b of brands) {
    const mine = pictured.filter((m) => String(m.brandId) === String(b._id))
    const grades = Array.from(
      new Set(mine.map((m) => catById.get(String(m.categoryId))?.name || '(unknown)'))
    ).sort()
    rows.push({
      brand: b.name,
      picturedMaterials: mine.length,
      styles: grades.length,
      styleNames: grades.join(', ').slice(0, 90),
    })
  }
  rows.sort((a, b) => b.picturedMaterials - a.picturedMaterials)
  console.table(rows)

  if (noBrand.length) {
    const grades = Array.from(
      new Set(noBrand.map((m) => catById.get(String(m.categoryId))?.name || '(unknown)'))
    ).sort()
    console.log('\nGrades reachable only through brandless materials:')
    console.log('  ' + grades.join(', '))
  }

  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
