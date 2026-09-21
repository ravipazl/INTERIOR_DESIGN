import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import {
  modelComponentDataValidator,
  modelComponentPatchValidator,
  modelComponentQueryValidator,
  modelComponentResolver,
  modelComponentExternalResolver,
  modelComponentDataResolver,
  modelComponentPatchResolver,
  modelComponentQueryResolver
} from './model_components.schema.js'
import { ModelComponentService, getOptions } from './model_components.class.js'
import { modelComponentPath, modelComponentMethods } from './model_components.shared.js'
import { fastJoin } from 'feathers-hooks-common'
import { healBeforeFind } from './heal.js'
export * from './model_components.class.js'
export * from './model_components.schema.js'

const modelComponentJoinResolver = {
  joins: {
    modelDefaultValues:
      (...args) =>
      async (char, { app }) => {
        if (char?.modelId) {
          try {
            const modelDefaultValues = await app
              .service('modeldefaultvalues')
              .find({ query: { modelId: char.modelId, modelName: char.name } })
            if (modelDefaultValues?.data?.length) {
              char.modelDefaultValues = modelDefaultValues.data
            }
          } catch (err) {
            char.modelDefaultValues = null
          }
        }
      }
  }
}

// find() returns every part of a model; the join above looks up each part's
// defaults with its own service call (plus one finishing lookup per default),
// so an 11-part model cost 11+ database round trips on every add. This does the
// same for a whole page of results in two queries. Same output shape:
// modelDefaultValues is set only when a part has defaults (else left as is),
// each externalFinishFinishingId default carries its `property` finishing, and
// a failure leaves modelDefaultValues null — as the per-part join did.
const batchModelDefaultValues = async (context) => {
  const rows = Array.isArray(context.result) ? context.result : context.result?.data
  if (!Array.isArray(rows) || !rows.length) return context
  try {
    const db = await context.app.get('mongodbClient')
    const modelIds = [...new Set(rows.map((r) => r?.modelId).filter(Boolean))]
    const names = [...new Set(rows.map((r) => r?.name).filter(Boolean))]
    if (!modelIds.length) return context
    const defaults = await db
      .collection('model_default_values')
      .find({ modelId: { $in: modelIds }, modelName: { $in: names } })
      .toArray()
    const finishIds = [
      ...new Set(
        defaults
          .filter((d) => d.propertyName === 'externalFinishFinishingId' && d.propertyValue)
          .map((d) => d.propertyValue)
      )
    ]
    const finishings = finishIds.length
      ? await db.collection('finishings').find({ _id: { $in: finishIds } }).toArray()
      : []
    const finishingById = new Map(finishings.map((f) => [String(f._id), f]))
    for (const d of defaults) {
      if (d.propertyName === 'externalFinishFinishingId' && d.propertyValue) {
        d.property = finishingById.get(String(d.propertyValue)) ?? null
      }
    }
    for (const row of rows) {
      if (!row?.modelId) continue
      const mine = defaults.filter((d) => d.modelId === row.modelId && d.modelName === row.name)
      if (mine.length) row.modelDefaultValues = mine
    }
  } catch (err) {
    for (const row of rows) {
      if (row?.modelId) row.modelDefaultValues = null
    }
  }
  return context
}

const joinModelDefaultValues = fastJoin(modelComponentJoinResolver)

export const modelComponent = (app) => {
  app.use(modelComponentPath, new ModelComponentService(getOptions(app)), {
    methods: modelComponentMethods,

    events: []
  })

  app.service(modelComponentPath).hooks({
    around: {
      all: [
        schemaHooks.resolveExternal(modelComponentExternalResolver),
        schemaHooks.resolveResult(modelComponentResolver)
      ],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    before: {
      all: [
        schemaHooks.validateQuery(modelComponentQueryValidator),
        schemaHooks.resolveQuery(modelComponentQueryResolver)
      ],
      // healBeforeFind: if this model has no components yet, create them from
      // its GLB before the query runs — so models that were never seeded (e.g.
      // older uploads) fix themselves the first time they're opened.
      find: [authenticate('jwt'), healBeforeFind],
      get: [authenticate('jwt')],
      create: [
        authenticate('jwt'),
        schemaHooks.validateData(modelComponentDataValidator),
        schemaHooks.resolveData(modelComponentDataResolver),
        async (context) => {
          context.data = {
            ...context.data,
            createdAt: new Date().toISOString()
          }
        }
      ],
      update: [authenticate('jwt')],
      patch: [
        authenticate('jwt'),
        schemaHooks.validateData(modelComponentPatchValidator),
        schemaHooks.resolveData(modelComponentPatchResolver),
        async (context) => {
          context.data = {
            ...context.data,
            updatedAt: new Date().toISOString()
          }
        }
      ],
      remove: [authenticate('jwt')]
    },
    after: {
      all: [
        (context) =>
          context.method === 'find'
            ? batchModelDefaultValues(context)
            : joinModelDefaultValues(context)
      ]
    },
    error: {
      all: []
    }
  })
}
