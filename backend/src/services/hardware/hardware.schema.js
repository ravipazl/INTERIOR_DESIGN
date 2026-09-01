import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

// Hardware master: a named line item with a unit price (₹). Used by the BOQ
// hardware picker per object.
export const hardwareSchema = {
  $id: 'Hardware',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    price: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const hardwareValidator = getValidator(hardwareSchema, dataValidator)
export const hardwareResolver = resolve({})

export const hardwareExternalResolver = resolve({})

export const hardwareDataSchema = {
  $id: 'HardwareData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...hardwareSchema.properties
  }
}
export const hardwareDataValidator = getValidator(hardwareDataSchema, dataValidator)
export const hardwareDataResolver = resolve({})

export const hardwarePatchSchema = {
  $id: 'HardwarePatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...hardwareSchema.properties
  }
}
export const hardwarePatchValidator = getValidator(hardwarePatchSchema, dataValidator)
export const hardwarePatchResolver = resolve({})

export const hardwareQuerySchema = {
  $id: 'HardwareQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(hardwareSchema.properties)
  }
}
export const hardwareQueryValidator = getValidator(hardwareQuerySchema, queryValidator)
export const hardwareQueryResolver = resolve({
  id: async (value, hardware, context) => {
    if (context.params.hardware) {
      return context.params.hardware.id
    }

    return value
  }
})
