import { MongoClient, ObjectId } from 'mongodb'
const c = await MongoClient.connect('mongodb://127.0.0.1:27017/interior-design')
const db = c.db()
const projectId = '6ab0fc6e67e6b3806a0a4542'
const fpDoc = await db.collection('floorplans').findOne({
  $or: [{ projectId }, { projectId: new ObjectId(projectId) }],
})
let scene = fpDoc.scene
if (typeof scene === 'string') scene = JSON.parse(scene)
const fp = scene.floorplan
// The saved plan stores corners in FEET; the engine works in cm.
const FT = 30.48
const walls = fp.walls.map((w) => {
  const a = fp.corners[w.corner1]
  const b = fp.corners[w.corner2]
  return { a: { x: a.x * FT, y: a.y * FT }, b: { x: b.x * FT, y: b.y * FT } }
})
console.log('walls (cm):')
walls.forEach((w, i) =>
  console.log(`  ${i}: (${Math.round(w.a.x)},${Math.round(w.a.y)}) → (${Math.round(w.b.x)},${Math.round(w.b.y)})  length ${Math.round(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))}`)
)
const distToWall = (p, w) => {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y
  const len2 = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / len2))
  return Math.hypot(p.x - (w.a.x + t * dx), p.y - (w.a.y + t * dy))
}
const items = (await db.collection('furnished_models').find({ projectId, isActive: { $ne: false } }).toArray())
  .filter((m) => Array.isArray(m.position))
console.log(`\n${items.length} active items — distance from the nearest wall:`)
let bad = 0
for (const m of items) {
  const model = await db.collection('models').findOne({ _id: m.modelId }, { projection: { name: 1, dimensions: 1 } })
  const p = { x: m.position[0], y: m.position[2] }
  let best = Infinity, bi = -1
  walls.forEach((w, i) => { const d = distToWall(p, w); if (d < best) { best = d; bi = i } })
  const depthCm = (model?.dimensions?.[2] || 0) / 10
  const expected = depthCm / 2
  const off = Math.abs(best - expected)
  if (off > 12) bad++
  console.log(
    `  ${String(model?.name || '?').slice(0, 30).padEnd(32)} pos ${Math.round(p.x)},${Math.round(p.y)}  wall ${bi}  gap ${best.toFixed(0)} cm (half-depth ${expected.toFixed(0)})  rotY ${Math.round((m.rotation || [0, 0, 0])[1])}${off > 12 ? '   << not flush' : ''}`
  )
}
console.log(`\nnot flush against a wall: ${bad} of ${items.length}`)
await c.close()
