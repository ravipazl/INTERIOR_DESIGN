import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const finishingBrandSchema = {
  $id: 'FinishingBrand',
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
export const finishingBrandValidator = getValidator(finishingBrandSchema, dataValidator)
export const finishingBrandResolver = resolve({})

export const finishingBrandExternalResolver = resolve({
  // The password should never be visible externally
  password: async () => undefined
})

export const finishingBrandDataSchema = {
  $id: 'FinishingBrandData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingBrandSchema.properties
  }
}
export const finishingBrandDataValidator = getValidator(finishingBrandDataSchema, dataValidator)
export const finishingBrandDataResolver = resolve({})

export const finishingBrandPatchSchema = {
  $id: 'FinishingBrandPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingBrandSchema.properties
  }
}
export const finishingBrandPatchValidator = getValidator(finishingBrandPatchSchema, dataValidator)
export const finishingBrandPatchResolver = resolve({})

export const finishingBrandQuerySchema = {
  $id: 'FinishingBrandQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(finishingBrandSchema.properties)
  }
}
export const finishingBrandQueryValidator = getValidator(finishingBrandQuerySchema, queryValidator)
export const finishingBrandQueryResolver = resolve({
  id: async (value, finishingBrand, context) => {
    if (context.params.finishingBrand) {
      return context.params.finishingBrand.id
    }

    return value
  }
})
