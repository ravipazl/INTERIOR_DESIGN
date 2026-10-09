// READ ONLY. Lists Merino materials that have no usable picture.
//
//   node scripts/merino-missing-images.mjs
//
// "No picture" is judged two ways, because either test alone would lie:
//   - no texture.fileUrl recorded on the material, or
//   - a fileUrl recorded but no file of that name on disk.
// A material can have one without the other, and both show the designer a
// blank swatch.
//
// Nothing is written, created or deleted.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Resolved from this file, not from the working directory, so the answer does
// not change depending on where it was run from.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(HERE, '..', '..', 'frontend', 'public')

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  const brands = await db
    .collection('finishing_brands')
    .find({ name: /merino/i })
    .toArray()
  if (!brands.length) {
    console.log('No brand named Merino found.')
    await client.close()
    return
  }
  console.log('Brand(s):', brands.map((b) => `${b.name} (${b._id})`).join(', '))
  console.log('Public dir:', PUBLIC_DIR)

  const mats = await db
    .collection('finishings')
    .find({ brandId: { $in: brands.map((b) => b._id) } })
    .toArray()

  const cats = await db.collection('finishing_categories').find({}).toArray()
  const catName = new Map(cats.map((c) => [String(c._id), c.name]))

  const onDisk = (url) =>
    !!url && fs.existsSync(path.join(PUBLIC_DIR, String(url).replace(/^\//, '')))

  const missing = []
  for (const m of mats) {
    const url = m?.texture?.fileUrl || ''
    if (!url) missing.push({ m, why: 'no image recorded' })
    else if (!onDisk(url)) missing.push({ m, why: `file missing on disk (${url})` })
  }

  console.log('')
  console.log('Merino materials total :', mats.length)
  console.log('With a usable picture  :', mats.length - missing.length)
  console.log('MISSING a picture      :', missing.length)
  console.log('')

  missing.sort(
    (a, b) =>
      String(a.m.name || '').localeCompare(String(b.m.name || '')) ||
      String(a.m.decorCode || '').localeCompare(String(b.m.decorCode || ''))
  )
  const rows = missing.map(({ m, why }) => ({
    name: m.name || '',
    decorCode: m.decorCode || '',
    grade: catName.get(String(m.categoryId)) || '(no grade)',
    reason: why,
  }))
  if (rows.length) console.table(rows)

  const out = path.join(HERE, 'merino-missing-images.json')
  fs.writeFileSync(out, JSON.stringify(rows, null, 2), 'utf8')
  console.log('\nList saved to', out)
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
