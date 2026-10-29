/**
 * Auto-furnish — the placement engine for a LIVING ROOM.
 *
 * Plain geometry, like bedroomEngine: a description of the room and the sizes
 * the catalogue has go in, where each item goes comes out — the same answer
 * for the preview on the plan and for the real placing.
 *
 * Centimetres throughout. Catalogue sizes come in as { w, h, d } in cm.
 *
 * What goes where (agreed with the studio):
 *   • the TV WALL — the one picked, else a wall with no door that has a wall
 *     facing it far enough away for a sofa: the widest TV BACK PANEL that fits
 *     clear of doors and windows, centred, top at 7 ft; the TV DRAWER UNIT of
 *     the same width under it (hung 300 mm off the floor by the app's own
 *     TV-unit rule); WALL CLADDING slats either side, up to 4 a side;
 *   • the SOFA against the wall facing the TV, centred on it, the widest that
 *     fits while keeping 1.8 m from the TV unit;
 *   • a CENTER TABLE in front of the sofa, an ARMCHAIR beside it turned to it,
 *     a CARPET under it; a SIDE TABLE with a TABLE LAMP at one end of the sofa
 *     and a FLOOR LAMP at the other; WALL ART above the sofa;
 *   • a PLANT in a corner of the TV wall, a BOOKSHELF and the AC on a side
 *     wall, a CEILING LIGHT in the middle.
 * Every item is a real rectangle checked against the walls, the doors' swing
 * and what is already placed; an extra that does not fit is left out and
 * named. "Try another design" (a seed) varies the choices among what fits.
 */

import {
  along,
  alongOf,
  wallPoint,
  wallRect,
  rectCorners,
  overlaps,
  insideRoom,
  doorsOf,
  windowsOf,
  stretches,
  doorZones,
  facingWalls,
  pickClosest,
  shuffled,
  designChooser,
} from "./furnishGeometry";

export { wallPoint, rectCorners };

export const LIVING_DEFAULTS = {
  walkwayMm: 600,
  sofaToTvMinMm: 1800, // sofa front → TV unit front
  centerTableGapMm: 450, // sofa front → table
  armchairGapMm: 400, // table side → armchair
  tvFrontClearanceMm: 600, // kept free in front of the TV unit
  bookshelfFrontClearanceMm: 600,
  claddingPerSide: 4,
  hangTopMm: 2134, // wall items' top (7 ft), for what fits above the sofa
  doorClearanceMm: 100,
  doorSwingMinMm: 900,
  windowMarginMm: 50,
  wallItemGapMm: 150,
};

const cm = (millimetres) => millimetres / 10;

/**
 * Plan a living room.
 *
 *   room       describeRoom() output
 *   catalogue  { kind: [{ id, name, w, h, d }] } in cm (see pickRoomModules)
 *   choice     { tvWallIndex?, extras? (default on), seed?,
 *                tvUnitStyle?: "basic" | "groove", panelStyle?: "plain" | "groove" }
 *
 * Returns { tvWallIndex, slots, skipped, reason? }. Slots are as bedroomEngine's,
 * plus `facing` ({x, y}, the way the item looks) when it does not face along
 * its wall's normal — an armchair turned to the table.
 */
