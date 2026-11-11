// Must be FIRST — populates process.env from .env.production (when
// NODE_ENV=production) before app.js reads node-config.
import './load-env.js'
import { app } from './app.js'
import { logger } from './logger.js'
import { appSettingsReady } from './services/app-settings/app-settings.js'

const port = app.get('port')
const host = app.get('host')

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection %O', reason))

// Keys saved on the admin Settings page load before the first request; after
// 10 s the server starts anyway on the .env values.
const settingsLoaded = Promise.race([appSettingsReady, new Promise((r) => setTimeout(r, 10000))])

settingsLoaded
  .then(() => app.listen(port))
  .then(() => {
    logger.info(`Feathers app listening on http://${host}:${port}`)
  })
