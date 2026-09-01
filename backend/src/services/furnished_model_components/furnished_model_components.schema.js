import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const furnishedModelComponentSchema = {
  $id: 'FurnishedModelComponent',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    furnishedModelId: { type: 'string' },
    parentComponentId: { type: 'string' },
    name: { type: 'string' },
    // 3D mesh identity ("Mesh_0", "Mesh_2" …) kept SEPARATE from `name` so a
    // part can be renamed/grouped ("Carcass") without losing which mesh it is.
    // Without this the identity was dropped on save (additionalProperties:false),
    // so every part in a group showed the group name after reload.
    meshName: { type: 'string' },
    position: { type: 'array', items: { type: 'number' } },
    scale: { type: 'array', items: { type: 'number' } },
    rotation: { type: 'array', items: { type: 'number' } },
    baseMaterialProperties: { type: 'string' },
    textureId: { type: 'string' },
    visible: { type: 'boolean' },
    exposed: { type: 'boolean' },
    locationWithinParent: { type: 'string' },
    coreMaterialTypeId: { type: 'string' },
    coreMaterialGrade: { type: 'string' },
    coreMaterialBrandId: { type: 'string' },
    coreMaterialThickness: { type: 'number' },
    externalFinishClassification: { type: 'string' },
    externalFinishBrandId: { type: 'string' },
    externalFinishFinishingId: { type: 'string' },
    externalFinishGrainDirection: { type: 'string' },
    internalFinishClassification: { type: 'string' },
    internalFinishBrandId: { type: 'string' },
    internalFinishFinishingId: { type: 'string' },
    internalFinishGrainDirection: { type: 'string' },
    edgeBandThickness: { type: 'number' },
    edgeBandColor: { type: 'string' },
    dimensions: { type: 'array', items: { type: 'number' } },
    additionalProperties: { type: 'array', items: { type: 'object' } },
    price: { type: 'number' },
    height: { type: 'string' },
    width: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const furnishedModelComponentValidator = getValidator(furnishedModelComponentSchema, dataValidator)
export const furnishedModelComponentResolver = resolve({})

export const furnishedModelComponentExternalResolver = resolve({})

export const furnishedModelComponentDataSchema = {
  $id: 'furnishedModelComponentData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...furnishedModelComponentSchema.properties
  }
}
export const furnishedModelComponentDataValidator = getValidator(
  furnishedModelComponentDataSchema,
  dataValidator
)
export const furnishedModelComponentDataResolver = resolve({})

export const furnishedModelComponentPatchSchema = {
  $id: 'furnishedModelComponentPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...furnishedModelComponentSchema.properties
  }
}
export const furnishedModelComponentPatchValidator = getValidator(
  furnishedModelComponentPatchSchema,
  dataValidator
)
export const furnishedModelComponentPatchResolver = resolve({})

export const furnishedModelComponentQuerySchema = {
  $id: 'furnishedModelComponentQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(furnishedModelComponentSchema.properties)
  }
}
export const furnishedModelComponentQueryValidator = getValidator(
  furnishedModelComponentQuerySchema,
  queryValidator
)
export const furnishedModelComponentQueryResolver = resolve({
  id: async (value, furnishedModelComponent, context) => {
    if (context.params.furnishedModelComponent) {
      return context.params.furnishedModelComponent.id
    }

    return value
  }
})
