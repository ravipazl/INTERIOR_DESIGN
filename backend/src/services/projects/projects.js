import { authenticate } from '@feathersjs/authentication'
import { axios } from '../../utils/axios.js'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  projectDataValidator,
  projectPatchValidator,
  projectQueryValidator,
  projectResolver,
  projectExternalResolver,
  projectDataResolver,
  projectPatchResolver,
  projectQueryResolver
} from './projects.schema.js'
import { ProjectService, getOptions } from './projects.class.js'
import { projectPath, projectMethods } from './projects.shared.js'
import { fastJoin } from 'feathers-hooks-common'
import { getInspireUrl, renderActionEmail, sendMail, esc, fmtWhen } from '../../mailer.js'
export * from './projects.class.js'
export * from './projects.schema.js'

const projectsJoinResolver = {
  joins: {
    ownerUser:
      (...args) =>
        async (char, { app }) => {
          if (char?.ownerUserId) {
            try {
              const getUserResponse = await axios.get(
                `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${char.ownerUserId}`,
                {
                  headers: {
                    'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}`
                  }
                }
              )
              if (getUserResponse?.data) {
                char.ownerUser = getUserResponse.data
              }
            } catch (error) {
              char.ownerUser = null
            }
          }
        },
    architectUser:
      (...args) =>
        async (char, { app }) => {
          if (char?.architectUserId) {
            try {
              const getUserResponse = await axios.get(
                `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${char.architectUserId}`,
                {
                  headers: {
                    'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}`
                  }
                }
              )
              if (getUserResponse?.data) {
                char.architectUser = getUserResponse.data
              }
            } catch (error) {
              char.architectUser = null
            }
          }
        },
    sharedUsers:
      (...args) =>
        async (char, { app }) => {
          if (char?.sharedUserIDs) {
            try {
              let list = []
              await Promise.all(
                char.sharedUserIDs.map(async (id) => {
                  const getUserResponse = await axios.get(
                    `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${id}`,
                    {
                      headers: {
                        'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}`
                      }
                    }
                  )
                  if (getUserResponse?.data) {
                    list.push(getUserResponse.data.name)
                  }
                })
              )
              char.sharedUsers = list
            } catch (error) {
              char.sharedUsers = null
            }
          }
        }
  }
}

// PROJECT TRACKER — map each project status to a tracker stage. When the status
// changes, we log a matching `stage_event` (kind on the project_items collection)
// so the client tracker shows each Phase-1 step WITH its date, and the timeline
// has a full audit history. Phase-2 stages are advanced manually from the UI.
// Each project status maps 1-to-1 to a tracker milestone, so every status change
// auto-logs a dated stage_event and the client tracker advances on its own.
const STATUS_TO_STAGE = {
  open: 'project_created',
  quotation_requested: 'quote_requested',
  quotation_pending_approval: 'design_in_progress',
  quotation_sent: 'quote_sent',
  quotation_accepted: 'quote_accepted',
  closed: 'completed_handover'
}

// after:patch on projects — writes the stage_event once per stage (idempotent).
// Best-effort: any failure is logged and swallowed so it never breaks the patch.
const logStageEventOnStatusChange = async (context) => {
  try {
    const newStatus = context.data && context.data.status
    if (!newStatus) return context
    const stage = STATUS_TO_STAGE[newStatus]
    if (!stage) return context

    const project = context.result
    const projectId = project && project._id ? String(project._id) : null
    if (!projectId) return context

    const svc = context.app.service('projectitems')

    // Idempotent: skip if this stage was already logged for the project.
    const existing = await svc.find({
      query: { projectId, kind: 'stage_event', stage, $limit: 1 },
      paginate: false
    })
    const rows = Array.isArray(existing) ? existing : existing?.data || []
    if (rows.length) return context

    await svc.create({
      projectId,
      kind: 'stage_event',
      stage,
      auto: true,
      createdBy: 'system'
    })
  } catch (err) {
    console.error('[tracker] logStageEventOnStatusChange failed:', err?.message)
  }
  return context
}

// ---------------------------------------------------------------------------
// ASSIGN ARCHITECT — email the architect when they are assigned to a project.
//
// The frontend (Projects.jsx handleAssignArchitect) decides which toast to show
// from `architectNotified` on the PATCH response. Nothing set it, so it was
// always undefined → always falsy → the admin always saw "the notification email
// could not be sent", and in fact no mail was ever attempted: the projects
// service had no mail code at all.
//
// Duplicate suppression is time-based, NOT "did the value change".
//
// The frontend's updateProject() PATCHes the project TWICE (once as the AI
// backend, once as the "design" backend), and in this merged app
// REACT_APP_API_BASE_URL and REACT_APP_PAZL_DESIGN_API_BASE_URL are BOTH
// http://localhost:3400 — so both land here and would send two identical emails.
//
// The obvious guard, "only send when architectUserId actually changed", is
// WRONG: re-assigning the architect who is already on the project is a normal
// admin action (and the only possible action when there is a single architect in
// the system), and it must still notify them. That guard silently sent nothing.
//
// Instead we record who was last notified and when, and skip only a repeat to
// the SAME architect inside a short window — long enough to swallow the
// duplicate PATCH, far shorter than any deliberate re-assignment.
// ---------------------------------------------------------------------------

