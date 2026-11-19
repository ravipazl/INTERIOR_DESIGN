// Copy project — Projects list → Actions → "Copy project".
//
//   POST /projects/:id/copy   { name }   → the new project
//
// Makes an exact working copy of a project's design under a new name:
//
//   copied       the project's details (client, address, owner, units,
//                installation cost), its floor plan scene — walls, rooms and
//                every wall / floor / ceiling finish and area — and every
//                furniture item with all its parts and finishes.
//   starts fresh status (open), architect, quotes and BOQ numbers, the bell /
//                tracker / notification times, renders, documents, change
//                requests and uploaded files.
//
// Everything gets a NEW id, and the copies point at each other's new ids, so
// editing the copy never touches the original.
//
// Who: an admin on any project; an architect only on a project assigned to
// them (they stay the architect of the copy, so it shows in their list).
//
// Written straight to the database rather than through the services, so none
// of the create / patch side effects run (emails, WhatsApp, tracker events) —
// a copy is quiet.

import crypto from 'crypto'
import { ObjectId } from 'mongodb'

const ADMIN = ['admin', 'super_admin']
const ARCHITECT = 'architect'
const MAX_NAME = 120
const BATCH = 500
const PATH_RE = /^\/projects\/([^/]+)\/copy\/?$/

// The project details that carry over. Everything else starts fresh.
const COPIED_FIELDS = [
  'ownerUserId',
  'address',
  'clientName',
  'clientGSTNumber',
  'clientEmail',
  'clientPhoneNumber',
  'defaultUnits',
  'installationCost'
]

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
const uuid = () => crypto.randomUUID()

async function signedInUser(app, ctx) {
  const token = String(ctx.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  try {
    const { user } = await app.service('authentication').create({ strategy: 'jwt', accessToken: token })
    return user || null
  } catch (_) {
    return null
  }
}

// Projects are stored with either an ObjectId or a string _id.
async function findProject(projects, id) {
  if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
    const byObjectId = await projects.findOne({ _id: new ObjectId(id) })
    if (byObjectId) return byObjectId
  }
  return projects.findOne({ _id: id })
}

const fail = (ctx, status, error, message) => {
  ctx.status = status
  ctx.body = { error, message }
}

