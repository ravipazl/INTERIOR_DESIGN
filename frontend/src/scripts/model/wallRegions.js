/**
 * AREAS OF ONE WALL FACE — the data behind the Wall Editor.
 *
 * A wall side has always carried exactly one material, for the whole face.
 * An area ("region") is a shape on that face with a material of its own: a
 * tiled band behind a counter, an arched panel, a round feature, a strip of
 * light.
 *
 * WHERE A REGION IS. In the face's own plane, in centimetres:
 *
 *   x  along the wall, from the face's start
 *   y  up from the floor
 *
 * Real sizes, deliberately, not fractions of the wall: a 60 cm band is a
 * 60 cm band. If the wall is later made shorter or lower, regions are trimmed
 * to it rather than squeezed.
 *
 * WHAT A REGION IS. An outline — `points`, a closed polygon — and what it is
 * made of. Every shape the editor draws ends up as one: a rectangle is four
 * points, a circle is many, a curve is a chord and an arc. One representation
 * means one way to draw, hit-test, cut and save all of them.
 *
 *   id         its identity
 *   kind       how it was drawn (rect, polygon, circle, oval, curve, free,
 *              light, molding) — informative; the outline is what is used
 *   points     [[x, y], …]
 *   parts      optional: several outlines that are one region (a molding is
 *              a frame made of strips). When present it replaces `points`.
 *   texture    the pack a wall side carries ({ colormap, color, … }) or null:
 *              no material of its own, see-through, drawn by nothing
 *   extrusion  how far it stands out from the wall, in cm
 *   light      true for a strip of light: drawn glowing, not textured
 *   arch       for an arch, the numbers it is drawn from (see archPoints)
 *
 * THE LIST IS A STACK. A later region lies on top of an earlier one.
 *
 * Regions saved by the first version of the editor were rectangles written as
 * { x, y, w, h }. They are still read, and become four points.
 *
 * Nothing here touches three.js or the DOM, so the 3D view, the editor page
 * and its preview all build on the same arithmetic.
 */

/** Below this (cm) a sliver is noise from rounding, not something drawn. */
export const MIN_REGION_CM = 0.5;
const MIN_AREA = MIN_REGION_CM * MIN_REGION_CM;

let seq = 0;
export const newRegionId = () =>
  `r${Date.now().toString(36)}${(seq++).toString(36)}`;

const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
const round = (v) => Math.round(num(v) * 100) / 100;
const roundPoints = (points) => points.map((p) => [round(p[0]), round(p[1])]);

// ── shapes ────────────────────────────────────────────────────────────────

export const rectPoints = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** An ellipse as a polygon. 64 sides reads as round at any size a wall has. */
export const ovalPoints = (cx, cy, rx, ry, sides = 64) => {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
};

/** A straight strip of a given width from a to b — a line of light. */
export const stripPoints = (a, b, width) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
    [a[0] + nx, a[1] + ny],
  ];
};

/**
 * The shape between a straight line from a to b and an arc through `via`:
 * what the Curve tool draws. `via` is where the pointer is; only its distance
 * from the chord is used, as the arc's height. Returns { points, height }.
 */
export const curvePoints = (a, b, via, steps = 32) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  if (chord < MIN_REGION_CM) return { points: [], height: 0 };
  const nx = -dy / chord;
  const ny = dx / chord;
  // Signed height: which side of the chord the arc bulges to.
  let h = (via[0] - a[0]) * nx + (via[1] - a[1]) * ny;
  if (Math.abs(h) < MIN_REGION_CM) return { points: [], height: 0 };
  // An arc higher than half the chord is more than a semicircle; capped
  // there, which is as far as an arch on a wall goes.
  const cap = chord / 2;
  if (Math.abs(h) > cap) h = Math.sign(h) * cap;
  const r = (chord * chord) / (8 * Math.abs(h)) + Math.abs(h) / 2;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const d = r - Math.abs(h);
  const cx = mx - nx * Math.sign(h) * d;
  const cy = my - ny * Math.sign(h) * d;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  let a1 = Math.atan2(b[1] - cy, b[0] - cx);
  // Sweep through the side the bulge is on.
  const apex = Math.atan2(my + ny * h - cy, mx + nx * h - cx);
  const norm = (t) => ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const ccw = norm(apex - a0) < norm(a1 - a0);
  let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (sweep * i) / steps;
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return { points: pts, height: Math.abs(h) };
};

