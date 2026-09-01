import { MongoDBService } from '@feathersjs/mongodb'
import { NotFound } from '@feathersjs/errors'
import { idQuery } from '../../utils/id-query.js'

// The `projects` collection has MIXED _id types:
//   • projects born in the design app have an ObjectId _id;
//   • projects mirrored in from the AI app have a STRING _id (this service's
//     schema declares `_id: { type: 'string' }`, and the mirror POSTs the id as
//     JSON text).
//
// The default MongoDB adapter casts the id in get/patch/remove to an ObjectId,
// so it NEVER matches the string-stored documents — which 404'd the design
// app's "Open Design" for every AI-origin project. The overrides below resolve
// an id against BOTH forms (shared `idQuery` util) and operate on the
// collection directly, bypassing that cast. `find` and `create` are left to the
// adapter: find queries by fields, create assigns the id.
export class ProjectService extends MongoDBService {
  async get(id, params = {}) {
    const model = await this.getModel(params)
    const doc = await model.findOne(idQuery(id))
    if (!doc) throw new NotFound(`No record found for id '${id}'`)
    return doc
  }

  async patch(id, data, params = {}) {
    // Bulk patch (id === null) has no single id to resolve — leave it to the
    // adapter so its query-based behaviour is unchanged.
    if (id === null || id === undefined) {
      return super.patch(id, data, params)
    }
    const model = await this.getModel(params)
    // `_id` is immutable in MongoDB; never let it into the $set.
    const { _id, ...rest } = data || {}
    const result = await model.findOneAndUpdate(
      idQuery(id),
      { $set: rest },
      { returnDocument: 'after' }
    )
    // mongodb driver v5 returns a ModifyResult ({ value }); guard for both shapes.
    const updated = result && typeof result === 'object' && 'value' in result ? result.value : result
    if (!updated) throw new NotFound(`No record found for id '${id}'`)
    return updated
  }

  async remove(id, params = {}) {
    if (id === null || id === undefined) {
      return super.remove(id, params)
    }
    const model = await this.getModel(params)
    const doc = await model.findOne(idQuery(id))
    if (!doc) throw new NotFound(`No record found for id '${id}'`)
    await model.deleteOne({ _id: doc._id })
    return doc
  }
}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('projects'))
  }
}
