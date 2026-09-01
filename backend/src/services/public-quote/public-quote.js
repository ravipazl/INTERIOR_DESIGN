// Public, LOGIN-FREE quote endpoints for the client — gated ONLY by the
// unguessable `quoteShareToken` in the URL (minted in send-quote). Nothing else
// is exposed, and no other project can be reached.
//
//   GET  /public-quote/:token          → the quote bundle (renders/videos + BOQ)
//   POST /public-quote/:token/accept   → the client accepts the quote
//   POST /public-quote/:token/change   → the client requests a change ({ note })
//   POST /public-quote/:token/reject   → the client rejects the quote ({ reason? })
//
// The two actions run the SAME lifecycle the app already uses:
//   • change → creates a `change` project item (internal service call), which
//     fires the existing hook: emails admins + architect + client, and sets
//     changeRequestPending so the "Send to client" bar re-opens for a revision.
//   • accept → marks the project accepted and emails the team (admins +
//     architect) that the quote was accepted — the admin then closes it as today.

import axios from 'axios'
import { MongoClient } from 'mongodb'
import { idQuery } from '../../utils/id-query.js'
import {
  getTransporter,
  renderActionEmail,
  getDesignUrl,
  esc,
  fmtWhen
} from '../../mailer.js'

// A cached handle to the AI backend's database, so a public accept can mirror the
// status there too (the Inspire admin dashboard/bell reads the AI backend). We
// write it directly because the team email already fires from the design side,
// so there's nothing to gain from routing through the AI Feathers hooks.
//
// Connection: PAZL_AI_MONGODB_URL if set (use this in prod, esp. if the AI DB is
// on a different server), else derived from the design connection by swapping the
// database name (pazl-design-backend → pazl-ai-backend) on the same server.
let aiDbPromise = null
const getAiDb = (app) => {
  if (aiDbPromise) return aiDbPromise
  let uri = process.env.PAZL_AI_MONGODB_URL
  if (!uri) {
    try {
      const u = new URL(app.get('mongodb'))
      u.pathname = '/' + u.pathname.replace(/^\//, '').replace('design', 'ai')
      uri = u.toString()
    } catch (e) {
      return null
    }
  }
  aiDbPromise = MongoClient.connect(uri, { serverSelectionTimeoutMS: 3000 })
    .then((client) => client.db())
    .catch((e) => {
      aiDbPromise = null // allow a later retry
      throw e
    })
  return aiDbPromise
}

// Best-effort mirror of the project status into the AI DB — never blocks or
// breaks the accept; a failure just leaves the AI dashboard momentarily stale.
const syncAiProjectStatus = async (app, pid, status) => {
  try {
    const aiDb = await getAiDb(app)
    if (!aiDb) return
    await aiDb.collection('projects').updateOne(idQuery(pid), { $set: { status } })
  } catch (e) {
    console.warn('[public-quote] AI status sync failed:', e?.message)
  }
}

// Email the team (admins + assigned architect) that the client accepted. Same
// auth-backend lookup the change-request hook uses. Best-effort — never throws.
const notifyTeamOfAccept = async (project) => {
  const recipients = []
  try {
    const { data } = await axios.get(`${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users`, {
      params: { permissions: 'admin' },
      headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` }
    })
    const admins = (Array.isArray(data) ? data : data?.data) || []
    admins.forEach((u) => u?.email && recipients.push(u.email))
  } catch (e) {
    console.warn('[accept-public] admin lookup failed:', e?.message)
  }
  if (project?.architectUserId) {
    try {
      const { data: arch } = await axios.get(
        `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.architectUserId}`,
        { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
      )
      if (arch?.email) recipients.push(arch.email)
    } catch (e) {
      /* architect optional */
    }
  }
  const to = [...new Set(recipients.filter(Boolean))]
  if (!to.length) return
  const tx = getTransporter()
  if (!tx) return
  const projectName = project?.name || 'a project'
  const snap = project?.quoteSnapshot || {}
  const client = snap.clientName || project?.clientName || snap.clientEmail || 'the client'
  const teamUrl = `${getDesignUrl()}/project-detail/${project._id}`
  await tx.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: to.join(','),
    subject: `Quote accepted — ${projectName}`,
    text:
      `${client} has accepted the quotation for "${projectName}". You can now close the project.\n\n` +
      `Open it here: ${teamUrl}\n`,
    html: renderActionEmail({
      title: 'The client accepted the quote',
      intro: `<strong>${esc(client)}</strong> has accepted the quotation for "<strong>${esc(
        projectName
      )}</strong>". You can now close the project.`,
      details: [
        ['Project', projectName],
        ['Client', client],
        ['Accepted', fmtWhen()]
      ],
      ctaText: 'Open project',
      ctaUrl: teamUrl
    })
  })
}

