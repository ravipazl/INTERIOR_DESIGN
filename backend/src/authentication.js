// Merged authentication for the consolidated Interior Design backend.
//
// Previously the design/AI backends verified every JWT by calling the separate
// auth backend over HTTP (PazlJWTStrategy -> POST /verify). In the merged
// backend the auth service lives IN-PROCESS, so we use the standard local
// JWTStrategy (verifies the token against the local `users` collection) — no
// network hop. We keep two customisations that were already in use:
//   * PazlAuthenticationService.getPayload — copies `permissions` into the JWT
//     payload (used across the apps for role checks).
//   * ApiKeyStrategy — the `x-access-token` API-key strategy from the auth
//     backend (used by service-to-service calls like /verify historically).
import {
  AuthenticationService,
  JWTStrategy,
  AuthenticationBaseStrategy
} from '@feathersjs/authentication'
import { LocalStrategy } from '@feathersjs/authentication-local'
import { oauth, OAuthStrategy } from '@feathersjs/authentication-oauth'
import { NotAuthenticated } from '@feathersjs/errors'

class ApiKeyStrategy extends AuthenticationBaseStrategy {
  constructor(app) {
    super()
    this.app = app
  }

  async authenticate(authentication) {
    const { token } = authentication
    const config = this.app.get('authentication').apiKey
    const match = config && config.allowedKeys && config.allowedKeys.includes(token)
    if (!match) throw new NotAuthenticated('Incorrect API Key')
    return { apiKey: true }
  }
}

class AnonymousStrategy extends AuthenticationBaseStrategy {
  async authenticate(authentication, params) {
    return {
      anonymous: true
    }
  }
}

class PazlAuthenticationService extends AuthenticationService {
  async getPayload(authResult, params) {
    const payload = await super.getPayload(authResult, params)
    const { user } = authResult
    if (user && user.permissions) {
      payload.permissions = user.permissions
    }
    return payload
  }
}

export const authentication = (app) => {
  const authentication = new PazlAuthenticationService(app)

  authentication.register('jwt', new JWTStrategy())
  authentication.register('local', new LocalStrategy())
  authentication.register('google', new OAuthStrategy())
  authentication.register('facebook', new OAuthStrategy())
  authentication.register('twitter', new OAuthStrategy())
  authentication.register('github', new OAuthStrategy())
  authentication.register('auth0', new OAuthStrategy())
  authentication.register('apiKey', new ApiKeyStrategy(app))
  authentication.register('anonymous', new AnonymousStrategy())

  app.use('authentication', authentication)
  app.configure(oauth())
}
