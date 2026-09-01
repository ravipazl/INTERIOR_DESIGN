import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const coreMaterialPricingSchema = {
  $id: 'CoreMaterialPricing',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    coreMaterialTypeId: { type: 'string' },
    grade: { type: 'string' },
    thickness: { type: 'number' },
    brandId: { type: 'string' },
    pricePerSqft: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const coreMaterialPricingValidator = getValidator(coreMaterialPricingSchema, dataValidator)
export const coreMaterialPricingResolver = resolve({})

export const coreMaterialPricingExternalResolver = resolve({})

export const coreMaterialPricingDataSchema = {
  $id: 'coreMaterialPricingData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...coreMaterialPricingSchema.properties
  }
}
export const coreMaterialPricingDataValidator = getValidator(coreMaterialPricingDataSchema, dataValidator)
export const coreMaterialPricingDataResolver = resolve({})

export const coreMaterialPricingPatchSchema = {
  $id: 'coreMaterialPricingPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...coreMaterialPricingSchema.properties
  }
}
export const coreMaterialPricingPatchValidator = getValidator(coreMaterialPricingPatchSchema, dataValidator)
export const coreMaterialPricingPatchResolver = resolve({})

export const coreMaterialPricingQuerySchema = {
  $id: 'coreMaterialPricingQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(coreMaterialPricingSchema.properties)
  }
}
export const coreMaterialPricingQueryValidator = getValidator(coreMaterialPricingQuerySchema, queryValidator)
export const coreMaterialPricingQueryResolver = resolve({
  id: async (value, coreMaterialPricing, context) => {
    if (context.params.coreMaterialPricing) {
      return context.params.coreMaterialPricing.id
    }

    return value
  }
})
