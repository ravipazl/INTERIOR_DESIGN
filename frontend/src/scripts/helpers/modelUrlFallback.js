// Second chance for uploaded models whose file the website can't find.
//
// Uploaded models are stored with a link like "/assets/models/glb/<file>.glb"
// and loaded from the website. If the web server serves /assets from a
// different folder than the one the backend saved the file into, that is a 404
// and the model can't be added. The backend serves the same files from its own
// folders (backend/src/model-files.js), so on a 404 we retry the same path
// through the API address. Files that load fine are never touched.
//
// Applied once, globally, so every GLTFLoader (catalog preview, "Add", saved
// scenes) and every model thumbnail <img> gets it.

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

const API_BASE = String(process.env.REACT_APP_API_BASE_URL || "").replace(/\/+$/, "");
const MODEL_PATH = /^\/assets\/models\/(glb|thumbnails)\//;

/** The API-address copy of a model/thumbnail link, or null if it has none. */
export const modelFallbackUrl = (url) => {
  if (!API_BASE || !url) return null;
  let p;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    p = u.pathname + u.search;
  } catch (e) {
    return null;
  }
  if (!MODEL_PATH.test(p)) return null;
  const alt = `${API_BASE}${p}`;
  return new URL(alt, window.location.origin).href ===
    new URL(url, window.location.origin).href
    ? null
    : alt;
};

/** True when a loader error means "the server has no such file". */
export const isFileNotFound = (err) => {
  const status = err && err.target && err.target.status;
  return status === 404;
};

if (!GLTFLoader.prototype.__pazlFallback) {
  const originalLoad = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    const alt = modelFallbackUrl(url);
    if (!alt) return originalLoad.call(this, url, onLoad, onProgress, onError);
    return originalLoad.call(this, url, onLoad, onProgress, (err) => {
      if (!isFileNotFound(err)) {
        if (onError) onError(err);
        return;
      }
      console.warn("[models] not found on the website, loading from the server:", alt);
      originalLoad.call(this, alt, onLoad, onProgress, onError);
    });
  };
  GLTFLoader.prototype.__pazlFallback = true;

  // Thumbnails are plain <img> tags all over the app: retry a broken one once.
  // (Image errors don't bubble, hence the capture listener.)
  try {
    document.addEventListener(
      "error",
      (e) => {
        const img = e.target;
        if (!img || img.tagName !== "IMG" || img.dataset.pazlFallback) return;
        const alt = modelFallbackUrl(img.getAttribute("src"));
        if (!alt) return;
        img.dataset.pazlFallback = "1";
        img.src = alt;
      },
      true
    );
  } catch (e) {
    /* no document (tests) */
  }
}
