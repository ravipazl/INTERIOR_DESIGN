import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  modelDefaultValuesDataValidator,
  modelDefaultValuesPatchValidator,
  modelDefaultValuesQueryValidator,
  modelDefaultValuesResolver,
  modelDefaultValuesExternalResolver,
  modelDefaultValuesDataResolver,
  modelDefaultValuesPatchResolver,
  modelDefaultValuesQueryResolver
} from './model_default_values.schema.js'
import { ModelDefaultValuesService, getOptions } from './model_default_values.class.js'
import { modelDefaultValuesPath, modelDefaultValuesMethods } from './model_default_values.shared.js'
import { fastJoin } from 'feathers-hooks-common'
export * from './model_default_values.class.js'
export * from './model_default_values.schema.js'

const modelDefaultValueJoinResolver = {
  joins: {
    property:
      (...args) =>
      async (char, { app }) => {
        if (char?.propertyName === 'externalFinishFinishingId' && char?.propertyValue) {
          try {
            const finishing = await app.service('finishings').get(char.propertyValue)
            if (finishing) {
              char.property = finishing
            }
          } catch (err) {
            char.property = null
          }
        }
      }
  }
}

export const modelDefaultValues = (app) => {
  app.use(modelDefaultValuesPath, new ModelDefaultValuesService(getOptions(app)), {
    methods: modelDefaultValuesMethods,

    events: []
  })

  app.service(modelDefaultValuesPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(modelDefaultValuesExternalResolver),
        schemaHooks.resolveResult(modelDefaultValuesResolver)
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
        schemaHooks.validateQuery(modelDefaultValuesQueryValidator),
        schemaHooks.resolveQuery(modelDefaultValuesQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(modelDefaultValuesDataValidator),
        schemaHooks.resolveData(modelDefaultValuesDataResolver),
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
        schemaHooks.validateData(modelDefaultValuesPatchValidator),
        schemaHooks.resolveData(modelDefaultValuesPatchResolver),
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
      all: [fastJoin(modelDefaultValueJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