/**
 * AN ARCH: the band round an arched opening — two legs and a curved head of
 * one thickness, open in the middle and at the foot.
 *
 * It is described by numbers, not by a drawn line, because that is what makes
 * it accurate and what makes it editable: change the span and the same arch
 * is simply drawn again.
 *
 *   cx, y      the middle of the opening, at the level its feet stand on
 *   span       the clear width between the legs
 *   rise       how far the head curves up above the top of the legs
 *              (0 is a flat head; half the span is a full semicircle)
 *   leg        the straight height of the legs below the curve
 *   thickness  the width of the band
 *
 * The inner and outer curves spring from the tops of the inner and outer
 * edges of the legs, so the band meets its legs cleanly at any rise, and at
 * a semicircle the two curves share a centre and the band is exactly even.
 *
 * Returns the outline as one polygon, or [] when the numbers make no arch.
 */
export const normalizeArch = (arch) => {
  const span = Math.max(num(arch && arch.span), 0);
  return {
    cx: num(arch && arch.cx),
    y: num(arch && arch.y),
    span,
    // No head can rise more than a semicircle on its span.
    rise: Math.min(Math.max(num(arch && arch.rise), 0), span / 2),
    leg: Math.max(num(arch && arch.leg), 0),
    thickness: Math.max(num(arch && arch.thickness), 0),
  };
};

export const archPoints = (arch) => {
  const a = normalizeArch(arch);
  if (a.span < MIN_REGION_CM * 2 || a.thickness < MIN_REGION_CM) return [];
  if (a.rise + a.leg < MIN_REGION_CM) return [];
  const t = a.thickness;
  const xl = a.cx - a.span / 2;
  const xr = a.cx + a.span / 2;
  const foot = a.y;
  const spring = a.y + a.leg;
  // Left to right over the top; a flat head when there is no rise.
  const head = (x0, x1, top) => {
    if (top - spring < MIN_REGION_CM) return [[x0, top], [x1, top]];
    return curvePoints([x0, spring], [x1, spring], [(x0 + x1) / 2, top], 48).points;
  };
  const outer = head(xl - t, xr + t, spring + a.rise + t);
  const inner = head(xl, xr, spring + a.rise).reverse();
  const flat = a.rise < MIN_REGION_CM;
  const ring = []
    .concat([[xl - t, foot]])
    // A flat head has square shoulders: up the outside, across, down.
    .concat(flat ? [[xl - t, spring + t], [xr + t, spring + t]] : outer)
    .concat([[xr + t, foot], [xr, foot]])
    .concat(flat ? [[xr, spring], [xl, spring]] : inner)
    .concat([[xl, foot]]);
  // Where a leg has no height its foot and its springing are one point.
  const out = [];
  ring.forEach((pt) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-6) out.push(pt);
  });
  return out;
};

// ── polygon arithmetic ────────────────────────────────────────────────────

