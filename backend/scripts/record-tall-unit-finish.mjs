// Record the finish that is BAKED into the tall unit GLBs (see
// bake-tall-unit-wood.mjs) so the Components panel and the BOQ show it:
//
//   Mesh_5 (shutter) → Wood 10002      Mesh_6 (handle) → Wood 10012
//
// 1. model_default_values — every NEW placement of these models gets the finish.
// 2. furnished_model_components — placed tall units get it on those two parts,
//    ONLY where the part has no finish yet (a finish someone chose is kept).
//
// The 3D view does not repaint these parts: the finish is already in the file.
//
//   node scripts/record-tall-unit-finish.mjs --dry-run   show what would change
//   node scripts/record-tall-unit-finish.mjs             apply (writes a backup)
//   node scripts/record-tall-unit-finish.mjs --restore <backup.json>

import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import config from 'config'
import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const BACKUP_DIR = path.resolve(__dirname, '../../backups')

const GLB_FILES = [
  'd785e120-6c7e-4634-a163-c93a88f87e7b_Tall_unit_Left_door_opening_handles_450_x_2080.glb',
  '25134b76-7a72-4aab-b900-a597fab04674_Tall_unit_Left_door_opening_handles_400_x_2080.glb',
  'c9b6076f-cd14-40b1-bed6-af35f48d2a8e_Tall_unit_Left_door_opening_handles_600_x_2080.glb',
  '3fabea4f-f22f-49f5-bd36-cd520c2e01f6_Tall_unit_Left_door_opening_handles_550_x_2080.glb',
  'f2a03977-9ecb-40e5-aeda-4ae26a595737_Tall_unit_Left_door_opening_handles_500_x_2080.glb',
  '540300b0-3686-4070-a114-c31dcca9328a_Tall_Unit_with_Right_Opening_Door_600_X_2080_Blender_.glb',
  '9562394c-0c6d-45d3-86a0-fbcf8337703a_Tall_Unit_with_Right_Opening_Door_550_X_2080_Blender_.glb',
  '15ec27ff-d12a-4b1b-9e47-b79b4db15f26_Tall_Unit_with_Right_Opening_Door_450_X_2080_Blender_.glb',
  '89274663-1187-4a51-acbd-cf2f57cd107a_Tall_Unit_with_Right_Opening_Door_400_X_2080_Blender_.glb',
  'dca56126-bc40-48d0-81d8-a2231946d70b_Tall_Unit_with_Right_Opening_Door_500_X_2080_Blender_.glb'
]

// Part → finish. `type: 'wall'` is the variant the cabinet finish picker uses.
// A default is keyed by the catalogue part's NAME, which is usually "Mesh_5" —
// but some models name their parts ("Shutter", "Handle"), so the name is looked
// up per model from its part at `index`.
const PARTS = [
  { index: 5, mesh: 'Mesh_5', finish: 'Wood 10002', fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg' },
  { index: 6, mesh: 'Mesh_6', finish: 'Wood 10012', fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg' }
]

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const restoreIdx = args.indexOf('--restore')

const mongoUrl = process.env.MONGODB_URL || config.get('mongodb')

async function restore(db, file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const id of backup.insertedDefaultIds) {
    await db.collection('model_default_values').deleteOne({ _id: id })
  }
  for (const row of backup.removedDefaults || []) {
    await db.collection('model_default_values').updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true })
  }
  for (const row of backup.components) {
    await db.collection('furnished_model_components').updateOne(
      { _id: row._id },
      { $set: { externalFinishFinishingId: row.externalFinishFinishingId, updatedAt: row.updatedAt } }
    )
  }
  console.log(
    `restored: removed ${backup.insertedDefaultIds.length} default(s), reverted ${backup.components.length} part row(s)`
  )
}

