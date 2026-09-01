import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  textureCategoryDataValidator,
  textureCategoryPatchValidator,
  textureCategoryQueryValidator,
  textureCategoryResolver,
  textureCategoryExternalResolver,
  textureCategoryDataResolver,
  textureCategoryPatchResolver,
  textureCategoryQueryResolver
} from './texture_categories.schema.js'
import { TextureCategoryService, getOptions } from './texture_categories.class.js'
import { textureCategoryPath, textureCategoryMethods } from './texture_categories.shared.js'

export * from './texture_categories.class.js'
export * from './texture_categories.schema.js'

export const textureCategory = (app) => {
  app.use(textureCategoryPath, new TextureCategoryService(getOptions(app)), {
    methods: textureCategoryMethods,

    events: []
  })

  app.service(textureCategoryPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(textureCategoryExternalResolver),
        schemaHooks.resolveResult(textureCategoryResolver)
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
        schemaHooks.validateQuery(textureCategoryQueryValidator),
        schemaHooks.resolveQuery(textureCategoryQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(textureCategoryDataValidator),
        schemaHooks.resolveData(textureCategoryDataResolver),
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
        schemaHooks.validateData(textureCategoryPatchValidator),
        schemaHooks.resolveData(textureCategoryPatchResolver),
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
