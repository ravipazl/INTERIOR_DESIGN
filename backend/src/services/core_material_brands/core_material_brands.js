import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  coreMaterialBrandDataValidator,
  coreMaterialBrandPatchValidator,
  coreMaterialBrandQueryValidator,
  coreMaterialBrandResolver,
  coreMaterialBrandExternalResolver,
  coreMaterialBrandDataResolver,
  coreMaterialBrandPatchResolver,
  coreMaterialBrandQueryResolver
} from './core_material_brands.schema.js'
import { CoreMaterialBrandService, getOptions } from './core_material_brands.class.js'
import { coreMaterialBrandPath, coreMaterialBrandMethods } from './core_material_brands.shared.js'

export * from './core_material_brands.class.js'
export * from './core_material_brands.schema.js'

export const coreMaterialBrand = (app) => {
  app.use(coreMaterialBrandPath, new CoreMaterialBrandService(getOptions(app)), {
    methods: coreMaterialBrandMethods,

    events: []
  })

  app.service(coreMaterialBrandPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(coreMaterialBrandExternalResolver),
        schemaHooks.resolveResult(coreMaterialBrandResolver)
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
        schemaHooks.validateQuery(coreMaterialBrandQueryValidator),
        schemaHooks.resolveQuery(coreMaterialBrandQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(coreMaterialBrandDataValidator),
        schemaHooks.resolveData(coreMaterialBrandDataResolver),
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
        schemaHooks.validateData(coreMaterialBrandPatchValidator),
        schemaHooks.resolveData(coreMaterialBrandPatchResolver),
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
