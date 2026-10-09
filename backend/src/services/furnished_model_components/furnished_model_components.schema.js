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
    // NULL IS A REAL VALUE HERE — "no brand chosen", "no finish chosen" — and
    // the collection is already full of it: 1,888 components store a null
    // external brand and 1,946 a null internal one. Declaring these
    // string-only made the service reject its OWN data: any patch clearing a
    // brand, or setting a finish without one, came back 400 "validation
    // failed". It stayed hidden only because every write so far happened to
    // carry a brand.
    externalFinishBrandId: { type: ['string', 'null'] },
    externalFinishFinishingId: { type: ['string', 'null'] },
    externalFinishGrainDirection: { type: 'string' },
    internalFinishClassification: { type: 'string' },
    internalFinishBrandId: { type: ['string', 'null'] },
    internalFinishFinishingId: { type: ['string', 'null'] },
    // THE INSIDE IS PRICED BY TYPE, NOT BY SWATCH.
    //
    // `internalFinishFinishingId` names a swatch — "Wood 10002" — because the
    // 3D editor lets you paint the inside of a part with a specific decor. But
    // an interior RATE is one price for a whole type: the inside of a carcass
    // is white inner lamination, and there is no Wood Grain version of it.
    //
    // So the BOQ's room-level control writes the TYPE here and the engine
    // prices from it directly. Without this field a room-level choice would
    // have no swatch to record, the rate lookup would find nothing, and every
    // carcass would quietly come out free — the failure that still produces a
    // believable bill.
    //
    // Nothing is replaced: a part that only has a swatch is still priced by
    // resolving that swatch up to its type.
    internalFinishCategoryId: { type: ['string', 'null'] },
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
