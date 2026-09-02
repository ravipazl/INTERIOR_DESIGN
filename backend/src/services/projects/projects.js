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
// For reading the client's chosen image off disk so it can be embedded in the
// quote-request email. ESM has no __dirname, hence fileURLToPath — the same
// pattern the upload services use.
import path from 'path'
import fs from 'fs'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
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
    // TRUE, not false — same reasoning as the quote-request hook below. The
    // architect HAS been notified; saying otherwise makes the UI report a
    // failure that did not happen.
    project.architectNotified = true
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

// ---------------------------------------------------------------------------
// REQUEST QUOTE -> email the admins.
//
// The client's "Send for quote" sets status = quotation_requested. The frontend
// (Stepper1Expanded / Stepper3Expanded) then picks its toast from `adminNotified`
// on the response — and nothing set it, so it was always undefined, always falsy,
// and the client always saw "we couldn't email the admin just now".
//
// That message was misleading in a specific way: it reads like a temporary mail
// failure, but no mail was ever attempted. There was no admin-notification code
// in this service at all. Same situation the architect assignment was in.
//
// Recipients are looked up by ROLE, not hard-coded: add another admin and they
// are included with no code change.
// ---------------------------------------------------------------------------

const ADMIN_ROLES = ['admin', 'super_admin']

