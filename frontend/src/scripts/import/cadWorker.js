import {
  FIXTURE_ROOMS,
  analyzeDxf,
  autoPlan,
  findDrawings,
  guessUnit,
  layersOf,
  hasDrawnOpenings,
  parseDxf,
  planSizeMetres,
} from "../model/dxfImport";
import { xpsLines } from "./xpsLines";
import { detectScale } from "./scaleDetect";
import { scaleFromLabels } from "./roomScale";
import { SHEET_BORDER } from "./sheetBorder";
import { pickWallLayer } from "./wallPick";

/**
 * THE IMPORT WORKER — reading a drawing off the page's own thread.
 *
 * A CAD file can hold hundreds of thousands of lines; reading it, finding its
 * drawings and building walls from it takes seconds, and done on the page
 * would freeze it. Here it runs beside the page, which keeps responding.
 *
 * One drawing is held at a time. Messages (each answered with the same id):
 *
 *   { type: "dxf", file | buffer }    a DXF file, or a DWG converted to DXF
 *   { type: "xps", xml }              a DWFx sheet (one FixedPage)
 *   { type: "lines", segs, texts }    lines already read (a PDF page)
 *     → { summary }  the drawing's layers, units, drawings and lines to show
 *
 *   { type: "analyze", roles, unit, region }
 *     → { analysis } its walls, doors, windows and room names (dxfImport)
 */

let doc = null;
// Lines drawn on the preview, per layer, at most — beyond, the rest are left
// out of the preview (never out of the import).
const MAX_PREVIEW_LINES = 600000;

const boundsOf = (segs) => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  segs.forEach((s) => {
    for (const p of [s.a, s.b]) {
      if (p[0] < b.minX) b.minX = p[0];
      if (p[1] < b.minY) b.minY = p[1];
      if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] > b.maxY) b.maxY = p[1];
    }
  });
  return Number.isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
};

/** Each layer's lines (segments and arcs) as flat [x1, y1, x2, y2, …] arrays. */
const linesByLayer = (d) => {
  const map = new Map();
  let total = 0;
  const push = (layer, a, b) => {
    if (total >= MAX_PREVIEW_LINES) return;
    if (!map.has(layer)) map.set(layer, []);
    map.get(layer).push(a[0], a[1], b[0], b[1]);
    total += 1;
  };
  d.segs.forEach((s) => push(s.layer, s.a, s.b));
  (d.arcs || []).forEach((ar) => {
    for (let i = 0; i + 1 < ar.pts.length; i++) push(ar.layer, ar.pts[i], ar.pts[i + 1]);
  });
  const out = {};
  map.forEach((arr, layer) => (out[layer] = new Float64Array(arr)));
  return { lines: out, total };
};

/**
 * What the preview shows of the drawing: its layers (with a guess at each
 * one's role), its unit, the separate drawings in it (the floor plan first),
 * and every layer's lines.
 */