export function planLiving(room, catalogue, choice = {}, options = {}) {
  const opts = { ...LIVING_DEFAULTS, ...options };
  const extras = {
    tv: true,
    centerTable: true,
    armchair: true,
    carpet: true,
    sideTable: true,
    tableLamp: true,
    floorLamp: true,
    plant: true,
    wallArt: true,
    ac: true,
    bookshelf: true,
    light: true,
    ...(choice.extras || {}),
  };
  const { vary, rand, pickOne } = designChooser(choice.seed);
  const walls = room?.walls || [];
  if (!walls.length) return { slots: [], skipped: [], reason: "no walls in this room" };
  const poly = walls.map((w) => w.a);
  const doors = doorZones(room, opts);
  const slots = [];
  const skipped = [];
  const taken = []; // floor rectangles nothing standing may overlap
  const free = (r) => insideRoom(r, poly) && !doors.some((z) => overlaps(r, z)) && !taken.some((t) => overlaps(r, t));
  const push = (slot) => {
    slots.push(slot);
    return slots.length - 1;
  };
  const sized = (kind, test = () => true) => (catalogue[kind] || []).filter((m) => m.w > 0 && test(m));
  const gapDoors = (wall, gap) => doorsOf(wall).map((o) => [o.startCm - gap, o.endCm + gap]);
  const gapWindows = (wall, gap) => windowsOf(wall).map((o) => [o.startCm - gap, o.endCm + gap]);
  /** How far apart two facing walls are (the room's depth between them). */
  const depthBetween = (w1, w2) => {
    const d = (w2.a.x - w1.a.x) * w1.normal.x + (w2.a.y - w1.a.y) * w1.normal.y;
    return Math.abs(d);
  };

  // 1. THE TV WALL ───────────────────────────────────────────────────────────
  const panels = sized(choice.panelStyle === "groove" && sized("tvPanelGroove").length ? "tvPanelGroove" : "tvPanel");
  const units = sized(choice.tvUnitStyle === "groove" && sized("tvUnitGroove").length ? "tvUnitGroove" : "tvUnit");
  if (!panels.length) return { slots: [], skipped: [], reason: "no TV back panels in the catalogue" };
  const unitDepth = units.length ? Math.max(...units.map((m) => m.d)) : 0;
  const sofaDepth = Math.min(...sized("sofa").map((m) => m.d).concat([90]));
  const needDepth = unitDepth + cm(opts.sofaToTvMinMm) + sofaDepth;
  const hasSofaRoom = (wi) => walls.some((w, j) => j !== wi && facingWalls(walls[wi], w) && depthBetween(walls[wi], w) >= needDepth);

  const picked = Number.isInteger(choice.tvWallIndex) && walls[choice.tvWallIndex];
  const candidates = (picked ? [choice.tvWallIndex] : walls.map((w, i) => i))
    .map((wi) => {
      const wall = walls[wi];
      const spans = stretches(wall, [
        ...gapDoors(wall, cm(opts.doorClearanceMm)),
        ...gapWindows(wall, cm(opts.windowMarginMm)),
      ]);
      // The widest panel that fits a stretch, centred on the wall if it can be.
      let best = null;
      for (const span of spans) {
        for (const p of [...panels].sort((a, b) => b.w - a.w)) {
          if (span[1] - span[0] < p.w) continue;
          const t = Math.max(span[0] + p.w / 2, Math.min(span[1] - p.w / 2, wall.lengthCm / 2));
          const floor = wallRect(wall, t, unitDepth / 2, p.w, Math.max(unitDepth, 2));
          if (!insideRoom(floor, poly) || doors.some((z) => overlaps(floor, z))) continue;
          if (!best || p.w > best.panel.w) best = { wi, wall, span, panel: p, t };
          break;
        }
      }
      return best;
    })
    .filter(Boolean)
    // No door first, then a wall the sofa can face, then the widest panel.
    .sort(
      (a, b) =>
        doorsOf(a.wall).length - doorsOf(b.wall).length ||
        Number(hasSofaRoom(b.wi)) - Number(hasSofaRoom(a.wi)) ||
        b.panel.w - a.panel.w
    );
  if (!candidates.length) return { slots: [], skipped: [], reason: "no wall has room for a TV back panel" };
  // Another design: any equally good wall (same doors and sofa room).
  const top = candidates[0];
  const tv = pickOne(
    candidates.filter(
      (c) => doorsOf(c.wall).length === doorsOf(top.wall).length && hasSofaRoom(c.wi) === hasSofaRoom(top.wi)
    ),
    top
  );
  const tvWall = tv.wall;
  // Another design may take a narrower panel (down to 70% of the widest).
  const panelWidths = [...new Set(panels.map((p) => p.w))].filter((w) => w <= tv.span[1] - tv.span[0] && w >= tv.panel.w * 0.7);
  const panelW = pickOne(panelWidths.sort((a, b) => b - a), tv.panel.w);
  const panel = pickOne(panels.filter((p) => p.w === panelW), panels.find((p) => p.w === panelW));
  const tvT = Math.max(tv.span[0] + panelW / 2, Math.min(tv.span[1] - panelW / 2, tvWall.lengthCm / 2));
  push({
    kind: "tvPanel",
    label: "TV back panel",
    model: panel,
    level: "wall",
    wallIndex: tv.wi,
    alongCm: tvT,
    outCm: panel.d / 2,
    rect: wallRect(tvWall, tvT, Math.max(panel.d, 2) / 2, panelW, Math.max(panel.d, 2)),
  });
  taken.push(wallRect(tvWall, tvT, Math.max(panel.d, 2) / 2, panelW, Math.max(panel.d, 2)));

  // The TV unit, the panel's width (or the widest narrower one).
  let unit = null;
  if (!units.length) skipped.push({ kind: "tvUnit", reason: "no TV drawer units in the catalogue" });
  else {
    const same = units.filter((m) => Math.abs(m.w - panelW) < 0.5);
    const narrower = units.filter((m) => m.w <= panelW).sort((a, b) => b.w - a.w);
    const list = same.length ? same : narrower.filter((m) => m.w === (narrower[0] || {}).w);
    unit = pickOne(list, list[0]);
    if (!unit) skipped.push({ kind: "tvUnit", reason: "no TV drawer unit as narrow as the panel" });
    else {
      const rect = wallRect(tvWall, tvT, unit.d / 2, unit.w, unit.d);
      taken.push(rect);
      push({ kind: "tvUnit", label: "TV drawer unit", model: unit, level: "wall", wallIndex: tv.wi, alongCm: tvT, outCm: unit.d / 2, rect });
    }
  }
  // The floor in front of the TV unit stays clear.
  const tvFront = wallRect(
    tvWall,
    tvT,
    (unit ? unit.d : 0) + cm(opts.tvFrontClearanceMm) / 2,
    panelW,
    cm(opts.tvFrontClearanceMm)
  );
  taken.push(tvFront);

  // Cladding slats either side, as many as both sides can take (up to the limit).
  const slat = pickOne(sized("cladding"), pickClosest(sized("cladding"), 15));
  if (!slat) skipped.push({ kind: "cladding", reason: "no wall cladding in the catalogue" });
  else {
    const leftRoom = tvT - panelW / 2 - tv.span[0];
    const rightRoom = tv.span[1] - (tvT + panelW / 2);
    const perSide = Math.min(opts.claddingPerSide, Math.floor(leftRoom / slat.w), Math.floor(rightRoom / slat.w));
    if (perSide < 1) skipped.push({ kind: "cladding", reason: "no room beside the TV panel" });
    for (let i = 0; i < perSide; i++) {
      for (const side of [-1, 1]) {
        const t = tvT + side * (panelW / 2 + slat.w * i + slat.w / 2);
        const rect = wallRect(tvWall, t, Math.max(slat.d, 2) / 2, slat.w, Math.max(slat.d, 2));
        taken.push(rect);
        push({ kind: "cladding", label: "Wall cladding", model: slat, level: "wall", wallIndex: tv.wi, alongCm: t, outCm: slat.d / 2, rect });
      }
    }
  }
  // The TV on the back panel: centred, no wider than the panel (1 cm allowed),
  // its bottom 900 mm off the floor by the app's TV rule, and standing out from
  // the wall by the panel's thickness so it sits on the panel's face.
  if (extras.tv) {
    const tvs = sized("tv", (m) => m.w <= panelW + 1);
    const set = pickOne(tvs, pickClosest(tvs, panelW * 0.75));
    if (!set) skipped.push({ kind: "tv", reason: sized("tv").length ? "every TV is wider than the back panel" : "no TV in the catalogue" });
    else
      push({
        kind: "tv",
        label: "TV",
        model: set,
        level: "wall",
        wallIndex: tv.wi,
        alongCm: tvT,
        outCm: panel.d + set.d / 2,
        standoffCm: panel.d || 0,
        rect: wallRect(tvWall, tvT, panel.d + Math.max(set.d, 2) / 2, set.w, Math.max(set.d, 2)),
      });
  }

  // Where the whole TV feature runs along its wall (panel + cladding).
  const featureSpan = (() => {
    const own = slots.filter((s) => s.wallIndex === tv.wi && s.level === "wall");
    return [Math.min(...own.map((s) => s.alongCm - s.model.w / 2)), Math.max(...own.map((s) => s.alongCm + s.model.w / 2))];
  })();

  // 2. THE SOFA ──────────────────────────────────────────────────────────────
  const tvCentre = wallPoint(tvWall, tvT, 0);
  let sofa = null;
  const sofas = sized("sofa", (m) => m.d > 0).sort((a, b) => b.w - a.w);
  if (!sofas.length) skipped.push({ kind: "sofa", reason: "no sofas in the catalogue" });
  else {
    const fits = [];
    walls.forEach((wall, wi) => {
      if (wi === tv.wi || !facingWalls(tvWall, wall)) return;
      const depth = depthBetween(tvWall, wall);
      for (const s of sofas) {
        if (depth - s.d - (unit ? unit.d : 0) < cm(opts.sofaToTvMinMm)) continue;
        for (const span of stretches(wall, gapDoors(wall, cm(opts.doorClearanceMm)))) {
          if (span[1] - span[0] < s.w) continue;
          // Facing the middle of the TV, else as near as the stretch allows.
          const want = alongOf(wall, tvCentre);
          const lo = span[0] + s.w / 2;
          const hi = span[1] - s.w / 2;
          const spots = [Math.max(lo, Math.min(hi, want))];
          for (let t = lo; t <= hi + 0.01; t += 5) spots.push(t);
          spots.sort((p, q) => Math.abs(p - want) - Math.abs(q - want));
          for (const t of spots) {
            const rect = wallRect(wall, t, s.d / 2, s.w, s.d);
            if (!free(rect)) continue;
            fits.push({ wi, wall, s, t, rect });
            break;
          }
        }
      }
    });
    if (!fits.length) skipped.push({ kind: "sofa", reason: "no wall facing the TV far enough away" });
    else {
      fits.sort((a, b) => b.s.w - a.s.w);
      sofa = pickOne(
        fits.filter((f) => f.s.w >= fits[0].s.w - 35),
        fits[0]
      );
      taken.push(sofa.rect);
      push({ kind: "sofa", label: "Sofa", model: sofa.s, level: "floor", wallIndex: sofa.wi, alongCm: sofa.t, outCm: sofa.s.d / 2, flush: true, rect: sofa.rect });
    }
  }

  // 3. AROUND THE SOFA ───────────────────────────────────────────────────────
  let table = null;
  if (sofa && extras.centerTable) {
    const centres = sized("centerTable", (m) => m.d > 0);
    const options = vary ? [...centres, ...sized("coffeeTable", (m) => m.d > 0)] : centres;
    const wish = Math.min(sofa.s.w * 0.5, 90);
    const ordered = vary ? shuffled(options, rand) : [...options].sort((a, b) => Math.abs(a.w - wish) - Math.abs(b.w - wish));
    for (const m of ordered) {
      if (m.w > sofa.s.w) continue;
      const out = sofa.s.d + cm(opts.centerTableGapMm) + m.d / 2;
      const rect = wallRect(sofa.wall, sofa.t, out, m.w, m.d);
      if (!free(rect)) continue;
      table = { m, out, rect };
      break;
    }
    if (!table) skipped.push({ kind: "centerTable", reason: "no room between the sofa and the TV" });
    else {
      taken.push(table.rect);
      push({ kind: "centerTable", label: "Center table", model: table.m, level: "floor", wallIndex: sofa.wi, alongCm: sofa.t, outCm: table.out, rect: table.rect });
    }
  }
  if (sofa && table && extras.armchair) {
    const chairs = sized("armchair", (m) => m.d > 0 && m.w <= 90);
    const chair = pickOne(chairs, pickClosest(chairs, 60));
    const sides = vary && rand() < 0.5 ? [-1, 1] : [1, -1];
    let placedChair = false;
    for (const side of chair ? sides : []) {
      const t = sofa.t + side * (table.m.w / 2 + cm(opts.armchairGapMm) + chair.d / 2);
      // Turned to look at the table: its width runs across, its depth along the sofa wall.
      const rect = wallRect(sofa.wall, t, table.out, chair.d, chair.w);
      if (!free(rect)) continue;
      const u = along(sofa.wall);
      taken.push(rect);
      push({
        kind: "armchair",
        label: "Armchair",
        model: chair,
        level: "floor",
        wallIndex: sofa.wi,
        alongCm: t,
        outCm: table.out,
        facing: { x: -side * u.x, y: -side * u.y },
        rect,
      });
      placedChair = true;
      break;
    }
    if (!placedChair) skipped.push({ kind: "armchair", reason: chair ? "no room beside the center table" : "no armchair in the catalogue" });
  }

  // Side table + lamp at one end of the sofa, floor lamp at the other.
  const ends = vary && rand() < 0.5 ? [-1, 1] : [1, -1];
  let sideEnd = null;
  if (sofa && extras.sideTable) {
    const tables = sized("sideTable", (m) => m.d > 0 && m.w <= 65 && m.d <= 65 && m.h >= 35 && m.h <= 75);
    const st = pickOne(tables, pickClosest(tables, 45));
    for (const end of st ? ends : []) {
      const t = sofa.t + end * (sofa.s.w / 2 + 3 + st.w / 2);
      const rect = wallRect(sofa.wall, t, st.d / 2, st.w, st.d);
      if (!free(rect)) continue;
      taken.push(rect);
      const index = push({ kind: "sideTable", label: "Side table", model: st, level: "floor", wallIndex: sofa.wi, alongCm: t, outCm: st.d / 2, flush: true, rect });
      sideEnd = end;
      if (extras.tableLamp) {
        const lamps = sized("tableLamp", (m) => m.w <= st.w && m.d <= st.d && m.h > 0 && m.h <= 70);
        const lamp = pickOne(lamps, pickClosest(lamps, st.w * 0.8));
        if (lamp) {
          push({
            kind: "tableLamp",
            label: "Table lamp",
            model: lamp,
            level: "onTop",
            wallIndex: sofa.wi,
            alongCm: t,
            outCm: st.d / 2,
            onTop: index,
            rect: wallRect(sofa.wall, t, st.d / 2, lamp.w, lamp.d),
          });
        } else skipped.push({ kind: "tableLamp", reason: "no table lamp small enough for the side table" });
      }
      break;
    }
    if (sideEnd === null) skipped.push({ kind: "sideTable", reason: st ? "no room at either end of the sofa" : "no side table of a sofa-side size" });
  }
  if (sofa && extras.floorLamp) {
    const lamps = sized("floorLamp", (m) => m.d > 0 && m.w <= 60 && m.d <= 60);
    const lamp = pickOne(lamps, lamps[0]);
    let lit = false;
    const order = sideEnd === null ? ends : [-sideEnd];
    for (const end of lamp ? order : []) {
      const t = sofa.t + end * (sofa.s.w / 2 + 5 + lamp.w / 2);
      const rect = wallRect(sofa.wall, t, lamp.d / 2, lamp.w, lamp.d);
      if (!free(rect)) continue;
      taken.push(rect);
      push({ kind: "floorLamp", label: "Floor lamp", model: lamp, level: "floor", wallIndex: sofa.wi, alongCm: t, outCm: lamp.d / 2, flush: true, rect });
      lit = true;
      break;
    }
    if (!lit) skipped.push({ kind: "floorLamp", reason: lamp ? "no room at the end of the sofa" : "no floor lamp of a room size" });
  }

  // Carpet under the center table (or between sofa and TV).
  if (extras.carpet) {
    let carpets = sized("carpet", (m) => m.d > 0);
    if (vary) carpets = shuffled(carpets, rand);
    let laid = false;
    const t = sofa ? sofa.t : alongOf(tvWall, tvCentre);
    const wall = sofa ? sofa.wall : tvWall;
    const out = table ? table.out : sofa ? sofa.s.d + 100 : (unit ? unit.d : 0) + 150;
    for (const carpet of carpets) {
      for (const quarterTurn of [true, false]) {
        const w = quarterTurn ? carpet.d : carpet.w;
        const d = quarterTurn ? carpet.w : carpet.d;
        const rect = wallRect(wall, t, out, w, d);
        // It lies flat: furniture may stand on it; it must be on the floor.
        if (!insideRoom(rect, poly)) continue;
        push({ kind: "carpet", label: "Carpet", model: carpet, level: "floor", wallIndex: sofa ? sofa.wi : tv.wi, alongCm: t, outCm: out, quarterTurn, rect });
        laid = true;
        break;
      }
      if (laid) break;
    }
    if (!laid) skipped.push({ kind: "carpet", reason: carpets.length ? "too big for the floor between the sofa and the TV" : "no carpet in the catalogue" });
  }

  // 4. WALL ITEMS ────────────────────────────────────────────────────────────
  const gap = cm(opts.wallItemGapMm);
  const wallBlocked = (wi) => {
    const wall = walls[wi];
    const out = [...gapDoors(wall, gap), ...gapWindows(wall, gap)];
    slots
      .filter((s) => s.wallIndex === wi && (s.level === "wall" || (s.level === "floor" && s.kind === "bookshelf")))
      .forEach((s) => out.push([s.alongCm - s.model.w / 2 - gap, s.alongCm + s.model.w / 2 + gap]));
    return out;
  };
  const hang = (kind, label, model, order, near) => {
    for (const wi of order) {
      const fitsHere = stretches(walls[wi], wallBlocked(wi)).filter(([f, t]) => t - f >= model.w);
      if (!fitsHere.length) continue;
      const want = near ? near(wi) : null;
      let best = null;
      for (const [f, t] of fitsHere) {
        const target = want === null ? (f + t) / 2 : want;
        const c = Math.max(f + model.w / 2, Math.min(t - model.w / 2, target));
        const cost = want === null ? -(t - f) : Math.abs(c - want);
        if (!best || cost < best.cost) best = { c, cost };
      }
      push({ kind, label, model, level: "wall", wallIndex: wi, alongCm: best.c, outCm: model.d / 2, rect: wallRect(walls[wi], best.c, Math.max(model.d, 2) / 2, model.w, Math.max(model.d, 2)) });
      return true;
    }
    return false;
  };
  const sideWalls = walls.map((w, i) => i).filter((i) => i !== tv.wi && (!sofa || i !== sofa.wi));

  if (sofa && extras.wallArt) {
    // Flat pieces short enough to clear the sofa back when hung by their top at 7 ft.
    const clearHeight = cm(opts.hangTopMm) - (sofa.s.h || 85) - 20;
    const art = sized("wallArt", (m) => m.d <= 5 && m.h >= 40 && m.h <= clearHeight && m.w <= sofa.s.w);
    const piece = pickOne(art, pickClosest(art, sofa.s.w * 0.6));
    if (!piece) skipped.push({ kind: "wallArt", reason: "no wall art that clears the sofa back" });
    else {
      // Only right above the sofa: centred on it, nowhere else on that wall.
      const wall = sofa.wall;
      const fitsAbove = stretches(wall, wallBlocked(sofa.wi)).some(([f, t]) => f <= sofa.t - piece.w / 2 && t >= sofa.t + piece.w / 2);
      if (!fitsAbove) skipped.push({ kind: "wallArt", reason: "a window or door is above the sofa" });
      else
        push({ kind: "wallArt", label: "Wall art", model: piece, level: "wall", wallIndex: sofa.wi, alongCm: sofa.t, outCm: piece.d / 2, rect: wallRect(wall, sofa.t, Math.max(piece.d, 2) / 2, piece.w, Math.max(piece.d, 2)) });
    }
  }

  // Bookshelf on a side wall, clear in front, never before a window or door.
  if (extras.bookshelf) {
    const shelves = sized("bookshelf", (m) => m.d > 0 && m.h >= 80);
    const shelf = pickOne(shelves, shelves[0]);
    let shelved = false;
    const order = vary ? shuffled(sideWalls, rand) : sideWalls;
    for (const wi of shelf ? order : []) {
      const wall = walls[wi];
      for (const span of stretches(wall, [...gapDoors(wall, cm(opts.doorClearanceMm)), ...gapWindows(wall, cm(opts.windowMarginMm))])) {
        for (const t of [span[0] + shelf.w / 2 + 5, span[1] - shelf.w / 2 - 5, (span[0] + span[1]) / 2]) {
          if (span[1] - span[0] < shelf.w + 10) break;
          const rect = wallRect(wall, t, shelf.d / 2, shelf.w, shelf.d);
          const front = wallRect(wall, t, shelf.d + cm(opts.bookshelfFrontClearanceMm) / 2, shelf.w, cm(opts.bookshelfFrontClearanceMm));
          if (!free(rect) || !insideRoom(front, poly) || taken.some((r) => overlaps(front, r))) continue;
          taken.push(rect);
          push({ kind: "bookshelf", label: "Bookshelf", model: shelf, level: "floor", wallIndex: wi, alongCm: t, outCm: shelf.d / 2, flush: true, rect });
          shelved = true;
          break;
        }
        if (shelved) break;
      }
      if (shelved) break;
    }
    if (!shelved) skipped.push({ kind: "bookshelf", reason: shelf ? "no free side wall with room in front" : "no bookshelf in the catalogue" });
  }

  if (extras.ac) {
    const ac = sized("ac")[0];
    if (!ac) skipped.push({ kind: "ac", reason: "no AC in the catalogue" });
    else if (!hang("ac", "AC", ac, sideWalls.length ? sideWalls : [sofa ? sofa.wi : tv.wi], null))
      skipped.push({ kind: "ac", reason: "no free wall for it" });
  }

  // Plant in a free corner of the TV wall (either side of the TV feature).
  if (extras.plant) {
    const plants = sized("plant", (m) => m.d > 0 && m.w <= 120 && m.d <= 120);
    const plant = pickOne(plants, pickClosest(plants, 60));
    let potted = false;
    const spots = plant
      ? [tv.span[0] + plant.w / 2 + 5, tv.span[1] - plant.w / 2 - 5].filter(
          (t) => t + plant.w / 2 <= featureSpan[0] - 5 || t - plant.w / 2 >= featureSpan[1] + 5
        )
      : [];
    for (const t of vary ? shuffled(spots, rand) : spots) {
      const rect = wallRect(tvWall, t, plant.d / 2, plant.w, plant.d);
      if (!free(rect)) continue;
      taken.push(rect);
      push({ kind: "plant", label: "Plant", model: plant, level: "floor", wallIndex: tv.wi, alongCm: t, outCm: plant.d / 2, flush: true, rect });
      potted = true;
      break;
    }
    if (!potted) skipped.push({ kind: "plant", reason: plant ? "no free corner beside the TV wall" : "no plant of a room size" });
  }

  if (extras.light) {
    const lights = sized("light", (m) => m.w >= 20 && m.w <= 80);
    const light = pickOne(lights, pickClosest(lights, 60));
    if (!light) skipped.push({ kind: "light", reason: "no ceiling light of a room size" });
    else push({ kind: "light", label: "Ceiling light", model: light, level: "ceiling" });
  }

  return { tvWallIndex: tv.wi, slots, skipped };
}
