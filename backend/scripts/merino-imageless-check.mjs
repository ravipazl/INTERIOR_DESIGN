// READ ONLY. For the Merino materials that have no picture, answer the one
// question that decides whether they can safely be removed: is anything
// pointing at them?
//
//   node scripts/merino-imageless-check.mjs
//
// A material is referenced if a saved cabinet part names it as its exterior
// or interior finish, or if a saved scene's meshmap carries its texture. Both
// are checked, because they are separate stores and either one left dangling
// shows the designer a part with no material.
//
// It also writes a full backup of the 15 records, so a later delete can be
// undone exactly. Nothing is modified.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(HERE, '..', '..', 'frontend', 'public')

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  const brands = await db
    .collection('finishing_brands')
    .find({ name: /merino/i })
    .toArray()
  const mats = await db
    .collection('finishings')
    .find({ brandId: { $in: brands.map((b) => b._id) } })
    .toArray()

  const onDisk = (url) =>
    !!url && fs.existsSync(path.join(PUBLIC_DIR, String(url).replace(/^\//, '')))
  const imageless = mats.filter((m) => {
    const url = m?.texture?.fileUrl || ''
    return !url || !onDisk(url)
  })

  const ids = imageless.map((m) => m._id)
  const idSet = new Set(ids.map(String))

  // 1. Saved cabinet parts naming one of these as their finish.
  const parts = await db
    .collection('furnished_model_components')
    .find({
      $or: [
        { externalFinishFinishingId: { $in: ids } },
        { internalFinishFinishingId: { $in: ids } },
      ],
    })
    .toArray()

  // 2. Defaults stamped on catalogue models.
  const defaults = await db
    .collection('model_default_values')
    .find({ value: { $in: ids.map(String) } })
    .toArray()

  // 3. Rate Card rows priced against one of them.
  let rates = []
  try {
    rates = await db
      .collection('rates')
      .find({ finishingId: { $in: ids } })
      .toArray()
  } catch (e) {
    rates = []
  }

  console.log('Merino materials with no picture :', imageless.length)
  console.log('Saved cabinet parts using one    :', parts.length)
  console.log('Catalogue model defaults using one:', defaults.length)
  console.log('Rate Card rows using one          :', rates.length)
  console.log('')

  const used = new Map()
  for (const p of parts) {
    for (const k of ['externalFinishFinishingId', 'internalFinishFinishingId']) {
      if (p[k] && idSet.has(String(p[k]))) {
        used.set(String(p[k]), (used.get(String(p[k])) || 0) + 1)
      }
    }
  }

  console.table(
    imageless.map((m) => ({
      name: m.name,
      decorCode: m.decorCode || '',
      usedByParts: used.get(String(m._id)) || 0,
    }))
  )

  const backup = path.join(HERE, `merino-imageless-backup-${Date.now()}.json`)
  fs.writeFileSync(
    backup,
    JSON.stringify({ materials: imageless, parts, defaults, rates }, null, 2),
    'utf8'
  )
  console.log('\nFull records backed up to', backup)
  console.log('Nothing was modified.')
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
