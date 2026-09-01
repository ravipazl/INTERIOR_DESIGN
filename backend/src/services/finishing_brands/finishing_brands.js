import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  finishingBrandDataValidator,
  finishingBrandPatchValidator,
  finishingBrandQueryValidator,
  finishingBrandResolver,
  finishingBrandExternalResolver,
  finishingBrandDataResolver,
  finishingBrandPatchResolver,
  finishingBrandQueryResolver
} from './finishing_brands.schema.js'
import { FinishingBrandsService, getOptions } from './finishing_brands.class.js'
import { finishingBrandPath, finishingBrandMethods } from './finishing_brands.shared.js'

export * from './finishing_brands.class.js'
export * from './finishing_brands.schema.js'

export const finishingBrand = (app) => {
  app.use(finishingBrandPath, new FinishingBrandsService(getOptions(app)), {
    methods: finishingBrandMethods,

    events: []
  })

  app.service(finishingBrandPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(finishingBrandExternalResolver),
        schemaHooks.resolveResult(finishingBrandResolver)
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
        schemaHooks.validateQuery(finishingBrandQueryValidator),
        schemaHooks.resolveQuery(finishingBrandQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(finishingBrandDataValidator),
        schemaHooks.resolveData(finishingBrandDataResolver),
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
        schemaHooks.validateData(finishingBrandPatchValidator),
        schemaHooks.resolveData(finishingBrandPatchResolver),
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
