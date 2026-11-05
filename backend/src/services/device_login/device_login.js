// Sign a headset (the Pazl HoloLens app) in with a short code, so nobody has
// to type an email and password on a floating keyboard.
//
//   1. The app asks for a code:        POST  /device-login            → { code, secret, expiresIn, interval }
//   2. It shows the code; you, signed in on the website, approve it:
//                                      PATCH /device-login/:code       (your website sign-in)
//   3. The app, waiting, picks up its sign-in:
//                                      GET   /device-login/:code?secret=…  → { status: 'pending' } | { status: 'approved', accessToken }
//
// A code lasts 10 minutes and is used once. Only the app that asked for it
// holds its secret, so only that app can collect the sign-in; approving needs
// you to be signed in. The token is the same kind the website gets.
import crypto from 'crypto'
import { authenticate } from '@feathersjs/authentication'
import { BadRequest, NotFound, Forbidden } from '@feathersjs/errors'

export const deviceLoginPath = 'device-login'
const COLLECTION = 'device_logins'
const LIFETIME_MS = 10 * 60 * 1000
const POLL_SECONDS = 3
// No 0/O, 1/I/L: easy to read off a headset and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

const newCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let s = ''
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return s
}

// "k7p 2qm", "K7P-2QM" → "K7P2QM"
const normalise = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export class DeviceLoginService {
  setup(app) {
    this.app = app
  }

  async collection() {
    const db = await this.app.get('mongodbClient')
    const col = db.collection(COLLECTION)
    if (!this.indexed) {
      this.indexed = true
      // Expired codes clear themselves out.
      col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
      col.createIndex({ code: 1 }, { unique: true }).catch(() => {})
    }
    return col
  }

  /** A new code for a headset. No sign-in needed: the headset has none yet. */
  async create(data) {
    const col = await this.collection()
    const secret = crypto.randomBytes(32).toString('hex')
    const device = String((data && data.device) || 'Headset').slice(0, 60)
    for (let tries = 0; tries < 5; tries++) {
      const code = newCode()
      try {
        await col.insertOne({
          code,
          secret,
          device,
          status: 'pending',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + LIFETIME_MS)
        })
        return { code, secret, expiresIn: LIFETIME_MS / 1000, interval: POLL_SECONDS }
      } catch (e) {
        if (e && e.code === 11000) continue // that code is in use: draw again
        throw e
      }
    }
    throw new BadRequest('Could not make a code. Please try again.')
  }

  /** The headset, waiting: still pending, or its sign-in (handed over once). */
  async get(id, params) {
    const col = await this.collection()
    const code = normalise(id)
    const row = await col.findOne({ code })
    if (!row || row.expiresAt < new Date()) throw new NotFound('This code has expired. Ask for a new one.')
    const secret = params && params.query ? params.query.secret : ''
    if (!sameSecret(secret, row.secret)) throw new Forbidden('Not this headset’s code.')
    if (row.status !== 'approved') return { status: 'pending' }

    // Approved: make the sign-in, and use the code up so it cannot be collected twice.
    const taken = await col.findOneAndDelete({ code, status: 'approved' })
    const done = taken && (taken.value || taken)
    if (!done || !done.userId) throw new NotFound('This code has already been used. Ask for a new one.')
    const user = await this.app.service('users').get(done.userId)
    const accessToken = await this.app
      .service('authentication')
      .createAccessToken(user.permissions ? { permissions: user.permissions } : {}, { subject: String(user._id) })
    return { status: 'approved', accessToken }
  }

  /** You, signed in on the website, approve the code your headset shows. */
  async patch(id, _data, params) {
    const user = params && params.user
    if (!user || !user._id) throw new Forbidden('Sign in on the website first.')
    const col = await this.collection()
    const code = normalise(id)
    if (code.length !== CODE_LENGTH) throw new BadRequest('A code has 6 letters and numbers.')
    const res = await col.findOneAndUpdate(
      { code, status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'approved', userId: String(user._id), approvedAt: new Date() } },
      { returnDocument: 'after' }
    )
    const row = res && (res.value !== undefined ? res.value : res)
    if (!row) throw new NotFound('That code was not found or has expired. Check the headset for the current one.')
    return { ok: true, device: row.device }
  }
}

export const deviceLogin = (app) => {
  app.use(deviceLoginPath, new DeviceLoginService(), {
    methods: ['create', 'get', 'patch'],
    events: []
  })
  app.service(deviceLoginPath).hooks({
    before: {
      // Only approving needs a sign-in; the headset has none until then.
      patch: [authenticate('jwt')]
    }
  })
}
