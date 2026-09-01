// POST /whatsapp-test   (Koa route) — DEV / QA ONLY
//
// Fires a single WhatsApp TEMPLATE to a number so you can confirm the Cloud API
// credentials + a template work BEFORE WhatsApp is wired into the real flows.
//
// Guarded by WHATSAPP_TEST_SECRET so it can't be used as an open message relay:
// if that env var isn't set, the endpoint is disabled (403). Remove/disable in
// production once WhatsApp is validated.
//
// JSON body:
//   secret     must equal WHATSAPP_TEST_SECRET            (required)
//   to         recipient phone (normalised server-side)   (required)
//   template   template name (default "hello_world" — Meta's no-variable sample)
//   lang       template language (optional; else WHATSAPP_TEMPLATE_LANG / en_US)
//
// NOTE: while the Meta app is "In development", the recipient must be a verified
// test number, otherwise Meta rejects the send.

import { isWhatsAppEnabled, sendTemplate, sendQuoteReady } from '../../whatsapp.js'

export const whatsappTest = (app) => {
  app.use(async (ctx, next) => {
    if (ctx.path !== '/whatsapp-test' || ctx.method !== 'POST') return next()

    const secret = process.env.WHATSAPP_TEST_SECRET
    if (!secret) {
      ctx.status = 403
      ctx.body = {
        error: 'disabled',
        message: 'Set WHATSAPP_TEST_SECRET in the backend .env to enable this test endpoint.'
      }
      return
    }
    const body = ctx.request.body || {}
    if (body.secret !== secret) {
      ctx.status = 403
      ctx.body = { error: 'forbidden', message: 'Bad or missing secret.' }
      return
    }
    if (!isWhatsAppEnabled()) {
      ctx.status = 400
      ctx.body = {
        error: 'not_configured',
        message: 'WhatsApp is not enabled — set WHATSAPP_ENABLED=true + PHONE_NUMBER_ID + ACCESS_TOKEN.'
      }
      return
    }
    const to = body.to && String(body.to).trim()
    if (!to) {
      ctx.status = 400
      ctx.body = { error: 'missing_to', message: 'Provide a "to" phone number.' }
      return
    }
    // Test the real "quote ready" template (it has variables), with sample data:
    //   { "secret":"...", "to":"...", "quoteReady": { "clientName":"Vikki",
    //     "projectName":"My Project", "quoteToken":"abc123" } }
    if (body.quoteReady) {
      const q = typeof body.quoteReady === 'object' ? body.quoteReady : {}
      const result = await sendQuoteReady({
        to,
        clientName: q.clientName || 'Test Client',
        projectName: q.projectName || 'Test Project',
        quoteToken: q.quoteToken || 'test-token-123'
      })
      ctx.status = result.sent ? 200 : 502
      ctx.body = result
      return
    }

    const template = (body.template && String(body.template).trim()) || 'hello_world'
    const lang = (body.lang && String(body.lang).trim()) || undefined
    const result = await sendTemplate(to, template, [], lang)
    ctx.status = result.sent ? 200 : 502
    ctx.body = result
  })
}
