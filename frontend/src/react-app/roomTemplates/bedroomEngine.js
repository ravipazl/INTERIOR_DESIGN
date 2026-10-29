/**
 * Auto-furnish — the placement engine for a BEDROOM.
 *
 * Plain geometry, like the kitchen's placementEngine: it takes a description
 * of the room (describeRoom) and the sizes the catalogue has, and returns where
 * each item goes. No 3D engine and no React, so the preview on the plan and
 * the real placing come from the same answer.
 *
 * Centimetres throughout (the engine's unit). Catalogue sizes come in as
 * { w, h, d } in cm: width along the wall, height, depth out from it.
 *
 * What goes where (agreed with the studio):
 *   • the COT's head against the bed wall — the one picked, else the longest
 *     wall with no door — centred, the largest cot that leaves a walkway on
 *     both sides and at its foot;
 *   • a SIDE TABLE each side of the head, a TABLE LAMP on each;
 *   • the WARDROBE on another wall, from a corner, never over a door, a window
 *     or the bed, with room in front to open it; as wide as the wall allows up
 *     to a limit, made of the catalogue's double units and a single to finish;
 *   • a MIRROR beside the wardrobe (or on another free wall), an AC on the wall
 *     facing the bed (not over the head), both hung by their top at 7 ft;
 *   • a CARPET at the foot of the bed, half under it;
 *   • a CEILING LIGHT in the middle of the room.
 * Every item is a real rectangle, checked against the room's walls, the
 * doors' swing and everything placed before it. An extra that does not fit is
 * left out and named, never squeezed in.
 */

export const BEDROOM_DEFAULTS = {
  walkwayMm: 600,
  footClearanceMm: 600,
  wardrobeFrontClearanceMm: 750,
  maxWardrobeMm: 2400,
  doorClearanceMm: 100,
  doorSwingMinMm: 900,
  windowMarginMm: 50,
  sideTableGapMm: 30,
  wallItemGapMm: 150,
};

import {
  along,
  wallPoint,
  wallRect,
  rectCorners,
  overlaps,
  insideRoom,
  doorsOf,
  windowsOf,
  stretches,
  doorZones,
  longest,
  pickClosest,
  mulberry32,
  shuffled,
} from "./furnishGeometry";

const cm = (millimetres) => millimetres / 10;

// Geometry shared with the other rooms (furnishGeometry.js).
export { wallPoint, rectCorners };

// ─── The plan ───────────────────────────────────────────────────────────────

/**
 * Plan a bedroom.
 *
 *   room       describeRoom() output
 *   catalogue  { kind: [{ id, name, w, h, d }] } in cm (see pickBedroomModules)
 *   choice     { bedWallIndex?: number, extras?: { sideTable, tableLamp,
 *                mirror, ac, carpet, light } (default on), seed?: number
 *                (0 = the plain best design, any other = another design),
 *                wardrobeStyle?: "basic" | "fluted" }
 *
 * Returns { bedWallIndex, slots, skipped, reason? }. Each slot:
 *   { kind, label, model, level: "floor"|"wall"|"ceiling"|"onTop",
 *     wallIndex, alongCm, outCm, quarterTurn, flush, onTop, rect }
 * where `flush` means "back against the wall" (the placer re-measures the
 * model and pulls it flush) and `onTop` is the index of the slot it stands on.
 */
