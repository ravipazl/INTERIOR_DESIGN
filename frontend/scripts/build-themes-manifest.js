// Generates `public/themes/themes.json` from the actual file structure under
// `public/themes/<Style>/<RoomType>/<image>.{jpg|png|webp|jpeg}`.
//
// This replaces the previous DigitalOcean Spaces XML-listing approach: at
// runtime the frontend fetches this static manifest and uses it as the
// theme catalogue (see src/TypeStore.js).
//
// Runs automatically:
//   • `npm start`      → via "prestart" script in package.json
//   • `npm run build`  → via "prebuild" script in package.json
//
// Run manually:
//   node scripts/build-themes-manifest.js
//
// Output shape (one entry per image file):
//   [
//     {
//       "theme_name": "Modern",
//       "room_type":  "LivingRoom",
//       "image_name": "modern-living-1.jpg",
//       "url":        "/themes/Modern/LivingRoom/modern-living-1.jpg"
//     },
//     ...
//   ]
//
// Notes:
//   • `.DS_Store` and other non-image files are skipped.
//   • If `public/themes/` is missing OR empty, an empty array is written and
//     the script exits cleanly (no failure — the theme picker just stays empty).
//   • This is a CommonJS script so it runs on the user's installed Node
//     without needing any transpiler step.

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const THEMES_DIR = path.join(PROJECT_ROOT, "public", "themes");
const OUTPUT_FILE = path.join(THEMES_DIR, "themes.json");

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const IGNORED = new Set([".DS_Store", "themes.json", "Thumbs.db"]);

function listDirs(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function listImages(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => !IGNORED.has(name) && IMAGE_EXT.test(name));
}

function buildManifest() {
  const manifest = [];

  if (!fs.existsSync(THEMES_DIR)) {
    fs.mkdirSync(THEMES_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, "[]\n", "utf8");
    console.log(
      "build-themes-manifest: public/themes/ did not exist — created an empty manifest."
    );
    return manifest;
  }

  const themeNames = listDirs(THEMES_DIR);
  for (const theme_name of themeNames) {
    const themeDir = path.join(THEMES_DIR, theme_name);
    const roomTypes = listDirs(themeDir);
    for (const room_type of roomTypes) {
      const roomDir = path.join(themeDir, room_type);
      const images = listImages(roomDir);
      for (const image_name of images) {
        manifest.push({
          theme_name,
          room_type,
          image_name,
          url: `/themes/${theme_name}/${room_type}/${image_name}`,
        });
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(
    `build-themes-manifest: wrote ${manifest.length} entries to ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}`
  );
  return manifest;
}

buildManifest();
