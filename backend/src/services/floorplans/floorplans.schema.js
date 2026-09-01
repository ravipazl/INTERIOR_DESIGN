import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const floorplanSchema = {
  $id: 'Floorplan',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    projectId: { type: 'string' },
    scene: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const floorplanValidator = getValidator(floorplanSchema, dataValidator)
export const floorplanResolver = resolve({})

export const floorplanExternalResolver = resolve({})

export const floorplanDataSchema = {
  $id: 'floorplanData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...floorplanSchema.properties
  }
}
export const floorplanDataValidator = getValidator(floorplanDataSchema, dataValidator)
export const floorplanDataResolver = resolve({})

export const floorplanPatchSchema = {
  $id: 'floorplanPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...floorplanSchema.properties
  }
}
export const floorplanPatchValidator = getValidator(floorplanPatchSchema, dataValidator)
export const floorplanPatchResolver = resolve({})

export const floorplanQuerySchema = {
  $id: 'floorplanQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(floorplanSchema.properties)
  }
}
export const floorplanQueryValidator = getValidator(floorplanQuerySchema, queryValidator)
export const floorplanQueryResolver = resolve({
  id: async (value, floorplan, context) => {
    if (context.params.floorplan) {
      return context.params.floorplan.id
    }

    return value
  }
})
