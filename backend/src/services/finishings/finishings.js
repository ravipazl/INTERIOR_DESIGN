import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  finishingDataValidator,
  finishingPatchValidator,
  finishingQueryValidator,
  finishingResolver,
  finishingExternalResolver,
  finishingDataResolver,
  finishingPatchResolver,
  finishingQueryResolver
} from './finishings.schema.js'
import { FinishingService, getOptions } from './finishings.class.js'
import { finishingPath, finishingMethods } from './finishings.shared.js'
import { fastJoin } from 'feathers-hooks-common'
export * from './finishings.class.js'
export * from './finishings.schema.js'

const finishingsJoinResolver = {
  joins: {
    texture:
      (...args) =>
      async (char, { app }) => {
        if (char?.textureId) {
          try {
            const texture = await app.service('textures').get(char.textureId)
            if (texture) {
              char.texture = texture
            }
          } catch (err) {
            char.texture = null
          }
        }
      },
    category:
      (...args) =>
      async (char, { app }) => {
        if (char?.categoryId) {
          try {
            const category = await app.service('finishingcategories').get(char.categoryId)
            if (category) {
              char.category = category
            }
          } catch (err) {
            char.category = null
          }
        }
      },
    brands:
      (...args) =>
      async (char, { app }) => {
        if (char?.brandIds?.length) {
          try {
            const list = []
            await Promise.all(
              char.brandIds.map(async (brandId) => {
                const brand = await app.service('finishingbrands').get(brandId)
                if (brand) list.push(brand)
              })
            )
            char.brands = list
          } catch (err) {
            char.brands = null
          }
        }
      }
  }
}

export const finishing = (app) => {
  app.use(finishingPath, new FinishingService(getOptions(app)), {
    methods: finishingMethods,

    events: []
  })

  app.service(finishingPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(finishingExternalResolver),
        schemaHooks.resolveResult(finishingResolver)
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
        schemaHooks.validateQuery(finishingQueryValidator),
        schemaHooks.resolveQuery(finishingQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(finishingDataValidator),
        schemaHooks.resolveData(finishingDataResolver),
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
        schemaHooks.validateData(finishingPatchValidator),
        schemaHooks.resolveData(finishingPatchResolver),
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
      all: [fastJoin(finishingsJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
