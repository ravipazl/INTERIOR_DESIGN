import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import axios from 'axios'
import {
  getTransporter,
  renderActionEmail,
  getInspireUrl,
  getDesignUrl,
  esc,
  fmtWhen
} from '../../mailer.js'
import {
  isWhatsAppEnabled,
  sendChangeReceived,
  sendTrackerUpdate,
  resolveClientPhone
} from '../../whatsapp.js'
import {
  projectItemDataValidator,
  projectItemPatchValidator,
  projectItemQueryValidator,
  projectItemResolver,
  projectItemExternalResolver,
  projectItemDataResolver,
  projectItemPatchResolver,
  projectItemQueryResolver
} from './project_items.schema.js'
import { ProjectItemsService, getOptions } from './project_items.class.js'
import { projectItemPath, projectItemMethods } from './project_items.shared.js'
import { idQuery } from '../../utils/id-query.js'

export * from './project_items.class.js'
export * from './project_items.schema.js'

// SMTP transporter + branded HTML template are shared (src/mailer.js).

// Fire a best-effort email WITHOUT blocking the response — by the time these
// run the item is already created (and, for a change request, the
// changeRequestPending flag is already written), so the slow part (recipient
// lookup + SMTP) must not make the request wait. Errors are logged, never thrown.
const runInBackground = (label, fn) => {
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`[${label}] background send failed:`, err?.message))
}
// Wrap a whole after-hook to run in the background (for hooks with no sync
// side-effect the response depends on — e.g. the stage-event emails).
const background = (label, hookFn) => async (context) => {
  runInBackground(label, () => hookFn(context))
  return context
}

