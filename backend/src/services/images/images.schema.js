// For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { ObjectIdSchema } from '@feathersjs/schema'
import { passwordHash } from '@feathersjs/authentication-local'
import { dataValidator, queryValidator } from '../../validators.js'

// Main data model schema
export const imageSchema = {
  $id: 'Image',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'url'],
  properties: {
    id: ObjectIdSchema(),
    url: { type: 'string' },
    projectID: { type: 'string' },
    imageType: { enum: ['input', 'generated', 'edited'] },
    roomType: { type: 'string' },
    roomName: { type: 'string' },
    userId: { type: 'string' },
    isFavorite: { type: 'boolean' },
    themeImageURL: { type: 'string' },
    inputImageId: { type: 'string' },
    themeName: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' }
  }
}
export const imageValidator = getValidator(imageSchema, dataValidator)
export const imageResolver = resolve({})

export const imageExternalResolver = resolve({})

// Schema for creating new data
export const imageDataSchema = {
  $id: 'ImageData',
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    ...imageSchema.properties
  }
}
export const imageDataValidator = getValidator(imageDataSchema, dataValidator)
export const imageDataResolver = resolve({})

// Schema for updating existing data
export const imagePatchSchema = {
  $id: 'ImagePatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...imageSchema.properties
  }
}
export const imagePatchValidator = getValidator(imagePatchSchema, dataValidator)
export const imagePatchResolver = resolve({})

// Schema for allowed query properties
export const imageQuerySchema = {
  $id: 'ImageQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(imageSchema.properties)
  }
}
export const imageQueryValidator = getValidator(imageQuerySchema, queryValidator)
export const imageQueryResolver = resolve({
  // If there is a image (e.g. with authentication), they are only allowed to see their own data
  id: async (value, image, context) => {
    if (context.params.image) {
      return context.params.image.id
    }

    return value
  }
})
