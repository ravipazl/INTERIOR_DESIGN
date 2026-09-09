// Shared mailer for the design backend.
//
// Mirrors pazl-ai-backend/src/mailer.js so EVERY PAZL email — whichever backend
// sends it — shares one branded look and one set of SMTP credentials:
//   SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM
//
// Written for EMAIL clients, not browsers: table-based layout + inline styles
// only (Gmail/Outlook strip <style> blocks, flexbox and grid). If SMTP_HOST is
// unset we return no transporter and the caller carries on — mail must never
// break a user action.
import nodemailer from 'nodemailer'

let transporter = null
export const getTransporter = () => {
  if (transporter) return transporter
  const host = process.env.SMTP_HOST
  if (!host) return null
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true', // true for 465, false for 587
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  })
  return transporter
}

// Base URLs for links inside emails:
//   getInspireUrl — the client app (project page the client reviews)
//   getDesignUrl  — the design app (where the team works)
// Both fall back to localhost for dev; set PAZL_INSPIRE_URL / PAZL_DESIGN_PUBLIC_URL
// in the backend .env for production.
export const getInspireUrl = () =>
  (process.env.PAZL_INSPIRE_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
export const getDesignUrl = () =>
  (process.env.PAZL_DESIGN_PUBLIC_URL || 'http://localhost:3031').replace(/\/$/, '')

// Folded in from the former auth backend's mailer (invite / verify emails use
// these). getAppUrl = the client app URL; sendMail = fire-and-forget send that
// never throws (a mail failure must not break account creation / invites).
export const getAppUrl = () =>
  (process.env.APP_URL || process.env.PAZL_INSPIRE_URL || 'http://localhost:3000').replace(/\/$/, '')

// `attachments` is nodemailer's array. Pass `{ path, cid }` to EMBED an image in
// the body: reference it from the HTML as `cid:<id>` (renderActionEmail's
// imageUrl accepts that). Embedding matters because a linked
// http://localhost:3400/... image never loads in the recipient's mail client —
// not from another machine, and not in production.
export const sendMail = async ({ to, subject, text, html, attachments }) => {
  const tx = getTransporter()
  if (!tx) return { sent: false, reason: 'smtp-not-configured' }
  try {
    await tx.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
      ...(attachments && attachments.length ? { attachments } : {})
    })
    return { sent: true }
  } catch (err) {
    console.error('[mailer] send failed:', err?.message)
    return { sent: false, reason: err?.message }
  }
}

// Escape a data value before dropping it into HTML. Use it on any project name,
// client name, description etc. that gets interpolated into `intro`/`bodyHtml`.
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Render a nicely-formatted timestamp (e.g. "10 Aug 2026, 14:32").
export const fmtWhen = (d = new Date()) =>
  d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

// Renders a branded HTML email with an optional preview image, a summary card,
// an optional free-form body block (e.g. a highlighted change description), an
// optional list of links (e.g. large videos), and a "bulletproof" CTA button.
//
//   details   [[label, value], ...] — rendered as a summary card (values escaped)
//   bodyHtml  trusted HTML shown under the intro (caller escapes its own data)
//   imageUrl  optional preview; pass `cid:<id>` for an inline attachment or an
//             http(s) URL
//   links     [url, ...] — rendered as a labelled list under the card
export const renderActionEmail = ({
  title,
  intro,
  details = [],
  bodyHtml,
  ctaText,
  ctaUrl,
  imageUrl,
  imageAlt = 'Design preview',
  links = [],
  linksTitle = 'Links'
}) => {
  const brand = '#414063'
  const rows = details
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<tr>
           <td style="padding:6px 0;color:#8a8d9f;font-size:13px;width:130px;vertical-align:top;">${esc(label)}</td>
           <td style="padding:6px 0;color:#1f2033;font-size:13px;font-weight:600;">${esc(value)}</td>
         </tr>`
    )
    .join('')
  const linkList = (links || []).filter(Boolean)
  const linksBlock = linkList.length
    ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#1f2033;">${esc(linksTitle)}</p>
       ${linkList
         .map(
           (u) =>
             `<a href="${u}" style="display:block;color:${brand};font-size:13px;margin:0 0 6px;word-break:break-all;">${esc(u)}</a>`
         )
         .join('')}`
    : ''

  return `<div style="background:#f4f5f7;padding:24px 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
             style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e7ec;border-radius:10px;">
        <tr>
          <td style="background:${brand};padding:18px 28px;border-radius:9px 9px 0 0;">
            <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:1px;">PAZL</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <h1 style="margin:0 0 10px;font-size:19px;line-height:26px;color:#1f2033;font-weight:700;">${title}</h1>
            ${intro ? `<p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#5c5f73;">${intro}</p>` : ''}
            ${
              imageUrl
                ? `<img src="${imageUrl}" alt="${esc(imageAlt)}" width="544"
                        style="width:100%;max-width:544px;height:auto;border-radius:8px;border:1px solid #eceef3;margin:0 0 22px;display:block;" />`
                : ''
            }
            ${bodyHtml ? `<div style="margin:0 0 22px;">${bodyHtml}</div>` : ''}
            ${
              rows
                ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                          style="background:#f8f9fb;border:1px solid #eceef3;border-radius:8px;padding:14px 16px;margin:0 0 22px;">
                     ${rows}
                   </table>`
                : ''
            }
            ${linksBlock ? `<div style="margin:0 0 22px;">${linksBlock}</div>` : ''}
            ${
              ctaText && ctaUrl
                ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                     <tr>
                       <td style="background:${brand};border-radius:6px;">
                         <a href="${ctaUrl}"
                            style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
                           ${esc(ctaText)}
                         </a>
                       </td>
                     </tr>
                   </table>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px;background:#fafbfc;border-top:1px solid #eceef3;border-radius:0 0 9px 9px;
                     color:#9a9db0;font-size:12px;line-height:18px;">
            Automated message from PAZL — please do not reply.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</div>`
}

// Render a plain multi-line message as safe HTML paragraphs (escapes, keeps line
// breaks). Used for the team's free-form tracker email.
export const textToHtml = (s) =>
  esc(s)
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px;font-size:14px;line-height:22px;color:#5c5f73;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('')
