export class VerifyService {
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
    console.log('Inside verify create', data, params)
    try {
      if (data?.auth?.accessToken) {
        const response = await this.app.service('authentication').verifyAccessToken(data.auth.accessToken)
        console.log('verification accessToken response', response)
        if (response?.sub) {
          const user = await this.app.service('users').get(response.sub)
          delete user?.password
          return { ...response, user }
        }
      }
      return { success: false }
    } catch (err) {
      console.error('Error verifying accessToken', err)
      return { success: false }
    }
  }

  // This method has to be added to the 'methods' option to make it available to clients
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
