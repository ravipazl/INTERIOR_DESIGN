import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  interiorPricingDataValidator,
  interiorPricingPatchValidator,
  interiorPricingQueryValidator,
  interiorPricingResolver,
  interiorPricingExternalResolver,
  interiorPricingDataResolver,
  interiorPricingPatchResolver,
  interiorPricingQueryResolver
} from './interior_pricing.schema.js'
import { InteriorPricingService, getOptions } from './interior_pricing.class.js'
import { interiorPricingPath, interiorPricingMethods } from './interior_pricing.shared.js'

export * from './interior_pricing.class.js'
export * from './interior_pricing.schema.js'

export const interiorPricing = (app) => {
  app.use(interiorPricingPath, new InteriorPricingService(getOptions(app)), {
    methods: interiorPricingMethods,
    events: []
  })

  app.service(interiorPricingPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(interiorPricingExternalResolver),
        schemaHooks.resolveResult(interiorPricingResolver)
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
        schemaHooks.validateQuery(interiorPricingQueryValidator),
        schemaHooks.resolveQuery(interiorPricingQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(interiorPricingDataValidator),
        schemaHooks.resolveData(interiorPricingDataResolver),
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
        schemaHooks.validateData(interiorPricingPatchValidator),
        schemaHooks.resolveData(interiorPricingPatchResolver),
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
