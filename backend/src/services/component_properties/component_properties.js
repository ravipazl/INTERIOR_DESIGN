import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  componentPropertiesDataValidator,
  componentPropertiesPatchValidator,
  componentPropertiesQueryValidator,
  componentPropertiesResolver,
  componentPropertiesExternalResolver,
  componentPropertiesDataResolver,
  componentPropertiesPatchResolver,
  componentPropertiesQueryResolver
} from './component_properties.schema.js'
import { ComponentPropertiesService, getOptions } from './component_properties.class.js'
import { componentPropertiesPath, componentPropertiesMethods } from './component_properties.shared.js'

export * from './component_properties.class.js'
export * from './component_properties.schema.js'

export const componentProperties = (app) => {
  app.use(componentPropertiesPath, new ComponentPropertiesService(getOptions(app)), {
    methods: componentPropertiesMethods,

    events: []
  })

  app.service(componentPropertiesPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(componentPropertiesExternalResolver),
        schemaHooks.resolveResult(componentPropertiesResolver)
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
        schemaHooks.validateQuery(componentPropertiesQueryValidator),
        schemaHooks.resolveQuery(componentPropertiesQueryResolver)
      ],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(componentPropertiesDataValidator),
        schemaHooks.resolveData(componentPropertiesDataResolver),
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
        schemaHooks.validateData(componentPropertiesPatchValidator),
        schemaHooks.resolveData(componentPropertiesPatchResolver),
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
