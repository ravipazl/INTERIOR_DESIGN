// POST /send-quote   (Koa route)
//
// Emails a project's quote PDF to the client and reports success. The caller
// (3D app BOQ "Send Quote to Client") advances the project status to
// quotation_sent only after this returns ok — so status reflects an ACTUAL send.
//
// multipart/form-data:
//   file        the quote PDF (required)
//   projectId   the project (required) — used to look up the client email/name
//   toEmail     (optional) override recipient; defaults to project.clientEmail
//
// SMTP is configured via env (see .env):
//   SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM

import path from 'path'
import fs from 'fs'
import url from 'url'
import { randomUUID } from 'crypto'
import multer from '@koa/multer'
import axios from 'axios'
import { idQuery } from '../../utils/id-query.js'
import { getTransporter, renderActionEmail, getInspireUrl, textToHtml } from '../../mailer.js'
import { isWhatsAppEnabled, sendQuoteReady, resolveClientPhone } from '../../whatsapp.js'

// Build + store the client's public quote SNAPSHOT (BOQ + installation rate) in
// the background, so "Send to client" isn't held up by BOQ generation (which is
// slow AND mutates data — it must run once, not on every public page view). The
// share token is persisted synchronously by the caller so the link resolves
// immediately; this fills in the BOQ a moment later (the client opens it later).
const snapshotQuoteInBackground = (app, db, projectId, meta) => {
  Promise.resolve()
    .then(async () => {
      let boqItems = []
      try {
        const fps = await app
          .service('floorplans')
          .find({ query: { projectId }, paginate: false })
        const arr = Array.isArray(fps) ? fps : fps?.data || []
        const floorPlanId = arr[0]?._id
        if (floorPlanId) {
          const gen = await app.service('generateboq').create({ floorPlanId }, {})
          boqItems = Array.isArray(gen) ? gen : []
        }
      } catch (e) {
        console.warn('[send-quote] BOQ snapshot failed:', e?.message)
      }
      let installRate = 0
      try {
        const s = await db.collection('settings').findOne({ _id: 'installationRatePerSqft' })
        installRate = Number(s?.value) || 0
      } catch (e) {
        /* rate optional */
      }
      // Re-read so the snapshot carries the boqNumber the generation just bumped.
      let fresh = null
      try {
        fresh = await db.collection('projects').findOne(idQuery(projectId))
      } catch (e) {
        /* fall back to meta */
      }
      try {
        await db.collection('projects').updateOne(idQuery(projectId), {
          $set: {
            quoteSnapshot: {
              boqItems,
              installRate,
              clientName: fresh?.clientName || meta?.clientName || '',
              clientEmail: meta?.to || fresh?.clientEmail || '',
              address: fresh?.address || '',
              clientPhoneNumber: fresh?.clientPhoneNumber || '',
              clientGSTNumber: fresh?.clientGSTNumber || '',
              quoteNumber: fresh?.revisedBoqNumber || fresh?.boqNumber || '',
              sentAt: new Date().toISOString()
            }
          }
        })
      } catch (e) {
        console.warn('[send-quote] snapshot store failed:', e?.message)
      }
    })
    .catch((e) => console.error('[send-quote] snapshot task error:', e?.message))
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
// Render/video files live here (served at /uploads/renders/...).
const RENDER_DIR =
  process.env.RENDER_STORAGE_DIR ||
  path.resolve(__dirname, '../../../public/uploads/renders')
// Keep the ENCODED email under Gmail's 25 MB (base64 ≈ +33%): budget 18 MB raw.
const ATTACH_BUDGET = 18 * 1024 * 1024
// Resolve a served URL ("/uploads/renders/x.png") to its file — basename only,
// so a crafted URL can never escape the renders folder.
const fileForUrl = (u) => {
  try {
    const name = path.basename(String(u).split('?')[0])
    return name ? path.join(RENDER_DIR, name) : null
  } catch {
    return null
  }
}

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } })
// SMTP transporter + branded HTML template are shared (src/mailer.js).

// Best-effort WhatsApp "quote ready" to the client. Resolves the phone from the
// project row or the owner account (the design project usually has none), then
// sends the approved template. Fully backgrounded — never blocks or breaks the
// quote email, and a no-op unless WhatsApp is configured.
// Returns a small status object so the caller can report it to the sender:
//   { skipped:true, reason } | { sent:true, to } | { sent:false, error }
const notifyQuoteReadyWhatsApp = async (project, { clientName, projectName, quoteToken }) => {
  try {
    if (!isWhatsAppEnabled()) return { skipped: true, reason: 'disabled' }
    const phone = await resolveClientPhone(project)
    if (!phone) return { skipped: true, reason: 'no_phone' }
    const r = await sendQuoteReady({ to: phone, clientName, projectName, quoteToken })
    if (!r.sent && !r.skipped) console.warn('[send-quote] whatsapp not sent:', r.error)
    return { ...r, to: phone }
  } catch (e) {
    console.warn('[send-quote] whatsapp failed:', e?.message)
    return { sent: false, error: e?.message }
  }
}

