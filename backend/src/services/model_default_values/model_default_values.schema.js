import { resolve, getValidator, querySyntax } from '@feathersjs/schema'

import { dataValidator, queryValidator } from '../../validators.js'

export const modelDefaultValuesSchema = {
  $id: 'ModelDefaultValues',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    modelId: { type: 'string' },
    modelName: { type: 'string' },
    propertyName: { type: 'string' },
    propertyValue: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const modelDefaultValuesValidator = getValidator(modelDefaultValuesSchema, dataValidator)
export const modelDefaultValuesResolver = resolve({})

export const modelDefaultValuesExternalResolver = resolve({})

export const modelDefaultValuesDataSchema = {
  $id: 'ModelDefaultValuesData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...modelDefaultValuesSchema.properties
  }
}
export const modelDefaultValuesDataValidator = getValidator(modelDefaultValuesDataSchema, dataValidator)
export const modelDefaultValuesDataResolver = resolve({})

export const modelDefaultValuesPatchSchema = {
  $id: 'ModelDefaultValuesPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...modelDefaultValuesSchema.properties
  }
}
export const modelDefaultValuesPatchValidator = getValidator(modelDefaultValuesPatchSchema, dataValidator)
export const modelDefaultValuesPatchResolver = resolve({})

export const modelDefaultValuesQuerySchema = {
  $id: 'ModelDefaultValuesQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(modelDefaultValuesSchema.properties)
  }
}
export const modelDefaultValuesQueryValidator = getValidator(modelDefaultValuesQuerySchema, queryValidator)
export const modelDefaultValuesQueryResolver = resolve({
  id: async (value, modelDefaultValues, context) => {
    if (context.params.modelDefaultValues) {
      return context.params.modelDefaultValues.id
    }

    return value
  }
})
