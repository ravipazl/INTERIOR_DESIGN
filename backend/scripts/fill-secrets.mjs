import fs from 'fs'
const OLD = 'C:/pazl_interior-design/pazl-design-backend/.env'
const NEW = 'C:/INTERIOR_DESIGN/backend/.env'
// Copy ONLY these keys from the old env. ANTHROPIC_API_KEY is intentionally
// EXCLUDED — the old one is exposed/compromised and must never be copied to a
// new file; a freshly-rotated key gets pasted in by hand.
const WHITELIST = new Set([
  'SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','SMTP_FROM',
  'TRIPO_API_KEY','TRIPO_BASE','TRIPO_MODEL_VERSION','TRIPO_POLL_INTERVAL_SEC','TRIPO_POLL_TIMEOUT_SEC',
  'SKETCHFAB_TOKEN','SKETCHFAB_LICENSE','MAX_GLB_BYTES','BLENDER_BIN'
])
const parse = (t) => {
  const m = {}
  for (const line of t.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0 && !line.trimStart().startsWith('#')) m[line.slice(0, i).trim()] = line.slice(i + 1)
  }
  return m
}
const oldEnv = parse(fs.readFileSync(OLD, 'utf8'))
let newText = fs.readFileSync(NEW, 'utf8')
const updated = []
for (const key of WHITELIST) {
  if (oldEnv[key] === undefined) continue
  const re = new RegExp('^' + key + '=.*$', 'm')
  const val = oldEnv[key]
  if (re.test(newText)) newText = newText.replace(re, key + '=' + val)
  else newText += `\n${key}=${val}`
  updated.push(key)
}
fs.writeFileSync(NEW, newText)
console.log('Filled from old config (values NOT shown):')
updated.forEach(k => console.log('  ✓ ' + k))
console.log('\nDELIBERATELY LEFT AS PLACEHOLDER (add a rotated key by hand):')
console.log('  • ANTHROPIC_API_KEY  (the old key is compromised — rotate it)')
