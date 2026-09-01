// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import { VerifyService, getOptions } from './verify.class.js'
import { verifyPath, verifyMethods } from './verify.shared.js'

export * from './verify.class.js'

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

// A configure function that registers the service and its hooks via `app.configure`
export const verify = (app) => {
  // Register our service on the Feathers application
  app.use(verifyPath, new VerifyService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: verifyMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(verifyPath).hooks({
    around: {
      all: []
    },
    before: {
      all: [allowApiKey(), authenticate('jwt', 'apiKey')],
      find: [],
      get: [],
      create: [],
      patch: [],
      remove: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}
