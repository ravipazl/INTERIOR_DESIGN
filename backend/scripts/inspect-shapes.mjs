// READ ONLY. The exact shape of an existing Merino grade and material, so a
// Greenlam import can be built to match rather than guessed at.
import { MongoClient } from 'mongodb'
import config from 'config'

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  const brands = await db.collection('finishing_brands').find({}).toArray()
  console.log('BRANDS:')
  brands.forEach((b) => console.log('  ', b._id, JSON.stringify(b.name)))

  const types = await db
    .collection('finishing_categories')
    .find({ parentCategoryId: { $in: [null, ''] } })
    .toArray()
  const topLevel = (await db.collection('finishing_categories').find({}).toArray())
    .filter((c) => !c.parentCategoryId)
  console.log('\nTOP-LEVEL TYPES (parentCategoryId empty):', topLevel.length)
  topLevel.forEach((c) => console.log('  ', c._id, JSON.stringify(c.name)))

  const merinoGrade = await db
    .collection('finishing_categories')
    .findOne({ name: /woodgrain/i })
  console.log('\nA MERINO GRADE ROW:')
  console.log(JSON.stringify(merinoGrade, null, 2))

  const merino = brands.find((b) => /merino/i.test(b.name))
  const mat = await db
    .collection('finishings')
    .findOne({ brandId: merino?._id, 'texture.fileUrl': { $exists: true } })
  console.log('\nA MERINO MATERIAL ROW:')
  console.log(JSON.stringify(mat, null, 2))

  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
