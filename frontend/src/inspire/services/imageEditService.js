import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * imageEditService — client for the self-hosted image-edit features (SAM2 +
 * LaMa + rembg + CLIPSeg). Free models on your own hardware, NOT a paid API.
 *
 * These endpoints are served by the SAME Node backend as everything else. It
 * proxies /image-edit/* to the Python service on 127.0.0.1:8199, which is not
 * reachable from the network at all — see backend/src/image-edit-proxy.js.
 */

// Derived from the ONE backend URL rather than a dedicated variable.
//
// There used to be a REACT_APP_PAZL_IMAGEEDIT_URL, and it was a trap: it pointed
// at a port nothing served, and because dotenv-webpack inlines env values at
// COMPILE time, correcting the .env did nothing until the dev server was fully
// restarted. One value that is already correct everywhere beats a second value
// that can silently drift.
const BASE = `${
  process.env.REACT_APP_API_BASE_URL || "http://localhost:3400"
}/image-edit`;

// The proxy requires a logged-in user, so every call carries the same JWT the
// rest of the app already uses. The old X-Pazl-Key shared secret is gone from
// the browser entirely — the proxy attaches it server-side, which is the only
// place a shared secret belongs.
const cfg = (extra = {}) => {
  const token = getAccessToken();
  return {
    ...extra,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extra.headers || {}),
    },
  };
};

// A data: URL PNG -> a Blob (so a bg-removed cutout can be re-uploaded).
export const dataUrlToBlob = (dataUrl) => {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

// Upload a room photo; the server encodes it ONCE. -> { image_id, width, height }
export const createSession = async (file) => {
  const fd = new FormData();
  fd.append("file", file);
  const r = await axios.post(`${BASE}/api/session`, fd, cfg());
  return r.data;
};

// Click points -> mask. points [[x,y],...], labels [1,0,...] (1=include, 0=exclude).
// -> { score, bbox, mask_png, cutout_png }
export const segment = async (imageId, points, labels) => {
  const r = await axios.post(
    `${BASE}/api/segment`,
    { image_id: imageId, points, labels },
    cfg()
  );
  return r.data;
};

// Text-prompted select (CLIPSeg): type what to select ("the sofa").
// -> { bbox, area_frac, mask_png } (mask_png = full-frame overlay, alpha = mask)
export const textSegment = async (imageId, prompt, threshold = 0.4) => {
  const r = await axios.post(
    `${BASE}/api/textseg`,
    { image_id: imageId, prompt, threshold },
    cfg()
  );
  return r.data;
};

// Remove the currently-selected object (LaMa inpaint). -> { image_png }
export const removeObject = async (imageId) => {
  const r = await axios.post(`${BASE}/api/inpaint`, { image_id: imageId }, cfg());
  return r.data;
};

// Remove an object using a client-supplied image + mask (for the in-browser
// Studio, which selects client-side so the server never saw the image).
//   imageBlob = PNG of the current canvas
//   maskBlob  = grayscale/white-on-black PNG (white = the object to remove)
// -> { image_png }
export const inpaintWithMask = async (imageBlob, maskBlob) => {
  const fd = new FormData();
  fd.append("image", imageBlob, "image.png");
  fd.append("mask", maskBlob, "mask.png");
  const r = await axios.post(`${BASE}/api/inpaint_mask`, fd, cfg());
  return r.data;
};

// Strip an uploaded object photo's background (rembg). -> { object_png } (RGBA data URL)
export const removeBackground = async (file) => {
  const fd = new FormData();
  fd.append("file", file);
  const r = await axios.post(`${BASE}/api/bgremove`, fd, cfg());
  return r.data;
};

// Place a cut-out object onto the room at x/y (% of room) and scale (%). -> { image_png }
export const compositeObject = async (
  imageId,
  objectBlob,
  xPct,
  yPct,
  scalePct
) => {
  const fd = new FormData();
  fd.append("image_id", imageId);
  fd.append("obj", objectBlob, "obj.png");
  fd.append("x_pct", xPct);
  fd.append("y_pct", yPct);
  fd.append("scale_pct", scalePct);
  const r = await axios.post(`${BASE}/api/composite`, fd, cfg());
  return r.data;
};
