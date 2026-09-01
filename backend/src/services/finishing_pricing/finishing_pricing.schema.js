import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const finishingPricingSchema = {
  $id: 'FinishingPricing',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    finishingCategoryId: { type: 'string' },
    finishingBrandId: { type: 'string' },
    pricePerSqft: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const finishingPricingValidator = getValidator(finishingPricingSchema, dataValidator)
export const finishingPricingResolver = resolve({})

export const finishingPricingExternalResolver = resolve({})

export const finishingPricingDataSchema = {
  $id: 'FinishingPricingData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingPricingSchema.properties
  }
}
export const finishingPricingDataValidator = getValidator(finishingPricingDataSchema, dataValidator)
export const finishingPricingDataResolver = resolve({})

export const finishingPricingPatchSchema = {
  $id: 'FinishingPricingPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingPricingSchema.properties
  }
}
export const finishingPricingPatchValidator = getValidator(finishingPricingPatchSchema, dataValidator)
export const finishingPricingPatchResolver = resolve({})

export const finishingPricingQuerySchema = {
  $id: 'FinishingPricingQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(finishingPricingSchema.properties)
  }
}
export const finishingPricingQueryValidator = getValidator(finishingPricingQuerySchema, queryValidator)
export const finishingPricingQueryResolver = resolve({
  id: async (value, finishingPricing, context) => {
    if (context.params.finishingPricing) {
      return context.params.finishingPricing.id
    }

    return value
  }
})
