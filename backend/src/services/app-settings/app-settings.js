// App settings — the admin Settings page (Inspire /settings).
//
// Lets an admin set the outside services' keys from the website instead of
// editing backend/.env and restarting:
//
//   email   SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM
//   tripo   TRIPO_API_KEY TRIPO_MODEL_VERSION TRIPO_POLL_TIMEOUT_SEC
//   claude  ANTHROPIC_API_KEY FLOORPLAN_AI_MODEL CLAUDE_BLENDER_MODEL CLAUDE_BLENDER_ENABLED
//   render  MYARCHITECT_API_KEY MYARCHITECT_FORMAT       (MyArchitectAI, /ai-render)
//
//   GET  /app-settings                 every section, secrets masked
//   PUT  /app-settings/:section        validate + save one section
//   POST /app-settings/:section/test   check the form's values (free: no credits)
//
// Admin / super admin only. How it reaches the rest of the code: every service
// reads these variables from process.env when it needs them, so a saved
// section is written INTO process.env. Anything not saved here keeps the value
// .env gave it at start-up (snapshotted below), so a fresh install, or a
// cleared field, behaves exactly as before this page existed.
//
// Secrets (keys, the SMTP password) are stored AES-256-GCM encrypted in the
// `app_settings` collection. They are sent to the page (admins only) so its
// key fields can show them behind the eye button. The encryption key comes
// from SETTINGS_SECRET, else the JWT secret — if that changes, saved secrets
// can't be read and the .env values are used until they are entered again.

import crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import nodemailer from 'nodemailer'

