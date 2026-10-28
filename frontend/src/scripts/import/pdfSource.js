import { userError } from "./fileCheck";
import { SHEET_BORDER } from "./sheetBorder";

/**
 * A PDF FLOOR PLAN, through pdf.js (Mozilla's PDF engine, the one in Firefox).
 *
 * pdf.js is loaded only when a PDF is opened, and parses in its own worker,
 * so the page stays responsive. What a plan import needs from a PDF:
 *
 *   - its pages (a set can hold many sheets), with small previews to choose by;
 *   - its LAYERS (PDF "optional content"), which a PDF printed from CAD keeps,
 *     so the plan's own layers can be shown or left out;
 *   - a page rendered sharp, at the size the 2D view can hold;
 *   - for a PDF printed from CAD, the drawing's real LINES — the way AutoCAD's
 *     PDF import does — so walls can be built from them, not just traced. A
 *     scanned PDF holds a picture instead, and gives none.
 *
 * Positions are in PDF points (1/72 inch on the printed sheet), y up, origin
 * at the page's bottom-left as it is shown (its own rotation applied).
 */

/** One PDF point, in centimetres on the printed sheet. */
export const PT_CM = 2.54 / 72;
/** Sharpest a page is rendered: print resolution is plenty to trace. */
const MAX_DPI = 300;
/** Beyond this many lines a page is detail or hatching, not just the plan. */
const MAX_LINES = 400000;
/** Shorter than this (points) a line is a speck, not part of the drawing. */
const MIN_LINE_PT = 0.25;
/** Points along a curve. */
const CURVE_STEPS = 8;
/** Lines a page needs to count as a drawing rather than a picture. */
const MIN_VECTOR_LINES = 40;

let pdfjsPromise = null;
const loadPdfJs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackChunkName: "pdfjs" */ "pdfjs-dist").then((pdfjs) => {
      // pdf.js parses in its own worker. Where workers don't exist (a plain
      // Node test), it falls back to doing the work in place.
      if (typeof Worker !== "undefined") {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.js", import.meta.url), {
          type: "module",
        });
      }
      return pdfjs;
    });
  }
  return pdfjsPromise;
};

/**
 * Open a PDF. Returns { pdf, pages, layers: [{ id, name, visible }] }.
 * Throws a user-facing error for a locked or damaged one.
 */
export const openPdf = async (data) => {
  const pdfjs = await loadPdfJs();
  let pdf;
  try {
    // No eval: fonts are drawn without generated code (the safe setting).
    pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      throw userError("This PDF is password-protected. Save a copy without the password and import that.");
    }
    throw userError("This PDF is damaged or couldn't be opened. Save or export it again and import the new file.");
  }
  const config = await pdf.getOptionalContentConfig();
  const groups = config.getGroups() || {};
  const layers = Object.keys(groups).map((id) => ({
    id,
    name: String(groups[id].name || id).trim() || id,
    visible: !!groups[id].visible,
  }));
  return { pdf, pages: pdf.numPages, layers };
};

/** The page's size in points, as shown (its rotation plus any extra turn). */
export const pageSize = async (pdf, n, turn = 0) => {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + turn) % 360 });
  return { w: vp.width, h: vp.height };
};

// A layer setting for one render: the PDF's own, with the hidden layers off.
const configWith = async (pdf, hidden) => {
  const config = await pdf.getOptionalContentConfig();
  (hidden || []).forEach((id) => {
    try {
      config.setVisibility(id, false);
    } catch (e) {
      /* a layer the page doesn't have */
    }
  });
  return config;
};

/**
 * Render a page onto a new canvas, its longest side at most `maxPx` pixels
 * (and no finer than print resolution). Returns { canvas, scale } — scale
 * being pixels per point.
 */
