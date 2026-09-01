import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const modelSchema = {
  $id: 'Model',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'name'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    categoryId: { type: 'string' },
    thumbnail: { type: 'string' },
    modelFileUrl: { type: 'string' },
    description: { type: 'string' },
    hardware: { type: 'string' },
    maxWidth: { type: 'number' },
    dimensions: { type: 'array', items: { type: 'number' } },
    standardWidth: { type: 'array', items: { type: 'number' } },
    price: { type: 'number' },
    type: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const modelValidator = getValidator(modelSchema, dataValidator)
export const modelResolver = resolve({})

export const modelExternalResolver = resolve({})

export const modelDataSchema = {
  $id: 'modelData',
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    ...modelSchema.properties
  }
}
export const modelDataValidator = getValidator(modelDataSchema, dataValidator)
export const modelDataResolver = resolve({})

export const modelPatchSchema = {
  $id: 'modelPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...modelSchema.properties
  }
}
export const modelPatchValidator = getValidator(modelPatchSchema, dataValidator)
export const modelPatchResolver = resolve({})

export const modelQuerySchema = {
  $id: 'modelQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(modelSchema.properties)
  }
}
export const modelQueryValidator = getValidator(modelQuerySchema, queryValidator)
export const modelQueryResolver = resolve({
  id: async (value, model, context) => {
    if (context.params.model) {
      return context.params.model.id
    }

    return value
  }
})
