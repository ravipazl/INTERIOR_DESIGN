// PM2 process configuration for the backend.
//
//     cd backend
//     pm2 start ecosystem.config.cjs
//     pm2 save          # survive a server reboot
//     pm2 logs
//
// Two processes, because they are two runtimes:
//
//   pazl-backend        Node  — the API the browser talks to (port 3400)
//   pazl-image-service  Python — SAM2 / LaMa / rembg / CLIPSeg (port 8199)
//
// The browser only ever reaches the Node one. It proxies /image-edit/* to the
// Python service on 127.0.0.1, so the Python process is never exposed to the
// network — see src/image-edit-proxy.js.
//
// This file replaces the old ecosystem.pazl-imageedit.config.cjs, which pointed
// at /srv/code/Source_Code/pazl_interior-design/pazl-image-service — the layout
// from before the two apps were merged. Paths here are RELATIVE to this file, so
// it works wherever the repo is checked out, on Windows or Linux.
//
// NOTE: secrets are never written here (this file is committed). PM2 inherits
// the shell environment, and the app also reads backend/.env via dotenv.

const path = require('path')

const ROOT = __dirname // backend/

module.exports = {
  apps: [
    {
      name: 'pazl-backend',
      cwd: ROOT,
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      // A Node API leaking past this is a bug worth restarting for.
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'pazl-image-service',
      cwd: ROOT,
      // The launcher resolves the venv interpreter per platform
      // (.venv\Scripts\python.exe on Windows, .venv/bin/python elsewhere), so
      // this entry does not need to know which OS it is on.
      script: 'scripts/run-image-service.js',
      instances: 1, // ONE only — each worker loads every model into RAM
      autorestart: true,
      min_uptime: '40s', // models take seconds to warm; don't call that a crash
      max_restarts: 10,
      kill_timeout: 15000, // let in-flight inference finish before SIGKILL
      max_memory_restart: '6G', // all four models resident; tune to the box
      env: {
        IMAGE_SERVICE_HOST: '127.0.0.1',
        IMAGE_SERVICE_PORT: '8199',
        // Working resolution cap (bounds CPU time and memory).
        PAZL_MAX_DIM: '1536',
        // Mask growth before the LaMa remove (see app/pazl_api.py).
        PAZL_MASK_DILATE: '12',
        // Cleaner rembg cutout edges; set '0' if too slow on this machine.
        PAZL_ALPHA_MATTING: '1',
        // Keep model downloads inside the repo folder so they survive redeploys
        // instead of landing in the deploy user's home directory.
        HF_HOME: path.join(ROOT, 'image-service', 'model-cache', 'hf'),
        TORCH_HOME: path.join(ROOT, 'image-service', 'model-cache', 'torch'),
        U2NET_HOME: path.join(ROOT, 'image-service', 'model-cache', 'u2net'),
        // Don't let the models take every core on a shared box.
        OMP_NUM_THREADS: '4',
        MKL_NUM_THREADS: '4'
      }
    }
  ]
}
