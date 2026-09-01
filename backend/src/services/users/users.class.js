import { MongoDBService } from '@feathersjs/mongodb'
import { USER_ROLES } from '../../constants.js'

export const getOptions = (app) => {
  return {
    paginate: app.get('paginate'),
    Model: app
      .get('mongodbClient')
      .then((db) => db.collection('users'))
      .then((collection) => {
        collection.createIndex({ email: 1 }, { unique: true })

        return collection
      })
  }
}

// By default calls the standard MongoDB adapter service methods but can be customized with your own functionality.
export class UserService extends MongoDBService {
  setup(app) {
    this.app = app
  }

  async find(params) {
    // Internal (server-side) calls have no `provider` — they come from our own
    // code, not from HTTP, so there is no role to scope by. Without this they
    // fall through the role checks below and silently return [], which broke
    // service-to-service lookups (e.g. the invite/reset "does this email
    // exist?" check). Every external request has `provider` set.
    if (!params?.provider) {
      return super.find(params)
    }
    if (params?.authenticated && (params?.query?.email || params?.apiKey)) {
      return super.find(params)
    } else if (
      params?.user?.permissions === USER_ROLES.ADMIN ||
      params?.user?.permissions === USER_ROLES.SUPER_ADMIN
    ) {
      // Admins / super-admins see EVERY user — team members AND clients. Any
      // filter the caller already passed still narrows the result (e.g.
      // getAllArchitects sends permissions=architect), so the assign-architect
      // dropdown and other filtered lookups are unaffected.
      return super.find(params)
    } else if (
      params?.user?.permissions === USER_ROLES.USER ||
      params?.user?.permissions === USER_ROLES.ARCHITECT
    ) {
      const userId = params?.user?._id
      return super.find({ query: { $and: [{ _id: userId }] } })
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
      const userId = params?.user?._id
      if (id === `${userId}`) {
        return super.update(id, data, params)
      }
    } else if (params?.user?.permissions === USER_ROLES.ARCHITECT) {
      const userId = params?.user?._id
      if (id === `${userId}`) {
        return super.update(id, data, params)
      }
    }
    return []
  }

  async patch(id, data, params) {
    // Internal (server-side) call — trusted, no logged-in user to check. Needed
    // by the invite / set-password flow. Previously these fell through every
    // branch and hit `return []`, i.e. the write SILENTLY did nothing.
    if (!params?.provider) {
      return super.patch(id, data, params)
    }
    if (
      params?.user?.permissions === USER_ROLES.ADMIN ||
      params?.user?.permissions === USER_ROLES.SUPER_ADMIN
    ) {
      return super.patch(id, data, params)
    } else if (params?.user?.permissions === USER_ROLES.USER) {
      const userId = params?.user?._id
      if (id === `${userId}`) {
        return super.patch(id, data, params)
      }
    } else if (params?.user?.permissions === USER_ROLES.ARCHITECT) {
      const userId = params?.user?._id
      if (id === `${userId}`) {
        return super.patch(id, data, params)
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
    }
    return []
  }
}
