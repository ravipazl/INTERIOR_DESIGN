import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  ShapeUtils,
  Vector2,
} from "three";
import { WallMaterial3D } from "../materials/WallMaterial3D.js";
import {
  regionBounds,
  regionsOverlap,
  signedArea,
  visibleParts,
} from "../model/wallRegions.js";

/**
 * THE 3D PANELS FOR A WALL FACE'S REGIONS.
 *
 * Used by the wall in the scene (Edge3D) and by the small preview in the Wall
 * Editor, so what the editor shows before Save is built by exactly the code
 * that draws it after.
 *
 * The wall's own sheet is not touched. Each region is a panel laid over the
 * part of the face it covers:
 *
 *   · cut round the doors and windows (wallRegions.visibleParts);
 *   · a hair further from the wall than any region it LIES OVER, so what was
 *     drawn later simply covers what is under it, with no flicker and no need
 *     to cut one shape out of another — and exactly as far out as its
 *     neighbours when it only sits beside them, so a pattern of many pieces
 *     is one flat surface;
 *   · further out again by its extrusion, with sides down to the wall so it
 *     reads as a solid block rather than a floating sheet.
 *
 * The picture is mapped across the WHOLE region, not across each piece of it,
 * so a pattern runs unbroken either side of a window.
 *
 * `frame` says where the face is:  origin {x, z} — the face's start on the
 * floor;  along {x, z} — the unit direction of its length;  normal {x, z} —
 * the way it looks.
 */

/** Clear of the wall (cm): enough not to flicker against it, too little to
 * see as a step. Each layer adds a little more. */
const LIFT = 0.2;
const LAYER = 0.04;

/** What a strip of light is drawn in: a warm white that ignores the scene's
 * lighting, which is what makes it read as the source of light. */
const LIGHT_COLOR = 0xfff1cf;

const dedupe = (points) => {
  const out = [];
  points.forEach((p) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-4) out.push(p);
  });
  if (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4
  ) {
    out.pop();
  }
  return out;
};

/**
 * @param {Object} o
 * @param {Array}  o.regions   cleaned regions, in stack order
 * @param {Array}  o.openings  doors and windows, as rectangles
 * @param {Object} o.frame     { origin, along, normal } — see above
 * @param {*}      o.side      three.js side for the panels (as the wall's)
 * @param {Object} o.scene     handed to the wall material, as the wall does
 * @param {Map}    o.cache     materials kept between redraws
 * @returns {{ meshes: Mesh[], geometries: BufferGeometry[] }}
 */
