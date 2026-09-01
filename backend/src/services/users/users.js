// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  userDataValidator,
  userPatchValidator,
  userQueryValidator,
  userResolver,
  userExternalResolver,
  userDataResolver,
  userPatchResolver,
  userQueryResolver
} from './users.schema.js'
import { UserService, getOptions } from './users.class.js'
import { userPath, userMethods } from './users.shared.js'

export * from './users.class.js'
export * from './users.schema.js'

export const allowApiKey = () => {
  return async (context) => {
    const { params, app } = context

    const headerField = app.get('authentication').apiKey.header
    const token = params.headers ? params.headers[headerField] : null

    if (token && params.provider && !params.authentication) {
      context.params = {
        ...params,
        authentication: {
          strategy: 'apiKey',
          token
        }
      }
    }

    return context
  }
}

// Try to authenticate, but DON'T fail if there's no/invalid token — used on the
// public `create` (signup) route so an anonymous request is allowed through as
// a normal user, while an admin's token is still recognised (so an admin can
// legitimately create a user with a role). After this runs, `context.params.user`
// is set only when a valid token was supplied.
const optionalAuthenticate = async (context) => {
  if (context.params && context.params.authentication) {
    try {
      await authenticate('jwt')(context)
    } catch (e) {
      // invalid / expired token -> treat as anonymous, do not throw
    }
  }
  return context
}

// True only when the request is made by an authenticated admin / super admin.
const isAdminRequest = (context) => {
  const p = context.params && context.params.user && context.params.user.permissions
  return p === 'admin' || p === 'super_admin'
}

// A configure function that registers the service and its hooks via `app.configure`
export const user = (app) => {
  // Register our service on the Feathers application
  app.use(userPath, new UserService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: userMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(userPath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(userExternalResolver), schemaHooks.resolveResult(userResolver)],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [schemaHooks.validateQuery(userQueryValidator), schemaHooks.resolveQuery(userQueryResolver)],
      find: [allowApiKey(), authenticate('jwt', 'apiKey')],
      get: [allowApiKey(), authenticate('jwt', 'apiKey')],
      create: [
        optionalAuthenticate,
        schemaHooks.validateData(userDataValidator),
        schemaHooks.resolveData(userDataResolver),
        async (context) => {
          // SECURITY: never trust a client-supplied role over HTTP. Only an
          // authenticated admin/super_admin may set `permissions` on an EXTERNAL
          // request; every other external request (public signup, anonymous,
          // non-admin) is forced to 'user'.
          //
          // Internal calls (`context.params.provider` is undefined) — the CLI
          // bootstrap script and the invite service — are trusted and may set
          // the role. `params.provider` is Feathers' standard boundary between
          // untrusted HTTP and trusted server-side calls.
          const requestedRole = context.data.permissions
          const trusted = !context.params.provider || isAdminRequest(context)
          context.data = {
            ...context.data,
            permissions: trusted && requestedRole ? requestedRole : 'user',
            createdAt: new Date().toISOString()
          }
        }
      ],
      update: [authenticate('jwt')],
      patch: [
        authenticate('jwt'),
        schemaHooks.validateData(userPatchValidator),
        schemaHooks.resolveData(userPatchResolver),
        async (context) => {
          // SECURITY: an EXTERNAL non-admin (incl. a user editing their own
          // record) may NOT change roles — strip `permissions` so it can't be
          // elevated. Internal calls (no `params.provider`) — the CLI bootstrap
          // script and server-side flows — are trusted and may set the role.
          if (
            context.params.provider &&
            !isAdminRequest(context) &&
            context.data &&
            'permissions' in context.data
          ) {
            delete context.data.permissions
          }
        }
      ],
      remove: [authenticate('jwt')]
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}
