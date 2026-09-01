import { Entities } from '../../constants.js'

// The furnished_model_components schema is strict (additionalProperties: false)
// and its validator does NOT coerce types. The local-first client writes
// numeric fields as "" (e.g. edgeBandThickness) and can carry resolved nested
// objects / extra keys. Sent as-is, create/patch throw a validation error that
// the sync loop used to swallow silently — so nothing persisted. This whitelists
// and coerces the payload to exactly what the schema accepts.
const COMPONENT_STR_FIELDS = [
  'furnishedModelId',
  'parentComponentId',
  'name',
  // 3D mesh identity ("Mesh_0" …). Must be whitelisted here or the sync strips
  // it, so after reload every grouped part fell back to the group name.
  'meshName',
  'baseMaterialProperties',
  'textureId',
  'locationWithinParent',
  'coreMaterialTypeId',
  'coreMaterialGrade',
  'coreMaterialBrandId',
  'externalFinishClassification',
  'externalFinishBrandId',
  'externalFinishFinishingId',
  'externalFinishGrainDirection',
  'internalFinishClassification',
  'internalFinishBrandId',
  'internalFinishFinishingId',
  'internalFinishGrainDirection',
  'edgeBandColor',
  'height',
  'width',
  'createdAt',
  'updatedAt'
]
const COMPONENT_NUM_FIELDS = ['coreMaterialThickness', 'edgeBandThickness', 'price']
const COMPONENT_BOOL_FIELDS = ['visible', 'exposed']
const COMPONENT_NUM_ARR_FIELDS = ['position', 'scale', 'rotation', 'dimensions']

const cleanComponentData = (item) => {
  const out = {}
  for (const k of COMPONENT_STR_FIELDS) {
    if (item[k] !== undefined && item[k] !== null) out[k] = String(item[k])
  }
  for (const k of COMPONENT_NUM_FIELDS) {
    const n = Number(item[k])
    if (item[k] !== '' && item[k] !== null && item[k] !== undefined && Number.isFinite(n)) {
      out[k] = n
    }
  }
  for (const k of COMPONENT_BOOL_FIELDS) {
    if (item[k] !== undefined && item[k] !== null) out[k] = Boolean(item[k])
  }
  for (const k of COMPONENT_NUM_ARR_FIELDS) {
    if (Array.isArray(item[k])) {
      out[k] = item[k].map(Number).filter((v) => Number.isFinite(v))
    }
  }
  if (Array.isArray(item.additionalProperties)) out.additionalProperties = item.additionalProperties
  return out
}

// When a floorplan's scene is saved, deactivate any furnished_model tied to it
// that the scene no longer references. This guarantees "removed from the scene
// = gone everywhere" regardless of HOW it was removed (delete, floor-plan reset,
// a dropped local-first delete, …), so orphans can't linger in the 3D space or
// the BOQ. Uses the raw collection (string _ids, bulk updateMany).
const reconcileFloorPlanModels = async (app, floorPlanId, sceneStr) => {
  if (!floorPlanId || !sceneStr) return
  try {
    const parsed = JSON.parse(sceneStr)
    const dbids = (parsed?.items || []).map((it) => it?.dbid).filter(Boolean)
    const db = await app.get('mongodbClient')
    const res = await db.collection('furnished_models').updateMany(
      { floorPlanId, isActive: true, _id: { $nin: dbids } },
      { $set: { isActive: false, updatedAt: new Date().toISOString() } }
    )
    if (res.modifiedCount) {
      console.log(
        `[SYNC] reconciled floorplan ${floorPlanId}: deactivated ${res.modifiedCount} orphan model(s)`
      )
    }
  } catch (e) {
    console.log('[SYNC] reconcile skipped:', e.message)
  }
}

export class SyncService {
  constructor(options) {
    this.options = options || {}
  }
  setup(app) {
    this.app = app
  }

  async find(_params) {
    return []
  }

