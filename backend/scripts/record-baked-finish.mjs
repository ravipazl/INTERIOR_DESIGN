// Record the finish that a bake script put INTO the GLBs, so the Components
// panel and the BOQ show it (the 3D view does not repaint it — see
// Physical3DItem.isBakedFinish). Reads the manifest the bake wrote:
//   { "<glb file>": { modelId, name, shutters: [partNo…], handles: [partNo…] } }
//
//   node scripts/record-baked-finish.mjs --manifest <file> --dry-run
//   node scripts/record-baked-finish.mjs --manifest <file>
//   node scripts/record-baked-finish.mjs --restore <backup.json>
//
// 1. model_default_values: every NEW placement of the model gets the finish.
// 2. furnished_model_components: placed items get it on those parts, ONLY where
//    the part has no finish yet (a finish someone chose is kept).
// Every change is written to a backup file first.

import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import config from 'config'
import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const BACKUP_DIR = path.resolve(__dirname, '../../backups')

const FINISH = {
  shutters: { finish: 'Wood 10002', fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg' },
  handles: { finish: 'Wood 10012', fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg' }
}

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const argValue = (flag) => (args.indexOf(flag) !== -1 ? args[args.indexOf(flag) + 1] : null)

async function restore(db, file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const id of backup.insertedDefaultIds) {
    await db.collection('model_default_values').deleteOne({ _id: id })
  }
  for (const row of backup.components) {
    await db
      .collection('furnished_model_components')
      .updateOne(
        { _id: row._id },
        { $set: { externalFinishFinishingId: row.externalFinishFinishingId, updatedAt: row.updatedAt } }
      )
  }
  console.log(`restored: removed ${backup.insertedDefaultIds.length} default(s), reverted ${backup.components.length} part row(s)`)
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URL || config.get('mongodb'))
  const db = client.db()
  try {
    if (argValue('--restore')) {
      await restore(db, argValue('--restore'))
      return
    }
    const manifestFile = argValue('--manifest')
    if (!manifestFile) throw new Error('--manifest <file> is required')
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))

    // The finishes must be the very images baked into the files.
    for (const f of Object.values(FINISH)) {
      const row = await db.collection('finishings').findOne({ name: f.finish, type: 'wall' })
      if (!row) throw new Error(`finishing "${f.finish}" (wall) not found`)
      if (row.texture?.fileUrl !== f.fileUrl) throw new Error(`"${f.finish}" texture is ${row.texture?.fileUrl}`)
      f.finishingId = String(row._id)
    }

    const now = new Date().toISOString()
    const backup = { createdAt: now, manifest: manifestFile, insertedDefaultIds: [], components: [] }
    const totals = { models: 0, defaultsAdded: 0, defaultsAlreadySet: 0, placements: 0, partsRecorded: 0, partsKeptExistingFinish: 0 }
    const skipped = []

    for (const entry of Object.values(manifest)) {
      const { modelId } = entry
      totals.models++
      const catalogueParts = await db.collection('model_components').find({ modelId }).toArray()
      const placements = await db.collection('furnished_models').find({ modelId }).project({ _id: 1 }).toArray()
      totals.placements += placements.length
      const placedParts = new Map()
      for (const p of placements) {
        placedParts.set(
          String(p._id),
          await db.collection('furnished_model_components').find({ furnishedModelId: String(p._id) }).toArray()
        )
      }

      for (const kind of ['shutters', 'handles']) {
        const finishingId = FINISH[kind].finishingId
        for (const partNo of entry[kind] || []) {
          const mesh = `Mesh_${partNo}`
          const cp = catalogueParts.find((c) => c.meshIndex === partNo) || catalogueParts.find((c) => c.name === mesh)
          const name = cp?.name
          // A name shared by several parts would give ALL of them the finish.
          if (!name || catalogueParts.filter((c) => c.name === name).length !== 1) {
            skipped.push(`${entry.name} ${mesh}: part name "${name}" missing or not unique`)
            continue
          }
          // 1. Model default.
          const existing = await db
            .collection('model_default_values')
            .findOne({ modelId, modelName: name, propertyName: 'externalFinishFinishingId' })
          if (existing) {
            totals.defaultsAlreadySet++
          } else {
            const row = { _id: uuidv4(), modelId, modelName: name, propertyName: 'externalFinishFinishingId', propertyValue: finishingId, createdAt: now }
            if (!DRY) {
              await db.collection('model_default_values').insertOne(row)
              backup.insertedDefaultIds.push(row._id)
            }
            totals.defaultsAdded++
          }
          // 2. Placed items — only parts without a finish.
          for (const comps of placedParts.values()) {
            const comp =
              comps.find((c) => c.meshName === mesh) ||
              comps.find((c) => !c.meshName && c.name === mesh) ||
              (comps.filter((c) => c.name === name).length === 1 ? comps.find((c) => c.name === name) : undefined)
            if (!comp) continue
            if (comp.externalFinishFinishingId) {
              totals.partsKeptExistingFinish++
              continue
            }
            if (!DRY) {
              backup.components.push({ _id: comp._id, externalFinishFinishingId: comp.externalFinishFinishingId ?? '', updatedAt: comp.updatedAt ?? null })
              await db
                .collection('furnished_model_components')
                .updateOne({ _id: comp._id }, { $set: { externalFinishFinishingId: finishingId, updatedAt: now } })
            }
            totals.partsRecorded++
          }
        }
      }
    }

    let backupFile = null
    if (!DRY) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
      backupFile = path.join(BACKUP_DIR, `baked-finish-${now.replace(/[:.]/g, '-')}.json`)
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2))
    }
    console.log(JSON.stringify({ mode: DRY ? 'dry-run (nothing written)' : 'applied', ...totals, skipped, backup: backupFile }, null, 2))
  } finally {
    await client.close()
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
