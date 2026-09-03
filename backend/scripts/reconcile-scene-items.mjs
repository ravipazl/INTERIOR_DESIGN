// Repair furnished models that are IN a saved scene but marked inactive.
//
//   node scripts/reconcile-scene-items.mjs            # report only
//   node scripts/reconcile-scene-items.mjs --apply    # fix them
//
// THE STATE THIS FIXES
// --------------------
// A furnished_models row that appears in its floor plan's `scene.items` but has
// isActive:false is self-contradictory: it is part of the design, yet the BOQ
// (which prices only active models) leaves it out. The user sees the item in the
// Furnish tab and cannot find it in Production.
//
// It happened because adding an item created the database row without saving the
// scene. On the next load the app saw a row the scene did not reference, called
// it an orphan and deactivated it — and a later Save then wrote the scene WITH
// the item, leaving the two records disagreeing. (The cause is fixed in
// ProjectManager.createSceneElements, which now saves the scene at the moment
// the item is created. This script only cleans up rows stranded beforehand.)
//
// DELIBERATELY ONE-DIRECTIONAL
// ----------------------------
// Only `in scene + inactive -> active` is corrected. The opposite case —
// active but NOT in the scene — is a genuine orphan (an item removed from the
// room whose row lingered), and deactivating those is the app working correctly.
// Touching them could resurrect furniture the user deleted, so this leaves them
// exactly as they are.
import { MongoClient } from 'mongodb'

const url = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const DB = process.env.MONGO_DB || 'interior-design'
const APPLY = process.argv.includes('--apply')

const client = new MongoClient(url)
await client.connect()
const db = client.db(DB)

const floorplans = await db.collection('floorplans').find({}).toArray()
console.log(`${floorplans.length} floor plan(s) in ${DB}`)
console.log(APPLY ? 'mode: APPLY (rows will be updated)\n' : 'mode: report only — pass --apply to fix\n')

let repairable = 0
let repaired = 0
let genuineOrphans = 0

for (const fp of floorplans) {
  let scene = fp.scene
  if (typeof scene === 'string') {
    try {
      scene = JSON.parse(scene)
    } catch {
      console.warn(`  floor plan ${fp._id}: scene is not valid JSON — skipped`)
      continue
    }
  }
  const dbids = new Set((scene?.items || []).map((i) => i?.dbid).filter(Boolean))

  const models = await db
    .collection('furnished_models')
    .find({ floorPlanId: String(fp._id) })
    .toArray()
  if (!models.length) continue

  const stranded = models.filter((m) => dbids.has(String(m._id)) && m.isActive !== true)
  const orphans = models.filter((m) => !dbids.has(String(m._id)) && m.isActive === true)

  genuineOrphans += orphans.length
  if (!stranded.length) continue

  console.log(`floor plan ${fp._id}`)
  console.log(`  scene items: ${dbids.size} | furnished models: ${models.length}`)
  for (const m of stranded) {
    // Resolve the catalog name purely so the report is readable.
    const model = await db.collection('models').findOne({ _id: m.modelId })
    console.log(`    IN SCENE but inactive -> ${model?.name || '(unnamed)'}  [${m._id}]`)
    repairable++
    if (APPLY) {
      await db
        .collection('furnished_models')
        .updateOne({ _id: m._id }, { $set: { isActive: true } })
      repaired++
    }
  }
  console.log('')
}

console.log('='.repeat(60))
if (!repairable) {
  console.log('Nothing to repair — every model in a scene is already active.')
} else if (APPLY) {
  console.log(`Reactivated ${repaired} model(s). They will appear in the BOQ on the next generation.`)
} else {
  console.log(`${repairable} model(s) can be repaired. Re-run with --apply.`)
}
console.log(`Left untouched: ${genuineOrphans} active model(s) not in any scene (real orphans).`)

await client.close()
