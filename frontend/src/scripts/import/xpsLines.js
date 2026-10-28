/**
 * THE LINES OF A DWFx SHEET.
 *
 * A DWFx is an XPS package (ECMA-388): each 2D sheet is a FixedPage, an XML
 * page of <Path>s (lines and curves), <Glyphs> (text) and <Canvas>es that
 * group them, each with its own transform. This reads one FixedPage into the
 * same shape a CAD drawing is read into (dxfImport.js): segments on layers,
 * and texts — so a DWFx can be shown, measured and have walls built from it
 * exactly like a DXF.
 *
 * Positions are in XPS units (1/96 inch on the sheet), y up, origin at the
 * sheet's bottom-left. A Canvas's Name is taken as the layer, when it has
 * one; everything else is on layer "DWFx".
 *
 * Self-contained (no imports, no DOM): it runs in the import worker.
 */

/** One XPS unit, in centimetres on the sheet. */
export const XPS_UNIT_CM = 2.54 / 96;
const CURVE_STEPS = 8;
const MAX_LINES = 400000;
const MIN_LINE = 0.25;

const IDENTITY = [1, 0, 0, 1, 0, 0];
// [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f — XPS's
// "m11,m12,m21,m22,dx,dy" in that order.
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

const numbers = (s) => (String(s || "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
const matrixOf = (s) => {
  const v = numbers(s);
  return v.length === 6 ? v : null;
};
const pointOf = (s) => {
  const v = numbers(s);
  return v.length >= 2 ? [v[0], v[1]] : null;
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) =>
  String(s || "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });

const attrsOf = (s) => {
  const out = {};
  const re = /([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decode(m[3] ?? m[4]);
  return out;
};

// ── geometry ──────────────────────────────────────────────────────────────

// An arc from p0 to p1 (SVG/XPS endpoint form) as points along it.
const arcPoints = (p0, rx, ry, angleDeg, large, sweep, p1) => {
  if (!(rx > 0 && ry > 0)) return [p1];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    lambda = Math.sqrt(lambda);
    rx *= lambda;
    ry *= lambda;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
  const pts = [];
  for (let k = 1; k <= steps; k++) {
    const t = t1 + (dt * k) / steps;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    pts.push([cos * x - sin * y + cx, sin * x + cos * y + cy]);
  }
  return pts;
};

const cubic = (p0, c1, c2, p3) => {
  const pts = [];
  for (let k = 1; k <= CURVE_STEPS; k++) {
    const t = k / CURVE_STEPS;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
};
const quad = (p0, c, p2) =>
  cubic(
    p0,
    [p0[0] + (2 / 3) * (c[0] - p0[0]), p0[1] + (2 / 3) * (c[1] - p0[1])],
    [p2[0] + (2 / 3) * (c[0] - p2[0]), p2[1] + (2 / 3) * (c[1] - p2[1])],
    p2
  );

/**
 * XPS abbreviated geometry ("M 0,0 L 10,0 10,10 Z", and H V C Q S A, in
 * either case) → polylines: [{ pts, closed }].
 */
export const parseFigures = (data) => {
  const tokens = String(data || "").match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const figs = [];
  let fig = null;
  let cur = [0, 0];
  let start = [0, 0];
  let lastCtl = null;
  let cmd = null;
  let i = 0;
  const more = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const n = () => Number(tokens[i++]);
  const pt = (rel) => {
    const x = n();
    const y = n();
    return rel ? [cur[0] + x, cur[1] + y] : [x, y];
  };
  const add = (pts) => {
    if (!fig) {
      fig = { pts: [cur], closed: false };
      figs.push(fig);
    }
    fig.pts.push(...pts);
    cur = pts[pts.length - 1];
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "F": // fill rule: one number, not geometry
        if (more()) i++;
        cmd = null;
        break;
      case "M":
        cur = start = pt(rel);
        fig = { pts: [cur], closed: false };
        figs.push(fig);
        lastCtl = null;
        // Further pairs are lines.
        cmd = rel ? "l" : "L";
        if (!more()) cmd = null;
        break;
      case "L":
        while (more()) add([pt(rel)]);
        lastCtl = null;
        break;
      case "H":
        while (more()) {
          const x = n();
          add([[rel ? cur[0] + x : x, cur[1]]]);
        }
        lastCtl = null;
        break;
      case "V":
        while (more()) {
          const y = n();
          add([[cur[0], rel ? cur[1] + y : y]]);
        }
        lastCtl = null;
        break;
      case "C":
        while (more()) {
          const c1 = pt(rel);
          const c2 = pt(rel);
          const p = pt(rel);
          add(cubic(cur, c1, c2, p));
          lastCtl = c2;
        }
        break;
      case "S":
        while (more()) {
          const c1 = lastCtl ? [2 * cur[0] - lastCtl[0], 2 * cur[1] - lastCtl[1]] : cur;
          const c2 = pt(rel);
          const p = pt(rel);
          add(cubic(cur, c1, c2, p));
          lastCtl = c2;
        }
        break;
      case "Q":
        while (more()) {
          const c = pt(rel);
          const p = pt(rel);
          add(quad(cur, c, p));
          lastCtl = null;
        }
        break;
      case "A":
        while (more()) {
          const rx = n();
          const ry = n();
          const rot = n();
          const large = n() !== 0;
          const sweep = n() !== 0;
          const p = pt(rel);
          add(arcPoints(cur, rx, ry, rot, large, sweep, p));
        }
        lastCtl = null;
        break;
      case "Z":
        if (fig) fig.closed = true;
        cur = start;
        fig = null;
        cmd = null;
        break;
      default:
        // Something not geometry: skip its numbers.
        while (more()) i++;
        cmd = null;
    }
  }
  return figs.filter((f) => f.pts.length >= 2);
};

// A PathFigure element's own segments, read from its child elements.
const figureFrom = (fig) => {
  let cur = fig.start;
  const pts = [cur];
  fig.parts.forEach(({ tag, a }) => {
    const ptsOf = (s) => {
      const v = numbers(s);
      const out = [];
      for (let k = 0; k + 1 < v.length; k += 2) out.push([v[k], v[k + 1]]);
      return out;
    };
    if (tag === "PolyLineSegment") pts.push(...ptsOf(a.Points));
    else if (tag === "LineSegment") {
      const p = pointOf(a.Point);
      if (p) pts.push(p);
    } else if (tag === "PolyBezierSegment") {
      const v = ptsOf(a.Points);
      for (let k = 0; k + 2 < v.length; k += 3) pts.push(...cubic(pts[pts.length - 1], v[k], v[k + 1], v[k + 2]));
    } else if (tag === "BezierSegment") {
      const c1 = pointOf(a.Point1);
      const c2 = pointOf(a.Point2);
      const p = pointOf(a.Point3);
      if (c1 && c2 && p) pts.push(...cubic(pts[pts.length - 1], c1, c2, p));
    } else if (tag === "PolyQuadraticBezierSegment") {
      const v = ptsOf(a.Points);
      for (let k = 0; k + 1 < v.length; k += 2) pts.push(...quad(pts[pts.length - 1], v[k], v[k + 1]));
    } else if (tag === "QuadraticBezierSegment") {
      const c = pointOf(a.Point1);
      const p = pointOf(a.Point2);
      if (c && p) pts.push(...quad(pts[pts.length - 1], c, p));
    } else if (tag === "ArcSegment") {
      const p = pointOf(a.Point);
      const size = pointOf(a.Size);
      if (p && size) {
        pts.push(
          ...arcPoints(
            pts[pts.length - 1],
            size[0],
            size[1],
            Number(a.RotationAngle) || 0,
            String(a.IsLargeArc).toLowerCase() === "true",
            String(a.SweepDirection).toLowerCase() === "clockwise",
            p
          )
        );
      }
    }
    cur = pts[pts.length - 1];
  });
  return { pts, closed: fig.closed };
};

/**
 * One FixedPage's lines and texts.
 * Returns { segs: [{ layer, a, b }], texts: [{ layer, p, h, text }], w, h, truncated }.
 */
export const xpsLines = (xml) => {
  const segs = [];
  const texts = [];
  let W = 0;
  let H = 0;
  let truncated = false;
  // The open elements: each with its transform from page space and its layer.
  const stack = [{ tag: "#root", m: IDENTITY, layer: "DWFx" }];
  const top = () => stack[stack.length - 1];
  let path = null; // the Path being read: { m, layer, figures, geomM, figure }

  const emit = (m, layer, figs) => {
    for (const f of figs) {
      const pts = f.pts.map((p) => apply(m, p));
      const count = f.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < count; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_LINE) continue;
        if (segs.length >= MAX_LINES) {
          truncated = true;
          return;
        }
        segs.push({ layer, a, b });
      }
    }
  };
  // A path's own figures, then its geometry's (which have their own
  // transform, possibly given after them).
  const finishPath = (p) => {
    if (!p.paints) return;
    emit(p.m, p.layer, p.figures);
    if (p.geomFigures.length) {
      emit(
        mul(p.m, p.geomM),
        p.layer,
        p.geomFigures
      );
    }
  };

  const re = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let t;
  while ((t = re.exec(xml)) && !truncated) {
    const closing = t[1] === "/";
    const tag = t[2].replace(/^\w+:/, "");
    const selfClosing = t[4] === "/";
    if (closing) {
      if (tag === "Path" && path) {
        finishPath(path);
        path = null;
      } else if (tag === "PathFigure" && path && path.figure) {
        path.geomFigures.push(figureFrom(path.figure));
        path.figure = null;
      }
      // Pop to the matching element.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const a = attrsOf(t[3]);
    const parent = top();
    if (tag === "FixedPage") {
      W = Number(a.Width) || W;
      H = Number(a.Height) || H;
    }
    if (tag === "Canvas") {
      const local = matrixOf(a.RenderTransform);
      const name = a.Name && a.Name.trim();
      const entry = { tag, m: local ? mul(parent.m, local) : parent.m, layer: name || parent.layer, base: parent.m };
      if (!selfClosing) stack.push(entry);
      continue;
    }
    if (tag === "MatrixTransform") {
      const local = matrixOf(a.Matrix);
      if (!local) continue;
      // Inside <Canvas.RenderTransform>, <Path.RenderTransform> or
      // <PathGeometry.Transform>: the element it belongs to.
      const owner = stack[stack.length - 1];
      if (owner && owner.tag === "Canvas.RenderTransform") {
        const canvas = stack[stack.length - 2];
        if (canvas && canvas.tag === "Canvas") canvas.m = mul(canvas.base, local);
      } else if (path && owner && owner.tag === "Path.RenderTransform") {
        path.m = mul(path.base, local);
      } else if (path && owner && owner.tag === "PathGeometry.Transform") {
        path.geomM = local;
      }
      continue;
    }
    if (tag === "Path") {
      const local = matrixOf(a.RenderTransform);
      const p = {
        base: parent.m,
        m: local ? mul(parent.m, local) : parent.m,
        layer: parent.layer,
        figures: [],
        geomFigures: [],
        geomM: IDENTITY,
        figure: null,
        paints: !!(a.Stroke || a.Fill),
      };
      if (a.Data) p.figures.push(...parseFigures(a.Data));
      if (selfClosing) finishPath(p);
      else {
        path = p;
        stack.push({ tag, m: p.m, layer: p.layer });
      }
      continue;
    }
    if (path && (tag === "Path.Stroke" || tag === "Path.Fill")) {
      // A brush given as a child element paints too.
      path.paints = true;
    } else if (path && tag === "PathGeometry") {
      const local = matrixOf(a.Transform);
      if (local) path.geomM = local;
      if (a.Figures) path.geomFigures.push(...parseFigures(a.Figures));
    } else if (path && tag === "PathFigure") {
      const start = pointOf(a.StartPoint) || [0, 0];
      path.figure = { start, closed: String(a.IsClosed).toLowerCase() === "true", parts: [] };
      if (selfClosing) {
        path.figure = null;
      }
    } else if (path && path.figure && /Segment$/.test(tag)) {
      path.figure.parts.push({ tag, a });
    } else if (tag === "Glyphs") {
      const text = (a.UnicodeString || "").trim();
      if (text) {
        const local = matrixOf(a.RenderTransform);
        const m = local ? mul(parent.m, local) : parent.m;
        const p = apply(m, [Number(a.OriginX) || 0, Number(a.OriginY) || 0]);
        const size = (Number(a.FontRenderingEmSize) || 10) * Math.hypot(m[2], m[3]);
        texts.push({ layer: parent.layer, p, h: size, text });
      }
    }
    if (!selfClosing && tag !== "Path") stack.push({ tag, m: top().m, layer: top().layer });
  }

  // y down on the sheet → y up, like a CAD drawing.
  const flip = (p) => [p[0], H - p[1]];
  segs.forEach((s) => {
    s.a = flip(s.a);
    s.b = flip(s.b);
  });
  texts.forEach((x) => {
    x.p = flip(x.p);
  });
  return { segs, texts, w: W, h: H, truncated };
};
