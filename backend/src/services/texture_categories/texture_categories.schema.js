import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const textureCategorySchema = {
  $id: 'TextureCategory',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const textureCategoryValidator = getValidator(textureCategorySchema, dataValidator)
export const textureCategoryResolver = resolve({})

export const textureCategoryExternalResolver = resolve({})

export const textureCategoryDataSchema = {
  $id: 'TextureCategoryData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...textureCategorySchema.properties
  }
}
export const textureCategoryDataValidator = getValidator(textureCategoryDataSchema, dataValidator)
export const textureCategoryDataResolver = resolve({})

export const textureCategoryPatchSchema = {
  $id: 'TextureCategoryPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...textureCategorySchema.properties
  }
}
export const textureCategoryPatchValidator = getValidator(textureCategoryPatchSchema, dataValidator)
export const textureCategoryPatchResolver = resolve({})

export const textureCategoryQuerySchema = {
  $id: 'TextureCategoryQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(textureCategorySchema.properties)
  }
}
export const textureCategoryQueryValidator = getValidator(textureCategoryQuerySchema, queryValidator)
export const textureCategoryQueryResolver = resolve({
  id: async (value, textureCategory, context) => {
    if (context.params.textureCategory) {
      return context.params.textureCategory.id
    }

    return value
  }
})
