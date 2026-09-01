import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const componentPropertiesSchema = {
  $id: 'ComponentProperties',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'componentName'],
  properties: {
    _id: { type: 'string' },
    componentName: { type: 'string' },
    coreMaterialTypes: { type: 'array', items: { type: 'string' } },
    coreMaterialThickness: { type: 'array', items: { type: 'string' } },
    exteriorFinishTypes: { type: 'array', items: { type: 'string' } },
    interiorFinishTypes: { type: 'array', items: { type: 'string' } },
    additionalProperties: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const componentPropertiesValidator = getValidator(componentPropertiesSchema, dataValidator)
export const componentPropertiesResolver = resolve({})

export const componentPropertiesExternalResolver = resolve({})

export const componentPropertiesDataSchema = {
  $id: 'componentPropertiesData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...componentPropertiesSchema.properties
  }
}
export const componentPropertiesDataValidator = getValidator(componentPropertiesDataSchema, dataValidator)
export const componentPropertiesDataResolver = resolve({})

export const componentPropertiesPatchSchema = {
  $id: 'componentPropertiesPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...componentPropertiesSchema.properties
  }
}
export const componentPropertiesPatchValidator = getValidator(componentPropertiesPatchSchema, dataValidator)
export const componentPropertiesPatchResolver = resolve({})

export const componentPropertiesQuerySchema = {
  $id: 'ComponentPropertiesQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(componentPropertiesSchema.properties)
  }
}
export const componentPropertiesQueryValidator = getValidator(componentPropertiesQuerySchema, queryValidator)
export const componentPropertiesQueryResolver = resolve({
  id: async (value, componentProperties, context) => {
    if (context.params.componentProperties) {
      return context.params.componentProperties.id
    }

    return value
  }
})
