/**
 * DXF FLOOR-PLAN IMPORT — no AI.
 *
 * A DXF from AutoCAD already holds the real lines at their real size, so the
 * plan is built from them directly:
 *
 *   1. parseDxf     — the file's text → its entities and blocks, in drawing
 *                     units (only what a floor plan needs: lines, polylines,
 *                     arcs, block inserts and text).
 *   2. layersOf     — every layer with what it holds, and a guess at its role
 *                     (walls, doors, windows, room names, or nothing).
 *   3. analyzeDxf   — for the roles and units the user confirms: the walls as
 *                     centre lines with their thickness, the doors and windows
 *                     in their gaps, and the room names, in the editor's
 *                     floorplan shape (centimetres, y down).
 *
 * A wall in CAD is two parallel lines, its two faces. Here each pair becomes
 * one centre line with the gap between them as its thickness; a door or
 * window in CAD is a GAP in those lines with its symbol in it, which here
 * becomes one wall through the gap with the opening placed on it — the editor
 * needs the wall to be continuous to hold a door.
 *
 * Self-contained (no imports), so it is the same code in the app and in a
 * plain Node test.
 */

const DEG = Math.PI / 180;

/** Units a drawing can be in, and how many centimetres one unit is. */
export const DXF_UNITS = [
  { id: "mm", label: "Millimetres", cm: 0.1 },
  { id: "cm", label: "Centimetres", cm: 1 },
  { id: "m", label: "Metres", cm: 100 },
  { id: "in", label: "Inches", cm: 2.54 },
  { id: "ft", label: "Feet", cm: 30.48 },
];
/** The drawing's own $INSUNITS code → one of the units above. */
const INSUNITS = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m" };

/** What a layer can be used as. */
export const DXF_ROLES = [
  { id: "wall", label: "Walls" },
  { id: "door", label: "Doors" },
  { id: "window", label: "Windows" },
  { id: "name", label: "Room names" },
  { id: "ignore", label: "Ignore" },
];

/**
 * Broken lines (a text value split over two) a DXF may have and still be
 * read — beyond these, and more than one in 2000 lines, it is refused.
 */
const MAX_BROKEN_LINES = 200;

/** Wall thickness the two faces of a wall may be apart (cm). */
const WALL_MIN_CM = 4;
const WALL_MAX_CM = 60;
/** Close doorways between named rooms even in a plan that draws its doors. */
const CLOSE_NAMED_ROOMS = true;
/** With fewer wall pairs than this, a drawing's walls are single lines. */
const MIN_PAIRED_FOR_FACES = 3;
/** A line with no partner shorter than this is a wall's end, not a wall. */
const SINGLE_MIN_CM = 70;
/** Narrowest and widest gap that can hold a door or window (cm). */
const OPENING_MIN_CM = 30;
const OPENING_MAX_CM = 400;
/**
 * A gap in a wall with no symbol in it (a flattened PDF has none): a doorway
 * between these widths is an opening, wider is a passage left open (cm).
 */
const BARE_GAP_MIN_CM = 60;
const BARE_GAP_MAX_CM = 220;
/** The narrowest gap that counts when a tag is beside it (cm). */
const TAGGED_GAP_MIN_CM = 30;
/** From this width a gap-door is a pair of leaves; from this, an open passage with no leaf (cm). */
const DOUBLE_DOOR_MIN_CM = 115;
const OPEN_PASSAGE_MIN_CM = 160;
/** How near an opening's tag ("D2", "W1", "V") must be for it to name the opening (cm). */
const TAG_REACH_CM = 220;
/** What an opening is tagged: a door ("D", "D2", "MD", "FD"), a window ("W", "W1", "KW", "V" for a ventilator). */
const DOOR_TAG = /^(?:[MFS]?D|DD)\s*-?\s*\d{0,2}$/i;
const WINDOW_TAG = /^(?:[KB]?W|V)\s*-?\s*\d{0,2}$/i;

const userError = (message) =>
  Object.assign(new Error(message), { userFacing: true });

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const first = (g, code, fallback) => {
  for (const [c, v] of g) if (c === code) return v;
  return fallback;
};
const firstNum = (g, code, fallback = 0) => {
  const v = first(g, code, null);
  return v == null || v === "" ? fallback : num(v);
};

/** A control character written the way DXF does (^J for a line break, ^I a tab) is a space. */
const controlToSpace = (t) => String(t || "").replace(/\^[@-_]/g, " ");

/** Plain text of an MTEXT: its formatting codes taken out. */
const cleanMtext = (t) =>
  controlToSpace(t)
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "")
    .replace(/\\[~]/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ── 1. reading the file ───────────────────────────────────────────────────

const toEntity = (rec) => {
  const g = rec.g;
  const layer = first(g, 8, "0") || "0";
  switch (rec.type) {
    case "LINE":
      return {
        type: "line",
        layer,
        pts: [
          [firstNum(g, 10), firstNum(g, 20)],
          [firstNum(g, 11), firstNum(g, 21)],
        ],
      };
    case "LWPOLYLINE": {
      const pts = [];
      let x = null;
      for (const [c, v] of g) {
        if (c === 10) x = num(v);
        else if (c === 20 && x != null) {
          pts.push([x, num(v)]);
          x = null;
        }
      }
      const closed = (parseInt(first(g, 70, "0"), 10) & 1) === 1;
      return pts.length >= 2 ? { type: "poly", layer, pts, closed } : null;
    }
    case "ARC":
      return {
        type: "arc",
        layer,
        c: [firstNum(g, 10), firstNum(g, 20)],
        r: firstNum(g, 40),
        a1: firstNum(g, 50),
        a2: firstNum(g, 51),
      };
    case "INSERT":
      return {
        type: "insert",
        layer,
        name: first(g, 2, ""),
        p: [firstNum(g, 10), firstNum(g, 20)],
        sx: firstNum(g, 41, 1) || 1,
        sy: firstNum(g, 42, 1) || 1,
        rot: firstNum(g, 50, 0),
      };
    case "TEXT":
    case "ATTRIB": {
      // `p` is the text's MIDDLE. A TEXT is placed by its baseline-left
      // (10/20), unless it is justified — then by the point 11/21, which is
      // its centre, right end, top… as codes 72 and 73 say.
      const text = controlToSpace(first(g, 1, "")).replace(/\s+/g, " ").trim();
      const h = firstNum(g, 40, 0);
      const w = text.length * h * 0.6;
      const hj = parseInt(first(g, 72, "0"), 10) || 0;
      const vj = parseInt(first(g, 73, "0"), 10) || 0;
      let x = firstNum(g, 10);
      let y = firstNum(g, 20);
      if (hj || vj) {
        x = firstNum(g, 11, x);
        y = firstNum(g, 21, y);
      }
      const cx = hj === 1 || hj === 4 ? x : hj === 2 ? x - w / 2 : hj ? x : x + w / 2;
      const cy = hj === 4 || vj === 2 ? y : vj === 3 ? y - h / 2 : y + h / 2;
      return { type: "text", layer, p: [cx, cy], h, text };
    }
    case "MTEXT": {
      // An MTEXT is a box placed by one of its nine points (code 71: 1 top
      // left … 5 middle … 9 bottom right), as wide as code 41 says.
      let t = "";
      for (const [c, v] of g) if (c === 3) t += v;
      t += first(g, 1, "");
      const text = cleanMtext(t);
      const h = firstNum(g, 40, 0);
      const lines = (t.match(/\\P/g) || []).length + 1;
      const w = firstNum(g, 41, 0) || text.length * h * 0.6;
      const boxH = lines * h * 1.6;
      const at71 = parseInt(first(g, 71, "1"), 10) || 1;
      const col = (at71 - 1) % 3; // 0 left, 1 centre, 2 right
      const row = Math.floor((at71 - 1) / 3); // 0 top, 1 middle, 2 bottom
      const x = firstNum(g, 10);
      const y = firstNum(g, 20);
      const cx = x + (col === 0 ? w / 2 : col === 2 ? -w / 2 : 0);
      const cy = y + (row === 0 ? -boxH / 2 : row === 2 ? boxH / 2 : 0);
      return { type: "text", layer, p: [cx, cy], h, text };
    }
    default:
      return null;
  }
};

/** A section's records → its entities; POLYLINE/VERTEX and BLOCK/ENDBLK joined. */
const collect = (recs) => {
  const top = [];
  const blocks = {};
  let block = null;
  let poly = null;
  for (const rec of recs) {
    const target = block ? block.entities : top;
    if (rec.type === "BLOCK") {
      block = {
        name: first(rec.g, 2, ""),
        base: [firstNum(rec.g, 10), firstNum(rec.g, 20)],
        entities: [],
      };
      continue;
    }
    if (rec.type === "ENDBLK") {
      if (block) blocks[block.name] = block;
      block = null;
      continue;
    }
    if (rec.type === "POLYLINE") {
      const flags = parseInt(first(rec.g, 70, "0"), 10) || 0;
      // 3D meshes and polyface meshes are not plan lines.
      poly =
        flags & (16 | 64)
          ? { skip: true }
          : {
              type: "poly",
              layer: first(rec.g, 8, "0") || "0",
              pts: [],
              closed: (flags & 1) === 1,
            };
      continue;
    }
    if (rec.type === "VERTEX") {
      if (poly && !poly.skip) {
        const flags = parseInt(first(rec.g, 70, "0"), 10) || 0;
        if (!(flags & 16)) poly.pts.push([firstNum(rec.g, 10), firstNum(rec.g, 20)]);
      }
      continue;
    }
    if (rec.type === "SEQEND") {
      if (poly && !poly.skip && poly.pts.length >= 2) target.push(poly);
      poly = null;
      continue;
    }
    const e = toEntity(rec);
    if (e) target.push(e);
  }
  return { top, blocks };
};

// Affine matrices [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, p) => [
  m[0] * p[0] + m[2] * p[1] + m[4],
  m[1] * p[0] + m[3] * p[1] + m[5],
];
const IDENTITY = [1, 0, 0, 1, 0, 0];
const insertMatrix = (ins, base) => {
  const r = ins.rot * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const T = [1, 0, 0, 1, ins.p[0], ins.p[1]];
  const R = [cos, sin, -sin, cos, 0, 0];
  const S = [ins.sx, 0, 0, ins.sy, 0, 0];
  const B = [1, 0, 0, 1, -base[0], -base[1]];
  return mul(T, mul(R, mul(S, B)));
};

/**
 * Everything drawn, in drawing units, with blocks opened up: segments, arcs
 * (with points along them), texts — and each block placed at the top level,
 * as one record of what it holds, so a door drawn as a block can be found as
 * one door. Inside a block, layer "0" takes the layer of the block's insert.
 */
const explode = (top, blocks) => {
  const segs = [];
  const arcs = [];
  const texts = [];
  const inserts = [];
  const walk = (list, m, inherit, depth, owner) => {
    for (const e of list) {
      const layer = e.layer === "0" && inherit ? inherit : e.layer;
      if (e.type === "line" || e.type === "poly") {
        const pts = e.pts.map((p) => apply(m, p));
        const n = e.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) {
          const s = { layer, a: pts[i], b: pts[(i + 1) % pts.length] };
          segs.push(s);
          if (owner) owner.segs.push(s);
        }
      } else if (e.type === "arc") {
        if (!(e.r > 0)) continue;
        let a1 = e.a1;
        let a2 = e.a2;
        while (a2 <= a1) a2 += 360;
        const steps = Math.max(4, Math.ceil((a2 - a1) / 15));
        const pts = [];
        for (let k = 0; k <= steps; k++) {
          const a = (a1 + ((a2 - a1) * k) / steps) * DEG;
          pts.push(apply(m, [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]));
        }
        const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        const arc = {
          layer,
          c: apply(m, e.c),
          r: e.r * scale,
          pts,
          p1: pts[0],
          p2: pts[pts.length - 1],
        };
        arcs.push(arc);
        if (owner) owner.arcs.push(arc);
      } else if (e.type === "text") {
        if (!e.text) continue;
        const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        texts.push({ layer, p: apply(m, e.p), h: e.h * scale, text: e.text });
      } else if (e.type === "insert") {
        const b = blocks[e.name];
        if (!b || depth > 8) continue;
        const m2 = mul(m, insertMatrix(e, b.base));
        if (owner) walk(b.entities, m2, layer, depth + 1, owner);
        else {
          const rec = { layer, name: e.name, segs: [], arcs: [] };
          walk(b.entities, m2, layer, depth + 1, rec);
          if (rec.segs.length || rec.arcs.length) inserts.push(rec);
        }
      }
    }
  };
  walk(top, IDENTITY, null, 0, null);
  return { segs, arcs, texts, inserts };
};

/**
 * Read a DXF file's text. Throws a user-facing error for a file that is not
 * an ASCII DXF (a binary DXF, a DWG renamed, anything else).
 */
export const parseDxf = (text) => {
  if (typeof text !== "string" || !text.trim()) throw userError("This file is empty.");
  if (/^AutoCAD Binary DXF/.test(text)) {
    throw userError(
      "This DXF is saved in binary form. In AutoCAD, save it again as an ASCII DXF."
    );
  }
  const raw = text.split(/\r\n|\r|\n/);
  const records = { BLOCKS: [], ENTITIES: [] };
  let insunits = null;
  let section = null;
  let headerVar = null;
  let cur = null;
  let sawSection = false;
  let broken = 0;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = parseInt(raw[i], 10);
    if (Number.isNaN(code)) {
      // A line where a group code belongs: a text value broken over two lines.
      // A DWG converted to DXF (LibreDWG) can carry a few of these inside its
      // stored data records — 4 lines in 3 million in one real drawing. Step on
      // one line and pick the pairing up again. Only a file that keeps breaking
      // — not a DXF at all, or damaged throughout — is refused.
      broken += 1;
      if (broken > MAX_BROKEN_LINES && broken * 2000 > i) {
        throw userError("This file couldn't be read as a DXF. In AutoCAD, use Save As → DXF.");
      }
      i -= 1;
      continue;
    }
    const rawValue = raw[i + 1] == null ? "" : raw[i + 1];
    const value = code === 1 || code === 3 ? rawValue : rawValue.trim();
    if (code === 0) {
      cur = null;
      if (value === "SECTION") {
        sawSection = true;
        const nextCode = parseInt(raw[i + 2], 10);
        section = nextCode === 2 ? String(raw[i + 3] || "").trim() : null;
        i += 2;
        continue;
      }
      if (value === "ENDSEC") {
        section = null;
        continue;
      }
      if (value === "EOF") break;
      if (section === "BLOCKS" || section === "ENTITIES") {
        cur = { type: value, g: [] };
        records[section].push(cur);
      }
      continue;
    }
    if (section === "HEADER") {
      if (code === 9) headerVar = value;
      else if (headerVar === "$INSUNITS" && code === 70) insunits = parseInt(value, 10);
      continue;
    }
    if (cur) cur.g.push([code, value]);
  }
  if (!sawSection) {
    throw userError("This file couldn't be read as a DXF. In AutoCAD, use Save As → DXF.");
  }
  const { blocks } = collect(records.BLOCKS);
  const { top } = collect(records.ENTITIES);
  const drawn = explode(top, blocks);
  if (!drawn.segs.length && !drawn.arcs.length) {
    throw userError("No lines were found in this drawing.");
  }
  return { ...drawn, unitFromFile: INSUNITS[insunits] || null };
};

