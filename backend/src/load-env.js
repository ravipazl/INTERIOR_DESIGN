// Loads the service's `.env` (one dir up from this file) if it exists.
//
// Why this file exists:
//   • Node.js does NOT auto-load .env files. We use `dotenv`.
//   • `import "./load-env.js"` MUST be the first import in index.js so these
//     vars are set before app.js reads node-config.
//
// Behaviour:
//   • Server     → `.env` exists (gitignored, real secrets) → it is loaded.
//                  Works on a bare `pm2 resurrect` after reboot WITHOUT relying
//                  on NODE_ENV being injected by pm2 (.env itself sets NODE_ENV).
//   • Local dev  → no `.env` → nothing loaded → app uses config/default.json.
//   • Resolved relative to THIS file, so cwd does not matter.
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