const summarise = (withUnits) => {
  const layers = layersOf(doc);
  let roles = Object.fromEntries(layers.map((l) => [l.name, l.role]));
  let unit = null;
  let drawings = [];
  // No layer is named for walls (a drawing with no layers, or a plot flattened
  // to one): which layer holds them is found once the scale is known.
  let autoWalls = false;

  if (withUnits) {
    // A CAD file: everything decided from the file, as a first suggestion.
    const plan = autoPlan(doc);
    if (plan) {
      roles = plan.roles;
      unit = plan.unit;
      drawings = plan.ranked.map((r) => ({
        region: r.region,
        size: r.size,
        counts: r.analysis.counts,
        plausible: r.plausible,
      }));
    } else {
      unit = guessUnit(doc, roles);
      drawings = findDrawings(doc, roles, unit).map((region) => ({
        region,
        size: planSizeMetres(doc, roles, unit, region),
        counts: null,
        plausible: true,
      }));
    }
  } else if (!Object.values(roles).includes("wall") && layers.length) {
    // Lines with no unit and no layer named for walls (a PDF, a DWFx): the
    // layer with the most lines is the likeliest walls, until the scale is
    // known and each can be tried (pickWalls). The sheet's frame never is.
    autoWalls = true;
    const most = layers
      .filter((l) => l.name !== SHEET_BORDER)
      .sort((a, b) => b.lines - a.lines)[0];
    if (most) roles = { ...roles, [most.name]: "wall" };
  }
  const { lines, total } = linesByLayer(doc);
  return {
    summary: {
      layers: layers.map((l) => ({ ...l, role: roles[l.name] || "ignore" })),
      unit,
      unitFromFile: doc.unitFromFile || null,
      drawings,
      autoWalls,
      bounds: boundsOf(doc.segs.length ? doc.segs : [{ a: [0, 0], b: [1, 1] }]),
      lines,
      previewTotal: total,
      lineCount: doc.segs.length + (doc.arcs || []).length,
      truncated: !!doc.truncated,
    },
    transfer: Object.values(lines).map((a) => a.buffer),
  };
};

/** A point's cell, so hints close together count as one place. */
const HINT_CELL_CM = 40;

/**
 * Where the fittings that name a room are: [{ name, cxCm, cyCm, weight }] in
 * plan centimetres — one per spot, weighted by how many lines are there.
 * Layers are matched by name (FIXTURE_ROOMS); a layer kept as the walls,
 * doors or windows is never a fitting.
 */
const roomHints = (d, roles, toPlan, region) => {
  const kinds = new Map();
  const kindOf = (layer) => {
    if (!kinds.has(layer)) {
      const role = roles[layer];
      const n = String(layer).toLowerCase();
      const hit = role === "wall" || role === "door" || role === "window" ? null : FIXTURE_ROOMS.find((f) => f.test.test(n));
      kinds.set(layer, hit ? hit.name : null);
    }
    return kinds.get(layer);
  };
  const inRegion = (p) =>
    !region || (p[0] >= region.minX && p[0] <= region.maxX && p[1] >= region.minY && p[1] <= region.maxY);
  const spots = new Map();
  const add = (name, p) => {
    if (!inRegion(p)) return;
    const q = toPlan(p);
    const key = `${name}|${Math.round(q[0] / HINT_CELL_CM)}|${Math.round(q[1] / HINT_CELL_CM)}`;
    const cur = spots.get(key);
    if (cur) cur.weight += 1;
    else spots.set(key, { name, cxCm: q[0], cyCm: q[1], weight: 1 });
  };
  d.segs.forEach((s) => {
    const name = kindOf(s.layer);
    if (name) add(name, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]);
  });
  (d.arcs || []).forEach((ar) => {
    const name = kindOf(ar.layer);
    if (name) add(name, ar.c);
  });
  return [...spots.values()].slice(0, 4000);
};

const fromLines = (segs, texts, truncated) => ({
  segs,
  arcs: [],
  texts: texts || [],
  inserts: [],
  unitFromFile: null,
  truncated,
  // Lines read off a sheet, not a CAD file's entities: no symbol of its own to say what is a door.
  flat: true,
});