// ── 2. layers ─────────────────────────────────────────────────────────────

/** A first guess at what a layer is, from its name. */
export const guessRole = (name) => {
  const n = String(name || "").toLowerCase();
  if (/door|tuer|tür|porte|puerta/.test(n)) return "door";
  if (/window|wind|glaz|fenster|fenetre|ventana/.test(n)) return "window";
  // A layer of the walls' hatching or dimensions, or of a section or detail
  // drawn of them, is not the plan's walls. (An "elevational wall" layer is:
  // interior drawings mark the walls they draw an elevation of on it.)
  if (/wall|wand|mur|muro|pared/.test(n) && !/section|detail|hatch|dim/.test(n)) return "wall";
  if (/room|name|label|tag|space|raum/.test(n)) return "name";
  return "ignore";
};

/**
 * What a room is most likely to be, from the fittings drawn in it: a layer of
 * toilet or sanitary fixtures marks a bathroom, of kitchen fixtures or counter
 * tops a kitchen, of wardrobes a bedroom. Used for a room no label names — a
 * drawing whose text is outlines (a PDF) has none — and only a hint.
 */
export const FIXTURE_ROOMS = [
  { name: "Bathroom", test: /toilet|sanitar|plumb|\bwc\b|bath/ },
  { name: "Kitchen", test: /kitchen|counter ?top|hob|sink|cooking/ },
  { name: "Bedroom", test: /wardrobe|\bbed/ },
];

/** Every layer, with how many lines, arcs and texts it holds, A–Z. */
export const layersOf = (doc) => {
  const map = new Map();
  const get = (layer) => {
    if (!map.has(layer)) map.set(layer, { name: layer, lines: 0, arcs: 0, texts: 0 });
    return map.get(layer);
  };
  doc.segs.forEach((s) => (get(s.layer).lines += 1));
  doc.arcs.forEach((a) => (get(a.layer).arcs += 1));
  doc.texts.forEach((t) => (get(t.layer).texts += 1));
  return [...map.values()]
    .map((l) => {
      let role = guessRole(l.name);
      // A layer of text only, called text or notes: most often the labels.
      if (role === "ignore" && l.texts && !l.lines && !l.arcs && /text|txt/i.test(l.name)) {
        role = "name";
      }
      return { ...l, role };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

// A unit is one of DXF_UNITS' ids, or a number: centimetres per drawing unit,
// for a drawing with no unit of its own (a PDF or DWFx, measured by the user).
const unitCm = (unit) =>
  typeof unit === "number" && unit > 0
    ? unit
    : (DXF_UNITS.find((u) => u.id === unit) || DXF_UNITS[0]).cm;
const inRegion = (r, p) =>
  !r || (p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY);
/** The wall lines (of one drawing, given its region), else every line. */
const wallLines = (doc, roles, region) => {
  const walls = roles
    ? doc.segs.filter((s) => roles[s.layer] === "wall" && inRegion(region, s.a))
    : [];
  return walls.length ? walls : doc.segs.filter((s) => inRegion(region, s.a));
};

/**
 * The unit the drawing is in: the file's own setting, else a guess from its
 * size (a home is a few metres to a few tens of metres across) — the size of
 * one drawing, when a region is given.
 */
export const guessUnit = (doc, roles, region) => {
  const b = boundsOf(wallLines(doc, roles, region).map((s) => [s.a, s.b]).flat());
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const metres = (id) => (size * DXF_UNITS.find((u) => u.id === id).cm) / 100;
  const plausible = (id) => metres(id) >= 2 && metres(id) <= 80;
  // The file's own setting, unless it makes the plan an impossible size: a
  // drawing set to feet but drawn in inches is common.
  if (doc.unitFromFile && plausible(doc.unitFromFile)) return doc.unitFromFile;
  const order = doc.unitFromFile === "ft" ? ["in", "mm", "cm", "m"] : ["mm", "cm", "in", "m"];
  return order.find(plausible) || doc.unitFromFile || "mm";
};

/** The plan's overall size in metres for a unit, to show beside the choice. */
export const planSizeMetres = (doc, roles, unit, region) => {
  const b = boundsOf(wallLines(doc, roles, region).map((s) => [s.a, s.b]).flat());
  const k = unitCm(unit) / 100;
  return { w: (b.maxX - b.minX) * k, h: (b.maxY - b.minY) * k };
};

const boundsOf = (points) => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  points.forEach((p) => {
    if (p[0] < b.minX) b.minX = p[0];
    if (p[1] < b.minY) b.minY = p[1];
    if (p[0] > b.maxX) b.maxX = p[0];
    if (p[1] > b.maxY) b.maxY = p[1];
  });
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
};

// ── 3. one drawing out of several ─────────────────────────────────────────

/** Separate drawings are further apart than this (cm). */
const DRAWING_GAP_CM = 200;

/**
 * THE SEPARATE DRAWINGS IN A FILE.
 *
 * A file is often a whole set — the plan, furniture layouts, elevations of
 * each unit — laid side by side in model space, sometimes with stray lines
 * kilometres away. Its wall lines are gathered into groups that touch or lie
 * within a couple of metres of each other: each group is one drawing. Bits
 * too small to be a room are strays and are dropped.
 *
 * Returns regions in drawing units, the most lines first:
 * [{ minX, minY, maxX, maxY, lines }]. Each region reaches a metre past its
 * walls, so the doors, windows and labels drawn just outside come with it.
 */
export const findDrawings = (doc, roles, unit) => {
  const k = unitCm(unit);
  const gap = DRAWING_GAP_CM / k;
  const items = [];
  doc.segs.forEach((sg) => {
    if (roles[sg.layer] !== "wall") return;
    items.push(boundsOf([sg.a, sg.b]));
  });
  doc.arcs.forEach((ar) => {
    if (roles[ar.layer] !== "wall") return;
    items.push(boundsOf(ar.pts));
  });
  if (!items.length) return [];

  // Lines near each other found through a grid, not by comparing every pair:
  // a drawing set can hold tens of thousands of lines.
  const cell = gap * 2;
  const grid = new Map();
  const cellsOf = (b) => {
    const i0 = Math.floor(b.minX / cell);
    const i1 = Math.floor(b.maxX / cell);
    const j0 = Math.floor(b.minY / cell);
    const j1 = Math.floor(b.maxY / cell);
    // A very long line is kept by its two ends only.
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return [`${i0},${j0}`, `${i1},${j1}`];
    const out = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(`${i},${j}`);
    return out;
  };
  items.forEach((b, idx) =>
    cellsOf(b).forEach((key) => {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(idx);
    })
  );
  const parent = items.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const near = (a, b) =>
    a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minY - gap <= b.maxY && b.minY - gap <= a.maxY;
  grid.forEach((list, key) => {
    const [i, j] = key.split(",").map(Number);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const other = grid.get(`${i + di},${j + dj}`);
        if (!other) continue;
        list.forEach((a) =>
          other.forEach((b) => {
            if (a < b && root(a) !== root(b) && near(items[a], items[b])) parent[root(a)] = root(b);
          })
        );
      }
    }
  });
  const groups = new Map();
  items.forEach((b, idx) => {
    const g = root(idx);
    const cur = groups.get(g);
    if (!cur) groups.set(g, { ...b, lines: 1 });
    else {
      cur.minX = Math.min(cur.minX, b.minX);
      cur.minY = Math.min(cur.minY, b.minY);
      cur.maxX = Math.max(cur.maxX, b.maxX);
      cur.maxY = Math.max(cur.maxY, b.maxY);
      cur.lines += 1;
    }
  });
  const margin = 100 / k;
  return [...groups.values()]
    .filter((g) => g.lines >= 6 && Math.max(g.maxX - g.minX, g.maxY - g.minY) * k >= 150)
    .map((g) => ({
      minX: g.minX - margin,
      minY: g.minY - margin,
      maxX: g.maxX + margin,
      maxY: g.maxY + margin,
      lines: g.lines,
    }))
    .sort((a, b) => b.lines - a.lines);
};

/**
 * Are there door or window lines drawn in this drawing? A layer marked as
 * doors or windows counts only if it holds something inside the region: a
 * sheet's door layer can hold the doors of another drawing altogether. Where
 * none is drawn, the openings are gaps in the walls and are found as such.
 */
export const hasDrawnOpenings = (doc, roles, region) => {
  const want = (layer) => roles && (roles[layer] === "door" || roles[layer] === "window");
  return (
    doc.segs.some((s) => want(s.layer) && inRegion(region, s.a)) ||
    doc.arcs.some((a) => want(a.layer) && inRegion(region, a.c))
  );
};

/**
 * The drawings ranked by how much each looks like a FLOOR PLAN — walls in
 * pairs, doors and windows in them, rooms labelled — over an elevation or a
 * detail, which has few of those and is long and thin. Each comes with its
 * analysis, so the best one can be imported straight away.
 */
export const rankDrawings = (doc, { roles, unit, singleLines = false }, drawings) =>
  drawings
    .slice(0, 25)
    .map((region) => {
      const analysis = analyzeDxf(doc, {
        roles,
        unit,
        singleLines,
        region,
        bareGaps: !hasDrawnOpenings(doc, roles, region),
      });
      const size = planSizeMetres(doc, roles, unit, region);
      const big = Math.max(size.w, size.h);
      const small = Math.min(size.w, size.h) || 0.01;
      const c = analysis.counts;
      let score = c.paired + 15 * (c.doors + c.windows) + 8 * c.names;
      if (big / small > 3.5) score *= 0.3;
      const plausible = big >= 2 && big <= 80;
      if (!plausible) score *= 0.1;
      return { region, analysis, size, plausible, score };
    })
    .sort((a, b) => b.score - a.score);

/**
 * EVERYTHING DECIDED FROM THE FILE, with no one asked: which layer holds
 * what, the unit, and which drawing of several is the plan.
 *
 *   1. The layers' names say which holds the walls, doors, windows and room
 *      names; the unit comes from the file, or from the plan's size.
 *   2. A plan of no possible size in that unit: each other unit in turn.
 *   3. No layer named for walls, or nothing usable on it: each layer with
 *      lines enough is tried as the walls, and the one whose lines pair up
 *      into the most walls is taken — the walls of a plan are drawn as two
 *      faces, nothing else in it is.
 *
 * Returns { roles, unit, ranked, best } — best the drawing to import — or
 * null when no walls could be found at all.
 */
export const autoPlan = (doc) => {
  const layers = layersOf(doc);
  const named = Object.fromEntries(layers.map((l) => [l.name, l.role]));
  const attempt = (roles, unit) => {
    const ranked = rankDrawings(doc, { roles, unit }, findDrawings(doc, roles, unit));
    const best = ranked[0];
    return best && best.analysis.counts.walls > 0 && best.plausible
      ? { roles, unit, ranked, best }
      : null;
  };
  // The unit judged on the plan itself first, then each of the others.
  const unitsFor = (roles) => {
    let unit = guessUnit(doc, roles);
    const first = findDrawings(doc, roles, unit)[0];
    if (first) unit = guessUnit(doc, roles, first);
    return [unit, ...DXF_UNITS.map((u) => u.id).filter((id) => id !== unit)];
  };
  const tryRoles = (roles) => {
    for (const unit of unitsFor(roles)) {
      const found = attempt(roles, unit);
      if (found) return found;
    }
    return null;
  };
  if (Object.values(named).includes("wall")) {
    const found = tryRoles(named);
    if (found) return found;
  }
  let pick = null;
  layers
    .filter((l) => l.lines >= 8 && named[l.name] === "ignore")
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 12)
    .forEach((l) => {
      const found = tryRoles({ ...named, [l.name]: "wall" });
      if (found && (!pick || found.best.analysis.counts.paired > pick.best.analysis.counts.paired)) {
        pick = found;
      }
    });
  return pick;
};

/** What of a drawing lies in a region (drawing units). */
const clipDoc = (doc, r) => ({
  ...doc,
  segs: doc.segs.filter((sg) => inRegion(r, sg.a) && inRegion(r, sg.b)),
  arcs: doc.arcs.filter((ar) => inRegion(r, ar.c)),
  texts: doc.texts.filter((t) => inRegion(r, t.p)),
  inserts: doc.inserts.filter(
    (ins) => ins.segs.some((sg) => inRegion(r, sg.a)) || ins.arcs.some((ar) => inRegion(r, ar.c))
  ),
});

// ── 4. building the plan ──────────────────────────────────────────────────

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const mkSeg = (a, b, thickness) => {
  const d = sub(b, a);
  const L = Math.hypot(d[0], d[1]);
  if (!(L > 1e-6)) return null;
  return { a, b, u: [d[0] / L, d[1] / L], L, thickness: thickness == null ? null : thickness };
};
const at = (s, t) => [s.a[0] + s.u[0] * t, s.a[1] + s.u[1] * t];
const param = (s, p) => dot(sub(p, s.a), s.u);
/** Signed distance of p from s's line (positive to the left of a→b). */
const offset = (s, p) => {
  const v = sub(p, s.a);
  return -v[0] * s.u[1] + v[1] * s.u[0];
};
const parallel = (s, q, tolDeg) =>
  Math.abs(s.u[0] * q.u[1] - s.u[1] * q.u[0]) < Math.sin(tolDeg * DEG);
/** Where the lines through s and q cross, or null when they are parallel. */
const meet = (s, q) => {
  const den = s.u[0] * q.u[1] - s.u[1] * q.u[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(q.a, s.a);
  return at(s, (w[0] * q.u[1] - w[1] * q.u[0]) / den);
};
const segDistance = (s, p) => {
  const t = Math.max(0, Math.min(s.L, param(s, p)));
  return dist(at(s, t), p);
};
/** Parts of [lo, hi] not covered by any interval in `cov`. */
const freeParts = (lo, hi, cov) => {
  let parts = [[lo, hi]];
  cov.forEach(([a, b]) => {
    const next = [];
    parts.forEach(([x, y]) => {
      if (b <= x || a >= y) next.push([x, y]);
      else {
        if (a > x) next.push([x, a]);
        if (b < y) next.push([b, y]);
      }
    });
    parts = next;
  });
  return parts.filter(([x, y]) => y - x > 1e-6);
};

/** Lines drawn twice or in pieces along the same line → one line. */
const mergeOverlapping = (list) => {
  const out = list.slice();
  for (let i = 0; i < out.length; i++) {
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = i + 1; j < out.length; j++) {
        const s = out[i];
        const q = out[j];
        if (!parallel(s, q, 0.5)) continue;
        if (Math.abs(offset(s, q.a)) > 0.3 || Math.abs(offset(s, q.b)) > 0.3) continue;
        const t1 = param(s, q.a);
        const t2 = param(s, q.b);
        const lo = Math.min(t1, t2);
        const hi = Math.max(t1, t2);
        if (lo > s.L + 0.3 || hi < -0.3) continue;
        const merged = mkSeg(at(s, Math.min(0, lo)), at(s, Math.max(s.L, hi)), s.thickness);
        if (!merged) continue;
        out[i] = merged;
        out.splice(j, 1);
        grew = true;
        break;
      }
    }
  }
  return out;
};

