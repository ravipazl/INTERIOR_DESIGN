import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

// One collection for the project workspace. `kind` discriminates:
//   document  — client requirement/reference/contract/recording file
//   change    — client change request
//   task      — a to-do
//   discussion— a conversation / decision note
// Fields are a union of all kinds (only the relevant ones are set per row).
export const projectItemSchema = {
  $id: 'ProjectItem',
  type: 'object',
  additionalProperties: false,
  required: ['_id'],
  properties: {
    _id: { type: 'string' },
    projectId: { type: 'string' },
    kind: { type: 'string' }, // document | change | task | discussion
    // document
    type: { type: 'string' }, // Requirement | Reference | Contract | Recording | Other
    title: { type: 'string' },
    fileUrl: { type: 'string' },
    mimeType: { type: 'string' },
    note: { type: 'string' },
    // change request
    description: { type: 'string' },
    status: { type: 'string' }, // pending | in_progress | done | todo
    resolution: { type: 'string' },
    attachmentUrl: { type: 'string' },
    // task
    assignedTo: { type: 'string' },
    dueDate: { type: 'string' },
    completedAt: { type: 'string' },
    // discussion
    text: { type: 'string' },
    author: { type: 'string' },
    // stage_event (project tracker) — one row per stage the project reaches
    stage: { type: 'string' },        // e.g. production, installation …
    expectedDate: { type: 'string' }, // optional estimate shown to the client
    by: { type: 'string' },           // who advanced it
    auto: { type: 'boolean' },        // true = fired by a status change
    // common
    createdBy: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const projectItemValidator = getValidator(projectItemSchema, dataValidator)
export const projectItemResolver = resolve({})

export const projectItemExternalResolver = resolve({})

export const projectItemDataSchema = {
  $id: 'ProjectItemData',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...projectItemSchema.properties
  }
}
export const projectItemDataValidator = getValidator(projectItemDataSchema, dataValidator)
export const projectItemDataResolver = resolve({})

export const projectItemPatchSchema = {
  $id: 'ProjectItemPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...projectItemSchema.properties
  }
}
export const projectItemPatchValidator = getValidator(projectItemPatchSchema, dataValidator)
export const projectItemPatchResolver = resolve({})

export const projectItemQuerySchema = {
  $id: 'ProjectItemQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax(projectItemSchema.properties)
  }
}
export const projectItemQueryValidator = getValidator(projectItemQuerySchema, queryValidator)
export const projectItemQueryResolver = resolve({
  id: async (value, projectItem, context) => {
    if (context.params.projectItem) {
      return context.params.projectItem.id
    }

    return value
  }
})
