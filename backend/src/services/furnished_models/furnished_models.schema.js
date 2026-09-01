import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const furnishedModelSchema = {
  $id: 'FurnishedModel',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    projectId: { type: 'string' },
    modelId: { type: 'string' },
    position: { type: 'array', items: { type: 'number' } },
    scale: { type: 'array', items: { type: 'number' } },
    rotation: { type: 'array', items: { type: 'number' } },
    dimensions: { type: 'array', items: { type: 'number' } },
    roomId: { type: 'string' },
    roomName: { type: 'string' },
    floorPlanId: { type: 'string' },
    isActive: { type: 'boolean' },
    isHandleChanged: { type: 'boolean' },
    price: { type: 'number' },
    // Per-object manual "other costs" (hardware, handles, edge-banding, …).
    // Each row is a label + amount; summed into the object's BOQ price.
    otherCosts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          amount: { type: 'number' }
        }
      }
    },
    // Exclude this object from installation (e.g. a lamp needs no installation).
    // When true, its area × installation rate is NOT charged. Default = included.
    installationExcluded: { type: 'boolean' },
    // Per-object hardware lines (from the Hardware master, or a one-off "Other").
    // line total = qty × unitPrice; summed into the object's BOQ price.
    hardwareItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          unitPrice: { type: 'number' },
          qty: { type: 'number' },
          fromMaster: { type: 'boolean' }
        }
      }
    },
    // Kitchen backsplash config (from the 3D Properties panel). The BOQ builder
    // reads this to add a priced "Backsplash" line (area × board rate).
    backsplash: {
      type: 'object',
      additionalProperties: false,
      properties: {
        on: { type: 'boolean' },
        height: { type: 'number' }, // mm above the worktop
        attach: { type: 'string' },
        materialUrl: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] }
      }
    },
    boqGeneratedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const furnishedModelValidator = getValidator(furnishedModelSchema, dataValidator)
export const furnishedModelResolver = resolve({})

export const furnishedModelExternalResolver = resolve({})

export const furnishedModelDataSchema = {
  $id: 'furnishedModelData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...furnishedModelSchema.properties
  }
}
export const furnishedModelDataValidator = getValidator(furnishedModelDataSchema, dataValidator)
export const furnishedModelDataResolver = resolve({})

export const furnishedModelPatchSchema = {
  $id: 'furnishedModelPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...furnishedModelSchema.properties
  }
}
export const furnishedModelPatchValidator = getValidator(furnishedModelPatchSchema, dataValidator)
export const furnishedModelPatchResolver = resolve({})

export const furnishedModelQuerySchema = {
  $id: 'furnishedModelQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(furnishedModelSchema.properties)
  }
}
export const furnishedModelQueryValidator = getValidator(furnishedModelQuerySchema, queryValidator)
export const furnishedModelQueryResolver = resolve({
  id: async (value, furnishedModel, context) => {
    if (context.params.furnishedModel) {
      return context.params.furnishedModel.id
    }

    return value
  }
})