/**
 * How far along a gap (from → to, a band `halfWidth` either side) the given
 * lines reach: { lo, hi } in cm from `from`, or null when none lie in it. A
 * window is as wide as its own lines run — not as wide as the gap it is in,
 * which can also hold a wall's return or an open part.
 */
const extentInGap = (lines, from, to, halfWidth) => {
  const g = mkSeg(from, to);
  if (!g) return null;
  let lo = Infinity;
  let hi = -Infinity;
  lines.forEach(([pa, pb]) => {
    const a = [param(g, pa), offset(g, pa)];
    const b = [param(g, pb), offset(g, pb)];
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    if (
      clip(-dx, a[0]) &&
      clip(dx, g.L - a[0]) &&
      clip(-dy, a[1] + halfWidth) &&
      clip(dy, halfWidth - a[1])
    ) {
      const x0 = a[0] + dx * t0;
      const x1 = a[0] + dx * t1;
      lo = Math.min(lo, x0, x1);
      hi = Math.max(hi, x0, x1);
    }
  });
  return hi > lo ? { lo: Math.max(0, lo), hi: Math.min(g.L, hi) } : null;
};

/** Does any of these lines pass through the rectangle around a gap? */
const crossesGap = (lines, from, to, halfWidth) => {
  const g = mkSeg(from, to);
  if (!g) return false;
  const local = (p) => [param(g, p), offset(g, p)];
  const x0 = -2;
  const x1 = g.L + 2;
  const y0 = -halfWidth;
  const y1 = halfWidth;
  return lines.some(([pa, pb]) => {
    const a = local(pa);
    const b = local(pb);
    // Liang–Barsky: does a→b meet the box at all?
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return (
      clip(-dx, a[0] - x0) &&
      clip(dx, x1 - a[0]) &&
      clip(-dy, a[1] - y0) &&
      clip(dy, y1 - a[1])
    );
  });
};

/**
 * Text that is a size or an area ("12.1 m²", "11'-2½\" x 10'", "3504"), not a
 * room's name: it has figures and no word of three letters or more.
 */
const isMeasure = (t) =>
  /\d/.test(t) && !/[a-z]{3,}/i.test(String(t).replace(/sq\.?\s*ft|sqft|sft/gi, ""));
/**
 * Words that name a room rather than a fitting in it. When a room holds
 * several labels ("BEDROOM 02" and "WARDROBE"), one of these wins.
 */
const ROOM_WORDS =
  /bed|bath|toilet|\bwc\b|\bw\.c\b|wash|kitchen|pantry|living|dining|drawing|hall|lounge|family|foyer|lobby|entr|reception|balcony|terrace|veranda|porch|sit[\s-]?out|deck|garden|court|utility|laundry|store|pooja|puja|prayer|study|office|cabin|conference|meeting|library|guest|master|kids|child|servant|maid|dress|walk[\s-]?in|passage|corridor|garage|parking|gym|media|theat|play|shop|room/i;

/** A label that names a room (a room word, or a room's size with it). */
export const ROOM_LABEL_RANK = 1e6;

/** The grid the walls are laid out on to see which rooms they close in: most cells, finest cell (cm). */
const ROOM_GRID_CELLS = 90000;
const ROOM_GRID_MIN_CELL_CM = 5;
/** More doorway-wide spans than this means the walls are not a plan's, and none are closed. */
const MAX_CLOSING_CANDIDATES = 160;
const CLOSING_BUDGET_MS = 4000;
/** The longest opening a drawn line (a railing) may close, how much of it the line must run along, how far off it may lie, and the thickness it is built at (cm). */
const RAIL_MAX_CM = 450;
const RAIL_COVER = 0.7;
const RAIL_BAND_CM = 12;
const RAIL_THICKNESS_CM = 10;
/** A railing line is at least this long, and its ends lie this near a wall (cm). */
const RAIL_MIN_SPAN_CM = 120;
/** How much of a gap's two sides must have wall faces drawn along them for it to be wall, not a doorway. */
const WALL_DRAWN_COVER = 0.6;
const RAIL_END_CM = 25;
/** Lines shorter than this are drawing detail, not a railing (cm). */
const RAIL_MIN_LINE_CM = 40;

/** A column's sides are between these (cm); one lies on a wall when its middle is this near the wall's body. */
const COLUMN_MIN_CM = 15;
const COLUMN_MAX_CM = 80;
const COLUMN_ON_WALL_CM = 6;
/** A layer named for columns ("AR - COLUMN", "COL HATCH", "Pillar"). */
const COLUMN_LAYER = /\bcol(umn)?s?\b|pillar|\bcol[ _-]|clmn/i;
/** Longest a column may be against how thick it is (a 20 × 60 cm stub is 3). */
const COLUMN_MAX_RATIO = 4;

/**
 * SMALL SQUARES AND RECTANGLES in a set of lines [[a, b], …]: four lines
 * making a closed box with its sides between a column's sizes, square to the
 * plan. Returns [{ cx, cy, corners }].
 */
const findBlocks = (lines) => {
  const TOL = 1.5;
  const horizontals = [];
  const verticals = [];
  lines.forEach(([a, b]) => {
    const dx = Math.abs(a[0] - b[0]);
    const dy = Math.abs(a[1] - b[1]);
    if (dy < 1 && dx >= COLUMN_MIN_CM - TOL && dx <= COLUMN_MAX_CM + TOL) {
      horizontals.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 });
    } else if (dx < 1 && dy >= COLUMN_MIN_CM - TOL && dy <= COLUMN_MAX_CM + TOL) {
      verticals.push({ y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), x: (a[0] + b[0]) / 2 });
    }
  });
  if (!horizontals.length || !verticals.length || horizontals.length > 20000) return [];
  horizontals.sort((p, q) => p.x0 - q.x0);
  const byX = new Map();
  verticals.forEach((v) => {
    const key = Math.round(v.x);
    if (!byX.has(key)) byX.set(key, []);
    byX.get(key).push(v);
  });
  const standsAt = (x, y0, y1) =>
    [-1, 0, 1].some((k) =>
      (byX.get(Math.round(x) + k) || []).some(
        (v) => Math.abs(v.x - x) <= TOL && Math.abs(v.y0 - y0) <= TOL && Math.abs(v.y1 - y1) <= TOL
      )
    );
  const found = [];
  for (let i = 0; i < horizontals.length; i++) {
    const h1 = horizontals[i];
    for (let j = i + 1; j < horizontals.length && horizontals[j].x0 - h1.x0 <= TOL; j++) {
      const h2 = horizontals[j];
      if (Math.abs(h1.x1 - h2.x1) > TOL) continue;
      const gap = Math.abs(h2.y - h1.y);
      if (gap < COLUMN_MIN_CM - TOL || gap > COLUMN_MAX_CM + TOL) continue;
      const y0 = Math.min(h1.y, h2.y);
      const y1 = Math.max(h1.y, h2.y);
      if (!standsAt(h1.x0, y0, y1) || !standsAt(h1.x1, y0, y1)) continue;
      const cx = (h1.x0 + h1.x1) / 2;
      const cy = (y0 + y1) / 2;
      // The same block drawn twice (outline and fill) is one.
      if (found.some((f) => Math.abs(f.cx - cx) < 3 && Math.abs(f.cy - cy) < 3)) continue;
      found.push({ cx, cy, corners: [[h1.x0, y0], [h1.x1, y0], [h1.x1, y1], [h1.x0, y1]] });
    }
  }
  return found;
};

/**
 * How much of the span E→X the lines run along — the fraction (0–1) of its
 * length covered by lines lying within a few centimetres of it and parallel.
 */
const drawnAlong = (E, X, lines) => {
  const L = dist(E, X);
  if (!(L > 0)) return 0;
  const u = [(X[0] - E[0]) / L, (X[1] - E[1]) / L];
  const across = (p) => Math.abs(-(p[0] - E[0]) * u[1] + (p[1] - E[1]) * u[0]);
  const ranges = [];
  lines.forEach(([p, q]) => {
    if (across(p) > RAIL_BAND_CM || across(q) > RAIL_BAND_CM) return;
    const t0 = dot(sub(p, E), u);
    const t1 = dot(sub(q, E), u);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(L, Math.max(t0, t1));
    if (hi - lo > 1) ranges.push([lo, hi]);
  });
  ranges.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = -Infinity;
  ranges.forEach(([lo, hi]) => {
    const from = Math.max(lo, end);
    if (hi > from) covered += hi - from;
    end = Math.max(end, hi);
  });
  return covered / L;
};

/**
 * DOORWAYS THE WALLS LEAVE OPEN, FOUND BY THE ROOMS THEY SHOULD DIVIDE.
 *
 * A plan names its rooms (KITCHEN, BEDROOM-2). When two names lie in one
 * space, or a name lies in a space open to the outside, a doorway is open
 * that should be closed. The walls are laid out on a grid and filled from each
 * name; every doorway-wide span from a wall's end to the wall beyond it is
 * closed at once, which is the most that can be done; then the spans that are
 * not needed to get there are taken away again, the widest first, so what
 * stays is the narrowest set of doorways that parts the rooms. Where nothing
 * tells two spaces apart — no names on both — a wall left open stays open
 * (Coohom's "Living & Dining" is one room for the same reason). A room still
 * open to the outside after that (a balcony) is closed along a line the plan
 * draws across its opening — a railing, a glass wall — and only along one.
 *
 * @param {object[]} centres walls (centre lines), as the rest of the build has them
 * @param {number[][]} seeds one point per named room
 * @param {number[][][]} [support] drawn lines [[a, b], …] a railing may be found among
 * @returns {{ from: number[], to: number[], s: number, seg: object }[]} the spans to close
 */
const closeRoomGaps = (centres, seeds, support) => {
  const links = [];
  if (seeds.length < 2 || !centres.length) return links;
  const started = Date.now();
  const pts = centres.flatMap((c) => [c.a, c.b]).concat(seeds);
  const b = boundsOf(pts);
  const margin = BARE_GAP_MAX_CM;
  const minX = b.minX - margin;
  const minY = b.minY - margin;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 2 * margin;
  const cell = Math.max(ROOM_GRID_MIN_CELL_CM, span / Math.sqrt(ROOM_GRID_CELLS));
  const W = Math.ceil((b.maxX - b.minX + 2 * margin) / cell) + 1;
  const H = Math.ceil((b.maxY - b.minY + 2 * margin) / cell) + 1;
  const wallThick = (c) => (c.thickness || 10) / 2 + cell / 2;

  // What the walls fill, with more walls added when asked.
  const fill = (extra) => {
    const mask = new Uint8Array(W * H);
    centres.concat(extra || []).forEach((c) => {
      const r = wallThick(c);
      const steps = Math.max(1, Math.ceil(c.L / (cell / 2)));
      for (let i = 0; i <= steps; i++) {
        const x = c.a[0] + (c.u[0] * c.L * i) / steps;
        const y = c.a[1] + (c.u[1] * c.L * i) / steps;
        const x0 = Math.max(0, Math.floor((x - r - minX) / cell));
        const x1 = Math.min(W - 1, Math.ceil((x + r - minX) / cell));
        const y0 = Math.max(0, Math.floor((y - r - minY) / cell));
        const y1 = Math.min(H - 1, Math.ceil((y + r - minY) / cell));
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) mask[gy * W + gx] = 1;
      }
    });
    return mask;
  };
  const seedCells = seeds
    .map((p) => [Math.floor((p[0] - minX) / cell), Math.floor((p[1] - minY) / cell)])
    .filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);

  // How many named rooms share a space with another, or open to the outside.
  const label = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  const badness = (mask) => {
    label.fill(0);
    const touches = [];
    let id = 0;
    const seedAt = (x, y) => {
      // A name written on a wall is taken at the nearest free cell beside it.
      for (let r = 0; r <= 3; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const gx = x + dx;
            const gy = y + dy;
            if (gx >= 0 && gy >= 0 && gx < W && gy < H && !mask[gy * W + gx]) return gy * W + gx;
          }
      return -1;
    };
    const flood = (start) => {
      id += 1;
      let top = 0;
      let border = false;
      stack[top++] = start;
      label[start] = id;
      while (top) {
        const v = stack[--top];
        const x = v % W;
        const y = (v - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (x > 0 && !mask[v - 1] && !label[v - 1]) (label[v - 1] = id), (stack[top++] = v - 1);
        if (x < W - 1 && !mask[v + 1] && !label[v + 1]) (label[v + 1] = id), (stack[top++] = v + 1);
        if (y > 0 && !mask[v - W] && !label[v - W]) (label[v - W] = id), (stack[top++] = v - W);
        if (y < H - 1 && !mask[v + W] && !label[v + W]) (label[v + W] = id), (stack[top++] = v + W);
      }
      touches[id] = border;
    };
    const regions = new Map();
    seedCells.forEach(([x, y]) => {
      const v = seedAt(x, y);
      if (v < 0) return;
      if (!label[v]) flood(v);
      regions.set(label[v], (regions.get(label[v]) || 0) + 1);
    });
    let bad = 0;
    regions.forEach((n, rid) => {
      if (n > 1) bad += n; // rooms sharing a space
      if (touches[rid]) bad += n; // rooms open to the outside
    });
    return bad;
  };

  const current = badness(fill(null));
  if (current === 0) return links;

  // Every span from a wall's end to the wall ahead of it, between two widths,
  // with no wall in it — and, when `lines` is given, with a drawn line along
  // most of its length (a railing, a glass line).
  const spansBetween = (minS, maxS, lines, taken) => {
    const found = [];
    centres.forEach((c, ci) => {
      ["a", "b"].forEach((end) => {
        const E = c[end];
        const out = end === "b" ? c.u : [-c.u[0], -c.u[1]];
        centres.forEach((o, oi) => {
          if (oi === ci || parallel(c, o, 5)) return;
          const e = sub(o.b, o.a);
          const denom = out[0] * e[1] - out[1] * e[0];
          const w = sub(o.a, E);
          const s = (w[0] * e[1] - w[1] * e[0]) / denom;
          const u = (w[0] * out[1] - w[1] * out[0]) / denom;
          if (s < minS || s > maxS) return;
          if (u * o.L < -(o.thickness || 10) || u * o.L > o.L + (o.thickness || 10)) return;
          const X = [E[0] + out[0] * s, E[1] + out[1] * s];
          const M = mid(E, X);
          const thin = (c.thickness || 10) / 2 + 5;
          if (centres.some((x, xi) => xi !== ci && xi !== oi && segDistance(x, M) < thin)) return;
          // The same span reached from its other end is one span.
          if (found.some((f) => dist(mid(f.from, f.to), M) < 15)) return;
          if (taken.some((f) => dist(mid(f.from, f.to), M) < 15)) return;
          if (lines && drawnAlong(E, X, lines) < RAIL_COVER) return;
          // A railing is a thin wall, whatever the wall it starts from.
          const seg = mkSeg(E, X, lines ? RAIL_THICKNESS_CM : c.thickness);
          if (seg && lines) seg.rail = true;
          if (seg) found.push({ from: E, to: X, s, seg });
        });
      });
    });
    return found;
  };

  // All of `list` closed on top of `base`: the most that can be done. Then
  // those not needed to get there are taken away again — the longest first, so
  // the narrowest are the ones that stay.
  const prune = (list, base, target) => {
    let keep = list.slice();
    list
      .slice()
      .sort((x, y) => y.s - x.s)
      .forEach((f) => {
        if (Date.now() - started > CLOSING_BUDGET_MS) return;
        const trial = keep.filter((k) => k !== f);
        if (badness(fill(base.concat(trial.map((k) => k.seg)))) <= target) keep = trial;
      });
    return keep;
  };

  // Doorways first: a doorway wide, nothing in it.
  let keep = [];
  let bad = current;
  const doorways = spansBetween(BARE_GAP_MIN_CM, BARE_GAP_MAX_CM, null, []);
  if (doorways.length && doorways.length <= MAX_CLOSING_CANDIDATES) {
    const all = badness(fill(doorways.map((f) => f.seg)));
    if (all < current) {
      keep = prune(doorways, [], all);
      bad = all;
    }
  }

  // A room still open to the outside, or sharing its space: it may be closed
  // by a line drawn across the opening — a balcony's railing, a glass wall —
  // where no wall is. Wider than a doorway, but only along a drawn line.
  if (bad > 0 && support && support.length) {
    const rails = spansBetween(BARE_GAP_MAX_CM, RAIL_MAX_CM, support, keep);
    // Or a long drawn line with a wall at each end: a railing set across.
    const nearest = (p) =>
      centres.reduce((best, c) => {
        const t = Math.max(0, Math.min(c.L, param(c, p)));
        const P = at(c, t);
        const d = dist(P, p);
        return d < best.d ? { d, P, c } : best;
      }, { d: Infinity });
    support.forEach(([p, q]) => {
      const L = dist(p, q);
      if (L < RAIL_MIN_SPAN_CM || L > RAIL_MAX_CM) return;
      const A = nearest(p);
      const B = nearest(q);
      if (A.d > RAIL_END_CM || B.d > RAIL_END_CM || A.c === B.c) return;
      const M = mid(A.P, B.P);
      if (rails.some((r) => dist(mid(r.from, r.to), M) < 15) || keep.some((r) => dist(mid(r.from, r.to), M) < 15)) return;
      // Nothing already standing in the way, and the line runs the whole way.
      if (centres.some((x) => x !== A.c && x !== B.c && segDistance(x, M) < 15)) return;
      const seg = mkSeg(A.P, B.P, RAIL_THICKNESS_CM);
      if (seg) seg.rail = true;
      if (seg) rails.push({ from: A.P, to: B.P, s: dist(A.P, B.P), seg });
    });
    if (rails.length && rails.length <= MAX_CLOSING_CANDIDATES) {
      const base = keep.map((f) => f.seg);
      const all = badness(fill(base.concat(rails.map((f) => f.seg))));
      if (all < bad) keep = keep.concat(prune(rails, base, all));
    }
  }
  return keep;
};

