// A STARTING POINT for the "3D look" of each grade (gloss / metal), so the 3D
// view stops drawing every laminate as the same dull sheet.
//
// The values live on the grade and are edited in Rate Card → Manage lists →
// Coating → GRADES → "3D look". This only fills in the grades whose NAME says
// what the surface is ("HD Gloss", "Satin", "Metalam"…). A grade named by a
// maker's code that does not say (CF, SM, FLD…) is left alone for someone who
// knows the product to set — guessing it would be inventing a finish.
//
//   node scripts/grade-surface.mjs                 what it would set (changes nothing)
//   node scripts/grade-surface.mjs --write         set them, and write an undo log
//   node scripts/grade-surface.mjs --undo <log>    put back exactly what was there
//
// NEVER OVERWRITES. A grade that already has a 3D look — set here before, or
// by hand in Manage lists — is skipped, so it is safe to run again.
import { MongoClient, ObjectId } from 'mongodb'
import config from 'config'
import fs from 'fs'

// First match wins, so the specific names come before the general ones.
const RULES = [
  { test: /metal/i, surface: { gloss: 0.75, metal: 0.85 }, why: 'metallic' },
  { test: /glass|mirror/i, surface: { gloss: 0.95, metal: 0 }, why: 'glass / mirror' },
  {
    test: /high\s*gloss|hd\s*gloss|super\w*\s*gloss|\bHGL\b|\bSGL\b|\bSHG\b|acrylic/i,
    surface: { gloss: 0.9, metal: 0 },
    why: 'high gloss'
  },
  { test: /gloss/i, surface: { gloss: 0.7, metal: 0 }, why: 'gloss' },
  { test: /satin/i, surface: { gloss: 0.4, metal: 0 }, why: 'satin' }
]

const args = process.argv.slice(2)
const write = args.includes('--write')
const undoAt = args.indexOf('--undo')

const main = async () => {
  const client = await MongoClient.connect(config.get('mongodb'))
  const col = client.db().collection('finishing_categories')

  if (undoAt >= 0) {
    const file = args[undoAt + 1]
    if (!file) throw new Error('--undo needs the log file written by --write')
    const log = JSON.parse(fs.readFileSync(file, 'utf8'))
    let n = 0
    for (const row of log.changed) {
      // The log is JSON, so an ObjectId came back as text; rebuild it.
      row._id = row.oid ? new ObjectId(row._id) : row._id
      // Only where it is still what this script set: a value changed by hand
      // since then is someone's decision and is not rolled back.
      const now = await col.findOne({ _id: row._id })
      if (!now || JSON.stringify(now.surface) !== JSON.stringify(row.set)) continue
      if (row.before === undefined) await col.updateOne({ _id: row._id }, { $unset: { surface: '' } })
      else await col.updateOne({ _id: row._id }, { $set: { surface: row.before } })
      n++
    }
    console.log(`restored ${n} of ${log.changed.length} grades`)
    await client.close()
    return
  }

  const all = await col.find({}).toArray()
  const nameOf = Object.fromEntries(all.map((c) => [String(c._id), c.name]))
  const brands = Object.fromEntries(
    (await client.db().collection('finishing_brands').find({}).toArray()).map((b) => [String(b._id), b.name])
  )
  const grades = all.filter((c) => c.parentCategoryId)
  const changed = []
  let kept = 0
  let unknown = 0
  for (const g of grades) {
    const label = `${nameOf[String(g.parentCategoryId)] || '?'} · ${brands[String(g.brandId)] || '-'} · ${g.name}`
    if (g.surface && (g.surface.gloss || g.surface.metal)) {
      kept++
      console.log(`  keep   ${label}  (already gloss ${g.surface.gloss || 0}, metal ${g.surface.metal || 0})`)
      continue
    }
    const rule = RULES.find((r) => r.test.test(g.name))
    if (!rule) {
      unknown++
      continue
    }
    console.log(`  set    ${label}  → gloss ${rule.surface.gloss}, metal ${rule.surface.metal}  (${rule.why})`)
    // Some grades have a text id and some an ObjectId; `oid` records which, so
    // the undo can address the same document after a trip through JSON.
    changed.push({
      _id: g._id,
      oid: typeof g._id !== 'string',
      name: label,
      before: g.surface,
      set: rule.surface
    })
  }
  console.log(
    `\n${changed.length} to set, ${kept} already set, ${unknown} left for Manage lists (name does not say the surface)`
  )

  if (!write) {
    console.log('Nothing was changed. Add --write to set them.')
    await client.close()
    return
  }
  for (const row of changed) await col.updateOne({ _id: row._id }, { $set: { surface: row.set } })
  const file = `scripts/grade-surface-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({ changed }, null, 2))
  console.log(`set ${changed.length} grades. Undo with: node scripts/grade-surface.mjs --undo ${file}`)
  await client.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