// Email the team (admins + assigned architect) that the client REJECTED the
// quote, including the reason if the client gave one. Mirrors notifyTeamOfAccept
// — same auth-backend lookup, same best-effort (never throws).
const notifyTeamOfReject = async (project, reason) => {
  const recipients = []
  try {
    const { data } = await axios.get(`${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users`, {
      params: { permissions: 'admin' },
      headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` }
    })
    const admins = (Array.isArray(data) ? data : data?.data) || []
    admins.forEach((u) => u?.email && recipients.push(u.email))
  } catch (e) {
    console.warn('[reject-public] admin lookup failed:', e?.message)
  }
  if (project?.architectUserId) {
    try {
      const { data: arch } = await axios.get(
        `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.architectUserId}`,
        { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
      )
      if (arch?.email) recipients.push(arch.email)
    } catch (e) {
      /* architect optional */
    }
  }
  const to = [...new Set(recipients.filter(Boolean))]
  if (!to.length) return
  const tx = getTransporter()
  if (!tx) return
  const projectName = project?.name || 'a project'
  const snap = project?.quoteSnapshot || {}
  const client = snap.clientName || project?.clientName || snap.clientEmail || 'the client'
  const teamUrl = `${getDesignUrl()}/project-detail/${project._id}`
  const details = [
    ['Project', projectName],
    ['Client', client],
    ['Rejected', fmtWhen()]
  ]
  if (reason) details.push(['Reason', reason])
  await tx.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: to.join(','),
    subject: `Quote rejected — ${projectName}`,
    text:
      `${client} has rejected the quotation for "${projectName}".` +
      (reason ? `\n\nReason: ${reason}` : '') +
      `\n\nYou can send a revised quote or close the project.\n\nOpen it here: ${teamUrl}\n`,
    html: renderActionEmail({
      title: 'The client rejected the quote',
      intro:
        `<strong>${esc(client)}</strong> has rejected the quotation for "<strong>${esc(
          projectName
        )}</strong>". You can send a revised quote or close the project.`,
      details,
      ctaText: 'Open project',
      ctaUrl: teamUrl
    })
  })
}

const findByToken = async (db, token) =>
  db.collection('projects').findOne({ quoteShareToken: token })

