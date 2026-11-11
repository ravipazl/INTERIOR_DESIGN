// Branding — Settings → General → Branding (Inspire /settings?tab=branding).
//
// The app's logo and name, used everywhere the PAZL logo used to be written in
// the code: both apps' top header, the side menu, the sign-in pages, the
// landing page, the client's quote page, the BOQ (unless Tax / Invoice has its
// own invoice logo), the browser tab icon and the header of every email.
//
//   GET /branding   public — { appName, logo, mailLogo, updatedAt } (data: URLs or "";
//                   mailLogo = the PNG copy emails use when the logo is an SVG)
//   PUT /branding   admin  — { appName, logo }; an empty logo = the PAZL logo
//
// Nothing is stored until an admin saves, so the app looks exactly as before.

import sharp from 'sharp'
import { setMailBrand } from '../../mailer.js'

const COLLECTION = 'branding'
const DOC_ID = 'main'
const ADMIN = ['admin', 'super_admin']
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const LOGO_RE = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/

export const DEFAULT_BRANDING = { appName: 'PAZL', logo: '' }

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
const collection = (app) => app.get('mongodbClient').then((db) => db.collection(COLLECTION))

const readBranding = async (app) => {
  try {
    const doc = await (await collection(app)).findOne({ _id: DOC_ID })
    if (doc)
      return {
        appName: doc.appName || DEFAULT_BRANDING.appName,
        logo: doc.logo || '',
        mailLogo: doc.mailLogo || '',
        updatedAt: doc.updatedAt || null,
        updatedBy: doc.updatedBy || null
      }
  } catch (_) {
    /* fall back */
  }
  return { ...DEFAULT_BRANDING, mailLogo: '', updatedAt: null, updatedBy: null }
}

/**
 * Most mail apps can't show SVG, so an SVG logo gets a PNG copy for emails
 * (96 px tall, sharp on high-density screens at the 28 px it is shown).
 * PNG / JPG logos are used as they are. Never throws: "" = name only.
 */
const toMailLogo = async (logo) => {
  const m = String(logo || '').match(/^data:image\/svg\+xml;base64,(.+)$/)
  if (!m) return ''
  try {
    const png = await sharp(Buffer.from(m[1], 'base64'), { density: 300 })
      .resize({ height: 96, fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch (err) {
    console.warn('[branding] could not make a PNG copy of the SVG logo:', err?.message)
    return ''
  }
}

/** What the email header shows: the PNG copy of an SVG, else the logo. */
const forMail = (b) => ({ appName: b.appName, logo: b.mailLogo || b.logo })

const validate = (f) => {
  const e = {}
  if (!f.appName) e.appName = 'Enter the app name.'
  else if (f.appName.length > 30) e.appName = 'Keep the app name under 30 characters.'
  if (f.logo) {
    if (!LOGO_RE.test(f.logo)) e.logo = 'The logo must be a PNG, JPG or SVG image.'
    else if (Math.floor(((f.logo.length - f.logo.indexOf(',') - 1) * 3) / 4) > MAX_LOGO_BYTES)
      e.logo = 'The logo must be 2 MB or smaller.'
  }
  return e
}

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
    ctx.body = { error: 'forbidden', message: 'Only an admin can change branding.' }
    return null
  }
  return user
}

export const branding = (app) => {
  // Emails need the logo without waiting on the database each time. A logo
  // saved as SVG before the PNG copy existed gets its copy made now, once.
  readBranding(app)
    .then(async (b) => {
      if (b.logo && !b.mailLogo) {
        const mailLogo = await toMailLogo(b.logo)
        if (mailLogo) {
          await (await collection(app)).updateOne({ _id: DOC_ID }, { $set: { mailLogo } })
          b.mailLogo = mailLogo
        }
      }
      setMailBrand(forMail(b))
    })
    .catch(() => {})

  app.use(async (ctx, next) => {
    if (ctx.path !== '/branding') return next()

    if (ctx.method === 'GET') {
      ctx.body = await readBranding(app)
      return
    }

    if (ctx.method === 'PUT') {
      const user = await requireAdmin(app, ctx)
      if (!user) return
      const body = ctx.request.body || {}
      const f = { appName: str(body.appName), logo: str(body.logo) }
      const fields = validate(f)
      if (Object.keys(fields).length) {
        ctx.status = 400
        ctx.body = { error: 'invalid', message: 'Fix the highlighted fields first.', fields }
        return
      }
      const doc = {
        _id: DOC_ID,
        ...f,
        mailLogo: await toMailLogo(f.logo),
        updatedAt: new Date().toISOString(),
        updatedBy: user.email || String(user._id)
      }
      await (await collection(app)).replaceOne({ _id: DOC_ID }, doc, { upsert: true })
      const saved = await readBranding(app)
      setMailBrand(forMail(saved))
      ctx.body = saved
      return
    }

    ctx.status = 405
    ctx.body = { error: 'method_not_allowed', message: 'Not supported.' }
  })
}
