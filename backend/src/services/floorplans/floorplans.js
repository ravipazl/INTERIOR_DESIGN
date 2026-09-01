import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  floorplanDataValidator,
  floorplanPatchValidator,
  floorplanQueryValidator,
  floorplanResolver,
  floorplanExternalResolver,
  floorplanDataResolver,
  floorplanPatchResolver,
  floorplanQueryResolver
} from './floorplans.schema.js'
import { FloorPlanService, getOptions } from './floorplans.class.js'
import { floorplanPath, floorplanMethods } from './floorplans.shared.js'
import { fastJoin } from 'feathers-hooks-common'
export * from './floorplans.class.js'
export * from './floorplans.schema.js'

const floorplanJoinResolver = {
  joins: {
    furnishedModels:
      (...args) =>
      async (char, { app }) => {
        if (char?.projectId) {
          try {
            const furnishedModels = await app.service('furnishedmodels').find({
              query: {
                projectId: char.projectId,
                floorPlanId: char._id,
                isActive: true
              }
            })
            if (furnishedModels?.data?.length) {
              char.furnishedModels = furnishedModels.data
            }
          } catch (error) {
            char.furnishedModels = null
          }
        }
      },
    furnishedModelComponents:
      (...args) =>
      async (char, { app }) => {
        if (char?.projectId) {
          try {
            const furnishedModels = await app.service('furnishedmodels').find({
              query: {
                projectId: char.projectId,
                floorPlanId: char._id,
                isActive: true
              }
            })
            if (furnishedModels?.data?.length) {
              let list = []
              await Promise.all(
                furnishedModels.data.map(async (furnishedModel) => {
                  const furnishedModelComponents = await app
                    .service('furnishedmodelcomponents')
                    .find({ query: { furnishedModelId: furnishedModel._id } })
                  if (furnishedModelComponents?.data?.length) {
                    list = list.concat(furnishedModelComponents.data)
                  }
                })
              )
              char.furnishedModelComponents = list
            }
          } catch (error) {
            char.furnishedModelComponents = null
          }
        }
      }
  }
}

export const floorplan = (app) => {
  app.use(floorplanPath, new FloorPlanService(getOptions(app)), {
    methods: floorplanMethods,

    events: []
  })

  app.service(floorplanPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(floorplanExternalResolver),
        schemaHooks.resolveResult(floorplanResolver)
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
        schemaHooks.validateQuery(floorplanQueryValidator),
        schemaHooks.resolveQuery(floorplanQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(floorplanDataValidator),
        schemaHooks.resolveData(floorplanDataResolver),
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
        schemaHooks.validateData(floorplanPatchValidator),
        schemaHooks.resolveData(floorplanPatchResolver),
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
      all: [fastJoin(floorplanJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
