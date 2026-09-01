import { v4 as uuidv4 } from 'uuid'
import { ObjectId } from 'mongodb'

const convertMMtoFeet = (unitInMM) => {
  return (parseFloat(unitInMM) || 0) * 0.00328084
}

export class GenerateBoqServiceService {
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
      const floorPlanId = data?.floorPlanId
      if (!floorPlanId) return []

      // Raw Mongo handle. The Feathers MongoDB adapter converts 24-hex string
      // _id query values to ObjectId, so .get()/.find({_id}) return nothing for
      // records stored with string _ids (models, finishings). Query the raw
      // collection to resolve those by their real string id.
      const db = await this.app.get('mongodbClient')

      const getFurnishedModelsResponse = await this.app
        .service('furnishedmodels')
        .find({ query: { floorPlanId: floorPlanId, isActive: true } })
      const furnishedModels = getFurnishedModelsResponse?.data
      console.log('[BOQ] floorPlanId=', floorPlanId, 'models found=', furnishedModels?.length)
      if (!furnishedModels?.length) return []

      // Only price the models the SCENE actually references (by dbid). This
      // ignores orphaned furnished-model records left behind by a remove/reset,
      // so the BOQ always matches what's really in the 3D scene.
      let modelsToPrice = furnishedModels
      // dbid → backsplash config, read straight from the SCENE metadata. The 3D
      // app saves the backsplash there on "updateFloorPlan", so the BOQ can price
      // it WITHOUT needing a separate DB record (freshly-placed items may not
      // have a furnished-model record yet).
      const backsplashByDbid = {}
      try {
        const fp = await this.app.service('floorplans').get(floorPlanId)
        if (fp?.scene) {
          const parsed = JSON.parse(fp.scene)
          const sceneDbids = new Set(
            (parsed?.items || []).map((it) => it?.dbid).filter(Boolean)
          )
          ;(parsed?.items || []).forEach((it) => {
            if (!it?.dbid) return
            // Carry the item's own size (cm) so we can size the backsplash even
            // when the furnished-model record has no dimensions.
            backsplashByDbid[it.dbid] = it.backsplash
              ? { ...it.backsplash, __sizeCm: it.size }
              : null
          })
          // Always price ONLY what the scene references — even when the scene is
          // EMPTY (0 items → price nothing). Previously an `if (size)` guard
          // skipped filtering on an empty scene, so orphaned furnished_models
          // (removed from the scene but still isActive in the DB) were priced.
          // We only fall back to all models if the scene can't be parsed (catch).
          modelsToPrice = furnishedModels.filter((m) => sceneDbids.has(m._id))
        }
      } catch (e) {
        console.log('[BOQ] scene filter skipped:', e.message)
      }
      console.log('[BOQ] models in scene=', modelsToPrice.length)

      const projectId = furnishedModels[0].projectId
      const project = await this.app.service('projects').get(projectId)

      // Option B: a standard board rate to fall back to when a panel has no
      // material assigned. Prefer a BWP grade, else any priced rate.
      const drBWP = await this.app
        .service('corematerialpricing')
        .find({ query: { grade: 'BWP', $limit: 1 } })
      const defaultRate =
        (drBWP?.data?.length
          ? drBWP.data[0]
          : (await this.app.service('corematerialpricing').find({ query: { $limit: 1 } }))
              ?.data?.[0]) || null

      // Handles / legs are NOT auto-priced any more — the user adds the real
      // handle cost via the BOQ's "+ Add hardware" option. The Handle part row
      // still shows (so it's visible it exists) but at ₹0, instead of a fixed
      // ₹1,000 placeholder.
      const handlesLegsPrice = 0
      const items = []

