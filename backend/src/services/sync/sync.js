import { authenticate } from '@feathersjs/authentication'
import { SyncService, getOptions } from './sync.class.js'
import { syncServicePath, syncServiceMethods } from './sync.shared.js'

export * from './sync.class.js'

export const sync = (app) => {
  app.use(syncServicePath, new SyncService(getOptions(app)), {
    methods: syncServiceMethods,

    events: []
  })

  app.service(syncServicePath).hooks({
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
