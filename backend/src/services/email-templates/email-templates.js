// Email templates — admin Settings page (Inspire /settings?tab=templates).
//
// Admin only:
//   GET    /email-templates                 every template + the variables
//   GET    /email-templates/:key            one template (+ its original text)
//   POST   /email-templates                 create a custom template
//   PUT    /email-templates/:key            save changes
//   DELETE /email-templates/:key            delete a CUSTOM template
//   POST   /email-templates/:key/reset      built-in: back to the original text
//   POST   /email-templates/preview         the email as it will look (sample data)
//   POST   /email-templates/test            send that preview to yourself
//
// Team (admin, super admin, architect) — for the email composers:
//   GET    /email-templates/options         templates to pick in Send email
//   POST   /email-templates/fill            { key, projectId } -> subject + message
//
// See src/email-templates.js for the templates themselves and how the senders
// use them.

import {
  BUILT_IN,
  RECIPIENTS,
  VARIABLES,
  CUSTOM_VARIABLES,
  RESERVED_KEYS,
  allowedVars,
  cleanHtml,
  getTemplate,
  htmlToText,
  listTemplates,
  reloadTemplates,
  renderTemplate,
  startTemplates,
  templatesCollection,
  unknownVars
} from '../../email-templates.js'
import { getTransporter, renderActionEmail, getInspireUrl, sendMail } from '../../mailer.js'
import { idQuery } from '../../utils/id-query.js'

const ADMIN = ['admin', 'super_admin']
const TEAM = ['admin', 'super_admin', 'architect']
const KEY_RE = /^[a-z][a-z0-9_]{2,49}$/
const str = (v) => (v === undefined || v === null ? '' : String(v).trim())

const sampleVars = () => Object.fromEntries(Object.entries(VARIABLES).map(([k, v]) => [k, v.sample]))

