// One-time migration: copy the three legacy databases into the merged
// `interior-design` database. NON-DESTRUCTIVE — it only READS the source DBs
// and WRITES to the target, so the existing apps are unaffected. Idempotent:
// re-running upserts by _id.
//
//   node scripts/migrate-into-interior-design.mjs
import { MongoClient } from 'mongodb'

const url = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const TARGET = 'interior-design'
const SOURCES = ['pazl-ai-backend', 'pazl-auth-backend', 'pazl-design-backend']
const SPECIAL = new Set(['users', 'projects']) // handled explicitly below

const c = new MongoClient(url)
await c.connect()
const tdb = c.db(TARGET)

const upsertAll = async (docs, colName) => {
  if (!docs.length) return 0
  const ops = docs.map((d) => ({
    replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true }
  }))
  const res = await tdb.collection(colName).bulkWrite(ops, { ordered: false })
  return (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.insertedCount || 0)
}

// 1) Straight copy of every non-special collection from every source DB.
console.log('--- copying non-special collections ---')
for (const s of SOURCES) {
  const sdb = c.db(s)
  const cols = await sdb.listCollections().toArray()
  for (const col of cols) {
    if (SPECIAL.has(col.name)) continue
    const docs = await sdb.collection(col.name).find({}).toArray()
    const n = await upsertAll(docs, col.name)
    if (docs.length) console.log(`  ${s} . ${col.name} -> ${docs.length} docs`)
  }
}

// 2) users — the auth DB is the real login store (ai's is empty).
console.log('--- users ---')
for (const s of ['pazl-auth-backend', 'pazl-ai-backend']) {
  const docs = await c.db(s).collection('users').find({}).toArray()
  if (docs.length) {
    await upsertAll(docs, 'users')
    console.log(`  ${s} . users -> ${docs.length}`)
  }
}

// 3) projects — merge the two-DB split. Design first (has scene/BOQ), then
// overlay AI's non-empty shared fields (AI is source of truth for name/status/
// client/architect — same rule as the old sync script).
console.log('--- projects (merge) ---')
const designProjects = await c.db('pazl-design-backend').collection('projects').find({}).toArray()
await upsertAll(designProjects, 'projects')
const aiProjects = await c.db('pazl-ai-backend').collection('projects').find({}).toArray()
let merged = 0
let inserted = 0
for (const ai of aiProjects) {
  const existing = await tdb.collection('projects').findOne({ _id: ai._id })
  if (existing) {
    const patch = {}
    for (const [k, v] of Object.entries(ai)) {
      if (k === '_id') continue
      if (v === null || v === undefined || v === '') continue
      patch[k] = v // AI wins on shared fields
    }
    await tdb.collection('projects').updateOne({ _id: ai._id }, { $set: patch })
    merged++
  } else {
    await tdb.collection('projects').replaceOne({ _id: ai._id }, ai, { upsert: true })
    inserted++
  }
}
console.log(`  design projects: ${designProjects.length} | ai merged: ${merged} | ai new: ${inserted}`)

// Summary of the target DB.
console.log('\n=== interior-design now contains ===')
const tcols = await tdb.listCollections().toArray()
for (const col of tcols.sort((a, b) => a.name.localeCompare(b.name))) {
  const n = await tdb.collection(col.name).countDocuments()
  console.log(`  ${col.name.padEnd(30)} ${n}`)
}
await c.close()
console.log('\nDone.')
