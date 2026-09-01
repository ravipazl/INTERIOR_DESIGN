import { MongoDBService } from '@feathersjs/mongodb'
import { USER_ROLES } from '../../constants.js'

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('mongodbClient').then((db) => db.collection('images'))
  }
}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class ImageService extends MongoDBService {
  setup(app) {
    this.app = app
  }

  async find(params) {
    if (
      params?.user?.permissions === USER_ROLES.ADMIN ||
      params?.user?.permissions === USER_ROLES.SUPER_ADMIN
    ) {
      return super.find(params)
    } else if (params?.user?.permissions === USER_ROLES.USER) {
      const projects = await this.app.service('projects').find({ ...params, query: {} })
      if (projects?.data?.length) {
        const projectId = projects?.data[0]?._id
        return super.find({
          query: {
            ...params?.query,
            $and: params?.query['$and']
              ? [...params?.query['$and'], { projectID: `${projectId}` }]
              : [{ projectID: `${projectId}` }]
          }
        })
      }
    } else if (params?.user?.permissions === USER_ROLES.ARCHITECT) {
      const andQuery = params.query['$and']
      const orQuery = params.query['$or']
      const projectID =
        orQuery?.find((item) => item.projectID)?.projectID ??
        andQuery?.find((item) => item.projectID)?.projectID
      const projects = await this.app.service('projects').find({ ...params, query: {} })
      if (projects?.data?.length) {
        const project = projects?.data?.find((item) => {
          const id = item?._id
          return projectID === `${id}`
        })
        if (project) {
          return super.find({ query: { $and: [{ projectID: `${projectID}` }] } })
        }
      }
    } else if (!params?.user && params?.authentication?.strategy === 'anonymous') {
      if (params?.query) {
        const query =
          params?.query['$or']?.find((item) => item?.projectID) ??
          params?.query['$and']?.find((item) => item?.projectID)
        if (query?.projectID) {
          return super.find(params)
        }
      }
    }
    return []
  }

  async get(id, params) {
    return super.get(id, params)
  }

  async create(data, params) {
    return super.create(data, params)
  }

  async update(id, data, params) {
    if (
      params?.user?.permissions === USER_ROLES.ADMIN ||
      params?.user?.permissions === USER_ROLES.SUPER_ADMIN
    ) {
      return super.update(id, data, params)
    } else if (params?.user?.permissions === USER_ROLES.USER) {
      const projects = await this.app.service('projects').find({ ...params, query: {} })
      if (projects?.data?.length) {
        const projectId = projects?.data[0]?._id
        const image = await super.get(id)
        if (image?.projectID === `${projectId}`) {
          return super.update(id, data, params)
        }
      }
    }
    return []
  }

  async patch(id, data, params) {
    if (
      params?.user?.permissions === USER_ROLES.ADMIN ||
      params?.user?.permissions === USER_ROLES.SUPER_ADMIN
    ) {
      return super.patch(id, data, params)
    } else if (params?.user?.permissions === USER_ROLES.USER) {
      const projects = await this.app.service('projects').find({ ...params, query: {} })
      if (projects?.data?.length) {
        const projectId = projects?.data[0]?._id
        const image = await super.get(id)
        if (image?.projectID === `${projectId}`) {
          return super.patch(id, data, params)
        }
      }
    }
    return []
  }

  async remove(id, params) {
    if (
      params?.user?.permissions === USER_ROLES.ADMIN ||
      params?.user?.permissions === USER_ROLES.SUPER_ADMIN
    ) {
      return super.remove(id, params)
    } else if (params?.user?.permissions === USER_ROLES.USER) {
      const projects = await this.app.service('projects').find({ ...params, query: {} })
      if (projects?.data?.length) {
        const projectId = projects?.data[0]?._id
        const image = await super.get(id)
        if (image?.projectID === `${projectId}`) {
          return super.remove(id, params)
        }
      }
    }
    return []
  }
}
