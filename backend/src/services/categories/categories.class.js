// This collection stores `_id` as a STRING. The default adapter casts a
// 24-hex id to ObjectId, so get() misses every row — see StringIdMongoService.
import { StringIdMongoService } from '../../utils/string-id-service.js'

export class CategoriesService extends StringIdMongoService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('categories'))
  }
}
