// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import { AiGeneratorServiceService, getOptions } from './generator.class.js'
import { aiGeneratorServicePath, aiGeneratorServiceMethods } from './generator.shared.js'

export * from './generator.class.js'

// A configure function that registers the service and its hooks via `app.configure`
export const aiGeneratorService = (app) => {
  // Register our service on the Feathers application
  app.use(aiGeneratorServicePath, new AiGeneratorServiceService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: aiGeneratorServiceMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(aiGeneratorServicePath).hooks({
    around: {
      all: [authenticate('jwt')]
    },
    before: {
      all: [],
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
