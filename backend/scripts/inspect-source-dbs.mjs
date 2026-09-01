import { MongoClient } from 'mongodb'
const url = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const dbs = ['pazl-ai-backend', 'pazl-auth-backend', 'pazl-design-backend']
const c = new MongoClient(url)
await c.connect()
const seen = {}
for (const d of dbs) {
  const db = c.db(d)
  const cols = await db.listCollections().toArray()
  console.log(`\n=== ${d} ===`)
  for (const col of cols.sort((a, b) => a.name.localeCompare(b.name))) {
    const n = await db.collection(col.name).countDocuments()
    console.log(`  ${col.name.padEnd(30)} ${n}`)
    seen[col.name] = seen[col.name] || []
    seen[col.name].push(`${d}:${n}`)
  }
}
console.log('\n=== collections in MORE THAN ONE db (need merge) ===')
for (const [k, v] of Object.entries(seen)) {
  if (v.length > 1) console.log(`  ${k.padEnd(24)} -> ${v.join('  |  ')}`)
}
await c.close()
