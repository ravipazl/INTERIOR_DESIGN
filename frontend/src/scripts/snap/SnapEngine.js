/**
 * SnapEngine — Phase 1
 *
 * Coordinates "snap" suggestions for the in-scene drag handler. The drag
 * handler calls `SnapManager.query(dragged, candidateLocation)` every move
 * tick. The manager asks each enabled SnapSource for a SnapCandidate,
 * picks the highest-priority candidate within tolerance, and returns it.
 *
 * Each source implements:
 *   findSnap(ctx) → { position: Vector3, kind: string, priority: number,
 *                     label?: string } | null
 *
 * SnapContext (ctx) shape:
 *   {
 *     dragged: Physical3DItem,            // the item being moved
 *     itemBox: Box3,                      // its bounding box at the
 *                                         //   candidate location
 *     itemHalfSize: Vector3,              // half-extent of the item
 *     candidate: Vector3,                 // raw cursor location (the
 *                                         //   handler's pre-snap position)
 *     candidateNormal: Vector3,           // floor/wall normal at cursor
 *     intersectingPlane: Object3D,        // the plane the cursor hit
 *     floorplan: Floorplan,               // engine floorplan (walls, ...)
 *     draggableItems: Physical3DItem[],   // other items in the scene
 *     config: SnapConfig,
 *   }
 *
 * Phase 1 deliverables in this file:
 *   - SnapConfig (defaults + per-source toggle)
 *   - WallSnap   (back edge → nearest wall surface)
 *   - GridSnap   (round to nearest gridStep)
 *   - SnapManager (driver)
 *
 * Phase 2 added object-edge / object-centre snaps.
 * Phase 3 adds CornerSnap (the inside corner where two walls meet) and a
 * `guide` field on every candidate — an array of world-space line segments
 * the SnapIndicator draws so the user can SEE what the item snapped to.
 *
 * Candidate `guide` shape (optional):
 *   guide: { lines: [ [Vector3, Vector3], ... ] }
 */

import { Vector2, Vector3, Box3 } from "three";

// ---------------------------------------------------------------------------
// Config

export class SnapConfig {
  constructor(overrides = {}) {
    this.enabled = {
      wall: true,
      objectEdge: true,
      objectCenter: true,
      corner: true, // phase 3 — CornerSnap (inside corner of two walls)
      grid: false, // designers usually prefer freeform; user can toggle
      surface: true, // rest an item ON TOP of another (flower pot on a table)
      ...(overrides.enabled || {}),
    };
    this.tolerance = {
      // SMOOTH MOVEMENT (Coohom method): small catch radii so the item follows
      // the mouse smoothly across the floor and only snaps when brought CLOSE to
      // a wall/corner — instead of jumping to it from far away. Was 40 cm (too
      // grabby). 10 cm feels like Coohom: free move, snap only near contact.
      wall: 6, // cm — snap flush only when the item is almost touching the wall
      objectEdge: 6,
      objectCenter: 4,
      corner: 8, // cm — corner still slightly wider than a single wall so a
      //             near-corner item tucks into BOTH walls. Set 0 to disable.
      grid: 10,
      ...(overrides.tolerance || {}),
    };
    this.gridStep = overrides.gridStep ?? 10; // cm
    // Extra push beyond item halfSize when snapping to a wall, in cm.
    // Default 10 = pazl's standard wall thickness. The engine's wall mesh
    // renders with the corner-to-corner line on the exterior face and the
    // interior face offset inward by full thickness, so items need to
    // push by `thickness` past the corner line to land flush with the
    // visible interior face. Override per-project if your walls use a
    // different thickness.
    this.wallExtraOffset = overrides.wallExtraOffset ?? 10;
  }
}

// Priority ranks — higher wins when multiple sources match.
const PRIORITY = {
  corner: 5,
  wall: 4,
  objectEdge: 3,
  objectCenter: 2,
  grid: 1,
};

// World-space Y (cm above the floor) at which snap guide lines are drawn.
// A small positive offset keeps the line just above the floor mesh so the
// indicator stays visible and doesn't z-fight with the floor.
const GUIDE_Y = 2;

