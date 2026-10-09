import { MongoDBService } from '@feathersjs/mongodb'

/**
 * INTERIOR PRICING — what the inside of a cabinet costs per square foot.
 *
 * A SEPARATE TABLE FROM `finishing_pricing`, on purpose. The inside of a
 * carcass is lined with inner lamination — white paper at a few tens of rupees
 * a square foot — while the outside carries a decorative laminate at several
 * hundred. Both were being read from the one coating table, so the only way to
 * price an interior was to give it a laminate's rate and overstate every
 * carcass in the quote.
 *
 * The CATALOGUE is still shared: a row points at the same finishing category
 * and brand the coating rates use, so the finish type / grade / brand lists,
 * the pickers and the component fields are all unchanged. Only the price is
 * looked up somewhere else.
 */
export class InteriorPricingService extends MongoDBService {}

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('interior_pricing'))
  }
}
