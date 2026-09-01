import { MongoDBService } from '@feathersjs/mongodb'

export class ModelDefaultValuesService extends MongoDBService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('model_default_values'))
  }
}
