// Email templates — the subject, heading, text and button of every email Pazl
// sends, editable on the admin Settings page (Settings → Email Templates).
//
// Every sender asks for its template by key:
//
//   const t = await emailTemplate(app, 'quote_ready', { client_name, project_name, link })
//   if (!t.active) return          // the admin switched this notification off
//   renderActionEmail({ title: t.heading, intro: t.introHtml, ctaText: t.buttonText, ... })
//
// BUILT_IN below holds each email's original text. A built-in template that
// was never edited (or whose saved copy is damaged) uses that text, so the
// emails read exactly as they did before this page existed. Saved copies and
// the admins' own custom templates live in the `email_templates` collection.
//
// The template only owns the words. Attachments, render images, the details
// table, video links and the button's URL stay in each sender's code.
//
// Variables are written {name}. Values are HTML-escaped where they land in the
// email, so a client or project name can never inject markup.

import { esc } from './mailer.js'

const COLLECTION = 'email_templates'
const REFRESH_MS = 60 * 1000

export const RECIPIENTS = {
  client: 'Client',
  admin: 'Admin',
  team: 'Team',
  architect: 'Architect',
  any: 'Any user'
}

// Every variable, what it means, and the sample value the preview uses.
export const VARIABLES = {
  app_name: { label: 'App name', sample: 'Pazl' },
  client_name: { label: 'Client name', sample: 'Anita Rao' },
  project_name: { label: 'Project name', sample: 'Rao Residence' },
  architect_name: { label: 'Architect name', sample: 'Kavi' },
  user_name: { label: 'User name', sample: 'Anita Rao' },
  stage: { label: 'Tracker step', sample: 'Quote sent' },
  expected_date: { label: 'Expected date', sample: '20 Nov 2026' },
  boq_number: { label: 'BOQ number', sample: 'BOQ-1042' },
  submitted_by: { label: 'Submitted by', sample: 'Kavi' },
  change_request: { label: 'Change requested', sample: 'Make the wardrobe 2 feet wider.' },
  reason: { label: 'Reason', sample: 'The budget is too high.' },
  link: { label: 'Button link', sample: 'https://design.pazl.info/project-detail/123' }
}

// Variables a custom template may use (filled from the project when picked).
export const CUSTOM_VARIABLES = ['client_name', 'project_name', 'architect_name', 'boq_number', 'link', 'app_name']

