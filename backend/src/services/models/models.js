import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  modelDataValidator,
  modelPatchValidator,
  modelQueryValidator,
  modelResolver,
  modelExternalResolver,
  modelDataResolver,
  modelPatchResolver,
  modelQueryResolver
} from './models.schema.js'
import { ModelService, getOptions } from './models.class.js'
import { modelPath, modelMethods } from './models.shared.js'
import { fastJoin } from 'feathers-hooks-common'
export * from './models.class.js'
export * from './models.schema.js'

const modelJoinResolver = {
  joins: {
    category:
      (...args) =>
      async (char, { app }) => {
        if (char?.categoryId) {
          try {
            const category = await app.service('categories').get(char.categoryId)
            if (category) {
              char.category = category
            }
          } catch (error) {
            char.category = null
          }
        }
      }
  }
}

export const model = (app) => {
  app.use(modelPath, new ModelService(getOptions(app)), {
    methods: modelMethods,

    events: []
  })

  app.service(modelPath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(modelExternalResolver), schemaHooks.resolveResult(modelResolver)],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [schemaHooks.validateQuery(modelQueryValidator), schemaHooks.resolveQuery(modelQueryResolver)],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(modelDataValidator),
        schemaHooks.resolveData(modelDataResolver),
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
        schemaHooks.validateData(modelPatchValidator),
        schemaHooks.resolveData(modelPatchResolver),
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
      all: [fastJoin(modelJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
