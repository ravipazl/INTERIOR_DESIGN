import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

// THE SCHEMA DID NOT DESCRIBE THE ROWS IN THE COLLECTION.
//
// Every seeded category carries `type` ("wall") and a `parentCategoryId` that
// is null on a top-level finish type — but `type` was missing from the
// properties and `parentCategoryId` was declared string-only. With
// `additionalProperties: false` that meant the API could not create a row
// shaped like the eight rows already sitting there: a top-level type failed on
// the null parent, and every category failed on `type`.
//
// It went unnoticed because the seed was inserted straight into Mongo, which
// validates nothing. The Rate Card's Manage lists screen is the first thing to
// create one through the service, and it got "validation failed".
//
// This only widens what is accepted, to exactly what the collection already
// holds — nothing that validated before stops validating.
export const finishingCategorySchema = {
  $id: 'FinishingCategory',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    // null = a top-level finish type; a string = the type a style sits under.
    parentCategoryId: { type: ['string', 'null'] },
    // The surface the finish applies to. Every existing category is 'wall';
    // `finishings` also uses 'floor', so this is left as a free string rather
    // than an enum that would reject a surface added later.
    type: { type: 'string' },
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
