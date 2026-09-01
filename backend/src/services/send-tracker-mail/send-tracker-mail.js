// POST /send-tracker-mail   (Koa route)
//
// From the Tracker tab, the team sends a CUSTOM email to the client for a given
// step, optionally with a file attachment. Reuses the same SMTP (Gmail) setup as
// /send-quote and the client-email lookup used by the tracker notifications.
//
// multipart/form-data:
//   projectId   the project (required) — used to look up the client email/name
//   subject     email subject (optional; a default is used)
//   message     email body      (optional; a default is used)
//   stage       the tracker step key this mail relates to (optional, for context)
//   file        an attachment   (optional)
//   toEmail     (optional) override recipient
//
// SMTP is configured via env (SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM).

import multer from '@koa/multer'
import axios from 'axios'
import { idQuery } from '../../utils/id-query.js'
import { getTransporter, renderActionEmail, getInspireUrl, textToHtml } from '../../mailer.js'
import { isWhatsAppEnabled, sendTrackerUpdate, resolveClientPhone } from '../../whatsapp.js'

// Best-effort WhatsApp mirror of a tracker-step email. WhatsApp body variables
// can't contain newlines/tabs, so the update text is collapsed to one line and
// capped. Fully backgrounded; no-op unless WhatsApp is configured.
// Returns a status object so the caller can report the real result to the sender:
//   { skipped:true, reason } | { sent:true, to } | { sent:false, error }
const notifyTrackerWhatsApp = async (project, { clientName, projectName, message }) => {
  try {
    if (!isWhatsAppEnabled()) return { skipped: true, reason: 'disabled' }
    const phone = await resolveClientPhone(project)
    if (!phone) return { skipped: true, reason: 'no_phone' }
    const oneLine = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    const r = await sendTrackerUpdate({ to: phone, clientName, projectName, message: oneLine })
    if (!r.sent && !r.skipped) console.warn('[tracker-mail] whatsapp not sent:', r.error)
    return { ...r, to: phone }
  } catch (e) {
    console.warn('[tracker-mail] whatsapp failed:', e?.message)
    return { sent: false, error: e?.message }
  }
}

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } })
// SMTP transporter + branded HTML template are shared (src/mailer.js).

export const sendTrackerMail = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/send-tracker-mail' || ctx.method !== 'POST') return next()

    try {
      await upload.single('file')(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = { error: 'upload_failed', message: err.message || String(err) }
      return
    }

    const file = ctx.request.file // optional
    const body = ctx.request.body || {}
    const projectId = body.projectId
    if (!projectId) {
      ctx.status = 400
      ctx.body = { error: 'missing', message: 'projectId is required' }
      return
    }

    // Look up the project for the client's email + name.
    let project
    try {
      const db = await app.get('mongodbClient')
      project = await db.collection('projects').findOne(idQuery(projectId))
    } catch (err) {
      ctx.status = 500
      ctx.body = { error: 'db_error', message: err.message || String(err) }
      return
    }

    // Recipient: explicit override → project.clientEmail → the owner's email
    // (looked up from the auth backend, same as the tracker notifications).
    let to = body.toEmail || project?.clientEmail || null
    let clientName = project?.clientName || ''
    if (!to && project?.ownerUserId) {
      try {
        const { data: owner } = await axios.get(
          `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.ownerUserId}`,
          { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
        )
        if (owner?.email) to = owner.email
        if (!clientName) clientName = owner?.name || ''
      } catch (e) {
        // fall through — handled by the no-email check below
      }
    }
    if (!to) {
      ctx.status = 400
      ctx.body = {
        error: 'no_client_email',
        message: 'This project has no client email. Add one on the project first.'
      }
      return
    }

    const tx = getTransporter()
    if (!tx) {
      ctx.status = 500
      ctx.body = {
        error: 'smtp_not_configured',
        message: 'SMTP is not configured (set SMTP_HOST etc. in the backend .env).'
      }
      return
    }

    const projectName = project?.name || 'your project'
    const subject = (body.subject && String(body.subject).trim()) || `Update on ${projectName}`
    const message =
      (body.message && String(body.message).trim()) ||
      `Hi${clientName ? ' ' + clientName : ''},\n\nHere is an update on your project "${projectName}".\n\nThank you,\nPazl`

    const projectUrl = `${getInspireUrl()}/project-detail/${projectId}`
    const mail = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: `${message}\n\nView your project: ${projectUrl}`,
      html: renderActionEmail({
        title: subject,
        // The team's message IS the content — render it (escaped, line breaks
        // kept) as the body, with a CTA to the client's project page.
        bodyHtml: textToHtml(message),
        ctaText: 'View your project',
        ctaUrl: projectUrl
      })
    }
    // Cc — one or more comma-separated emails (optional). nodemailer accepts a
    // comma-separated string directly.
    const cc = body.cc && String(body.cc).trim()
    if (cc) mail.cc = cc
    if (file) {
      mail.attachments = [
        { filename: file.originalname || 'attachment', content: file.buffer }
      ]
    }

    try {
      await tx.sendMail(mail)
      // Mirror the update to WhatsApp — awaited so the real status reaches the
      // sender's toast (still best-effort; a failure never fails the email).
      const whatsapp = await notifyTrackerWhatsApp(project, { clientName, projectName, message })
      ctx.status = 200
      ctx.body = { sent: true, to, whatsapp }
    } catch (err) {
      ctx.status = 502
      ctx.body = { error: 'send_failed', message: err.message || String(err) }
    }
  })
}
