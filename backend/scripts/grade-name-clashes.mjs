// READ ONLY. Grade names used by more than one brand. The Style dropdown
// identifies a grade by NAME, so a shared name is ambiguous there.
import { MongoClient } from 'mongodb'
import config from 'config'

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()
  const brands = await db.collection('finishing_brands').find({}).toArray()
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]))
  const cats = await db.collection('finishing_categories').find({}).toArray()

  const byName = new Map()
  for (const c of cats) {
    const k = String(c.name).trim().toLowerCase()
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(c)
  }
  const clashes = [...byName.entries()].filter(([, v]) => v.length > 1)
  console.log('grades total:', cats.length)
  console.log('names used more than once:', clashes.length)
  for (const [name, list] of clashes) {
    console.log(`\n  "${list[0].name}"`)
    for (const c of list) {
      console.log(
        `     ${c._id}  brand=${brandName.get(String(c.brandId)) || '(none)'}` +
          `  parent=${c.parentCategoryId || '(none)'}`
      )
    }
  }
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