/** Twice-signed area: positive when the points run anticlockwise. */
export const signedArea = (points) => {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
export const polygonArea = (points) => Math.abs(signedArea(points));

export const boundsOf = (points) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  (points || []).forEach((p) => {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const pointInPolygon = (points, x, y) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Keep the part of a polygon on one side of the line a→b (Sutherland–Hodgman,
 * one edge). `left` true keeps the side to the left of the direction a→b.
 * Exact for the convex shapes a wall is mostly made of; for a concave one it
 * can leave a hairline joining two pieces, which fills and draws correctly.
 */
export const clipHalfPlane = (points, a, b, left = true) => {
  const side = (p) => {
    const s = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return left ? s : -s;
  };
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0 && sq < 0) || (sp < 0 && sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};

/** The part of a polygon inside a rectangle. */
export const clipToRect = (points, rect) => {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  let p = points;
  p = clipHalfPlane(p, [x0, y0], [x1, y0], true);
  if (p.length) p = clipHalfPlane(p, [x1, y0], [x1, y1], true);
  if (p.length) p = clipHalfPlane(p, [x1, y1], [x0, y1], true);
  if (p.length) p = clipHalfPlane(p, [x0, y1], [x0, y0], true);
  return p;
};

/**
 * A polygon with a rectangle cut out of it — up to four pieces: what lies to
 * the left of the cut, to the right, and below and above it in between. Each
 * is the polygon clipped to a convex zone, so no general polygon subtraction
 * is needed. This is how a door or window is cut out of an area.
 */
export const subtractRectFromPolygon = (points, rect) => {
  const b = boundsOf(points);
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  // Not touching: the polygon is its own answer.
  if (b.x >= x1 || b.x + b.w <= x0 || b.y >= y1 || b.y + b.h <= y0) {
    return [points];
  }
  const big = 1e6;
  const zones = [
    { x: -big, y: -big, w: x0 + big, h: 2 * big },
    { x: x1, y: -big, w: big, h: 2 * big },
    { x: x0, y: -big, w: x1 - x0, h: y0 + big },
    { x: x0, y: y1, w: x1 - x0, h: big },
  ];
  return zones
    .map((z) => clipToRect(points, z))
    .filter((p) => p.length >= 3 && polygonArea(p) > MIN_AREA);
};

/** Cut a polygon in two along the infinite line through a and b. */
export const splitByLine = (points, a, b) =>
  [clipHalfPlane(points, a, b, true), clipHalfPlane(points, a, b, false)].filter(
    (p) => p.length >= 3 && polygonArea(p) > MIN_AREA
  );

/**
 * The same outline, `d` cm inside itself (negative: outside). Each edge is
 * moved in by `d` and neighbours are re-joined where they now meet. Right for
 * any convex outline; where the result folds over itself (a deep notch, or an
 * offset larger than the shape) the outline is shrunk towards its centre
 * instead, which is always a valid shape. Returns [] when nothing is left.
 */
export const offsetPolygon = (points, d) => {
  const n = points.length;
  if (n < 3) return [];
  const ccw = signedArea(points) > 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Inward normal: left of the edge when the points run anticlockwise.
    const nx = ((ccw ? -dy : dy) / len) * d;
    const ny = ((ccw ? dx : -dx) / len) * d;
    lines.push({ px: a[0] + nx, py: a[1] + ny, dx, dy });
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[(i + lines.length - 1) % lines.length];
    const l2 = lines[i];
    const cross = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(cross) < 1e-9) {
      out.push([l2.px, l2.py]);
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / cross;
    out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
  }
  const before = polygonArea(points);
  const after = polygonArea(out);
  const sameTurn = signedArea(out) > 0 === ccw;
  const sane =
    out.length >= 3 && sameTurn && (d > 0 ? after < before : after > before);
  if (sane) return after > MIN_AREA ? out : [];
  // Fallback: scale about the middle of the bounding box.
  const b = boundsOf(points);
  const k = 1 - (2 * d) / Math.max(Math.min(b.w, b.h), 1e-6);
  if (k <= 0.02) return [];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return points.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
};

/**
 * A frame of the given width just inside an outline: one four-sided strip per
 * edge, between the outline and the same outline moved in. Together they are
 * the molding round an area. [] when the area is too small to take one.
 */
export const frameParts = (points, width) => {
  const inner = offsetPolygon(points, width);
  if (inner.length !== points.length) return [];
  const parts = [];
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const quad = [points[i], points[j], inner[j], inner[i]];
    if (polygonArea(quad) > MIN_AREA / 4) parts.push(quad);
  }
  return parts;
};

/** Drop points that add nothing to a hand-drawn line (Douglas–Peucker). */
export const simplifyLine = (points, tolerance = 1) => {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const a = points[s];
    const b = points[e];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const dist =
        Math.abs(dy * (points[i][0] - a[0]) - dx * (points[i][1] - a[1])) / len;
      if (dist > worst) {
        worst = dist;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = true;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

/** The centre of a polygon's area — inside it, for any convex one. */
export const centroidOf = (points) => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const w = p[0] * q[1] - q[0] * p[1];
    a += w;
    cx += (p[0] + q[0]) * w;
    cy += (p[1] + q[1]) * w;
  }
  if (Math.abs(a) < 1e-9) return points[0];
  return [cx / (3 * a), cy / (3 * a)];
};

/**
 * DO TWO OUTLINES LIE OVER ONE ANOTHER — or do they only touch?
 *
 * The difference matters to how they are drawn. Two tiles of a pattern share
 * an edge and nothing else; a panel drawn on a tiled band covers part of it.
 * Only the second pair needs one of them drawn in front of the other.
 *
 * They overlap when the middle of one is inside the other, or when an edge of
 * one genuinely crosses an edge of the other. "Genuinely" leaves out a
 * crossing right at the end of an edge: neighbours cut from the same line
 * meet corner to edge, and rounding can leave such a corner a hair over the
 * line without the two being on top of each other in any way that shows.
 */
export const outlinesOverlap = (a, b) => {
  const ba = boundsOf(a);
  const bb = boundsOf(b);
  const slack = 0.05;
  if (
    ba.x + ba.w <= bb.x + slack ||
    bb.x + bb.w <= ba.x + slack ||
    ba.y + ba.h <= bb.y + slack ||
    bb.y + bb.h <= ba.y + slack
  ) {
    return false;
  }
  const ca = centroidOf(a);
  const cb = centroidOf(b);
  if (pointInPolygon(b, ca[0], ca[1]) || pointInPolygon(a, cb[0], cb[1])) {
    return true;
  }
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    const rx = q[0] - p[0];
    const ry = q[1] - p[1];
    const lenA = Math.hypot(rx, ry);
    if (lenA < slack * 2) continue;
    for (let j = 0; j < b.length; j++) {
      const u = b[j];
      const v = b[(j + 1) % b.length];
      const sx = v[0] - u[0];
      const sy = v[1] - u[1];
      const lenB = Math.hypot(sx, sy);
      if (lenB < slack * 2) continue;
      const cross = rx * sy - ry * sx;
      if (Math.abs(cross) < 1e-9) continue; // parallel: sharing an edge
      const t = ((u[0] - p[0]) * sy - (u[1] - p[1]) * sx) / cross;
      const w = ((u[0] - p[0]) * ry - (u[1] - p[1]) * rx) / cross;
      const ta = slack / lenA;
      const tb = slack / lenB;
      if (t > ta && t < 1 - ta && w > tb && w < 1 - tb) return true;
    }
  }
  return false;
};