// lockActive: the email is sent because a person pressed a button (or it is a
// sign-in link), so it cannot be switched off here.
export const BUILT_IN = {
  quote_ready: {
    name: 'Quotation ready',
    recipient: 'client',
    lockActive: true,
    vars: ['client_name', 'project_name', 'boq_number', 'link'],
    subject: 'Your quotation for {project_name}',
    heading: 'Your quotation is ready',
    body: 'Hi {client_name}, your quotation for <strong>{project_name}</strong> is ready. Review the full Bill of Quantity on your project page.',
    buttonText: 'View your quotation'
  },
  quote_revised: {
    name: 'Revised quotation',
    recipient: 'client',
    lockActive: true,
    vars: ['client_name', 'project_name', 'boq_number', 'link'],
    subject: 'Revised quotation for {project_name}',
    heading: 'Your revised quotation is ready',
    body: 'Hi {client_name}, your revised quotation for <strong>{project_name}</strong> is ready. Review the full Bill of Quantity on your project page.',
    buttonText: 'View your quotation'
  },
  stage_update: {
    name: 'Project moved forward',
    recipient: 'client',
    vars: ['client_name', 'project_name', 'stage', 'expected_date', 'link'],
    subject: '{project_name} — {stage}',
    heading: 'Your project moved forward',
    body: 'Hi {client_name}, good news — your project <strong>{project_name}</strong> has reached a new stage.',
    buttonText: 'Track your project'
  },
  change_received: {
    name: 'Change request received',
    recipient: 'client',
    vars: ['client_name', 'project_name', 'change_request', 'link'],
    subject: 'We received your change request — {project_name}',
    heading: 'We received your change request',
    body: "Hi {client_name}, thanks — we've received your change request for <strong>{project_name}</strong> and our team is reviewing it. We'll send you a revised quotation shortly.",
    buttonText: 'View your project'
  },
  tracker_update: {
    name: 'Tracker update',
    recipient: 'client',
    lockActive: true,
    vars: ['client_name', 'project_name', 'stage', 'link'],
    subject: 'Update on {project_name}',
    heading: 'Update on {project_name}',
    body: '<p>Hi {client_name},</p><p>Here is an update on your project "{project_name}".</p><p>Thank you,<br>Pazl</p>',
    buttonText: 'View your project'
  },
  password_reset: {
    name: 'Reset password',
    recipient: 'any',
    lockActive: true,
    vars: ['user_name', 'link'],
    subject: 'Reset your Pazl password',
    heading: 'Reset your password',
    body: 'Hello {user_name}, use the button below to reset your password. The link expires in 7 days and can be used once. If you were not expecting this email you can ignore it.',
    buttonText: 'Reset password'
  },
  invite: {
    name: 'Invitation',
    recipient: 'any',
    lockActive: true,
    vars: ['user_name', 'link'],
    subject: 'You have been invited to Pazl',
    heading: 'You have been invited to Pazl',
    body: 'Hello {user_name}, you have been invited to Pazl. Use the button below to set your password and finish setting up your account. The link expires in 7 days and can be used once.',
    buttonText: 'Set your password'
  },
  quote_requested: {
    name: 'Quote requested',
    recipient: 'admin',
    vars: ['client_name', 'project_name', 'link'],
    subject: 'Quote requested: {project_name}',
    heading: 'A client has requested a quote',
    body: '<strong>{client_name}</strong> has requested a quote for <strong>{project_name}</strong>.',
    buttonText: 'Open project'
  },
  pending_approval: {
    name: 'Quote pending approval',
    recipient: 'admin',
    lockActive: true,
    vars: ['submitted_by', 'project_name', 'boq_number', 'link'],
    subject: 'Quote pending your approval — {project_name}',
    heading: 'A quote is pending your approval',
    body: '<strong>{submitted_by}</strong> submitted "<strong>{project_name}</strong>" for your approval.',
    buttonText: 'Review & approve'
  },
  change_request_team: {
    name: 'New change request',
    recipient: 'team',
    vars: ['client_name', 'project_name', 'change_request', 'link'],
    subject: 'New change request — {project_name}',
    heading: 'New change request',
    body: 'The client requested a change on <strong>{project_name}</strong>. Please review and revise the design.',
    buttonText: 'Review the change'
  },
  quote_accepted: {
    name: 'Quote accepted',
    recipient: 'team',
    vars: ['client_name', 'project_name', 'link'],
    subject: 'Quote accepted — {project_name}',
    heading: 'The client accepted the quote',
    body: '<strong>{client_name}</strong> has accepted the quotation for "<strong>{project_name}</strong>". You can now close the project.',
    buttonText: 'Open project'
  },
  quote_rejected: {
    name: 'Quote rejected',
    recipient: 'team',
    vars: ['client_name', 'project_name', 'reason', 'link'],
    subject: 'Quote rejected — {project_name}',
    heading: 'The client rejected the quote',
    body: '<strong>{client_name}</strong> has rejected the quotation for "<strong>{project_name}</strong>". You can send a revised quote or close the project.',
    buttonText: 'Open project'
  },
  project_update_team: {
    name: 'Project update',
    recipient: 'team',
    vars: ['client_name', 'project_name', 'stage', 'expected_date', 'link'],
    subject: '[Project update] {project_name} — {stage}',
    heading: 'Project update',
    body: 'Project <strong>{project_name}</strong> has reached a new stage.',
    buttonText: 'Open project'
  },
  architect_assigned: {
    name: 'Architect assigned',
    recipient: 'architect',
    vars: ['architect_name', 'client_name', 'project_name', 'link'],
    subject: 'You have been assigned to {project_name}',
    heading: 'You have been assigned to a project',
    body: 'Hi {architect_name}, you are now the architect for <strong>{project_name}</strong>.',
    buttonText: 'Open project'
  }
}

// Names the routes use, so they can never be template keys.
export const RESERVED_KEYS = ['options', 'fill', 'preview', 'test', 'new']

/** The variables a template may use (app_name is always allowed). */
export const allowedVars = (key, doc) => [
  ...new Set([...(BUILT_IN[key]?.vars || doc?.vars || CUSTOM_VARIABLES), 'app_name'])
]

