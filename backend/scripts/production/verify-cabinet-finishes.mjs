// Does the LIVE server actually serve cabinets with the default wood on them?
//
// Reads nothing but the files the site serves and the catalogue that names
// them, and changes nothing at all. Run it after a deploy, or whenever someone
// reports a white cabinet:
//
//   node scripts/production/verify-cabinet-finishes.mjs
//   node scripts/production/verify-cabinet-finishes.mjs --category wall
//   node scripts/production/verify-cabinet-finishes.mjs --list-missing
//
// Exits 0 when every model carries the wood, 1 when any does not — so it can
// gate a deploy.
//
// Why this exists: the apply step bakes the models that are in the catalogue AT
// THAT MOMENT. Anything uploaded afterwards has no wood in its file and renders
// white, which looks exactly like "the deploy did not work". This says which of
// the two it is.

import './../lib/env.mjs'
import { GLB_DIR } from './../lib/env.mjs'
import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'
import path from 'path'
import { findCategory, modelsOf } from './../lib/categories.mjs'

const SHUTTER = 'Shutter - Wood 10002'
const HANDLE = 'Handle - Wood 10012'

const args = process.argv.slice(2)
const argValue = (flag) => (args.indexOf(flag) !== -1 ? args[args.indexOf(flag) + 1] : null)
const LIST_MISSING = args.includes('--list-missing')
const ONE = argValue('--category')
const GROUPS = ONE ? [ONE] : ['below', 'wall']

/**
 * The material names inside a .glb, read straight from its JSON chunk.
 *
 * Deliberately not via a glTF library: this has to run on a live server where
 * the point is to check what is being SERVED, with as little between us and the
 * bytes as possible. A .glb is a 12-byte header, then a 8-byte chunk header,
 * then the JSON.
 */
function materialsOf(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    fs.readSync(fd, head, 0, 20, 0)
    if (head.toString('utf8', 0, 4) !== 'glTF') return null
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    fs.readSync(fd, json, 0, jsonLength, 20)
    const doc = JSON.parse(json.toString('utf8'))
    return (doc.materials || []).map((m) => m.name || '')
  } catch (e) {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

const main = async () => {
  console.log(`3D model folder: ${GLB_DIR}`)
  if (!fs.existsSync(GLB_DIR)) {
    console.error('  NOT FOUND — set GLB_STORAGE_DIR in backend/.env to the folder the site serves')
    process.exit(1)
  }

  const client = await MongoClient.connect(process.env.MONGODB_URL || config.get('mongodb'))
  const totals = { ok: 0, missing: 0, noFile: 0, unreadable: 0 }
  const missing = []
  try {
    const db = client.db()
    for (const key of GROUPS) {
      const { cat, name } = await findCategory(db, key)
      const models = await modelsOf(db, cat, { name: 1, modelFileUrl: 1 })
      let ok = 0
      const bad = []
      for (const m of models) {
        const file = String(m.modelFileUrl || '').split('/').pop()
        const full = path.join(GLB_DIR, file)
        if (!file || !fs.existsSync(full)) {
          totals.noFile += 1
          bad.push({ name: m.name, why: 'file not on the server' })
          continue
        }
        const mats = materialsOf(full)
        if (!mats) {
          totals.unreadable += 1
          bad.push({ name: m.name, why: 'file could not be read as a .glb' })
          continue
        }
        // A model counts as finished when it carries the wood on its door; the
        // handle is absent on profile-handle models, where the handle is part
        // of the door itself, so it is reported but never required.
        const hasShutter = mats.includes(SHUTTER)
        if (hasShutter) {
          ok += 1
          totals.ok += 1
        } else {
          totals.missing += 1
          bad.push({ name: m.name, why: 'no wood in the file', handle: mats.includes(HANDLE) })
        }
      }
      console.log(`\n${name}: ${ok} of ${models.length} carry ${SHUTTER}`)
      if (bad.length) {
        console.log(`  ${bad.length} need attention`)
        for (const b of LIST_MISSING ? bad : bad.slice(0, 10)) {
          console.log(`    - ${b.name}  (${b.why})`)
        }
        if (!LIST_MISSING && bad.length > 10) {
          console.log(`    … and ${bad.length - 10} more (--list-missing shows them all)`)
        }
      }
      missing.push(...bad)
    }
  } finally {
    await client.close()
  }

  console.log(
    `\nfinished: ${totals.ok} | no wood: ${totals.missing} | file absent: ${totals.noFile} | unreadable: ${totals.unreadable}`
  )
  if (!missing.length) {
    console.log('Every cabinet the site serves carries the default wood.')
    process.exit(0)
  }
  console.log('\nTo apply the wood to the ones above, run:  npm run cabinet-finishes:apply')
  console.log('(a model that already has a finish of its own is left alone on purpose)')
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
