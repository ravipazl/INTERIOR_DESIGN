// Proxy: /image-edit/*  ->  the Python image-edit service on 127.0.0.1:8199
//
// WHY
// ---
// The image editing features (remove object, background removal, select-by-text)
// need SAM2 / LaMa / rembg / CLIPSeg — PyTorch models with no Node equivalent, so
// they run in a separate Python process (backend/image-service/).
//
// That process is an IMPLEMENTATION DETAIL. Without this proxy the browser would
// have to know a second host and port, which means a second origin, a second CORS
// policy and a second secret to manage. Instead the frontend talks to ONE backend:
//
//     browser -> :3400 /image-edit/inpaint_mask -> 127.0.0.1:8199 /api/inpaint_mask
//
// The Python service binds to 127.0.0.1 only, so nothing outside this machine can
// reach it directly — every request must come through here, and therefore through
// the auth check below.
//
// NO NEW DEPENDENCY: Node 18+ ships `fetch`, and it can stream a request body,
// which matters because these uploads are multi-megabyte PNGs.

import { authenticate } from '@feathersjs/authentication'

const TARGET = process.env.IMAGE_SERVICE_URL || 'http://127.0.0.1:8199'

// Everything after this prefix is forwarded VERBATIM, so the upstream path is
// whatever the client asked for minus the prefix:
//
//     /image-edit/api/session  ->  http://127.0.0.1:8199/api/session
//
// The prefix is NOT rewritten to add "/api". It used to be, and that double-
// counted: the client already sends "/api/..." (its base URL is the proxy root),
// so requests arrived upstream as /api/api/session and 404'd. Passing the path
// straight through also means a new Python endpoint needs no change here.
const PREFIX = '/image-edit'

// Sent as X-Pazl-Key. Optional: the service treats an unset secret as "open",
// which is fine because it is only reachable from localhost.
const SECRET = process.env.PAZL_IMAGEEDIT_SECRET || ''

export const imageEditProxy = (app) => {
  app.use(async (ctx, next) => {
    if (!ctx.path.startsWith(`${PREFIX}/`)) return next()

    // Require a logged-in user. The Python service itself has no notion of
    // accounts, so this proxy is where authentication happens — previously these
    // endpoints were reachable by anyone who could see the port.
    try {
      await app.service('authentication').create(
        {
          strategy: 'jwt',
          accessToken: (ctx.get('authorization') || '').replace(/^Bearer\s+/i, '')
        },
        {}
      )
    } catch (err) {
      ctx.status = 401
      ctx.body = { name: 'NotAuthenticated', message: 'Authentication required' }
      return
    }

    const upstream = `${TARGET}${ctx.path.slice(PREFIX.length)}${ctx.search || ''}`
    const headers = {}
    const contentType = ctx.get('content-type')
    if (contentType) headers['content-type'] = contentType
    if (SECRET) headers['x-pazl-key'] = SECRET

    try {
      const hasBody = ctx.method !== 'GET' && ctx.method !== 'HEAD'
      const res = await fetch(upstream, {
        method: ctx.method,
        headers,
        // Stream the raw request through instead of buffering it. `duplex: 'half'`
        // is required by Node's fetch whenever the body is a stream.
        //
        // ctx.req (the raw Node request) is used deliberately, NOT ctx.request.body:
        // Feathers' bodyParser has already parsed JSON routes, but multipart uploads
        // are left untouched, and re-encoding them here would corrupt the boundary.
        body: hasBody ? ctx.req : undefined,
        duplex: 'half'
      })

      ctx.status = res.status
      const upstreamType = res.headers.get('content-type')
      if (upstreamType) ctx.set('content-type', upstreamType)
      // Buffered on the way back: responses are single images/JSON, and Koa needs
      // a Buffer or stream. Sizes here are bounded by PAZL_MAX_DIM.
      ctx.body = Buffer.from(await res.arrayBuffer())
    } catch (err) {
      // ECONNREFUSED = the Python service is not running. Say so plainly rather
      // than surfacing a raw socket error to the UI.
      const down = err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED'
      ctx.status = down ? 503 : 502
      ctx.body = {
        name: down ? 'Unavailable' : 'BadGateway',
        message: down
          ? 'The image-edit service is not running. Start it with: npm run image-service'
          : `Image-edit service error: ${err?.message || 'unknown'}`
      }
      if (down) console.error(`[image-edit] service unreachable at ${TARGET}`)
      else console.error('[image-edit] proxy error:', err?.message)
    }
  })
}
