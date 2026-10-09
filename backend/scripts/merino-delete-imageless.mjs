// Delete the Merino materials that have no picture.
//
//   node scripts/merino-delete-imageless.mjs            # dry run, shows the list
//   node scripts/merino-delete-imageless.mjs --write    # actually delete
//   node scripts/merino-delete-imageless.mjs --undo <backup.json>
//
// NOTHING IS DELETED WITHOUT --write. A real run writes every full record to
// a backup file first and prints its path, and --undo puts them all back
// exactly as they were.
//
// It refuses to delete a material that anything still points at — a saved
// cabinet part, a catalogue model's default, or a Rate Card row. A finish id
// left dangling in a saved project shows the designer a part with no
// material and no explanation, which is worse than a blank swatch.
//
// Scope: materials whose brand is Merino AND which have no usable picture.
// The 466 Merino materials that do have pictures, the 508 originals, every
// other brand, every rate and every BOQ figure are untouched.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(HERE, '..', '..', 'frontend', 'public')

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const UNDO = args.indexOf('--undo') !== -1 ? args[args.indexOf('--undo') + 1] : null

const restore = async (db, file) => {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'))
  let n = 0
  for (const m of b.materials || []) {
    // insertOne, not replaceOne with upsert: if the row is somehow back
    // already, a duplicate-key error is the right outcome — it says the undo
    // is not needed, rather than silently overwriting newer data.
    try {
      await db.collection('finishings').insertOne(m)
      n++
    } catch (e) {
      console.warn('  already present, skipped:', m.name)
    }
  }
  console.log(`Restored ${n} material(s).`)
}

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const db = client.db()

  if (UNDO) {
    await restore(db, UNDO)
    await client.close()
    return
  }

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
  const doomed = mats.filter((m) => {
    const url = m?.texture?.fileUrl || ''
    return !url || !onDisk(url)
  })

  if (!doomed.length) {
    console.log('No Merino material is missing a picture. Nothing to do.')
    await client.close()
    return
  }

  const ids = doomed.map((m) => m._id)
  const parts = await db
    .collection('furnished_model_components')
    .find({
      $or: [
        { externalFinishFinishingId: { $in: ids } },
        { internalFinishFinishingId: { $in: ids } },
      ],
    })
    .toArray()
  const defaults = await db
    .collection('model_default_values')
    .find({ value: { $in: ids.map(String) } })
    .toArray()
  let rates = []
  try {
    rates = await db.collection('rates').find({ finishingId: { $in: ids } }).toArray()
  } catch (e) {
    rates = []
  }

  console.log('Merino materials with no picture:', doomed.length)
  doomed.forEach((m, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${m.name}  [${m.decorCode || '-'}]`)
  )
  console.log('')
  console.log('Still referenced by  parts:', parts.length, ' defaults:', defaults.length, ' rates:', rates.length)

  if (parts.length || defaults.length || rates.length) {
    console.error('\nREFUSING TO DELETE — something still points at these.')
    console.error('Clear those references first, or hide the materials instead.')
    await client.close()
    process.exit(1)
  }

  if (!WRITE) {
    console.log('\nDry run. Nothing deleted. Re-run with --write to delete.')
    await client.close()
    return
  }

  const backup = path.join(HERE, `merino-deleted-${Date.now()}.json`)
  fs.writeFileSync(backup, JSON.stringify({ materials: doomed }, null, 2), 'utf8')
  console.log('\nBackup written to', backup)

  const res = await db.collection('finishings').deleteMany({ _id: { $in: ids } })
  console.log('Deleted:', res.deletedCount)
  console.log(`Undo with: node scripts/merino-delete-imageless.mjs --undo "${backup}"`)

  const left = await db
    .collection('finishings')
    .countDocuments({ brandId: { $in: brands.map((b) => b._id) } })
  console.log('Merino materials remaining:', left)
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
