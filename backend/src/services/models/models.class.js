import { MongoDBService } from '@feathersjs/mongodb'
import { ObjectId } from 'mongodb'

// Model `_id`s in this DB are MIXED: ~450 seeded catalog models use plain
// STRING ids that happen to be valid ObjectId hex (e.g.
// "6a0aeafa413f5b7b973c76fe"), while ~13 user-uploaded models use real
// ObjectIds. The base adapter coerces every valid-hex id to an ObjectId, so
// get/patch/remove on a string-id model fails to match ("No record found for
// id ..."). A blanket disableObjectify would instead break the ObjectId ones.
//
// Fix: match BOTH forms. All single-id operations (get/patch/remove) funnel
// through filterQuery(), which appends an `{ _id: <coerced id> }` clause to
// query.$and. We rewrite that clause to `{ _id: { $in: [string, ObjectId] } }`
// so the lookup matches whichever form the document actually stored.
export class ModelService extends MongoDBService {
  filterQuery(id, params) {
    const result = super.filterQuery(id, params)
    if (id !== null && id !== undefined) {
      const variants = [String(id)]
      if (ObjectId.isValid(id)) {
        variants.push(new ObjectId(String(id)))
      }
      result.query.$and = (result.query.$and || []).map((clause) =>
        clause && Object.prototype.hasOwnProperty.call(clause, this.id)
          ? { [this.id]: { $in: variants } }
          : clause
      )
    }
    return result
  }
}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('models'))
  }
}
