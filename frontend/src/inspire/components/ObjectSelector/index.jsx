import React, { useEffect, useRef, useState } from "react";
import { Modal, Spinner } from "react-bootstrap";
import {
  preloadModel,
  encodeImage,
  segmentPoint,
} from "../../lib/samSegmenter";
import {
  inpaintWithMask,
  removeBackground,
  createSession,
  segment,
} from "../../services/imageEditService";
import "./index.css";

const imgUrl = (key) =>
  key ? `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${key}` : "";

// Notes are a single "Change" category — the pin/label color for a marked-up image.
const NOTE_COLOR = "#1d9e75";

// Recolor swatches (neutrals + colors). Tint preserves each pixel's lightness.
const SWATCHES = [
  "#2f6fdb", "#1d9e75", "#d85a30", "#e0b32c", "#7f77dd",
  "#d4537e", "#b23b3b", "#8a8780", "#3a3a38", "#efe9dc",
];

// --- color helpers: recolor by replacing hue+saturation, KEEPING lightness ---
// (keeping L preserves the object's shading, folds, and texture → realistic tint)
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  h = (h % 360) / 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function hexToHueSat(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [h, s] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  return [h, s];
}

// Center of a mask, as normalized [0..1] coords — used to anchor a note pin so it
// stays put when the image is scaled to fit.
function maskCentroid(mask, w, h) {
  let sx = 0, sy = 0, c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { sx += x; sy += y; c++; }
    }
  }
  if (!c) return null;
  return [sx / c / w, sy / c / h];
}

// Trigger a browser download of a Blob.
function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Draw a numbered pin (colored disc, white ring, centered number) on a 2D context.
function drawPinOn(ctx, x, y, num, r, font, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color || "#1d9e75";
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${font}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), x, y + font * 0.05);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Draw a note's text as a dark label anchored above/below its pin, baked into
// the exported image (mirrors the live on-picture label).
function drawLabelOn(ctx, x, y, pinR, text, fontPx, maxW, bottomBound) {
  const maxY = bottomBound || ctx.canvas.height;
  ctx.font = `500 ${fontPx}px sans-serif`;
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  });
  if (line) lines.push(line);

  const padX = Math.round(fontPx * 0.7);
  const padY = Math.round(fontPx * 0.5);
  const lineH = Math.round(fontPx * 1.3);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.ceil(textW + padX * 2);
  const boxH = Math.ceil(lines.length * lineH + padY * 2);
  const gap = Math.round(pinR * 0.7) + 6;

  let boxY = y + pinR + gap; // below the pin by default
  let below = true;
  if (boxY + boxH > maxY) {
    boxY = y - pinR - gap - boxH; // flip above if it would clip the image edge
    below = false;
  }
  let boxX = Math.round(x - boxW / 2);
  boxX = Math.max(4, Math.min(boxX, ctx.canvas.width - boxW - 4)); // keep on-canvas

  const fill = "rgba(28,27,42,0.92)";
  roundRectPath(ctx, boxX, boxY, boxW, boxH, Math.round(fontPx * 0.5));
  ctx.fillStyle = fill;
  ctx.fill();
  // small pointer triangle toward the pin
  const tx = Math.max(boxX + 10, Math.min(x, boxX + boxW - 10));
  ctx.beginPath();
  if (below) {
    ctx.moveTo(tx - 6, boxY); ctx.lineTo(tx + 6, boxY); ctx.lineTo(tx, boxY - 7);
  } else {
    ctx.moveTo(tx - 6, boxY + boxH); ctx.lineTo(tx + 6, boxY + boxH); ctx.lineTo(tx, boxY + boxH + 7);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.fillStyle = "#f4f3fb";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, boxX + boxW / 2, boxY + padY + i * lineH));
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

