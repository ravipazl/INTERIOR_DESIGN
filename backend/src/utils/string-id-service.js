import { MongoDBService } from '@feathersjs/mongodb'
import { NotFound } from '@feathersjs/errors'
import { idQuery } from './id-query.js'

/**
 * A MongoDB service for collections whose `_id` is stored as a STRING.
 *
 * WHY
 * ---
 * Every catalog collection in this database keeps `_id` as text:
 *
 *     categories  finishings  core_material_types
 *     core_material_brands  finishing_brands  finishing_categories
 *
 * The default Feathers adapter casts a 24-hex id to a real ObjectId before
 * querying, so `service.get('6a0ae3ad…')` looks for ObjectId("6a0ae3ad…"),
 * never matches the string-stored row, and throws NotFound — for a record that
 * is sitting right there.
 *
 * That is not cosmetic noise. Generating ONE Bill of Quantity produced hundreds
 * of these failures, and the important one is the finish lookup: the exterior
 * finishing referenced by 1,407 components could never be found, so every one of
 * them silently fell back to a DEFAULT rate instead of the real one.
 *
 *     wrong prices in the BOQ  +  hundreds of wasted round-trips per generation
 *
 * `idQuery` matches BOTH forms, so a genuine ObjectId row still resolves — this
 * only adds a fallback and never changes a lookup that already succeeded.
 * `ProjectService` has done exactly this, for the same reason, since the merge.
 */
export class StringIdMongoService extends MongoDBService {
  async get(id, params = {}) {
    // `null`/`undefined` is not a lookup — leave the adapter's own handling.
    if (id === null || id === undefined) return super.get(id, params)
    const model = await this.getModel(params)
    const doc = await model.findOne(idQuery(id))
    if (!doc) throw new NotFound(`No record found for id '${id}'`)
    return doc
  }

  // WRITES MISS THE SAME ROWS READS USED TO.
  //
  // `get` was fixed when the BOQ needed it, but `patch` and `remove` still go
  // through the default adapter and still cast a 24-hex id to an ObjectId —
  // so editing or deleting a catalog row whose `_id` is the TEXT
  // "6a0ae3ad80c7795ec04c1213" throws NotFound for a record sitting right
  // there. Nothing noticed while these lists were read-only; the Rate Card's
  // Manage lists screen writes to them, and renaming a finish type 404s.
  //
  // Resolving the row first and then writing by its ACTUAL stored `_id` keeps
  // both forms working: a row already stored as a real ObjectId is found by
  // the same query and written exactly as before.

  async patch(id, data, params = {}) {
    // A null id is a multi-patch by query — the adapter handles that correctly.
    if (id === null || id === undefined) return super.patch(id, data, params)
    const model = await this.getModel(params)
    const doc = await model.findOne(idQuery(id))
    if (!doc) throw new NotFound(`No record found for id '${id}'`)
    // `_id` is immutable in Mongo: including it in $set fails the whole write.
    const { _id, ...fields } = data || {}
    if (Object.keys(fields).length) {
      await model.updateOne({ _id: doc._id }, { $set: fields })
    }
    return model.findOne({ _id: doc._id })
  }

  async remove(id, params = {}) {
    if (id === null || id === undefined) return super.remove(id, params)
    const model = await this.getModel(params)
    const doc = await model.findOne(idQuery(id))
    if (!doc) throw new NotFound(`No record found for id '${id}'`)
    await model.deleteOne({ _id: doc._id })
    // Feathers returns the removed record, so callers can report what went.
    return doc
  }
}
