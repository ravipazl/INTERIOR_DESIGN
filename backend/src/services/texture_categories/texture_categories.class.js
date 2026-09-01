import { MongoDBService } from '@feathersjs/mongodb'

export class TextureCategoryService extends MongoDBService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('texture_categories'))
  }
}