      await Promise.all(
        modelsToPrice.map(async (furnishedModel) => {
          const compsResp = await this.app
            .service('furnishedmodelcomponents')
            .find({ query: { furnishedModelId: furnishedModel._id } })
          const furnishedModelComponents = compsResp?.data
          console.log('[BOQ] model', furnishedModel._id, 'components=', furnishedModelComponents?.length)
          if (!furnishedModelComponents?.length) return

          let totalPrice = 0
          let defaultedCount = 0
          let noRateCount = 0
          const components = []
          const parts = [] // per-part breakdown for the BOQ table

          await Promise.all(
            furnishedModelComponents.map(async (component) => {
              const nameLc = (component.name || '').toLowerCase()

              // Legs: flat unit price. Handles are NO LONGER flat — they now
              // price like a panel (area x board rate + exterior finish rate),
              // using the size + finish set on the handle, per the user's ask.
              if (nameLc.includes('leg')) {
                totalPrice += handlesLegsPrice
                let updated
                try {
                  updated = await this.app
                    .service('furnishedmodelcomponents')
                    .patch(component._id, { price: handlesLegsPrice })
                } catch (e) {
                  updated = { ...component, price: handlesLegsPrice }
                }
                components.push(updated)
                parts.push({
                  name: component.name,
                  area: 0,
                  boardCost: 0,
                  interiorCost: 0,
                  exteriorCost: 0,
                  lineTotal: handlesLegsPrice,
                  exposed: true,
                  usedDefault: false,
                  isHardware: true
                })
                return
              }

              // Panel area (sqft) from the measured length × width
              const area =
                convertMMtoFeet(component.height) * convertMMtoFeet(component.width)

              // --- Material rate: use the panel's own, else the default board ---
              let materialRate = 0
              let usedDefault = false
              if (component.coreMaterialTypeId) {
                const mp = await this.app.service('corematerialpricing').find({
                  query: {
                    coreMaterialTypeId: component.coreMaterialTypeId,
                    grade: component.coreMaterialGrade,
                    brandId: component.coreMaterialBrandId
                  }
                })
                if (mp?.data?.length) {
                  materialRate = mp.data[0].pricePerSqft
                } else {
                  materialRate = defaultRate?.pricePerSqft || 0
                  usedDefault = true
                }
              } else {
                materialRate = defaultRate?.pricePerSqft || 0
                usedDefault = true
              }
              if (usedDefault) defaultedCount++
              if (!materialRate) noRateCount++

              // Resolve a finishing by its string _id via the raw collection
              // (the Feathers adapter would convert the id to ObjectId and miss).
              const resolveFinishing = async (finishingId) => {
                if (!finishingId) return null
                try {
                  return await db.collection('finishings').findOne({ _id: finishingId })
                } catch (e) {
                  return null
                }
              }
              const rateFor = async (categoryId, brandId) => {
                if (!categoryId) return 0
                const q = { finishingCategoryId: categoryId }
                if (brandId) q.finishingBrandId = brandId
                const r = await this.app.service('finishingpricing').find({ query: q })
                return r?.data?.length ? r.data[0].pricePerSqft : 0
              }

              // --- Coating rates: interior always; exterior only if exposed ---
              let interiorRate = 0
              const intFin = await resolveFinishing(component.internalFinishFinishingId)
              if (intFin) {
                interiorRate = await rateFor(intFin.categoryId, component.internalFinishBrandId)
              }
              let exteriorRate = 0
              if (component.exposed) {
                const extFin = await resolveFinishing(component.externalFinishFinishingId)
                if (extFin) {
                  exteriorRate = await rateFor(extFin.categoryId, component.externalFinishBrandId)
                }
              }

              const boardCost = Number((materialRate * area).toFixed(2))
              const interiorCost = Number((interiorRate * area).toFixed(2))
              const exteriorCost = Number((exteriorRate * area).toFixed(2))
              const componentPrice = Number(
                (boardCost + interiorCost + exteriorCost).toFixed(2)
              )
              totalPrice += componentPrice
              let updated
              try {
                updated = await this.app
                  .service('furnishedmodelcomponents')
                  .patch(component._id, { price: componentPrice })
              } catch (e) {
                updated = { ...component, price: componentPrice }
              }
              components.push(updated)
              parts.push({
                name: component.name,
                area: Number(area.toFixed(2)),
                // Per-sqft rates alongside the extended (rate × area) costs.
                boardRate: Number((materialRate || 0).toFixed(2)),
                interiorRate: Number((interiorRate || 0).toFixed(2)),
                exteriorRate: Number((exteriorRate || 0).toFixed(2)),
                boardCost,
                interiorCost,
                exteriorCost,
                lineTotal: componentPrice,
                exposed: !!component.exposed,
                usedDefault,
                isHardware: false
              })
            })
          )

          // BACKSPLASH (Option C): if this cabinet has a backsplash turned on,
          // price it at the standard board (Plywood) rate — the SAME area×rate
          // formula a panel uses. Added as its own BOQ part and rolled into the
          // object total. `dimensions` is [H, W, D] mm, so width = dimensions[1];
          // the panel height is the user-set backsplash height (mm).
          // Read the backsplash from the SCENE (by dbid), falling back to the
          // record field if present.
          const bs = backsplashByDbid[furnishedModel._id] || furnishedModel.backsplash
          console.log(
            '[BOQ] model',
            furnishedModel._id,
            'backsplash=',
            JSON.stringify(bs || null),
            'dims=',
            JSON.stringify(furnishedModel.dimensions || null)
          )
          if (bs && bs.on) {
            // Cabinet width: prefer the furnished-model dimensions [H, W, D] mm;
            // else derive from the scene item's size [x, y, z] cm (x = width).
            const dims = Array.isArray(furnishedModel.dimensions)
              ? furnishedModel.dimensions
              : []
            let widthMm = Number(dims[1]) || 0
            if (!widthMm && Array.isArray(bs.__sizeCm)) {
              widthMm = (Number(bs.__sizeCm[0]) || 0) * 10
            }
            const heightMm = Number(bs.height) || 0
            if (widthMm > 0 && heightMm > 0) {
              const bsArea = convertMMtoFeet(heightMm) * convertMMtoFeet(widthMm)
              // BOARD = Plywood rate × area (Option C).
              const bsRate = Number(defaultRate?.pricePerSqft || 0)
              const bsCost = Number((bsRate * bsArea).toFixed(2))
              if (!bsRate) noRateCount++
              // EXTERIOR = the chosen finish's rate × area (the visible face).
              // Look up the finishing rate by its category, like a panel does.
              let bsExteriorRate = 0
              if (bs.finishingCategoryId) {
                try {
                  const r = await this.app
                    .service('finishingpricing')
                    .find({ query: { finishingCategoryId: bs.finishingCategoryId } })
                  bsExteriorRate = r?.data?.length ? r.data[0].pricePerSqft : 0
                } catch (e) {
                  bsExteriorRate = 0
                }
              }
              const bsExteriorCost = Number((bsExteriorRate * bsArea).toFixed(2))
              const bsLineTotal = Number((bsCost + bsExteriorCost).toFixed(2))
              totalPrice += bsLineTotal
              parts.push({
                name: 'Backsplash',
                area: Number(bsArea.toFixed(2)),
                boardRate: Number(bsRate.toFixed(2)),
                interiorRate: 0,
                exteriorRate: Number(bsExteriorRate.toFixed(2)),
                boardCost: bsCost,
                interiorCost: 0,
                exteriorCost: bsExteriorCost,
                lineTotal: bsLineTotal,
                exposed: true,
                usedDefault: false,
                isHardware: false
              })
            }
          }

          // Per-object manual "other costs" (hardware, handles, …) — sum them
          // into the object price so they flow into the group + grand totals.
          const otherCosts = Array.isArray(furnishedModel.otherCosts)
            ? furnishedModel.otherCosts
            : []
          const otherCostsTotal = Number(
            otherCosts
              .reduce((s, c) => s + (Number(c?.amount) || 0), 0)
              .toFixed(2)
          )
          // Per-object hardware lines: line total = qty × unitPrice.
          const hardwareItems = Array.isArray(furnishedModel.hardwareItems)
            ? furnishedModel.hardwareItems
            : []
          const hardwareTotal = Number(
            hardwareItems
              .reduce(
                (s, h) => s + (Number(h?.qty) || 0) * (Number(h?.unitPrice) || 0),
                0
              )
              .toFixed(2)
          )
          totalPrice = Number(
            (Number(totalPrice) + otherCostsTotal + hardwareTotal).toFixed(2)
          )
          let updatingModelResponse
          try {
            updatingModelResponse = await this.app
              .service('furnishedmodels')
              .patch(furnishedModel._id, {
                price: totalPrice,
                boqGeneratedAt: new Date().toISOString()
              })
          } catch (e) {
            updatingModelResponse = { ...furnishedModel, price: totalPrice }
          }
          // The BOQ table reads item.model.model.{name,thumbnail}; the furnished
          // model result has no catalog model attached, so fetch + attach it.
          //
          // The catalog is a MIX of _id types: older seeded models use STRING
          // ids, while uploaded models (insertOne) get real ObjectId ids. The
          // placement stores modelId as a string either way, so match BOTH forms
          // — otherwise uploaded items find no catalog row and the BOQ shows a
          // blank "Item:" with no name/thumbnail.
          let catalogModel = null
          try {
            const mid = furnishedModel.modelId
            const or = [{ _id: mid }]
            if (typeof mid === 'string' && /^[a-f0-9]{24}$/i.test(mid)) {
              try {
                or.push({ _id: new ObjectId(mid) })
              } catch (_) {
                /* not a valid ObjectId — the string clause still applies */
              }
            }
            catalogModel = await db
              .collection('models')
              .findOne({ $or: or })
          } catch (e) {
            catalogModel = null
          }
          // COMBINE same-named parts into ONE summed BOQ line. Fully DYNAMIC —
          // driven purely by each part's NAME (no hardcoded list). Whatever the
          // parts are named (Carcass / Shutter / Body / Door …) becomes one line
          // with its area + board + interior + exterior + line all SUMMED. The
          // per-sqft rate keeps the group's first (representative) value.
          const mergedParts = []
          const partIdx = new Map()
          for (const p of parts) {
            const key =
              String(p.name || '').trim().toLowerCase() || '__unnamed__'
            if (partIdx.has(key)) {
              const m = mergedParts[partIdx.get(key)]
              m.area = Number(((m.area || 0) + (p.area || 0)).toFixed(2))
              m.boardCost = Number(
                ((m.boardCost || 0) + (p.boardCost || 0)).toFixed(2)
              )
              m.interiorCost = Number(
                ((m.interiorCost || 0) + (p.interiorCost || 0)).toFixed(2)
              )
              m.exteriorCost = Number(
                ((m.exteriorCost || 0) + (p.exteriorCost || 0)).toFixed(2)
              )
              m.lineTotal = Number(
                ((m.lineTotal || 0) + (p.lineTotal || 0)).toFixed(2)
              )
              m.count += 1
              m.exposed = m.exposed || p.exposed
              m.usedDefault = m.usedDefault || p.usedDefault
              m.isHardware = m.isHardware || p.isHardware
            } else {
              partIdx.set(key, mergedParts.length)
              mergedParts.push({ ...p, count: 1 })
            }
          }
          items.push({
            model: { ...updatingModelResponse, model: catalogModel },
            components,
            parts: mergedParts,
            otherCosts,
            otherCostsTotal,
            hardwareItems,
            hardwareTotal,
            installationExcluded: !!furnishedModel.installationExcluded,
            boqFlags: { defaultedCount, noRateCount }
          })
        })
      )

      try {
        await this.app.service('projects').patch(
          projectId,
          project.boqNumber
            ? { revisedBoqNumber: uuidv4().replaceAll('-', '').substring(0, 10).toUpperCase() }
            : { boqNumber: uuidv4().replaceAll('-', '').substring(0, 10).toUpperCase() }
        )
      } catch (e) {
        console.log('[BOQ] project patch skipped:', e.message)
      }

      console.log('[BOQ] returning items=', items.length)
      return items
    } catch (err) {
      console.log('[BOQ] ERROR', err)
      return []
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
