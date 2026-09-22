// Record the finish that is BAKED into the tall unit GLBs (see
// tall-units-bake-finish.mjs) so the Components panel and the BOQ show it:
//
//   Mesh_5 (shutter) → Wood 10002      Mesh_6 (handle) → Wood 10012
//
// 1. model_default_values — every NEW placement of these models gets the finish.
// 2. furnished_model_components — placed tall units get it on those two parts,
//    ONLY where the part has no finish yet (a finish someone chose is kept).
//
// The 3D view does not repaint these parts: the finish is already in the file.
//
//   node scripts/tall-units-record-finish.mjs --dry-run   show what would change
//   node scripts/tall-units-record-finish.mjs             apply (writes a backup)
//   node scripts/tall-units-record-finish.mjs --restore <backup.json>

import { BACKUP_ROOT } from './lib/env.mjs'
import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { CABINET_GROUPS, findCategory, modelsOf } from './lib/categories.mjs'

// Database and backup folder come from lib/env.mjs (the backend .env).
const BACKUP_DIR = BACKUP_ROOT

// The models: the ones tall-units-bake-finish.mjs baked on THIS machine (its list
// baked-parts.last-run.json), else every model of the tall-unit category
// ("Tall Units" / "Tall Unit" / TALL_UNITS_CATEGORY — see lib/categories.mjs).
// File names and category names differ between machines, so neither is
// hard-coded.
const BAKED_LIST = path.join(BACKUP_ROOT, CABINET_GROUPS.tall.backupFolder, 'baked-parts.last-run.json')

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

    let models
    let categoryName = CABINET_GROUPS.tall.label
    const baked = fs.existsSync(BAKED_LIST) ? Object.keys(JSON.parse(fs.readFileSync(BAKED_LIST, 'utf8'))) : []
    if (baked.length) {
      models = await db
        .collection('models')
        .find({ modelFileUrl: { $in: baked.map((g) => `/assets/models/glb/${g}`) } })
        .project({ name: 1 })
        .toArray()
    } else {
      const { cat, name } = await findCategory(db, 'tall')
      categoryName = name
      models = await modelsOf(db, cat, { name: 1 })
    }
    if (!models.length) console.log(`no tall unit models found (category "${categoryName}")`)
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
