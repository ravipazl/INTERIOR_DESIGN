import { MongoClient, ObjectId } from 'mongodb'
const c = await MongoClient.connect('mongodb://127.0.0.1:27017/interior-design')
const db = c.db()
const projectId = '6ab0fc6e67e6b3806a0a4542'
const items = await db.collection('furnished_models')
  .find({ projectId, isActive: { $ne: false } }).toArray()
const out = []
for (const m of items) {
  const id = m.modelId
  const model =
    (await db.collection('models').findOne({ _id: id })) ||
    (typeof id === 'string' && ObjectId.isValid(id)
      ? await db.collection('models').findOne({ _id: new ObjectId(id) })
      : null)
  out.push({
    name: model?.name || String(id),
    dims: model?.dimensions || null,
    pos: (m.position || []).map((n) => Math.round(n)),
    rotY: Math.round((m.rotation || [0, 0, 0])[1]),
  })
}
out.sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0])
for (const o of out) {
  const d = o.dims ? `${o.dims[1]}w x ${o.dims[0]}h x ${o.dims[2]}d mm` : 'dims ?'
  console.log(`${String(o.name).slice(0, 38).padEnd(40)} ${d.padEnd(30)} pos ${o.pos.join(',').padEnd(16)} rotY ${o.rotY}`)
}
console.log(JSON.stringify(out))
await c.close()