// Compute a world-space bounding box from the VISIBLE meshes of an item.
// Mirrors the dragged-item bbox derivation in SnapManager.query so
// dragged-item and "other items" use the same convention.
function tightBoxOf(physicalItem) {
  if (!physicalItem?.__loadedItem) return null;
  const box = new Box3();
  box.makeEmpty();
  physicalItem.__loadedItem.traverse((o) => {
    if (
      o.isMesh &&
      o.visible &&
      o.geometry &&
      o.geometry.attributes?.position
    ) {
      o.updateWorldMatrix(true, false);
      const localBox = new Box3().setFromBufferAttribute(
        o.geometry.attributes.position
      );
      localBox.applyMatrix4(o.matrixWorld);
      box.union(localBox);
    }
  });
  return box.isEmpty() ? null : box;
}

// ---------------------------------------------------------------------------
// WallSnap — snaps the dragged item so its bbox edge touches a wall surface
//
// Approach: for every wall in the floorplan, compute the wall's 2D segment
// (corner.x, corner.y in cm) and its normal. For each candidate position,
// project the dragged item's bbox edges onto the wall normal. If the gap
// between the nearest item edge and the wall is within tolerance, return
// a snapped position that closes the gap.

class WallSnap {
  findSnap(ctx) {
    if (!ctx.config.enabled.wall) return null;
    const walls = ctx.floorplan?.walls || [];
    if (!walls.length) return null;

    const tolerance = ctx.config.tolerance.wall;
    let best = null;

    for (const wall of walls) {
      const candidate = this._snapToWall(ctx, wall, tolerance);
      if (!candidate) continue;
      if (!best || candidate._distance < best._distance) {
        best = candidate;
      }
    }
    if (!best) return null;
    delete best._distance;
    return best;
  }

  _snapToWall(ctx, wall, tolerance) {
    // Wall corners are in cm (after Dimensioning.cmFromMeasureRaw on load).
    // Wall has `start` and `end` Corner objects with .x and .y.
    const start = wall.start;
    const end = wall.end;
    if (!start || !end) return null;

    // Wall segment in 3D world space (Y is up; floor plane uses X/Z).
    // Pazl convention: floorplan x → world x, floorplan y → world z.
    const a = { x: start.x, z: start.y };
    const b = { x: end.x, z: end.y };

    // 2D normal (perpendicular to wall direction, unit length).
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return null;
    const nx = -dz / len;
    const nz = dx / len;

    // Distance from item centre to wall centreline (signed along normal).
    const cx = ctx.candidate.x;
    const cz = ctx.candidate.z;
    const dist = (cx - a.x) * nx + (cz - a.z) * nz;

    // Push the item so its edge sits exactly at the corner-to-corner line.
    // We then nudge by an optional `wallExtraOffset` calibration to account
    // for the wall renderer's actual interior-face position relative to
    // that line. Default 0 (treat the corner line as the interior face);
    // tune via SnapManager.setWallOffset() if your walls render with a
    // different offset.
    // FLOOR units auto-rotate so their BACK faces whichever wall they're
    // dragged near — so snapping works identically on all four walls,
    // regardless of the unit's current orientation. We therefore use the
    // unit's DEPTH (its shorter horizontal half-extent) as the distance to
    // the wall. Other item types keep the per-axis behaviour.
    // Snap the item flush to the wall using its actual extent toward that
    // wall (X-extent for left/right walls, Z-extent for front/back). No
    // forced rotation — the item keeps its orientation; the user rotates it
    // when they want (like SketchUp). The generous wall tolerance (see
    // SnapConfig) makes all four walls catch easily.
    const halfAlongNormal =
      Math.abs(nx) > Math.abs(nz) ? ctx.itemHalfSize.x : ctx.itemHalfSize.z;
    const wallOffset = ctx.config.wallExtraOffset ?? 0;
    const targetCentreDistance = halfAlongNormal + wallOffset;
    const gap = Math.abs(dist) - targetCentreDistance;
    if (gap > tolerance || gap < -targetCentreDistance) return null;

    // Build the snapped centre for a given side (+1 / -1 along the normal).
    const makeSnapped = (sgn) =>
      new Vector3(
        cx - dist * nx + sgn * targetCentreDistance * nx,
        ctx.candidate.y,
        cz - dist * nz + sgn * targetCentreDistance * nz
      );

    // NEVER snap furniture to the EXTERIOR face of a wall. The natural side is
    // whichever side the item's centre is on — but if that lands the centre
    // OUTSIDE every room, flip to the interior side instead. For internal walls
    // (a room on both sides) the first side is already inside, so nothing
    // changes there.
    const rooms = (ctx.floorplan && ctx.floorplan.rooms) || [];
    const centreInsideRoom = (p) =>
      rooms.length === 0 ||
      rooms.some((r) => r && r.pointInRoom && r.pointInRoom(new Vector2(p.x, p.z)));

    const sign = dist >= 0 ? 1 : -1;
    let finalSign = sign;
    let snapped = makeSnapped(sign);
    if (!centreInsideRoom(snapped)) {
      const flipped = makeSnapped(-sign);
      if (centreInsideRoom(flipped)) {
        snapped = flipped;
        finalSign = -sign;
      } else {
        // Neither side keeps the item inside a room — refuse to snap rather
        // than push it outside the building.
        return null;
      }
    }

    return {
      position: snapped,
      kind: "wall",
      priority: PRIORITY.wall,
      label: "Wall",
      // Interior normal — points from the wall toward the item's side (into the
      // room). The drag handler uses this to AUTO-ORIENT the item so its back
      // faces the wall (its front faces the room).
      normal: { x: finalSign * nx, y: 0, z: finalSign * nz },
      _distance: gap,
      guide: {
        lines: [
          [
            new Vector3(a.x, GUIDE_Y, a.z),
            new Vector3(b.x, GUIDE_Y, b.z),
          ],
        ],
      },
    };
  }
}