/** Do two regions lie over one another anywhere? */
export const regionsOverlap = (first, second) => {
  const pa = regionParts(first);
  const pb = regionParts(second);
  return pa.some((a) => pb.some((b) => outlinesOverlap(a, b)));
};

// ── regions ───────────────────────────────────────────────────────────────

/** The outlines a region is made of: its parts, or its one outline. */
export const regionParts = (region) => {
  if (!region) return [];
  if (Array.isArray(region.parts) && region.parts.length) return region.parts;
  return Array.isArray(region.points) && region.points.length >= 3
    ? [region.points]
    : [];
};

/** The box round everything a region is made of. */
export const regionBounds = (region) =>
  boundsOf(regionParts(region).reduce((all, p) => all.concat(p), []));

const isPoint = (p) =>
  Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]);

const cleanOutline = (points, face) => {
  if (!Array.isArray(points)) return null;
  const pts = points.filter(isPoint).map((p) => [num(p[0]), num(p[1])]);
  if (pts.length < 3) return null;
  const inside = clipToRect(pts, face);
  return inside.length >= 3 && polygonArea(inside) > MIN_AREA
    ? roundPoints(inside)
    : null;
};

/**
 * What was saved, made safe to use against a wall of this size: numbers
 * checked, trimmed to the face, slivers dropped, old rectangles turned into
 * outlines. Never throws — a wall must draw even if the regions on it are
 * nonsense.
 */