const COLLECTION = 'app_settings'
const REFRESH_MS = 60 * 1000 // other backend instances pick up a save within a minute

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-8']
const RENDER_FORMATS = ['jpg', 'png', 'webp', 'avif']
const ENCRYPTIONS = ['tls', 'ssl', 'none']
const TLS_PORTS = [587, 25, 2525]
// Hosts that only take the full email address as the SMTP username.
const EMAIL_HOSTS = {
  'smtp.gmail.com': 'Gmail',
  'smtp.googlemail.com': 'Gmail',
  'smtp.office365.com': 'Outlook',
  'smtp-mail.outlook.com': 'Outlook',
  'smtp.outlook.com': 'Outlook'
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
const isBlank = (v) => str(v) === ''

// ───────────────────────────── sections ─────────────────────────────
//
// fromEnv(env)  -> the section's values as .env has them
// toEnv(values) -> the variables to write (undefined = remove)
// secrets       -> fields that are stored encrypted and never sent back
// validate(v)   -> { field: message } for what is wrong

// SMTP_FROM as `"Name" <a@b.c>`, `Name <a@b.c>`, `Name a@b.c` or `a@b.c`.
const parseFrom = (from) => {
  const m = str(from).match(/^"?([^"<]*?)"?\s*<([^>]+)>$/)
  if (m) return { fromName: m[1].trim(), fromAddress: m[2].trim() }
  const loose = str(from).match(/^(.*?)\s*(\S+@\S+)$/)
  if (loose) return { fromName: loose[1].replace(/"/g, '').trim(), fromAddress: loose[2] }
  return { fromName: '', fromAddress: str(from) }
}

const SECTIONS = {
  email: {
    secrets: ['password'],
    fromEnv: (env) => ({
      enabled: !isBlank(env.SMTP_HOST),
      host: str(env.SMTP_HOST),
      port: Number(env.SMTP_PORT) || 587,
      encryption: String(env.SMTP_SECURE) === 'true' ? 'ssl' : String(env.SMTP_IGNORE_TLS) === 'true' ? 'none' : 'tls',
      username: str(env.SMTP_USER),
      password: str(env.SMTP_PASS),
      ...parseFrom(env.SMTP_FROM)
    }),
    toEnv: (v) => {
      if (!v.enabled) {
        // Off: the mail code already treats a missing SMTP_HOST as "not set up".
        return { SMTP_HOST: undefined }
      }
      const address = v.fromAddress || v.username
      return {
        SMTP_HOST: v.host,
        SMTP_PORT: String(v.port),
        SMTP_SECURE: v.encryption === 'ssl' ? 'true' : 'false',
        SMTP_IGNORE_TLS: v.encryption === 'none' ? 'true' : 'false',
        SMTP_USER: v.username || undefined,
        SMTP_PASS: v.password || undefined,
        SMTP_FROM: v.fromName ? `"${v.fromName}" <${address}>` : address
      }
    },
    validate: (v) => {
      const e = {}
      if (!v.enabled) return e
      if (isBlank(v.host)) e.host = 'Enter the SMTP host.'
      else if (!HOST_RE.test(v.host)) e.host = 'Enter a host name such as smtp.example.com.'
      const port = Number(v.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = 'Enter a port between 1 and 65535.'
      if (!ENCRYPTIONS.includes(v.encryption)) e.encryption = 'Choose TLS, SSL or None.'
      else if (!e.port) {
        // The pairs that work; anything else connects and then fails.
        if (v.encryption === 'tls' && !TLS_PORTS.includes(port)) e.encryption = 'TLS uses port 587. Change the port or the encryption.'
        if (v.encryption === 'ssl' && port !== 465) e.encryption = 'SSL uses port 465. Change the port or the encryption.'
        if (v.encryption === 'none' && port === 465) e.encryption = 'Port 465 needs SSL.'
      }
      // Not always an email (ZeptoMail: emailapikey, SendGrid: apikey), but
      // anything with an @ must be a whole one, and Gmail / Outlook need one.
      if (isBlank(v.username)) e.username = 'Enter the SMTP username.'
      else if (/\s/.test(v.username)) e.username = 'The username cannot contain spaces.'
      else if (v.username.includes('@') && !EMAIL_RE.test(v.username)) e.username = 'Enter a valid email address.'
      else if (EMAIL_HOSTS[v.host] && !EMAIL_RE.test(v.username))
        e.username = `${EMAIL_HOSTS[v.host]} needs the full email address as the username.`
      if (isBlank(v.password)) e.password = 'Enter the SMTP password.'
      else if (v.password.length < 6) e.password = 'The password is too short.'
      if (isBlank(v.fromAddress) && isBlank(v.username)) e.fromAddress = 'Enter the address emails are sent from.'
      else if (!isBlank(v.fromAddress) && !EMAIL_RE.test(v.fromAddress)) e.fromAddress = 'Enter a valid email address.'
      if (/["<>]/.test(v.fromName || '')) e.fromName = 'The name cannot contain " < or >.'
      else if (str(v.fromName).length > 80) e.fromName = 'Keep the name under 80 characters.'
      return e
    },
    normalise: (raw) => ({
      enabled: raw.enabled !== false,
      host: str(raw.host).toLowerCase(),
      port: Number(raw.port),
      encryption: str(raw.encryption).toLowerCase(),
      username: str(raw.username),
      password: str(raw.password),
      fromName: str(raw.fromName),
      fromAddress: str(raw.fromAddress)
    })
  },

  tripo: {
    secrets: ['apiKey'],
    fromEnv: (env) => ({
      apiKey: str(env.TRIPO_API_KEY),
      modelVersion: str(env.TRIPO_MODEL_VERSION) || 'v2.5-20250123',
      timeoutSec: Number(env.TRIPO_POLL_TIMEOUT_SEC) || 600
    }),
    toEnv: (v) => ({
      TRIPO_API_KEY: v.apiKey || undefined,
      TRIPO_MODEL_VERSION: v.modelVersion,
      TRIPO_POLL_TIMEOUT_SEC: String(v.timeoutSec)
    }),
    validate: (v) => {
      const e = {}
      if (isBlank(v.apiKey)) e.apiKey = 'Enter the Tripo API key.'
      else if (!/^tsk_\S{10,}$/.test(v.apiKey)) e.apiKey = 'A Tripo API key starts with tsk_.'
      if (!/^[A-Za-z0-9._-]{2,40}$/.test(v.modelVersion)) e.modelVersion = 'Enter a model version such as v2.5-20250123.'
      const t = Number(v.timeoutSec)
      if (!Number.isInteger(t) || t < 60 || t > 3600) e.timeoutSec = 'Enter a timeout between 60 and 3600 seconds.'
      return e
    },
    normalise: (raw) => ({
      apiKey: str(raw.apiKey),
      modelVersion: str(raw.modelVersion),
      timeoutSec: Number(raw.timeoutSec)
    })
  },

  claude: {
    secrets: ['apiKey'],
    fromEnv: (env) => ({
      apiKey: str(env.ANTHROPIC_API_KEY),
      // '' = the code's own default model
      model: str(env.CLAUDE_BLENDER_MODEL || env.FLOORPLAN_AI_MODEL),
      enabled: String(env.CLAUDE_BLENDER_ENABLED || 'true').toLowerCase() !== 'false'
    }),
    toEnv: (v) => ({
      ANTHROPIC_API_KEY: v.apiKey || undefined,
      FLOORPLAN_AI_MODEL: v.model || undefined,
      CLAUDE_BLENDER_MODEL: v.model || undefined,
      CLAUDE_BLENDER_ENABLED: v.enabled ? 'true' : 'false'
    }),
    validate: (v) => {
      const e = {}
      if (isBlank(v.apiKey)) e.apiKey = 'Enter the Claude API key.'
      else if (!/^sk-ant-\S{10,}$/.test(v.apiKey)) e.apiKey = 'A Claude API key starts with sk-ant-.'
      // A model already set in .env stays allowed even if it is not in the list.
      const envModel = str(envBase?.CLAUDE_BLENDER_MODEL || envBase?.FLOORPLAN_AI_MODEL)
      if (v.model && !CLAUDE_MODELS.includes(v.model) && v.model !== envModel) e.model = 'Choose a model from the list.'
      return e
    },
    normalise: (raw) => ({
      apiKey: str(raw.apiKey),
      model: str(raw.model),
      enabled: raw.enabled !== false
    })
  },

  render: {
    secrets: ['apiKey'],
    fromEnv: (env) => ({
      apiKey: str(env.MYARCHITECT_API_KEY),
      format: RENDER_FORMATS.includes(str(env.MYARCHITECT_FORMAT)) ? str(env.MYARCHITECT_FORMAT) : 'jpg'
    }),
    toEnv: (v) => ({
      MYARCHITECT_API_KEY: v.apiKey || undefined,
      MYARCHITECT_FORMAT: v.format
    }),
    validate: (v) => {
      const e = {}
      if (isBlank(v.apiKey)) e.apiKey = 'Enter the MyArchitectAI API key.'
      else if (/\s/.test(v.apiKey) || v.apiKey.length < 16) e.apiKey = 'That does not look like a MyArchitectAI key.'
      if (!RENDER_FORMATS.includes(v.format)) e.format = 'Choose JPG, PNG, WebP or AVIF.'
      return e
    },
    normalise: (raw) => ({
      apiKey: str(raw.apiKey),
      format: str(raw.format).toLowerCase()
    })
  }
}

// Every variable this page may write. Their .env values at start-up are the
// fallback for anything not saved here.
const MANAGED_VARS = [
  ...new Set(Object.values(SECTIONS).flatMap((s) => Object.keys(s.toEnv({ ...s.fromEnv({}), enabled: true }))))
]
let envBase = null
const snapshotEnv = () => {
  envBase = {}
  for (const k of MANAGED_VARS) if (process.env[k] !== undefined) envBase[k] = process.env[k]
}

// ───────────────────────────── encryption ─────────────────────────────

let cipherKey = null
const getCipherKey = (app) =>
  (cipherKey ||= crypto
    .createHash('sha256')
    .update(String(process.env.SETTINGS_SECRET || app.get('authentication')?.secret || ''))
    .update(':pazl-app-settings')
    .digest())

const encrypt = (app, plain) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', getCipherKey(app), iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

const decrypt = (app, packed) => {
  try {
    const [v, iv, tag, ct] = String(packed || '').split(':')
    if (v !== 'v1') return null
    const d = crypto.createDecipheriv('aes-256-gcm', getCipherKey(app), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
  } catch (_) {
    return null // wrong key or damaged: fall back to .env
  }
}

// ───────────────────────────── store ─────────────────────────────

const collection = (app) => app.get('mongodbClient').then((db) => db.collection(COLLECTION))

// Saved docs by section: { _id, values, secrets: { field: packed }, updatedAt, updatedBy }
let saved = {}

/** The values in force for a section: saved first, then .env. */
const effective = (app, section) => {
  const spec = SECTIONS[section]
  const base = spec.fromEnv(envBase || {})
  const doc = saved[section]
  if (!doc) return { values: base, sources: Object.fromEntries(spec.secrets.map((f) => [f, base[f] ? 'env' : null])) }
  const values = { ...base, ...(doc.values || {}) }
  const sources = {}
  for (const f of spec.secrets) {
    const plain = doc.secrets?.[f] ? decrypt(app, doc.secrets[f]) : null
    if (plain) {
      values[f] = plain
      sources[f] = 'saved'
    } else {
      values[f] = base[f]
      sources[f] = base[f] ? 'env' : null
    }
  }
  return { values, sources }
}

const applyToEnv = (app) => {
  if (!envBase) snapshotEnv()
  // Start from .env, then lay each saved section over it.
  for (const k of MANAGED_VARS) {
    if (envBase[k] === undefined) delete process.env[k]
    else process.env[k] = envBase[k]
  }
  for (const section of Object.keys(saved)) {
    if (!SECTIONS[section]) continue
    const vars = SECTIONS[section].toEnv(effective(app, section).values)
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined || v === '') delete process.env[k]
      else process.env[k] = String(v)
    }
  }
}

const reload = async (app) => {
  const docs = await (await collection(app)).find({}).toArray()
  saved = Object.fromEntries(docs.filter((d) => SECTIONS[d._id]).map((d) => [d._id, d]))
  applyToEnv(app)
}

/**
 * What the page sees. The secrets ARE included (the page fills its key fields
 * with them, hidden behind the eye button) — admin only, see requireAdmin.
 * `secrets` says where each one came from.
 */
const publicView = (app, section) => {
  const spec = SECTIONS[section]
  const { values, sources } = effective(app, section)
  const out = { ...values }
  const secrets = {}
  for (const f of spec.secrets) {
    const v = values[f] || ''
    secrets[f] = { set: !!v, last4: v && f !== 'password' ? v.slice(-4) : '', source: sources[f] }
    out[f] = v
  }
  const doc = saved[section]
  return { values: out, secrets, saved: !!doc, updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || null }
}

/** The form's values, with a blank secret meaning "keep the one in force". */
const mergeForm = (app, section, body) => {
  const spec = SECTIONS[section]
  const current = effective(app, section).values
  const v = spec.normalise({ ...current, ...(body || {}) })
  for (const f of spec.secrets) if (isBlank(v[f])) v[f] = current[f] || ''
  return v
}

// ───────────────────────────── tests (free) ─────────────────────────────

const describeFetchError = (err) =>
  err?.cause?.code === 'ENOTFOUND' ? 'Could not reach the service. Check the server’s internet connection.' : err?.message || String(err)

const TESTS = {
  async email(v, user) {
    if (!v.enabled) return { ok: false, message: 'Turn on SMTP first.' }
    const tx = nodemailer.createTransport({
      host: v.host,
      port: Number(v.port),
      secure: v.encryption === 'ssl',
      ignoreTLS: v.encryption === 'none',
      auth: v.username ? { user: v.username, pass: v.password } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000
    })
    const to = user?.email
    if (!to) return { ok: false, message: 'Your account has no email address to send the test to.' }
    try {
      await tx.verify()
      const address = v.fromAddress || v.username
      await tx.sendMail({
        from: v.fromName ? `"${v.fromName}" <${address}>` : address,
        to,
        subject: 'PAZL test email',
        text: 'This is a test email from the PAZL Settings page. Your SMTP settings work.',
        html: '<p style="font-family:Arial,sans-serif;font-size:14px;color:#1f2033">This is a test email from the PAZL Settings page. Your SMTP settings work.</p>'
      })
      return { ok: true, message: `Test email sent to ${to}.` }
    } catch (err) {
      const m = String(err?.message || err)
      if (/auth|535|534|credentials/i.test(m)) return { ok: false, message: 'The SMTP server rejected the username or password.' }
      if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m)) return { ok: false, message: 'Could not connect to the SMTP server. Check the host and port.' }
      if (/wrong version number|ssl3_get_record|tls/i.test(m)) return { ok: false, message: 'The encryption does not match this port. Try TLS for 587 or SSL for 465.' }
      return { ok: false, message: `The test email failed: ${m.slice(0, 200)}` }
    } finally {
      tx.close()
    }
  },

  // GET /user/balance — free, and returns the credits left.
  async tripo(v) {
    if (!v.apiKey) return { ok: false, message: 'Enter the Tripo API key first.' }
    try {
      const base = process.env.TRIPO_BASE || 'https://api.tripo3d.ai/v2/openapi'
      const res = await fetch(`${base}/user/balance`, { headers: { Authorization: `Bearer ${v.apiKey}` } })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Tripo rejected the API key.' }
      if (!res.ok || data.code !== 0) return { ok: false, message: data.message || `Tripo answered HTTP ${res.status}.` }
      const balance = data.data?.balance
      return { ok: true, message: `Connected. ${balance ?? '?'} credits left.`, balance }
    } catch (err) {
      return { ok: false, message: describeFetchError(err) }
    }
  },

  // models.list — free. Proves the key, not that the account has credit.
  async claude(v) {
    if (!v.apiKey) return { ok: false, message: 'Enter the Claude API key first.' }
    try {
      const client = new Anthropic({ apiKey: v.apiKey, maxRetries: 1, timeout: 20000 })
      await client.models.list({ limit: 1 })
      return { ok: true, message: 'Connected. The key works (this test can’t see the account’s credit).' }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Claude rejected the API key.' }
      if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, message: 'This key is not allowed to use the API.' }
      return { ok: false, message: describeFetchError(err) }
    }
  },

  // POST /balance — free, and returns the balance in USD.
  async render(v) {
    if (!v.apiKey) return { ok: false, message: 'Enter the MyArchitectAI API key first.' }
    try {
      const base = (process.env.MYARCHITECT_BASE || 'https://api.myarchitectai.com/v1').replace(/\/$/, '')
      const res = await fetch(`${base}/balance`, {
        method: 'POST',
        headers: { 'x-api-key': v.apiKey, 'Content-Type': 'application/json' },
        body: '{}'
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403 || /forbid|unauthor|invalid.*key/i.test(String(data.error || '')))
        return { ok: false, message: 'MyArchitectAI rejected the API key.' }
      if (!res.ok || data.error) return { ok: false, message: data.error || `MyArchitectAI answered HTTP ${res.status}.` }
      const balance = Number(data.balance)
      return {
        ok: true,
        message: Number.isFinite(balance) ? `Connected. $${balance.toFixed(2)} balance left.` : 'Connected.',
        balance: data.balance
      }
    } catch (err) {
      return { ok: false, message: describeFetchError(err) }
    }
  }
}

// ───────────────────────────── routes ─────────────────────────────

/** Signed-in admin, or null with the reply already written. */
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
    ctx.body = { error: 'unauthenticated', message: 'Sign in again to open Settings.' }
    return null
  }
  if (user.permissions !== 'admin' && user.permissions !== 'super_admin') {
    ctx.status = 403
    ctx.body = { error: 'forbidden', message: 'Only an admin can change Settings.' }
    return null
  }
  return user
}