export const publicQuote = (app) => {
  app.use(async (ctx, next) => {
    const m = ctx.path.match(/^\/public-quote\/([^/]+)(\/accept|\/change|\/reject)?\/?$/)
    if (!m) return next()

    const token = decodeURIComponent(m[1] || '')
    const action = m[2] // undefined | '/accept' | '/change' | '/reject'
    if (!token) {
      ctx.status = 400
      ctx.body = { error: 'missing_token' }
      return
    }

    let db
    try {
      db = await app.get('mongodbClient')
    } catch (e) {
      ctx.status = 500
      ctx.body = { error: 'db_error', message: e.message || String(e) }
      return
    }

    let project
    try {
      project = await findByToken(db, token)
    } catch (e) {
      ctx.status = 500
      ctx.body = { error: 'db_error', message: e.message || String(e) }
      return
    }
    if (!project) {
      ctx.status = 404
      ctx.body = { error: 'not_found', message: 'This quote link is invalid or has expired.' }
      return
    }
    const pid = String(project._id)

    // ---- POST /accept ------------------------------------------------------
    if (action === '/accept' && ctx.method === 'POST') {
      try {
        await db
          .collection('projects')
          .updateOne(idQuery(pid), { $set: { status: 'quotation_accepted', changeRequestPending: false } })
        // Mirror the status into the AI DB so the Inspire admin dashboard/bell
        // reflects the accept, and notify the team — both best-effort.
        syncAiProjectStatus(app, pid, 'quotation_accepted').catch(() => {})
        notifyTeamOfAccept(project).catch((e) =>
          console.error('[accept-public] notify failed:', e?.message)
        )
        ctx.status = 200
        ctx.body = { ok: true, status: 'quotation_accepted' }
      } catch (e) {
        ctx.status = 500
        ctx.body = { error: 'accept_failed', message: e.message || String(e) }
      }
      return
    }

    // ---- POST /reject ------------------------------------------------------
    if (action === '/reject' && ctx.method === 'POST') {
      const body = ctx.request.body || {}
      const reason = (body.reason && String(body.reason).trim()) || ''
      try {
        // Rejecting clears any pending change (the client made their decision).
        // The admin can later send a REVISED quote (→ quotation_sent, re-opening
        // the deal) or close the project — the reject is recoverable.
        await db
          .collection('projects')
          .updateOne(idQuery(pid), { $set: { status: 'quotation_rejected', changeRequestPending: false } })
        syncAiProjectStatus(app, pid, 'quotation_rejected').catch(() => {})
        notifyTeamOfReject(project, reason).catch((e) =>
          console.error('[reject-public] notify failed:', e?.message)
        )
        ctx.status = 200
        ctx.body = { ok: true, status: 'quotation_rejected' }
      } catch (e) {
        ctx.status = 500
        ctx.body = { error: 'reject_failed', message: e.message || String(e) }
      }
      return
    }

    // ---- POST /change ------------------------------------------------------
    if (action === '/change' && ctx.method === 'POST') {
      const body = ctx.request.body || {}
      const note = (body.note && String(body.note).trim()) || ''
      if (!note) {
        ctx.status = 400
        ctx.body = { error: 'missing_note', message: 'Please describe the change you want.' }
        return
      }
      try {
        const snap = project.quoteSnapshot || {}
        // Internal create → runs the existing change-request hook (emails admins +
        // architect + client, sets changeRequestPending). No provider ⇒ the JWT
        // check is skipped for this trusted, token-gated call.
        await app.service('projectitems').create(
          {
            projectId: pid,
            kind: 'change',
            description: note,
            status: 'pending',
            createdBy: snap.clientName || project.clientName || snap.clientEmail || 'Client'
          },
          {}
        )
        ctx.status = 200
        ctx.body = { ok: true }
      } catch (e) {
        ctx.status = 500
        ctx.body = { error: 'change_failed', message: e.message || String(e) }
      }
      return
    }

    // ---- GET (the quote bundle) -------------------------------------------
    if (action || ctx.method !== 'GET') return next()

    const snap = project.quoteSnapshot || {}
    let renders = []
    let videos = []
    try {
      const items = await db
        .collection('project_items')
        .find({ projectId: pid, kind: { $in: ['render', 'video'] }, status: 'published' })
        .sort({ createdAt: -1 })
        .toArray()
      const shape = (i) => ({
        _id: String(i._id),
        fileUrl: i.fileUrl,
        title: i.title || '',
        createdAt: i.createdAt || '',
        status: 'published'
      })
      renders = items.filter((i) => i.kind === 'render').map(shape)
      videos = items.filter((i) => i.kind === 'video').map(shape)
    } catch (e) {
      /* gallery optional */
    }

    ctx.status = 200
    ctx.body = {
      project: {
        name: project.name || '',
        clientName: snap.clientName || project.clientName || '',
        address: snap.address || project.address || '',
        clientEmail: snap.clientEmail || project.clientEmail || '',
        clientPhoneNumber: snap.clientPhoneNumber || project.clientPhoneNumber || '',
        clientGSTNumber: snap.clientGSTNumber || project.clientGSTNumber || '',
        revisedBoqNumber: project.revisedBoqNumber || ''
      },
      quoteNumber: snap.quoteNumber || project.revisedBoqNumber || project.boqNumber || '',
      status: project.status || '',
      changeRequestPending: !!project.changeRequestPending,
      boqItems: Array.isArray(snap.boqItems) ? snap.boqItems : [],
      installRate: Number(snap.installRate) || 0,
      renders,
      videos,
      sentAt: snap.sentAt || null
    }
  })
}