export const cleanRegions = (list, width, height) => {
  if (!Array.isArray(list)) return [];
  const face = { x: 0, y: 0, w: num(width), h: num(height) };
  const out = [];
  list.forEach((r) => {
    if (!r || typeof r !== "object") return;
    const base = {
      id: r.id || newRegionId(),
      kind: r.kind || "rect",
      texture: r.texture && r.texture.colormap ? { ...r.texture } : null,
      extrusion: Math.max(0, num(r.extrusion)),
    };
    if (r.light) base.light = true;
    if (r.group) base.group = r.group;
    if (r.arcHeight) base.arcHeight = num(r.arcHeight);
    // An arch keeps the numbers it was drawn from, so it can be edited as
    // numbers later instead of being redrawn.
    if (r.kind === "arch" && r.arch) base.arch = normalizeArch(r.arch);
    if (Array.isArray(r.parts) && r.parts.length) {
      const parts = r.parts.map((p) => cleanOutline(p, face)).filter(Boolean);
      if (parts.length) out.push({ ...base, parts });
      return;
    }
    const outline = Array.isArray(r.points)
      ? r.points
      : rectPoints(num(r.x), num(r.y), num(r.w), num(r.h));
    const points = cleanOutline(outline, face);
    if (points) out.push({ ...base, points });
  });
  return out;
};

/**
 * The region a click at a point means.
 *
 * Walking down the stack from the top: the first region with a material (or
 * a light) is what is SEEN there, and anything under it is hidden. Outlines
 * with no material, lying above it, are see-through — and of those and the
 * visible one, the SMALLEST wins, because that is the shape the pointer is
 * most specifically inside.
 *
 * Both halves matter. A shape just drawn on a painted wall has no material
 * yet: picking "what is visible" alone selected the painted wall behind it,
 * so a new polygon could not be selected or given a material at all. And a
 * large see-through outline over a small tiled panel must not swallow the
 * click meant for the panel.
 */
export const topRegionAt = (regions, x, y) => {
  const list = regions || [];
  let best = null;
  let bestArea = Infinity;
  const consider = (r, parts) => {
    const area = parts.reduce((t, p) => t + polygonArea(p), 0);
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  };
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const parts = regionParts(r);
    if (!parts.some((p) => pointInPolygon(p, x, y))) continue;
    consider(r, parts);
    // Everything below a visible region is hidden by it.
    if (r.texture || r.light) break;
  }
  return best;
};

/** A new region from an outline. */
export const makeRegion = (kind, points, extra) => ({
  id: newRegionId(),
  kind,
  points: roundPoints(points),
  texture: null,
  extrusion: 0,
  ...(extra || {}),
});

/** A region covering the whole face — what "the wall itself" becomes the
 * moment it is cut by a line or given a material in the editor. */
export const fullFaceRegion = (width, height) =>
  makeRegion("rect", rectPoints(0, 0, num(width), num(height)));

/**
 * DRAW A LINE through one region, at any angle: it is cut in two along the
 * line through a and b. Both halves keep its material and its place in the
 * stack — a line changes the layout, not what anything is made of.
 * Returns { regions, cut }; `cut` is false when the line misses the region.
 */
export const splitRegion = (regions, id, a, b) => {
  const list = regions || [];
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return { regions: list, cut: false };
  const r = list[i];
  // A frame made of strips is not something a line divides.
  if (r.parts) return { regions: list, cut: false };
  const pieces = splitByLine(r.points, a, b);
  if (pieces.length < 2) return { regions: list, cut: false };
  const made = pieces.map((points, k) => ({
    ...r,
    id: k === 0 ? r.id : newRegionId(),
    kind: "polygon",
    // Half an arch is not an arch: it keeps its outline, not its numbers.
    arch: undefined,
    points: roundPoints(points),
    texture: r.texture ? { ...r.texture } : null,
  }));
  return {
    regions: list.slice(0, i).concat(made, list.slice(i + 1)),
    cut: true,
  };
};

/**
 * DRAW A DOUBLE LINE: two parallel lines `spacing` apart, centred on a→b.
 * The region is cut into three and the strip between the lines is returned
 * as `stripId` — it is usually what the double line was drawn for (a groove,
 * a border, a band of another material).
 */
export const splitRegionDouble = (regions, id, a, b, spacing) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_REGION_CM) return { regions, cut: false };
  const nx = (-dy / len) * (spacing / 2);
  const ny = (dx / len) * (spacing / 2);
  const first = splitRegion(
    regions,
    id,
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny]
  );
  if (!first.cut) return { regions, cut: false };
  // The second line passes through whichever half holds the centre line.
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const holder = first.regions.find(
    (r) => r.points && pointInPolygon(r.points, mid[0], mid[1])
  );
  if (!holder) return { regions: first.regions, cut: true };
  const second = splitRegion(
    first.regions,
    holder.id,
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny]
  );
  const strip = second.regions.find(
    (r) => r.points && pointInPolygon(r.points, mid[0], mid[1])
  );
  return {
    regions: second.regions,
    cut: true,
    stripId: strip ? strip.id : null,
  };
};

