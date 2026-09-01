import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const finishingCategorySchema = {
  $id: 'FinishingCategory',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    parentCategoryId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const finishingCategoryValidator = getValidator(finishingCategorySchema, dataValidator)
export const finishingCategoryResolver = resolve({})

export const finishingCategoryExternalResolver = resolve({})

export const finishingCategoryDataSchema = {
  $id: 'FinishingCategoryData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingCategorySchema.properties
  }
}
export const finishingCategoryDataValidator = getValidator(finishingCategoryDataSchema, dataValidator)
export const finishingCategoryDataResolver = resolve({})

export const finishingCategoryPatchSchema = {
  $id: 'FinishingCategoryPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingCategorySchema.properties
  }
}
export const finishingCategoryPatchValidator = getValidator(finishingCategoryPatchSchema, dataValidator)
export const finishingCategoryPatchResolver = resolve({})

export const finishingCategoryQuerySchema = {
  $id: 'FinishingCategoryQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(finishingCategorySchema.properties)
  }
}
export const finishingCategoryQueryValidator = getValidator(finishingCategoryQuerySchema, queryValidator)
export const finishingCategoryQueryResolver = resolve({
  id: async (value, finishingCategory, context) => {
    if (context.params.finishingCategory) {
      return context.params.finishingCategory.id
    }

    return value
  }
})