// When a CHANGE REQUEST is added to a project workspace, email BOTH the admins
// and the assigned architect so the client's requested change is never missed.
//
// This lives on the BACKEND (not the browser) on purpose: change requests can be
// added from either app (Inspire or the 3D designer), and a server-side hook
// fires reliably every time regardless of which frontend — the earlier
// browser-driven approach silently no-op'd when the page didn't run the reopen.
// Best-effort: any failure is logged and swallowed so adding the change never
// fails. It does NOT change the project status.
const notifyOnChangeRequest = async (context) => {
  const item = context.result
  if (!item || item.kind !== 'change') return context

  // SYNC — mark the sent quote as stale so the client's "Accept Quote" bar hides
  // right away (the frontend refetches changeRequestPending immediately after this
  // create). This must complete before the response; the emails must not.
  let project = null
  try {
    const db = await context.app.get('mongodbClient')
    project = await db.collection('projects').findOne(idQuery(item.projectId))
    await db
      .collection('projects')
      .updateOne(idQuery(item.projectId), { $set: { changeRequestPending: true } })
  } catch (e) {
    // fall through with no project — we still email the admins
  }

  // BACKGROUND — recipient lookup + team email + client confirmation, so adding a
  // change request returns immediately instead of waiting on SMTP.
  runInBackground('change-notify', async () => {
    const projectName = project?.name || 'a project'

    const recipients = []
    // All admins (from the auth backend).
    try {
      const { data } = await axios.get(`${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users`, {
        params: { permissions: 'admin' },
        headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` }
      })
      const admins = (Array.isArray(data) ? data : data?.data) || []
      admins.forEach((u) => u?.email && recipients.push(u.email))
    } catch (e) {
      console.warn('[change-notify] admin lookup failed:', e?.message)
    }
    // The assigned architect.
    if (project?.architectUserId) {
      try {
        const { data: arch } = await axios.get(
          `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.architectUserId}`,
          { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
        )
        if (arch?.email) recipients.push(arch.email)
      } catch (e) {
        console.warn('[change-notify] architect lookup failed:', e?.message)
      }
    }
    const to = [...new Set(recipients.filter(Boolean))]
    if (!to.length) {
      console.warn('[change-notify] no recipients to notify')
      return context
    }

    const tx = getTransporter()
    if (!tx) {
      console.warn('[change-notify] SMTP not configured; change request not emailed')
      return context
    }

    const change = item.description || '(no description provided)'
    const requestedOn = fmtWhen()
    // A styled quote box so the actual requested change stands out in the email.
    const changeBox = `<div style="background:#fff8ec;border:1px solid #f3d9a4;border-left:4px solid #d98a00;border-radius:8px;padding:12px 14px;font-size:14px;line-height:21px;color:#8a5a00;">${esc(
      change
    )}</div>`
    const teamUrl = `${getDesignUrl()}/project-detail/${item.projectId}`
    await tx.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to.join(','),
      subject: `New change request — ${projectName}`,
      text:
        `A change was requested on "${projectName}". Please review and revise the design.\n\n` +
        `Change:    ${change}\n` +
        `Requested: ${requestedOn}\n` +
        (item.createdBy ? `By:        ${item.createdBy}\n` : '') +
        `\nReview it here: ${teamUrl}\n`,
      html: renderActionEmail({
        title: 'New change request',
        intro: `The client requested a change on <strong>${esc(
          projectName
        )}</strong>. Please review and revise the design.`,
        bodyHtml: changeBox,
        details: [
          ['Project', projectName],
          item.createdBy ? ['Requested by', item.createdBy] : null,
          ['Requested', requestedOn]
        ].filter(Boolean),
        ctaText: 'Review the change',
        ctaUrl: teamUrl
      })
    })

    // Confirm back to the CLIENT that their change was received, so they aren't
    // left wondering whether it landed. Owner lookup (auth backend) → clientEmail
    // fallback, mirroring the stage-event mail. Best-effort; never a hard failure.
    try {
      let clientEmail = project?.clientEmail || null
      let clientName = ''
      if (project?.ownerUserId) {
        try {
          const { data: owner } = await axios.get(
            `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.ownerUserId}`,
            { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
          )
          if (owner?.email) clientEmail = owner.email
          clientName = owner?.name || ''
        } catch (e) {
          console.warn('[change-notify] owner lookup failed:', e?.message)
        }
      }
      if (clientEmail) {
        const clientUrl = `${getInspireUrl()}/project-detail/${item.projectId}`
        await tx.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: clientEmail,
          subject: `We received your change request — ${projectName}`,
          text:
            `Hi${clientName ? ' ' + clientName : ''},\n\n` +
            `Thanks — we've received your change request for "${projectName}" and our ` +
            `team is reviewing it. We'll send you a revised quotation shortly.\n\n` +
            `Your request:\n    ${change}\n\n` +
            `Follow the progress here: ${clientUrl}\n\nThank you,\nPazl`,
          html: renderActionEmail({
            title: 'We received your change request',
            intro: `Hi${
              clientName ? ' ' + esc(clientName) : ''
            }, thanks — we've received your change request for <strong>${esc(
              projectName
            )}</strong> and our team is reviewing it. We'll send you a revised quotation shortly.`,
            bodyHtml: `<div style="background:#f8f9fb;border:1px solid #eceef3;border-left:4px solid #414063;border-radius:8px;padding:12px 14px;font-size:14px;line-height:21px;color:#1f2033;"><span style="color:#8a8d9f;font-size:12px;display:block;margin-bottom:4px;">Your request</span>${esc(
              change
            )}</div>`,
            details: [
              ['Project', projectName],
              ['Requested', requestedOn]
            ],
            ctaText: 'View your project',
            ctaUrl: clientUrl
          })
        })
      } else {
        console.warn('[change-notify] no client email; client confirmation not sent')
      }
      // (The client WhatsApp for "change received" is sent SYNCHRONOUSLY by
      // attachItemWhatsApp so its real status reaches the frontend toast.)
    } catch (e) {
      console.warn('[change-notify] client confirmation failed:', e?.message)
    }
  })

  return context
}

// PROJECT TRACKER — human labels for each stage (mirrors the frontend list).
const STAGE_LABELS = {
  project_created: 'Project started',
  inspiration_generated: 'Design ideas made',
  quote_requested: 'Quote requested',
  design_in_progress: 'Design in progress',
  quote_sent: 'Quote sent',
  quote_accepted: 'Quote approved',
  design_finalized: 'Design finalized',
  in_production: 'In production',
  quality_check: 'Quality check',
  out_for_delivery: 'Out for delivery',
  installation: 'Installation',
  completed_handover: 'Done & handover'
}

