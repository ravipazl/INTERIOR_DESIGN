import { MongoDBService } from '@feathersjs/mongodb'

export class CoreMaterialBrandService extends MongoDBService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('core_material_brands'))
  }
}
