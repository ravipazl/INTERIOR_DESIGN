import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  furnishedModelDataValidator,
  furnishedModelPatchValidator,
  furnishedModelQueryValidator,
  furnishedModelResolver,
  furnishedModelExternalResolver,
  furnishedModelDataResolver,
  furnishedModelPatchResolver,
  furnishedModelQueryResolver
} from './furnished_models.schema.js'
import { FurnishedModelService, getOptions } from './furnished_models.class.js'
import { furnishedModelPath, furnishedModelMethods } from './furnished_models.shared.js'
import { fastJoin } from 'feathers-hooks-common'
export * from './furnished_models.class.js'
export * from './furnished_models.schema.js'

const furnishedModelsJoinResolver = {
  joins: {
    model:
      (...args) =>
      async (char, { app }) => {
        if (char?.modelId) {
          try {
            const model = await app.service('models').get(char.modelId)
            if (model) {
              char.model = model
            }
          } catch (error) {
            char.model = null
          }
        }
      }
  }
}

export const furnishedModel = (app) => {
  app.use(furnishedModelPath, new FurnishedModelService(getOptions(app)), {
    methods: furnishedModelMethods,

    events: []
  })

  app.service(furnishedModelPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(furnishedModelExternalResolver),
        schemaHooks.resolveResult(furnishedModelResolver)
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
        schemaHooks.validateQuery(furnishedModelQueryValidator),
        schemaHooks.resolveQuery(furnishedModelQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(furnishedModelDataValidator),
        schemaHooks.resolveData(furnishedModelDataResolver),
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
        schemaHooks.validateData(furnishedModelPatchValidator),
        schemaHooks.resolveData(furnishedModelPatchResolver),
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
      all: [fastJoin(furnishedModelsJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
