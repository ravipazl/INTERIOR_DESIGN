import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const textureSchema = {
  $id: 'Texture',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'fileUrl'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    fileUrl: { type: 'string' },
    materialProperties: { type: 'array', items: { type: 'string' } },
    textureCategoryId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const textureValidator = getValidator(textureSchema, dataValidator)
export const textureResolver = resolve({})

export const textureExternalResolver = resolve({})

export const textureDataSchema = {
  $id: 'textureData',
  type: 'object',
  additionalProperties: false,
  required: ['fileUrl'],
  properties: {
    ...textureSchema.properties
  }
}
export const textureDataValidator = getValidator(textureDataSchema, dataValidator)
export const textureDataResolver = resolve({})

export const texturePatchSchema = {
  $id: 'texturePatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...textureSchema.properties
  }
}
export const texturePatchValidator = getValidator(texturePatchSchema, dataValidator)
export const texturePatchResolver = resolve({})

export const textureQuerySchema = {
  $id: 'textureQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(textureSchema.properties)
  }
}
export const textureQueryValidator = getValidator(textureQuerySchema, queryValidator)
export const textureQueryResolver = resolve({
  id: async (value, texture, context) => {
    if (context.params.texture) {
      return context.params.texture.id
    }

    return value
  }
})
