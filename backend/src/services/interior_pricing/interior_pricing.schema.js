import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const interiorPricingSchema = {
  $id: 'InteriorPricing',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    // The same catalogue the coating rates use — a finish type's grade, and a
    // brand. Only the PRICE is separate; see interior_pricing.class.js.
    finishingCategoryId: { type: 'string' },
    // Nullable: an inner lamination is often quoted without naming a brand,
    // and a rate with no brand is the one used when the part names none.
    finishingBrandId: { type: ['string', 'null'] },
    pricePerSqft: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const interiorPricingValidator = getValidator(interiorPricingSchema, dataValidator)
export const interiorPricingResolver = resolve({})

export const interiorPricingExternalResolver = resolve({})

export const interiorPricingDataSchema = {
  $id: 'InteriorPricingData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...interiorPricingSchema.properties
  }
}
export const interiorPricingDataValidator = getValidator(interiorPricingDataSchema, dataValidator)
export const interiorPricingDataResolver = resolve({})

export const interiorPricingPatchSchema = {
  $id: 'InteriorPricingPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...interiorPricingSchema.properties
  }
}
export const interiorPricingPatchValidator = getValidator(interiorPricingPatchSchema, dataValidator)
export const interiorPricingPatchResolver = resolve({})

export const interiorPricingQuerySchema = {
  $id: 'InteriorPricingQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(interiorPricingSchema.properties)
  }
}
export const interiorPricingQueryValidator = getValidator(interiorPricingQuerySchema, queryValidator)
export const interiorPricingQueryResolver = resolve({})