  async get(id, _params) {
    return {
      id: 0,
      text: `A new message with ID: ${id}!`
    }
  }

  async create(data, params) {
    try {
      if (params?.user?.permissions && data?.length) {
        await Promise.all(
        data.map(async (item) => {
          switch (item?.entity) {
            case Entities.FLOOR_PLAN:
              if (item?._id) {
                try {
                  const isFound = await this.app.service('floorplans').get(item._id)
                  if (isFound) {
                    let patchData = { ...item }
                    delete patchData.entity
                    delete patchData._id
                    const resp = await this.app.service('floorplans').patch(item._id, patchData, params)
                  }
                } catch (err) {
                  console.log('err', Entities.FLOOR_PLAN, err)
                  let addData = { ...item }
                  delete addData.entity
                  const resp = await this.app.service('floorplans').create(addData)
                }
                // Safety net: reconcile furnished_models to the saved scene so
                // removed objects can never linger as active orphans.
                await reconcileFloorPlanModels(this.app, item._id, item.scene)
              }
              break
            case Entities.FURNINSHED_MODEL:
              if (item?.isDeleted && item._id) {
                try {
                  const isFound = await this.app.service('furnishedmodels').get(item._id)
                  if (isFound) {
                    const resp = await this.app.service('furnishedmodels').remove(item._id)
                  }
                } catch (err) {
                  console.log('err', Entities.FURNINSHED_MODEL, err)
                }
              } else if (item?._id) {
                try {
                  const isFound = await this.app.service('furnishedmodels').get(item._id)
                  if (isFound) {
                    let patchData = { ...item }
                    delete patchData.entity
                    delete patchData._id
                    const resp = await this.app.service('furnishedmodels').patch(item._id, patchData, params)
                  }
                } catch (err) {
                  console.log('err', Entities.FURNINSHED_MODEL, err)
                  let addData = { ...item }
                  delete addData.entity
                  try {
                    const resp = await this.app.service('furnishedmodels').create(addData)
                    console.log('Creating furnishedModel Response', resp)
                  } catch (err) {
                    console.log('err', Entities.FURNINSHED_MODEL, err)
                  }
                }
              }
              break
            case Entities.FURNINSHED_MODEL_COMPONENT:
              if (item?._id) {
                let isFound = null
                try {
                  isFound = await this.app.service('furnishedmodelcomponents').get(item._id)
                } catch (err) {
                  isFound = null
                }
                try {
                  if (isFound && item?.isDeleted) {
                    await this.app.service('furnishedmodelcomponents').remove(item._id)
                  } else if (isFound) {
                    // Sanitize + coerce so the strict schema validator accepts it.
                    const patchData = cleanComponentData(item)
                    await this.app
                      .service('furnishedmodelcomponents')
                      .patch(item._id, patchData, params)
                  } else if (!item?.isDeleted) {
                    const addData = { _id: item._id, ...cleanComponentData(item) }
                    await this.app.service('furnishedmodelcomponents').create(addData)
                  }
                } catch (err) {
                  // Log LOUDLY — a swallowed error here is exactly what made
                  // finishes silently fail to persist.
                  console.error(
                    '[SYNC] furnishedModelComponent write FAILED for _id=',
                    item._id,
                    '-',
                    err?.message,
                    err?.data ? JSON.stringify(err.data) : ''
                  )
                }
              }
              break
            default:
              break
          }
        })
        )
        return { success: true }
      }
      return { success: false }
    } catch (err) {
      console.log('ERROR', err)
      return { success: false }
    }
  }

  async update(id, data, _params) {
    return {
      id: 0,
      ...data
    }
  }

  async patch(id, data, _params) {
    return {
      id: 0,
      text: `Fallback for ${id}`,
      ...data
    }
  }

  async remove(id, _params) {
    return {
      id: 0,
      text: 'removed'
    }
  }
}

export const getOptions = (app) => {
  return { app }
}