const notifyAdminsOnQuoteRequest = async (context) => {
  if (!context.data || context.data.status !== 'quotation_requested') return context

  const project = Array.isArray(context.result) ? context.result[0] : context.result
  if (!project) return context

  // Default false so the UI never claims an email went out when it didn't.
  project.adminNotified = false

  // Same short window as the architect notification: swallow an accidental
  // double submit without ever blocking a genuine later request.
  const lastAt = project.quoteRequestNotifiedAt ? Date.parse(project.quoteRequestNotifiedAt) : 0
  if (Number.isFinite(lastAt) && lastAt > 0 && Date.now() - lastAt < NOTIFY_DEDUPE_MS) {
    // TRUE, not false. The flag answers "has the admin been notified?", not
    // "did this particular click send an email". Returning false here made the
    // UI show "We could not email the admin" on a second click, moments after
    // the first click had emailed them successfully — telling the user the
    // opposite of what happened.
    project.adminNotified = true
    return context
  }

  try {
    const found = await context.app.service('users').find({
      query: { permissions: { $in: ADMIN_ROLES }, $limit: 50 },
      paginate: false
    })
    const admins = Array.isArray(found) ? found : found?.data || []
    const to = admins.map((u) => u?.email).filter(Boolean)
    if (!to.length) {
      console.error('[quote-request] no admin with an email address; nobody notified')
      return context
    }

    const projectName = project.name || 'a project'
    const clientName = project.clientName || project.ownerUser?.name || ''

    // Embed the design the client actually chose, so the admin can see WHAT is
    // being quoted without opening the app.
    //
    // Attached inline (cid:) rather than linked. The images are served from this
    // backend, so a link would read http://localhost:3400/uploads/... — which
    // loads in nobody's mail client except on this machine, and never in
    // production. An attachment travels with the message.
    //
    // Entirely optional: any failure here just means an email without a picture,
    // which is still far better than no email.
    // Gmail and most providers reject a message over ~25 MB. Attaching every
    // pick unconditionally could push past that, and a rejected message means
    // the admin gets NOTHING — far worse than getting most of the pictures. So
    // the selection is unlimited but the attachments stop at a safe total; any
    // remainder is named in the body instead.
    const MAX_ATTACH_BYTES = 15 * 1024 * 1024

    const attachments = []
    const cids = []
    let skipped = 0
    try {
      const ids = Array.isArray(context.data.quoteImageIds)
        ? context.data.quoteImageIds
        : Array.isArray(project.quoteImageIds)
        ? project.quoteImageIds
        : [context.data.quoteImageId || project.quoteImageId].filter(Boolean)

      let total = 0
      for (const [i, imageId] of ids.entries()) {
        const image = await context.app.service('images').get(imageId).catch(() => null)
        if (!image?.url) continue
        const file = path.resolve(__dirname, '../../../public/uploads/images', image.url)
        if (!fs.existsSync(file)) {
          console.error(`[quote-request] image file missing on disk: ${file}`)
          continue
        }
        const size = fs.statSync(file).size
        if (total + size > MAX_ATTACH_BYTES) {
          skipped++
          continue
        }
        total += size
        const cid = `quote-image-${i}`
        attachments.push({ filename: image.url, path: file, cid })
        cids.push(cid)
      }
      if (skipped) {
        console.warn(`[quote-request] ${skipped} image(s) omitted to keep the email under the size limit`)
      }
    } catch (imgErr) {
      console.error('[quote-request] could not attach the chosen images:', imgErr?.message)
    }

    // Two-column grid, built with a TABLE.
    //
    // Outlook — which is what the admin reads this in — ignores flexbox and CSS
    // grid completely, so a table is the only layout that survives. Widths are
    // fixed in HTML attributes as well as CSS for the same reason.
    //
    // One image keeps the full 544px width; shrinking a lone picture into half a
    // row wastes the space. Two or more go side by side, so four images occupy
    // the height one used to, instead of making the admin scroll past each in
    // turn.
    const CONTENT_W = 544
    const GAP = 16
    const cellW = cids.length === 1 ? CONTENT_W : Math.floor((CONTENT_W - GAP) / 2)
    const perRow = cids.length === 1 ? 1 : 2

    const cell = (cid) =>
      `<td width="${cellW}" valign="top" style="padding:0 0 ${GAP}px;">
         <img src="cid:${cid}" alt="Selected design" width="${cellW}"
              style="width:100%;max-width:${cellW}px;height:auto;border-radius:8px;border:1px solid #eceef3;display:block;" />
       </td>`

    const rows = []
    for (let i = 0; i < cids.length; i += perRow) {
      const cellsInRow = cids.slice(i, i + perRow).map(cell)
      // Pad the last row so a lone trailing image keeps its column width instead
      // of stretching across the table.
      while (cellsInRow.length < perRow) cellsInRow.push(`<td width="${cellW}"></td>`)
      rows.push(
        `<tr>${cellsInRow.join(`<td width="${GAP}" style="font-size:0;line-height:0;">&nbsp;</td>`)}</tr>`
      )
    }

    const bodyHtml =
      (rows.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${CONTENT_W}"
                  style="width:100%;max-width:${CONTENT_W}px;">${rows.join('')}</table>`
        : '') +
      (skipped
        ? `<p style="margin:0;font-size:13px;color:#8a8d9f;">and ${skipped} more image${
            skipped > 1 ? 's' : ''
          } — open the project to see them all.</p>`
        : '')

    const html = renderActionEmail({
      title: 'A client has requested a quote',
      intro: `<strong>${esc(clientName || 'A client')}</strong> has requested a quote for <strong>${esc(
        projectName
      )}</strong>.`,
      bodyHtml,
      details: [
        ['Project', projectName],
        ['Client', clientName],
        ['Address', project.address],
        ['Requested', fmtWhen()]
      ],
      ctaText: 'Open project',
      ctaUrl: `${getInspireUrl()}/projects`
    })

    const result = await sendMail({
      to: to.join(', '),
      subject: `Quote requested: ${projectName}`,
      text:
        `${clientName || 'A client'} has requested a quote for "${projectName}".\n\n` +
        `Open it here: ${getInspireUrl()}/projects\n`,
      html,
      attachments
    })

    project.adminNotified = result.sent === true
    if (!result.sent) {
      console.error('[quote-request] email not sent:', result.reason)
      return context
    }

    // Stamp for the dedupe window above. Written straight to the collection so
    // it does not re-enter these hooks; `_id` came from the DB so its type
    // already matches.
    project.quoteRequestNotifiedAt = new Date().toISOString()
    const model = await context.service.getModel(context.params)
    await model.updateOne(
      { _id: project._id },
      { $set: { quoteRequestNotifiedAt: project.quoteRequestNotifiedAt } }
    )
  } catch (err) {
    // Never fail the quote request itself over a mail problem.
    console.error('[quote-request] notify failed:', err?.message)
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
      patch: [
        logStageEventOnStatusChange,
        notifyArchitectOnAssignment,
        notifyAdminsOnQuoteRequest
      ]
    },
    error: {
      all: []
    }
  })
}