// ---------------------------------------------------------------------------
// CornerSnap — snaps the dragged item into the inside corner where two walls
// meet, so BOTH of its perpendicular edges land flush against the two walls
// at once. This is the natural placement for wardrobes, bookshelves and
// L-shaped furniture.
//
// For every pair of walls that share a Corner, the interior normal of each
// wall is oriented toward the cursor (so the corner the user is dragging
// near is the one targeted). The item centre target is:
//   corner + n1·(halfAlongN1 + wallOffset) + n2·(halfAlongN2 + wallOffset)
// — i.e. each edge sits `wallOffset` from its wall's corner line, exactly
// the same offset WallSnap uses, so a corner snap is just two wall snaps
// resolved together. Higher priority than WallSnap, so being near a corner
// always wins over a plain flat-wall snap.

class CornerSnap {
  findSnap(ctx) {
    if (!ctx.config.enabled.corner) return null;
    const walls = ctx.floorplan?.walls || [];
    if (walls.length < 2) return null;

    const tolerance = ctx.config.tolerance.corner;
    const cx = ctx.candidate.x;
    const cz = ctx.candidate.z;
    const wallOffset = ctx.config.wallExtraOffset ?? 0;

    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const corner = this._sharedCorner(walls[i], walls[j]);
        if (!corner) continue;

        const n1 = this._wallNormalToward(walls[i], ctx.candidate);
        const n2 = this._wallNormalToward(walls[j], ctx.candidate);
        if (!n1 || !n2) continue;

        // Near-parallel walls don't form a usable inside corner.
        const cross = n1.x * n2.z - n1.z * n2.x;
        if (Math.abs(cross) < 0.2) continue;

        const off1 =
          Math.abs(n1.x) > Math.abs(n1.z)
            ? ctx.itemHalfSize.x
            : ctx.itemHalfSize.z;
        const off2 =
          Math.abs(n2.x) > Math.abs(n2.z)
            ? ctx.itemHalfSize.x
            : ctx.itemHalfSize.z;

        // Corner.x → world x, Corner.y → world z (pazl 2D convention).
        const tx =
          corner.x + n1.x * (off1 + wallOffset) + n2.x * (off2 + wallOffset);
        const tz =
          corner.y + n1.z * (off1 + wallOffset) + n2.z * (off2 + wallOffset);

        const dist = Math.hypot(cx - tx, cz - tz);
        if (dist > tolerance || dist >= bestDist) continue;
        bestDist = dist;
        best = {
          position: new Vector3(tx, ctx.candidate.y, tz),
          kind: "corner",
          priority: PRIORITY.corner,
          label: "Corner",
          // Diagonal interior normal (sum of both wall interior normals) — the
          // drag handler uses it to auto-orient the item into the corner so its
          // two backs face the two walls.
          normal: { x: n1.x + n2.x, y: 0, z: n1.z + n2.z },
          guide: {
            lines: [this._wallGuide(walls[i]), this._wallGuide(walls[j])],
          },
        };
      }
    }
    return best;
  }

  // The Corner shared by two walls, or null. Pazl normally keeps one Corner
  // instance per junction (reference compare), but we also fall back to a
  // coordinate match (1 cm epsilon) in case a floorplan doesn't dedupe.
  _sharedCorner(w1, w2) {
    const a = [w1.start, w1.end];
    const b = [w2.start, w2.end];
    for (const c1 of a) {
      for (const c2 of b) {
        if (!c1 || !c2) continue;
        if (c1 === c2) return c1;
        if (Math.abs(c1.x - c2.x) < 1 && Math.abs(c1.y - c2.y) < 1) {
          return c1;
        }
      }
    }
    return null;
  }

  // Unit 2D normal of the wall, flipped to point toward the cursor.
  _wallNormalToward(wall, candidate) {
    const s = wall.start;
    const e = wall.end;
    if (!s || !e) return null;
    const dx = e.x - s.x;
    const dz = e.y - s.y;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return null;
    let nx = -dz / len;
    let nz = dx / len;
    const dot = (candidate.x - s.x) * nx + (candidate.z - s.y) * nz;
    if (dot < 0) {
      nx = -nx;
      nz = -nz;
    }
    return { x: nx, z: nz };
  }

  _wallGuide(wall) {
    return [
      new Vector3(wall.start.x, GUIDE_Y, wall.start.y),
      new Vector3(wall.end.x, GUIDE_Y, wall.end.y),
    ];
  }
}

