/**
 * Auto-furnish — the placement engine (kitchen, straight run).
 *
 * Plain geometry, no 3D engine and no React: it takes a DESCRIPTION of a room
 * (walls + the doors and windows on them) and a list of the cabinet widths the
 * catalogue actually has, and returns where each module goes. That keeps it
 * testable on its own, and means the same maths draws the preview and places
 * the real cabinets — so the preview cannot disagree with the result.
 *
 * Everything here is in CENTIMETRES (the engine's own unit), except the module
 * widths, which stay in MILLIMETRES because that is how the catalogue stores
 * them (Model.dimensions = [height, width, depth] in mm).
 *
 * The rules (agreed with the studio):
 *   • base units stand on the floor and are 850 tall — the worktop is the
 *     25 mm slab already modelled on top of each unit, so nothing is added;
 *   • wall units hang with their BOTTOM 600 mm above the worktop → 1450 mm;
 *   • the sink is centred on a window when the wall has one;
 *   • the tall unit goes at the end furthest from the door;
 *   • a leftover gap of 150–300 mm is filled with an oil pull-out; anything
 *     smaller is left empty rather than squeezing a cabinet in.
 */

export const KITCHEN_DEFAULTS = {
  worktopTopMm: 850, // floor → top of the worktop (the unit includes it)
  wallUnitGapMm: 600, // worktop → bottom of the wall units
  minRunMm: 1500, // a wall shorter than this can't hold a kitchen
  doorClearanceMm: 100, // keep cabinets this far from a door opening
  windowMarginMm: 50, // wall units keep this clear of a window
  fillerMinMm: 150, // smallest gap worth an oil pull-out
  fillerMaxMm: 300,
};

const mm = (cm) => cm * 10;
const cm = (millimetres) => millimetres / 10;

/** Distance from a to b. */
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * A room as this engine understands it. `walls` are the INSIDE faces, going
 * round the room; each carries the openings that sit in it.
 *
 * {
 *   walls: [{
 *     a: {x, y}, b: {x, y},        // inside face, cm (y is the world Z)
 *     normal: {x, y},              // unit vector pointing INTO the room
 *     lengthCm,
 *     openings: [{ kind: "door"|"window", startCm, endCm, sillCm, headCm }]
 *   }],
 *   centre: {x, y}
 * }
 */

