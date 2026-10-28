/**
 * THE SCALE A PLAN GIVES IN ITS ROOM LABELS.
 *
 * Plans often write each room's size under its name — "BEDROOM-1 (14'4" X
 * 10'6")", "KITCHEN 3500 x 4000". The label sits inside the room, so the
 * room's own walls can be measured: from the label, a line out in each
 * direction to the nearest wall face gives the room's width and depth on the
 * page. Width and depth against the written size give the scale — and each
 * room that agrees with the others makes it surer.
 *
 * Needs the walls (their lines), so it runs once they are known. Self-
 * contained, so it runs in the import worker and in a plain Node test.
 */

const FT_MM = 304.8;
const IN_MM = 25.4;
/** A room's width and depth must give the same scale to within this, or the label is skipped. */
const PAIR_TOLERANCE = 0.1;
/** Rooms that give the same scale to within this are agreeing. */
const AGREE = 0.04;
/** Longest and shortest a sheet's scale can be (mm of plan per mm on paper). */
const MIN_SCALE = 5;
const MAX_SCALE = 1000;
/** A room is at least this wide and deep (mm) — labels of anything smaller are a note, not a room. */
const MIN_ROOM_MM = 900;
const MAX_ROOM_MM = 15000;

const feetInches = (ft, inch) => Number(ft) * FT_MM + (inch ? Number(inch) : 0) * IN_MM;

/**
 * A room's written size, in millimetres: [first, second] — or null.
 * Feet and inches ((14'4" X 10'6"), (10'0" X 10'4"), (9'10"X 4'0")), or
 * millimetres (5585 x 3285, as drawn in a metric plan).
 */
