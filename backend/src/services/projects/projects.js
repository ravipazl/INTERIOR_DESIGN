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
      // Log a dated stage_event whenever the project status changes.
      patch: [logStageEventOnStatusChange]
    },
    error: {
      all: []
    }
  })
}
