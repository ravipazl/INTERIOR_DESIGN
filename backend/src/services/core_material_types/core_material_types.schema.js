import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const coreMaterialTypeSchema = {
  $id: 'CoreMaterialType',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    type: { type: 'string' },
    grades: { type: 'array', items: { type: 'string' } },
    imageUrl: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const coreMaterialTypeValidator = getValidator(coreMaterialTypeSchema, dataValidator)
export const coreMaterialTypeResolver = resolve({})

export const coreMaterialTypeExternalResolver = resolve({})

export const coreMaterialTypeDataSchema = {
  $id: 'coreMaterialTypeData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...coreMaterialTypeSchema.properties
  }
}
export const coreMaterialTypeDataValidator = getValidator(coreMaterialTypeDataSchema, dataValidator)
export const coreMaterialTypeDataResolver = resolve({})

export const coreMaterialTypePatchSchema = {
  $id: 'coreMaterialTypePatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...coreMaterialTypeSchema.properties
  }
}
export const coreMaterialTypePatchValidator = getValidator(coreMaterialTypePatchSchema, dataValidator)
export const coreMaterialTypePatchResolver = resolve({})

export const coreMaterialTypeQuerySchema = {
  $id: 'coreMaterialTypeQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(coreMaterialTypeSchema.properties)
  }
}
export const coreMaterialTypeQueryValidator = getValidator(coreMaterialTypeQuerySchema, queryValidator)
export const coreMaterialTypeQueryResolver = resolve({
  id: async (value, coreMaterialType, context) => {
    if (context.params.coreMaterialType) {
      return context.params.coreMaterialType.id
    }

    return value
  }
})
