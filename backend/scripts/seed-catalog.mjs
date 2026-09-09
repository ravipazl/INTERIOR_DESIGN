// Seed the merged `interior-design` DB with the CATALOG collections from
// pazl-design-backend (models, categories, settings, finishings, pricing, ...).
//
//   node scripts/seed-catalog.mjs
//
// Why this exists alongside migrate-into-interior-design.mjs:
//
// The merged DB was created by the two apps running against it, NOT by the
// migration — which is why it only ever held the handful of projects/users made
// since the merge, and `models` / `categories` / `settings` were empty. An empty
// `models` collection is exactly why the Explore panel showed no items: the
// panel reads localStorage, which is filled from GET /models, which returned [].
// Empty `settings` is why GET /settings/installationRatePerSqft 404'd.
//
// This script copies ONLY the shared catalog. It deliberately does NOT bring
// over the old projects, project_items, floorplans or users — those are per-user
// working data, and importing 30 legacy projects would bury the real ones in the
// admin Projects list. Run migrate-into-interior-design.mjs if you do want them.
//
// NON-DESTRUCTIVE and idempotent: reads the source, upserts into the target by
// _id, so re-running is safe and the source DB is never modified.
import { MongoClient } from 'mongodb'

const url = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const SOURCE = 'pazl-design-backend'
const TARGET = 'interior-design'

// Everything the design app needs to render its catalog. Anything not named
// here (projects, project_items, floorplans, users) is user data, not catalog.
const CATALOG = [
  'models',
  'model_components',
  'furnished_models',
  'furnished_model_components',
  'categories',
  'settings',
  'finishings',
  'finishing_brands',
  'finishing_categories',
  'finishing_pricing',
  'core_material_types',
  'core_material_brands',
  'core_material_pricing',
  'floorplan-templates'
]

const c = new MongoClient(url)
await c.connect()
const sdb = c.db(SOURCE)
const tdb = c.db(TARGET)

// Batched so a 8k-document collection doesn't build one giant bulkWrite.
const BATCH = 500

for (const name of CATALOG) {
  const docs = await sdb.collection(name).find({}).toArray()
  if (!docs.length) {
    console.log(`  ${name.padEnd(30)} (source empty, skipped)`)
    continue
  }
  let written = 0
  for (let i = 0; i < docs.length; i += BATCH) {
    const ops = docs.slice(i, i + BATCH).map((d) => ({
      replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true }
    }))
    const res = await tdb.collection(name).bulkWrite(ops, { ordered: false })
    written += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0)
  }
  console.log(`  ${name.padEnd(30)} ${docs.length} docs -> ${written} written`)
}

console.log('\n=== interior-design now contains ===')
for (const col of (await tdb.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${col.name.padEnd(30)} ${await tdb.collection(col.name).countDocuments()}`)
}

await c.close()
console.log('\nDone. Hard-refresh the app (the model list is cached in localStorage).')