export const parseRoomSize = (text) => {
  const t = String(text || "").replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  const imperial = t.match(/(\d+)\s*'\s*-?\s*(\d+)?\s*(?:\d+\/\d+)?\s*"?\s*[xX×]\s*(\d+)\s*'\s*-?\s*(\d+)?\s*(?:\d+\/\d+)?\s*"?/);
  if (imperial) return [feetInches(imperial[1], imperial[2]), feetInches(imperial[3], imperial[4])];
  const metric = t.match(/\b(\d{3,5})\s*[xX×]\s*(\d{3,5})\b/);
  if (metric) return [Number(metric[1]), Number(metric[2])];
  return null;
};

/** The nearest crossings of a line out of `p` along one axis, either side: [before, after] in page units, or null. */
const spanAt = (segs, p, axis) => {
  // axis 0: a line running along x, crossing segments at their x; axis 1: along y.
  const o = axis === 0 ? 1 : 0;
  let before = -Infinity;
  let after = Infinity;
  for (const s of segs) {
    const a = s.a;
    const b = s.b;
    const d = b[o] - a[o];
    if (Math.abs(d) < 1e-9) continue; // runs along the line itself
    const t = (p[o] - a[o]) / d;
    if (t < 0 || t > 1) continue;
    const x = a[axis] + t * (b[axis] - a[axis]);
    if (x <= p[axis] && x > before) before = x;
    else if (x > p[axis] && x < after) after = x;
  }
  return Number.isFinite(before) && Number.isFinite(after) ? [before, after] : null;
};

/**
 * @param {{ a: number[], b: number[] }[]} wallSegs  the walls' lines (page units)
 * @param {{ p: number[], text: string }[]} texts    the page's text, each at its centre
 * @param {number} mmPerUnit  one page unit on paper, in millimetres (the scale's own range check)
 * @returns {{ cmPerUnit: number, rooms: number, of: number } | null}
 */
export const scaleFromRoomSizes = (wallSegs, texts, mmPerUnit) => {
  const labels = texts
    .map((t) => ({ p: t.p, size: parseRoomSize(t.text) }))
    .filter((l) => l.size && l.size.every((v) => v >= MIN_ROOM_MM && v <= MAX_ROOM_MM));
  if (!labels.length || !wallSegs.length) return null;

  // Each label's room, measured across and down the page (a side left open — a
  // doorway, a balcony — is not a measure, and is left out).
  const measured = labels.map((l) => {
    const sx = spanAt(wallSegs, l.p, 0);
    const sy = spanAt(wallSegs, l.p, 1);
    return { size: l.size, w: sx ? sx[1] - sx[0] : 0, h: sy ? sy[1] - sy[0] : 0 };
  });

  // A frame round the whole sheet is "measured" by every label alike; a room is
  // only a room when its measure is its own. Rooms that measure alike count once.
  const keyOf = ({ w, h }) => `${Math.round(w * 4)}|${Math.round(h * 4)}`;
  const distinct = (rooms) => new Set(rooms.map(keyOf)).size;

  const estimates = []; // mm of plan per page unit, from rooms measured both ways
  const estimated = []; // the rooms they came from
  measured.forEach((room) => {
    const { size: [A, B], w, h } = room;
    if (!(w > 0 && h > 0)) return;
    // The size is written either way round: the pairing whose two scales agree.
    const options = [
      [A / w, B / h],
      [A / h, B / w],
    ]
      .filter(([s1, s2]) => Math.abs(s1 - s2) / ((s1 + s2) / 2) <= PAIR_TOLERANCE)
      .map(([s1, s2]) => (s1 + s2) / 2);
    if (options.length) {
      estimates.push(options[0]);
      estimated.push(room);
    }
  });
  const sane = estimates
    .map((s, i) => ({ s, room: estimated[i] }))
    .filter(({ s }) => s / mmPerUnit >= MIN_SCALE && s / mmPerUnit <= MAX_SCALE);
  if (sane.length < 2) return null; // one room alone is not enough to go on

  // The scale most rooms agree on.
  let best = [];
  sane.forEach(({ s }) => {
    const group = sane.filter((v) => Math.abs(v.s - s) / s <= AGREE);
    if (distinct(group.map((g) => g.room)) > distinct(best.map((g) => g.room))) best = group;
  });
  if (distinct(best.map((g) => g.room)) < 2) return null;
  const mm = best.reduce((a, v) => a + v.s, 0) / best.length;

  // The rooms that confirm it: one of the room's measures, across or down,
  // comes to one of its written sizes at this scale (a room open on one side,
  // or running into the next through a doorway, still has one that does).
  const near = (a, b) => Math.abs(a - b) / b <= AGREE;
  const confirming = measured.filter(({ size: [A, B], w, h }) =>
    [w, h].some((m) => m > 0 && (near(A / m, mm) || near(B / m, mm)))
  );
  const confirmed = distinct(confirming);
  // Most of the labelled rooms must bear it out, or it was a coincidence.
  if (confirmed < Math.max(2, Math.ceil(labels.length / 2))) return null;
  return { cmPerUnit: mm / 10, rooms: confirmed, of: labels.length };
};

/** Layers worth trying as the walls: neither a handful of lines nor a whole texture of them. */
const MIN_LINES = 8;
const MAX_LINES = 8000;
const MAX_LAYERS = 14;
/** Least rooms that must agree before a scale is trusted. */
const MIN_ROOMS = 2;

/**
 * The scale the room labels give, with no walls known yet: each layer is
 * tried as the walls and the one whose rooms agree best is taken — it is the
 * layer that closes the labelled rooms in. Needs no scale to do it.
 *
 * @param {{ layer: string, a: number[], b: number[] }[]} segs
 * @returns {{ cmPerUnit: number, rooms: number, of: number, layer: string } | null}
 */
export const scaleFromLabels = (segs, texts, mmPerUnit) => {
  if (!texts.some((t) => parseRoomSize(t.text))) return null;
  const byLayer = new Map();
  segs.forEach((s) => {
    if (s.layer === "Sheet border") return;
    if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
    byLayer.get(s.layer).push(s);
  });
  const candidates = [...byLayer.entries()]
    .filter(([, l]) => l.length >= MIN_LINES && l.length <= MAX_LINES)
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, MAX_LAYERS);
  let best = null;
  candidates.forEach(([layer, lines]) => {
    const g = scaleFromRoomSizes(lines, texts, mmPerUnit);
    if (!g || g.rooms < MIN_ROOMS) return;
    if (!best || g.rooms > best.rooms) best = { ...g, layer };
  });
  return best;
};