// Resolves once the saved settings are in process.env. index.js waits for it
// before listening, so no request in the first seconds uses a stale .env key.
// Never rejects: if the database is slow or down, .env is used as before.
export let appSettingsReady = Promise.resolve()

export const appSettings = (app) => {
  snapshotEnv()
  appSettingsReady = reload(app).catch((err) =>
    console.error('[app-settings] could not load saved settings:', err?.message)
  )
  setInterval(() => reload(app).catch(() => {}), REFRESH_MS).unref?.()

  app.use(async (ctx, next) => {
    if (ctx.path !== '/app-settings' && !ctx.path.startsWith('/app-settings/')) return next()
    const user = await requireAdmin(app, ctx)
    if (!user) return

    const [, , section, action] = ctx.path.split('/')

    if (ctx.method === 'GET' && !section) {
      await reload(app)
      ctx.body = Object.fromEntries(Object.keys(SECTIONS).map((s) => [s, publicView(app, s)]))
      const envModel = str(envBase?.CLAUDE_BLENDER_MODEL || envBase?.FLOORPLAN_AI_MODEL)
      const claudeModels = envModel && !CLAUDE_MODELS.includes(envModel) ? [...CLAUDE_MODELS, envModel] : CLAUDE_MODELS
      ctx.body.options = { claudeModels, defaultClaudeModel: 'claude-opus-4-8', renderFormats: RENDER_FORMATS }
      return
    }

    if (!SECTIONS[section]) {
      ctx.status = 404
      ctx.body = { error: 'not_found', message: 'Unknown settings section.' }
      return
    }
    const spec = SECTIONS[section]
    const values = mergeForm(app, section, ctx.request.body)

    if (ctx.method === 'POST' && action === 'test') {
      const fields = spec.validate(values)
      if (Object.keys(fields).length) {
        ctx.status = 400
        ctx.body = { error: 'invalid', message: 'Fix the highlighted fields first.', fields }
        return
      }
      ctx.body = await TESTS[section](values, user)
      return
    }

    if (ctx.method === 'PUT' && !action) {
      const fields = spec.validate(values)
      if (Object.keys(fields).length) {
        ctx.status = 400
        ctx.body = { error: 'invalid', message: 'Fix the highlighted fields first.', fields }
        return
      }
      // A secret is stored only when it was typed now or was already saved
      // here; one that came from .env stays in .env.
      const typed = ctx.request.body || {}
      const prev = saved[section]?.secrets || {}
      const secrets = {}
      for (const f of spec.secrets) {
        if (!isBlank(typed[f])) secrets[f] = encrypt(app, str(typed[f]))
        else if (prev[f]) secrets[f] = prev[f]
      }
      const plain = { ...values }
      for (const f of spec.secrets) delete plain[f]
      const doc = {
        _id: section,
        values: plain,
        secrets,
        updatedAt: new Date().toISOString(),
        updatedBy: user.email || String(user._id)
      }
      await (await collection(app)).replaceOne({ _id: section }, doc, { upsert: true })
      saved[section] = doc
      applyToEnv(app)
      ctx.body = publicView(app, section)
      return
    }

    ctx.status = 405
    ctx.body = { error: 'method_not_allowed', message: 'Not supported.' }
  })
}
