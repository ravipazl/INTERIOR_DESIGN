// Invoice profiles — Settings → Tax / Invoice (Inspire /settings?tab=invoice).
//
// The company, tax, numbering, payment, bank and footer details printed on the
// Bill of Quantity. One profile is the DEFAULT, and every BOQ uses it: the 3D
// app's BOQ page (and its PDF), the client's BOQ view and the public quote page.
// A quote that was SENT keeps the profile it was sent with (send-quote stores a
// copy in the project's quoteSnapshot), so a client's total never moves after.
//
//   GET    /invoice-profiles/active          the default profile (public: it is
//                                            what every printed BOQ shows anyway)
// Admin only:
//   GET    /invoice-profiles                 every profile
//   GET    /invoice-profiles/:id             one profile
//   POST   /invoice-profiles                 create
//   PUT    /invoice-profiles/:id             save changes
//   DELETE /invoice-profiles/:id             delete (never the default)
//   POST   /invoice-profiles/:id/default     make it the default
//
// The first profile is created from the values the BOQ used to have written in
// its code, so totals and wording stay exactly the same until someone edits.

import { randomBytes } from 'crypto'

const COLLECTION = 'invoice_profiles'
const ADMIN = ['admin', 'super_admin']
const MAX_LOGO_BYTES = 2 * 1024 * 1024

// What the BOQ printed before this page existed.
export const SEED_PROFILE = {
  _id: 'pazl',
  name: 'Pazl',
  companyName: 'PAZL',
  address: 'Regd. office: 17/12 #3B, Ganapathy Street, Chennai 600014',
  phone: '+91 94440 94422',
  email: 'gafoo.ak@pazl.in',
  contactLine: 'R. Karthik (CEO) · +91 98405 44441 · karthik@nichedesginloft.com',
  gstin: '',
  pan: '',
  logo: '',
  gstRate: 18,
  transportPct: 0.15,
  packingPct: 0.15,
  quotePrefix: '',
  paymentSchedule: [
    { percent: 10, text: 'upon order & design confirmation' },
    { percent: 40, text: 'before commencement of work' },
    { percent: 40, text: 'upon delivery of products' },
    { percent: 10, text: 'after completion of work' }
  ],
  notes: [
    'Dimensions and estimation based on drawing provided by client, actual measurements may vary on site.',
    'Items not mentioned in estimate will be charged additionally.',
    'All civil works not mentioned will be additional.',
    'Estimate is valid for a time period of 30 days from date mentioned above.',
    'Light fittings will be based on final design, not included in this estimate, cost will be actual.'
  ],
  bankName: 'State Bank of India',
  accountName: 'NDL Interiors Private Ltd',
  accountNumber: '36342320833',
  ifsc: 'SBIN0000962',
  branch: 'Gopalapuram',
  forText: 'For Pazl',
  signText: 'Authorized seal or stamp',
  footerTerms: ''
}

const FIELDS = Object.keys(SEED_PROFILE).filter((k) => k !== '_id')

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v))

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
const PREFIX_RE = /^[A-Z0-9\-/]{0,10}$/
const LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/

const collection = (app) => app.get('mongodbClient').then((db) => db.collection(COLLECTION))

/** The profile a new BOQ uses. Never throws: falls back to the seed values. */
export const getActiveInvoiceProfile = async (app) => {
  try {
    const coll = await collection(app)
    const doc = (await coll.findOne({ isDefault: true })) || (await coll.findOne({}))
    if (doc) return { ...SEED_PROFILE, ...doc, id: String(doc._id) }
  } catch (_) {
    /* fall back */
  }
  return { ...SEED_PROFILE, id: SEED_PROFILE._id, isDefault: true }
}

/** A quote number: the default profile's prefix + 10 random characters. */
export const newQuoteNumber = async (app) => {
  const p = await getActiveInvoiceProfile(app)
  const code = randomBytes(8).toString('hex').substring(0, 10).toUpperCase()
  return `${str(p.quotePrefix)}${code}`
}

