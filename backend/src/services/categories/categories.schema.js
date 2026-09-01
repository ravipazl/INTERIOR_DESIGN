import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const categoriesSchema = {
  $id: 'Categories',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'name'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    parentCategoryId: { type: 'string' },
    invisible: { type: 'boolean' },
    thumbnail: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const categoriesValidator = getValidator(categoriesSchema, dataValidator)
export const categoriesResolver = resolve({})

export const categoriesExternalResolver = resolve({})

export const categoriesDataSchema = {
  $id: 'categoriesData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...categoriesSchema.properties
  }
}
export const categoriesDataValidator = getValidator(categoriesDataSchema, dataValidator)
export const categoriesDataResolver = resolve({})

export const categoriesPatchSchema = {
  $id: 'categoriesPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...categoriesSchema.properties
  }
}
export const categoriesPatchValidator = getValidator(categoriesPatchSchema, dataValidator)
export const categoriesPatchResolver = resolve({})

export const categoriesQuerySchema = {
  $id: 'categoriesQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(categoriesSchema.properties)
  }
}
export const categoriesQueryValidator = getValidator(categoriesQuerySchema, queryValidator)
export const categoriesQueryResolver = resolve({
  id: async (value, categories, context) => {
    if (context.params.categories) {
      return context.params.categories.id
    }

    return value
  }
})
