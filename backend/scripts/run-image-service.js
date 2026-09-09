// Start the Python image-edit service, on any platform.
//
// WHY THIS EXISTS
// ---------------
// The npm script used to hard-code the Windows interpreter path:
//
//     cd image-service && .venv\Scripts\python -m uvicorn app.pazl_api:app ...
//
// A virtualenv puts its interpreter in a DIFFERENT place per platform:
//
//     Windows   .venv\Scripts\python.exe
//     Linux/mac .venv/bin/python
//
// So that command works here and fails on the server with a bare "not found" —
// and the only visible symptom is that Remove object / background removal /
// text-select stop working, with nothing explaining why. This picks the right
// interpreter instead of assuming one.
//
//   node scripts/run-image-service.js            # 127.0.0.1:8199
//   PORT=9000 node scripts/run-image-service.js  # override the port
//
// Host and port come from the environment so production can differ without
// editing code. It stays bound to 127.0.0.1 by default on purpose: the service
// has no user accounts of its own, and the Node backend proxies /image-edit/*
// to it (see src/image-edit-proxy.js), which is where authentication happens.

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const SERVICE_DIR = path.resolve(__dirname, '..', 'image-service')
const VENV = path.join(SERVICE_DIR, '.venv')

const HOST = process.env.IMAGE_SERVICE_HOST || '127.0.0.1'
const PORT = process.env.IMAGE_SERVICE_PORT || process.env.PORT || '8199'

// Both layouts are checked rather than branching on process.platform alone: a
// venv built under WSL or Git Bash on Windows uses the POSIX layout, and that
// combination is easy to hit on this project.
const CANDIDATES = [
  path.join(VENV, 'Scripts', 'python.exe'),
  path.join(VENV, 'Scripts', 'python'),
  path.join(VENV, 'bin', 'python3'),
  path.join(VENV, 'bin', 'python')
]

const python = CANDIDATES.find((p) => fs.existsSync(p))

if (!python) {
  console.error(
    `\nNo Python interpreter found in the virtualenv.\n` +
      `  looked in: ${VENV}\n\n` +
      `The environment has not been created yet. Build it with:\n\n` +
      `    node scripts/setup_image_service.js   (see setup_image_service.py)\n` +
      `    python scripts/setup_image_service.py\n`
  )
  process.exit(1)
}

const args = ['-m', 'uvicorn', 'app.pazl_api:app', '--host', HOST, '--port', String(PORT)]
console.log(`[image-service] ${python}`)
console.log(`[image-service] http://${HOST}:${PORT}\n`)

// cwd is the service folder: uvicorn resolves "app.pazl_api" relative to it.
const child = spawn(python, args, { cwd: SERVICE_DIR, stdio: 'inherit' })

// Pass signals through so Ctrl-C and `pm2 stop` shut uvicorn down cleanly rather
// than orphaning it — it can be holding several GB of model weights.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : code ?? 0)
})
child.on('error', (err) => {
  console.error(`[image-service] failed to start: ${err.message}`)
  process.exit(1)
})
