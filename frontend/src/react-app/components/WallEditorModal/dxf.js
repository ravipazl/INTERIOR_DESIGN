/**
 * IMPORT CAD — closed shapes from a DXF drawing, as outlines for the wall.
 *
 * DXF is the text format every CAD program can save ("Save as → DXF"); DWG is
 * AutoCAD's own binary format and cannot be read in a browser, so a .dwg is
 * refused with that advice rather than guessed at.
 *
 * What is taken:
 *   LWPOLYLINE / POLYLINE that are closed  → that outline
 *   CIRCLE                                 → a circle
 * Open lines, text, dimensions and blocks are left out: an area needs an
 * outline that closes.
 *
 * Drawing units are read as MILLIMETRES, the unit elevations are drawn in
 * here, and returned in the centimetres a region uses. The drawing is moved
 * so its bottom-left corner sits on the wall's — where a CAD file keeps its
 * origin has nothing to do with the wall — and anything past the wall's edge
 * is trimmed when the shapes are added.
 */

const ovalish = (cx, cy, r, sides = 64) => {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
};

/** @returns {{ shapes: number[][][], skipped: number }} outlines in cm */
export const parseDxf = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  // A DXF is pairs of lines: a group code, then its value.
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  }
  let at = pairs.findIndex(
    (p, i) => p[0] === 2 && p[1] === "ENTITIES" && pairs[i - 1]?.[1] === "SECTION"
  );
  if (at < 0) return { shapes: [], skipped: 0 };

  const shapes = [];
  let skipped = 0;
  let current = null;
  const finish = () => {
    if (!current) return;
    const { type, xs, ys, closed, radius, vertexes } = current;
    if (type === "CIRCLE" && xs.length && radius > 0) {
      shapes.push(ovalish(xs[0], ys[0], radius));
    } else if (type === "LWPOLYLINE" && closed && xs.length >= 3) {
      shapes.push(xs.map((x, i) => [x, ys[i] || 0]));
    } else if (type === "POLYLINE" && closed && vertexes.length >= 3) {
      shapes.push(vertexes);
    } else if (type !== "VERTEX" && type !== "SEQEND") {
      skipped++;
    }
    current = null;
  };

  let polyline = null;
  for (at += 1; at < pairs.length; at++) {
    const [code, value] = pairs[at];
    if (code === 0) {
      if (value === "VERTEX" && polyline) {
        current = { type: "VERTEX", xs: [], ys: [] };
        continue;
      }
      if (value === "SEQEND" && polyline) {
        current = polyline;
        polyline = null;
        finish();
        continue;
      }
      if (current && current.type === "VERTEX" && polyline) {
        polyline.vertexes.push([current.xs[0] || 0, current.ys[0] || 0]);
        current = null;
      }
      finish();
      if (value === "ENDSEC") break;
      current = { type: value, xs: [], ys: [], closed: false, radius: 0, vertexes: [] };
      if (value === "POLYLINE") {
        polyline = current;
        current = null;
      }
      continue;
    }
    const target = current || polyline;
    if (!target) continue;
    const n = parseFloat(value);
    if (current && current.type === "VERTEX" && polyline) {
      if (code === 10) current.xs.push(n);
      else if (code === 20) current.ys.push(n);
      continue;
    }
    if (code === 10) target.xs.push(n);
    else if (code === 20) target.ys.push(n);
    else if (code === 40) target.radius = n;
    else if (code === 70) target.closed = (parseInt(value, 10) & 1) === 1;
  }
  finish();

  if (!shapes.length) return { shapes: [], skipped };
  let minX = Infinity;
  let minY = Infinity;
  shapes.forEach((s) =>
    s.forEach((p) => {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
    })
  );
  return {
    // mm → cm, bottom-left corner of the drawing onto the wall's.
    shapes: shapes.map((s) =>
      s.map((p) => [(p[0] - minX) / 10, (p[1] - minY) / 10])
    ),
    skipped,
  };
};
