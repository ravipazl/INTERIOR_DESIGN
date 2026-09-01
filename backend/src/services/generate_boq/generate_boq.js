import { authenticate } from '@feathersjs/authentication'
import { GenerateBoqServiceService, getOptions } from './generate_boq.class.js'
import { generateBoqServicePath, generateBoqServiceMethods } from './generate_boq.shared.js'

export * from './generate_boq.class.js'

export const generateBoq = (app) => {
  app.use(generateBoqServicePath, new GenerateBoqServiceService(getOptions(app)), {
    methods: generateBoqServiceMethods,
    events: []
  })

  app.service(generateBoqServicePath).hooks({
    around: {
      all: []
    },
    before: {
      all: [],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [authenticate('jwt')],
      patch: [authenticate('jwt')],
      update: [authenticate('jwt')],
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
