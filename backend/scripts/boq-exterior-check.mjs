// READ ONLY. For one project, what exterior finish each part actually has
// stored, and whether the names behind those ids can be resolved.
//   node scripts/boq-exterior-check.mjs <projectId>
import { MongoClient } from 'mongodb'
import config from 'config'

const projectId = process.argv[2]
const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()
  const models = await db.collection('furnished_models').find({ projectId }).toArray()
  console.log('items in project:', models.length)
  for (const m of models) {
    const comps = await db
      .collection('furnished_model_components')
      .find({ furnishedModelId: m._id })
      .toArray()
    console.log(`\nitem ${m._id}  parts: ${comps.length}`)
    for (const c of comps) {
      const fin = c.externalFinishFinishingId
        ? await db.collection('finishings').findOne({ _id: c.externalFinishFinishingId })
        : null
      const style = fin
        ? await db.collection('finishing_categories').findOne({ _id: fin.categoryId })
        : null
      const brand = c.externalFinishBrandId
        ? await db.collection('finishing_brands').findOne({ _id: c.externalFinishBrandId })
        : null
      console.log(
        `  ${String(c.meshName || c.name).padEnd(9)} exposed=${String(!!c.exposed).padEnd(5)} ` +
          `finishId=${typeof c.externalFinishFinishingId}:${String(c.externalFinishFinishingId || '-').slice(0, 10)} ` +
          `finish=${fin ? fin.name : 'NOT FOUND'} | style=${style ? style.name : '-'} | ` +
          `brandId=${typeof c.externalFinishBrandId}:${String(c.externalFinishBrandId || '-').slice(0, 10)} ` +
          `brand=${brand ? brand.name : c.externalFinishBrandId ? 'NOT FOUND' : '-'}`
      )
    }
  }
  await client.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