// ---------------------------------------------------------------------------
// ObjectEdgeSnap — snap dragged item's edge flush against another item's edge.
//
// For each other item we test four sides — dragged on +X, -X, +Z, -Z of the
// neighbour. A snap fires only if (a) the perpendicular gap to that neighbour
// edge is within tolerance, and (b) the items overlap on the perpendicular
// axis (otherwise they aren't really "next to" each other).
//
// Picks the closest candidate across all neighbours.

class ObjectEdgeSnap {
  findSnap(ctx) {
    if (!ctx.config.enabled.objectEdge) return null;
    const tolerance = ctx.config.tolerance.objectEdge;
    const draggedHalf = ctx.itemHalfSize;
    const cx = ctx.candidate.x;
    const cz = ctx.candidate.z;

    let best = null;
    let bestDelta = Infinity;

    for (const other of ctx.draggableItems) {
      if (!other || other === ctx.dragged) continue;
      if (!other.position) continue;

      // Quick reject for items far away. The proximity bound is a bit
      // generous so we don't miss a valid snap on a large neighbour.
      const ox = other.position.x;
      const oz = other.position.z;
      const dxApprox = ox - cx;
      const dzApprox = oz - cz;
      if (dxApprox * dxApprox + dzApprox * dzApprox > 300 * 300) continue;

      const otherBox = tightBoxOf(other);
      if (!otherBox) continue;
      const otherCenter = new Vector3();
      const otherSize = new Vector3();
      otherBox.getCenter(otherCenter);
      otherBox.getSize(otherSize);
      const otherHalf = otherSize.multiplyScalar(0.5);

      // Z overlap is required for a left/right (X) edge snap.
      const zOverlap =
        Math.abs(cz - otherCenter.z) <= otherHalf.z + draggedHalf.z;
      // X overlap is required for a front/back (Z) edge snap.
      const xOverlap =
        Math.abs(cx - otherCenter.x) <= otherHalf.x + draggedHalf.x;

      const candidates = [];
      if (zOverlap) {
        candidates.push({
          axis: "x",
          target: otherCenter.x + otherHalf.x + draggedHalf.x,
        });
        candidates.push({
          axis: "x",
          target: otherCenter.x - otherHalf.x - draggedHalf.x,
        });
      }
      if (xOverlap) {
        candidates.push({
          axis: "z",
          target: otherCenter.z + otherHalf.z + draggedHalf.z,
        });
        candidates.push({
          axis: "z",
          target: otherCenter.z - otherHalf.z - draggedHalf.z,
        });
      }

      for (const c of candidates) {
        const here = c.axis === "x" ? cx : cz;
        const delta = Math.abs(here - c.target);
        if (delta > tolerance || delta >= bestDelta) continue;
        bestDelta = delta;

        // Guide line = the contact face shared by the two items, spanning
        // only the region where they actually overlap on the other axis.
        let guideLine;
        if (c.axis === "x") {
          const sign = c.target > otherCenter.x ? 1 : -1;
          const contactX = otherCenter.x + sign * otherHalf.x;
          const zMin = Math.max(cz - draggedHalf.z, otherCenter.z - otherHalf.z);
          const zMax = Math.min(cz + draggedHalf.z, otherCenter.z + otherHalf.z);
          guideLine = [
            new Vector3(contactX, GUIDE_Y, zMin),
            new Vector3(contactX, GUIDE_Y, zMax),
          ];
        } else {
          const sign = c.target > otherCenter.z ? 1 : -1;
          const contactZ = otherCenter.z + sign * otherHalf.z;
          const xMin = Math.max(cx - draggedHalf.x, otherCenter.x - otherHalf.x);
          const xMax = Math.min(cx + draggedHalf.x, otherCenter.x + otherHalf.x);
          guideLine = [
            new Vector3(xMin, GUIDE_Y, contactZ),
            new Vector3(xMax, GUIDE_Y, contactZ),
          ];
        }

        best = {
          position: new Vector3(
            c.axis === "x" ? c.target : cx,
            ctx.candidate.y,
            c.axis === "z" ? c.target : cz
          ),
          kind: "objectEdge",
          priority: PRIORITY.objectEdge,
          label: "Edge",
          guide: { lines: [guideLine] },
        };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// ObjectCenterSnap — snap dragged item's centre to align with another item's
// centre on either the X or Z axis. (Helps with "TV centred with sofa" /
// "bed centred with wardrobe behind it" layouts.)

class ObjectCenterSnap {
  findSnap(ctx) {
    if (!ctx.config.enabled.objectCenter) return null;
    const tolerance = ctx.config.tolerance.objectCenter;
    const cx = ctx.candidate.x;
    const cz = ctx.candidate.z;

    let best = null;
    let bestDelta = Infinity;

    for (const other of ctx.draggableItems) {
      if (!other || other === ctx.dragged) continue;
      if (!other.position) continue;

      const ox = other.position.x;
      const oz = other.position.z;
      const dxApprox = ox - cx;
      const dzApprox = oz - cz;
      if (dxApprox * dxApprox + dzApprox * dzApprox > 300 * 300) continue;

      const otherBox = tightBoxOf(other);
      if (!otherBox) continue;
      const otherCenter = new Vector3();
      otherBox.getCenter(otherCenter);

      const deltaX = Math.abs(cx - otherCenter.x);
      if (deltaX <= tolerance && deltaX < bestDelta) {
        bestDelta = deltaX;
        best = {
          position: new Vector3(otherCenter.x, ctx.candidate.y, cz),
          kind: "objectCenter",
          priority: PRIORITY.objectCenter,
          label: "Centre X",
          // Alignment line: through the shared X, joining both centres.
          guide: {
            lines: [
              [
                new Vector3(otherCenter.x, GUIDE_Y, otherCenter.z),
                new Vector3(otherCenter.x, GUIDE_Y, cz),
              ],
            ],
          },
        };
      }
      const deltaZ = Math.abs(cz - otherCenter.z);
      if (deltaZ <= tolerance && deltaZ < bestDelta) {
        bestDelta = deltaZ;
        best = {
          position: new Vector3(cx, ctx.candidate.y, otherCenter.z),
          kind: "objectCenter",
          priority: PRIORITY.objectCenter,
          label: "Centre Z",
          // Alignment line: through the shared Z, joining both centres.
          guide: {
            lines: [
              [
                new Vector3(otherCenter.x, GUIDE_Y, otherCenter.z),
                new Vector3(cx, GUIDE_Y, otherCenter.z),
              ],
            ],
          },
        };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// GridSnap — rounds the position to the nearest gridStep on X and Z

class GridSnap {
  findSnap(ctx) {
    if (!ctx.config.enabled.grid) return null;
    const step = ctx.config.gridStep;
    if (!step || step <= 0) return null;

    const round = (v) => Math.round(v / step) * step;
    const snappedX = round(ctx.candidate.x);
    const snappedZ = round(ctx.candidate.z);

    // Only emit if at least one axis actually moved meaningfully — avoids
    // jitter when the cursor is already on-grid.
    if (
      Math.abs(snappedX - ctx.candidate.x) < 0.5 &&
      Math.abs(snappedZ - ctx.candidate.z) < 0.5
    ) {
      return null;
    }

    return {
      position: new Vector3(snappedX, ctx.candidate.y, snappedZ),
      kind: "grid",
      priority: PRIORITY.grid,
      label: `Grid ${step}cm`,
    };
  }
}

// ---------------------------------------------------------------------------
// SurfaceSnap — rest the dragged item ON TOP of another item it is hovering
// over (e.g. a flower pot on a table). Unlike the other sources this does NOT
// change X/Z — it only reports the supporting surface's TOP height so the
// dragged item's resting Y can be raised onto it. The dragged item's centre
// must sit over the support's footprint; if it isn't over anything, no support
// is returned and the item drops back to the floor.
//
// Returned separately from query() (see SnapManager.querySupport) because it is
// orthogonal to the horizontal snaps: a pot can edge-align in X/Z AND rest on
// a table at the same time.

class SurfaceSnap {
  findSupport(ctx) {
    if (ctx.config.enabled.surface === false) return null;
    const cx = ctx.candidate.x;
    const cz = ctx.candidate.z;

    let best = null; // the highest top surface under the cursor
    for (const other of ctx.draggableItems) {
      if (!other || other === ctx.dragged) continue;
      if (!other.position) continue;

      // Cheap proximity reject before the (more expensive) bbox build.
      const dx = other.position.x - cx;
      const dz = other.position.z - cz;
      if (dx * dx + dz * dz > 400 * 400) continue;

      const box = tightBoxOf(other);
      if (!box) continue;
      const center = new Vector3();
      const size = new Vector3();
      box.getCenter(center);
      box.getSize(size);
      const half = size.multiplyScalar(0.5);

      // The dragged item's centre must be over this item's footprint.
      if (Math.abs(cx - center.x) > half.x) continue;
      if (Math.abs(cz - center.z) > half.z) continue;

      const topY = center.y + half.y;
      if (!best || topY > best.topY) {
        best = { topY, item: other };
      }
    }
    if (!best) return null;

    // Land the dragged item's ACTUAL visible bottom exactly on the support's
    // visible top. Using its real bounding box (not metadata halfSize) makes
    // this robust to off-centre pivots and padded GLBs — otherwise the item
    // floats above or sinks into the surface. `bottomOffset` is the gap from
    // the item's pivot (position.y) down to its lowest visible point, which is
    // invariant under Y-rotation, so it holds wherever the item currently is.
    const dBox = tightBoxOf(ctx.dragged);
    const bottomOffset =
      dBox && typeof ctx.dragged.position?.y === "number"
        ? ctx.dragged.position.y - dBox.min.y
        : ctx.dragged.itemModel?.halfSize?.y ?? 0;
    best.restPivotY = best.topY + bottomOffset;

    return best;
  }
}

// ---------------------------------------------------------------------------
// SnapManager — driver

export class SnapManager {
  constructor(config) {
    this.config = config instanceof SnapConfig ? config : new SnapConfig(config);
    this.sources = [
      new WallSnap(),
      new CornerSnap(),
      new ObjectEdgeSnap(),
      new ObjectCenterSnap(),
      new GridSnap(),
    ];
    // Vertical stacking (pot-on-table). Queried separately from the horizontal
    // sources via querySupport() since it only affects Y.
    this.__surfaceSnap = new SurfaceSnap();
    this.lastSnap = null;
    this.debug = false; // toggle via BlueprintInterface.setSnapDebug(true)
    // Master switch. When false, query() short-circuits and the engine
    // behaves as if it weren't there at all — used by the toolbar's
    // single "Snapping" on/off toggle. Per-source flags in `config.enabled`
    // are preserved so toggling the master back on restores the prior set.
    // DEFAULT OFF: dragging is smooth/free by default; the user turns Snap ON
    // (via the bottom-left toggle) only when they want items to align/snap.
    this.active = false;
  }

  /**
   * Query for a snap on this drag tick.
   * @param {object} input
   * @param {Physical3DItem} input.dragged
   * @param {Vector3} input.candidate   raw cursor world position
   * @param {Vector3} input.candidateNormal  floor/wall normal at cursor
   * @param {Object3D} input.intersectingPlane  plane the cursor hit
   * @param {object} input.floorplan
   * @param {Array} input.draggableItems
   * @returns {{position:Vector3, kind:string, label:string}|null}
   */
  query(input) {
    if (!this.active) {
      this.lastSnap = null;
      return null;
    }
    if (!input?.dragged || !input?.candidate) {
      if (this.debug) console.log("[Snap] no dragged or candidate");
      return null;
    }
    if (input.shiftHeld) {
      this.lastSnap = null;
      return null;
    }
    // Prefer the runtime-rendered bbox of just the VISIBLE meshes (skip
    // helpers, invisible planes, empty Groups). This is what the user
    // actually sees on screen and is the right anchor for "touch the
    // wall" math. Falls back to metadata halfSize if no loaded item yet.
    let halfSize;
    if (input.dragged?.__loadedItem) {
      const tight = new Box3();
      tight.makeEmpty();
      input.dragged.__loadedItem.traverse((o) => {
        if (
          o.isMesh &&
          o.visible &&
          o.geometry &&
          o.geometry.attributes?.position
        ) {
          o.updateWorldMatrix(true, false);
          const localBox = new Box3().setFromBufferAttribute(
            o.geometry.attributes.position
          );
          localBox.applyMatrix4(o.matrixWorld);
          tight.union(localBox);
        }
      });
      if (!tight.isEmpty()) {
        const size = new Vector3();
        tight.getSize(size);
        halfSize = size.multiplyScalar(0.5);
        if (this.debug) {
          console.log(
            "[Snap] tight-bbox halfSize",
            halfSize.toArray().map((n) => n.toFixed(1))
          );
        }
      }
    }
    if (!halfSize) {
      halfSize =
        input.dragged.itemModel?.halfSize ||
        input.dragged.__itemModel?.halfSize ||
        new Vector3(1, 1, 1);
    }
    const itemBox = new Box3().setFromCenterAndSize(
      input.candidate.clone(),
      halfSize.clone().multiplyScalar(2)
    );
    const ctx = {
      dragged: input.dragged,
      itemBox,
      itemHalfSize: halfSize,
      candidate: input.candidate,
      candidateNormal: input.candidateNormal,
      intersectingPlane: input.intersectingPlane,
      floorplan: input.floorplan,
      draggableItems: input.draggableItems || [],
      config: this.config,
    };

    if (this.debug) {
      console.log("[Snap] query", {
        candidate: input.candidate?.toArray?.(),
        halfSize: halfSize?.toArray?.(),
        wallCount: input.floorplan?.walls?.length,
        config: this.config.enabled,
      });
    }

    let best = null;
    for (const src of this.sources) {
      const cand = src.findSnap(ctx);
      if (!cand) continue;
      if (this.debug) {
        console.log("[Snap]   ←", cand.kind, "@", cand.position?.toArray?.());
      }
      if (!best || cand.priority > best.priority) best = cand;
    }
    if (this.debug) {
      console.log("[Snap] result:", best?.kind ?? "none");
    }
    this.lastSnap = best;
    return best;
  }

  /**
   * Query for a vertical SUPPORT surface under the dragged item (stacking).
   * Independent of query() — returns { topY, item } or null. When null, the
   * dragged item should rest on the floor.
   */
  querySupport(input) {
    if (!this.active) return null;
    if (input?.shiftHeld) return null;
    if (!input?.dragged || !input?.candidate) return null;
    const ctx = {
      dragged: input.dragged,
      candidate: input.candidate,
      draggableItems: input.draggableItems || [],
      config: this.config,
    };
    return this.__surfaceSnap.findSupport(ctx);
  }

  setActive(on) {
    this.active = !!on;
  }

  setDebug(on) {
    this.debug = !!on;
  }

  setEnabled(kind, enabled) {
    if (kind in this.config.enabled) this.config.enabled[kind] = !!enabled;
  }

  setTolerance(kind, cm) {
    if (kind in this.config.tolerance) this.config.tolerance[kind] = Number(cm);
  }

  setGridStep(cm) {
    this.config.gridStep = Number(cm);
  }

  setWallOffset(cm) {
    this.config.wallExtraOffset = Number(cm);
  }
}

export default SnapManager;