/** Where a size starts in a label: 11'-2", 3.2 x 4.0, 12.1 m², 3600 mm… */
const SIZE_START =
  /\s\(?\d+(\.\d+)?\s*(['’′]|"|x\s*\d|×|X\s*\d|\*\s*\d|m²|m2|sq|mm\b|cm\b|m\b)/;

/**
 * How near (cm) a corner may come to a wall it is not part of. The same
 * figure as the editor's own `cornerTolerance`: on loading a plan the editor
 * looks for a corner nearer than this to a wall it is not on, and if it finds
 * one runs its wall-joining step — which on a large imported drawing can run
 * for minutes and freeze the page. So the plan is settled here first.
 */
const CORNER_TOLERANCE_CM = 20;

/**
 * SETTLE THE PLAN so no corner is within CORNER_TOLERANCE_CM of a wall it is
 * not on, doing in a known, bounded way what the editor's joining step would:
 *   · a wall shorter than that becomes one corner;
 *   · a corner that near another wall's end is joined to that end;
 *   · a corner that near the middle of a wall is put on it, splitting it.
 * `corners` (id → {x, y}) and `walls` ([{corner1, corner2, thickness}]) are
 * changed in place.
 */
const settleGraph = (corners, walls) => {
  const P = (id) => [corners[id].x, corners[id].y];
  const merge = (from, into) => {
    if (from === into) return;
    walls.forEach((w) => {
      if (w.corner1 === from) w.corner1 = into;
      if (w.corner2 === from) w.corner2 = into;
    });
    delete corners[from];
  };
  const tidy = () => {
    const seen = new Map();
    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i];
      const key = w.corner1 < w.corner2 ? `${w.corner1}|${w.corner2}` : `${w.corner2}|${w.corner1}`;
      if (w.corner1 === w.corner2) walls.splice(i, 1);
      else if (seen.has(key)) {
        // The same stretch twice: one wall.
        walls.splice(i, 1);
      } else seen.set(key, w);
    }
  };
  const T = CORNER_TOLERANCE_CM;
  for (let round = 0; round < 60; round++) {
    let changed = false;
    // Walls too short to keep: one corner, midway.
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.corner1 === w.corner2 || !corners[w.corner1] || !corners[w.corner2]) continue;
      if (dist(P(w.corner1), P(w.corner2)) >= T) continue;
      const m = mid(P(w.corner1), P(w.corner2));
      corners[w.corner2] = { x: Math.round(m[0] * 10) / 10, y: Math.round(m[1] * 10) / 10 };
      merge(w.corner1, w.corner2);
      changed = true;
    }
    tidy();
    // Corners too near a wall they are not on.
    Object.keys(corners).forEach((cid) => {
      if (!corners[cid]) return;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.corner1 === cid || w.corner2 === cid) continue;
        if (!corners[w.corner1] || !corners[w.corner2]) continue;
        const seg = mkSeg(P(w.corner1), P(w.corner2));
        if (!seg) continue;
        const p = P(cid);
        const t = Math.max(0, Math.min(seg.L, param(seg, p)));
        const q = at(seg, t);
        if (dist(q, p) >= T) continue;
        if (t < T || t > seg.L - T) {
          // Near the wall's end: the same corner.
          merge(cid, t < seg.L / 2 ? w.corner1 : w.corner2);
        } else {
          // On the wall: put there, and the wall split at it.
          corners[cid] = { x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10 };
          walls.splice(i, 1, { ...w, corner2: cid }, { ...w, corner1: cid });
        }
        changed = true;
        return;
      }
    });
    tidy();
    if (!changed) break;
  }
  // Corners no wall uses any more.
  const used = new Set(walls.map((w) => [w.corner1, w.corner2]).flat());
  Object.keys(corners).forEach((id) => !used.has(id) && delete corners[id]);
};

/**
 * A wall this close to level or plumb (degrees) is drawn exactly so. A plan's
 * walls are square or deliberately angled (30°, 45°…); one a few degrees off
 * is a corner joined at a small step, not a slanted wall.
 */
const STRAIGHT_DEG = 8;

/**
 * KEEP STRAIGHT WALLS STRAIGHT. A wall within a few degrees of horizontal
 * has both its ends set to one y, a wall within a few degrees of vertical to
 * one x — and walls joined end to end along one line share it — so joining
 * corners never leaves a long wall a few centimetres off true. Slanted walls
 * are left as drawn.
 */
const straighten = (corners, walls) => {
  const tan = Math.tan(STRAIGHT_DEG * DEG);
  ["y", "x"].forEach((axis) => {
    const along = axis === "y" ? "x" : "y";
    const parent = {};
    const root = (id) => {
      while (parent[id] !== id) {
        parent[id] = parent[parent[id]];
        id = parent[id];
      }
      return id;
    };
    walls.forEach((w) => {
      const a = corners[w.corner1];
      const b = corners[w.corner2];
      if (!a || !b) return;
      if (Math.abs(a[axis] - b[axis]) > tan * Math.abs(a[along] - b[along])) return;
      parent[w.corner1] = parent[w.corner1] || w.corner1;
      parent[w.corner2] = parent[w.corner2] || w.corner2;
      parent[root(w.corner1)] = root(w.corner2);
    });
    const sums = {};
    Object.keys(parent).forEach((id) => {
      const g = root(id);
      if (!sums[g]) sums[g] = { t: 0, n: 0 };
      sums[g].t += corners[id][axis];
      sums[g].n += 1;
    });
    Object.keys(parent).forEach((id) => {
      const g = sums[root(id)];
      corners[id] = { ...corners[id], [axis]: Math.round((g.t / g.n) * 10) / 10 };
    });
  });
};

/** A wall ending in the open shorter than this (cm) is a stub, not a wall. */
const STUB_MAX_CM = 60;
/** A piece joined to nothing at either end shorter than this (cm) is a fragment. */
const FRAGMENT_MAX_CM = 200;

/**
 * DROP THE LOOSE PIECES: what of the wall layer became a short wall joined to
 * nothing — the end of a column, the edge of a wardrobe or loft, a wall's
 * return beside an opening. Each shows as a wall with its own handles and
 * size, and none bounds a room. Removed: a piece with an end joined to
 * nothing shorter than STUB_MAX_CM, and one joined to nothing at either end
 * shorter than FRAGMENT_MAX_CM. Every wall that is part of a room or the
 * outline — joined at both ends — is kept, whatever its length. Returns how
 * many were removed.
 */
const pruneLooseWalls = (corners, walls) => {
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const degree = {};
    walls.forEach((w) => {
      degree[w.corner1] = (degree[w.corner1] || 0) + 1;
      degree[w.corner2] = (degree[w.corner2] || 0) + 1;
    });
    let changed = false;
    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i];
      const a = corners[w.corner1];
      const b = corners[w.corner2];
      if (!a || !b) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const free1 = degree[w.corner1] === 1;
      const free2 = degree[w.corner2] === 1;
      if ((free1 && free2 && L < FRAGMENT_MAX_CM) || ((free1 || free2) && L < STUB_MAX_CM)) {
        walls.splice(i, 1);
        removed += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const used = new Set(walls.map((w) => [w.corner1, w.corner2]).flat());
  Object.keys(corners).forEach((id) => !used.has(id) && delete corners[id]);
  return removed;
};

/** A face smaller than this is a gap between walls, not a room (cm²). */
const MIN_ROOM_CM2 = 5000;

/** A thickness holding this share of the walls' length is one the plan's walls are drawn at. */
const MAIN_THICKNESS_SHARE = 0.12;
/** A closed box smaller than this (cm²) with no door to it can be a fitting. */
const FITTING_MAX_CM2 = 120000;

/**
 * WHICH SIDES OF EACH WALL HAVE A ROOM — from the walls alone: the faces of the
 * wall graph, as the editor finds its rooms. Each wall is answered as
 * { left, right, same } for the way from its first corner to its second:
 * a room on that side, and whether both sides are one face (a wall standing
 * free, which bounds nothing).
 */
const wallSides = (corners, walls) => {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  walls.forEach((w) => {
    add(w.corner1, w.corner2);
    add(w.corner2, w.corner1);
  });
  const ang = (a, b) => Math.atan2(corners[b].y - corners[a].y, corners[b].x - corners[a].x);
  adj.forEach((list, k) => list.sort((x, y) => ang(k, x) - ang(k, y)));
  // Each face is walked once: at a corner, the next wall is the one just
  // clockwise from the way back. Every face then lies on the LEFT of its
  // walls, and the rooms are the faces that turn counter-clockwise (area > 0).
  const faceOf = new Map();
  const areas = [];
  const rings = [];
  adj.forEach((list, a) => {
    list.forEach((b) => {
      if (faceOf.has(`${a}>${b}`)) return;
      const id = areas.length;
      const ring = [];
      let u = a;
      let v = b;
      for (let guard = 0; guard < 10000 && !faceOf.has(`${u}>${v}`); guard++) {
        faceOf.set(`${u}>${v}`, id);
        ring.push(u);
        const nb = adj.get(v);
        const i = nb.indexOf(u);
        u = v;
        v = nb[(i - 1 + nb.length) % nb.length];
      }
      let area = 0;
      ring.forEach((k, i) => {
        const p = corners[k];
        const q = corners[ring[(i + 1) % ring.length]];
        area += p.x * q.y - q.x * p.y;
      });
      areas.push(area / 2);
      rings.push(ring);
    });
  });
  const room = (f) => f != null && areas[f] > MIN_ROOM_CM2;
  const sides = walls.map((w) => {
    const l = faceOf.get(`${w.corner1}>${w.corner2}`);
    const r = faceOf.get(`${w.corner2}>${w.corner1}`);
    return { left: room(l), right: room(r), same: l === r, leftFace: l, rightFace: r };
  });
  return { sides, rings, areas, isRoom: room };
};

/** Is the point inside the polygon of these corners (ids into `corners`)? */
const insideRing = (corners, ring, [x, y]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = corners[ring[i]];
    const q = corners[ring[j]];
    if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
  }
  return inside;
};

/**
 * TAKE OUT THE FITTINGS DRAWN AMONG THE WALLS. An interior drawing often has
 * a bed, a wardrobe or a loft outlined on the wall layer, and each becomes a
 * little closed room of walls inside the real one — the bedroom split in two.
 * A wall is a fitting's when
 *   · it is drawn at a thickness the plan's walls are not (the plan's own are
 *     the few thicknesses that most of its wall length is drawn at), and
 *   · on one side is a small closed box with no door to it, and on
 *     the other a room — a wall between a room and the outside is kept.
 * Done over until nothing more goes, as taking one out can join its box to the
 * next. Does nothing where the plan's walls have no clear thicknesses.
 * Returns how many were removed.
 */
