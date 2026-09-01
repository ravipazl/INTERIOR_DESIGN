import { MongoDBService } from '@feathersjs/mongodb'

export class FinishingPricingService extends MongoDBService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('finishing_pricing'))
  }
}
