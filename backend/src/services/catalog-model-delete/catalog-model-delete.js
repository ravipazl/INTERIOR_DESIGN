// Catalog-model cascade delete.
//
// DELETE /catalog-model/:id
//
// Removes a user-created catalog model (Sketchfab import / Tripo "Generate" /
// manual upload). Designed to NOT orphan placed instances:
//   1. Refuses to delete a SEEDED factory-catalog model.
//   2. Counts how many `furnished_models` rows still reference this modelId.
//      If > 0, refuses with HTTP 409 + the count, so the UI can tell the
//      user which projects to clean up first.
//   3. Otherwise: removes the `models` row, removes all matching
//      `model_components` rows, and deletes the GLB file from
//      pazl-design-frontend/public/assets/models/glb/.
//
// Order matters: rows first, file last. If the file delete fails we don't
// roll back the rows — the DB is the source of truth and an orphaned GLB
// on disk is harmless (just storage waste).

import path from 'path'
import fs from 'fs'
import url from 'url'
import { ObjectId } from 'mongodb'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const GLB_STORAGE_DIR =
  process.env.GLB_STORAGE_DIR ||
  path.resolve(
    __dirname,
    '../../../../pazl-design-frontend/public/assets/models/glb'
  )

function isUserCreated(model) {
  if (!model) return false
  return !!(
    model.isUserUploaded ||
    model.isFromSketchfab ||
    model.isAiGenerated
  )
}

// modelFileUrl looks like "/assets/models/glb/<filename>.glb". Translate to
// the absolute path under GLB_STORAGE_DIR. Returns null if the value doesn't
// look like one of OUR GLB paths — we don't want to fs.unlink a stranger.
function resolveGlbAbsolutePath(modelFileUrl) {
  if (!modelFileUrl || typeof modelFileUrl !== 'string') return null
  const m = modelFileUrl.match(/^\/?(?:assets\/models\/glb\/)?([^/]+\.glb)$/i)
  if (!m) return null
  return path.join(GLB_STORAGE_DIR, m[1])
}

// Build the two candidate filters MongoDB might use to find rows: by string
// id (pazl's seeded convention) and by ObjectId (raw Mongo default). We try
// the string filter first since the rest of the codebase prefers that.
function findModelById(db, id) {
  const tryStr = db.collection('models').findOne({ _id: id })
  return tryStr.then((row) => {
    if (row) return row
    try {
      return db.collection('models').findOne({ _id: new ObjectId(id) })
    } catch (_) {
      return null
    }
  })
}

async function countFurnishedReferences(db, id) {
  // Match both modelId-as-string (the common case) and modelId-as-ObjectId
  // (legacy rows) so a wrongly-typed reference can't sneak past the guard.
  const collection = db.collection('furnished_models')
  let total = await collection.countDocuments({ modelId: id })
  try {
    total += await collection.countDocuments({ modelId: new ObjectId(id) })
  } catch (_) {
    /* id wasn't a valid ObjectId — skip */
  }
  return total
}

async function deleteComponentRows(db, id) {
  const collection = db.collection('model_components')
  let removed = 0
  const r1 = await collection.deleteMany({ modelId: id })
  removed += r1.deletedCount || 0
  try {
    const r2 = await collection.deleteMany({ modelId: new ObjectId(id) })
    removed += r2.deletedCount || 0
  } catch (_) {
    /* skip */
  }
  return removed
}

async function deleteModelRow(db, modelRow) {
  const collection = db.collection('models')
  // Use whichever shape the row's own _id has (string vs ObjectId) so we
  // hit it exactly without trying both queries.
  const r = await collection.deleteOne({ _id: modelRow._id })
  return r.deletedCount || 0
}

export const catalogModelDelete = (app) => {
  app.use(async (ctx, next) => {
    if (
      ctx.method !== 'DELETE' ||
      !ctx.path.startsWith('/catalog-model/')
    ) {
      return next()
    }

    const id = ctx.path.substring('/catalog-model/'.length)
    if (!id) {
      ctx.status = 400
      ctx.body = { error: 'missing_id', message: 'model id required' }
      return
    }

    const db = await app.get('mongodbClient')

    const model = await findModelById(db, id)
    if (!model) {
      ctx.status = 404
      ctx.body = { error: 'not_found', message: `No model ${id}` }
      return
    }

    if (!isUserCreated(model)) {
      ctx.status = 403
      ctx.body = {
        error: 'protected',
        message:
          'This model is part of the seeded factory catalog and cannot be deleted from the UI.'
      }
      return
    }

    const inUse = await countFurnishedReferences(db, id)
    if (inUse > 0) {
      ctx.status = 409
      ctx.body = {
        error: 'in_use',
        message: `Model is placed in ${inUse} furnished item(s). Remove those placements first, then try again.`,
        inUseCount: inUse
      }
      return
    }

    let componentsDeleted = 0
    let modelDeleted = 0
    let fileDeleted = false
    let fileError = null

    try {
      componentsDeleted = await deleteComponentRows(db, id)
      modelDeleted = await deleteModelRow(db, model)
    } catch (e) {
      ctx.status = 500
      ctx.body = {
        error: 'db_delete_failed',
        message: (e && e.message) || String(e)
      }
      return
    }

    const filePath = resolveGlbAbsolutePath(model.modelFileUrl)
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          fileDeleted = true
        }
      } catch (e) {
        // Non-fatal — DB is already clean. Just record the warning.
        fileError = (e && e.message) || String(e)
        console.warn(
          `[catalog-model-delete] GLB unlink failed for ${filePath}: ${fileError}`
        )
      }
    }

    console.log(
      `[catalog-model-delete] removed model ${id} (${model.name}) — model:${modelDeleted}, components:${componentsDeleted}, glb:${fileDeleted}`
    )

    ctx.status = 200
    ctx.body = {
      id,
      modelDeleted,
      componentsDeleted,
      fileDeleted,
      fileError
    }
  })
}
