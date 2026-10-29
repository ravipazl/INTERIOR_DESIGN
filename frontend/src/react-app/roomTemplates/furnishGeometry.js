/**
 * Geometry shared by the rooms' auto-furnish planners (bedroomEngine,
 * livingEngine): rectangles square to a wall, overlap and inside-the-room
 * tests, a wall's free stretches, the floor a door needs to swing, and the
 * seeded choices behind "Try another design".
 *
 * Centimetres throughout. A room is describeRoom()'s output: inside-face walls
 * in order round the room, each with `a`, `b`, `normal` (into the room),
 * `lengthCm` and its `openings` (doors and windows, measured along it).
 */

const cm = (millimetres) => millimetres / 10;

/** Unit vector along a wall, from a to b. */
export const along = (wall) => ({
  x: (wall.b.x - wall.a.x) / wall.lengthCm,
  y: (wall.b.y - wall.a.y) / wall.lengthCm,
});

/** A point `t` along the wall and `out` into the room. */
export const wallPoint = (wall, t, out) => {
  const u = along(wall);
  return {
    x: wall.a.x + u.x * t + wall.normal.x * out,
    y: wall.a.y + u.y * t + wall.normal.y * out,
  };
};

/** How far along `wall` a point lies (its foot on the wall line). */
export const alongOf = (wall, p) => {
  const u = along(wall);
  return (p.x - wall.a.x) * u.x + (p.y - wall.a.y) * u.y;
};

/**
 * A rectangle square to a wall: centred `t` along it and `out` from it, `w`
 * wide along the wall and `d` deep.
 */
export const wallRect = (wall, t, out, w, d) => ({
  c: wallPoint(wall, t, out),
  u: along(wall),
  n: wall.normal,
  hu: w / 2,
  hn: d / 2,
});

/** The four corners, in order round the rectangle (for drawing). */
export const rectCorners = (r) => {
  const pts = [];
  for (const su of [-1, 1])
    for (const sn of [-1, 1])
      pts.push({
        x: r.c.x + r.u.x * r.hu * su + r.n.x * r.hn * sn,
        y: r.c.y + r.u.y * r.hu * su + r.n.y * r.hn * sn,
      });
  return [pts[0], pts[2], pts[3], pts[1]];
};

/** Do two rectangles overlap (separating axis test), with a small allowance? */
export const overlaps = (r1, r2, slack = 0.5) => {
  const axes = [r1.u, r1.n, r2.u, r2.n];
  const c1 = rectCorners(r1);
  const c2 = rectCorners(r2);
  for (const ax of axes) {
    const p1 = c1.map((p) => p.x * ax.x + p.y * ax.y);
    const p2 = c2.map((p) => p.x * ax.x + p.y * ax.y);
    if (Math.max(...p1) <= Math.min(...p2) + slack || Math.max(...p2) <= Math.min(...p1) + slack) {
      return false;
    }
  }
  return true;
};

/** Ray-cast point-in-polygon. */
const pointIn = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/** Is the whole rectangle on the floor of the room? (corners pulled in 1 cm) */
export const insideRoom = (r, poly) =>
  rectCorners({ ...r, hu: Math.max(0, r.hu - 1), hn: Math.max(0, r.hn - 1) }).every((p) => pointIn(p, poly));

export const doorsOf = (wall) => (wall.openings || []).filter((o) => o.kind === "door");
export const windowsOf = (wall) => (wall.openings || []).filter((o) => o.kind === "window");

/** The stretches of a wall left once `blocked` [from,to] spans are taken out. */
export const stretches = (wall, blocked) => {
  const sorted = blocked
    .map(([f, t]) => [Math.max(0, f), Math.min(wall.lengthCm, t)])
    .filter(([f, t]) => t > f)
    .sort((p, q) => p[0] - q[0]);
  const out = [];
  let cursor = 0;
  for (const [f, t] of sorted) {
    if (f > cursor) out.push([cursor, f]);
    cursor = Math.max(cursor, t);
  }
  if (cursor < wall.lengthCm) out.push([cursor, wall.lengthCm]);
  return out.filter(([f, t]) => t - f > 1);
};

/** The longest of some [from, to] spans, or null. */
export const longest = (spans) =>
  spans.reduce((best, s) => (!best || s[1] - s[0] > best[1] - best[0] ? s : best), null);

/**
 * The floor each door needs to swing open, as a rectangle in front of it.
 * opts: { doorClearanceMm, doorSwingMinMm }
 */
export const doorZones = (room, opts) =>
  room.walls.flatMap((wall) =>
    doorsOf(wall).map((o) => {
      const clear = cm(opts.doorClearanceMm);
      const width = o.endCm - o.startCm;
      const swing = Math.max(cm(opts.doorSwingMinMm), width);
      return wallRect(wall, (o.startCm + o.endCm) / 2, swing / 2, width + 2 * clear, swing);
    })
  );

/** Do two walls roughly face each other? */
export const facingWalls = (w1, w2) => w1.normal.x * w2.normal.x + w1.normal.y * w2.normal.y < -0.8;

/** The model whose width is closest to `wishCm` (first on a tie). */
export function pickClosest(list, wishCm) {
  return (list || []).reduce(
    (best, m) => (!best || Math.abs(m.w - wishCm) < Math.abs(best.w - wishCm) ? m : best),
    null
  );
}

/** A small seeded random number generator: the same seed, the same numbers. */
export function mulberry32(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of `list` in a seeded random order. */
export function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * "Try another design": design 0 is the plain best answer; any other number is
 * a seed for choosing among the options that fit. Returns { vary, rand, pickOne }
 * where pickOne(list, fallback) is the fallback for design 0.
 */
export function designChooser(seedValue) {
  const seed = Math.max(0, Math.floor(Number(seedValue) || 0));
  const vary = seed > 0;
  const rand = mulberry32(seed);
  const pickOne = (list, fallback) =>
    vary && list && list.length ? list[Math.floor(rand() * list.length)] : fallback;
  return { seed, vary, rand, pickOne };
}
