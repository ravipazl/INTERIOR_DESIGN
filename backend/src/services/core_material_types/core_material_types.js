import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  coreMaterialTypeDataValidator,
  coreMaterialTypePatchValidator,
  coreMaterialTypeQueryValidator,
  coreMaterialTypeResolver,
  coreMaterialTypeExternalResolver,
  coreMaterialTypeDataResolver,
  coreMaterialTypePatchResolver,
  coreMaterialTypeQueryResolver
} from './core_material_types.schema.js'
import { CoreMaterialTypeService, getOptions } from './core_material_types.class.js'
import { coreMaterialTypePath, coreMaterialTypeMethods } from './core_material_types.shared.js'

export * from './core_material_types.class.js'
export * from './core_material_types.schema.js'

export const coreMaterialType = (app) => {
  app.use(coreMaterialTypePath, new CoreMaterialTypeService(getOptions(app)), {
    methods: coreMaterialTypeMethods,

    events: []
  })

  app.service(coreMaterialTypePath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(coreMaterialTypeExternalResolver),
        schemaHooks.resolveResult(coreMaterialTypeResolver)
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
        schemaHooks.validateQuery(coreMaterialTypeQueryValidator),
        schemaHooks.resolveQuery(coreMaterialTypeQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(coreMaterialTypeDataValidator),
        schemaHooks.resolveData(coreMaterialTypeDataResolver),
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
        schemaHooks.validateData(coreMaterialTypePatchValidator),
        schemaHooks.resolveData(coreMaterialTypePatchResolver),
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
