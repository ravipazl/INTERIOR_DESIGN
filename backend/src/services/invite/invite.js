// Registers the invite service.
//
//   POST  /invite  -> admin only  (send an invite)   | public when { reset:true }
//   PATCH /invite  -> public      (set your password via the emailed link)
import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'
import { InviteService, getOptions } from './invite.class.js'
import { invitePath, inviteMethods } from './invite.shared.js'

export * from './invite.class.js'

// `create` serves two callers:
//   • { reset: true }  -> public "forgot password", no auth
//   • otherwise        -> an admin inviting someone, JWT + admin role required
// So we authenticate conditionally rather than with a blanket hook.
const authenticateInvite = async (context) => {
  if (context.data?.reset === true) return context

  await authenticate('jwt')(context)

  const role = context.params?.user?.permissions
  if (role !== 'admin' && role !== 'super_admin') {
    throw new Forbidden('Only an admin can invite users.')
  }
  return context
}

export const invite = (app) => {
  app.use(invitePath, new InviteService(getOptions(app)), {
    methods: inviteMethods,
    events: []
  })

  app.service(invitePath).hooks({
    around: {
      all: []
    },
    before: {
      all: [],
      create: [authenticateInvite],
      // PATCH is intentionally public — the emailed token IS the credential.
      patch: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}
