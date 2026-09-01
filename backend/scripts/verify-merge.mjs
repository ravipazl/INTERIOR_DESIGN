import { MongoClient } from 'mongodb'
const c = new MongoClient('mongodb://127.0.0.1:27017'); await c.connect()
const db = c.db('interior-design')
// find a project that has BOTH an AI-side field (status/clientName) and a design-side field
const p = await db.collection('projects').findOne({ status: { $exists: true }, $or: [ {installationCost:{$exists:true}}, {boqNumber:{$exists:true}}, {scene:{$exists:true}} ] })
if (p) {
  console.log('MERGED project _id:', p._id)
  console.log('  AI-side fields present:   ', ['name','status','clientName','architectUserId','ownerUserId','clientEmail'].filter(k=>p[k]!==undefined))
  console.log('  design-side fields present:', ['installationCost','boqNumber','revisedBoqNumber','scene','defaultUnits'].filter(k=>p[k]!==undefined))
} else {
  console.log('no clearly-merged project found; sampling one project keys:')
  const any = await db.collection('projects').findOne({})
  console.log(Object.keys(any||{}))
}
const u = await db.collection('users').findOne({ password: { $exists: true } })
console.log('\nusers have password (login works):', !!u, u? '| sample role: '+(u.permissions||'?'):'')
await c.close()
