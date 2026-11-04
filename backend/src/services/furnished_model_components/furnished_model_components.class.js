import { MongoDBService } from '@feathersjs/mongodb'

export class FurnishedModelComponentService extends MongoDBService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then((db) => db.collection('furnished_model_components'))
      .then((collection) => {
        // Every part list is read by its model (furnishedModelId) — the sync
        // and the editor do it once per model. Without this index each read
        // scanned the whole collection (27k parts, ~110 ms each), so opening
        // a project took seconds. Creating it is a no-op once it exists, and
        // a failure must not stop the service from starting.
        collection.createIndex({ furnishedModelId: 1 }).catch(() => {})
        return collection
      })
  }
}
