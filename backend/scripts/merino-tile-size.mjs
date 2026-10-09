// Tell the 3D view how big one copy of a Merino picture is, in centimetres.
//
// WHY ONLY SOME MATERIALS GET THIS
//
// The viewer stretches one copy of a texture across a whole panel. That is
// right for a library tile, which is drawn at door scale. It is wrong for a
// picture lifted from a supplier's catalogue: that is a close photograph of a
// small piece of laminate, so one copy spread over a 60 x 200 cm door
// magnifies it until the grain flattens into a plain colour — a designer
// picks Tiger Crown Oak and gets a solid brown.
//
// So the photographs are told their real size and are tiled to it. Flat
// colours are not: a solid colour looks identical at any scale, and giving it
// a tile size would only add work for the renderer. Nothing outside Merino is
// touched at all, so every material that existed before looks exactly as it did.
//
//   node scripts/merino-tile-size.mjs --decors decors.json           # dry run
//   node scripts/merino-tile-size.mjs --decors decors.json --write
//   node scripts/merino-tile-size.mjs --decors decors.json --cm 35
//   node scripts/merino-tile-size.mjs --all-library --cm 60 --write
//   node scripts/merino-tile-size.mjs --clear --write                # undo
//
// --all-library does the same for the ORIGINAL library materials, which have
// the problem worse: measured against the catalogue photographs they carry
// about a quarter of the detail (local detail 4.7 against 18.6), so stretching
// one copy over a door leaves almost nothing to see. They are seamless, unlike
// the photographs, so tiling them shows no joins at all.
//
// It changes how finished cabinets look in EXISTING projects — from a flat
// wash to visible grain. That is a correction rather than a regression, but it
// is visible across live work, so it is deliberately a separate command.

import { MongoClient } from 'mongodb'
import config from 'config'
import fs from 'fs'

const args = process.argv.slice(2)
const val = (f, d = null) => (args.indexOf(f) !== -1 ? args[args.indexOf(f) + 1] : d)
const WRITE = args.includes('--write')
const CLEAR = args.includes('--clear')
const ALL_LIBRARY = args.includes('--all-library')
const DECORS = val('--decors')
// 35 cm: a laminate sample card is about that across, so one copy of the
// photograph covers roughly the area it was photographed from. Adjustable —
// smaller tiles the grain tighter, larger stretches it.
const CM = Number(val('--cm', 35))

const run = async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URL || config.get('mongodb'))
  const db = client.db()
  const brand = await db.collection('finishing_brands').findOne({ name: 'Merino' })
  if (!brand) {
    console.error('No Merino brand.')
    process.exit(1)
  }
  const F = db.collection('finishings')

  if (CLEAR) {
    // Clears everything this script ever set, Merino and library alike, so one
    // undo puts the whole catalogue back however it was reached.
    const n = await F.countDocuments({ tileCm: { $exists: true } })
    console.log(JSON.stringify({ mode: WRITE ? 'WRITE' : 'dry run', wouldClear: n }, null, 2))
    if (WRITE) await F.updateMany({ tileCm: { $exists: true } }, { $unset: { tileCm: '' } })
    await client.close()
    return
  }

  if (ALL_LIBRARY) {
    // The materials that came before supplier catalogues: no brand of their own.
    const library = await F.find({
      $or: [{ brandId: null }, { brandId: { $exists: false } }],
      'texture.fileUrl': { $nin: ['', null] }
    }).toArray()

    // A SOLID COLOUR IS SKIPPED, for the same reason the Merino colours were:
    // it looks identical at every scale, so tiling it changes nothing and only
    // gives the renderer more to do. Identified by its grade rather than by
    // inspecting the image — the catalogue already says which they are.
    const solidGrades = (
      await db.collection('finishing_categories').find({ name: /solid/i }).toArray()
    ).map((c) => String(c._id))
    const isSolid = (m) => solidGrades.includes(String(m.categoryId))

    const todo = library.filter((m) => !isSolid(m) && m.tileCm !== CM)
    const skipped = library.filter(isSolid)

    console.log(
      JSON.stringify(
        {
          mode: WRITE ? 'WRITE' : 'dry run (nothing written)',
          tileCm: CM,
          libraryMaterials: library.length,
          toTile: todo.length,
          solidColoursLeftAlone: skipped.length,
          sample: todo.slice(0, 5).map((m) => m.name)
        },
        null,
        2
      )
    )
    if (!WRITE) {
      console.log('\nNothing was written. Re-run with --write to apply.')
      await client.close()
      return
    }
    for (const m of todo) {
      // eslint-disable-next-line no-await-in-loop
      await F.updateOne({ _id: m._id }, { $set: { tileCm: CM, updatedAt: new Date().toISOString() } })
    }
    console.log(`\nTiled ${todo.length} library materials at ${CM} cm. Undo: --clear --write`)
    await client.close()
    return
  }

  if (!DECORS || !fs.existsSync(DECORS)) {
    console.error('Pass the extracted décors with --decors <file.json>')
    process.exit(1)
  }
  const payload = JSON.parse(fs.readFileSync(DECORS, 'utf8'))
  const decors = payload.decors || payload
  // A décor the catalogue gave an exact colour for is a flat colour, whatever
  // file it ended up with — those are the ones to leave alone.
  const isColour = new Set(decors.filter((d) => d.color).map((d) => String(d.code)))

  const all = await F.find({ brandId: String(brand._id) }).toArray()
  const photos = all.filter(
    (m) => m.texture?.fileUrl && !isColour.has(String(m.decorCode)) && m.tileCm !== CM
  )
  const colours = all.filter((m) => isColour.has(String(m.decorCode)))

  console.log(
    JSON.stringify(
      {
        mode: WRITE ? 'WRITE' : 'dry run (nothing written)',
        tileCm: CM,
        merinoMaterials: all.length,
        photographsToTile: photos.length,
        flatColoursLeftAlone: colours.length,
        sample: photos.slice(0, 5).map((m) => m.name)
      },
      null,
      2
    )
  )

  if (!WRITE) {
    console.log('\nNothing was written. Re-run with --write to apply.')
    await client.close()
    return
  }
  for (const m of photos) {
    // eslint-disable-next-line no-await-in-loop
    await F.updateOne({ _id: m._id }, { $set: { tileCm: CM, updatedAt: new Date().toISOString() } })
  }
  console.log(`\nTiled ${photos.length} photographs at ${CM} cm. Undo: --clear --write`)
  await client.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
