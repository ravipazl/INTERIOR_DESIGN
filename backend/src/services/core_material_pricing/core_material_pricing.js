import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  coreMaterialPricingDataValidator,
  coreMaterialPricingPatchValidator,
  coreMaterialPricingQueryValidator,
  coreMaterialPricingResolver,
  coreMaterialPricingExternalResolver,
  coreMaterialPricingDataResolver,
  coreMaterialPricingPatchResolver,
  coreMaterialPricingQueryResolver
} from './core_material_pricing.schema.js'
import { CoreMaterialPricingService, getOptions } from './core_material_pricing.class.js'
import { coreMaterialPricingPath, coreMaterialPricingMethods } from './core_material_pricing.shared.js'

export * from './core_material_pricing.class.js'
export * from './core_material_pricing.schema.js'

export const coreMaterialPricing = (app) => {
  app.use(coreMaterialPricingPath, new CoreMaterialPricingService(getOptions(app)), {
    methods: coreMaterialPricingMethods,
    events: []
  })

  app.service(coreMaterialPricingPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(coreMaterialPricingExternalResolver),
        schemaHooks.resolveResult(coreMaterialPricingResolver)
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
        schemaHooks.validateQuery(coreMaterialPricingQueryValidator),
        schemaHooks.resolveQuery(coreMaterialPricingQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(coreMaterialPricingDataValidator),
        schemaHooks.resolveData(coreMaterialPricingDataResolver),
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
        schemaHooks.validateData(coreMaterialPricingPatchValidator),
        schemaHooks.resolveData(coreMaterialPricingPatchResolver),
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
