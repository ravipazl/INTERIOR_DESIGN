import { pointInPolygon, intersectRect, MIN_REGION_CM } from "./wallRegions.js";

/**
 * A ROOM'S CEILING, AS THE WALL EDITOR NEEDS A FACE.
 *
 * The Ceiling Editor is the Wall Editor opened on a room's ceiling instead of
 * on a side of a wall. Everything it draws — areas, materials, drops, light
 * strips — is the same region data a wall face keeps, only stored per room on
 * the floorplan (floorplan.ceilingRegions) instead of on a wall.
 *
 * The face is the ceiling's bounding box, seen FROM ABOVE, the same way round
 * as the plan:
 *
 *   · x runs with the plan's x, from the room's leftmost inside corner;
 *   · y runs UP the editor, which is towards the plan's top — y = 0 is the
 *     room's bottom inside edge (largest plan y), so world z = maxZ − y.
 *
 * Whatever of that box is not ceiling — the notch of an L-shaped room — is
 * handed to the editor as "openings", exactly like a wall's doors: nothing is
 * drawn there, in the editor or in 3D.
 */

/** The event a room sends when its ceiling areas change (Floor3D redraws). */
export const EVENT_CEILING_REGIONS_CHANGED = "CEILING_REGIONS_CHANGED";

/** Below this a step in a slanted edge is too small to matter (cm). */
const STEP_CM = 5;

/** The room's inside outline, as [x, z] plan points. */
const outlineOf = (room) =>
  ((room && room.interiorCorners) || [])
    .map((c) => [Number(c.x), Number(c.y)])
    .filter((p) => isFinite(p[0]) && isFinite(p[1]));

/**
 * The parts of the box (in plan x/z) that are not inside the outline, as
 * rectangles. The box is cut on every corner's x and z; a straight-walled
 * room is then exactly cells that are wholly in or wholly out. A slanted wall
 * also gets cuts every few centimetres across its span, so it is followed as
 * a fine step.
 */
const outsideRects = (outline, minX, maxX, minZ, maxZ) => {
  const xs = new Set([minX, maxX]);
  const zs = new Set([minZ, maxZ]);
  outline.forEach((p, i) => {
    xs.add(p[0]);
    zs.add(p[1]);
    const q = outline[(i + 1) % outline.length];
    const slanted = Math.abs(q[0] - p[0]) > 0.01 && Math.abs(q[1] - p[1]) > 0.01;
    if (!slanted) return;
    const x0 = Math.min(p[0], q[0]);
    const x1 = Math.max(p[0], q[0]);
    const z0 = Math.min(p[1], q[1]);
    const z1 = Math.max(p[1], q[1]);
    for (let x = x0 + STEP_CM; x < x1; x += STEP_CM) xs.add(x);
    for (let z = z0 + STEP_CM; z < z1; z += STEP_CM) zs.add(z);
  });
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);

  // Row by row: the runs of cells outside the room.
  const rows = [];
  for (let j = 0; j + 1 < Z.length; j++) {
    const z0 = Z[j];
    const z1 = Z[j + 1];
    if (z1 - z0 < 1e-6) continue;
    const zc = (z0 + z1) / 2;
    const runs = [];
    let start = null;
    for (let i = 0; i + 1 < X.length; i++) {
      const xc = (X[i] + X[i + 1]) / 2;
      const out = !pointInPolygon(outline, xc, zc);
      if (out && start === null) start = X[i];
      if (!out && start !== null) {
        runs.push([start, X[i]]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, X[X.length - 1]]);
    rows.push({ z0, z1, runs });
  }

  // A run that carries on unchanged into the next row is one rectangle.
  const done = [];
  let open = [];
  rows.forEach((row) => {
    const next = [];
    row.runs.forEach(([a, b]) => {
      const k = open.findIndex(
        (r) => Math.abs(r.x0 - a) < 1e-6 && Math.abs(r.x1 - b) < 1e-6 && Math.abs(r.z1 - row.z0) < 1e-6
      );
      if (k >= 0) {
        const r = open.splice(k, 1)[0];
        r.z1 = row.z1;
        next.push(r);
      } else {
        next.push({ x0: a, x1: b, z0: row.z0, z1: row.z1 });
      }
    });
    done.push(...open);
    open = next;
  });
  done.push(...open);
  return done;
};

/**
 * The ceiling's face: { kind, width, height, openings, mirrored, frame }.
 * `frame` is what the 3D panels are built against (wallRegionMeshes): the
 * editor's x/y on the ceiling plane, and "out" downwards into the room.
 * Null when the room has no usable outline.
 */
export const faceOfCeiling = (room) => {
  const outline = outlineOf(room);
  if (outline.length < 3) return null;
  const minX = Math.min(...outline.map((p) => p[0]));
  const maxX = Math.max(...outline.map((p) => p[0]));
  const minZ = Math.min(...outline.map((p) => p[1]));
  const maxZ = Math.max(...outline.map((p) => p[1]));
  const width = maxX - minX;
  const height = maxZ - minZ;
  if (!(width > MIN_REGION_CM) || !(height > MIN_REGION_CM)) return null;

  const box = { x: 0, y: 0, w: width, h: height };
  const openings = outsideRects(outline, minX, maxX, minZ, maxZ)
    .map((r) =>
      intersectRect(
        { x: r.x0 - minX, y: maxZ - r.z1, w: r.x1 - r.x0, h: r.z1 - r.z0 },
        box
      )
    )
    .filter(Boolean);

  // The ceiling's height: the lowest of the room's wall tops, where the 3D
  // ceiling is drawn (Floor3D.buildRoofVaryingHeight, a hair above it).
  const elevations = ((room && room.corners) || [])
    .map((c) => Number(c.elevation))
    .filter((v) => isFinite(v) && v > 0);
  const ceilingY = (elevations.length ? Math.min(...elevations) : 0) + 0.3;

  return {
    kind: "ceiling",
    width,
    height,
    openings,
    mirrored: false,
    ceilingY,
    frame: {
      // Editor (x, y), `out` cm down from the ceiling → world [x, y, z].
      toWorld: (x, y, out) => [minX + x, ceilingY - out, maxZ - y],
      // The panels face down, into the room.
      faceNormal: [0, -1, 0],
      // A direction (ox, oy) in the editor, as a world direction.
      inPlane: (ox, oy) => [ox, 0, -oy],
      // Seen from below, the editor's anticlockwise is clockwise.
      forward: false,
      meshName: "ceiling",
    },
  };
};

/**
 * A room's ceiling as something the editor can open: its face, and where its
 * areas are read from and saved to. Null when the room has no ceiling to edit.
 */
export const ceilingSurfaceOf = (room) => {
  const floorplan = room && room.floorplan;
  if (!floorplan || typeof floorplan.getCeilingRegions !== "function") return null;
  const face = faceOfCeiling(room);
  if (!face) return null;
  const uuid = room.getUuid ? room.getUuid() : room.uuid;
  return {
    kind: "ceiling",
    room,
    face,
    label: room.name || "Room",
    getRegions: () => floorplan.getCeilingRegions(uuid),
    setRegions: (list) => {
      floorplan.setCeilingRegions(uuid, list);
      // Redraw just this room's ceiling.
      try {
        room.dispatchEvent({ type: EVENT_CEILING_REGIONS_CHANGED, item: room });
      } catch (e) {
        /* nothing listening */
      }
    },
  };
};
