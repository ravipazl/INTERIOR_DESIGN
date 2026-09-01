// WhatsApp Business Cloud API sender (Meta, direct). The messaging counterpart
// to mailer.js: a small, env-gated module the notification flows call. If
// WHATSAPP_ENABLED isn't "true" or the credentials are missing, EVERY call is a
// safe no-op — nothing throws, nothing blocks the caller.
//
// Env (keep the token in .env only — NEVER commit it):
//   WHATSAPP_ENABLED=true
//   WHATSAPP_PHONE_NUMBER_ID=...
//   WHATSAPP_ACCESS_TOKEN=...                 (permanent System-User token for prod)
//   WHATSAPP_API_VERSION=v21.0                (optional)
//   WHATSAPP_TEMPLATE_QUOTE_READY=quote_ready (optional)
//   WHATSAPP_TEMPLATE_LANG=en_US              (optional; MUST match the approved template)
//
// Business-initiated messages must use a PRE-APPROVED template (Meta rule), so we
// only ever send templates here — never free-form text.

import axios from 'axios'

export const isWhatsAppEnabled = () =>
  String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true' &&
  !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
  !!process.env.WHATSAPP_ACCESS_TOKEN

// Normalise a phone to WhatsApp's E.164 digits (no "+", no spaces). Defaults to
// India (+91) when there's no country code. Returns null for an implausible
// number (e.g. the test value "56") so we never call the API with junk.
export const normalizePhone = (raw, defaultCc = '91') => {
  if (!raw) return null
  let d = String(raw).replace(/[^\d]/g, '') // digits only
  d = d.replace(/^0+/, '') // drop national trunk prefix, e.g. 09444… → 9444…
  if (!d) return null
  // Already carries the country code (e.g. 9194440…) → keep.
  if (d.startsWith(defaultCc) && d.length >= 11) return d
  // A bare 10-digit local number → prepend the default country code.
  if (d.length === 10) return defaultCc + d
  // 11–15 digits already look international → keep as-is.
  if (d.length >= 11 && d.length <= 15) return d
  return null // too short / implausible
}

// Send a pre-approved TEMPLATE message. Best-effort: returns { sent } or
// { sent:false, error }, never throws.
export const sendTemplate = async (to, templateName, components = [], lang) => {
  if (!isWhatsAppEnabled()) return { sent: false, skipped: true, reason: 'disabled' }
  const phone = normalizePhone(to)
  if (!phone) return { sent: false, error: 'invalid_phone' }
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0'
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang || process.env.WHATSAPP_TEMPLATE_LANG || 'en_US' },
      ...(components.length ? { components } : {})
    }
  }
  try {
    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    })
    return { sent: true, id: data?.messages?.[0]?.id }
  } catch (e) {
    const err = e?.response?.data?.error?.message || e?.message || String(e)
    console.warn('[whatsapp] send failed:', err)
    return { sent: false, error: err }
  }
}

// Resolve the client's phone for a project: the project row first, else the
// owner account (design projects usually store none). Returns null if unknown.
export const resolveClientPhone = async (project) => {
  let phone = project?.clientPhoneNumber || ''
  if (!phone && project?.ownerUserId) {
    try {
      const { data: owner } = await axios.get(
        `${process.env.PAZL_AUTH_BACKEND_HOST_URL}/users/${project.ownerUserId}`,
        { headers: { 'x-access-token': `${process.env.PAZL_AUTH_BACKEND_API_KEY}` } }
      )
      phone = owner?.phoneNumber || owner?.phone || ''
    } catch (e) {
      /* no phone reachable */
    }
  }
  return phone || null
}

// "Tracker update" — a milestone/update message. Body vars = client name,
// project name, and the update text. Template must match:
//   "Hi {{1}}, update on your project {{2}}: {{3}}"
export const sendTrackerUpdate = async ({ to, clientName, projectName, message }) => {
  const templateName = process.env.WHATSAPP_TEMPLATE_TRACKER_UPDATE || 'tracker_update'
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: clientName || 'there' },
        { type: 'text', text: projectName || 'your project' },
        { type: 'text', text: message || 'There is an update on your project.' }
      ]
    }
  ]
  return sendTemplate(to, templateName, components)
}

// "Change received" — confirms the client's change request. Body vars = client
// name + project name. Template must match:
//   "Hi {{1}}, we've received your change request for {{2}} and will send a
//    revised quotation shortly."
export const sendChangeReceived = async ({ to, clientName, projectName }) => {
  const templateName = process.env.WHATSAPP_TEMPLATE_CHANGE_RECEIVED || 'change_received'
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: clientName || 'there' },
        { type: 'text', text: projectName || 'your project' }
      ]
    }
  ]
  return sendTemplate(to, templateName, components)
}

// Convenience: the "quote ready" message. Body variables = client name + project
// name; the URL button's dynamic suffix = the share token (→ the no-login quote
// page). The template layout must match this in Meta:
//   Body:   "Hi {{1}}, your interior design quotation for {{2}} is ready to review."
//   Button: Visit website (dynamic) → https://<inspire>/quote/{{1}}
export const sendQuoteReady = async ({ to, clientName, projectName, quoteToken }) => {
  const templateName = process.env.WHATSAPP_TEMPLATE_QUOTE_READY || 'quote_ready'
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: clientName || 'there' },
        { type: 'text', text: projectName || 'your project' }
      ]
    }
  ]
  if (quoteToken) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: quoteToken }]
    })
  }
  return sendTemplate(to, templateName, components)
}
