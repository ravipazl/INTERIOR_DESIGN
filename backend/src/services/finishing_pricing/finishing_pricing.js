import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  finishingPricingDataValidator,
  finishingPricingPatchValidator,
  finishingPricingQueryValidator,
  finishingPricingResolver,
  finishingPricingExternalResolver,
  finishingPricingDataResolver,
  finishingPricingPatchResolver,
  finishingPricingQueryResolver
} from './finishing_pricing.schema.js'
import { FinishingPricingService, getOptions } from './finishing_pricing.class.js'
import { finishingPricingPath, finishingPricingMethods } from './finishing_pricing.shared.js'

export * from './finishing_pricing.class.js'
export * from './finishing_pricing.schema.js'

export const finishingPricing = (app) => {
  app.use(finishingPricingPath, new FinishingPricingService(getOptions(app)), {
    methods: finishingPricingMethods,
    events: []
  })

  app.service(finishingPricingPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(finishingPricingExternalResolver),
        schemaHooks.resolveResult(finishingPricingResolver)
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
        schemaHooks.validateQuery(finishingPricingQueryValidator),
        schemaHooks.resolveQuery(finishingPricingQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(finishingPricingDataValidator),
        schemaHooks.resolveData(finishingPricingDataResolver),
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
        schemaHooks.validateData(finishingPricingPatchValidator),
        schemaHooks.resolveData(finishingPricingPatchResolver),
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