const NOTIFY_DEDUPE_MS = 60 * 1000

// Best-effort: a mail failure must never fail the assignment itself, so every
// path here is caught and only reflected in `architectNotified`.
const notifyArchitectOnAssignment = async (context) => {
  const architectUserId = context.data && context.data.architectUserId
  if (!architectUserId) return context

  const project = Array.isArray(context.result) ? context.result[0] : context.result
  if (!project) return context

  // Default to false so the UI never claims an email went out when it didn't.
  project.architectNotified = false

  // Skip only the duplicate PATCH: same architect, notified moments ago.
  const lastTo = project.architectNotifiedTo
  const lastAt = project.architectNotifiedAt ? Date.parse(project.architectNotifiedAt) : 0
  if (
    lastTo &&
    String(lastTo) === String(architectUserId) &&
    Number.isFinite(lastAt) &&
    Date.now() - lastAt < NOTIFY_DEDUPE_MS
  ) {
    // The first of the pair already sent it and reported architectNotified:true
    // to the UI, so nothing is lost by staying false here.
    return context
  }

  try {
    const architect = await context.app.service('users').get(architectUserId)
    const to = architect?.email
    if (!to) {
      console.error(`[assign-architect] user ${architectUserId} has no email; not notified`)
      return context
    }

    const projectName = project.name || 'a project'
    const html = renderActionEmail({
      title: 'You have been assigned to a project',
      intro: `Hi ${esc(architect.name || 'there')}, you are now the architect for <strong>${esc(
        projectName
      )}</strong>.`,
      details: [
        ['Project', projectName],
        ['Client', project.clientName],
        ['Address', project.address],
        ['Assigned', fmtWhen()]
      ],
      ctaText: 'Open project',
      ctaUrl: `${getInspireUrl()}/projects`
    })

    const result = await sendMail({
      to,
      subject: `You have been assigned to ${projectName}`,
      text:
        `Hi ${architect.name || 'there'},\n\n` +
        `You are now the architect for "${projectName}".\n\n` +
        `Open it here: ${getInspireUrl()}/projects\n`,
      html
    })

    project.architectNotified = result.sent === true
    if (!result.sent) {
      console.error('[assign-architect] email not sent:', result.reason)
      return context
    }

    // Stamp who was notified and when — this is what the dedupe window above
    // reads on the duplicate PATCH. Written straight to the collection (not via
    // patch()) so it does not re-enter these hooks. `_id` came from the DB, so
    // its type already matches; no idQuery needed.
    project.architectNotifiedTo = String(architectUserId)
    project.architectNotifiedAt = new Date().toISOString()
    const model = await context.service.getModel(context.params)
    await model.updateOne(
      { _id: project._id },
      {
        $set: {
          architectNotifiedTo: project.architectNotifiedTo,
          architectNotifiedAt: project.architectNotifiedAt
        }
      }
    )
  } catch (err) {
    console.error('[assign-architect] notify failed:', err?.message)
  }
  return context
}

export const project = (app) => {
  app.use(projectPath, new ProjectService(getOptions(app)), {
    methods: projectMethods,
    events: []
  })

  app.service(projectPath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(projectExternalResolver), schemaHooks.resolveResult(projectResolver)],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [schemaHooks.validateQuery(projectQueryValidator), schemaHooks.resolveQuery(projectQueryResolver)],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(projectDataValidator),
        schemaHooks.resolveData(projectDataResolver),
        async (context) => {
          context.data = {
            ...context.data,
            createdAt: new Date().toISOString()
          }
        }
      ],
      update: [authenticate('jwt')],
      patch: [
        authenticate('jwt'),
        schemaHooks.validateData(projectPatchValidator),
        schemaHooks.resolveData(projectPatchResolver),
        async (context) => {
          context.data = {
            ...context.data,
            updatedAt: new Date().toISOString()
          }
          // Sending a NEW quote (status → quotation_sent) clears any pending
          // change-request flag, so the client's "Accept Quote" bar re-enables
          // once a fresh quote goes out.
          if (context.data?.status === 'quotation_sent') {
            context.data.changeRequestPending = false
          }
        }
      ],
      remove: [authenticate('jwt')]
    },
    after: {
      all: [fastJoin(projectsJoinResolver)],
      // Log a dated stage_event whenever the project status changes, and email
      // the architect when one is newly assigned.
      patch: [logStageEventOnStatusChange, notifyArchitectOnAssignment]
    },
    error: {
      all: []
    }
  })
}
