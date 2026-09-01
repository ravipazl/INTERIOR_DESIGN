import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  furnishedModelComponentDataValidator,
  furnishedModelComponentPatchValidator,
  furnishedModelComponentQueryValidator,
  furnishedModelComponentResolver,
  furnishedModelComponentExternalResolver,
  furnishedModelComponentDataResolver,
  furnishedModelComponentPatchResolver,
  furnishedModelComponentQueryResolver
} from './furnished_model_components.schema.js'
import { FurnishedModelComponentService, getOptions } from './furnished_model_components.class.js'
import {
  furnishedModelComponentPath,
  furnishedModelComponentMethods
} from './furnished_model_components.shared.js'
import { fastJoin } from 'feathers-hooks-common'
export * from './furnished_model_components.class.js'
export * from './furnished_model_components.schema.js'

const furnishedModelComponentsJoinResolver = {
  joins: {
    furnishedModel:
      (...args) =>
      async (char, { app }) => {
        if (char?.furnishedModelId) {
          try {
            const furnishedModel = await app.service('furnishedmodels').get(char.furnishedModelId)
            if (furnishedModel) {
              char.furnishedModel = furnishedModel
            }
          } catch (error) {
            char.furnishedModel = null
          }
        }
      },
    externalFinishFinishing:
      (...args) =>
      async (char, { app }) => {
        if (char?.externalFinishFinishingId) {
          try {
            const finishing = await app.service('finishings').get(char.externalFinishFinishingId)
            if (finishing) {
              char.externalFinishFinishing = finishing
            }
          } catch (error) {
            char.externalFinishFinishing = null
          }
        }
      },
    internalFinishFinishing:
      (...args) =>
      async (char, { app }) => {
        if (char?.internalFinishFinishingId) {
          try {
            const finishing = await app.service('finishings').get(char.internalFinishFinishingId)
            if (finishing) {
              char.internalFinishFinishing = finishing
            }
          } catch (error) {
            char.internalFinishFinishing = null
          }
        }
      },
    coreMaterialType:
      (...args) =>
      async (char, { app }) => {
        if (char?.coreMaterialTypeId) {
          try {
            const coreMaterialType = await app.service('corematerialtypes').get(char.coreMaterialTypeId)
            if (coreMaterialType) {
              char.coreMaterialType = coreMaterialType
            }
          } catch (error) {
            char.coreMaterialType = null
          }
        }
      },
    coreMaterialBrand:
      (...args) =>
      async (char, { app }) => {
        if (char?.coreMaterialBrandId) {
          try {
            const coreMaterialBrand = await app.service('corematerialbrands').get(char.coreMaterialBrandId)
            if (coreMaterialBrand) {
              char.coreMaterialBrand = coreMaterialBrand
            }
          } catch (error) {
            char.coreMaterialBrand = null
          }
        }
      },
    internalFinishBrand:
      (...args) =>
      async (char, { app }) => {
        if (char?.internalFinishBrandId) {
          try {
            const internalFinishBrand = await app.service('finishingbrands').get(char.internalFinishBrandId)
            if (internalFinishBrand) {
              char.internalFinishBrand = internalFinishBrand
            }
          } catch (error) {
            char.internalFinishBrand = null
          }
        }
      },
    externalFinishBrand:
      (...args) =>
      async (char, { app }) => {
        if (char?.externalFinishBrandId) {
          try {
            const externalFinishBrand = await app.service('finishingbrands').get(char.externalFinishBrandId)
            if (externalFinishBrand) {
              char.externalFinishBrand = externalFinishBrand
            }
          } catch (error) {
            char.externalFinishBrand = null
          }
        }
      },
    componentProperties:
      (...args) =>
      async (char, { app }) => {
        if (char?.name) {
          try {
            const componentProps = await app.service('componentproperties').find({
              query: {
                componentName: `${char.name}`.toLowerCase().includes('panel')
                  ? 'Carcass'
                  : `${char.name}`.toLowerCase().includes('skirting')
                  ? 'Skirting'
                  : char.name
              }
            })
            if (componentProps?.data?.length) {
              char.componentProperties = componentProps.data[0]
            } else {
              char.componentProperties = null
            }
          } catch (error) {
            char.componentProperties = null
          }
        }
      }
  }
}

export const furnishedModelComponent = (app) => {
  app.use(furnishedModelComponentPath, new FurnishedModelComponentService(getOptions(app)), {
    methods: furnishedModelComponentMethods,

    events: []
  })

  app.service(furnishedModelComponentPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(furnishedModelComponentExternalResolver),
        schemaHooks.resolveResult(furnishedModelComponentResolver)
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
        schemaHooks.validateQuery(furnishedModelComponentQueryValidator),
        schemaHooks.resolveQuery(furnishedModelComponentQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(furnishedModelComponentDataValidator),
        schemaHooks.resolveData(furnishedModelComponentDataResolver),
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
        schemaHooks.validateData(furnishedModelComponentPatchValidator),
        schemaHooks.resolveData(furnishedModelComponentPatchResolver),
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
      all: [fastJoin(furnishedModelComponentsJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