async function main() {
  const client = await MongoClient.connect(mongoUrl)
  const db = client.db()
  try {
    if (restoreIdx !== -1) {
      await restore(db, args[restoreIdx + 1])
      return
    }

    // Resolve the finishes and make sure they are the same images baked into the GLBs.
    for (const part of PARTS) {
      const f = await db.collection('finishings').findOne({ name: part.finish, type: 'wall' })
      if (!f) throw new Error(`finishing "${part.finish}" (wall) not found`)
      if (f.texture?.fileUrl !== part.fileUrl) {
        throw new Error(`"${part.finish}" texture is ${f.texture?.fileUrl}, expected ${part.fileUrl}`)
      }
      part.finishingId = String(f._id)
    }

    const models = await db
      .collection('models')
      .find({ modelFileUrl: { $in: GLB_FILES.map((g) => `/assets/models/glb/${g}`) } })
      .project({ name: 1 })
      .toArray()
    if (models.length !== GLB_FILES.length) {
      throw new Error(`expected ${GLB_FILES.length} models, found ${models.length}`)
    }
    const modelIds = models.map((m) => String(m._id))
    const now = new Date().toISOString()
    const backup = { createdAt: now, insertedDefaultIds: [], removedDefaults: [], components: [] }

    // 1. Model defaults (new placements).
    let defaultsAdded = 0
    let defaultsKept = 0
    let defaultsFixed = 0
    const skipped = []
    const partNameByModel = new Map() // modelId → { Mesh_5: 'Shutter', ... }
    for (const modelId of modelIds) {
      const catalogueParts = await db.collection('model_components').find({ modelId }).toArray()
      const names = {}
      for (const part of PARTS) {
        const cp = catalogueParts.find((c) => c.meshIndex === part.index)
        const name = cp?.name
        // A name shared by several parts ("carcass") would give ALL of them the finish.
        if (!name || catalogueParts.filter((c) => c.name === name).length !== 1) {
          skipped.push(`${modelId} ${part.mesh}: part name "${name}" is missing or not unique`)
          continue
        }
        names[part.mesh] = name
        // A default recorded earlier under "Mesh_N" for a model whose part is
        // named otherwise never matches — replace it with the real name.
        if (name !== part.mesh) {
          const stale = await db.collection('model_default_values').find({
            modelId,
            modelName: part.mesh,
            propertyName: 'externalFinishFinishingId',
            propertyValue: part.finishingId
          }).toArray()
          for (const row of stale) {
            if (!DRY) {
              backup.removedDefaults.push(row)
              await db.collection('model_default_values').deleteOne({ _id: row._id })
            }
            defaultsFixed++
          }
        }
        const existing = await db.collection('model_default_values').findOne({
          modelId,
          modelName: name,
          propertyName: 'externalFinishFinishingId'
        })
        if (existing) {
          defaultsKept++
          continue
        }
        const row = {
          _id: uuidv4(),
          modelId,
          modelName: name,
          propertyName: 'externalFinishFinishingId',
          propertyValue: part.finishingId,
          createdAt: now
        }
        if (!DRY) {
          await db.collection('model_default_values').insertOne(row)
          backup.insertedDefaultIds.push(row._id)
        }
        defaultsAdded++
      }
      partNameByModel.set(modelId, names)
    }

    // 2. Placed tall units — only parts with no finish yet.
    const placements = await db
      .collection('furnished_models')
      .find({ modelId: { $in: modelIds } })
      .project({ _id: 1, modelId: 1 })
      .toArray()
    let partsSet = 0
    let partsKept = 0
    for (const p of placements) {
      const comps = await db
        .collection('furnished_model_components')
        .find({ furnishedModelId: String(p._id) })
        .toArray()
      const names = partNameByModel.get(String(p.modelId)) || {}
      for (const part of PARTS) {
        const partName = names[part.mesh]
        const comp =
          comps.find((c) => c.meshName === part.mesh) ||
          comps.find((c) => !c.meshName && c.name === part.mesh) ||
          (partName && comps.filter((c) => c.name === partName).length === 1
            ? comps.find((c) => c.name === partName)
            : undefined)
        if (!comp) continue
        if (comp.externalFinishFinishingId) {
          partsKept++
          continue
        }
        if (!DRY) {
          backup.components.push({
            _id: comp._id,
            externalFinishFinishingId: comp.externalFinishFinishingId ?? '',
            updatedAt: comp.updatedAt ?? null
          })
          await db
            .collection('furnished_model_components')
            .updateOne(
              { _id: comp._id },
              { $set: { externalFinishFinishingId: part.finishingId, updatedAt: now } }
            )
        }
        partsSet++
      }
    }

    let backupFile = null
    if (!DRY) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
      backupFile = path.join(BACKUP_DIR, `tall-unit-finish-${now.replace(/[:.]/g, '-')}.json`)
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2))
    }

    console.log(
      JSON.stringify(
        {
          mode: DRY ? 'dry-run (nothing written)' : 'applied',
          finishes: PARTS.map((p) => `${p.mesh} → ${p.finish} (${p.finishingId})`),
          models: models.length,
          modelDefaults: { added: defaultsAdded, alreadySet: defaultsKept, renamedFromMeshN: defaultsFixed },
          skipped,
          placements: placements.length,
          placedParts: { finishRecorded: partsSet, keptExistingFinish: partsKept },
          backup: backupFile
        },
        null,
        2
      )
    )
  } finally {
    await client.close()
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