export function planBedroom(room, catalogue, choice = {}, options = {}) {
  const opts = { ...BEDROOM_DEFAULTS, ...options };
  const extras = {
    sideTable: true,
    tableLamp: true,
    mirror: true,
    ac: true,
    carpet: true,
    light: true,
    ...(choice.extras || {}),
  };
  // ANOTHER DESIGN, SAME RULES. Design 0 is the plain best answer (largest
  // cot, widest wardrobe, the usual models). Any other number is a seed: each
  // choice below is then drawn from the options that FIT — another cot of about
  // the same size, another good wall or corner for the wardrobe, other side
  // tables, lamps, mirror, carpet and light — so every design still keeps the
  // walkways and clearances. The same number always gives the same design, so
  // "Back" returns to exactly what was shown.
  const seed = Math.max(0, Math.floor(Number(choice.seed) || 0));
  const vary = seed > 0;
  const rand = mulberry32(seed);
  const pickOne = (list, fallback) =>
    vary && list && list.length ? list[Math.floor(rand() * list.length)] : fallback;
  const walls = room?.walls || [];
  if (!walls.length) return { slots: [], skipped: [], reason: "no walls in this room" };
  const poly = walls.map((w) => w.a);
  const doors = doorZones(room, opts);
  const slots = [];
  const skipped = [];
  const taken = []; // rectangles on the floor that nothing else may overlap
  const free = (r, ignore = []) =>
    insideRoom(r, poly) &&
    !doors.some((z) => overlaps(r, z)) &&
    !taken.some((t) => !ignore.includes(t) && overlaps(r, t));

  // 1. THE COT ───────────────────────────────────────────────────────────────
  const cots = [...(catalogue.cot || [])]
    .filter((m) => m.w > 0 && m.d > 0)
    // Widest first; among equals the one named a cot (the studio's own range).
    .sort((p, q) => q.w - p.w || Number(/cot/i.test(q.name)) - Number(/cot/i.test(p.name)));
  if (!cots.length) return { slots: [], skipped: [], reason: "no cots in the catalogue" };

  const bedWallOrder =
    Number.isInteger(choice.bedWallIndex) && walls[choice.bedWallIndex]
      ? [choice.bedWallIndex]
      : walls
          .map((w, i) => i)
          .sort((i, j) => {
            const di = doorsOf(walls[i]).length;
            const dj = doorsOf(walls[j]).length;
            if (di !== dj) return di - dj;
            return walls[j].lengthCm - walls[i].lengthCm;
          });

  const walk = cm(opts.walkwayMm);
  /** The cot on this wall: centred if it can be, else slid along to clear a door. */
  const fitCot = (wi, cot) => {
    const wall = walls[wi];
    const spans = stretches(
      wall,
      doorsOf(wall).map((o) => [o.startCm - cm(opts.doorClearanceMm), o.endCm + cm(opts.doorClearanceMm)])
    );
    const span = longest(spans);
    if (!span || span[1] - span[0] < cot.w + 2 * walk) return null;
    const lo = span[0] + walk + cot.w / 2;
    const hi = span[1] - walk - cot.w / 2;
    const middle = Math.max(lo, Math.min(hi, wall.lengthCm / 2));
    // Every spot 5 cm apart, nearest the middle first.
    const spots = [];
    for (let t = lo; t <= hi + 0.01; t += 5) spots.push(t);
    spots.push(middle);
    spots.sort((p, q) => Math.abs(p - middle) - Math.abs(q - middle));
    for (const t of spots) {
      const rect = wallRect(wall, t, cot.d / 2, cot.w, cot.d);
      const foot = wallRect(wall, t, cot.d + cm(opts.footClearanceMm) / 2, cot.w, cm(opts.footClearanceMm));
      // The walkway at the foot may share floor with a door's swing — both are
      // just floor to keep clear — but it must be inside the room.
      if (!free(rect) || !insideRoom(foot, poly)) continue;
      return { wi, wall, t, cot, rect, foot };
    }
    return null;
  };
  // The largest cot first — on a wall with no door if any wall takes it, and
  // only then on one with a door. A picked wall is the only one tried.
  let bed = null;
  const passes = [
    bedWallOrder.filter((i) => !doorsOf(walls[i]).length),
    bedWallOrder.filter((i) => doorsOf(walls[i]).length),
  ].filter((p) => p.length);
  for (const pass of passes) {
    // Every cot that fits on a wall of this pass, best first.
    const fits = [];
    for (const cot of cots) {
      for (const wi of pass) {
        const fit = fitCot(wi, cot);
        if (fit) fits.push(fit);
      }
    }
    if (!fits.length) continue;
    // Another design: any of them within 25 cm of the largest that fits.
    const widest = Math.max(...fits.map((f) => f.cot.w));
    bed = pickOne(fits.filter((f) => f.cot.w >= widest - 25), fits[0]);
    break;
  }
  if (!bed) {
    return { slots: [], skipped: [], reason: "the room is too small for a cot with walkways around it" };
  }
  taken.push(bed.rect);
  const bedSlot = push({
    kind: "cot",
    label: "Cot",
    model: bed.cot,
    level: "floor",
    wallIndex: bed.wi,
    alongCm: bed.t,
    outCm: bed.cot.d / 2,
    flush: true,
    rect: bed.rect,
  });
  // The walkway at the foot stays clear of anything standing (a carpet may lie there).
  taken.push(bed.foot);

  // 2. SIDE TABLES AND LAMPS ────────────────────────────────────────────────
  const sideTables = [];
  if (extras.sideTable) {
    const bedside = (catalogue.sideTable || []).filter((m) => m.w <= 65 && m.d <= 65 && m.h >= 35 && m.h <= 75);
    const table = pickOne(bedside, pickClosest(bedside, 45));
    if (!table) skipped.push({ kind: "sideTable", reason: "no side table of a bedside size" });
    else {
      for (const side of [-1, 1]) {
        const t = bed.t + side * (bed.cot.w / 2 + cm(opts.sideTableGapMm) + table.w / 2);
        const rect = wallRect(bed.wall, t, table.d / 2, table.w, table.d);
        if (!free(rect)) {
          skipped.push({ kind: "sideTable", reason: `no room on the ${side < 0 ? "left" : "right"} of the cot` });
          continue;
        }
        taken.push(rect);
        sideTables.push(
          push({
            kind: "sideTable",
            label: "Side table",
            model: table,
            level: "floor",
            wallIndex: bed.wi,
            alongCm: t,
            outCm: table.d / 2,
            flush: true,
            rect,
          })
        );
      }
    }
  }
  if (extras.tableLamp && sideTables.length) {
    const top = slots[sideTables[0]].model;
    const small = (catalogue.tableLamp || []).filter((m) => m.w <= top.w && m.d <= top.d && m.h > 0 && m.h <= 70);
    const lamp = pickOne(small, pickClosest(small, top.w * 0.8));
    if (!lamp) skipped.push({ kind: "tableLamp", reason: "no table lamp small enough for the side table" });
    else
      sideTables.forEach((ti) =>
        push({
          kind: "tableLamp",
          label: "Table lamp",
          model: lamp,
          level: "onTop",
          wallIndex: bed.wi,
          alongCm: slots[ti].alongCm,
          outCm: slots[ti].outCm,
          onTop: ti,
          rect: wallRect(bed.wall, slots[ti].alongCm, slots[ti].outCm, lamp.w, lamp.d),
        })
      );
  }

  // 3. THE WARDROBE ──────────────────────────────────────────────────────────
  // The style picked in the panel; Basic handles when that style has none.
  const styled = (kind) => (catalogue[kind] || []).filter((m) => m.w > 0 && m.d > 0);
  let doubles = styled("wardrobe");
  let singles = styled("wardrobeSingle");
  if (choice.wardrobeStyle === "fluted" && (styled("wardrobeFluted").length || styled("wardrobeFlutedSingle").length)) {
    doubles = styled("wardrobeFluted");
    singles = styled("wardrobeFlutedSingle");
  }
  const units = [...doubles, ...singles];
  // ONE MODEL PER WIDTH, chosen once: the plain shelves-and-hanger unit, or for
  // another design any of that width's inside layouts.
  const unitOfWidth = new Map();
  for (const list of [doubles, singles]) {
    for (const w of new Set(list.map((m) => m.w))) {
      const same = list.filter((m) => m.w === w);
      unitOfWidth.set(`${list === doubles ? "d" : "s"}${w}`, pickOne(same, preferred(same)));
    }
  }
  const dWidths = [...new Set(doubles.map((m) => m.w))].sort((a, b) => b - a);
  const sWidths = [...new Set(singles.map((m) => m.w))].sort((a, b) => b - a);
  /** Units (widest first) making up to `length` cm; doubles, then one single. */
  const makeRun = (length) => {
    const run = [];
    let left = Math.min(length, cm(opts.maxWardrobeMm));
    for (;;) {
      const w = dWidths.find((x) => x <= left + 0.01);
      if (!w) break;
      run.push(unitOfWidth.get(`d${w}`));
      left -= w;
    }
    const s = sWidths.find((x) => x <= left + 0.01);
    if (s) run.push(unitOfWidth.get(`s${s}`));
    return run;
  };
  let wardrobe = null;
  if (!units.length) skipped.push({ kind: "wardrobe", reason: "no wardrobes in the catalogue" });
  else {
    const clearance = cm(opts.wardrobeFrontClearanceMm);
    const order = walls.map((w, i) => i).sort((i, j) => Number(i === bed.wi) - Number(j === bed.wi));
    // Every place a wardrobe run fits — each stretch of wall, from either of
    // its corners, at the longest run that fits there.
    const places = [];
    for (const wi of order) {
      const wall = walls[wi];
      const blocked = [
        ...doorsOf(wall).map((o) => [o.startCm - cm(opts.doorClearanceMm), o.endCm + cm(opts.doorClearanceMm)]),
        // Full height, so it can never stand in front of a window.
        ...windowsOf(wall).map((o) => [o.startCm - cm(opts.windowMarginMm), o.endCm + cm(opts.windowMarginMm)]),
      ];
      for (const span of stretches(wall, blocked)) {
        for (const end of ["start", "end"]) {
          // Shrink the run 5 cm at a time until it fits in front of everything.
          for (let length = span[1] - span[0]; length >= 40; length -= 5) {
            const run = makeRun(length);
            if (!run.length) break;
            const total = run.reduce((s, m) => s + m.w, 0);
            const depth = Math.max(...run.map((m) => m.d));
            const from = end === "start" ? span[0] : span[1] - total;
            const t = from + total / 2;
            const rect = wallRect(wall, t, depth / 2, total, depth);
            const front = wallRect(wall, t, depth + clearance / 2, total, clearance);
            if (!free(rect) || !insideRoom(front, poly)) continue;
            // Its doors must open: nothing standing in front (the bed's foot walkway may share).
            if (taken.some((r) => r !== bed.foot && overlaps(front, r))) continue;
            // Widest wins; on a tie, a wall other than the bed's.
            const score = total * 10 - (wi === bed.wi ? 5 : 0);
            places.push({ wi, wall, from, run, total, depth, rect, score });
            break;
          }
        }
      }
    }
    if (places.length) {
      const best = places.reduce((a, p) => (p.score > a.score ? p : a), places[0]);
      // Another design: any place at least three quarters as wide as the best.
      wardrobe = pickOne(
        places.filter((p) => p.total >= best.total * 0.75),
        best
      );
    }
    if (!wardrobe) skipped.push({ kind: "wardrobe", reason: "no free wall with room in front to open it" });
    else {
      taken.push(wardrobe.rect);
      let at = wardrobe.from;
      wardrobe.run.forEach((m) => {
        push({
          kind: "wardrobe",
          label: "Wardrobe",
          model: m,
          level: "floor",
          wallIndex: wardrobe.wi,
          alongCm: at + m.w / 2,
          outCm: m.d / 2,
          flush: true,
          rect: wallRect(wardrobe.wall, at + m.w / 2, m.d / 2, m.w, m.d),
        });
        at += m.w;
      });
    }
  }

  // 4. WALL ITEMS — MIRROR AND AC, HUNG AT 7 FT ───────────────────────────────
  // What a wall item must keep clear of, on each wall: doors, windows, the
  // wardrobe (as tall as the hang height), and on the bed wall the head of the
  // bed and its side tables.
  const wallBlocked = (wi) => {
    const wall = walls[wi];
    const gap = cm(opts.wallItemGapMm);
    const out = [
      ...doorsOf(wall).map((o) => [o.startCm - gap, o.endCm + gap]),
      ...windowsOf(wall).map((o) => [o.startCm - gap, o.endCm + gap]),
    ];
    if (wardrobe && wardrobe.wi === wi) out.push([wardrobe.from - gap, wardrobe.from + wardrobe.total + gap]);
    if (wi === bed.wi) {
      const spread = slots
        .filter((s) => s.wallIndex === wi && (s.kind === "cot" || s.kind === "sideTable"))
        .map((s) => [s.alongCm - s.model.w / 2, s.alongCm + s.model.w / 2]);
      spread.forEach(([f, t]) => out.push([f - gap, t + gap]));
    }
    slots
      .filter((s) => s.level === "wall" && s.wallIndex === wi)
      .forEach((s) => out.push([s.alongCm - s.model.w / 2 - gap, s.alongCm + s.model.w / 2 + gap]));
    return out;
  };
  const hang = (kind, label, model, wallOrder, near) => {
    for (const wi of wallOrder) {
      const wall = walls[wi];
      const fits = stretches(wall, wallBlocked(wi)).filter(([f, t]) => t - f >= model.w);
      if (!fits.length) continue;
      // Nearest the wanted spot along the wall (or the middle of the longest).
      const want = near ? near(wi) : null;
      let best = null;
      for (const [f, t] of fits) {
        const target = want === null ? (f + t) / 2 : want;
        const c = Math.max(f + model.w / 2, Math.min(t - model.w / 2, target));
        const cost = want === null ? -(t - f) : Math.abs(c - want);
        if (!best || cost < best.cost) best = { c, cost };
      }
      push({
        kind,
        label,
        model,
        level: "wall",
        wallIndex: wi,
        alongCm: best.c,
        outCm: model.d / 2,
        rect: wallRect(wall, best.c, model.d / 2, model.w, model.d),
      });
      return true;
    }
    return false;
  };
  const facing = (wi) =>
    walls[wi].normal.x * bed.wall.normal.x + walls[wi].normal.y * bed.wall.normal.y < -0.8;
  const notBedWall = walls.map((w, i) => i).filter((i) => i !== bed.wi);

  if (extras.mirror) {
    const mirrors = (catalogue.mirror || []).filter((m) => m.w > 0 && m.w <= 120);
    const mirror = pickOne(mirrors, pickClosest(mirrors, 46));
    const order = wardrobe ? [wardrobe.wi, ...notBedWall.filter((i) => i !== wardrobe.wi)] : notBedWall;
    // Beside the wardrobe when it can be.
    const near = (wi) =>
      wardrobe && wi === wardrobe.wi ? wardrobe.from + wardrobe.total + cm(opts.wallItemGapMm) + (mirror?.w || 0) / 2 : null;
    if (!mirror) skipped.push({ kind: "mirror", reason: "no wall mirror in the catalogue" });
    else if (!hang("mirror", "Mirror", mirror, order, near)) skipped.push({ kind: "mirror", reason: "no free wall for it" });
  }
  if (extras.ac) {
    const ac = (catalogue.ac || []).find((m) => m.w > 0);
    const order = [...notBedWall.filter(facing), ...notBedWall.filter((i) => !facing(i))];
    // Opposite the middle of the bed.
    const near = (wi) => {
      const head = wallPoint(bed.wall, bed.t, 0);
      const w = walls[wi];
      const u = along(w);
      return (head.x - w.a.x) * u.x + (head.y - w.a.y) * u.y;
    };
    if (!ac) skipped.push({ kind: "ac", reason: "no AC in the catalogue" });
    else if (!hang("ac", "AC", ac, order, near)) skipped.push({ kind: "ac", reason: "no free wall for it" });
  }

  // 5. CARPET — AT THE FOOT OF THE BED, HALF UNDER IT ─────────────────────────
  if (extras.carpet) {
    let carpets = (catalogue.carpet || []).filter((m) => m.w > 0 && m.d > 0);
    // Another design tries them in another order (the first that fits is laid).
    if (vary) carpets = shuffled(carpets, rand);
    let laid = false;
    for (const carpet of carpets) {
      for (const quarterTurn of [false, true]) {
        const w = quarterTurn ? carpet.d : carpet.w; // across the bed
        const d = quarterTurn ? carpet.w : carpet.d; // along the bed
        const rect = wallRect(bed.wall, bed.t, bed.cot.d, w, d);
        // It lies flat: the cot, the side tables and the foot walkway may be on it;
        // the wardrobe, a door's swing and the walls may not.
        const standing = taken.filter((r) => r !== bed.rect && r !== bed.foot && !sideTableRects().includes(r));
        if (!insideRoom(rect, poly) || standing.some((r) => overlaps(rect, r))) continue;
        push({
          kind: "carpet",
          label: "Carpet",
          model: carpet,
          level: "floor",
          wallIndex: bed.wi,
          alongCm: bed.t,
          outCm: bed.cot.d,
          quarterTurn,
          rect,
        });
        laid = true;
        break;
      }
      if (laid) break;
    }
    if (!laid && carpets.length) skipped.push({ kind: "carpet", reason: "too big for the floor left at the foot of the bed" });
    if (!carpets.length) skipped.push({ kind: "carpet", reason: "no carpet in the catalogue" });
  }

  // 6. CEILING LIGHT ─────────────────────────────────────────────────────────
  if (extras.light) {
    const lights = (catalogue.light || []).filter((m) => m.w >= 20 && m.w <= 80);
    const light = pickOne(lights, pickClosest(lights, 60));
    if (!light) skipped.push({ kind: "light", reason: "no ceiling light of a room size" });
    else push({ kind: "light", label: "Ceiling light", model: light, level: "ceiling" });
  }

  return { bedWallIndex: bed.wi, slots, skipped };

  function push(slot) {
    slots.push(slot);
    return slots.length - 1;
  }
  function sideTableRects() {
    return slots.filter((s) => s.kind === "sideTable").map((s) => s.rect);
  }
}

/**
 * Of several wardrobes the same width, the plain storage one: shelves and a
 * hanging space, before drawers or a half-hanger layout.
 */
function preferred(list) {
  const score = (m) =>
    (/shelf/i.test(m.name) ? 2 : 0) + (/hanger/i.test(m.name) ? 2 : 0) - (/drawer|half/i.test(m.name) ? 1 : 0);
  return [...list].sort((p, q) => score(q) - score(p) || String(p.name).localeCompare(String(q.name)))[0];
}