export const buildRegionMeshes = ({ regions, openings, frame, side, scene, cache }) => {
  const meshes = [];
  const geometries = [];
  const used = new Set();
  // A face that is not an upright wall (the ceiling — see ceilingRegions.js)
  // brings its own mapping: `toWorld(x, y, out)`, `faceNormal`, `inPlane(ox,
  // oy)` and `forward`. A wall's frame is { origin, along, normal } as before.
  const custom = typeof frame.toWorld === "function";
  const { origin, along, normal } = frame;
  // Corner order that faces the same way as the normal: anticlockwise in the
  // face's own x/y when "along × up" is the normal, clockwise otherwise.
  const forward = custom
    ? !!frame.forward
    : -along.z * normal.x + along.x * normal.z >= 0;
  const place = custom
    ? frame.toWorld
    : (x, y, out) => [
        origin.x + along.x * x + normal.x * out,
        y,
        origin.z + along.z * x + normal.z * out,
      ];
  const faceNormal = custom ? frame.faceNormal : [normal.x, 0, normal.z];
  const inPlane = custom ? frame.inPlane : (ox, oy) => [along.x * ox, oy, along.z * ox];

  // What has been laid so far, so each region can be placed against the ones
  // it lies over.
  const laid = [];
  (regions || []).forEach((region) => {
    if (!region.texture && !region.light) return;
    const parts = visibleParts(region, openings)
      .map(dedupe)
      .filter((p) => p.length >= 3);
    if (!parts.length) return;
    const bounds = regionBounds(region);
    const bw = bounds.w || 1;
    const bh = bounds.h || 1;
    const rise = Math.max(0, Number(region.extrusion) || 0);
    // HOW FAR OUT THIS ONE SITS.
    //
    // Just clear of whatever it lies over — the wall, or the outer face of
    // the regions beneath it — and no further. It used to be one step further
    // out than the region before it in the list, whether or not they touched:
    // a diamond pattern of sixty pieces that only share edges climbed away
    // from the wall piece by piece, the last ones a couple of centimetres
    // proud, and at a corner, where the wall is seen edge-on, the pattern
    // ended in a ragged stair instead of a clean line.
    let base = LIFT;
    let layer = 1;
    laid.forEach((under) => {
      if (!regionsOverlap(under.region, region)) return;
      base = Math.max(base, under.top + LAYER);
      layer = Math.max(layer, under.layer + 1);
    });
    const top = base + rise;
    laid.push({ region, top, layer });

    const positions = [];
    const normals = [];
    const uvs = [];
    const index = [];
    const uv = (p) => [(p[0] - bounds.x) / bw, (p[1] - bounds.y) / bh];

    parts.forEach((points) => {
      // The face.
      const start = positions.length / 3;
      points.forEach((p) => {
        positions.push(...place(p[0], p[1], top));
        normals.push(...faceNormal);
        uvs.push(...uv(p));
      });
      const triangles = ShapeUtils.triangulateShape(
        points.map((p) => new Vector2(p[0], p[1])),
        []
      );
      triangles.forEach(([a, b, c]) => {
        const pa = points[a];
        const pb = points[b];
        const pc = points[c];
        const ccw =
          (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0;
        if (ccw === forward) index.push(start + a, start + b, start + c);
        else index.push(start + a, start + c, start + b);
      });

      // The sides, when it stands out from the wall.
      if (rise > 0) {
        const turn = signedArea(points) > 0 ? 1 : -1;
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          const q = points[(i + 1) % points.length];
          const dx = q[0] - p[0];
          const dy = q[1] - p[1];
          const len = Math.hypot(dx, dy);
          if (len < 1e-4) continue;
          // Outward, in the plane of the wall.
          const ox = (dy / len) * turn;
          const oy = (-dx / len) * turn;
          const s = positions.length / 3;
          const corners = [
            [p, base],
            [q, base],
            [q, top],
            [p, top],
          ].map(([pt, out]) => place(pt[0], pt[1], out));
          const outward = inPlane(ox, oy);
          corners.forEach((c, k) => {
            positions.push(...c);
            normals.push(...outward);
            uvs.push(...uv(k === 0 || k === 3 ? p : q));
          });
          // Corner order chosen so the side FACES OUTWARD, away from the
          // block. That is what lets it be drawn one-sided like the wall:
          // seen from inside the room it is the edge of the block, and from
          // behind the wall it is not there at all.
          const e1 = [0, 1, 2].map((k) => corners[1][k] - corners[0][k]);
          const e2 = [0, 1, 2].map((k) => corners[2][k] - corners[0][k]);
          const facing =
            (e1[1] * e2[2] - e1[2] * e2[1]) * outward[0] +
            (e1[2] * e2[0] - e1[0] * e2[2]) * outward[1] +
            (e1[0] * e2[1] - e1[1] * e2[0]) * outward[2];
          if (facing >= 0) index.push(s, s + 1, s + 2, s, s + 2, s + 3);
          else index.push(s, s + 2, s + 1, s, s + 3, s + 2);
        }
      }
    });
    if (!index.length) return;

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometries.push(geometry);

    // One material per region, kept between redraws so the picture is not
    // fetched again every time the wall is rebuilt.
    //
    // ONE-SIDED, LIKE THE WALL ITSELF — a block that stands out included.
    // It was drawn two-sided at first, to save working out which way its
    // sides face, and that made it visible from BEHIND the wall: looking at
    // a room from outside, where the near walls are hidden so you can see
    // in, every raised panel on them hung in the air, back to front. A flat
    // panel never did that, because it was already one-sided.
    const drawSide = side;
    const key = region.light
      ? ["light", drawSide].join("|")
      : [region.id, region.texture.colormap, region.texture.color || "", drawSide].join("|");
    let material = cache.get(key);
    if (!material) {
      if (region.light) {
        material = new MeshBasicMaterial({ color: LIGHT_COLOR, side: drawSide });
      } else {
        // The pack is copied: the material writes its own defaults into
        // whatever it is given, and that must not be the saved region.
        const pack = { ...region.texture };
        material = new WallMaterial3D(
          { color: pack.color || "#FFFFFF", side: drawSide, transparent: false, wireframe: false },
          pack,
          scene
        );
      }
      material.polygonOffset = true;
      cache.set(key, material);
    }
    // Nearer layers win the depth test outright, however far away the camera.
    material.polygonOffsetFactor = -1 - layer;
    material.polygonOffsetUnits = -1 - layer;
    if (!region.light) material.dimensions = new Vector2(bw, bh);
    used.add(key);

    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = (custom && frame.meshName) || "wall";
    meshes.push(mesh);
  });

  // Materials of regions that are gone, or were given something else.
  cache.forEach((material, key) => {
    if (!used.has(key)) {
      material.dispose();
      cache.delete(key);
    }
  });
  return { meshes, geometries };
};