const dropFittings = (corners, walls, doors) => {
  const len = (w) => Math.hypot(corners[w.corner2].x - corners[w.corner1].x, corners[w.corner2].y - corners[w.corner1].y);
  const bins = [];
  walls.forEach((w) => {
    if (!w.thickness) return;
    const bin = bins.find((b) => Math.abs(b.t - w.thickness) <= 1.5);
    if (bin) bin.total += len(w);
    else bins.push({ t: w.thickness, total: len(w) });
  });
  const all = bins.reduce((s, b) => s + b.total, 0);
  const main = bins.filter((b) => b.total >= MAIN_THICKNESS_SHARE * all);
  if (!all || main.reduce((s, b) => s + b.total, 0) < 0.6 * all) return 0;
  const outlier = (w) => w.thickness && !main.some((b) => Math.abs(b.t - w.thickness) <= 2);
  let removed = 0;
  for (let round = 0; round < 6; round++) {
    const { sides, areas, isRoom } = wallSides(corners, walls);
    const opened = new Map();
    const note = (o) => {
      let best = -1;
      let bestD = 60;
      walls.forEach((w, i) => {
        const a = corners[w.corner1];
        const b = corners[w.corner2];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((o.cxCm - a.x) * dx + (o.cyCm - a.y) * dy) / l2));
        const d = Math.hypot(a.x + t * dx - o.cxCm, a.y + t * dy - o.cyCm);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) [sides[best].leftFace, sides[best].rightFace].forEach((f) => opened.set(f, (opened.get(f) || 0) + 1));
    };
    // Only a door counts: a window is to the outside, and a box has one too.
    doors.forEach(note);
    // Most of a fitting's outline is drawn at its own thickness; a real room's walls are the plan's.
    const odd = new Map();
    const around = new Map();
    walls.forEach((w, i) => {
      [sides[i].leftFace, sides[i].rightFace].forEach((f) => {
        around.set(f, (around.get(f) || 0) + len(w));
        if (outlier(w)) odd.set(f, (odd.get(f) || 0) + len(w));
      });
    });
    const closed = (f) =>
      f != null && isRoom(f) && areas[f] < FITTING_MAX_CM2 && !opened.get(f) && (odd.get(f) || 0) >= 0.5 * (around.get(f) || 1);
    const drop = [];
    walls.forEach((w, i) => {
      if (!outlier(w)) return;
      const s = sides[i];
      if (s.same) return;
      // A sliver left beside a fitting counts as a closed box too.
      const gap = (f) => f != null && areas[f] > 0 && areas[f] < MIN_ROOM_CM2;
      const box = (f) => closed(f) || gap(f);
      if ((box(s.leftFace) && isRoom(s.rightFace)) || (box(s.rightFace) && isRoom(s.leftFace))) drop.push(i);
    });
    if (!drop.length) break;
    drop.reverse().forEach((i) => walls.splice(i, 1));
    removed += drop.length;
  }
  const used = new Set(walls.map((w) => [w.corner1, w.corner2]).flat());
  Object.keys(corners).forEach((id) => !used.has(id) && delete corners[id]);
  return removed;
};

/** Typical sizes taken for a ventilator and window where the plan gives none (cm) — and said so. */
const VENT_HEIGHT_CM = 45;
const VENT_SILL_CM = 170;
const WINDOW_HEIGHT_CM = 120;
const WINDOW_SILL_CM = 90;

/**
 * WHAT EACH DOOR AND WINDOW IS. From the plan's tag where it has one (MD the
 * main door, FD a folding door, V a ventilator), and from the rooms either
 * side of it — a door into a toilet is a toilet door, into a bedroom a bedroom
 * door. Each is given its name, so it reads so in the plan, the 3D and the
 * schedule. Returns what had to be taken for typical values, for the person
 * importing to check.
 *
 * @param labels [{ name, p }] the plan's room names, where they stand
 */
const describeOpenings = (corners, walls, doors, windows, labels) => {
  const { sides, rings, isRoom } = wallSides(corners, walls);
  const names = rings.map((ring, f) => {
    if (!isRoom(f)) return null;
    const hit = labels.find((l) => insideRing(corners, ring, l.p));
    return hit ? hit.name : null;
  });
  const hostOf = (o) => {
    let best = -1;
    let bestD = 60;
    walls.forEach((w, i) => {
      const a = corners[w.corner1];
      const b = corners[w.corner2];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((o.cxCm - a.x) * dx + (o.cyCm - a.y) * dy) / l2));
      const d = Math.hypot(a.x + t * dx - o.cxCm, a.y + t * dy - o.cyCm);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  const around = (o) => {
    const i = hostOf(o);
    if (i < 0) return { names: [], outside: false };
    const s = sides[i];
    return {
      names: [s.leftFace, s.rightFace].map((f) => (f != null ? names[f] : null)).filter(Boolean),
      outside: s.left !== s.right,
    };
  };
  let ventilators = 0;
  let plainWindows = 0;
  let doorsGuessed = 0;
  doors.forEach((d) => {
    const tag = (d.tag || "").toUpperCase();
    const near = around(d);
    const say = near.names.join(" ").toLowerCase();
    if (/^MD/.test(tag)) d.name = "Main Door";
    else if (/^FD/.test(tag)) {
      d.name = "Folding Door";
      d.open = "BOTH_SIDES";
    } else if (/toilet|bath|\bwc\b|wash/.test(say)) d.name = "Toilet Door";
    else if (/bed/.test(say)) d.name = "Bedroom Door";
    else if (/kitchen/.test(say)) d.name = "Kitchen Door";
    else if (/balcony|terrace|sit|deck/.test(say)) d.name = "Balcony Door";
    else if (near.outside && near.names.length) d.name = "Entrance Door";
    else d.name = "Door";
    doorsGuessed += 1;
  });
  windows.forEach((w) => {
    if (/^V/i.test(w.tag || "")) {
      w.name = "Ventilator";
      w.heightCm = VENT_HEIGHT_CM;
      w.sillCm = VENT_SILL_CM;
      ventilators += 1;
    } else {
      w.name = "Window";
      plainWindows += 1;
    }
  });
  const checks = [];
  const untagged = [...doors, ...windows].filter((o) => !o.tag).length;
  if (untagged) {
    checks.push(`${untagged} opening${untagged > 1 ? "s" : ""} ha${untagged > 1 ? "ve" : "s"} no D, W or V tag beside ${untagged > 1 ? "them" : "it"} on the plan: each was told by where it is (an outer wall's is a window, an inner wall's a door).`);
  }
  if (doorsGuessed) {
    checks.push(`${doorsGuessed} door${doorsGuessed > 1 ? "s" : ""}: the swing isn't drawn on this plan, so each is a single door, a pair or an open frame by its width. Check which way they open.`);
  }
  if (ventilators) {
    checks.push(`${ventilators} ventilator${ventilators > 1 ? "s" : ""}: width from the opening in the wall; a height of ${VENT_HEIGHT_CM} cm at ${VENT_SILL_CM} cm above the floor is typical, not from the plan.`);
  }
  if (plainWindows) {
    checks.push(`${plainWindows} window${plainWindows > 1 ? "s" : ""}: width from the opening; a height of ${WINDOW_HEIGHT_CM} cm at ${WINDOW_SILL_CM} cm above the floor is typical, not from the plan.`);
  }
  return checks;
};

/**
 * THE WALLS AS THE EDITOR BUILDS THEM. A drawing's wall is a centre line with
 * a thickness; the editor builds a wall from its corner line INWARD, the whole
 * thickness, on each side that has a room. Laid as drawn, an outer wall comes
 * out half a thickness too far in — every room too small — and a partition
 * between two rooms twice as thick. So, to come out as drawn:
 *   · a wall with a room on ONE side has its corner line moved out to its
 *     outer face — half a thickness away from the room;
 *   · a wall with a room on BOTH sides keeps its line and is given half its
 *     thickness, which the editor doubles.
 * Corners are carried to where their shifted walls meet, so the walls stay
 * joined; doors and windows go with the wall they are on.
 */
const engineTrue = (corners, walls, openings) => {
  const { sides } = wallSides(corners, walls);
  const info = walls.map((w, i) => {
    const a = corners[w.corner1];
    const b = corners[w.corner2];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = [(b.x - a.x) / L, (b.y - a.y) / L];
    const n = [-u[1], u[0]]; // the left of the way a → b
    // A wall with no stated thickness takes the editor's own, which is not
    // known here: it is left as it is.
    const t = w.thickness || 0;
    const s = sides[i];
    let shift = [0, 0];
    let thickness = t;
    if (!t) thickness = 0;
    else if (!s.same && s.left && s.right) thickness = t / 2;
    // A railing is measured to its line (a balcony is 4'-0" to it), so the line
    // is its face on the room's side; any other wall's line is its middle.
    else if (!s.same && s.left) shift = [(-n[0] * t * (w.rail ? 1 : 0.5)), (-n[1] * t * (w.rail ? 1 : 0.5))];
    else if (!s.same && s.right) shift = [(n[0] * t * (w.rail ? 1 : 0.5)), (n[1] * t * (w.rail ? 1 : 0.5))];
    if (!t) shift = [0, 0];
    return { u, n, shift, thickness, moved: shift[0] !== 0 || shift[1] !== 0 };
  });

  const at = new Map();
  walls.forEach((w, i) => {
    [w.corner1, w.corner2].forEach((id) => {
      if (!at.has(id)) at.set(id, []);
      at.get(id).push(i);
    });
  });

  // A straight run of walls end to end (an outer wall, then the partition
  // that carries on in line with it) is one line. Shifted each its own way —
  // the outer part out, the partition not — its pieces could not meet at their
  // shared corner without one leaning. So the run takes one shift, the mean of
  // its pieces' by length: the long pieces stay as drawn, a short one beside
  // them gives up the few centimetres. (A step shorter than the editor's
  // corner tolerance would be joined back up on loading.)
  const runOf = walls.map((_, i) => i);
  const rootOf = (i) => {
    while (runOf[i] !== i) i = runOf[i] = runOf[runOf[i]];
    return i;
  };
  at.forEach((list) => {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = info[list[x]];
        const b = info[list[y]];
        if (Math.abs(a.u[0] * b.u[1] - a.u[1] * b.u[0]) < 0.03) runOf[rootOf(list[x])] = rootOf(list[y]);
      }
    }
  });
  const runs = new Map();
  walls.forEach((w, i) => {
    if (!w.thickness) return;
    const r = rootOf(i);
    if (!runs.has(r)) runs.set(r, []);
    runs.get(r).push(i);
  });
  let leaning = 0;
  runs.forEach((list) => {
    if (list.length < 2) return;
    const ref = info[list[0]].n;
    const length = (i) => Math.hypot(corners[walls[i].corner2].x - corners[walls[i].corner1].x, corners[walls[i].corner2].y - corners[walls[i].corner1].y);
    const s = list.map((i) => info[i].shift[0] * ref[0] + info[i].shift[1] * ref[1]);
    const total = list.reduce((t, i) => t + length(i), 0) || 1;
    const mean = list.reduce((t, i, n) => t + s[n] * length(i), 0) / total;
    if (Math.max(...s) - Math.min(...s) < 0.5) return;
    list.forEach((i, n) => {
      if (Math.abs(s[n] - mean) > 2) leaning += 1;
      info[i].shift = [ref[0] * mean, ref[1] * mean];
      info[i].moved = Math.abs(mean) > 0.01;
    });
  });

  // Where each corner goes: the meeting of its walls' shifted lines — the
  // moved walls first, so an outer corner stays an outer corner.
  const next = {};
  at.forEach((list, id) => {
    const p = corners[id];
    const lines = list.map((i) => ({
      u: info[i].u,
      n: info[i].n,
      d: info[i].n[0] * (p.x + info[i].shift[0]) + info[i].n[1] * (p.y + info[i].shift[1]),
      moved: info[i].moved,
    }));
    const meet2 = (l1, l2) => {
      const cross = l1.n[0] * l2.n[1] - l1.n[1] * l2.n[0];
      if (Math.abs(cross) < 0.2) return null;
      return {
        x: (l1.d * l2.n[1] - l2.d * l1.n[1]) / cross,
        y: (l1.n[0] * l2.d - l2.n[0] * l1.d) / cross,
        strength: Math.abs(cross) + (l1.moved ? 1 : 0) + (l2.moved ? 1 : 0),
      };
    };
    let best = null;
    for (let x = 0; x < lines.length; x++) {
      for (let y = x + 1; y < lines.length; y++) {
        const m = meet2(lines[x], lines[y]);
        if (m && (!best || m.strength > best.strength)) best = m;
      }
    }
    if (best) next[id] = { x: best.x, y: best.y };
    else {
      // All one way (a wall's end, or collinear pieces): along the shift.
      const mv = lines.find((l) => l.moved);
      if (mv) next[id] = { x: p.x + mv.n[0] * (mv.d - (mv.n[0] * p.x + mv.n[1] * p.y)), y: p.y + mv.n[1] * (mv.d - (mv.n[0] * p.x + mv.n[1] * p.y)) };
    }
  });

  // Openings go with the wall they stand on (the nearest, before it moves).
  openings.forEach((o) => {
    let bestI = -1;
    let bestD = Infinity;
    walls.forEach((w, i) => {
      const a = corners[w.corner1];
      const b = corners[w.corner2];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((o.cxCm - a.x) * dx + (o.cyCm - a.y) * dy) / l2));
      const d = Math.hypot(a.x + t * dx - o.cxCm, a.y + t * dy - o.cyCm);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    if (bestI >= 0 && bestD < 60) {
      o.cxCm += info[bestI].shift[0];
      o.cyCm += info[bestI].shift[1];
    }
  });

  Object.entries(next).forEach(([id, q]) => {
    corners[id].x = Math.round(q.x * 10) / 10;
    corners[id].y = Math.round(q.y * 10) / 10;
  });
  walls.forEach((w, i) => {
    if (w.thickness) {
      w.thickness = Math.round(info[i].thickness * 10) / 10;
      // Laid so the editor's own footprint of it is the drawing's wall: the 2D
      // plan draws it so, and the columns in it, as drawn.
      w.builtFootprint = true;
    }
    delete w.rail;
  });
  return leaning;
};

/**
 * HOW FAR (cm) a loose wall end may be from another corner and still be taken
 * for the same corner. Walls are re-laid at their true thickness last, which
 * can leave two ends that were one corner a few cm apart; an end no wall
 * leaves open on is then a room that does not close.
 */
const HEAL_END_CM = 32;

/**
 * JOIN LOOSE WALL ENDS. A wall end that no other wall touches is moved onto
 * the nearest corner within HEAL_END_CM, as long as the wall keeps its
 * direction (within 25°). A loose end that would land on a wall already
 * there is a duplicate of it, and is dropped. Done once the walls are settled, so it only picks up what the final
 * laying-out left behind. Returns how many ends were joined.
 */
