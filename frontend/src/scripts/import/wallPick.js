import { analyzeDxf, layersOf } from "../model/dxfImport";
import { SHEET_BORDER } from "./sheetBorder";

/**
 * WHICH LAYER HOLDS THE WALLS, in a drawing with none named for them (a plot
 * flattened to a sheet, a DWFx). Each layer in turn is tried as the walls, at
 * the scale now known, and the one that makes the cleanest walls is taken: the
 * walls of a plan come in a few thicknesses (a 9-inch wall, a 4½-inch
 * partition), where furniture, fixtures and lettering drawn as lines pair up
 * into "walls" of every thickness. A layer scores its wall length, counted for
 * the two thicknesses most of it is in, and squared for how much of it is.
 *
 * Self-contained apart from dxfImport, so it runs in the import worker and in
 * a plain Node test.
 */

/** At most this many layers are tried, none with more lines than this. */
const MAX_CANDIDATES = 14;
const MAX_CANDIDATE_LINES = 8000;
/** Wall thicknesses within this many centimetres count as one. */
const THICKNESS_BIN_CM = 2;

/**
 * @param {Object} doc    from parseDxf, or lines read from a PDF
 * @param {number|string} unit  the drawing's unit: an id, or centimetres per unit
 * @param {Object} [region]    only what lies in it (a crop)
 * @returns {{ layer: string, score: number, walls: number, share: number } | null}
 */
export const pickWallLayer = (doc, unit, region) => {
  const candidates = layersOf(doc)
    .filter((l) => l.name !== SHEET_BORDER && l.lines >= 8 && l.lines <= MAX_CANDIDATE_LINES)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, MAX_CANDIDATES);
  let best = null;
  candidates.forEach((l) => {
    // Walls as drawn, not as the editor will build them: what is compared is
    // how few thicknesses a layer's walls have.
    const a = analyzeDxf(doc, { roles: { [l.name]: "wall" }, unit, region: region || undefined, forEditor: false });
    const C = a.floorplan.corners;
    const bins = new Map();
    let total = 0;
    a.floorplan.walls.forEach((w) => {
      const p = C[w.corner1];
      const q = C[w.corner2];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const bin = Math.round(w.thickness / THICKNESS_BIN_CM);
      bins.set(bin, (bins.get(bin) || 0) + len);
      total += len;
    });
    if (!total) return;
    const top = [...bins.values()].sort((x, y) => y - x).slice(0, 2);
    const share = (top[0] + (top[1] || 0)) / total;
    const score = total * share * share;
    if (!best || score > best.score) best = { layer: l.name, score, walls: a.counts.walls, share };
  });
  return best;
};
