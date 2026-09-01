import axios from 'axios'

export class ShareProjectService {
  constructor(options) {
    this.options = options || {}
  }
  setup(app) {
    this.app = app
  }

  async find(_params) {
    return []
  }

  async get(id, _params) {
    return {
      id: 0,
      text: `A new message with ID: ${id}!`
    }
  }

  async create(data, params) {
    try {
      if (data?.userEmailId && data?.projectId) {
        const getUserResponse = await axios.get(`${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users`, {
          params: {
            '$and[0][email]': data.userEmailId
          },
          headers: {
            'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}`
          }
        })
        if (getUserResponse?.data?.data?.length) {
          const user = getUserResponse.data.data[0]
          const project = await this.app.service('projects').get(data.projectId)
          const response = await this.app.service('projects').patch(
            data.projectId,
            {
              sharedUserIDs: project?.sharedUserIDs?.length
                ? [...project.sharedUserIDs, user._id]
                : [user._id]
            },
            params
          )
        }
        return { success: true }
      }
      return { success: false }
    } catch (err) {
      console.log('ERROR', err)
      return { success: false }
    }
  }

  async update(id, data, _params) {
    return {
      id: 0,
      ...data
    }
  }

  async patch(id, data, _params) {
    return {
      id: 0,
      text: `Fallback for ${id}`,
      ...data
    }
  }

  async remove(id, _params) {
    return {
      id: 0,
      text: 'removed'
    }
  }
}

export const getOptions = (app) => {
  return { app }
}