// When the project reaches a new stage (a stage_event is created — either the
// auto status hook or a manual "Mark done"), EMAIL THE CLIENT that their project
// moved forward. Reuses the same SMTP transporter as the quote / change-request
// emails. Best-effort: logged and swallowed so it never breaks the advance.
const notifyOnStageEvent = async (context) => {
  try {
    const item = context.result
    if (!item || item.kind !== 'stage_event') return context
    const label =
      item.stage === '__custom'
        ? item.title || 'Update'
        : STAGE_LABELS[item.stage] || item.stage

    // The project (for its name + the client/owner).
    let project = null
    try {
      const db = await context.app.get('mongodbClient')
      project = await db.collection('projects').findOne(idQuery(item.projectId))
    } catch (e) {
      // no project → nothing to notify
    }
    if (!project) return context

    // The client = the project owner. Look up their email (auth backend), then
    // fall back to the project's own clientEmail field.
    let clientEmail = project.clientEmail || null
    let clientName = ''
    if (project.ownerUserId) {
      try {
        const { data: owner } = await axios.get(
          `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.ownerUserId}`,
          { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
        )
        if (owner?.email) clientEmail = owner.email
        clientName = owner?.name || ''
      } catch (e) {
        console.warn('[tracker-notify] owner lookup failed:', e?.message)
      }
    }
    const tx = getTransporter()
    if (!tx) {
      console.warn('[tracker-notify] SMTP not configured; stage change not emailed')
      return context
    }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER
    const projectName = project.name || 'your project'
    const expected = item.expectedDate ? `\nExpected: ${item.expectedDate}` : ''
    const clientUrl = `${getInspireUrl()}/project-detail/${item.projectId}`

    // 1) The CLIENT — the friendly "your project moved forward" note.
    if (clientEmail) {
      await tx.sendMail({
        from,
        to: clientEmail,
        subject: `${projectName} — ${label}`,
        text:
          `Hi${clientName ? ' ' + clientName : ''},\n\n` +
          `Good news — your project "${projectName}" has moved to a new stage:\n\n` +
          `    ${label}${expected}\n\n` +
          `Track it here: ${clientUrl}\n`,
        html: renderActionEmail({
          title: 'Your project moved forward',
          intro: `Hi${
            clientName ? ' ' + esc(clientName) : ''
          }, good news — your project <strong>${esc(
            projectName
          )}</strong> has reached a new stage.`,
          details: [
            ['Project', projectName],
            ['Stage', label],
            item.expectedDate ? ['Expected', item.expectedDate] : null
          ].filter(Boolean),
          ctaText: 'Track your project',
          ctaUrl: clientUrl
        })
      })
    } else {
      console.warn('[tracker-notify] no client email; client not emailed')
    }

    // (The tracker_update WhatsApp on every stage advance is sent SYNCHRONOUSLY by
    // attachItemWhatsApp so its real status reaches the frontend toast.)

    // 2) The TEAM — admins + the assigned architect get an internal note, so the
    // whole team knows the project advanced. Reuses the same auth-backend lookup
    // the change-request emails use (admins by permission, architect by id).
    const teamRecipients = []
    try {
      const { data } = await axios.get(`${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users`, {
        params: { permissions: 'admin' },
        headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` }
      })
      const admins = (Array.isArray(data) ? data : data?.data) || []
      admins.forEach((u) => u?.email && teamRecipients.push(u.email))
    } catch (e) {
      console.warn('[tracker-notify] admin lookup failed:', e?.message)
    }
    if (project.architectUserId) {
      try {
        const { data: arch } = await axios.get(
          `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.architectUserId}`,
          { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
        )
        if (arch?.email) teamRecipients.push(arch.email)
      } catch (e) {
        console.warn('[tracker-notify] architect lookup failed:', e?.message)
      }
    }
    // De-duplicate, and don't re-send to the client if they're also on the team.
    const team = [...new Set(teamRecipients.filter((e) => e && e !== clientEmail))]
    if (team.length) {
      const movedOn = fmtWhen()
      const teamUrl = `${getDesignUrl()}/project-detail/${item.projectId}`
      await tx.sendMail({
        from,
        to: team.join(','),
        subject: `[Project update] ${projectName} — ${label}`,
        text:
          `Project "${projectName}" has moved to a new stage:\n\n` +
          `    ${label}${expected}\n\n` +
          `Client:  ${clientName || clientEmail || 'n/a'}\n` +
          `Updated: ${movedOn}\n` +
          `\nOpen it here: ${teamUrl}\n`,
        html: renderActionEmail({
          title: 'Project update',
          intro: `Project <strong>${esc(projectName)}</strong> has reached a new stage.`,
          details: [
            ['Project', projectName],
            ['Stage', label],
            item.expectedDate ? ['Expected', item.expectedDate] : null,
            ['Client', clientName || clientEmail || 'n/a'],
            ['Updated', movedOn]
          ].filter(Boolean),
          ctaText: 'Open project',
          ctaUrl: teamUrl
        })
      })
    }
  } catch (err) {
    console.error('[tracker-notify] failed:', err?.message)
  }
  return context
}

// PROJECT TRACKER — bell support. When a step moves (a stage_event is created),
// stamp the project with `lastStepMoveAt` + `lastStepMoveLabel` so the admin /
// architect header bell can show "this project advanced to <step>". Direct Mongo
// update (bypasses schema) on the SHARED projects collection, so both apps' bells
// see it. Best-effort: logged and swallowed.
const stampStepMoveOnProject = async (context) => {
  try {
    const item = context.result
    if (!item || item.kind !== 'stage_event') return context
    const label =
      item.stage === '__custom'
        ? item.title || 'Update'
        : STAGE_LABELS[item.stage] || item.stage
    const db = await context.app.get('mongodbClient')
    await db.collection('projects').updateOne(idQuery(item.projectId), {
      $set: {
        lastStepMoveAt: new Date().toISOString(),
        lastStepMoveLabel: label
      }
    })
  } catch (err) {
    console.error('[tracker] stampStepMoveOnProject failed:', err?.message)
  }
  return context
}

// SYNCHRONOUS after-create hook: sends the client WhatsApp for a change request
// (change_received) or a tracker step advance (tracker_update) and ATTACHES the
// result to the response (context.result.whatsapp) so the frontend toast can show
// the REAL send status. Best-effort — never throws; the emails stay backgrounded.
const attachItemWhatsApp = async (context) => {
  try {
    const item = context.result
    if (!item || (item.kind !== 'change' && item.kind !== 'stage_event')) return context
    if (!isWhatsAppEnabled()) {
      item.whatsapp = { skipped: true, reason: 'disabled' }
      return context
    }
    const db = await context.app.get('mongodbClient')
    const project = await db.collection('projects').findOne(idQuery(item.projectId))
    if (!project) return context
    const phone = await resolveClientPhone(project)
    if (!phone) {
      item.whatsapp = { skipped: true, reason: 'no_phone' }
      return context
    }
    const projectName = project.name || 'your project'
    const clientName = project.clientName || ''
    let r
    if (item.kind === 'change') {
      r = await sendChangeReceived({ to: phone, clientName, projectName })
    } else {
      const label =
        item.stage === '__custom'
          ? item.title || 'Update'
          : STAGE_LABELS[item.stage] || item.stage
      r = await sendTrackerUpdate({ to: phone, clientName, projectName, message: label })
    }
    if (!r.sent && !r.skipped) console.warn(`[item-whatsapp] ${item.kind} not sent:`, r.error)
    item.whatsapp = { ...r, to: phone }
  } catch (e) {
    console.warn('[item-whatsapp] failed:', e?.message)
    if (context.result) context.result.whatsapp = { sent: false, error: e?.message }
  }
  return context
}

export const projectItem = (app) => {
  app.use(projectItemPath, new ProjectItemsService(getOptions(app)), {
    methods: projectItemMethods,

    events: []
  })

  app.service(projectItemPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(projectItemExternalResolver),
        schemaHooks.resolveResult(projectItemResolver)
      ],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [
        schemaHooks.validateQuery(projectItemQueryValidator),
        schemaHooks.resolveQuery(projectItemQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(projectItemDataValidator),
        schemaHooks.resolveData(projectItemDataResolver),
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
        schemaHooks.validateData(projectItemPatchValidator),
        schemaHooks.resolveData(projectItemPatchResolver),
        async (context) => {
          context.data = {
            ...context.data,
            updatedAt: new Date().toISOString()
          }
        }
      ],
      remove: [authenticate('jwt')]
    },
    after: {
      all: [],
      // Email admins + architect on a change request; email the CLIENT on each
      // tracker stage change. Both best-effort; neither alters the created item.
      // (Renders don't email here: the architect's single "Send to admin" action
      // also marks the project pending approval, which notifies admins once —
      // emailing per render would spam N mails for one submission.)
      // notifyOnChangeRequest writes changeRequestPending synchronously then
      // backgrounds its emails; the stage-event mails have no sync side-effect,
      // so they run fully in the background — neither holds up the response.
      create: [
        // WhatsApp runs SYNCHRONOUSLY first so its real status is attached to the
        // response (context.result.whatsapp) for the toast; emails stay backgrounded.
        attachItemWhatsApp,
        notifyOnChangeRequest,
        background('stage-notify', notifyOnStageEvent)
      ]
    },
    error: {
      all: []
    }
  })
}
