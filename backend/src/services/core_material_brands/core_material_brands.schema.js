import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const coreMaterialBrandSchema = {
  $id: 'CoreMaterialBrand',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'name'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const coreMaterialBrandValidator = getValidator(coreMaterialBrandSchema, dataValidator)
export const coreMaterialBrandResolver = resolve({})

export const coreMaterialBrandExternalResolver = resolve({})

export const coreMaterialBrandDataSchema = {
  $id: 'coreMaterialBrandData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...coreMaterialBrandSchema.properties
  }
}
export const coreMaterialBrandDataValidator = getValidator(coreMaterialBrandDataSchema, dataValidator)
export const coreMaterialBrandDataResolver = resolve({})

export const coreMaterialBrandPatchSchema = {
  $id: 'coreMaterialBrandPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...coreMaterialBrandSchema.properties
  }
}
export const coreMaterialBrandPatchValidator = getValidator(coreMaterialBrandPatchSchema, dataValidator)
export const coreMaterialBrandPatchResolver = resolve({})

export const coreMaterialBrandQuerySchema = {
  $id: 'coreMaterialBrandQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(coreMaterialBrandSchema.properties)
  }
}
export const coreMaterialBrandQueryValidator = getValidator(coreMaterialBrandQuerySchema, queryValidator)
export const coreMaterialBrandQueryResolver = resolve({
  id: async (value, coreMaterialBrand, context) => {
    if (context.params.coreMaterialBrand) {
      return context.params.coreMaterialBrand.id
    }

    return value
  }
})
