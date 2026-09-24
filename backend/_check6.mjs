import { MongoClient, ObjectId } from 'mongodb'
const c = await MongoClient.connect('mongodb://127.0.0.1:27017/interior-design')
const db = c.db()
const projectId = '6ab0fc6e67e6b3806a0a4542'
const rows = await db.collection('furnished_models')
  .find({ projectId, isActive: { $ne: false } }).toArray()
const out = []
for (const m of rows) {
  const id = m.modelId
  const model =
    (await db.collection('models').findOne({ _id: id })) ||
    (typeof id === 'string' && ObjectId.isValid(id)
      ? await db.collection('models').findOne({ _id: new ObjectId(id) })
      : null)
  const dims = m.dimensions || model?.dimensions || [0, 0, 0]
  const turned = Math.round((m.rotation || [0, 0, 0])[1]) % 180 !== 0
  const w = (turned ? dims[2] : dims[1]) / 10
  const d = (turned ? dims[1] : dims[2]) / 10
  out.push({
    name: model?.name || String(id),
    level: m.position[1] > 130 ? 'wall' : 'floor',
    x0: m.position[0] - w / 2, x1: m.position[0] + w / 2,
    z0: m.position[2] - d / 2, z1: m.position[2] + d / 2,
    y: Math.round(m.position[1]),
    rotY: Math.round((m.rotation || [0, 0, 0])[1]),
    dims,
  })
}
const f = (n) => n.toFixed(0).padStart(5)
console.log('level  name                                  x range        z range      rotY')
for (const o of out.sort((a, b) => a.level.localeCompare(b.level) || a.x0 - b.x0)) {
  console.log(
    `${o.level.padEnd(6)} ${String(o.name).slice(0, 36).padEnd(38)}${f(o.x0)}..${f(o.x1)} ${f(o.z0)}..${f(o.z1)}   ${o.rotY}`
  )
}
console.log('\noverlaps (same level, footprints intersecting by more than 2 cm):')
let n = 0
for (let i = 0; i < out.length; i++)
  for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j]
    if (a.level !== b.level) continue
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
    const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)
    if (ox > 2 && oz > 2) {
      n++
      console.log(`  ${a.name.slice(0, 30)}  X  ${b.name.slice(0, 30)}   overlap ${ox.toFixed(0)} x ${oz.toFixed(0)} cm`)
    }
  }
console.log(n ? `\n${n} overlapping pairs` : '\nno overlaps')
console.log(JSON.stringify(out))
await c.close()
