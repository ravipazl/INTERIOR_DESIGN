import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  hardwareDataValidator,
  hardwarePatchValidator,
  hardwareQueryValidator,
  hardwareResolver,
  hardwareExternalResolver,
  hardwareDataResolver,
  hardwarePatchResolver,
  hardwareQueryResolver
} from './hardware.schema.js'
import { HardwareService, getOptions } from './hardware.class.js'
import { hardwarePath, hardwareMethods } from './hardware.shared.js'

export * from './hardware.class.js'
export * from './hardware.schema.js'

export const hardware = (app) => {
  app.use(hardwarePath, new HardwareService(getOptions(app)), {
    methods: hardwareMethods,

    events: []
  })

  app.service(hardwarePath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(hardwareExternalResolver),
        schemaHooks.resolveResult(hardwareResolver)
      ],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [
        schemaHooks.validateQuery(hardwareQueryValidator),
        schemaHooks.resolveQuery(hardwareQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(hardwareDataValidator),
        schemaHooks.resolveData(hardwareDataResolver),
        async (context) => {
          context.data = {
            ...context.data,
            createdAt: new Date().toISOString()
          }
        }
      ],
      update: [authenticate('jwt')],
      patch: [
        authenticate('jwt'),
        schemaHooks.validateData(hardwarePatchValidator),
        schemaHooks.resolveData(hardwarePatchResolver),
        async (context) => {
          context.data = {
            ...context.data,
            updatedAt: new Date().toISOString()
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