export const renderPage = async (pdf, n, { maxPx, hidden = [], turn = 0 } = {}) => {
  const page = await pdf.getPage(n);
  const rotation = (page.rotate + turn) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(maxPx / Math.max(base.width, base.height), MAX_DPI / 72);
  const vp = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport: vp,
    optionalContentConfigPromise: configWith(pdf, hidden),
  }).promise;
  return { canvas, scale };
};

/** A small picture of a page, to choose it by. */
export const pageThumbnail = async (pdf, n, px) => {
  const { canvas } = await renderPage(pdf, n, { maxPx: px });
  return canvas.toDataURL("image/png");
};

// pdf.js transforms: [a, b, c, d, e, f], x' = a·x + c·y + e, y' = b·x + d·y + f.
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const grayRgb = (g) => {
  const v = g <= 1 ? g * 255 : g;
  return [v, v, v];
};
const cmykRgb = ([c, m, y, k]) => [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];

/** A colour in words: black and the greys by their depth, any other as its hex code. */
const colourName = ([r, g, b]) => {
  const R = Math.round(r);
  const G = Math.round(g);
  const B = Math.round(b);
  if (Math.max(R, G, B) - Math.min(R, G, B) < 24) {
    const l = (R + G + B) / 3;
    if (l < 40) return "black";
    if (l < 110) return "dark grey";
    if (l < 170) return "grey";
    if (l < 230) return "light grey";
    return "white";
  }
  return `#${[R, G, B].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** A colour dark enough to be drawn as a solid block (average of red, green, blue, 0–255). */
const SOLID_DARK_MAX = 45;
const isDark = (rgb) => (rgb[0] + rgb[1] + rgb[2]) / 3 <= SOLID_DARK_MAX;

/** What a path painted this way is called when the PDF has no layers of its own. */
const paintLayerName = (kind, rgb, width) =>
  kind === "fill"
    ? `Filled shapes · ${colourName(rgb)}`
    : `Pen · ${colourName(rgb)} · ${(Math.round(width * 20) / 20).toFixed(2)} pt`;

/**
 * THE SHEET'S FRAME. A plotted sheet is drawn inside a rectangle near the
 * edge of the paper; its lines are as long as the sheet and would be taken
 * for the plan's biggest walls, and for the plan's width. Long straight lines
 * lying close to the paper's edge go to a layer of their own. Only lines with
 * no layer of the PDF's own are looked at: a drawing's own layers say what
 * they are.
 */
const EDGE_FRACTION = 0.035;
const LONG_FRACTION = 0.6;
const markSheetBorder = (segs, w, h) => {
  segs.forEach((s) => {
    if (s.layer !== "PDF" && !/^(Pen|Filled shapes) ·/.test(s.layer)) return;
    const dx = Math.abs(s.b[0] - s.a[0]);
    const dy = Math.abs(s.b[1] - s.a[1]);
    const horizontal = dy < 0.5 && dx >= LONG_FRACTION * w;
    const vertical = dx < 0.5 && dy >= LONG_FRACTION * h;
    if (!horizontal && !vertical) return;
    const near = horizontal
      ? s.a[1] <= EDGE_FRACTION * h || s.a[1] >= h * (1 - EDGE_FRACTION)
      : s.a[0] <= EDGE_FRACTION * w || s.a[0] >= w * (1 - EDGE_FRACTION);
    if (near) s.layer = SHEET_BORDER;
  });
};

/**
 * THE PAGE'S LINES: every stroked or filled path, flattened to segments, in
 * points (y up), each on its PDF layer — what is drawn, in the place it is
 * drawn, through every transform. Clipping paths are not drawing; text is
 * collected apart, for room names.
 *
 * Returns { segs: [{ layer, a, b }], texts: [{ layer, p, h, text }],
 *           w, h, isDrawing, truncated }.
 */
export const pageLines = async (pdf, n, { hidden = [], turn = 0 } = {}) => {
  const pdfjs = await loadPdfJs();
  const OPS = pdfjs.OPS;
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + turn) % 360 });
  const config = await configWith(pdf, hidden);
  const groups = config.getGroups() || {};
  const groupName = (props) => {
    const id = props && (props.id || (props.ids && props.ids[0]));
    return id && groups[id] ? String(groups[id].name || id) : null;
  };
  const list = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });

  // The viewport turns PDF space into the shown page (y down); flipped once
  // more, points come out y up, like a CAD drawing.
  const H = vp.height;
  const out = [];
  let truncated = false;
  let ctm = vp.transform.slice();
  const stack = [];
  // How the page is being painted — colours and the pen — kept with the
  // graphics state. A PDF with no layers of its own (a plot flattened to a
  // sheet) still keeps walls, furniture and lettering apart by it: walls are
  // a filled grey, or one heavy pen; furniture another.
  const noLayers = Object.keys(groups).length === 0;
  let fillCol = [0, 0, 0];
  let strokeCol = [0, 0, 0];
  let penWidth = 1;
  const paintStack = [];
  const saveState = () => {
    stack.push(ctm);
    paintStack.push([fillCol, strokeCol, penWidth]);
  };
  const restoreState = () => {
    if (stack.length) ctm = stack.pop();
    if (paintStack.length) [fillCol, strokeCol, penWidth] = paintStack.pop();
  };
  // Marked content: what is hidden, and the layer name, as nested.
  const marks = [{ visible: true, layer: null }];
  const mark = () => marks[marks.length - 1];
  let pending = [];
  let start = null;
  let cur = null;
  const point = (x, y) => {
    const p = apply(ctm, x, y);
    return [p[0], H - p[1]];
  };
  const line = (p, q) => pending.push([p, q]);
  // `kind` is how the path is painted: "pen" (stroked) or "fill".
  const commit = (close, kind = "pen") => {
    if (close && cur && start) line(cur, start);
    const m = mark();
    if (m.visible) {
      const layer =
        m.layer ||
        (noLayers
          ? paintLayerName(kind, kind === "fill" ? fillCol : strokeCol, penWidth * Math.hypot(ctm[0], ctm[1]))
          : "PDF");
      for (const [p, q] of pending) {
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < MIN_LINE_PT) continue;
        if (out.length >= MAX_LINES) {
          truncated = true;
          break;
        }
        // A shape painted solid dark says so (`fill`): a column is drawn that
        // way, where a window's frame is only outlined and a wall is a lighter fill.
        out.push(kind === "fill" && isDark(fillCol) ? { layer, a: p, b: q, fill: true } : { layer, a: p, b: q });
      }
    }
    pending = [];
  };
  const curve = (p0, c1, c2, p3) => {
    let prev = p0;
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0];
      const y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1];
      const q = [x, y];
      line(prev, q);
      prev = q;
    }
  };

  const fns = list.fnArray;
  const args = list.argsArray;
  for (let i = 0; i < fns.length; i++) {
    const a = args[i];
    switch (fns[i]) {
      case OPS.save:
        saveState();
        break;
      case OPS.restore:
        restoreState();
        break;
      case OPS.transform:
        ctm = mul(ctm, a);
        break;
      case OPS.paintFormXObjectBegin:
        saveState();
        if (a && a[0]) ctm = mul(ctm, a[0]);
        break;
      case OPS.paintFormXObjectEnd:
        restoreState();
        break;
      case OPS.setLineWidth:
        penWidth = a[0];
        break;
      case OPS.setFillRGBColor:
        fillCol = [a[0], a[1], a[2]];
        break;
      case OPS.setStrokeRGBColor:
        strokeCol = [a[0], a[1], a[2]];
        break;
      case OPS.setFillGray:
        fillCol = grayRgb(a[0]);
        break;
      case OPS.setStrokeGray:
        strokeCol = grayRgb(a[0]);
        break;
      case OPS.setFillCMYKColor:
        fillCol = cmykRgb(a);
        break;
      case OPS.setStrokeCMYKColor:
        strokeCol = cmykRgb(a);
        break;
      case OPS.beginMarkedContentProps: {
        const parent = mark();
        if (a && a[0] === "OC") {
          marks.push({
            visible: parent.visible && config.isVisible(a[1]),
            layer: groupName(a[1]) || parent.layer,
          });
        } else marks.push({ ...parent });
        break;
      }
      case OPS.beginMarkedContent:
        marks.push({ ...mark() });
        break;
      case OPS.endMarkedContent:
        if (marks.length > 1) marks.pop();
        break;
      case OPS.constructPath: {
        const ops = a[0];
        const v = a[1];
        let j = 0;
        for (let k = 0; k < ops.length; k++) {
          switch (ops[k] | 0) {
            case OPS.rectangle: {
              const x = v[j++];
              const y = v[j++];
              const w = v[j++];
              const h = v[j++];
              const p1 = point(x, y);
              const p2 = point(x + w, y);
              const p3 = point(x + w, y + h);
              const p4 = point(x, y + h);
              line(p1, p2);
              line(p2, p3);
              line(p3, p4);
              line(p4, p1);
              start = cur = p1;
              break;
            }
            case OPS.moveTo:
              start = cur = point(v[j++], v[j++]);
              break;
            case OPS.lineTo: {
              const p = point(v[j++], v[j++]);
              if (cur) line(cur, p);
              cur = p;
              break;
            }
            case OPS.curveTo: {
              const c1 = point(v[j++], v[j++]);
              const c2 = point(v[j++], v[j++]);
              const p = point(v[j++], v[j++]);
              if (cur) curve(cur, c1, c2, p);
              cur = p;
              break;
            }
            case OPS.curveTo2: {
              // First control point is the current point.
              const c2 = point(v[j++], v[j++]);
              const p = point(v[j++], v[j++]);
              if (cur) curve(cur, cur, c2, p);
              cur = p;
              break;
            }
            case OPS.curveTo3: {
              // Second control point is the end point.
              const c1 = point(v[j++], v[j++]);
              const p = point(v[j++], v[j++]);
              if (cur) curve(cur, c1, p, p);
              cur = p;
              break;
            }
            case OPS.closePath:
              if (cur && start) line(cur, start);
              cur = start;
              break;
            default:
              break;
          }
        }
        break;
      }
      case OPS.stroke:
        commit(false, "pen");
        break;
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        commit(false, "fill");
        break;
      case OPS.closeStroke:
        commit(true, "pen");
        break;
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        commit(true, "fill");
        break;
      case OPS.endPath:
        // A path ended without being painted: a clipping path.
        pending = [];
        break;
      default:
        break;
    }
    if (truncated) break;
  }

  markSheetBorder(out, vp.width, vp.height);

  // Text, for room names: where each piece starts, how tall it is. Its layer
  // is named as text, so it is taken for the room names unless changed.
  const texts = [];
  try {
    const content = await page.getTextContent();
    content.items.forEach((it) => {
      const str = it && typeof it.str === "string" ? it.str.trim() : "";
      if (!str || !it.transform) return;
      const m = mul(vp.transform, it.transform);
      // The way the text runs, as a unit vector in the page's y-up space, and
      // its centre along that way (a turned dimension runs up a line).
      const run = Math.hypot(m[0], m[1]) || 1;
      const dir = [m[0] / run, -m[1] / run];
      const half = (it.width || 0) / 2;
      texts.push({
        layer: "PDF text",
        p: [m[4] + dir[0] * half, H - m[5] + dir[1] * half],
        h: Math.hypot(m[2], m[3]) || 1,
        text: str,
        dir,
      });
    });
  } catch (e) {
    /* a page without readable text */
  }

  return {
    segs: out,
    texts,
    w: vp.width,
    h: vp.height,
    isDrawing: out.length >= MIN_VECTOR_LINES,
    truncated,
  };
};