// ───────────────────────────── text helpers ─────────────────────────────

const VAR_RE = /\{([a-z_]+)\}/g

/** {name} → value; unknown names stay as written. */
const fill = (s, vars, escape) =>
  String(s || '').replace(VAR_RE, (m, k) =>
    k in vars ? (escape ? esc(vars[k] ?? '') : String(vars[k] ?? '')) : m
  )

// "Hi ," → "Hi," when a name is blank (the old code dropped the space itself).
const tidy = (s) => s.replace(/ +([,.!?;:])/g, '$1').replace(/ {2,}/g, ' ')

/** The email's plain-text part from the template's HTML. */
export const htmlToText = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * Keep the template's formatting, drop anything that could run code or load
 * from elsewhere in a mail client or the preview: scripts, frames, forms,
 * event handlers, javascript: links.
 */
export const cleanHtml = (html) =>
  String(html || '')
    // Whole blocks first (tag and everything inside), then any stray tag left.
    .replace(/<(script|style|iframe|object|embed|form|textarea|select)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '$1="#"')

/** Variables written in the text that this template cannot fill. */
export const unknownVars = (text, allowed) => {
  const out = new Set()
  for (const m of String(text || '').matchAll(VAR_RE)) if (!allowed.includes(m[1])) out.add(m[1])
  return [...out]
}

// ───────────────────────────── store ─────────────────────────────

let saved = new Map() // key -> saved doc (edited built-ins and custom templates)
let loaded = null

const collection = (app) => app.get('mongodbClient').then((db) => db.collection(COLLECTION))

export const reloadTemplates = async (app) => {
  const docs = await (await collection(app)).find({}).toArray()
  saved = new Map(docs.map((d) => [d._id, d]))
}

export const startTemplates = (app) => {
  loaded = reloadTemplates(app).catch((err) =>
    console.error('[email-templates] could not load saved templates:', err?.message)
  )
  setInterval(() => reloadTemplates(app).catch(() => {}), REFRESH_MS).unref?.()
  return loaded
}

export const templatesCollection = collection

/** A template as stored or built in — never throws. */
export const getTemplate = (key) => {
  const base = BUILT_IN[key]
  const doc = saved.get(key)
  if (base) {
    const merged = { key, builtIn: true, active: true, ...base, ...(doc || {}), lockActive: !!base.lockActive }
    // A damaged copy (no subject or body) falls back to the original words.
    if (!String(merged.subject || '').trim()) merged.subject = base.subject
    if (!htmlToText(merged.body)) merged.body = base.body
    if (!String(merged.heading || '').trim()) merged.heading = base.heading
    if (!String(merged.buttonText || '').trim()) merged.buttonText = base.buttonText
    if (base.lockActive) merged.active = true
    merged.edited = !!doc
    return merged
  }
  if (doc) return { ...doc, key, builtIn: false, edited: true }
  return null
}

export const listTemplates = () => {
  const out = Object.keys(BUILT_IN).map(getTemplate)
  for (const [key, doc] of saved) if (!BUILT_IN[key]) out.push(getTemplate(key) || doc)
  return out
}

/** Fill a template's words. Works on unsaved form values too (preview / test). */
export const renderTemplate = (t, vars = {}) => {
  const all = { app_name: 'Pazl', ...vars }
  const introHtml = tidy(fill(cleanHtml(t.body), all, true))
  return {
    active: t.active !== false,
    subject: tidy(fill(t.subject, all, false)).replace(/[\r\n]+/g, ' ').trim(),
    // The heading is plain text in the template, escaped here.
    heading: esc(tidy(fill(t.heading || t.subject, all, false))),
    introHtml,
    introText: htmlToText(introHtml),
    buttonText: tidy(fill(t.buttonText, all, false))
  }
}

/**
 * What a sender uses. Waits for the first load, then fills the template; an
 * unknown key falls back to the built-in text, so a sender is never stuck.
 */
export const emailTemplate = async (app, key, vars) => {
  if (loaded) await loaded.catch(() => {})
  const t = getTemplate(key) || { ...BUILT_IN[key], active: true }
  return renderTemplate(t, vars)
}