const healLooseEnds = (corners, walls) => {
  let healed = 0;
  for (let pass = 0; pass < 3; pass++) {
    const deg = new Map();
    walls.forEach((w) => {
      deg.set(w.corner1, (deg.get(w.corner1) || 0) + 1);
      deg.set(w.corner2, (deg.get(w.corner2) || 0) + 1);
    });
    let changed = false;
    for (const [id, d] of deg) {
      if (d !== 1 || !corners[id]) continue;
      const w = walls.find((x) => x.corner1 === id || x.corner2 === id);
      const otherId = w.corner1 === id ? w.corner2 : w.corner1;
      const a = corners[otherId];
      const e = corners[id];
      const L0 = Math.hypot(e.x - a.x, e.y - a.y);
      if (!(L0 > 0)) continue;
      let best = null;
      for (const [k, c] of Object.entries(corners)) {
        if (k === id || k === otherId || !deg.has(k)) continue;
        const dd = Math.hypot(c.x - e.x, c.y - e.y);
        if (dd > HEAL_END_CM || (best && dd >= best.dd)) continue;
        // The wall must still run the way it did.
        const L1 = Math.hypot(c.x - a.x, c.y - a.y);
        if (!(L1 > 0)) continue;
        const cos = ((e.x - a.x) * (c.x - a.x) + (e.y - a.y) * (c.y - a.y)) / (L0 * L1);
        if (cos < Math.cos((25 * Math.PI) / 180)) continue;
        best = { k, dd };
      }
      if (!best) continue;
      // Landing on a wall that is already there: this loose end is a SECOND
      // copy of that wall, left skewed by the re-laying (the same wall drawn
      // on two layers). It is not a wall of its own, so it is taken away.
      if (walls.some((x) => (x.corner1 === otherId && x.corner2 === best.k) || (x.corner2 === otherId && x.corner1 === best.k))) {
        walls.splice(walls.indexOf(w), 1);
        delete corners[id];
        healed += 1;
        changed = true;
        break;
      }
      walls.forEach((x) => {
        if (x.corner1 === id) x.corner1 = best.k;
        if (x.corner2 === id) x.corner2 = best.k;
      });
      delete corners[id];
      healed += 1;
      changed = true;
      break; // degrees changed: look again
    }
    if (!changed) break;
  }
  return healed;
};

/** Space kept between an opening and the end of its wall (cm). */
const OPENING_MARGIN_CM = 5;
/** A door narrower than this after fitting is dropped (cm). */
const DOOR_MIN_CM = 50;

/**
 * EVERY DOOR AND WINDOW ON A WALL THAT HOLDS IT, AND EACH ONLY ONCE.
 *
 * An opening is measured across its gap or glazing in the drawing, but the
 * finished walls are split wherever another wall meets them, so one could
 * land on a piece shorter than itself — or run past the end of its wall — and
 * the part beyond stood in 3D as a frame with no wall round it. So, on the
 * finished walls:
 *   · it is placed on the piece of wall its middle is on, inside that piece;
 *   · one that reaches across a junction onto the next piece of the same
 *     straight wall becomes one opening per piece (a window each side of a
 *     partition); a door keeps only its largest part;
 *   · two that overlap on one wall are one — a door before a window, the
 *     wider before the narrower.
 * `doors` and `windows` ({cxCm, cyCm, widthCm}) are rewritten in place.
 */
const fitOpenings = (corners, walls, doors, windows) => {
  const pieces = walls
    .map((w) => {
      const a = corners[w.corner1];
      const b = corners[w.corner2];
      if (!a || !b) return null;
      return mkSeg([a.x, a.y], [b.x, b.y], w.thickness || 10);
    })
    .filter(Boolean);
  if (!pieces.length) return 0;
  const nearestPiece = (p) => {
    let best = null;
    pieces.forEach((s) => {
      const d = segDistance(s, p);
      if (!best || d < best.d) best = { s, d };
    });
    return best;
  };
  const m = OPENING_MARGIN_CM;
  const placed = [];
  const fit = (kind, o) => {
    const p = [o.cxCm, o.cyCm];
    const near = nearestPiece(p);
    if (!near || near.d > 60) return; // as the editor: no wall near, not placed
    const host = near.s;
    const t = param(host, p);
    const lo = t - o.widthCm / 2;
    const hi = t + o.widthCm / 2;
    // The pieces of the same straight wall it reaches, and its part on each.
    const parts = [];
    pieces.forEach((s) => {
      if (s !== host) {
        if (!parallel(host, s, 1)) return;
        if (Math.abs(offset(host, s.a)) > 2 || Math.abs(offset(host, s.b)) > 2) return;
      }
      const s0 = Math.min(param(host, s.a), param(host, s.b)) + m;
      const s1 = Math.max(param(host, s.a), param(host, s.b)) - m;
      const a = Math.max(lo, s0);
      const b = Math.min(hi, s1);
      if (b - a > 1) parts.push({ a, b, len: b - a, onHost: s === host });
    });
    if (!parts.length) return;
    const whole = parts.length === 1 && parts[0].onHost && parts[0].len >= o.widthCm - 0.5;
    let keep;
    if (whole) keep = parts;
    else if (kind === "door") {
      const big = parts.reduce((x, y) => (y.len > x.len ? y : x));
      keep = big.len >= DOOR_MIN_CM ? [big] : [];
    } else {
      // A part split off at a junction narrower than a door is what is left of
      // the window's end past the wall, not a window of its own.
      keep = parts.filter((q) => q.len >= DOOR_MIN_CM);
    }
    keep.forEach((q) => {
      const c = at(host, (q.a + q.b) / 2);
      // What else is known of it (its tag) goes with it.
      placed.push({ kind, host, a: q.a, b: q.b, o: { ...o, cxCm: c[0], cyCm: c[1], widthCm: q.len } });
    });
  };
  doors.forEach((o) => fit("door", o));
  windows.forEach((o) => fit("window", o));

  // One opening per stretch of wall: doors first; of two on the same stretch
  // the one the plan tags (D2, W1…) before one it does not, then the wider.
  placed.sort((x, y) =>
    x.kind === y.kind
      ? (y.o.tag ? 1 : 0) - (x.o.tag ? 1 : 0) || y.o.widthCm - x.o.widthCm
      : x.kind === "door"
      ? -1
      : 1
  );
  const kept = [];
  placed.forEach((q) => {
    const clash = kept.some((k) => {
      if (!parallel(k.host, q.host, 1)) return false;
      const band = Math.max(k.host.thickness || 10, q.host.thickness || 10) / 2 + 5;
      if (Math.abs(offset(k.host, [q.o.cxCm, q.o.cyCm])) > band) return false;
      const q0 = param(k.host, at(q.host, q.a));
      const q1 = param(k.host, at(q.host, q.b));
      const lo = Math.max(k.a, Math.min(q0, q1));
      const hi = Math.min(k.b, Math.max(q0, q1));
      return hi - lo > 1;
    });
    if (!clash) kept.push(q);
  });
  const before = doors.length + windows.length;
  doors.length = 0;
  windows.length = 0;
  kept.forEach((q) => (q.kind === "door" ? doors : windows).push(q.o));
  return before - kept.length;
};

/**
 * The plan for the chosen roles and unit.
 *
 * @param {Object} doc       from parseDxf
 * @param {Object} o
 * @param {Object} o.roles   layer name → "wall" | "door" | "window" | "name" | "ignore"
 * @param {string} o.unit    one of DXF_UNITS' ids
 * @param {boolean} [o.singleLines=false]  a wall line with no partner is a
 *        wall even in a drawing whose walls are drawn with two faces
 * @param {Object} [o.region]  one drawing of several (findDrawings): only it
 */
