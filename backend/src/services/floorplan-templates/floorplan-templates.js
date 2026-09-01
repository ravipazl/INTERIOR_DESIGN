// Reusable floor-plan templates (shared / global library).
//
// Stores a saved floor plan so it can be re-applied from the Templates gallery
// without re-importing. The MongoDB collection `floorplan-templates` is created
// automatically on the first save (no migration needed).
//
//   GET    /floorplan-templates        list saved templates (shared by all users)
//   POST   /floorplan-templates        save the current plan { title, size, scene }
//   GET    /floorplan-templates/:id    one template
//   DELETE /floorplan-templates/:id    remove a template
//
// `scene` is the full serialized design ({ floorplan, items }) — the exact shape
// the editor's loadSerialized() consumes, identical to the bundled templates.

import { authenticate } from '@feathersjs/authentication'
import { MongoDBService } from '@feathersjs/mongodb'

class FloorplanTemplateService extends MongoDBService {}

const getOptions = (app) => ({
  paginate: app.get('paginate'),
  Model: app
    .get('mongodbClient')
    .then((db) => db.collection('floorplan-templates'))
})

export const floorplanTemplates = (app) => {
  app.use('floorplan-templates', new FloorplanTemplateService(getOptions(app)), {
    methods: ['find', 'get', 'create', 'remove'],
    events: []
  })

  app.service('floorplan-templates').hooks({
    before: {
      all: [authenticate('jwt')],
      create: [
        async (context) => {
          const userId = context.params?.user?._id
          context.data = {
            ...context.data,
            createdBy: userId ? String(userId) : null,
            createdAt: new Date().toISOString()
          }
        }
      ]
    }
  })
}