export const projectCopy = (app) => {
  app.use(async (ctx, next) => {
    const m = PATH_RE.exec(ctx.path)
    if (!m) return next()
    if (ctx.method !== 'POST') return fail(ctx, 405, 'method_not_allowed', 'Not supported.')

    const user = await signedInUser(app, ctx)
    if (!user) return fail(ctx, 401, 'unauthenticated', 'Sign in again to continue.')

    const db = await app.get('mongodbClient')
    const projects = db.collection('projects')
    const floorplans = db.collection('floorplans')
    const furnished = db.collection('furnished_models')
    const components = db.collection('furnished_model_components')

    const sourceId = decodeURIComponent(m[1])
    const source = await findProject(projects, sourceId)
    if (!source) return fail(ctx, 404, 'not_found', 'That project no longer exists.')

    const isAdmin = ADMIN.includes(user.permissions)
    const isItsArchitect =
      user.permissions === ARCHITECT && str(source.architectUserId) === String(user._id)
    if (!isAdmin && !isItsArchitect) {
      return fail(ctx, 403, 'forbidden', 'You can only copy projects assigned to you.')
    }

    const name = str((ctx.request.body || {}).name)
    if (!name) return fail(ctx, 400, 'invalid', 'Enter a name for the copy.')
    if (name.length > MAX_NAME) {
      return fail(ctx, 400, 'invalid', `Keep the name under ${MAX_NAME} characters.`)
    }

    const now = new Date().toISOString()
    const oldProjectId = String(source._id)
    const newObjectId = new ObjectId()
    const newProjectId = newObjectId.toHexString()

    // Everything inserted so far, to take back out if a later step fails.
    const inserted = { project: false, floorplans: [], furnished: [], components: [] }

    try {
      // --- the project ------------------------------------------------------
      const project = { _id: newObjectId, name, status: 'open' }
      for (const key of COPIED_FIELDS) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
          project[key] = source[key]
        }
      }
      if (isItsArchitect) project.architectUserId = String(user._id)
      project.createdAt = now
      project.updatedAt = now
      await projects.insertOne(project)
      inserted.project = true

      // --- new ids for the floor plan and the furniture ---------------------
      const sourcePlans = await floorplans.find({ projectId: oldProjectId }).toArray()
      const sourceItems = await furnished.find({ projectId: oldProjectId }).toArray()
      const planIds = new Map(sourcePlans.map((p) => [String(p._id), uuid()]))
      const itemIds = new Map(sourceItems.map((f) => [String(f._id), uuid()]))

      // --- the floor plan: the scene names each item by its record id -------
      for (const plan of sourcePlans) {
        let scene = plan.scene
        if (typeof scene === 'string') {
          for (const [oldId, newId] of itemIds) scene = scene.split(oldId).join(newId)
        }
        const copy = {
          ...plan,
          _id: planIds.get(String(plan._id)),
          projectId: newProjectId,
          scene,
          createdAt: now,
          updatedAt: now
        }
        await floorplans.insertOne(copy)
        inserted.floorplans.push(copy._id)
      }

      // --- the furniture ----------------------------------------------------
      const itemDocs = sourceItems.map((item) => ({
        ...item,
        _id: itemIds.get(String(item._id)),
        projectId: newProjectId,
        floorPlanId: planIds.get(str(item.floorPlanId)) || item.floorPlanId,
        createdAt: now,
        updatedAt: now
      }))
      for (let i = 0; i < itemDocs.length; i += BATCH) {
        const batch = itemDocs.slice(i, i + BATCH)
        await furnished.insertMany(batch, { ordered: true })
        inserted.furnished.push(...batch.map((d) => d._id))
      }

      // --- each item's parts and their finishes -----------------------------
      if (itemIds.size) {
        const sourceParts = await components
          .find({ furnishedModelId: { $in: Array.from(itemIds.keys()) } })
          .toArray()
        const partIds = new Map(sourceParts.map((c) => [String(c._id), uuid()]))
        const partDocs = sourceParts.map((part) => {
          const copy = {
            ...part,
            _id: partIds.get(String(part._id)),
            furnishedModelId: itemIds.get(String(part.furnishedModelId)),
            createdAt: now,
            updatedAt: now
          }
          const parent = str(part.parentComponentId)
          if (parent && partIds.has(parent)) copy.parentComponentId = partIds.get(parent)
          return copy
        })
        for (let i = 0; i < partDocs.length; i += BATCH) {
          const batch = partDocs.slice(i, i + BATCH)
          await components.insertMany(batch, { ordered: true })
          inserted.components.push(...batch.map((d) => d._id))
        }
      }

      ctx.status = 201
      ctx.body = {
        ...project,
        _id: newProjectId,
        copiedFrom: oldProjectId,
        copied: {
          floorplans: inserted.floorplans.length,
          items: inserted.furnished.length,
          parts: inserted.components.length
        }
      }
    } catch (err) {
      console.error('[project-copy] failed, undoing the partial copy:', err?.message)
      try {
        if (inserted.components.length) await components.deleteMany({ _id: { $in: inserted.components } })
        if (inserted.furnished.length) await furnished.deleteMany({ _id: { $in: inserted.furnished } })
        if (inserted.floorplans.length) await floorplans.deleteMany({ _id: { $in: inserted.floorplans } })
        if (inserted.project) await projects.deleteOne({ _id: newObjectId })
      } catch (undoErr) {
        console.error('[project-copy] could not undo the partial copy:', undoErr?.message)
      }
      fail(ctx, 500, 'copy_failed', 'The project could not be copied. Nothing was changed.')
    }
  })
}