export const analyzeDxf = (whole, { roles, unit, singleLines = false, region, bareGaps = false, forEditor = true }) => {
  const doc = region ? clipDoc(whole, region) : whole;
  const k = unitCm(unit);
  const role = (layer) => (roles && roles[layer]) || "ignore";

  // Drawing units, y up → centimetres, y down, starting at the walls' top-left.
  const wallSrc = doc.segs.filter((s) => role(s.layer) === "wall");
  const all = doc.segs.map((s) => [s.a, s.b]).flat();
  const b = boundsOf(wallSrc.length ? wallSrc.map((s) => [s.a, s.b]).flat() : all);
  const toPlan = (p) => [(p[0] - b.minX) * k, (b.maxY - p[1]) * k];

  // ── walls: face lines in pairs → centre lines ──
  let faces = wallSrc.map((s) => mkSeg(toPlan(s.a), toPlan(s.b), null)).filter((s) => s && s.L >= 1);
  faces = mergeOverlapping(faces);
  faces.forEach((f) => (f.cov = []));

  const cands = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const s = faces[i];
      const q = faces[j];
      if (!parallel(s, q, 1)) continue;
      const o1 = offset(s, q.a);
      const o2 = offset(s, q.b);
      if (Math.sign(o1) !== Math.sign(o2) || Math.abs(Math.abs(o1) - Math.abs(o2)) > 1) continue;
      const d = (Math.abs(o1) + Math.abs(o2)) / 2;
      if (d < WALL_MIN_CM || d > WALL_MAX_CM) continue;
      const t1 = param(s, q.a);
      const t2 = param(s, q.b);
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(s.L, Math.max(t1, t2));
      if (hi - lo < 5) continue;
      cands.push({ s, q, d, side: Math.sign(o1), lo, hi });
    }
  }
  // The thicknesses this plan's walls are drawn at, from its long walls.
  const usual = [];
  cands.forEach((c) => {
    if (c.hi - c.lo >= 100 && !usual.some((t) => Math.abs(t - c.d) < 1)) usual.push(c.d);
  });
  // A piece of wall shorter than it is thick is kept only at one of those
  // thicknesses (the short wall between a corner and a window). Otherwise it
  // is the line closing a wall's end beside a door, lying across from the
  // next wall's face — not a wall of its own.
  const keep = cands.filter(
    (c) => c.hi - c.lo >= c.d || usual.some((t) => Math.abs(t - c.d) < 1)
  );
  // Nearest partners first: a face belongs to the wall it is closest across.
  keep.sort((x, y) => x.d - y.d);

  let centres = [];
  keep.forEach(({ s, q, d, side, lo, hi }) => {
    freeParts(lo, hi, s.cov).forEach(([x0, x1]) => {
      const q0 = param(q, at(s, x0));
      const q1 = param(q, at(s, x1));
      freeParts(Math.min(q0, q1), Math.max(q0, q1), q.cov).forEach(([y0, y1]) => {
        const s0 = param(s, at(q, y0));
        const s1 = param(s, at(q, y1));
        const lo2 = Math.max(x0, Math.min(s0, s1));
        const hi2 = Math.min(x1, Math.max(s0, s1));
        if (hi2 - lo2 < 5) return;
        const n = [-s.u[1] * side * (d / 2), s.u[0] * side * (d / 2)];
        const pa = at(s, lo2);
        const pb = at(s, hi2);
        const c = mkSeg([pa[0] + n[0], pa[1] + n[1]], [pb[0] + n[0], pb[1] + n[1]], d);
        if (c) centres.push(c);
        s.cov.push([lo2, hi2]);
        const r0 = param(q, at(s, lo2));
        const r1 = param(q, at(s, hi2));
        q.cov.push([Math.min(r0, r1), Math.max(r0, r1)]);
      });
    });
  });
  const pairedCount = centres.length;

  // A long line with no partner: a wall drawn as one line — in a drawing
  // whose walls ARE drawn that way. Where the walls have two faces, a lone
  // line on the wall layer is a wardrobe, a counter or a loft, not a wall.
  let singles = 0;
  if (singleLines || pairedCount < MIN_PAIRED_FOR_FACES) {
    faces.forEach((f) => {
      freeParts(0, f.L, f.cov).forEach(([x0, x1]) => {
        if (x1 - x0 < SINGLE_MIN_CM) return;
        const c = mkSeg(at(f, x0), at(f, x1), null);
        if (c) {
          centres.push(c);
          singles += 1;
        }
      });
    });
  }

  // ── openings: what the door and window layers hold ──
  const lineSet = (want) => {
    const out = [];
    doc.segs.forEach((s) => role(s.layer) === want && out.push([toPlan(s.a), toPlan(s.b)]));
    doc.arcs.forEach((a) => {
      if (role(a.layer) !== want) return;
      const pts = a.pts.map(toPlan);
      for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
    });
    return out;
  };
  const doorLines = lineSet("door");
  const windowLines = lineSet("window");
  const doors = [];
  const windows = [];
  const openingAreas = [];
  // Gaps with nothing drawn in them, which `bareGaps` turns into openings once
  // the walls around them are known (what an opening is depends on where it is).
  const bare = [];
  // What the plan's own tags say is a door or a window (D2, W1, V …), where they are.
  const tags = [];
  // Every drawn line that is not a label, in plan cm: where a room is open to
  // the outside, a railing among them may close it; and a gap with wall faces
  // drawn along it is wall, not a doorway.
  const support = [];
  if (bareGaps || CLOSE_NAMED_ROOMS) {
    doc.segs.forEach((s) => {
      // A wall layer's lines count too: a railing is often drawn on it, a
      // single line no wall was made of. Inside a gap no wall stands in, so
      // the walls themselves can't be mistaken for one.
      if (role(s.layer) === "name") return;
      const a = toPlan(s.a);
      const b = toPlan(s.b);
      if (dist(a, b) >= RAIL_MIN_LINE_CM) support.push([a, b]);
    });
  }
  if (bareGaps) {
    doc.texts.forEach((t) => {
      const text = String(t.text || "").trim();
      const kind = DOOR_TAG.test(text) ? "door" : WINDOW_TAG.test(text) ? "window" : null;
      if (kind) tags.push({ kind, p: toPlan(t.p), text });
    });
  }

  // ── one wall through its gaps; a door or window where the gap holds one ──
  const thick = (c) => c.thickness || 10;
  // One join per round, then look again; each join leaves one wall fewer, so
  // this ends on its own — the guard only stops a runaway.
  let changed = true;
  let guard = 0;
  const rounds = centres.length + 10;
  while (changed && guard++ < rounds) {
    changed = false;
    for (let i = 0; i < centres.length && !changed; i++) {
      for (let j = 0; j < centres.length && !changed; j++) {
        if (i === j) continue;
        const c1 = centres[i];
        const c2 = centres[j];
        if (!parallel(c1, c2, 1)) continue;
        if (Math.abs(offset(c1, c2.a)) > 2 || Math.abs(offset(c1, c2.b)) > 2) continue;
        const t1 = param(c1, c2.a);
        const t2 = param(c1, c2.b);
        const lo = Math.min(t1, t2);
        const hi = Math.max(t1, t2);
        // The gap between them along c1, if they do not overlap: past c1's
        // end, or before its start (the two may be drawn pointing either way).
        let gapFrom = null;
        let gapTo = null;
        if (lo >= c1.L - 0.5) {
          gapFrom = c1.L;
          gapTo = lo;
        } else if (hi <= 0.5) {
          gapFrom = hi;
          gapTo = 0;
        }
        if (gapFrom != null) {
          // A wall meeting the gap from the side divides it — two doors
          // either side of a partition are two openings, not one wide one.
          const half = Math.max(thick(c1), thick(c2)) / 2 + 5;
          const cuts = [];
          centres.forEach((o, oi) => {
            if (oi === i || oi === j || parallel(o, c1, 15)) return;
            const X = meet(c1, o);
            if (!X) return;
            const tX = param(c1, X);
            if (tX <= gapFrom || tX >= gapTo) return;
            // Up to a wall's greatest thickness away: walls stop short at a
            // column, and the doors are hung either side of it all the same.
            const tO = param(o, X);
            if (tO < -WALL_MAX_CM || tO > o.L + WALL_MAX_CM) return;
            cuts.push([tX - thick(o) / 2, tX + thick(o) / 2]);
          });
          const found = [];
          let open = false;
          freeParts(gapFrom, gapTo, cuts).forEach(([g0, g1]) => {
            const gap = g1 - g0;
            if (open || gap <= 1) return;
            const from = at(c1, g0);
            const to = at(c1, g1);
            let kind = null;
            if (crossesGap(doorLines, from, to, half)) kind = "door";
            else if (crossesGap(windowLines, from, to, half)) kind = "window";
            if (kind) {
              if (gap < OPENING_MIN_CM || gap > OPENING_MAX_CM) open = true;
              else found.push({ kind, from, to, gap });
            } else if (
              bareGaps &&
              gap <= BARE_GAP_MAX_CM &&
              // A narrow gap is an opening only where the plan tags it (a 60 cm
              // ventilator, a small window).
              (gap >= BARE_GAP_MIN_CM ||
                (gap >= TAGGED_GAP_MIN_CM && tags.some((t) => dist(mid(from, to), t.p) <= TAG_REACH_CM / 2)))
            ) {
              found.push({ kind: "bare", from, to, gap });
            } else if (gap > WALL_MAX_CM) {
              open = true; // an open passage: left open
            }
          });
          if (open) continue;
          found.forEach(({ kind, from, to, gap }) => {
            if (kind === "bare") {
              bare.push({ from, to, gap });
              openingAreas.push({ from, to, half });
              return;
            }
            // A door fills its gap, jamb to jamb. A window is as wide as its
            // own lines run along the wall — the gap can hold more than it.
            let centre = mid(from, to);
            let width = gap;
            if (kind === "window") {
              const run = extentInGap(windowLines, from, to, half);
              if (!run || run.hi - run.lo < OPENING_MIN_CM) return;
              const g = mkSeg(from, to);
              centre = at(g, (run.lo + run.hi) / 2);
              width = run.hi - run.lo;
            }
            (kind === "door" ? doors : windows).push({ cxCm: centre[0], cyCm: centre[1], widthCm: width });
            openingAreas.push({ from, to, half });
          });
        }
        const t = [c1.thickness, c2.thickness].filter((v) => v != null);
        const merged = mkSeg(
          at(c1, Math.min(0, lo)),
          at(c1, Math.max(c1.L, hi)),
          t.length ? Math.max(...t) : null
        );
        if (!merged) continue;
        if (c1.rail && c2.rail) merged.rail = true;
        centres[i] = merged;
        centres.splice(j, 1);
        changed = true;
      }
    }
  }

  // ── corners: each wall end carried on to the wall it meets ──
  for (let pass = 0; pass < 2; pass++) {
    centres.forEach((c, ci) => {
      ["a", "b"].forEach((end) => {
        const cur = centres[ci];
        const E = cur[end];
        const touching = centres.some((o, oi) => oi !== ci && segDistance(o, E) < 1);
        if (touching) return;
        let best = null;
        centres.forEach((o, oi) => {
          if (oi === ci || parallel(cur, o, 15)) return;
          const X = meet(cur, o);
          if (!X) return;
          const t = param(cur, X);
          const beyond = end === "b" ? t - cur.L : -t;
          if (!(beyond > 0)) return;
          const to = param(o, X);
          // Walls may stop well short of where they meet when a column stands
          // there (drawn on its own layer), so they are carried up to a
          // wall's greatest thickness — never across a door or window.
          // Along the centre line only: a door hung beside the joint has its
          // swing right against the wall's face, and must not stop it; a
          // doorway the extension would close is crossed by its swing.
          const blocked = (p) =>
            crossesGap(doorLines, p, X, 1) || crossesGap(windowLines, p, X, 1);
          // A CORNER — the meeting point past the other wall's end too.
          const corner = to < -0.5 || to > o.L + 0.5;
          if (corner) {
            const oEnd = to < 0 ? o.a : o.b;
            const oBeyond = to < 0 ? -to : to - o.L;
            // A CORNER WINDOW: glazing wrapping round the corner, the walls
            // stopping short either side of it. Each wall is carried through
            // its glazing to the corner — as far as a window can be wide — and
            // the window put there. A door in the way still stops it.
            const glazeHalf = Math.max(thick(cur), thick(o)) / 2 + 5;
            const glazed1 = beyond > 1 && crossesGap(windowLines, E, X, glazeHalf);
            const glazed2 = oBeyond > 1 && crossesGap(windowLines, oEnd, X, glazeHalf);
            if (beyond > (glazed1 ? OPENING_MAX_CM : WALL_MAX_CM)) return;
            if (oBeyond > (glazed2 ? OPENING_MAX_CM : WALL_MAX_CM)) return;
            // The other wall's end already joined to a third wall is carried on
            // only for a STEP in the outline: this end sitting on its line.
            const oJoined = centres.some(
              (x, xi) => xi !== oi && xi !== ci && segDistance(x, oEnd) < 1
            );
            if (oJoined && beyond > thick(o) / 2 + 8) return;
            const doorOn = (p) => crossesGap(doorLines, p, X, 1);
            if ((beyond > 1 && (doorOn(E) || (!glazed1 && blocked(E)))) ||
                (oBeyond > 1 && (doorOn(oEnd) || (!glazed2 && blocked(oEnd))))) return;
            const glaze = [];
            if (glazed1 && beyond >= OPENING_MIN_CM) glaze.push([E, beyond, glazeHalf]);
            if (glazed2 && oBeyond >= OPENING_MIN_CM) glaze.push([oEnd, oBeyond, glazeHalf]);
            if (!best || beyond < best.beyond) best = { X, oi, to, beyond, glaze };
            return;
          }
          if (beyond > WALL_MAX_CM) return;
          if (beyond > thick(o) / 2 + 8 && blocked(E)) {
            return; // a wall meeting another's side, past a door: left as drawn
          }
          if (!best || beyond < best.beyond) best = { X, oi, to, beyond, glaze: [] };
        });
        if (!best) return;
        // The corner window, from each wall's old end to the corner.
        // As wide as its own lines run, as in a gap.
        best.glaze.forEach(([from, , half]) => {
          const run = extentInGap(windowLines, from, best.X, half);
          openingAreas.push({ from, to: best.X, half });
          if (!run || run.hi - run.lo < OPENING_MIN_CM) return;
          const centre = at(mkSeg(from, best.X), (run.lo + run.hi) / 2);
          windows.push({ cxCm: centre[0], cyCm: centre[1], widthCm: run.hi - run.lo });
        });
        const a = end === "a" ? best.X : cur.a;
        const bb = end === "b" ? best.X : cur.b;
        const moved = mkSeg(a, bb, cur.thickness);
        if (moved) centres[ci] = moved;
        // The other wall's end, when the meeting point is past it (a corner).
        const o = centres[best.oi];
        if (best.to < -0.5) {
          const m2 = mkSeg(best.X, o.b, o.thickness);
          if (m2) centres[best.oi] = m2;
        } else if (best.to > o.L + 0.5) {
          const m2 = mkSeg(o.a, best.X, o.thickness);
          if (m2) centres[best.oi] = m2;
        }
      });
    });
  }
  centres = centres.filter((c) => c && c.L >= 1);

  // ── loose ends ──
  const looseEnds = () => {
    const out = [];
    centres.forEach((c, ci) =>
      ["a", "b"].forEach((end) => {
        const E = c[end];
        if (!centres.some((o, oi) => oi !== ci && segDistance(o, E) < 1)) out.push({ ci, end, E });
      })
    );
    return out;
  };
  // A wall that changes thickness, lined up on one face: the two pieces' centre
  // lines are side by side, not in line, so they are joined by a short wall
  // across (a column between them is common) — never across a door or window.
  looseEnds().forEach(({ ci, end, E }, k, all) => {
    const c = centres[ci];
    const out = end === "b" ? c.u : [-c.u[0], -c.u[1]];
    all.forEach((f) => {
      if (f.ci === ci) return;
      const o = centres[f.ci];
      if (!parallel(c, o, 1)) return;
      const ahead = dot(sub(f.E, E), out);
      const side = Math.abs(offset(c, f.E));
      if (ahead <= 0.5 || ahead > WALL_MAX_CM || side <= 2 || side > (thick(c) + thick(o)) / 2) return;
      // Each pair once: from the end with the lower index.
      if (f.ci < ci) return;
      if (crossesGap(doorLines, E, f.E, 1) || crossesGap(windowLines, E, f.E, 1)) return;
      const link = mkSeg(E, f.E, Math.min(thick(c), thick(o)));
      if (link) centres.push(link);
    });
  });
  // An end a few centimetres from another wall: put on it.
  looseEnds().forEach(({ ci, end, E }) => {
    let best = null;
    centres.forEach((o, oi) => {
      if (oi === ci) return;
      const t = Math.max(0, Math.min(o.L, param(o, E)));
      const P = at(o, t);
      const d = dist(P, E);
      if (d < 15 && (!best || d < best.d)) best = { P, d };
    });
    if (!best) return;
    const c = centres[ci];
    const moved = mkSeg(end === "a" ? best.P : c.a, end === "b" ? best.P : c.b, c.thickness);
    if (moved && moved.L >= 1) centres[ci] = moved;
  });

  // ── an opening that is not a gap in a line: a wall stopping short of another ──
  // A wall that stops with the next wall a doorway's width ahead is open there
  // — a passage, an arch — unless the plan marks it as a door or window: a tag
  // beside the gap closes it, carrying the wall on across, so the rooms either
  // side of it can close. Any wall end counts, a corner as well as a free end
  // (a window set back in the outer wall leaves the wall's corner and the
  // next wall's side with a gap between them). Nothing may be drawn there yet.
  if (bareGaps && tags.length) {
    // A tag already beside a gap has named that one.
    const alone = (t) => !bare.some((g) => dist(mid(g.from, g.to), t.p) <= TAG_REACH_CM / 4);
    tags.filter(alone).forEach((t) => {
      let best = null;
      centres.forEach((c, ci) => {
        ["a", "b"].forEach((end) => {
          const E = c[end];
          const out = end === "b" ? c.u : [-c.u[0], -c.u[1]];
          centres.forEach((o, oi) => {
            if (oi === ci || parallel(c, o, 5)) return;
            const e = sub(o.b, o.a);
            const denom = out[0] * e[1] - out[1] * e[0];
            const w = sub(o.a, E);
            const s = (w[0] * e[1] - w[1] * e[0]) / denom;
            const u = (w[0] * out[1] - w[1] * out[0]) / denom;
            if (s < BARE_GAP_MIN_CM || s > BARE_GAP_MAX_CM) return;
            // The wall met must reach the line: across its length, give or take a wall's thickness.
            if (u * o.L < -thick(o) || u * o.L > o.L + thick(o)) return;
            const X = [E[0] + out[0] * s, E[1] + out[1] * s];
            const M = mid(E, X);
            const near = dist(M, t.p);
            if (near > TAG_REACH_CM / 1.5 || (best && near >= best.near)) return;
            // Only a gap with nothing in it: no wall across or along it.
            const thin = thick(c) / 2;
            if (centres.some((x, xi) => xi !== ci && xi !== oi && segDistance(x, M) < thin + 5)) return;
            best = { ci, E, X, s, near };
          });
        });
      });
      if (!best) return;
      const link = mkSeg(best.E, best.X, centres[best.ci].thickness);
      if (!link) return;
      centres.push(link);
      bare.push({ from: best.E, to: best.X, gap: best.s });
    });
  }

  // ── doorways still open between rooms the plan names ──
  // Also in a plan that DRAWS its doors: a drawing marks most doorways, but
  // not all (a dressing-room entry, a bath with no door), and a wall that
  // stops short leaves the two rooms either side one room. Only a gap between
  // rooms the plan names, with nothing in it, is closed.
  if (bareGaps || CLOSE_NAMED_ROOMS) {
    const seeds = [];
    doc.texts.forEach((t) => {
      if (role(t.layer) !== "name" || !t.text || isMeasure(t.text)) return;
      const cut = t.text.search(SIZE_START);
      const name = (cut > 0 ? t.text.slice(0, cut) : t.text).trim();
      // A room's name — and not the way in from outside ("MAIN ENTRY").
      if (!name || !ROOM_WORDS.test(name) || /entr|exit|\bmain\b/i.test(name)) return;
      seeds.push(toPlan(t.p));
    });
    closeRoomGaps(centres, seeds, support).forEach((l) => {
      // In a plan that draws its doors, the span is closed WITH an opening in
      // it — a door, a pair, or a wide passage frame with no leaf, by its width
      // — never as a solid wall: the way through stays open, and the two rooms
      // either side are told apart.
      centres.push(l.seg);
      bare.push({ from: l.from, to: l.to, gap: l.s, door: !bareGaps });
    });
  }

  // ── gaps with nothing drawn in them: doors, windows ──
  // What a flattened plan has instead of door and window symbols is a gap in
  // the wall and, near it, the tag its maker gave it (D2, W1, V). The tag names
  // the opening; with none near, an opening on the plan's outer wall is a
  // window and one inside is a door.
  if (bare.length) {
    const middles = bare.map((g) => mid(g.from, g.to));
    // Nearest tag and gap first, each used once.
    const pairs = [];
    bare.forEach((g, gi) =>
      tags.forEach((t, ti) => {
        const d = dist(middles[gi], t.p);
        if (d <= TAG_REACH_CM) pairs.push({ gi, ti, d });
      })
    );
    pairs.sort((x, y) => x.d - y.d);
    const kindOfGap = new Map();
    const tagOfGap = new Map();
    const tagUsed = new Set();
    pairs.forEach(({ gi, ti }) => {
      if (kindOfGap.has(gi) || tagUsed.has(ti)) return;
      kindOfGap.set(gi, tags[ti].kind);
      tagOfGap.set(gi, tags[ti].text);
      tagUsed.add(ti);
    });
    // Does a line out of `p` along `n` meet a wall? One that does not leaves the plan.
    const leaves = (p, n) =>
      !centres.some((c) => {
        const e = sub(c.b, c.a);
        const denom = n[0] * e[1] - n[1] * e[0];
        if (Math.abs(denom) < 1e-9) return false;
        const w = sub(c.a, p);
        const s = (w[0] * e[1] - w[1] * e[0]) / denom;
        const t = (w[0] * n[1] - w[1] * n[0]) / denom;
        return s > 1 && t >= 0 && t <= 1;
      });
    // Wall faces drawn along both sides of a gap, over most of its length: it
    // is a stretch of wall drawn on another layer (or a column's block), not a
    // doorway.
    const builtAlong = (g, n) => {
      const here = nearestWallPoint(mid(g.from, g.to));
      const off = (here ? here.thickness || 10 : 10) / 2;
      const side = (s) => drawnAlong([g.from[0] + n[0] * off * s, g.from[1] + n[1] * off * s], [g.to[0] + n[0] * off * s, g.to[1] + n[1] * off * s], support);
      return Math.min(side(1), side(-1)) >= WALL_DRAWN_COVER;
    };
    const nearestWallPoint = (p) =>
      centres.reduce((best, c) => {
        const d = segDistance(c, p);
        return d < best.d ? { d, thickness: c.thickness } : best;
      }, { d: Infinity });
    bare.forEach((g, gi) => {
      const m = middles[gi];
      let kind = kindOfGap.get(gi);
      const along = sub(g.to, g.from);
      const len = Math.hypot(along[0], along[1]) || 1;
      const n = [-along[1] / len, along[0] / len];
      if (!kind) {
        kind = leaves(m, n) || leaves(m, [-n[0], -n[1]]) ? "window" : "door";
      }
      // No tag and no symbol to say it is a door, and the wall is drawn there.
      // (A doorway closed between two named rooms in a plan that draws its
      // doors is a door whatever lines are drawn near it — furniture counts.)
      if (kind === "door" && !g.door && !tagOfGap.get(gi) && builtAlong(g, n)) return;
      (kind === "door" ? doors : windows).push({ cxCm: m[0], cyCm: m[1], widthCm: g.gap, tag: tagOfGap.get(gi), ...(g.door ? { fromNamedGap: true } : {}) });
    });
  }

  // ── doors and windows drawn over a SOLID wall ──
  // Not every drawing breaks the wall at an opening: a window is often a few
  // lines laid over the wall's face, a door a block or a leaf and its swing.
  // Whatever of the door and window layers was not already found in a gap is
  // gathered into symbols — pieces touching one another are one symbol — and
  // each symbol lying along a wall becomes one opening on it.
  const nearestWall = (p) =>
    centres.reduce(
      (best, c) => {
        const d = segDistance(c, p);
        return d < best.d ? { c, d } : best;
      },
      { c: null, d: Infinity }
    );
  const pieces = [];
  doc.segs.forEach((sg) => {
    const kind = role(sg.layer);
    if (kind === "door" || kind === "window") pieces.push({ kind, lines: [[toPlan(sg.a), toPlan(sg.b)]] });
  });
  doc.arcs.forEach((ar) => {
    const kind = role(ar.layer);
    if (kind !== "door" && kind !== "window") return;
    const pts = ar.pts.map(toPlan);
    pieces.push({
      kind,
      lines: pts.slice(1).map((q, i) => [pts[i], q]),
      arc: { H: toPlan(ar.c), p1: toPlan(ar.p1), p2: toPlan(ar.p2), r: ar.r * k },
    });
  });
  const free = pieces.filter(
    (pc) => !openingAreas.some(({ from, to, half }) => crossesGap(pc.lines, from, to, half))
  );
  free.forEach((pc) => (pc.box = boundsOf(pc.lines.flat())));
  // Pieces within a few centimetres of each other: one symbol.
  const parent = free.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const TOUCH = 3;
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const p = free[i].box;
      const q = free[j].box;
      if (
        free[i].kind === free[j].kind &&
        p.minX - TOUCH <= q.maxX && q.minX - TOUCH <= p.maxX &&
        p.minY - TOUCH <= q.maxY && q.minY - TOUCH <= p.maxY
      ) {
        parent[root(i)] = root(j);
      }
    }
  }
  const groups = new Map();
  free.forEach((pc, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(pc);
  });
  // A window drawn as a line on each face of the wall is two symbols that
  // land on the same spot: one opening, not two.
  const taken = (p, width) =>
    [...doors, ...windows].some(
      (o) => dist([o.cxCm, o.cyCm], p) < Math.min(o.widthCm, width) / 2
    );
  const add = (kind, p, width) => {
    if (taken(p, width)) return;
    (kind === "door" ? doors : windows).push({ cxCm: p[0], cyCm: p[1], widthCm: width });
  };
  groups.forEach((group) => {
    const kind = group[0].kind;
    const pts = group.map((pc) => pc.lines.flat()).flat();
    const bb = boundsOf(pts);
    const centre = [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
    // A door with its swing: hinge at the arc's centre, as wide as its
    // radius; the opening's middle is halfway from the hinge to whichever end
    // of the arc lies along the wall.
    const arcs = group.filter((pc) => pc.arc).map((pc) => pc.arc);
    if (kind === "door" && arcs.length) {
      const arc = arcs.reduce((x, y) => (y.r > x.r ? y : x));
      const c1 = mid(arc.H, arc.p1);
      const c2 = mid(arc.H, arc.p2);
      const at0 = nearestWall(c1).d <= nearestWall(c2).d ? c1 : c2;
      const near = nearestWall(at0);
      if (!near.c || near.d > thick(near.c) / 2 + 15) return;
      if (arc.r < OPENING_MIN_CM || arc.r > OPENING_MAX_CM) return;
      add("door", at0, arc.r);
      return;
    }
    // Otherwise the symbol lies along its wall, inside the wall's band: its
    // length along the wall is the opening's width.
    const near = nearestWall(centre);
    if (!near.c) return;
    const w = near.c;
    if (near.d > thick(w) / 2 + 15) return;
    const ts = pts.map((p) => param(w, p));
    const os = pts.map((p) => offset(w, p));
    const t0 = Math.max(0, Math.min(...ts));
    const t1 = Math.min(w.L, Math.max(...ts));
    const across = Math.max(...os) - Math.min(...os);
    const width = t1 - t0;
    if (width < OPENING_MIN_CM || width > OPENING_MAX_CM || across > thick(w) + 20) return;
    add(kind, at(w, (t0 + t1) / 2), width);
  });

  // ── columns: blocks set into a wall ──
  // A column is drawn as a small square or rectangle, as thick as the wall it
  // stands in or thicker, on a layer of its own or among the fittings — never
  // among the wall's face lines, so the wall comes out as one wall straight
  // through it. Each is kept as the box it is, apart from the walls: the 2D plan
  // draws it and the 3D builds it exactly so, not as a piece of wall whose
  // footprint the editor would work out from the walls beside it.
  // Only what is drawn as a column: painted solid (a PDF's filled shapes) or on
  // a layer named for columns. An outlined box lying in a wall is as likely a
  // window's or a ventilator's frame.
  // (Not when only comparing candidate layers.)
  const columns = [];
  const blocks = !forEditor
    ? []
    : findBlocks(
        doc.segs
          .filter((s) => role(s.layer) !== "name" && role(s.layer) !== "wall")
          .filter((s) => s.fill === true || COLUMN_LAYER.test(s.layer))
          .map((s) => [toPlan(s.a), toPlan(s.b)])
      );
  blocks.forEach((blk) => {
    let best = null;
    centres.forEach((c) => {
      const d = segDistance(c, [blk.cx, blk.cy]);
      if (d < (c.thickness || 10) / 2 + COLUMN_ON_WALL_CM && (!best || d < best.d)) best = { c, d };
    });
    if (!best) return;
    const c = best.c;
    const t = c.thickness || 10;
    const ts = blk.corners.map((p) => param(c, p));
    const os = blk.corners.map((p) => offset(c, p));
    const along = Math.max(...ts) - Math.min(...ts);
    const across = Math.max(...os) - Math.min(...os);
    // As thick as the wall at least, and short: a column or a wall's stub, not
    // a length of wall.
    if (along < COLUMN_MIN_CM || across < t * 0.9 || along / across < 0.5 || along / across > COLUMN_MAX_RATIO) return;
    const bx = blk.corners.map((p) => p[0]);
    const by = blk.corners.map((p) => p[1]);
    columns.push({
      x0: Math.round(Math.min(...bx) * 10) / 10,
      y0: Math.round(Math.min(...by) * 10) / 10,
      x1: Math.round(Math.max(...bx) * 10) / 10,
      y1: Math.round(Math.max(...by) * 10) / 10,
    });
  });

  // ── walls split where others meet them ──
  // A wall another one meets from the side (a T) or crosses (an X) is cut
  // there, so they share a corner and the rooms between them close. Done
  // here, so the plan reaches the editor already joined — the editor's own
  // joining step is not needed for it (and on a plan this size can run long).
  const cutsOf = centres.map(() => []);
  centres.forEach((c, i) => {
    centres.forEach((o, j) => {
      if (i === j) return;
      [o.a, o.b].forEach((E) => {
        const t = param(c, E);
        if (t > 1 && t < c.L - 1 && Math.abs(offset(c, E)) < 1.5) cutsOf[i].push(t);
      });
      if (j > i && !parallel(c, o, 5)) {
        const X = meet(c, o);
        if (!X) return;
        const t = param(c, X);
        const u = param(o, X);
        if (t > 1 && t < c.L - 1 && u > 1 && u < o.L - 1) {
          cutsOf[i].push(t);
          cutsOf[j].push(u);
        }
      }
    });
  });
  const joinedWalls = [];
  centres.forEach((c, i) => {
    const ts = [0, ...cutsOf[i].sort((x, y) => x - y), c.L].filter(
      (t, n, all) => n === 0 || t - all[n - 1] > 0.5
    );
    if (c.L - ts[ts.length - 1] > 1e-6) ts.push(c.L);
    for (let n = 0; n + 1 < ts.length; n++) {
      const piece = mkSeg(at(c, ts[n]), at(c, ts[n + 1]), c.thickness);
      if (piece && c.rail) piece.rail = true;
      if (piece) joinedWalls.push(piece);
    }
  });

  // ── the editor's floorplan: shared corners, walls between them ──
  const corners = {};
  const known = [];
  let n = 0;
  const cornerFor = (p) => {
    let best = null;
    let bestD = 1.5;
    known.forEach((c) => {
      const d = dist(c.p, p);
      if (d <= bestD) {
        best = c;
        bestD = d;
      }
    });
    if (best) return best.id;
    const id = `dxf-${n++}`;
    corners[id] = { x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 };
    known.push({ p, id });
    return id;
  };
  const seen = new Map();
  const walls = [];
  joinedWalls.forEach((c) => {
    const c1 = cornerFor(c.a);
    const c2 = cornerFor(c.b);
    if (c1 === c2) return;
    const key = c1 < c2 ? `${c1}|${c2}` : `${c2}|${c1}`;
    // The same stretch twice (a wall and a bridge across a gap): one wall.
    if (seen.has(key)) return;
    const w = { corner1: c1, corner2: c2 };
    seen.set(key, w);
    if (c.thickness) w.thickness = Math.round(c.thickness * 10) / 10;
    if (c.rail) w.rail = true;
    walls.push(w);
  });

  // Settled so the editor finds nothing to join, and straight walls set
  // true — settling once more after straightening, which can move a corner.
  settleGraph(corners, walls);
  for (let pass = 0; pass < 3; pass++) {
    straighten(corners, walls);
    settleGraph(corners, walls);
  }
  let loose = pruneLooseWalls(corners, walls);
  fitOpenings(corners, walls, doors, windows);
  if (forEditor) {
    const fittings = dropFittings(corners, walls, doors);
    if (fittings) loose += pruneLooseWalls(corners, walls) + fittings;
  }
  // A door found only as a gap (no symbol to say how it swings) is made the
  // kind its width allows: a wide one is a pair of leaves, a wider still is a
  // passage — a frame with no leaf, not one door with a swing across the room.
  if (bareGaps || doors.some((d) => d.fromNamedGap)) {
    doors.forEach((d) => {
      if (!bareGaps && !d.fromNamedGap) return;
      if (d.widthCm >= OPEN_PASSAGE_MIN_CM) d.open = "NO_DOORS";
      else if (d.widthCm >= DOUBLE_DOOR_MIN_CM) d.open = "BOTH_SIDES";
    });
  }
  // What each opening is — from its tag and the rooms either side — and what
  // had to be taken for a typical value, for the importer to check. Done on
  // the walls as drawn, before they are laid as the editor builds them.
  const checks = [];
  if (bareGaps) {
    const labels = [];
    doc.texts.forEach((t) => {
      if (role(t.layer) !== "name" || !t.text || isMeasure(t.text)) return;
      const cut = t.text.search(SIZE_START);
      const name = (cut > 0 ? t.text.slice(0, cut) : t.text).trim();
      if (name && ROOM_WORDS.test(name) && !/entr|exit|\bmain\b/i.test(name)) labels.push({ name, p: toPlan(t.p) });
    });
    checks.push(...describeOpenings(corners, walls, doors, windows, labels));
    // Annotations the editor has no element for.
    const drops = doc.texts.filter((t) => /^drop$/i.test(String(t.text || "").trim())).length;
    if (drops) {
      checks.push(`${drops} "Drop" note${drops > 1 ? "s" : ""} (dropped ceiling) found: not built in 3D. Check where on the original drawing.`);
    }
  }
  // Last: the walls as the editor builds them, so rooms, areas and the 3D come
  // out as the drawing is. (Not when only comparing candidates — which layer
  // makes the cleanest walls — which must see the thicknesses as drawn.)
  const eased = forEditor ? engineTrue(corners, walls, [...doors, ...windows]) : 0;
  if (forEditor) healLooseEnds(corners, walls);
  if (eased) {
    checks.push(
      `${eased} wall piece${eased > 1 ? "s" : ""} change${eased > 1 ? "" : "s"} thickness along a straight wall (an outer wall carrying on as a partition). To keep it straight, the wall is laid on one line, so a piece is a few cm off the drawing. Check it.`
    );
  }

  // ── room names ──
  // A room's label often carries its size ("BEDROOM 02 11'-2½" x 10'-10½"");
  // the name is what comes before it — and a label WITH a size is a room's,
  // where one without may be a fitting's ("WARDROBE"), so it ranks first.
  const names = [];
  doc.texts.forEach((t) => {
    if (role(t.layer) !== "name" || !t.text || isMeasure(t.text)) return;
    const cut = t.text.search(SIZE_START);
    const name = (cut > 0 ? t.text.slice(0, cut) : t.text).replace(/[\s,:;–-]+$/, "").trim();
    if (!name || isMeasure(name)) return;
    const p = toPlan(t.p);
    names.push({
      name,
      cxCm: p[0],
      cyCm: p[1],
      rank:
        (cut > 0 ? 2 * ROOM_LABEL_RANK : 0) +
        (ROOM_WORDS.test(name) ? ROOM_LABEL_RANK : 0) +
        t.h * k,
    });
  });

  const curvedWalls = doc.arcs.filter((a) => role(a.layer) === "wall").length;
  const planB = boundsOf(Object.values(corners).map((c) => [c.x, c.y]));

  return {
    // The columns ride with the floorplan, as boxes of their own — only when
    // the plan has any, so every other import is as it was.
    floorplan: { units: "cm", corners, walls, rooms: {}, ...(columns.length ? { columns } : {}) },
    doors,
    windows,
    // What was taken for a typical value, or not built, for the importer to check.
    checks,
    names,
    centres,
    toPlan,
    // The same mapping as plain numbers, for a copy sent between threads:
    // plan = [(x − minX) · k, (maxY − y) · k].
    frame: { minX: b.minX, maxY: b.maxY, k },
    counts: {
      walls: walls.length,
      paired: pairedCount,
      singles,
      doors: doors.length,
      windows: windows.length,
      names: names.length,
      columns: columns.length,
      curvedWalls,
      loose,
    },
    sizeCm: { w: planB.maxX - planB.minX, h: planB.maxY - planB.minY },
  };
};