// Object selector — runs SAM in a Web Worker (off the main thread, so the UI
// never freezes), 100% in the browser (no server, no cost). Proper selection =
// drag a box around the object; a tiny drag is treated as a single click.
const ObjectSelector = ({ show, onHide, image, onDone }) => {
  const canvasRef = useRef(null);
  const dirtyRef = useRef(false); // true once any edit (color/adjust/note/remove) happens
  const outlineRef = useRef(null); // overlay canvas: crisp selection outline (persists across edits)
  const noteInputRef = useRef(null); // left-panel note input, focused by the floating toolbar
  const baseImageDataRef = useRef(null);
  const encodedSrcRef = useRef(null);
  const originalSrcRef = useRef(null); // the untouched source image, for "Reset all"
  const selectionMaskRef = useRef(null); // accumulated selection (Uint8Array w*h, 0/1)
  const editedImageDataRef = useRef(null); // working image with recolors baked in

  const [phase, setPhase] = useState("idle"); // idle|encoding|ready|segmenting|error
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [addMode, setAddMode] = useState(false); // keep clicking to ADD parts
  const addModeRef = useRef(false);
  addModeRef.current = addMode;
  const [colorApplied, setColorApplied] = useState(null); // hex of applied recolor
  const [bright, setBright] = useState(0); // -100..100
  const [sat, setSat] = useState(0); // -100..100
  const [warm, setWarm] = useState(0); // -100..100
  // Live edit params for the CURRENT selection (mirrors the controls, read by the
  // render pass without stale-closure issues).
  const editParamsRef = useRef({ hex: null, bright: 0, sat: 0, warm: 0 });
  const [comments, setComments] = useState([]); // [{ id, ax, ay, text }]
  const [commentDraft, setCommentDraft] = useState("");
  const commentSeqRef = useRef(0);
  const [selectMsg, setSelectMsg] = useState(""); // visible "click more precisely" hint
  const selectMsgTimer = useRef(null);
  const [removing, setRemoving] = useState(false); // server-backed object removal in flight
  // Add / Replace furniture: a rembg cutout being positioned over the room.
  const [insertBusy, setInsertBusy] = useState(false); // bgremove / placing in flight
  const [placing, setPlacing] = useState(null); // { src, natW, natH, cx, cy, scale } | null
  const furnitureInputRef = useRef(null); // hidden <input type=file> for the furniture photo
  const replaceOnInsertRef = useRef(false); // true = remove the selected object before placing
  const dragRef = useRef(null); // drag bookkeeping while positioning the cutout
  // Manual mask brush: paint bits SAM missed / erase overspill before Remove/Replace.
  const [brushMode, setBrushMode] = useState(null); // null | "add" | "erase"
  const brushModeRef = useRef(null);
  brushModeRef.current = brushMode;
  const [brushSize, setBrushSize] = useState(22); // slider 5..100 → radius
  const brushSizeRef = useRef(22);
  brushSizeRef.current = brushSize;
  const paintingRef = useRef(false); // pointer is down and painting
  const paintPrevRef = useRef(null); // last client point, to interpolate strokes
  const [brushCursor, setBrushCursor] = useState(null); // { x, y, d } display px ring, or null
  // Click-to-select always goes through server SAM2 (sharper masks) and falls
  // back to the in-browser SAM automatically if the service is unreachable.
  const serverSessionRef = useRef(null); // { id, w, h } for the encoded server image, or null
  // Context for the selected object: cropped thumbnail + coverage/size readout.
  const [objCtx, setObjCtx] = useState(null); // { thumb, coverage, w, h } | null

  useEffect(() => {
    if (show) preloadModel();
  }, [show]);

  // Keyboard shortcuts (ignored while typing in a field): Esc = deselect (or close
  // if nothing is selected), A = toggle Add mode, Ctrl/Cmd+Z = reset the current
  // object's edits. Bound in capture phase so Esc beats any default handling.
  useEffect(() => {
    if (!show) return;
    const onKey = (e) => {
      const t = e.target;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return; // don't hijack keys while the user is typing / dragging a slider
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (selectionMaskRef.current) clearSelection();
        else onHide();
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setAddMode((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        if (selectionMaskRef.current) {
          e.preventDefault();
          resetColor();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (!show || !image?.url) return;
    let cancelled = false;
    const src = imgUrl(image.url);
    originalSrcRef.current = src; // remember the untouched image for "Reset all"
    (async () => {
      setError(null);
      setInfo(null);
      setObjCtx(null);
      dirtyRef.current = false;
      editParamsRef.current = { hex: null, bright: 0, sat: 0, warm: 0 };
      setColorApplied(null);
      setBright(0);
      setSat(0);
      setWarm(0);
      setComments([]);
      setCommentDraft("");
      commentSeqRef.current = 0;
      selectionMaskRef.current = null; // fresh image → fresh selection
      serverSessionRef.current = null; // fresh image → fresh server encode
      try {
        if (encodedSrcRef.current === src && baseImageDataRef.current) {
          const b = baseImageDataRef.current;
          editedImageDataRef.current = new ImageData(
            new Uint8ClampedArray(b.data),
            b.width,
            b.height
          ); // reopening the same image starts fresh (no prior edits)
          drawBase();
          setPhase("ready");
          return;
        }
        setPhase("encoding");
        const enc = await encodeImage(src);
        if (cancelled) return;
        const base = new ImageData(
          new Uint8ClampedArray(enc.rgba),
          enc.width,
          enc.height
        );
        const canvas = canvasRef.current;
        canvas.width = enc.width;
        canvas.height = enc.height;
        baseImageDataRef.current = base;
        editedImageDataRef.current = new ImageData(
          new Uint8ClampedArray(base.data),
          base.width,
          base.height
        );
        canvas.getContext("2d").putImageData(editedImageDataRef.current, 0, 0);
        encodedSrcRef.current = src;
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setError(
          "Could not load the selector. Check your connection (the model downloads once) and try again."
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, image]);

  // Draw the current WORKING image (edits baked in), falling back to the original.
  const drawBase = () => {
    const canvas = canvasRef.current;
    const img = editedImageDataRef.current || baseImageDataRef.current;
    if (!canvas || !img) return;
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").putImageData(img, 0, 0);
  };

  // Flatten a worker result to a single-channel 0/1 mask (robust to the
  // numMasks/bestIndex wire format from either the refined or raw worker path).
  const extractFlat = (res) => {
    const { width, height, numMasks, bestIndex } = res;
    const md = new Uint8Array(res.data);
    const flat = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      flat[i] = md[numMasks * i + bestIndex] === 1 ? 1 : 0;
    }
    return { flat, width, height };
  };

  // Build the left-panel object context for a selection mask: a cropped, masked
  // thumbnail of just the object + coverage/size stats. All client-side.
  const buildObjectContext = (sel, width, height) => {
    if (!sel) return null;
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (sel[y * width + x] === 1) {
          area++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (area === 0) return null;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const src = editedImageDataRef.current || baseImageDataRef.current;
    if (!src) return null;
    const c = document.createElement("canvas");
    c.width = bw;
    c.height = bh;
    const cx = c.getContext("2d");
    const out = cx.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const si = (minY + y) * width + (minX + x);
        const di = (y * bw + x) * 4;
        if (sel[si] === 1) {
          const sp = si * 4;
          out.data[di] = src.data[sp];
          out.data[di + 1] = src.data[sp + 1];
          out.data[di + 2] = src.data[sp + 2];
          out.data[di + 3] = 255;
        } else {
          out.data[di + 3] = 0; // outside the mask → transparent
        }
      }
    }
    cx.putImageData(out, 0, 0);
    return {
      thumb: c.toDataURL(),
      coverage: area / (width * height),
      w: bw,
      h: bh,
      ax: (minX + bw / 2) / width, // top-center anchor for the floating toolbar
      ay: minY / height,
    };
  };

  // Draw a crisp accent outline of the selection onto the SEPARATE overlay canvas.
  // Because it's its own layer, it persists through recolor/brightness repaints of
  // the main canvas. Traces the exact boundary of the (possibly unioned) mask.
  const drawOutline = (sel, width, height) => {
    const cv = outlineRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!sel) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    cv.width = width;
    cv.height = height;
    ctx.clearRect(0, 0, width, height);
    const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : sel[y * width + x]);
    const path = new Path2D();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (sel[y * width + x] !== 1) continue;
        if (at(x, y - 1) === 0) { path.moveTo(x, y); path.lineTo(x + 1, y); }
        if (at(x, y + 1) === 0) { path.moveTo(x, y + 1); path.lineTo(x + 1, y + 1); }
        if (at(x - 1, y) === 0) { path.moveTo(x, y); path.lineTo(x, y + 1); }
        if (at(x + 1, y) === 0) { path.moveTo(x + 1, y); path.lineTo(x + 1, y + 1); }
      }
    }
    const lw = Math.max(1.5, Math.round(width / 500));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; // halo for contrast on busy scenes
    ctx.lineWidth = lw + 2;
    ctx.stroke(path);
    ctx.strokeStyle = "#2f6fdb";
    ctx.lineWidth = lw;
    ctx.stroke(path);
  };

  const drawSelection = (mask, width, height) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(editedImageDataRef.current || baseImageDataRef.current, 0, 0);
    const overlay = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < width * height; i++) {
      if (mask[i] === 1) {
        overlay.data[4 * i] = Math.round(overlay.data[4 * i] * 0.82 + 47 * 0.18);
        overlay.data[4 * i + 1] = Math.round(overlay.data[4 * i + 1] * 0.82 + 111 * 0.18);
        overlay.data[4 * i + 2] = Math.round(overlay.data[4 * i + 2] * 0.82 + 219 * 0.18);
      }
    }
    ctx.putImageData(overlay, 0, 0);
  };

  // Apply a click's mask: in Add mode UNION it into the running selection (so a
  // multi-material surface like a ceiling can be built up part by part); otherwise
  // replace. Each click's mask is already refined (clean single region).
  // Apply a 0/1 flat mask: in Add mode UNION it into the running selection,
  // otherwise replace. Source-agnostic (browser SAM or server SAM2).
  const applyFlatSelection = (flat, width, height) => {
    let sel = selectionMaskRef.current;
    if (!addModeRef.current || !sel || sel.length !== width * height) {
      sel = flat;
    } else {
      for (let i = 0; i < sel.length; i++) if (flat[i]) sel[i] = 1;
    }
    selectionMaskRef.current = sel;
    drawSelection(sel, width, height);
    drawOutline(sel, width, height);
    resetParams(); // selection changed → drop the current object's edit controls
  };


  const resetParams = () => {
    editParamsRef.current = { hex: null, bright: 0, sat: 0, warm: 0 };
    setColorApplied(null);
    setBright(0);
    setSat(0);
    setWarm(0);
  };

  // Render all edits for the CURRENT selection in one pass, computed from the
  // ORIGINAL pixels (so nothing compounds) and BAKED into the working image (so
  // other objects' edits persist). Order: optional recolor (hue+sat, keep
  // lightness) → saturation → brightness → warmth.
  const renderEdits = () => {
    const base = baseImageDataRef.current;
    const edited = editedImageDataRef.current;
    const sel = selectionMaskRef.current;
    if (!base || !edited || !sel) return;
    const ctx = canvasRef.current.getContext("2d");
    const { hex, bright, sat, warm } = editParamsRef.current;
    const tint = hex ? hexToHueSat(hex) : null;
    const satMul = 1 + sat / 100; // -100..100 → 0..2
    const lAdd = (bright / 100) * 0.5; // ±0.5 lightness
    const wPush = (warm / 100) * 40; // ±40 on R (and −B)
    const n = base.width * base.height;
    for (let i = 0; i < n; i++) {
      if (sel[i] !== 1) continue;
      const p = 4 * i;
      let [h, s, l] = rgbToHsl(base.data[p], base.data[p + 1], base.data[p + 2]);
      if (tint) { h = tint[0]; s = tint[1]; }
      s = Math.max(0, Math.min(1, s * satMul));
      l = Math.max(0, Math.min(1, l + lAdd));
      let [r, g, b] = hslToRgb(h, s, l);
      if (wPush !== 0) {
        r = Math.max(0, Math.min(255, r + wPush));
        b = Math.max(0, Math.min(255, b - wPush));
      }
      edited.data[p] = r; edited.data[p + 1] = g; edited.data[p + 2] = b;
    }
    ctx.putImageData(edited, 0, 0);
  };

  const applyRecolor = (hex) => {
    dirtyRef.current = true;
    editParamsRef.current.hex = hex;
    setColorApplied(hex);
    renderEdits();
  };
  const onBright = (v) => { dirtyRef.current = true; editParamsRef.current.bright = v; setBright(v); renderEdits(); };
  const onSat = (v) => { dirtyRef.current = true; editParamsRef.current.sat = v; setSat(v); renderEdits(); };
  const onWarm = (v) => { dirtyRef.current = true; editParamsRef.current.warm = v; setWarm(v); renderEdits(); };

  // Reset the CURRENT selection's colour/adjust edits back to original pixels
  // (bound to Ctrl/⌘+Z), leaving other objects' edits intact.
  const resetColor = () => {
    resetParams();
    renderEdits(); // all-neutral params → masked pixels restored to original
    const base = baseImageDataRef.current;
    const sel = selectionMaskRef.current;
    if (base && sel) drawSelection(sel, base.width, base.height);
  };

  // Reset ALL edits — revert the whole image to the original photo (undoes
  // recolors, removes, adds/replaces). Re-encodes so selection works again.
  const resetAll = async () => {
    const src = originalSrcRef.current;
    if (!src || phase !== "ready" || removing || insertBusy) return;
    setPhase("encoding");
    setError(null);
    try {
      await setBaseFromDataUrl(src); // restore original pixels + re-encode
      clearSelection();
      setPlacing(null);
      dirtyRef.current = false;
    } catch (e) {
      console.error(e);
      flashSelectMsg("Couldn't reset. Try again.");
    } finally {
      setPhase("ready");
    }
  };

  // Upload the current working image to the server ONCE (SAM2 encode-once); reused
  // for every click until the pixels change. Returns { id, w, h } or null.
  const ensureServerSession = async () => {
    if (serverSessionRef.current) return serverSessionRef.current;
    const base = editedImageDataRef.current;
    if (!base) return null;
    const c = document.createElement("canvas");
    c.width = base.width;
    c.height = base.height;
    c.getContext("2d").putImageData(base, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    const file = new File([blob], "room.png", { type: "image/png" });
    const { image_id, width, height } = await createSession(file);
    serverSessionRef.current = { id: image_id, w: width, h: height };
    return serverSessionRef.current;
  };

  // Decode SAM2's full-frame overlay mask (alpha = the mask) to a 0/1 array at
  // our base resolution (the server works at a downscaled size).
  const serverMaskToFlat = async (maskDataUrl, W, H) => {
    const img = await loadImage(maskDataUrl);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    const flat = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) flat[i] = d[4 * i + 3] > 64 ? 1 : 0;
    return flat;
  };

  // Segment a click via server SAM2. Returns { flat, score } at base res, or null
  // (service unreachable / stale session) so the caller can fall back to browser.
  const hdSegment = async (nx, ny, W, H) => {
    try {
      const s = await ensureServerSession();
      if (!s) return null;
      const res = await segment(s.id, [[nx * s.w, ny * s.h]], [1]);
      const flat = await serverMaskToFlat(res.mask_png, W, H);
      return { flat, score: res.score };
    } catch (e) {
      console.warn("[pazl] HD select failed, using browser SAM", e);
      serverSessionRef.current = null; // force a fresh session next time
      return null;
    }
  };

  const onCanvasClick = async (ev) => {
    if (phase !== "ready" || !baseImageDataRef.current) return;
    if (placing || insertBusy || brushMode) return; // brush/placement own the canvas
    const baseImg = editedImageDataRef.current || baseImageDataRef.current;
    const width = baseImg.width;
    const height = baseImg.height;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
    setPhase("segmenting");
    setError(null);
    try {
      // Prefer server SAM2 (sharper masks); fall back to in-browser SAM.
      let flat = null;
      let score = null;
      const hd = await hdSegment(x, y, width, height);
      if (hd) {
        flat = hd.flat;
        score = hd.score;
      }
      if (!flat) {
        const result = await segmentPoint(x, y);
        if (result.noSelection) {
          flashSelectMsg("Couldn't find an object there — click right on the item you want.");
          setPhase("ready");
          return;
        }
        const ex = extractFlat(result);
        flat = ex.flat; // browser mask is at base resolution too
        score = result.score;
      }
      // Size guard: reject empty and over-large selections (a click that grabbed
      // half the room on a low-contrast / reflective scene) with a visible hint.
      let area = 0;
      for (let i = 0; i < flat.length; i++) if (flat[i]) area += 1;
      const frac = area / (width * height);
      if (area === 0) {
        flashSelectMsg("Couldn't find an object there — click right on the item you want.");
      } else if (frac > 0.4) {
        flashSelectMsg("That selected too much of the room. Click more precisely on one object.");
      } else {
        applyFlatSelection(flat, width, height);
        setInfo({ score });
        setObjCtx(buildObjectContext(selectionMaskRef.current, width, height));
      }
    } catch (e) {
      console.error(e);
      flashSelectMsg("Could not isolate that object. Try clicking on it.");
      drawBase();
    }
    setPhase("ready");
  };

  const flashSelectMsg = (msg) => {
    setSelectMsg(msg);
    window.clearTimeout(selectMsgTimer.current);
    selectMsgTimer.current = window.setTimeout(() => setSelectMsg(""), 4500);
  };

  // --- Manual mask brush ------------------------------------------------------
  // Paint/erase directly onto the selection mask so the user can fix what the
  // auto-select missed (stray legs) or grabbed too much — 100% in-browser.
  const brushRadiusPx = (W, H) =>
    Math.max(2, (brushSizeRef.current / 100) * 0.14 * Math.min(W, H));

  // Stamp a filled circle (add=1 / erase=0) into the mask at a client point.
  const paintDot = (clientX, clientY, erase) => {
    const canvas = canvasRef.current;
    const base = editedImageDataRef.current || baseImageDataRef.current;
    if (!canvas || !base) return;
    const W = base.width;
    const H = base.height;
    let sel = selectionMaskRef.current;
    if (!sel || sel.length !== W * H) {
      sel = new Uint8Array(W * H);
      selectionMaskRef.current = sel;
    }
    const rect = canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const py = ((clientY - rect.top) / rect.height) * H;
    const r = brushRadiusPx(W, H);
    const val = erase ? 0 : 1;
    const x0 = Math.max(0, Math.floor(px - r));
    const x1 = Math.min(W - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r));
    const y1 = Math.min(H - 1, Math.ceil(py + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - px;
        const dy = y - py;
        if (dx * dx + dy * dy <= r2) sel[y * W + x] = val;
      }
    }
  };

  // Paint from the previous point to this one so fast drags leave no gaps.
  const paintStroke = (clientX, clientY, erase) => {
    const prev = paintPrevRef.current;
    if (prev) {
      const dist = Math.hypot(clientX - prev.x, clientY - prev.y);
      const steps = Math.max(1, Math.floor(dist / 4));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        paintDot(prev.x + (clientX - prev.x) * t, prev.y + (clientY - prev.y) * t, erase);
      }
    } else {
      paintDot(clientX, clientY, erase);
    }
    paintPrevRef.current = { x: clientX, y: clientY };
  };

  const redrawSelectionLive = () => {
    const sel = selectionMaskRef.current;
    const base = editedImageDataRef.current || baseImageDataRef.current;
    if (sel && base) {
      drawSelection(sel, base.width, base.height);
      drawOutline(sel, base.width, base.height);
    }
  };

  // After a stroke ends: refresh the object stats or drop the selection if empty.
  const commitBrush = () => {
    const sel = selectionMaskRef.current;
    const base = editedImageDataRef.current || baseImageDataRef.current;
    if (!sel || !base) return;
    let area = 0;
    for (let i = 0; i < sel.length; i++) if (sel[i]) area += 1;
    dirtyRef.current = true;
    if (area === 0) {
      clearSelection();
      return;
    }
    resetParams();
    setInfo((prev) => ({ score: prev && prev.score != null ? prev.score : null }));
    setObjCtx(buildObjectContext(sel, base.width, base.height));
  };

  const brushCursorFrom = (e) => {
    const canvas = canvasRef.current;
    const base = editedImageDataRef.current || baseImageDataRef.current;
    if (!canvas || !base) return null;
    const rect = canvas.getBoundingClientRect();
    const d = brushRadiusPx(base.width, base.height) * 2 * (rect.width / base.width);
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, d };
  };

  const onCanvasPointerDown = (e) => {
    if (!brushModeRef.current || phase !== "ready" || placing || insertBusy) return;
    e.preventDefault();
    paintingRef.current = true;
    paintPrevRef.current = null;
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (_) {
      /* best-effort */
    }
    paintStroke(e.clientX, e.clientY, brushModeRef.current === "erase");
    redrawSelectionLive();
    setBrushCursor(brushCursorFrom(e));
  };
  const onCanvasPointerMove = (e) => {
    if (!brushModeRef.current) return;
    setBrushCursor(brushCursorFrom(e));
    if (!paintingRef.current) return;
    paintStroke(e.clientX, e.clientY, brushModeRef.current === "erase");
    redrawSelectionLive();
  };
  const onCanvasPointerUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    paintPrevRef.current = null;
    commitBrush();
  };
  const onCanvasPointerLeave = () => {
    setBrushCursor(null);
    if (paintingRef.current) {
      paintingRef.current = false;
      paintPrevRef.current = null;
      commitBrush();
    }
  };
  const toggleBrush = (mode) => {
    setBrushMode((cur) => (cur === mode ? null : mode));
    setBrushCursor(null);
  };

  const clearSelection = () => {
    selectionMaskRef.current = null;
    drawBase();
    drawOutline(null);
    setInfo(null);
    setObjCtx(null);
    resetParams();
  };

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  const loadImage = (src) =>
    new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });

  // Make `src` (a data URL) the new working image: re-encode it (so further
  // selections/edits operate on the updated pixels — the server may have
  // downscaled) and reset the base/edited buffers + canvas size to match.
  const setBaseFromDataUrl = async (src) => {
    const enc = await encodeImage(src);
    const base = new ImageData(
      new Uint8ClampedArray(enc.rgba),
      enc.width,
      enc.height
    );
    const canvas = canvasRef.current;
    canvas.width = enc.width;
    canvas.height = enc.height;
    baseImageDataRef.current = base;
    editedImageDataRef.current = new ImageData(
      new Uint8ClampedArray(base.data),
      base.width,
      base.height
    );
    encodedSrcRef.current = src;
    serverSessionRef.current = null; // pixels changed → re-encode on the server next click
  };

  // Bounding box of the current selection in normalized (0..1) coords, or null.
  const selectionBBox = () => {
    const sel = selectionMaskRef.current;
    const base = editedImageDataRef.current;
    if (!sel || !base) return null;
    const w = base.width;
    const h = base.height;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (sel[y * w + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return {
      cx: (minX + maxX + 1) / 2 / w,
      cy: (minY + maxY + 1) / 2 / h,
      wFrac: (maxX - minX + 1) / w,
    };
  };

  // Inpaint (remove-with-fill) the CURRENT selection and make the filled image
  // the new base. Shared by "Remove object" and by "Replace" (remove then add).
  const inpaintCurrentSelection = async () => {
    const sel = selectionMaskRef.current;
    const img = editedImageDataRef.current;
    if (!sel || !img) return false;
    const w = img.width;
    const h = img.height;
    // 1) current working image (edits baked, no selection tint) -> PNG blob
    const imgCanvas = document.createElement("canvas");
    imgCanvas.width = w;
    imgCanvas.height = h;
    imgCanvas.getContext("2d").putImageData(img, 0, 0);
    const imageBlob = await new Promise((res) =>
      imgCanvas.toBlob(res, "image/png")
    );
    // 2) selection mask -> white-on-black PNG blob (white = remove)
    const mCanvas = document.createElement("canvas");
    mCanvas.width = w;
    mCanvas.height = h;
    const mctx = mCanvas.getContext("2d");
    const mdata = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = sel[i] ? 255 : 0;
      mdata.data[4 * i] = v;
      mdata.data[4 * i + 1] = v;
      mdata.data[4 * i + 2] = v;
      mdata.data[4 * i + 3] = 255;
    }
    mctx.putImageData(mdata, 0, 0);
    const maskBlob = await new Promise((res) =>
      mCanvas.toBlob(res, "image/png")
    );
    // 3) server inpaint -> filled image (data URL) -> new base
    const { image_png: filled } = await inpaintWithMask(imageBlob, maskBlob);
    await setBaseFromDataUrl(filled);
    dirtyRef.current = true;
    clearSelection(); // drops selection + resets edit params, redraws the fill
    return true;
  };

  // Remove the selected object FOR REAL: the ONE server call the otherwise
  // in-browser Studio makes — realistic remove-with-fill can't run on-device.
  const handleRemoveObject = async () => {
    if (!selectionMaskRef.current || removing || phase !== "ready") return;
    setRemoving(true);
    setError(null);
    try {
      await inpaintCurrentSelection();
    } catch (e) {
      console.error(e);
      flashSelectMsg(
        "Remove failed — is the image-edit service running? Try again."
      );
    } finally {
      setRemoving(false);
    }
  };

  // --- Add / Replace furniture -----------------------------------------------
  // "Add" drops a new furniture photo into the room; "Replace" first removes the
  // selected object, then drops the new one where it was. The photo's background
  // is stripped on the server (rembg); positioning + compositing stay in-browser.
  const openFurniturePicker = (replace) => {
    if (insertBusy || removing || placing) return;
    replaceOnInsertRef.current = !!replace;
    if (furnitureInputRef.current) {
      furnitureInputRef.current.value = ""; // allow re-picking the same file
      furnitureInputRef.current.click();
    }
  };

  const onFurnitureFile = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file || phase !== "ready") return;
    const replace = replaceOnInsertRef.current && !!selectionMaskRef.current;
    // Default placement = the selected object's box (replace) or centred (add).
    const box = replace ? selectionBBox() : null;
    setInsertBusy(true);
    setError(null);
    try {
      if (replace) await inpaintCurrentSelection(); // clear the old object first
      const { object_png: cutout } = await removeBackground(file);
      const img = await loadImage(cutout);
      setPlacing({
        src: cutout,
        natW: img.naturalWidth || 1,
        natH: img.naturalHeight || 1,
        cx: box ? box.cx : 0.5,
        cy: box ? box.cy : 0.5,
        scale: box ? Math.min(0.9, Math.max(0.08, box.wFrac)) : 0.4,
        shadow: true, // ground the piece with a soft contact shadow
      });
    } catch (e) {
      console.error(e);
      flashSelectMsg(
        "Couldn't prepare that image — is the image-edit service running?"
      );
    } finally {
      setInsertBusy(false);
    }
  };

  // Drag the floating cutout around the stage (normalized coords).
  const onPlacePointerDown = (e) => {
    if (!placing) return;
    e.preventDefault();
    const wrap = canvasRef.current;
    const rect = wrap.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      cx: placing.cx,
      cy: placing.cy,
      w: rect.width,
      h: rect.height,
    };
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointer capture is best-effort */
    }
  };
  const onPlacePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = clamp01(d.cx + (e.clientX - d.startX) / d.w);
    const ny = clamp01(d.cy + (e.clientY - d.startY) / d.h);
    setPlacing((p) => (p ? { ...p, cx: nx, cy: ny } : p));
  };
  const onPlacePointerUp = () => {
    dragRef.current = null;
  };

  // A black silhouette (the cutout's alpha filled solid) — the basis of the shadow.
  const makeSilhouette = (img, w, h) => {
    const s = document.createElement("canvas");
    s.width = w;
    s.height = h;
    const sx = s.getContext("2d");
    sx.drawImage(img, 0, 0, w, h);
    sx.globalCompositeOperation = "source-in";
    sx.fillStyle = "#000";
    sx.fillRect(0, 0, w, h);
    return s;
  };

  // Draw a soft contact shadow beneath the object so it sits IN the room instead
  // of floating: the silhouette squashed flat at the base, blurred + faded.
  const drawContactShadow = (ctx, silhouette, left, top, w, h) => {
    ctx.save();
    ctx.filter = `blur(${Math.max(2, Math.round(w * 0.035))}px)`;
    ctx.globalAlpha = 0.34;
    const baseX = left + w / 2;
    const baseY = top + h; // the object's "feet" line
    const sw = w * 0.98;
    const sh = h * 0.16; // squashed → reads as a floor shadow, not a copy
    ctx.translate(baseX, baseY);
    ctx.drawImage(silhouette, -sw / 2, -sh * 0.55, sw, sh);
    ctx.restore();
  };

  // Bake the positioned cutout into the working image → new base.
  const confirmPlacement = async () => {
    const p = placing;
    const base = editedImageDataRef.current;
    if (!p || !base) return;
    setInsertBusy(true);
    try {
      const W = base.width;
      const H = base.height;
      const targetW = Math.max(1, Math.round(p.scale * W));
      const targetH = Math.max(1, Math.round(targetW * (p.natH / p.natW)));
      const left = Math.round(p.cx * W - targetW / 2);
      const top = Math.round(p.cy * H - targetH / 2);
      const img = await loadImage(p.src);
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const cx = c.getContext("2d");
      cx.putImageData(base, 0, 0);
      if (p.shadow) {
        const sil = makeSilhouette(img, targetW, targetH);
        drawContactShadow(cx, sil, left, top, targetW, targetH);
      }
      cx.drawImage(img, left, top, targetW, targetH);
      await setBaseFromDataUrl(c.toDataURL("image/png"));
      dirtyRef.current = true;
      setPlacing(null);
      clearSelection();
    } catch (e) {
      console.error(e);
      flashSelectMsg("Couldn't place the object. Try again.");
    } finally {
      setInsertBusy(false);
    }
  };
  const cancelPlacement = () => {
    setPlacing(null);
    dragRef.current = null;
  };


  // Attach a note to the current object, pinned at its center. Notes are separate
  // from pixel edits and persist across selections (they live as overlay markers).
  const addComment = () => {
    const text = commentDraft.trim();
    const sel = selectionMaskRef.current;
    const base = baseImageDataRef.current;
    if (!text || !sel || !base) return;
    const c = maskCentroid(sel, base.width, base.height);
    if (!c) return;
    const id = ++commentSeqRef.current;
    dirtyRef.current = true;
    setComments((prev) => [...prev, { id, ax: c[0], ay: c[1], text }]);
    setCommentDraft("");
  };
  const deleteComment = (id) =>
    setComments((prev) => prev.filter((c) => c.id !== id));
  const updateComment = (id, patch) =>
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Bake the working image (edits) + numbered pins + a notes legend into one canvas.
  // Returns the canvas (or null) — reused by Download and by "Done" (save).
  const buildAnnotatedCanvas = () => {
    const edited = editedImageDataRef.current;
    if (!edited) return null;
    const w = edited.width, h = edited.height;
    const s = Math.max(1, Math.min(w, h) / 700); // scale text/pins to image size

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    ctx.putImageData(edited, 0, 0);

    const pinR = Math.round(14 * s);
    // labels first, then pins on top so a pin is never hidden behind a label
    comments.forEach((c) =>
      drawLabelOn(
        ctx, c.ax * w, c.ay * h, pinR, c.text,
        Math.round(14 * s), Math.round(190 * s), h
      )
    );
    comments.forEach((c, i) =>
      drawPinOn(ctx, c.ax * w, c.ay * h, i + 1, pinR, Math.round(14 * s), NOTE_COLOR)
    );

    return out;
  };

  // Download the annotated design (client-side, no upload).
  const exportAnnotated = () => {
    const out = buildAnnotatedCanvas();
    if (!out) return;
    out.toBlob(
      (blob) => downloadBlob(blob, comments.length ? "annotated-design.png" : "design.png"),
      "image/png"
    );
  };

  // On "Done": if the design was actually edited, hand the final annotated PNG up
  // to the parent (which saves it as an 'edited' image for the quote), then close.
  const handleDone = () => {
    if (dirtyRef.current && onDone) {
      const out = buildAnnotatedCanvas();
      if (out) out.toBlob((blob) => { if (blob) onDone(blob); }, "image/png");
    }
    onHide();
  };

  const busy = phase === "encoding";

  return (
    <Modal show={show} onHide={onHide} fullscreen keyboard={false}>
      <Modal.Body className="osel-body">
        {!image ? null : (
          <div className="osel-shell">
            <header className="osel-top">
              <div className="osel-brand">
                <span className="osel-logo" aria-hidden="true">P</span> Pazl Studio
              </div>
              <div className="osel-proj">
                <span className="osel-proj-name">Select an object</span>
                {busy && (
                  <span className="osel-proj-badge">
                    <Spinner animation="border" size="sm" /> analyzing image…
                  </span>
                )}
              </div>
              <div className="osel-top-spacer" />
              {phase === "ready" && (
                <button
                  className="osel-btn"
                  onClick={exportAnnotated}
                  title="Download the edited image with notes baked in"
                >
                  Download
                </button>
              )}
              <button className="osel-btn osel-btn-primary" onClick={handleDone}>
                Done
              </button>
            </header>

            <div className="osel-main">
              <aside className="osel-col">
                {error && (
                  <div
                    className="osel-card"
                    style={{ borderColor: "#f0c2b3", background: "#fbebe7", color: "#a83621" }}
                  >
                    {error}
                  </div>
                )}
                <div className="osel-card">
                  <h4 className="osel-h">Selected object</h4>
                  {info ? (
                    <>
                      <div className="osel-thumb">
                        {objCtx?.thumb ? (
                          <img src={objCtx.thumb} alt="Selected object" />
                        ) : (
                          <span className="osel-mut">no preview</span>
                        )}
                      </div>
                      <div className="osel-meta">
                        {info.score != null && (
                          <>
                            <div className="osel-metarow">
                              <span className="osel-metak">Confidence</span>
                              <span className="osel-metav">
                                {(info.score * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="osel-bar">
                              <span
                                style={{
                                  width: `${Math.max(4, Math.min(100, info.score * 100))}%`,
                                  background:
                                    info.score >= 0.85
                                      ? "var(--green)"
                                      : info.score >= 0.6
                                      ? "#e0a23b"
                                      : "#cf4257",
                                }}
                              />
                            </div>
                          </>
                        )}
                        {objCtx && (
                          <>
                            <div className="osel-metarow">
                              <span className="osel-metak">Coverage</span>
                              <span className="osel-metav">
                                {(objCtx.coverage * 100).toFixed(1)}% of room
                              </span>
                            </div>
                            <div className="osel-metarow">
                              <span className="osel-metak">Size</span>
                              <span className="osel-metav">
                                {objCtx.w} × {objCtx.h} px
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="osel-card">
                  <h4 className="osel-h">Refine selection</h4>
                  <div className="osel-actions">
                    <button
                      className={`osel-btn${brushMode === "add" ? " osel-btn-primary" : ""}`}
                      onClick={() => toggleBrush("add")}
                      aria-pressed={brushMode === "add"}
                      title="Paint to add to the selection"
                    >
                      Paint
                    </button>
                    <button
                      className={`osel-btn${brushMode === "erase" ? " osel-btn-primary" : ""}`}
                      onClick={() => toggleBrush("erase")}
                      aria-pressed={brushMode === "erase"}
                      title="Erase from the selection"
                    >
                      Erase
                    </button>
                  </div>
                  <label className="osel-slabel" style={{ marginTop: 10 }}>
                    Brush size
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="1"
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      aria-label="Brush size"
                    />
                  </label>
                </div>

                <div className="osel-card">
                  <h4 className="osel-h">Notes</h4>
                  {comments.length > 0 && (
                    <div className="osel-notelist">
                      {comments.map((c, i) => (
                        <div key={c.id} className="osel-note">
                          <span
                            className="osel-note-pin"
                            style={{ background: NOTE_COLOR }}
                          >
                            {i + 1}
                          </span>
                          <input
                            className="osel-note-text"
                            type="text"
                            value={c.text}
                            onChange={(e) => updateComment(c.id, { text: e.target.value })}
                            aria-label="Note text"
                          />
                          <button
                            className="osel-note-del"
                            title="Delete note"
                            aria-label="Delete note"
                            onClick={() => deleteComment(c.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {info ? (
                    <div className="osel-composer">
                      <input
                        ref={noteInputRef}
                        className="osel-note-input"
                        type="text"
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addComment(); }}
                        placeholder="Add a note…"
                      />
                      <button
                        className="osel-btn osel-btn-primary osel-note-add-btn"
                        onClick={addComment}
                        disabled={!commentDraft.trim()}
                      >
                        Add
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="osel-card">
                  <h4 className="osel-h">Furniture</h4>
                  {placing ? (
                    <>
                      <p className="osel-mut" style={{ margin: "0 0 10px" }}>
                        Drag it onto the room, then set the size.
                      </p>
                      <label className="osel-slabel">
                        Size
                        <input
                          type="range"
                          min="5"
                          max="100"
                          step="1"
                          value={Math.round(placing.scale * 100)}
                          onChange={(e) =>
                            setPlacing((p) =>
                              p ? { ...p, scale: Number(e.target.value) / 100 } : p
                            )
                          }
                          aria-label="Furniture size"
                        />
                      </label>
                      <label className="osel-check">
                        <input
                          type="checkbox"
                          checked={placing.shadow}
                          onChange={(e) =>
                            setPlacing((p) =>
                              p ? { ...p, shadow: e.target.checked } : p
                            )
                          }
                        />
                        Ground shadow
                      </label>
                      <div className="osel-actions" style={{ marginTop: 12 }}>
                        <button
                          className="osel-btn osel-btn-primary"
                          onClick={confirmPlacement}
                          disabled={insertBusy}
                        >
                          {insertBusy ? (
                            <>
                              <Spinner animation="border" size="sm" /> Placing…
                            </>
                          ) : (
                            "Place"
                          )}
                        </button>
                        <button
                          className="osel-btn"
                          onClick={cancelPlacement}
                          disabled={insertBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        className="osel-btn osel-btn-primary"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={() => openFurniturePicker(false)}
                        disabled={insertBusy || removing}
                      >
                        {insertBusy ? (
                          <>
                            <Spinner animation="border" size="sm" /> Preparing…
                          </>
                        ) : (
                          "Add furniture"
                        )}
                      </button>
                    </>
                  )}
                </div>
                <input
                  ref={furnitureInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={onFurnitureFile}
                />
              </aside>

              <section className="osel-center">
                <div className="osel-stage-area">
                  <div className="osel-stagewrap">
              <div className="osel-stage">
                <canvas
                  ref={canvasRef}
                  className={`osel-canvas${brushMode ? " brushing" : ""}`}
                  onClick={onCanvasClick}
                  onPointerDown={onCanvasPointerDown}
                  onPointerMove={onCanvasPointerMove}
                  onPointerUp={onCanvasPointerUp}
                  onPointerLeave={onCanvasPointerLeave}
                  role="img"
                  aria-label="Room image — click an object to select it"
                />
                {brushMode && brushCursor && (
                  <div
                    className="osel-brushring"
                    style={{
                      left: `${brushCursor.x}px`,
                      top: `${brushCursor.y}px`,
                      width: `${brushCursor.d}px`,
                      height: `${brushCursor.d}px`,
                    }}
                  />
                )}
                <canvas ref={outlineRef} className="osel-outline" aria-hidden="true" />
                {placing && (
                  <img
                    src={placing.src}
                    alt="New furniture — drag to position"
                    className="osel-placing"
                    style={{
                      left: `${placing.cx * 100}%`,
                      top: `${placing.cy * 100}%`,
                      width: `${placing.scale * 100}%`,
                    }}
                    draggable={false}
                    onPointerDown={onPlacePointerDown}
                    onPointerMove={onPlacePointerMove}
                    onPointerUp={onPlacePointerUp}
                    onPointerCancel={onPlacePointerUp}
                  />
                )}
                {(phase === "segmenting" || insertBusy) && (
                  <div className="osel-overlay">
                    <Spinner animation="border" size="sm" />{" "}
                    {insertBusy ? "preparing…" : "selecting…"}
                  </div>
                )}
              </div>
              {info && objCtx && phase !== "segmenting" && (
                <div
                  className={`osel-seltoolbar ${objCtx.ay < 0.12 ? "below" : ""}`}
                  style={{ left: `${objCtx.ax * 100}%`, top: `${objCtx.ay * 100}%` }}
                  role="group"
                  aria-label="Selected object actions"
                >
                  <button
                    className="osel-stbtn"
                    title="Add a note to this object"
                    onClick={() => noteInputRef.current && noteInputRef.current.focus()}
                  >
                    + Note
                  </button>
                  <span className="osel-stsep" />
                  <button
                    className="osel-stbtn"
                    title="Deselect this object"
                    aria-label="Deselect"
                    onClick={clearSelection}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="osel-pins">
                {comments.map((c, i) => (
                  <div
                    key={c.id}
                    className={`osel-pin ${c.ay > 0.5 ? "tip-up" : "tip-down"}`}
                    style={{
                      left: `${c.ax * 100}%`,
                      top: `${c.ay * 100}%`,
                      background: NOTE_COLOR,
                    }}
                  >
                    {i + 1}
                    <span className="osel-pin-tip">{c.text}</span>
                  </div>
                ))}
              </div>
                  </div>
                </div>
                <div className="osel-hintbar">
                  <span className="osel-hint" role="status" aria-live="polite">
                    {selectMsg ? (
                      <span style={{ color: "#cf4257" }}>{selectMsg}</span>
                    ) : phase === "ready" ? (
                      addMode ? (
                        <>
                          <b>Keep clicking</b> to add parts.
                        </>
                      ) : (
                        <>
                          <b>Click</b> an object to select it.
                        </>
                      )
                    ) : busy ? (
                      "Getting ready — first use downloads the model."
                    ) : (
                      ""
                    )}
                  </span>
                  <div className="osel-hint-spacer" />
                  <button
                    className={`osel-toggle ${addMode ? "on" : ""}`}
                    onClick={() => setAddMode((v) => !v)}
                    title="Union each click into one selection for multi-part surfaces (A)"
                    aria-pressed={addMode}
                    aria-keyshortcuts="A"
                  >
                    Add mode: {addMode ? "on" : "off"}
                  </button>
                  {info && (
                    <button
                      className="osel-btn"
                      onClick={clearSelection}
                      title="Deselect this object (Esc)"
                      aria-keyshortcuts="Escape"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </section>

              <aside className="osel-col">
            {info ? (
              <div className="osel-card">
                <h4 className="osel-h">Color</h4>
                <div className="osel-swrow">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`osel-sw ${colorApplied === c ? "sel" : ""}`}
                      title={`Recolor to ${c}`}
                      aria-label={`Recolor to ${c}`}
                      onClick={() => applyRecolor(c)}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="osel-pickrow">
                  <input
                    type="color"
                    className="osel-colorinput"
                    value={colorApplied || "#2f6fdb"}
                    onChange={(e) => applyRecolor(e.target.value)}
                    title="Pick any color"
                    aria-label="Pick any color"
                  />
                  <span className="osel-hex">
                    {(colorApplied || "").toUpperCase() || "Pick a colour"}
                  </span>
                  {(colorApplied || bright || sat || warm) && (
                    <button className="osel-btn osel-reset" onClick={resetColor}>
                      Reset
                    </button>
                  )}
                </div>
                <p className="osel-fine">Keeps the object's shading &amp; texture.</p>
              </div>
            ) : null}
            {info && (
              <div className="osel-card">
                <h4 className="osel-h">Adjustments</h4>
                <div className="osel-adjcol">
                  {[
                    { label: "Brightness", val: bright, on: onBright },
                    { label: "Saturation", val: sat, on: onSat },
                    { label: "Warmth", val: warm, on: onWarm },
                  ].map((s) => (
                    <div className="osel-adjrow" key={s.label}>
                      <div className="osel-adjtop">
                        <span className="osel-adjname">{s.label}</span>
                        <span className="osel-adjright">
                          {s.val !== 0 && (
                            <button
                              className="osel-adjreset"
                              title={`Reset ${s.label.toLowerCase()}`}
                              aria-label={`Reset ${s.label}`}
                              onClick={() => s.on(0)}
                            >
                              ↺
                            </button>
                          )}
                          <span className="osel-adjval">{s.val > 0 ? `+${s.val}` : s.val}</span>
                        </span>
                      </div>
                      <input
                        className="osel-range"
                        type="range"
                        min="-100"
                        max="100"
                        step="1"
                        value={s.val}
                        onChange={(e) => s.on(Number(e.target.value))}
                        aria-label={s.label}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {info && (
              <div className="osel-card">
                <h4 className="osel-h">Object actions</h4>
                <div className="osel-actions">
                  <button
                    className="osel-btn osel-btn-danger"
                    onClick={handleRemoveObject}
                    disabled={removing}
                    title="Remove this object and fill the space (uses the image-edit service)"
                  >
                    {removing ? (
                      <>
                        <Spinner animation="border" size="sm" /> Removing…
                      </>
                    ) : (
                      "Remove object"
                    )}
                  </button>
                  <button
                    className="osel-btn osel-btn-primary"
                    onClick={() => openFurniturePicker(true)}
                    disabled={removing || insertBusy || !!placing}
                    title="Remove this object and drop a new furniture photo in its place"
                  >
                    Replace…
                  </button>
                  <button
                    className="osel-btn"
                    onClick={resetAll}
                    disabled={removing || insertBusy || phase !== "ready"}
                    title="Revert the whole image to the original photo"
                  >
                    Reset all
                  </button>
                  <button
                    className="osel-btn"
                    onClick={clearSelection}
                    disabled={removing}
                    title="Deselect this object (Esc)"
                    aria-keyshortcuts="Escape"
                  >
                    Deselect
                  </button>
                </div>
              </div>
            )}
              </aside>
            </div>

          </div>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default ObjectSelector;
