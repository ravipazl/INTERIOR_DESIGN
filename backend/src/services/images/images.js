// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  imageDataValidator,
  imagePatchValidator,
  imageQueryValidator,
  imageResolver,
  imageExternalResolver,
  imageDataResolver,
  imagePatchResolver,
  imageQueryResolver
} from './images.schema.js'
import { ImageService, getOptions } from './images.class.js'
import { imagePath, imageMethods } from './images.shared.js'

import { fastJoin } from 'feathers-hooks-common'
export * from './images.class.js'
export * from './images.schema.js'

export const allowAnonymous = () => {
  return async (context) => {
    const { params } = context

    if (
      params?.provider &&
      params?.authentication &&
      params?.headers &&
      params?.headers['user-type'] === 'anonymous'
    ) {
      context.params = {
        ...params,
        authentication: {
          ...params.authentication,
          strategy: 'anonymous'
        }
      }
    }

    return context
  }
}

const imagesJoinResolver = {
  joins: {
    inputImage:
      (...args) =>
      async (char, { app }) => {
        if (char?.inputImageId) {
          try {
            const inputImage = await app.service('images').get(char.inputImageId)
            char.inputImage = inputImage
          } catch (error) {
            char.inputImage = null
          }
        }
      }
  }
}
// A configure function that registers the service and its hooks via `app.configure`
export const image = (app) => {
  // Register our service on the Feathers application
  app.use(imagePath, new ImageService(getOptions(app)), {
    // A list of all methods this service exposes externally
    methods: imageMethods,
    // You can add additional custom events to be sent to clients here
    events: []
  })
  // Initialize hooks
  app.service(imagePath).hooks({
    around: {
      all: [schemaHooks.resolveExternal(imageExternalResolver), schemaHooks.resolveResult(imageResolver)],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [schemaHooks.validateData(imagePatchValidator), schemaHooks.resolveData(imagePatchResolver)],
      remove: []
    },
    before: {
      all: [schemaHooks.validateQuery(imageQueryValidator), schemaHooks.resolveQuery(imageQueryResolver)],
      find: [allowAnonymous(), authenticate('jwt', 'anonymous')],
      get: [allowAnonymous(), authenticate('jwt', 'anonymous')],
      create: [
        async (context) => {
          context.data = {
            ...context.data,
            createdAt: new Date().toISOString()
          }
        },
        authenticate('jwt')
      ],
      update: [authenticate('jwt')],
      patch: [authenticate('jwt')],
      remove: [authenticate('jwt')]
    },
    after: {
      all: [fastJoin(imagesJoinResolver)]
    },
    error: {
      all: []
    }
  })
}