/** The form's fields, cleaned and typed. */
const readForm = (b = {}) => ({
  name: str(b.name),
  companyName: str(b.companyName),
  address: String(b.address || '').replace(/\r/g, '').trim(),
  phone: str(b.phone),
  email: str(b.email),
  contactLine: str(b.contactLine),
  gstin: str(b.gstin).toUpperCase(),
  pan: str(b.pan).toUpperCase(),
  logo: str(b.logo),
  gstRate: num(b.gstRate),
  transportPct: num(b.transportPct),
  packingPct: num(b.packingPct),
  quotePrefix: str(b.quotePrefix).toUpperCase(),
  paymentSchedule: (Array.isArray(b.paymentSchedule) ? b.paymentSchedule : []).map((r) => ({
    percent: num(r?.percent),
    text: str(r?.text)
  })),
  notes: (Array.isArray(b.notes) ? b.notes : []).map(str).filter(Boolean),
  bankName: str(b.bankName),
  accountName: str(b.accountName),
  accountNumber: str(b.accountNumber).replace(/\s+/g, ''),
  ifsc: str(b.ifsc).toUpperCase(),
  branch: str(b.branch),
  forText: str(b.forText),
  signText: str(b.signText),
  footerTerms: String(b.footerTerms || '').replace(/\r/g, '').trim()
})

const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi

/** { field: message } for what is wrong. */
export const validateProfile = (f, { names = [] } = {}) => {
  const e = {}
  if (!f.name) e.name = 'Enter a profile name.'
  else if (f.name.length > 60) e.name = 'Keep the profile name under 60 characters.'
  else if (names.includes(f.name.toLowerCase())) e.name = 'Another profile already has this name.'
  if (!f.companyName) e.companyName = 'Enter the company name.'
  else if (f.companyName.length > 100) e.companyName = 'Keep the company name under 100 characters.'
  if (f.address.length > 500) e.address = 'Keep the address under 500 characters.'
  if (f.phone && !/^[+0-9 ()\-]{6,20}$/.test(f.phone)) e.phone = 'Enter a phone number, such as +91 94440 94422.'
  if (f.email && !EMAIL_RE.test(f.email)) e.email = 'Enter a valid email address.'
  if (f.contactLine.length > 200) e.contactLine = 'Keep the contact line under 200 characters.'
  if (f.gstin && !GSTIN_RE.test(f.gstin)) e.gstin = 'Enter a valid 15-character GSTIN, such as 33ABCDE1234F1Z7.'
  if (f.pan && !PAN_RE.test(f.pan)) e.pan = 'Enter a valid PAN, such as ABCDE1234F.'
  if (f.logo) {
    if (!LOGO_RE.test(f.logo)) e.logo = 'The logo must be a PNG or JPG image.'
    else if (Math.floor(((f.logo.length - f.logo.indexOf(',') - 1) * 3) / 4) > MAX_LOGO_BYTES)
      e.logo = 'The logo must be 2 MB or smaller.'
  }
  if (!inRange(f.gstRate, 0, 28)) e.gstRate = 'Enter a GST rate between 0 and 28.'
  if (!inRange(f.transportPct, 0, 10)) e.transportPct = 'Enter a transport rate between 0 and 10.'
  if (!inRange(f.packingPct, 0, 10)) e.packingPct = 'Enter a packing rate between 0 and 10.'
  if (!PREFIX_RE.test(f.quotePrefix)) e.quotePrefix = 'Use up to 10 capital letters, numbers, - or /.'
  if (!f.paymentSchedule.length) e.paymentSchedule = 'Add at least one payment step.'
  else if (f.paymentSchedule.length > 10) e.paymentSchedule = 'Use at most 10 payment steps.'
  else if (f.paymentSchedule.some((r) => !inRange(r.percent, 0.01, 100))) e.paymentSchedule = 'Each step needs a percent between 0 and 100.'
  else if (f.paymentSchedule.some((r) => !r.text || r.text.length > 120)) e.paymentSchedule = 'Each step needs a description (under 120 characters).'
  else {
    const total = Math.round(f.paymentSchedule.reduce((a, r) => a + r.percent, 0) * 100) / 100
    if (total !== 100) e.paymentSchedule = `The steps add up to ${total}%. They must add up to 100%.`
  }
  if (f.notes.length > 15) e.notes = 'Use at most 15 notes.'
  else if (f.notes.some((n) => n.length > 300)) e.notes = 'Keep each note under 300 characters.'
  if (f.ifsc && !IFSC_RE.test(f.ifsc)) e.ifsc = 'Enter a valid IFSC code, such as SBIN0000962.'
  if (f.accountNumber && !/^[0-9]{6,20}$/.test(f.accountNumber)) e.accountNumber = 'Enter 6–20 digits.'
  for (const [k, max] of [['bankName', 80], ['accountName', 100], ['branch', 80], ['forText', 60], ['signText', 60]]) {
    if (f[k].length > max) e[k] = `Keep this under ${max} characters.`
  }
  if (f.footerTerms.length > 1000) e.footerTerms = 'Keep the footer under 1000 characters.'
  return e
}

