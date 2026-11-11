import { resolve, getValidator, querySyntax } from '@feathersjs/schema'
import { dataValidator, queryValidator } from '../../validators.js'

export const projectSchema = {
  $id: 'Project',
  type: 'object',
  additionalProperties: false,
  required: ['_id', 'name'],
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    shareId: { type: 'string' },
    architectUserId: { type: 'string' },
    ownerUserId: { type: 'string' },
    address: { type: 'string' },
    clientName: { type: 'string' },
    status: {
      enum: [
        'open',
        'quotation_requested',
        'quotation_pending_approval',
        'quotation_sent',
        'quotation_accepted',
        'quotation_rejected',
        'closed'
      ]
    },
    defaultUnits: { type: 'string' },
    sharedUserIDs: { type: 'array', items: { type: 'string' } },
    boqNumber: { type: 'string' },
    revisedBoqNumber: { type: 'string' },
    clientGSTNumber: { type: 'string' },
    clientEmail: { type: 'string' },
    clientPhoneNumber: { type: 'string' },
    // Global installation cost for the whole estimate (flat ₹, added to Net).
    installationCost: { type: 'number' },
    // Set true when the client raises a change request on a sent quote — it hides
    // the client's "Accept Quote" bar until the admin sends a NEW quote, which
    // clears it (see projects.js before.patch + project_items.js change hook).
    changeRequestPending: { type: 'boolean' },
    // Why the client rejected a quote. Sent with status 'quotation_rejected'
    // (see ProjectDetail's reject flow). It was missing here, and because this
    // schema is `additionalProperties: false` the whole PATCH was rejected with
    // 400 — so rejecting a quote failed outright and the reason never reached
    // anyone.
    rejectReason: { type: 'string' },
    // Which image the client picked in "Choose an image to send for quote".
    // Declared here so the PATCH is accepted — this schema is
    // `additionalProperties: false`, so an undeclared key fails the WHOLE
    // request with 400. The quote-request notification reads it to embed that
    // image in the admin's email (see projects.js).
    quoteImageId: { type: 'string' },
    // The full set the client ticked — a quote usually covers several designs.
    // `quoteImageId` above is kept (holding the first) so projects saved before
    // multi-select, and anything still reading the single field, keep working.
    quoteImageIds: { type: 'array', items: { type: 'string' } },
    // Header bell (Inspire AppHeader). Declared so the bell's "mark as read"
    // PATCH is accepted — it was rejected with 400 before, so a notification
    // could never be cleared. The *At times are stamped by projects.js when the
    // status / architect really changes; the *ReadAt ones by the bell.
    statusChangedAt: { type: 'string' },
    quoteRequestedAt: { type: 'string' },
    quoteRequestReadAt: { type: 'string' },
    // Admin bell, one read time per status, so reading "Quotation requested"
    // doesn't also hide the same project's later "Pending approval" item.
    bellReads: { type: 'object', additionalProperties: { type: 'string' } },
    architectAssignedAt: { type: 'string' },
    architectAssignmentReadAt: { type: 'string' },
    architectUpdateAt: { type: 'string' },
    architectUpdateReadAt: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}
export const projectValidator = getValidator(projectSchema, dataValidator)
export const projectResolver = resolve({})

export const projectExternalResolver = resolve({})

export const projectDataSchema = {
  $id: 'projectData',
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    ...projectSchema.properties
  }
}
export const projectDataValidator = getValidator(projectDataSchema, dataValidator)
export const projectDataResolver = resolve({})

export const projectPatchSchema = {
  $id: 'projectPatch',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    ...projectSchema.properties
  }
}
export const projectPatchValidator = getValidator(projectPatchSchema, dataValidator)
export const projectPatchResolver = resolve({})

export const projectQuerySchema = {
  $id: 'projectQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    ...querySyntax({
      ...projectSchema.properties,
      sharedUserIDs: { type: 'string' }
    })
  }
}
export const projectQueryValidator = getValidator(projectQuerySchema, queryValidator)
export const projectQueryResolver = resolve({
  id: async (value, project, context) => {
    if (context.params.project) {
      return context.params.project.id
    }

    return value
  }
})
