import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

// Global key/value settings (e.g. installationRatePerSqft). The _id is the key,
// so each setting is a singleton row.
export const settingSchema = {
  $id: 'Setting',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    key: { type: 'string' },
    value: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const settingValidator = getValidator(settingSchema, dataValidator)
export const settingResolver = resolve({})

export const settingExternalResolver = resolve({})

export const settingDataSchema = {
  $id: 'SettingData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...settingSchema.properties
  }
}
export const settingDataValidator = getValidator(settingDataSchema, dataValidator)
export const settingDataResolver = resolve({})

export const settingPatchSchema = {
  $id: 'SettingPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...settingSchema.properties
  }
}
export const settingPatchValidator = getValidator(settingPatchSchema, dataValidator)
export const settingPatchResolver = resolve({})

export const settingQuerySchema = {
  $id: 'SettingQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(settingSchema.properties)
  }
}
export const settingQueryValidator = getValidator(settingQuerySchema, queryValidator)
export const settingQueryResolver = resolve({
  id: async (value, setting, context) => {
    if (context.params.setting) {
      return context.params.setting.id
    }

    return value
  }
})
