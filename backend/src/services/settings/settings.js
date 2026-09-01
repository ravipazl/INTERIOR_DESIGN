import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  settingDataValidator,
  settingPatchValidator,
  settingQueryValidator,
  settingResolver,
  settingExternalResolver,
  settingDataResolver,
  settingPatchResolver,
  settingQueryResolver
} from './settings.schema.js'
import { SettingsService, getOptions } from './settings.class.js'
import { settingPath, settingMethods } from './settings.shared.js'

export * from './settings.class.js'
export * from './settings.schema.js'

export const setting = (app) => {
  app.use(settingPath, new SettingsService(getOptions(app)), {
    methods: settingMethods,

    events: []
  })

  app.service(settingPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(settingExternalResolver),
        schemaHooks.resolveResult(settingResolver)
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
        schemaHooks.validateQuery(settingQueryValidator),
        schemaHooks.resolveQuery(settingQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(settingDataValidator),
        schemaHooks.resolveData(settingDataResolver),
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
        schemaHooks.validateData(settingPatchValidator),
        schemaHooks.resolveData(settingPatchResolver),
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
