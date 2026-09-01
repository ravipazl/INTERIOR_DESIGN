import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  textureDataValidator,
  texturePatchValidator,
  textureQueryValidator,
  textureResolver,
  textureExternalResolver,
  textureDataResolver,
  texturePatchResolver,
  textureQueryResolver
} from './textures.schema.js'
import { TextureService, getOptions } from './textures.class.js'
import { texturePath, textureMethods } from './textures.shared.js'

export * from './textures.class.js'
export * from './textures.schema.js'

export const texture = (app) => {
  app.use(texturePath, new TextureService(getOptions(app)), {
    methods: textureMethods,

    events: []
  })

  app.service(texturePath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(textureExternalResolver), schemaHooks.resolveResult(textureResolver)],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [schemaHooks.validateQuery(textureQueryValidator), schemaHooks.resolveQuery(textureQueryResolver)],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(textureDataValidator),
        schemaHooks.resolveData(textureDataResolver),
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
        schemaHooks.validateData(texturePatchValidator),
        schemaHooks.resolveData(texturePatchResolver),
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
