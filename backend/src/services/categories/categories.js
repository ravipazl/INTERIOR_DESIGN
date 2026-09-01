import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  categoriesDataValidator,
  categoriesPatchValidator,
  categoriesQueryValidator,
  categoriesResolver,
  categoriesExternalResolver,
  categoriesDataResolver,
  categoriesPatchResolver,
  categoriesQueryResolver
} from './categories.schema.js'
import { CategoriesService, getOptions } from './categories.class.js'
import { categoriesPath, categoriesMethods } from './categories.shared.js'

export * from './categories.class.js'
export * from './categories.schema.js'

export const categories = (app) => {
  app.use(categoriesPath, new CategoriesService(getOptions(app)), {
    methods: categoriesMethods,
    events: []
  })

  app.service(categoriesPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(categoriesExternalResolver),
        schemaHooks.resolveResult(categoriesResolver)
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
        schemaHooks.validateQuery(categoriesQueryValidator),
        schemaHooks.resolveQuery(categoriesQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(categoriesDataValidator),
        schemaHooks.resolveData(categoriesDataResolver),
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
        schemaHooks.validateData(categoriesPatchValidator),
        schemaHooks.resolveData(categoriesPatchResolver),
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
