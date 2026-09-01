// Invite / set-password flow.
//
// Replaces "admin types a password and sends it over chat". Instead:
//   1. POST   /invite  { email, name, permissions }   (admin only)
//        -> creates the account WITHOUT a password, emails a one-time link
//   2. PATCH  /invite  { token, password }            (public)
//        -> the person chooses their OWN password. The admin never knows it.
//
// Reuses what already exists — no new token store, no crypto, no hashing code:
//   • the link token IS a normal Feathers JWT  -> authentication.createAccessToken()
//   • verifying it uses the same call as verify.class.js -> verifyAccessToken()
//   • the password is hashed by the EXISTING userPatchResolver (passwordHash)
//   • mail uses the same SMTP_* env + pattern as design-backend `send-quote`
//
// Security:
//   • The link token is minted with a DIFFERENT audience (INVITE_AUDIENCE) so
//     the normal login JWT strategy REJECTS it. Otherwise the emailed link
//     would double as a working login token for its whole lifetime.
//   • Single-use: a token issued before `user.passwordSetAt` is rejected.
//   • "Forgot password" reuses this exact path (reset: true) and never reveals
//     whether an email exists.
import { BadRequest } from '@feathersjs/errors'
import { getAppUrl, renderActionEmail, sendMail } from '../../mailer.js'

// Must NOT be the login audience (config/default.json authentication.jwtOptions),
// so an invite link can never be used as an access token.
const INVITE_AUDIENCE = 'pazl-invite'
const INVITE_EXPIRY = '7d'

// The project has 3 real roles. In the DB a "client" is stored as 'user'.
const ROLE_ALIASES = { client: 'user', architect: 'architect', admin: 'admin' }
const INVITABLE = ['user', 'architect', 'admin']

// Mirrors the frontend rule (utils/genericFunctions.js validatePassword): 8+
// chars, lowercase, uppercase, digit — the same rule signup has always used.
// The frontend check is only a UX affordance; this is the one that enforces it,
// since /invite is a public endpoint anyone can POST to directly.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
const PASSWORD_RULE_MESSAGE =
  'Your password should have a minimum of 8 characters, a number, lowercase and uppercase.'

export class InviteService {
  constructor(options) {
    this.options = options || {}
  }

  setup(app) {
    this.app = app
  }

  async find(_params) {
    return []
  }

  async get(_id, _params) {
    return {}
  }

  // --- 1. Admin sends an invite (or a password reset) -----------------------
  async create(data, params) {
    const email = String(data?.email || '')
      .trim()
      .toLowerCase()
    if (!email) throw new BadRequest('email is required')

    const isReset = data?.reset === true
    const users = this.app.service('users')
    const existing = (await users.find({ query: { email, $limit: 1 }, paginate: false }))?.[0]

    if (isReset) {
      // Public "forgot password". Always report success so we never leak which
      // emails exist. Only actually send when the account is real.
      if (existing) await this._sendLink(existing, true)
      return { success: true }
    }

    // --- invite (admin only; the hook already enforced that) ---
    const requested = ROLE_ALIASES[data?.permissions] || data?.permissions || 'user'
    if (!INVITABLE.includes(requested)) {
      throw new BadRequest(`permissions must be one of: client, architect, admin`)
    }

    let user = existing
    if (!user) {
      // Create WITHOUT a password. `params.user` is forwarded so the users
      // create hook sees an admin and honours the requested role (see users.js).
      user = await users.create(
        { email, name: data?.name || '', permissions: requested },
        { user: params?.user }
      )
    }

    const mail = await this._sendLink(user, false)
    return { success: true, userId: String(user._id), email: user.email, ...mail }
  }

  // --- 2. The person sets their own password --------------------------------
  async patch(_id, data, _params) {
    const token = String(data?.token || '')
    const password = String(data?.password || '')
    if (!token) throw new BadRequest('token is required')
    if (!PASSWORD_REGEX.test(password)) throw new BadRequest(PASSWORD_RULE_MESSAGE)

    let payload
    try {
      // Same call verify.class.js uses. The audience override is what stops a
      // normal login token being accepted here (and vice versa).
      payload = await this.app
        .service('authentication')
        .verifyAccessToken(token, { audience: INVITE_AUDIENCE })
    } catch (err) {
      throw new BadRequest('This link is invalid or has expired. Please ask for a new one.')
    }

    const userId = payload?.sub
    if (!userId) throw new BadRequest('This link is invalid.')

    const user = await this.app.service('users').get(userId)

    // Single-use: reject a link minted before the last password change.
    if (user?.passwordSetAt && payload?.iat) {
      if (payload.iat * 1000 < new Date(user.passwordSetAt).getTime()) {
        throw new BadRequest('This link has already been used. Please ask for a new one.')
      }
    }

    // The existing userPatchResolver hashes `password` for us.
    await this.app
      .service('users')
      .patch(userId, { password, passwordSetAt: new Date().toISOString() })

    return { success: true, email: user?.email }
  }

  // --- helpers --------------------------------------------------------------
  // NOTE: a plain method, NOT a `#private` one. Feathers proxies the service
  // object, so `this` is not the real class instance and `#private` access
  // throws "Receiver must be an instance of class". Not exposed externally —
  // only the methods listed in invite.shared.js are.
  async _sendLink(user, isReset) {
    const token = await this.app.service('authentication').createAccessToken(
      {},
      {
        subject: String(user._id),
        audience: INVITE_AUDIENCE,
        expiresIn: INVITE_EXPIRY
      }
    )
    const link = `${getAppUrl()}/set-password?token=${encodeURIComponent(token)}`
    const what = isReset ? 'reset your password' : 'set up your Pazl account'
    const greeting = user.name ? `Hello ${user.name},` : 'Hello,'
    const result = await sendMail({
      to: user.email,
      subject: isReset ? 'Reset your Pazl password' : 'You have been invited to Pazl',
      text:
        `${greeting}\n\n` +
        `Please ${what} using the link below. It expires in 7 days and can be used once.\n\n` +
        `${link}\n\n` +
        `If you were not expecting this email you can ignore it.`,
      // Same branded template as the quote / assignment emails, so every mail
      // Pazl sends looks like it came from the same product.
      html: renderActionEmail({
        title: isReset ? 'Reset your password' : 'You have been invited to Pazl',
        intro: isReset
          ? `${greeting} use the button below to reset your password. The link expires in 7 days and can be used once. If you were not expecting this email you can ignore it.`
          : `${greeting} you have been invited to Pazl. Use the button below to set your password and finish setting up your account. The link expires in 7 days and can be used once.`,
        ctaText: isReset ? 'Reset password' : 'Set your password',
        ctaUrl: link
      })
    })

    if (!result.sent) {
      // Local dev / SMTP down: never block the flow — surface the link so it is
      // still usable and the failure is obvious.
      console.warn(`[invite] email NOT sent (${result.reason}). Link for ${user.email}: ${link}`)
    }

    // Local-dev convenience: when NO SMTP is configured there is no way to
    // receive the link, so hand it back to the caller. Deliberately narrow:
    //   • only when SMTP is genuinely absent (production always has it, so this
    //     never fires there — a send FAILURE does not qualify either)
    //   • NEVER for `reset`, which is a PUBLIC endpoint — returning a link there
    //     would let anyone request a reset for any email and take the account.
    const devLink = !isReset && result.reason === 'smtp-not-configured' ? link : undefined

    return { emailSent: result.sent, ...(devLink ? { devLink } : {}) }
  }
}

export const getOptions = (app) => {
  return { app }
}