/**
 * Put a new region on top of the stack, trimmed to the face.
 * Returns { regions, id } — id null when nothing of it lies on the wall.
 */
export const addRegion = (regions, region, width, height) => {
  const cleaned = cleanRegions([region], width, height)[0];
  if (!cleaned) return { regions: regions || [], id: null };
  return { regions: (regions || []).concat([cleaned]), id: cleaned.id };
};

/**
 * WHAT OF A REGION IS DRAWN: each of its outlines, with the doors and windows
 * cut out. Regions lying on top of it are not cut out — the 3D view lays each
 * one a hair further from the wall than the one beneath, so what is on top
 * simply covers what is under it.
 */
export const visibleParts = (region, openings) => {
  let parts = regionParts(region);
  (openings || []).forEach((hole) => {
    parts = parts.reduce(
      (all, p) => all.concat(subtractRectFromPolygon(p, hole)),
      []
    );
  });
  return parts;
};

/**
 * What is worth saving, in stack order. A wall where no region has a material
 * or a light is a wall with nothing on it, and is saved as such — an empty
 * list, exactly what a wall that was never opened in the editor has.
 */
export const regionsToSave = (regions) => {
  const list = (regions || []).map((r) => {
    const out = {
      id: r.id,
      kind: r.kind || "polygon",
      texture: r.texture && r.texture.colormap ? { ...r.texture } : null,
      extrusion: round(Math.max(0, num(r.extrusion))),
    };
    if (r.parts) out.parts = r.parts.map(roundPoints);
    else out.points = roundPoints(r.points || []);
    if (r.light) out.light = true;
    if (r.group) out.group = r.group;
    if (r.arcHeight) out.arcHeight = round(r.arcHeight);
    if (r.kind === "arch" && r.arch) out.arch = normalizeArch(r.arch);
    return out;
  });
  return list.some((r) => r.texture || r.light) ? list : [];
};

/** The part of rectangle `a` inside `b`, or null. */
export const intersectRect = (a, b) => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > MIN_REGION_CM && h > MIN_REGION_CM ? { x, y, w, h } : null;
};

/**
 * THE FACE AN EDGE DRAWS, as the editor needs it: its size, and where its
 * doors and windows are, all in the same x/y a region uses.
 *
 * `edge` is the HalfEdge that was clicked — one side of one wall.
 */
export const faceOfEdge = (edge) => {
  const wall = edge && edge.wall;
  if (!wall) return null;
  const start = edge.interiorStart();
  const end = edge.interiorEnd();
  const dx = end.x - start.x;
  const dz = end.y - start.y;
  const width = Math.hypot(dx, dz);
  const height = Math.max(num(wall.startElevation), num(wall.endElevation));
  if (!(width > 0) || !(height > 0)) return null;
  const ux = dx / width;
  const uz = dz / width;
  const openings = [];
  (wall.inWallItems || []).forEach((item) => {
    try {
      const p = item.position;
      const half = item.halfSize;
      const along = (p.x - start.x) * ux + (p.z - start.y) * uz;
      const rect = intersectRect(
        { x: along - half.x, y: p.y - half.y, w: half.x * 2, h: half.y * 2 },
        { x: 0, y: 0, w: width, h: height }
      );
      if (rect) openings.push(rect);
    } catch (e) {
      /* an item still loading has no size yet — it is simply not shown */
    }
  });
  // SEEN FROM THE ROOM, IS THE START ON THE LEFT? A region's x runs from the
  // face's start; whether that is the viewer's left depends on which way the
  // face looks. The 3D view records the face's normal on the edge when it
  // draws the wall; standing in front of it, "right" is up × normal. Without
  // a recorded normal the usual orientation (start on the left) is assumed.
  const n = edge.__faceNormal;
  const mirrored = n ? ux * n.z - uz * n.x < 0 : false;
  return {
    width,
    height,
    openings,
    mirrored,
    start: { x: start.x, z: start.y },
    along: { x: ux, z: uz },
  };
};
