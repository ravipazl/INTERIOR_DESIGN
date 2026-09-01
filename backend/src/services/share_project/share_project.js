import { authenticate } from '@feathersjs/authentication'
import { ShareProjectService, getOptions } from './share_project.class.js'
import { shareProjectPath, shareProjectMethods } from './share_project.shared.js'

export * from './share_project.class.js'

export const shareProject = (app) => {
  app.use(shareProjectPath, new ShareProjectService(getOptions(app)), {
    methods: shareProjectMethods,
    events: []
  })

  app.service(shareProjectPath).hooks({
    around: {
      all: []
    },
    before: {
      all: [],
      find: [authenticate('jwt')],
      get: [authenticate('jwt')],
      create: [authenticate('jwt')],
      patch: [authenticate('jwt')],
      update: [authenticate('jwt')],
      remove: [authenticate('jwt')]
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}