/** The free stretches of a wall: its length minus doors (plus clearance). */
export function freeSpans(wall, opts = KITCHEN_DEFAULTS) {
  const clearance = cm(opts.doorClearanceMm);
  const blocked = (wall.openings || [])
    .filter((o) => o.kind === "door")
    .map((o) => [o.startCm - clearance, o.endCm + clearance])
    .sort((p, q) => p[0] - q[0]);
  const spans = [];
  let cursor = 0;
  for (const [from, to] of blocked) {
    if (from > cursor) spans.push([cursor, Math.min(from, wall.lengthCm)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < wall.lengthCm) spans.push([cursor, wall.lengthCm]);
  return spans.filter(([from, to]) => to - from > 0);
}

/** The wall to put the kitchen on: the one with the longest free stretch. */
export function chooseRunWall(room, opts = KITCHEN_DEFAULTS) {
  let best = null;
  (room.walls || []).forEach((wall, index) => {
    for (const [from, to] of freeSpans(wall, opts)) {
      const length = to - from;
      if (length < cm(opts.minRunMm)) continue;
      if (!best || length > best.lengthCm) {
        best = { wallIndex: index, wall, fromCm: from, toCm: to, lengthCm: length };
      }
    }
  });
  return best;
}

/**
 * Which walls a layout needs, and what the picker must check.
 *   straight — one wall
 *   l        — two walls that MEET at a corner
 *   u        — three walls in a row (two corners)
 *   parallel — two walls FACING each other (no corner)
 */
export const LAYOUTS = {
  straight: { id: "straight", name: "Straight", walls: 1, corners: 0 },
  l: { id: "l", name: "L-shape", walls: 2, corners: 1 },
  u: { id: "u", name: "U-shape", walls: 3, corners: 2 },
  parallel: { id: "parallel", name: "Parallel", walls: 2, corners: 0 },
};

const near = (p, q, tol = 2) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;

/** Do these two walls share an end? Returns which ends, or null. */
export function wallsMeet(w1, w2, tol = 2) {
  if (near(w1.b, w2.a, tol)) return { firstEnd: "b", secondEnd: "a" };
  if (near(w1.b, w2.b, tol)) return { firstEnd: "b", secondEnd: "b" };
  if (near(w1.a, w2.a, tol)) return { firstEnd: "a", secondEnd: "a" };
  if (near(w1.a, w2.b, tol)) return { firstEnd: "a", secondEnd: "b" };
  return null;
}

/** Roughly facing each other (parallel, normals opposed)? */
export function wallsFace(w1, w2) {
  const dot = w1.normal.x * w2.normal.x + w1.normal.y * w2.normal.y;
  return dot < -0.8;
}

/**
 * Put walls into an order where each one joins the next, or null if they can't
 * make a connected run.
 *
 * The planner needs a chain — it puts a corner unit between each consecutive
 * pair — but there is no reason to make somebody CLICK them in that order. For
 * a U the natural thing is to click the long wall first and then the two
 * returns, which is not a chain as clicked (the two returns don't touch) even
 * though the three walls plainly form one. Sorting here lets the picking be
 * free and keeps the planner's requirement intact.
 *
 * Brute force: at most three walls, so at most six orders to try.
 */
export function chainOrder(room, indexes) {
  const list = (indexes || []).filter((i) => room.walls[i]);
  if (list.length !== (indexes || []).length) return null;
  if (list.length < 2) return list.slice();
  let found = null;
  const walk = (rest, acc) => {
    if (found) return;
    if (!rest.length) {
      found = acc;
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest[i];
      if (acc.length && !wallsMeet(room.walls[acc[acc.length - 1]], room.walls[next])) {
        continue;
      }
      walk(
        rest.filter((_, j) => j !== i),
        acc.concat([next])
      );
      if (found) return;
    }
  };
  walk(list, []);
  return found;
}

/**
 * Can this wall be added to the picked ones for this layout?
 * Returns null when it can, or a plain reason why not.
 */
export function pickProblem(room, layout, pickedIndexes, candidateIndex) {
  const spec = LAYOUTS[layout];
  if (!spec) return "unknown layout";
  if (pickedIndexes.includes(candidateIndex)) return null; // clicking it again unpicks
  if (pickedIndexes.length >= spec.walls) return `${spec.name} uses ${spec.walls} wall(s)`;
  const candidate = room.walls[candidateIndex];
  if (!candidate) return "no such wall";
  if (!pickedIndexes.length) return null;
  const last = room.walls[pickedIndexes[pickedIndexes.length - 1]];
  if (layout === "l" || layout === "u") {
    // Ask whether the walls picked SO FAR PLUS this one can make a connected
    // run, in any order — not whether this one happens to join the one clicked
    // last. Insisting on the latter meant a U had to be clicked end-to-end:
    // pick the long wall and then a return, and the second return was refused
    // even though the three walls form a perfectly good U.
    return chainOrder(room, pickedIndexes.concat([candidateIndex]))
      ? null
      : "that wall doesn't join the ones you picked";
  }
  if (layout === "parallel") {
    return wallsFace(last, candidate) ? null : "not facing wall 1";
  }
  return null;
}

/** The widest module that fits, from a list of widths (mm), or null. */
const widestThatFits = (widthsMm, spaceCm) => {
  const fitting = (widthsMm || []).filter((w) => cm(w) <= spaceCm + 0.01);
  return fitting.length ? Math.max(...fitting) : null;
};

/** The width closest to a wish, from what the catalogue has. */
const closestWidth = (widthsMm, wishMm) => {
  if (!widthsMm || !widthsMm.length) return null;
  return widthsMm.reduce((best, w) =>
    Math.abs(w - wishMm) < Math.abs(best - wishMm) ? w : best
  );
};

/**
 * Lay out one straight run.
 *
 * `widths` is what the catalogue can supply, in mm:
 *   { tall: [], sink: [], drawer: [], shutter: [], pullout: [], wallUnit: [] }
 *
 * Returns { wallIndex, runFromCm, runToCm, slots: [...] }, each slot:
 *   { kind, widthMm, startCm, endCm, centreCm, level: "floor"|"wall" }
 * where the Cm values are measured ALONG the wall from its start corner.
 */
export function planStraightRun(room, widths, options = {}) {
  const opts = { ...KITCHEN_DEFAULTS, ...options };
  const run = chooseRunWall(room, opts);
  if (!run) return { wallIndex: -1, slots: [], reason: "no wall long enough" };

  const { wall, fromCm, toCm } = run;
  const windows = (wall.openings || []).filter((o) => o.kind === "window");
  const doors = (wall.openings || []).filter((o) => o.kind === "door");
  const slots = [];

  // 1. The tall unit, at the end furthest from a door.
  const tallWidth = widestThatFits(widths.tall, toCm - fromCm);
  let left = fromCm;
  let right = toCm;
  if (tallWidth) {
    const doorCentre = doors.length
      ? (doors[0].startCm + doors[0].endCm) / 2
      : fromCm; // no door → put it at the far end from the run's start
    const atEnd = Math.abs(toCm - doorCentre) >= Math.abs(doorCentre - fromCm);
    if (atEnd) {
      slots.push({ kind: "tall", widthMm: tallWidth, startCm: toCm - cm(tallWidth), endCm: toCm, level: "floor" });
      right = toCm - cm(tallWidth);
    } else {
      slots.push({ kind: "tall", widthMm: tallWidth, startCm: fromCm, endCm: fromCm + cm(tallWidth), level: "floor" });
      left = fromCm + cm(tallWidth);
    }
  }

  // 2. The sink: under the window if there is one, else in the middle.
  const sinkWish = windows.length
    ? cm(closestWidth(widths.sink, mm(windows[0].endCm - windows[0].startCm)) || 0)
    : 0;
  const sinkWidthMm =
    widestThatFits(widths.sink, right - left) &&
    (windows.length
      ? closestWidth(
          (widths.sink || []).filter((w) => cm(w) <= right - left),
          mm(sinkWish || (windows[0].endCm - windows[0].startCm))
        )
      : widestThatFits(widths.sink, right - left));
  let sink = null;
  if (sinkWidthMm) {
    const wanted = windows.length
      ? (windows[0].startCm + windows[0].endCm) / 2
      : (left + right) / 2;
    let start = wanted - cm(sinkWidthMm) / 2;
    start = Math.max(left, Math.min(start, right - cm(sinkWidthMm)));
    sink = { kind: "sink", widthMm: sinkWidthMm, startCm: start, endCm: start + cm(sinkWidthMm), level: "floor" };
    slots.push(sink);
  }

  // 3. Fill both sides of the sink: a drawer unit next to it, then shutters,
  //    then an oil pull-out in a small leftover.
  const fill = (fromEdge, toEdge, drawerFirst) => {
    let space = toEdge - fromEdge;
    let cursor = fromEdge;
    let first = drawerFirst;
    while (space >= cm(opts.fillerMinMm)) {
      const list = first && widths.drawer && widths.drawer.length ? widths.drawer : widths.shutter;
      let widthMm = widestThatFits(list, space);
      let kind = first && list === widths.drawer ? "drawer" : "shutter";
      if (!widthMm) {
        // Nothing normal fits — try a pull-out for the leftover.
        widthMm = widestThatFits(widths.pullout, space);
        kind = "pullout";
        if (!widthMm || cm(widthMm) > cm(opts.fillerMaxMm)) break;
      }
      slots.push({ kind, widthMm, startCm: cursor, endCm: cursor + cm(widthMm), level: "floor" });
      cursor += cm(widthMm);
      space = toEdge - cursor;
      first = false;
    }
  };
  if (sink) {
    fill(sink.endCm, right, true); // towards the far end
    // Left of the sink, filled from the sink outwards so any gap is at the end.
    const before = [];
    let space = sink.startCm - left;
    let cursor = sink.startCm;
    let first = true;
    while (space >= cm(opts.fillerMinMm)) {
      const list = first && widths.drawer && widths.drawer.length ? widths.drawer : widths.shutter;
      let widthMm = widestThatFits(list, space);
      let kind = first && list === widths.drawer ? "drawer" : "shutter";
      if (!widthMm) {
        widthMm = widestThatFits(widths.pullout, space);
        kind = "pullout";
        if (!widthMm || cm(widthMm) > cm(opts.fillerMaxMm)) break;
      }
      before.push({ kind, widthMm, startCm: cursor - cm(widthMm), endCm: cursor, level: "floor" });
      cursor -= cm(widthMm);
      space = cursor - left;
      first = false;
    }
    slots.push(...before);
  } else {
    fill(left, right, true);
  }

  // 4. Wall units above, skipping windows and the tall unit.
  const tall = slots.find((s) => s.kind === "tall");
  const margin = cm(opts.windowMarginMm);
  const keepOut = [
    ...windows.map((w) => [w.startCm - margin, w.endCm + margin]),
    ...(tall ? [[tall.startCm, tall.endCm]] : []),
    ...doors.map((d) => [d.startCm, d.endCm]),
  ].sort((p, q) => p[0] - q[0]);
  let cursor = fromCm;
  const stretches = [];
  for (const [from, to] of keepOut) {
    if (from > cursor) stretches.push([cursor, Math.min(from, toCm)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < toCm) stretches.push([cursor, toCm]);
  for (const [from, to] of stretches) {
    let at = from;
    let space = to - at;
    while (true) {
      const widthMm = widestThatFits(widths.wallUnit, space);
      if (!widthMm) break;
      slots.push({ kind: "wallUnit", widthMm, startCm: at, endCm: at + cm(widthMm), level: "wall" });
      at += cm(widthMm);
      space = to - at;
    }
  }

  slots.forEach((s) => {
    s.centreCm = (s.startCm + s.endCm) / 2;
  });
  slots.sort((a, b) => a.centreCm - b.centreCm);
  return { wallIndex: run.wallIndex, runFromCm: fromCm, runToCm: toCm, slots };
}

/**
 * Fill ONE stretch of wall with base units.
 *
 * `job` says what this stretch must contain:
 *   { sink: true|false, window: {startCm,endCm}|null, tall: "start"|"end"|null }
 * Anything not asked for is just drawers and shutter units, with an oil
 * pull-out for a leftover of 150–300 mm.
 */
export function fillRun(span, widths, job = {}, options = {}) {
  const opts = { ...KITCHEN_DEFAULTS, ...options };
  let [left, right] = span;
  const slots = [];

  if (job.tall) {
    const tallWidth = widestThatFits(widths.tall, right - left);
    if (tallWidth) {
      if (job.tall === "end") {
        slots.push({ kind: "tall", widthMm: tallWidth, startCm: right - cm(tallWidth), endCm: right, level: "floor" });
        right -= cm(tallWidth);
      } else {
        slots.push({ kind: "tall", widthMm: tallWidth, startCm: left, endCm: left + cm(tallWidth), level: "floor" });
        left += cm(tallWidth);
      }
    }
  }

  let sink = null;
  if (job.sink) {
    const widthMm = job.window
      ? closestWidth(
          (widths.sink || []).filter((w) => cm(w) <= right - left),
          mm(job.window.endCm - job.window.startCm)
        )
      : widestThatFits(widths.sink, right - left);
    if (widthMm) {
      const wanted = job.window
        ? (job.window.startCm + job.window.endCm) / 2
        : (left + right) / 2;
      let start = Math.max(left, Math.min(wanted - cm(widthMm) / 2, right - cm(widthMm)));
      sink = { kind: "sink", widthMm, startCm: start, endCm: start + cm(widthMm), level: "floor" };
      slots.push(sink);
    }
  }

  // Fill outwards from the sink (or across the whole stretch when there is
  // none): a drawer unit first, then shutters, then a pull-out for the rest.
  const run = (fromEdge, toEdge, forwards) => {
    let cursor = forwards ? fromEdge : toEdge;
    let space = toEdge - fromEdge;
    let first = true;
    while (space >= cm(opts.fillerMinMm)) {
      const list = first && widths.drawer && widths.drawer.length ? widths.drawer : widths.shutter;
      let widthMm = widestThatFits(list, space);
      let kind = first && list === widths.drawer ? "drawer" : "shutter";
      if (!widthMm) {
        widthMm = widestThatFits(widths.pullout, space);
        kind = "pullout";
        if (!widthMm || cm(widthMm) > cm(opts.fillerMaxMm)) break;
      }
      const startCm = forwards ? cursor : cursor - cm(widthMm);
      slots.push({ kind, widthMm, startCm, endCm: startCm + cm(widthMm), level: "floor" });
      cursor = forwards ? cursor + cm(widthMm) : cursor - cm(widthMm);
      space = forwards ? toEdge - cursor : cursor - fromEdge;
      first = false;
    }
  };
  if (sink) {
    run(sink.endCm, right, true);
    run(left, sink.startCm, false);
  } else {
    run(left, right, true);
  }
  return slots;
}

/** Wall units for one stretch, skipping windows, doors and the tall unit. */
export function fillWallUnits(span, wall, widths, baseSlots, options = {}) {
  const opts = { ...KITCHEN_DEFAULTS, ...options };
  const margin = cm(opts.windowMarginMm);
  const keepOut = [
    ...(wall.openings || []).map((o) =>
      o.kind === "window" ? [o.startCm - margin, o.endCm + margin] : [o.startCm, o.endCm]
    ),
    ...baseSlots.filter((s) => s.kind === "tall").map((s) => [s.startCm, s.endCm]),
  ].sort((p, q) => p[0] - q[0]);
  const slots = [];
  let cursor = span[0];
  const stretches = [];
  for (const [from, to] of keepOut) {
    if (from > cursor) stretches.push([cursor, Math.min(from, span[1])]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < span[1]) stretches.push([cursor, span[1]]);
  for (const [from, to] of stretches) {
    let at = from;
    while (true) {
      const widthMm = widestThatFits(widths.wallUnit, to - at);
      if (!widthMm) break;
      slots.push({ kind: "wallUnit", widthMm, startCm: at, endCm: at + cm(widthMm), level: "wall" });
      at += cm(widthMm);
    }
  }
  return slots;
}

/**
 * Plan a kitchen over the walls the user picked.
 *
 *   layout       "straight" | "l" | "u" | "parallel"
 *   wallIndexes  the walls, in the order they were clicked
 *
 * L and U get a corner unit at each join; both runs give up the corner's width
 * so nothing is placed twice. The sink goes on the wall that has a window (the
 * first one that does, else the first wall), and the tall unit at the far end
 * of the last run.
 */
export function planLayout(room, widths, layout = "straight", wallIndexes = [], options = {}) {
  const opts = { ...KITCHEN_DEFAULTS, ...options };
  const spec = LAYOUTS[layout];
  if (!spec) return { slots: [], reason: "unknown layout" };
  const clicked = wallIndexes.filter((i) => room.walls[i]);
  if (clicked.length !== spec.walls) {
    return { slots: [], reason: `pick ${spec.walls} wall(s)` };
  }
  // Walk the walls in the order the RUN follows, whatever order they were
  // clicked in: the corner units below go between consecutive runs, so a U
  // clicked as back-left-right has to become left-back-right first. Layouts
  // with no corners (straight, parallel) keep the order as clicked.
  const picked = (spec.corners > 0 && chainOrder(room, clicked)) || clicked;

  // The usable stretch of each wall (longest gap between doors).
  const runs = picked.map((index) => {
    const wall = room.walls[index];
    const spans = freeSpans(wall, opts);
    const best = spans.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0] || [0, wall.lengthCm];
    return { wallIndex: index, wall, span: [best[0], best[1]] };
  });

  // Corner units where consecutive runs meet (L and U only).
  const slots = [];
  const cornerWidths = widths.corner && widths.corner.length ? widths.corner : [];
  if (spec.corners > 0) {
    for (let i = 0; i + 1 < runs.length; i++) {
      const a = runs[i];
      const b = runs[i + 1];
      const meet = wallsMeet(a.wall, b.wall);
      if (!meet) continue;
      const widthMm =
        widestThatFits(cornerWidths, Math.min(a.span[1] - a.span[0], b.span[1] - b.span[0])) ||
        null;
      if (!widthMm) continue;
      const size = cm(widthMm);
      // The corner sits at the shared end of each wall; that end gives up the
      // corner's width, and only ONE corner cabinet is actually placed.
      // A corner unit belongs to BOTH walls, not just the one it is measured
      // along: which way it has to face depends on the pair. Carry the second
      // wall so whoever places it can work that out.
      const cornerWalls = [a.wallIndex, b.wallIndex];
      if (meet.firstEnd === "b") {
        slots.push({
          kind: "corner", widthMm, level: "floor", wallIndex: a.wallIndex, cornerWalls,
          startCm: a.span[1] - size, endCm: a.span[1],
        });
        a.span[1] -= size;
      } else {
        slots.push({
          kind: "corner", widthMm, level: "floor", wallIndex: a.wallIndex, cornerWalls,
          startCm: a.span[0], endCm: a.span[0] + size,
        });
        a.span[0] += size;
      }
      if (meet.secondEnd === "a") b.span[0] += size;
      else b.span[1] -= size;
    }
  }

  // Which run gets the sink: the first with a window, else the first run.
  const windowOf = (run) => (run.wall.openings || []).find((o) => o.kind === "window") || null;
  const sinkRun = runs.find((r) => windowOf(r)) || runs[0];
  const lastRun = runs[runs.length - 1];

  runs.forEach((run) => {
    const isSink = run === sinkRun;
    const job = {
      sink: isSink,
      window: isSink ? windowOf(run) : null,
      // The tall unit goes at the far end of the last run — the end away from
      // the previous run, so it never lands in a corner.
      tall: run === lastRun ? (runs.length > 1 ? "end" : "end") : null,
    };
    const base = fillRun(run.span, widths, job, opts);
    const above = fillWallUnits(run.span, run.wall, widths, base, opts);
    [...base, ...above].forEach((s) => {
      s.wallIndex = run.wallIndex;
      s.centreCm = (s.startCm + s.endCm) / 2;
      slots.push(s);
    });
  });

  slots.forEach((s) => {
    if (s.centreCm === undefined) s.centreCm = (s.startCm + s.endCm) / 2;
  });
  return { layout, runs: runs.map((r) => ({ wallIndex: r.wallIndex, span: r.span })), slots };
}

/**
 * Turn a slot into where the module actually stands: a point in the room (cm)
 * and the height of its centre. The back goes against the wall, so the point
 * sits half the module's depth in from the wall face.
 */
export function slotPlacement(room, plan, slot, sizeMm, options = {}) {
  const opts = { ...KITCHEN_DEFAULTS, ...options };
  const wall = room.walls[slot.wallIndex !== undefined ? slot.wallIndex : plan.wallIndex];
  const ux = (wall.b.x - wall.a.x) / wall.lengthCm;
  const uy = (wall.b.y - wall.a.y) / wall.lengthCm;
  const depthCm = cm(sizeMm.depthMm || 0);
  const heightCm = cm(sizeMm.heightMm || 0);
  const alongX = wall.a.x + ux * slot.centreCm;
  const alongY = wall.a.y + uy * slot.centreCm;
  const inset = depthCm / 2;
  const point = {
    x: alongX + wall.normal.x * inset,
    y: alongY + wall.normal.y * inset,
  };
  // Floor units stand on the floor; wall units hang above the worktop.
  const bottomCm =
    slot.level === "wall" ? cm(opts.worktopTopMm + opts.wallUnitGapMm) : 0;
  return {
    point, // x, y(=world z) in cm
    centreHeightCm: bottomCm + heightCm / 2,
    bottomCm,
    // Facing: the module looks into the room, i.e. along the wall's normal.
    facing: { x: wall.normal.x, y: wall.normal.y },
  };
}