const handlers = {
  async dxf(msg) {
    const text = msg.file
      ? await msg.file.text()
      : new TextDecoder().decode(msg.buffer);
    doc = parseDxf(text);
    return summarise(true);
  },
  async xps(msg) {
    const r = xpsLines(msg.xml);
    if (!r.segs.length) {
      throw Object.assign(new Error("This sheet has no lines to import."), { userFacing: true });
    }
    doc = fromLines(r.segs, r.texts, r.truncated);
    const out = summarise(false);
    out.summary.page = { w: r.w, h: r.h };
    return out;
  },
  async lines(msg) {
    doc = fromLines(msg.segs, msg.texts, msg.truncated);
    const out = summarise(false);
    // What the page says about its own scale, when it prints a dimension.
    // A printed dimension first; failing that, the sizes written in the rooms' labels.
    let guess = msg.mmPerUnit ? detectScale(msg.segs, msg.texts, msg.mmPerUnit) : null;
    if (!guess && msg.mmPerUnit) {
      const rooms = scaleFromLabels(msg.segs, msg.texts || [], msg.mmPerUnit);
      if (rooms) {
        guess = {
          cmPerUnit: rooms.cmPerUnit,
          note: `${rooms.rooms} of the ${rooms.of} room sizes written on the plan`,
        };
      }
    }
    out.summary.scaleGuess = guess;
    return out;
  },
  /**
   * How big the plan is in the drawing's own units: the extent of the main
   * drawing's wall lines — the biggest group of them lying together, so a stray
   * detail or an elevation drawn elsewhere on the sheet does not count. Used to
   * set the scale from the plan's known overall width.
   */
  async extent(msg) {
    if (!doc) throw new Error("No drawing is open.");
    // Within the crop, when one is drawn: the plan, not the sheet around it.
    const r = msg.region;
    const within = (p) => !r || (p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY);
    const walls = doc.segs.filter((s) => msg.roles[s.layer] === "wall" && within(s.a) && within(s.b));
    if (!walls.length) {
      throw Object.assign(new Error("No layer is set as the walls. Choose which layer holds them first."), {
        userFacing: true,
      });
    }
    const all = boundsOf(walls);
    const span = Math.max(all.maxX - all.minX, all.maxY - all.minY);
    // Walls closer together than this belong to one drawing: an eighth of the
    // walls' own extent — a plan's walls break at every door and window, and
    // a drawing of something else on the sheet lies farther off than that.
    // `unit` (cm per unit) is chosen to make findDrawings' own two-metre gap
    // that size.
    const gapUnits = Math.max(span / 8, 1e-6);
    const groups = findDrawings(doc, msg.roles, 200 / gapUnits);
    const g = groups[0];
    const inside = g
      ? walls.filter((s) => s.a[0] >= g.minX && s.a[0] <= g.maxX && s.a[1] >= g.minY && s.a[1] <= g.maxY)
      : [];
    const b = boundsOf(inside.length ? inside : walls);
    return { extent: { w: b.maxX - b.minX, h: b.maxY - b.minY, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } };
  },
  /** Which layer holds the walls, at the scale now known (see wallPick.js). */
  async pickWalls(msg) {
    if (!doc) throw new Error("No drawing is open.");
    return { picked: pickWallLayer(doc, msg.unit, msg.region) };
  },
  async analyze(msg) {
    if (!doc) throw new Error("No drawing is open.");
    const region = msg.region || undefined;
    // A drawing with no door or window drawn in it (a flattened PDF, or a CAD
    // sheet whose door layers hold other drawings) has its openings as gaps in
    // the walls, named by tags (D2, W1) and by the rooms either side.
    const a = analyzeDxf(doc, {
      roles: msg.roles,
      unit: msg.unit,
      region,
      bareGaps: !hasDrawnOpenings(doc, msg.roles, region),
    });
    // The mapping is a function, which can't be sent; `frame` carries it.
    const { toPlan, centres, ...rest } = a;
    return { analysis: { ...rest, hints: roomHints(doc, msg.roles, toPlan, region) } };
  },
};

self.onmessage = async (e) => {
  const msg = e.data || {};
  const handler = handlers[msg.type];
  if (!handler) {
    self.postMessage({ id: msg.id, error: `Unknown request ${msg.type}` });
    return;
  }
  try {
    const { transfer, ...result } = await handler(msg);
    self.postMessage({ id: msg.id, ...result }, transfer || []);
  } catch (err) {
    self.postMessage({
      id: msg.id,
      error: (err && err.message) || String(err),
      userFacing: !!(err && err.userFacing),
    });
  }
};
