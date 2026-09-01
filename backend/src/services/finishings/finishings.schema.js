import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const finishingSchema = {
  $id: 'Finishing',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'type'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    categoryId: { type: 'string' },
    brandIds: { type: 'array', items: { type: 'string' } },
    textureId: { type: 'string' },
    grain_direction: { type: 'string' },
    finish_texture: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const finishingValidator = getValidator(finishingSchema, dataValidator)
export const finishingResolver = resolve({})

export const finishingExternalResolver = resolve({})

export const finishingDataSchema = {
  $id: 'finishingData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingSchema.properties
  }
}
export const finishingDataValidator = getValidator(finishingDataSchema, dataValidator)
export const finishingDataResolver = resolve({})

export const finishingPatchSchema = {
  $id: 'finishingPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...finishingSchema.properties
  }
}
export const finishingPatchValidator = getValidator(finishingPatchSchema, dataValidator)
export const finishingPatchResolver = resolve({})

export const finishingQuerySchema = {
  $id: 'finishingQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(finishingSchema.properties)
  }
}
export const finishingQueryValidator = getValidator(finishingQuerySchema, queryValidator)
export const finishingQueryResolver = resolve({
  id: async (value, finishing, context) => {
    if (context.params.finishing) {
      return context.params.finishing.id
    }

    return value
  }
})