const view = (d) => ({ ...SEED_PROFILE, ...d, _id: undefined, id: String(d._id), isDefault: !!d.isDefault })

async function requireAdmin(app, ctx) {
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
  if (!ADMIN.includes(user.permissions)) {
    ctx.status = 403
    ctx.body = { error: 'forbidden', message: 'Only an admin can change invoice settings.' }
    return null
  }
  return user
}

const seed = async (app) => {
  const coll = await collection(app)
  if ((await coll.countDocuments()) === 0) {
    const now = new Date().toISOString()
    await coll.insertOne({ ...SEED_PROFILE, isDefault: true, createdAt: now, updatedAt: now, updatedBy: 'system' })
  }
}

export const invoiceProfiles = (app) => {
  seed(app).catch((err) => console.error('[invoice-profiles] seed failed:', err?.message))

  app.use(async (ctx, next) => {
    if (ctx.path !== '/invoice-profiles' && !ctx.path.startsWith('/invoice-profiles/')) return next()
    const parts = ctx.path.split('/').filter(Boolean)
    const id = parts[1] ? decodeURIComponent(parts[1]) : ''
    const action = parts[2] || ''

    if (id === 'active' && ctx.method === 'GET') {
      ctx.body = view(await getActiveInvoiceProfile(app).then((p) => ({ ...p, _id: p.id })))
      return
    }

    const user = await requireAdmin(app, ctx)
    if (!user) return
    const coll = await collection(app)
    const stamp = { updatedAt: new Date().toISOString(), updatedBy: user.email || String(user._id) }
    const invalid = (fields) => {
      ctx.status = 400
      ctx.body = { error: 'invalid', message: 'Fix the highlighted fields first.', fields }
    }
    const otherNames = async (exceptId) =>
      (await coll.find(exceptId ? { _id: { $ne: exceptId } } : {}, { projection: { name: 1 } }).toArray()).map((d) =>
        String(d.name || '').toLowerCase()
      )

    if (!id && ctx.method === 'GET') {
      await seed(app).catch(() => {})
      const docs = await coll.find({}).sort({ createdAt: 1 }).toArray()
      ctx.body = { profiles: docs.map(view) }
      return
    }

    if (!id && ctx.method === 'POST') {
      const f = readForm(ctx.request.body)
      const fields = validateProfile(f, { names: await otherNames() })
      if (Object.keys(fields).length) return invalid(fields)
      const doc = {
        _id: `p_${randomBytes(6).toString('hex')}`,
        ...f,
        isDefault: false,
        createdAt: stamp.updatedAt,
        ...stamp
      }
      await coll.insertOne(doc)
      ctx.status = 201
      ctx.body = view(doc)
      return
    }

    const current = await coll.findOne({ _id: id })
    if (!current) {
      ctx.status = 404
      ctx.body = { error: 'not_found', message: 'That invoice profile no longer exists.' }
      return
    }

    if (!action && ctx.method === 'GET') {
      ctx.body = view(current)
      return
    }

    if (!action && ctx.method === 'PUT') {
      const f = readForm(ctx.request.body)
      const fields = validateProfile(f, { names: await otherNames(id) })
      if (Object.keys(fields).length) return invalid(fields)
      const pick = Object.fromEntries(FIELDS.map((k) => [k, f[k]]))
      await coll.updateOne({ _id: id }, { $set: { ...pick, ...stamp } })
      ctx.body = view(await coll.findOne({ _id: id }))
      return
    }

    if (!action && ctx.method === 'DELETE') {
      if (current.isDefault) {
        ctx.status = 400
        ctx.body = { error: 'is_default', message: 'The default profile can’t be deleted. Make another profile the default first.' }
        return
      }
      await coll.deleteOne({ _id: id })
      ctx.body = { ok: true }
      return
    }

    if (action === 'default' && ctx.method === 'POST') {
      await coll.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } })
      await coll.updateOne({ _id: id }, { $set: { isDefault: true, ...stamp } })
      ctx.body = view(await coll.findOne({ _id: id }))
      return
    }

    ctx.status = 405
    ctx.body = { error: 'method_not_allowed', message: 'Not supported.' }
  })
}
