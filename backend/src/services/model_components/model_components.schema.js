import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const modelComponentSchema = {
  $id: 'ModelComponent',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'name'],
  properties: {
    _id: { type: 'string' },
    modelId: { type: 'string' },
    parentComponentId: { type: 'string' },
    name: { type: 'string' },
    position: { type: 'array', items: { type: 'number' } },
    scale: { type: 'array', items: { type: 'number' } },
    rotation: { type: 'array', items: { type: 'number' } },
    dimensions: { type: 'array', items: { type: 'number' } },
    baseMaterialProperties: { type: 'string' },
    textureId: { type: 'string' },
    visible: { type: 'boolean' },
    exposed: { type: 'boolean' },
    locationWithinParent: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const modelComponentValidator = getValidator(modelComponentSchema, dataValidator)
export const modelComponentResolver = resolve({})

export const modelComponentExternalResolver = resolve({})

export const modelComponentDataSchema = {
  $id: 'modelComponentData',
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    ...modelComponentSchema.properties
  }
}
export const modelComponentDataValidator = getValidator(modelComponentDataSchema, dataValidator)
export const modelComponentDataResolver = resolve({})

export const modelComponentPatchSchema = {
  $id: 'modelComponentPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...modelComponentSchema.properties
  }
}
export const modelComponentPatchValidator = getValidator(modelComponentPatchSchema, dataValidator)
export const modelComponentPatchResolver = resolve({})

export const modelComponentQuerySchema = {
  $id: 'modelComponentQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(modelComponentSchema.properties)
  }
}
export const modelComponentQueryValidator = getValidator(modelComponentQuerySchema, queryValidator)
export const modelComponentQueryResolver = resolve({
  id: async (value, modelComponent, context) => {
    if (context.params.modelComponent) {
      return context.params.modelComponent.id
    }

    return value
  }
})