/** Signed-in user with one of `roles`, or null with the reply written. */
async function requireRole(app, ctx, roles) {
  const token = String(ctx.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  let user = null
  if (token) {
    try {
      ;({ user } = await app.service('authentication').create({ strategy: 'jwt', accessToken: token }))
    } catch (_) {
      /* fall through */
    }
  }
  if (!user) {
    ctx.status = 401
    ctx.body = { error: 'unauthenticated', message: 'Sign in again to continue.' }
    return null
  }
  if (!roles.includes(user.permissions)) {
    ctx.status = 403
    ctx.body = { error: 'forbidden', message: 'Only an admin can manage email templates.' }
    return null
  }
  return user
}

/** What the page sees for one template. */
const view = (t) => ({
  key: t.key,
  name: t.name,
  recipient: t.recipient,
  subject: t.subject,
  heading: t.heading || '',
  body: t.body,
  buttonText: t.buttonText || '',
  active: t.active !== false,
  builtIn: !!t.builtIn,
  lockActive: !!t.lockActive,
  edited: !!t.edited,
  vars: allowedVars(t.key, t),
  updatedAt: t.updatedAt || null,
  updatedBy: t.updatedBy || null
})

/** The form's fields, cleaned. */
const readForm = (body) => ({
  key: str(body.key).toLowerCase(),
  name: str(body.name),
  recipient: str(body.recipient),
  subject: str(body.subject).replace(/[\r\n]+/g, ' '),
  heading: str(body.heading).replace(/[\r\n]+/g, ' '),
  body: cleanHtml(String(body.body || '')).trim(),
  buttonText: str(body.buttonText),
  active: body.active !== false
})

/** { field: message } for what is wrong. */
const validate = (f, { isNew, builtIn, allowed }) => {
  const e = {}
  if (isNew) {
    if (!f.key) e.key = 'Enter a key, such as site_visit_reminder.'
    else if (!KEY_RE.test(f.key)) e.key = 'Use 3–50 lowercase letters, numbers or _, starting with a letter.'
    else if (BUILT_IN[f.key] || RESERVED_KEYS.includes(f.key)) e.key = 'That key is already used by a built-in template.'
    else if (getTemplate(f.key)) e.key = 'A template with this key already exists.'
  }
  if (!f.name) e.name = 'Enter a name.'
  else if (f.name.length > 80) e.name = 'Keep the name under 80 characters.'
  if (!builtIn && !RECIPIENTS[f.recipient]) e.recipient = 'Choose who receives this email.'
  if (!f.subject) e.subject = 'Enter a subject.'
  else if (f.subject.length > 200) e.subject = 'Keep the subject under 200 characters.'
  if (f.heading.length > 120) e.heading = 'Keep the heading under 120 characters.'
  if (!htmlToText(f.body)) e.body = 'Write the email text.'
  else if (f.body.length > 20000) e.body = 'The email text is too long.'
  if (builtIn && !f.buttonText) e.buttonText = 'Enter the button text.'
  else if (f.buttonText.length > 40) e.buttonText = 'Keep the button text under 40 characters.'
  for (const field of ['subject', 'heading', 'body', 'buttonText']) {
    if (e[field]) continue
    const bad = unknownVars(f[field], allowed)
    if (bad.length) e[field] = `This template can't fill ${bad.map((v) => `{${v}}`).join(', ')}. Use a variable from the list.`
  }
  return e
}

const invalid = (ctx, fields) => {
  ctx.status = 400
  ctx.body = { error: 'invalid', message: 'Fix the highlighted fields first.', fields }
}

/** The preview email, filled with sample data. */
const previewOf = (f) => {
  const r = renderTemplate(f, sampleVars())
  const html = renderActionEmail({
    title: r.heading,
    intro: r.introHtml,
    details: [['Project', VARIABLES.project_name.sample]],
    ctaText: r.buttonText || undefined,
    ctaUrl: r.buttonText ? '#' : undefined
  })
  return { subject: r.subject, html, text: r.introText }
}

/** Fill a template for a real project (composer prefill). */
async function fillForProject(app, key, projectId, user) {
  const db = await app.get('mongodbClient')
  let project = null
  if (projectId) project = await db.collection('projects').findOne(idQuery(projectId)).catch(() => null)
  // Send to client picks the revised wording after a change request.
  let useKey = key
  if (key === 'quote_ready' && project?.changeRequestPending) useKey = 'quote_revised'
  const t = getTemplate(useKey)
  if (!t) return null
  let architectName = ''
  if (project?.architectUserId) {
    try {
      const a = await app.service('users').get(project.architectUserId)
      architectName = a?.name || ''
    } catch (_) {
      /* optional */
    }
  }
  const r = renderTemplate(t, {
    client_name: project?.clientName || '',
    project_name: project?.name || 'your project',
    architect_name: architectName,
    boq_number: project?.revisedBoqNumber || project?.boqNumber || '',
    submitted_by: user?.name || user?.email || '',
    link: projectId ? `${getInspireUrl()}/project-detail/${projectId}` : getInspireUrl()
  })
  // The composer can't fill the rest (a step, a reason…): leave them out
  // rather than sending "{stage}" to a client.
  const drop = (s) => s.replace(/\{[a-z_]+\}/g, '').replace(/ {2,}/g, ' ').trim()
  return { key: useKey, subject: drop(r.subject), message: drop(r.introText) }
}

export const emailTemplates = (app) => {
  startTemplates(app)

  app.use(async (ctx, next) => {
    if (ctx.path !== '/email-templates' && !ctx.path.startsWith('/email-templates/')) return next()
    const parts = ctx.path.split('/').filter(Boolean) // ['email-templates', key?, action?]
    const key = parts[1] ? decodeURIComponent(parts[1]) : ''
    const action = parts[2] || ''
    const body = ctx.request.body || {}

    // ---- team routes (composers) -------------------------------------------
    if (key === 'options' && ctx.method === 'GET') {
      if (!(await requireRole(app, ctx, TEAM))) return
      ctx.body = listTemplates()
        .filter((t) => t.active !== false && (t.key === 'tracker_update' || (!t.builtIn && ['client', 'any'].includes(t.recipient))))
        .map((t) => ({ key: t.key, name: t.name }))
      return
    }
    if (key === 'fill' && ctx.method === 'POST') {
      const member = await requireRole(app, ctx, TEAM)
      if (!member) return
      const out = await fillForProject(app, str(body.key), str(body.projectId), member)
      if (!out) {
        ctx.status = 404
        ctx.body = { error: 'not_found', message: 'That template no longer exists.' }
        return
      }
      ctx.body = out
      return
    }

    // ---- everything else is admin only -------------------------------------
    const user = await requireRole(app, ctx, ADMIN)
    if (!user) return

    if (!key && ctx.method === 'GET') {
      await reloadTemplates(app).catch(() => {})
      ctx.body = {
        templates: listTemplates().map(view),
        variables: Object.entries(VARIABLES).map(([name, v]) => ({ name, label: v.label, sample: v.sample })),
        customVariables: CUSTOM_VARIABLES,
        recipients: RECIPIENTS
      }
      return
    }

    // Preview / test take the form's unsaved values.
    if ((key === 'preview' || key === 'test') && ctx.method === 'POST') {
      const base = getTemplate(str(body.key))
      const f = { ...readForm(body), key: str(body.key) || 'new' }
      const allowed = allowedVars(f.key, base)
      const fields = validate(f, { isNew: false, builtIn: !!base?.builtIn, allowed })
      if (key === 'preview') {
        // A preview still renders with mistakes — the page shows them inline.
        ctx.body = { ...previewOf(f), fields }
        return
      }
      if (Object.keys(fields).length) return invalid(ctx, fields)
      if (!getTransporter()) {
        ctx.status = 400
        ctx.body = { error: 'smtp_not_configured', message: 'Email is not set up. Turn it on in Settings → Email first.' }
        return
      }
      const p = previewOf(f)
      const result = await sendMail({ to: user.email, subject: `[Test] ${p.subject}`, text: p.text, html: p.html })
      ctx.body = result.sent
        ? { ok: true, message: `Test email sent to ${user.email}.` }
        : { ok: false, message: `The test email failed: ${String(result.reason || '').slice(0, 200)}` }
      return
    }

    const coll = await templatesCollection(app)

    if (!key && ctx.method === 'POST') {
      const f = readForm(body)
      const fields = validate(f, { isNew: true, builtIn: false, allowed: allowedVars(f.key) })
      if (Object.keys(fields).length) return invalid(ctx, fields)
      const now = new Date().toISOString()
      const doc = { _id: f.key, ...f, builtIn: false, createdAt: now, updatedAt: now, updatedBy: user.email || String(user._id) }
      await coll.insertOne(doc)
      await reloadTemplates(app)
      ctx.status = 201
      ctx.body = view(getTemplate(f.key))
      return
    }

    const current = getTemplate(key)
    if (!current) {
      ctx.status = 404
      ctx.body = { error: 'not_found', message: 'That template no longer exists.' }
      return
    }

    if (!action && ctx.method === 'GET') {
      const base = BUILT_IN[key]
      ctx.body = {
        ...view(current),
        original: base
          ? { subject: base.subject, heading: base.heading, body: base.body, buttonText: base.buttonText }
          : null
      }
      return
    }

    if (!action && ctx.method === 'PUT') {
      const f = readForm({ ...body, key })
      const fields = validate(f, { isNew: false, builtIn: current.builtIn, allowed: allowedVars(key, current) })
      if (Object.keys(fields).length) return invalid(ctx, fields)
      const doc = {
        _id: key,
        key,
        name: f.name,
        // A built-in keeps its recipient: the code decides who it goes to.
        recipient: current.builtIn ? current.recipient : f.recipient,
        subject: f.subject,
        heading: f.heading,
        body: f.body,
        buttonText: f.buttonText,
        active: current.lockActive ? true : f.active,
        builtIn: current.builtIn,
        createdAt: saved(current).createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: user.email || String(user._id)
      }
      await coll.replaceOne({ _id: key }, doc, { upsert: true })
      await reloadTemplates(app)
      ctx.body = view(getTemplate(key))
      return
    }

    if (!action && ctx.method === 'DELETE') {
      if (current.builtIn) {
        ctx.status = 400
        ctx.body = {
          error: 'built_in',
          message: 'Built-in templates can’t be deleted. Switch it off or reset it to the original text instead.'
        }
        return
      }
      await coll.deleteOne({ _id: key })
      await reloadTemplates(app)
      ctx.body = { ok: true }
      return
    }

    if (action === 'reset' && ctx.method === 'POST') {
      if (!current.builtIn) {
        ctx.status = 400
        ctx.body = { error: 'not_built_in', message: 'Only built-in templates have original text to go back to.' }
        return
      }
      await coll.deleteOne({ _id: key })
      await reloadTemplates(app)
      ctx.body = view(getTemplate(key))
      return
    }

    ctx.status = 405
    ctx.body = { error: 'method_not_allowed', message: 'Not supported.' }
  })
}

// The stored copy's own fields (createdAt), without the built-in defaults.
const saved = (t) => (t.edited ? t : {})
