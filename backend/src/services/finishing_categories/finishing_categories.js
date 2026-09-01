import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  finishingCategoryDataValidator,
  finishingCategoryPatchValidator,
  finishingCategoryQueryValidator,
  finishingCategoryResolver,
  finishingCategoryExternalResolver,
  finishingCategoryDataResolver,
  finishingCategoryPatchResolver,
  finishingCategoryQueryResolver
} from './finishing_categories.schema.js'
import { FinishingCategoryService, getOptions } from './finishing_categories.class.js'
import { finishingCategoryPath, finishingCategoryMethods } from './finishing_categories.shared.js'

export * from './finishing_categories.class.js'
export * from './finishing_categories.schema.js'

export const finishingCategory = (app) => {
  app.use(finishingCategoryPath, new FinishingCategoryService(getOptions(app)), {
    methods: finishingCategoryMethods,

    events: []
  })

  app.service(finishingCategoryPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(finishingCategoryExternalResolver),
        schemaHooks.resolveResult(finishingCategoryResolver)
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
        schemaHooks.validateQuery(finishingCategoryQueryValidator),
        schemaHooks.resolveQuery(finishingCategoryQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(finishingCategoryDataValidator),
        schemaHooks.resolveData(finishingCategoryDataResolver),
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
        schemaHooks.validateData(finishingCategoryPatchValidator),
        schemaHooks.resolveData(finishingCategoryPatchResolver),
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
