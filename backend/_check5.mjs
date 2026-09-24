import { MongoClient, ObjectId } from 'mongodb'
const c = await MongoClient.connect('mongodb://127.0.0.1:27017/interior-design')
const db = c.db()
const projectId = '6ab0fc6e67e6b3806a0a4542'
const items = await db.collection('furnished_models')
  .find({ projectId, isActive: { $ne: false } }).limit(3).toArray()
console.log('--- three auto-placed records in full ---')
for (const m of items) console.log(JSON.stringify(m, null, 2))

// Compare with an item the user placed by hand (an older, inactive one is fine,
// but prefer any record on another project that was dragged in normally).
const hand = await db.collection('furnished_models')
  .find({ projectId: { $ne: projectId } }).sort({ _id: -1 }).limit(2).toArray()
console.log('\n--- two hand-placed records from another project, for comparison ---')
for (const m of hand) console.log(JSON.stringify(m, null, 2))
await c.close()
