// POST /submit-for-approval   (Koa route)
//
// The architect's single "Send to admin" action. Emails ALL admins that a quote
// is pending approval, WITH the BOQ PDF and the selected render images/videos
// attached. Videos are attached while the running total stays under a safe email
// size; any that would push it over are LINKED instead, so the mail never bounces.
//
// multipart/form-data:
//   file         the BOQ PDF (optional but expected)
//   projectId    the project (required)
//   imageUrls    JSON array of selected image URLs ("/uploads/renders/x.png")
//   videoUrls    JSON array of selected video URLs ("/uploads/renders/x.mp4")
//   submittedBy  (optional) the architect's name/email, shown in the email
//
// SMTP is configured via env (same as send-quote): SMTP_HOST SMTP_PORT
// SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM.

import path from 'path'
import fs from 'fs'
import url from 'url'
import multer from '@koa/multer'
import axios from 'axios'
import { idQuery } from '../../utils/id-query.js'
import { getTransporter, renderActionEmail, getDesignUrl, textToHtml } from '../../mailer.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Where the render/video files live (served at /uploads/renders/...).
const RENDER_DIR =
  process.env.RENDER_STORAGE_DIR ||
  path.resolve(__dirname, '../../../public/uploads/renders')

// Keep the ENCODED email under Gmail's 25 MB. Email attachments are base64
// (~+33%), so budget the RAW bytes well below: 18 MB raw ≈ 24 MB encoded.
const ATTACH_BUDGET = 18 * 1024 * 1024
const MAX_BYTES = 30 * 1024 * 1024 // the uploaded BOQ PDF itself
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

// SMTP transporter + branded HTML template are shared (src/mailer.js).

// Resolve a served URL ("/uploads/renders/x.png") to its file on disk. Only the
// basename is ever used, so a crafted URL can never escape the renders folder.
const fileForUrl = (u) => {
  try {
    const name = path.basename(String(u).split('?')[0])
    return name ? path.join(RENDER_DIR, name) : null
  } catch {
    return null
  }
}

export const submitForApproval = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/submit-for-approval' || ctx.method !== 'POST') return next()

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

    const file = ctx.request.files?.file?.[0] // BOQ PDF (optional)
    // The architect's own attachments from the email composer (2D diagram, docs…).
    const extraFiles = ctx.request.files?.attachments || []
    const body = ctx.request.body || {}
    const projectId = body.projectId
    if (!projectId) {
      ctx.status = 400
      ctx.body = { error: 'missing', message: 'projectId is required' }
      return
    }
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

    // Project (for its name) — best-effort; still email with a generic name.
    let project = null
    try {
      const db = await app.get('mongodbClient')
      project = await db.collection('projects').findOne(idQuery(projectId))
    } catch (err) {
      /* ignore — fall through with no project */
    }
    const projectName = project?.name || 'a project'

    // All admins (from the auth backend).
    let to = []
    try {
      const { data } = await axios.get(`${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users`, {
        params: { permissions: 'admin' },
        headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` }
      })
      const admins = (Array.isArray(data) ? data : data?.data) || []
      to = [...new Set(admins.map((u) => u.email).filter(Boolean))]
    } catch (err) {
      console.warn('[submit-approval] admin lookup failed:', err?.message)
    }
    if (!to.length) {
      ctx.status = 400
      ctx.body = { error: 'no_admins', message: 'No admin users with an email to notify.' }
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

    // Build attachments: BOQ PDF + images (always), then videos while under budget.
    const attachments = []
    let total = 0
    if (file?.buffer?.length) {
      attachments.push({
        filename: file.originalname || `BOQ-${projectName}.pdf`,
        content: file.buffer
      })
      total += file.buffer.length
    }
    let attachedImages = 0
    let heroImage // first render, embedded inline as the email's hero preview
    for (const u of imageUrls) {
      const p = fileForUrl(u)
      try {
        if (p && fs.existsSync(p)) {
          const buf = fs.readFileSync(p)
          const att = { filename: path.basename(p), content: buf }
          if (!heroImage) {
            att.cid = 'hero-image'
            heroImage = 'cid:hero-image'
          }
          attachments.push(att)
          total += buf.length
          attachedImages += 1
        }
      } catch {
        /* skip an unreadable image */
      }
    }
    const origin = process.env.PAZL_DESIGN_PUBLIC_URL || ctx.origin
    const linkedVideos = []
    let attachedVideos = 0
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
          attachedVideos += 1
        } else {
          linkedVideos.push(`${origin}${u}`)
        }
      } catch {
        linkedVideos.push(`${origin}${u}`)
      }
    }

    // The architect's own attachments (2D diagram, docs…) — added within the same
    // size budget; any that would push the email over the limit are skipped and
    // reported back so the sender knows.
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

    const submittedBy = body.submittedBy || 'The architect'
    const boqNumber = project?.revisedBoqNumber || project?.boqNumber || null
    const partsList = [
      file ? 'the BOQ (PDF)' : null,
      attachedImages ? `${attachedImages} render image${attachedImages > 1 ? 's' : ''}` : null,
      attachedVideos ? `${attachedVideos} video${attachedVideos > 1 ? 's' : ''}` : null,
      attachedExtras ? `${attachedExtras} attachment${attachedExtras > 1 ? 's' : ''}` : null
    ]
      .filter(Boolean)
      .join(', ')
    const linksText = linkedVideos.length
      ? `\n\nVideos too large to attach — view them here:\n${linkedVideos.join('\n')}\n`
      : ''

    const projectUrl = `${getDesignUrl()}/project-detail/${projectId}`
    const details = [
      ['Project', projectName],
      boqNumber ? ['BOQ number', boqNumber] : null,
      ['Submitted by', submittedBy],
      partsList ? ['Attached', partsList] : null
    ].filter(Boolean)

    // Email-composer overrides (all optional): the sender can set the subject,
    // write a custom message, and add Cc recipients before sending.
    const subject = (body.subject && String(body.subject).trim()) || `Quote pending your approval — ${projectName}`
    const customMessage = (body.message && String(body.message).trim()) || ''
    const cc = (body.cc && String(body.cc).trim()) || ''

    const mail = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to.join(','),
      subject,
      text:
        (customMessage ? `${customMessage}\n\n` : '') +
        `${submittedBy} submitted "${projectName}" for your approval.\n\n` +
        (boqNumber ? `BOQ number: ${boqNumber}\n` : '') +
        (partsList ? `Attached: ${partsList}.\n` : '') +
        linksText +
        `\n\nReview & approve: ${projectUrl}\n`,
      html: renderActionEmail({
        title: 'A quote is pending your approval',
        intro: `<strong>${submittedBy}</strong> submitted "<strong>${projectName}</strong>" for your approval.`,
        bodyHtml: customMessage ? textToHtml(customMessage) : undefined,
        imageUrl: heroImage,
        imageAlt: 'Submitted design render',
        details,
        links: linkedVideos,
        linksTitle: 'Videos too large to attach',
        ctaText: 'Review & approve',
        ctaUrl: projectUrl
      }),
      attachments
    }
    if (cc) mail.cc = cc

    try {
      await tx.sendMail(mail)
      ctx.status = 200
      ctx.body = { sent: true, to, attachedImages, attachedVideos, attachedExtras, skippedExtras, linkedVideos }
    } catch (err) {
      ctx.status = 502
      ctx.body = { error: 'send_failed', message: err.message || String(err) }
    }
  })
}