export const sendQuote = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/send-quote' || ctx.method !== 'POST') return next()

    try {
      await upload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'attachments', maxCount: 20 }
      ])(ctx, async () => {})
    } catch (err) {
      ctx.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      ctx.body = { error: 'upload_failed', message: err.message || String(err) }
      return
    }

    const file = ctx.request.files?.file?.[0] // optional BOQ PDF (the client reviews the BOQ in-app)
    // The admin's own attachments from the email composer (docs, extra files…).
    const extraFiles = ctx.request.files?.attachments || []
    const body = ctx.request.body || {}
    const projectId = body.projectId
    if (!projectId) {
      ctx.status = 400
      ctx.body = { error: 'missing', message: 'projectId is required' }
      return
    }

    // Look up the project for the client's email + name. `db` is hoisted so the
    // token store + BOQ snapshot after the send can reuse it.
    let project
    let db
    try {
      db = await app.get('mongodbClient')
      // Match the project whether its _id is stored as a string (mirror copy)
      // or an ObjectId (origin) — otherwise the quote 404s for half of them.
      project = await db.collection('projects').findOne(idQuery(projectId))
    } catch (err) {
      ctx.status = 500
      ctx.body = { error: 'db_error', message: err.message || String(err) }
      return
    }
    // Client email: explicit override → project.clientEmail → owner lookup on the
    // auth backend (same fallback the tracker/stage-event mails use, so a project
    // with an owner but a blank clientEmail can still be reached).
    let to = body.toEmail || project?.clientEmail
    if (!to && project?.ownerUserId) {
      try {
        const { data: owner } = await axios.get(
          `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.ownerUserId}`,
          { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
        )
        if (owner?.email) to = owner.email
      } catch (e) {
        // fall through — reported as no_client_email below
      }
    }
    if (!to) {
      ctx.status = 400
      ctx.body = { error: 'no_client_email', message: 'Project has no client email. Add one first.' }
      return
    }

    const tx = getTransporter()
    if (!tx) {
      ctx.status = 500
      ctx.body = { error: 'smtp_not_configured', message: 'SMTP is not configured (set SMTP_HOST etc. in the backend .env).' }
      return
    }

    const clientName = project?.clientName || 'there'
    const projectName = project?.name || 'your project'

    // Optional selected render images/videos to attach alongside the quote PDF.
    const parseList = (v) => {
      try {
        const a = JSON.parse(v || '[]')
        return Array.isArray(a) ? a : []
      } catch {
        return []
      }
    }
    const imageUrls = parseList(body.imageUrls)
    const videoUrls = parseList(body.videoUrls)

    // BOQ PDF (OPTIONAL — the client reviews the BOQ in-app) + selected images
    // (always) + videos (attach while under budget, else link, so a big video
    // can't bounce the whole email).
    const attachments = []
    let total = 0
    if (file?.buffer?.length) {
      attachments.push({ filename: file.originalname || 'quote.pdf', content: file.buffer })
      total += file.buffer.length
    }
    let imageCount = 0
    let heroImage // the first render, embedded inline as the email's hero image
    for (const u of imageUrls) {
      const p = fileForUrl(u)
      try {
        if (p && fs.existsSync(p)) {
          const buf = fs.readFileSync(p)
          const att = { filename: path.basename(p), content: buf }
          // Embed the first image inline (cid) so it renders as a hero preview
          // in the email body, not just as an attachment.
          if (!heroImage) {
            att.cid = 'hero-image'
            heroImage = 'cid:hero-image'
          }
          attachments.push(att)
          total += buf.length
          imageCount += 1
        }
      } catch {
        /* skip an unreadable image */
      }
    }
    const origin = process.env.PAZL_DESIGN_PUBLIC_URL || ctx.origin
    const linkedVideos = []
    for (const u of videoUrls) {
      const p = fileForUrl(u)
      try {
        if (!p || !fs.existsSync(p)) {
          linkedVideos.push(`${origin}${u}`)
          continue
        }
        const size = fs.statSync(p).size
        if (total + size <= ATTACH_BUDGET) {
          attachments.push({ filename: path.basename(p), content: fs.readFileSync(p) })
          total += size
        } else {
          linkedVideos.push(`${origin}${u}`)
        }
      } catch {
        linkedVideos.push(`${origin}${u}`)
      }
    }
    // The admin's own attachments (docs, extra files…) — added within the same
    // size budget; any that would push the email over the limit are skipped.
    let attachedExtras = 0
    const skippedExtras = []
    for (const f of extraFiles) {
      const buf = f?.buffer
      if (!buf?.length) continue
      if (total + buf.length <= ATTACH_BUDGET) {
        attachments.push({ filename: f.originalname || 'attachment', content: buf })
        total += buf.length
        attachedExtras += 1
      } else {
        skippedExtras.push(f.originalname || 'attachment')
      }
    }

    const hasPdf = !!file?.buffer?.length
    const hasRenders = imageCount > 0
    const linksText = linkedVideos.length
      ? `\n\nVideos:\n${linkedVideos.join('\n')}\n`
      : ''
    // A quote sent while a change request is still pending IS the revision the
    // client asked for — label it so they can tell it apart from the original.
    const isRevised = !!project?.changeRequestPending
    const boqNumber = project?.revisedBoqNumber || project?.boqNumber || null
    const videoCount = videoUrls.length

    // Public, login-free quote page (renders/videos + BOQ). Gated by an
    // unguessable token stored on the project; reused per project so an old link
    // keeps working. The token is persisted (and the BOQ snapshotted) just after
    // a successful send below.
    const quoteToken = project?.quoteShareToken || randomUUID()
    const projectUrl = `${getInspireUrl()}/quote/${quoteToken}`
    const details = [
      ['Project', projectName],
      boqNumber ? [isRevised ? 'Revised BOQ' : 'BOQ number', boqNumber] : null,
      hasRenders ? ['Renders', `${imageCount} attached`] : null,
      videoCount ? ['Videos', `${videoCount} included`] : null,
      hasPdf ? ['Attachment', 'BOQ (PDF)'] : null,
      attachedExtras ? ['Attachments', `${attachedExtras} file${attachedExtras > 1 ? 's' : ''}`] : null
    ].filter(Boolean)

    // Email-composer overrides (all optional): the sender can set the subject,
    // write a custom message, and add Cc recipients before sending.
    const subject = (body.subject && String(body.subject).trim()) ||
      `${isRevised ? 'Revised quotation' : 'Your quotation'} for ${projectName}`
    const customMessage = (body.message && String(body.message).trim()) || ''
    const cc = (body.cc && String(body.cc).trim()) || ''

    const mail = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text:
        (customMessage
          ? `${customMessage}\n\n`
          : `Hi ${clientName},\n\n` +
            `Your ${isRevised ? 'revised ' : ''}quotation for ${projectName} is ready — ` +
            `you can review the full Bill of Quantity any time on your project page` +
            (hasPdf ? ' (a PDF copy is attached)' : '') +
            (hasRenders ? '. The design renders are attached.' : '.')) +
        linksText +
        `\n\nReview it here: ${projectUrl}\n\nThank you,\nPazl`,
      html: renderActionEmail({
        title: isRevised ? 'Your revised quotation is ready' : 'Your quotation is ready',
        intro: `Hi ${clientName}, your ${
          isRevised ? 'revised ' : ''
        }quotation for <strong>${projectName}</strong> is ready. Review the full Bill of Quantity on your project page${
          hasPdf ? ' — a PDF copy is also attached' : ''
        }.`,
        bodyHtml: customMessage ? textToHtml(customMessage) : undefined,
        imageUrl: heroImage,
        imageAlt: 'Your design render',
        details,
        links: linkedVideos,
        linksTitle: 'Videos',
        ctaText: 'View your quotation',
        ctaUrl: projectUrl
      }),
      attachments
    }
    if (cc) mail.cc = cc

    try {
      await tx.sendMail(mail)
      // Persist the share token NOW so the public /quote/<token> link resolves
      // the moment the email lands, then snapshot the BOQ in the background.
      try {
        await db
          .collection('projects')
          .updateOne(idQuery(projectId), { $set: { quoteShareToken: quoteToken } })
      } catch (e) {
        console.warn('[send-quote] token store failed:', e?.message)
      }
      snapshotQuoteInBackground(app, db, projectId, { clientName, to })
      // Also ping the client on WhatsApp with the same quote link (reuses the
      // token just stored). Awaited so the response can tell the sender whether
      // it went — still best-effort (a WhatsApp failure never fails the quote).
      const whatsapp = await notifyQuoteReadyWhatsApp(project, {
        clientName,
        projectName,
        quoteToken
      })
      ctx.status = 200
      ctx.body = { sent: true, to, linkedVideos, quoteUrl: projectUrl, whatsapp }
    } catch (err) {
      ctx.status = 502
      ctx.body = { error: 'send_failed', message: err.message || String(err) }
    }
  })
}
