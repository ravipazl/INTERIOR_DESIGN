// Theme catalogue — loads the static manifest baked into the frontend at
// build time. Replaces the old DigitalOcean Spaces XML-listing approach.
//
// HOW IT WORKS
//   • Theme images live in `public/themes/<Style>/<RoomType>/<file>.jpg`.
//   • A small build script (`scripts/build-themes-manifest.js`) walks that
//     folder before every `npm run build` / `npm start` and writes
//     `public/themes/themes.json` — a flat array of:
//        { theme_name, room_type, image_name, url }
//   • This class just fetches that JSON and exposes the array.
//
// WHY THIS REPLACES THE OLD APPROACH
//   • Spaces is gone (no more $5/mo, no leaked credentials).
//   • No XML parsing, no `xml-js` dependency.
//   • One network round-trip → small JSON → fully cached on second visit.
//   • Atomic with the frontend deploy: rolling back the SPA rolls back the
//     theme catalogue too (no drift between code version and data).
//
// ADDING / REMOVING THEMES
//   • Drop or remove a folder under `public/themes/<Style>/<RoomType>/`.
//   • Run `npm start` or `npm run build` — the prebuild script regenerates
//     `themes.json`. Commit + push + redeploy.

class TypeStore {
  constructor() {
    this.themeArray = [];
    this.processedKeysSet = new Set();
  }

  async loadDataFromApi() {
    try {
      // Fetch the manifest from the SPA's own origin. The leading "/" makes
      // it relative to wherever the SPA is served (inspire.pazl.info,
      // localhost:3000, or any preview environment).
      const response = await fetch("/themes/themes.json", {
        // Avoid stale caches between deploys without breaking offline reloads.
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`themes.json fetch failed: ${response.status}`);
      }
      const data = await response.json();
      this.themeArray = Array.isArray(data) ? data : [];
      return this.themeArray;
    } catch (error) {
      console.log("Error occurred while loading themes manifest:", error);
      this.themeArray = [];
      return this.themeArray;
    }
  }

  getThemeArray() {
    return this.themeArray;
  }

  getRoomTypes() {
    return this.themeArray.map((theme) => theme.room_type);
  }

  getThemeNames() {
    return this.themeArray.map((theme) => theme.theme_name);
  }
}

export default TypeStore;
