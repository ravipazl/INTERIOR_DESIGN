import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  modelComponentDataValidator,
  modelComponentPatchValidator,
  modelComponentQueryValidator,
  modelComponentResolver,
  modelComponentExternalResolver,
  modelComponentDataResolver,
  modelComponentPatchResolver,
  modelComponentQueryResolver
} from './model_components.schema.js'
import { ModelComponentService, getOptions } from './model_components.class.js'
import { modelComponentPath, modelComponentMethods } from './model_components.shared.js'
import { fastJoin } from 'feathers-hooks-common'
import { healBeforeFind } from './heal.js'
export * from './model_components.class.js'
export * from './model_components.schema.js'

const modelComponentJoinResolver = {
  joins: {
    modelDefaultValues:
      (...args) =>
      async (char, { app }) => {
        if (char?.modelId) {
          try {
            const modelDefaultValues = await app
              .service('modeldefaultvalues')
              .find({ query: { modelId: char.modelId, modelName: char.name } })
            if (modelDefaultValues?.data?.length) {
              char.modelDefaultValues = modelDefaultValues.data
            }
          } catch (err) {
            char.modelDefaultValues = null
          }
        }
      }
  }
}

export const modelComponent = (app) => {
  app.use(modelComponentPath, new ModelComponentService(getOptions(app)), {
    methods: modelComponentMethods,

    events: []
  })

  app.service(modelComponentPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(modelComponentExternalResolver),
        schemaHooks.resolveResult(modelComponentResolver)
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
        schemaHooks.validateQuery(modelComponentQueryValidator),
        schemaHooks.resolveQuery(modelComponentQueryResolver)
      ],
      // healBeforeFind: if this model has no components yet, create them from
      // its GLB before the query runs — so models that were never seeded (e.g.
      // older uploads) fix themselves the first time they're opened.
      find: [authenticate('jwt'), healBeforeFind],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(modelComponentDataValidator),
        schemaHooks.resolveData(modelComponentDataResolver),
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
        schemaHooks.validateData(modelComponentPatchValidator),
        schemaHooks.resolveData(modelComponentPatchResolver),
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
      all: [fastJoin(modelComponentJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
