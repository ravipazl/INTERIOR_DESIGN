/**
 * Drawing2DEngine — generate AutoCAD-style 2D technical drawings from a
 * single 3D furniture item.
 *
 * For the selected Physical3DItem this produces four orthographic views —
 * Front, Top, Left, Right — as sets of 2D line segments, each flagged
 * visible (solid) or hidden (dashed) by true Hidden Line Removal.
 *
 * Pipeline
 * --------
 * 1. Collect geometry in the item's CANONICAL frame: the GLB un-rotated
 *    from its room placement but at its real (placed/resized) size. This
 *    way the drawing always shows the design's true Front/Top/Side,
 *    independent of how the item is turned in the room.
 *      - feature edges  → THREE.EdgesGeometry (angle threshold drops
 *                          triangle-tessellation noise on flat panels)
 *      - faces          → merged triangle soup for the depth pass
 * 2. For each view, fit an OrthographicCamera (parallel projection — the
 *    only correct projection for a to-scale drawing) to the bounding box.
 * 3. Hidden Line Removal: render the faces with MeshDepthMaterial into an
 *    offscreen target, read the packed depth back, then sample every edge
 *    against it. Each edge is split into visible / hidden runs.
 * 4. Output 2D segments in millimetres, centred at the view origin, Y up.
 *
 * The exporters (Drawing2DExport.js) lay these views onto an SVG / DXF /
 * PDF sheet. This file is pure computation — no DOM, no React.
 *
 * Known limitation: silhouette outlines of curved surfaces (sofas, decor)
 * come out faceted, because EdgesGeometry yields model edges, not
 * view-dependent silhouettes. Boxy furniture (cabinets, wardrobes) — the
 * bulk of the catalogue — draws cleanly.
 */

import {
  Vector3,
  Matrix4,
  Color,
  Box3,
  Plane,
  EdgesGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Scene,
  OrthographicCamera,
  MeshDepthMaterial,
  MeshBasicMaterial,
  RGBADepthPacking,
  DoubleSide,
  WebGLRenderTarget,
} from "three";

// The four standard views. `dir` is the direction from the object to the
// camera; `up` is the camera's up vector (chosen so each drawing reads the
// conventional way — e.g. plan view has the object's back at the top).
const VIEWS = [
  { id: "front", label: "Front Elevation", dir: [0, 0, 1], up: [0, 1, 0] },
  { id: "top", label: "Top View (Plan)", dir: [0, 1, 0], up: [0, 0, -1] },
  { id: "left", label: "Left Side", dir: [-1, 0, 0], up: [0, 1, 0] },
  { id: "right", label: "Right Side", dir: [1, 0, 0], up: [0, 1, 0] },
];

const DEFAULTS = {
  resolution: 2048, // depth-pass render target size (px)
  // Feature-edge threshold. Raised 20 → 45 to DECLUTTER detailed / organic
  // models (beds, sofas): a low angle draws every gentle crease of a mattress or
  // curved surface, burying the drawing in lines. At 45° only real corners /
  // panel edges survive, so boxy furniture (90° corners) is unaffected but
  // organic surfaces stop generating noise.
  edgeAngle: 45, // deg — EdgesGeometry feature-edge threshold
  depthBias: 0.003, // [0,1] HLR tolerance (avoids self-occlusion noise)
  margin: 0.06, // frustum padding around the bounding box
  samplePx: 4, // one visible/hidden test per ~N screen px of edge
};

// World units in the pazl scene are centimetres; drawings use millimetres.
const CM_TO_MM = 10;

const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Geometry collection — canonical frame (un-rotated, real size)

function collectGeometry(physicalItem, edgeAngle) {
  const loadedItem = physicalItem.__loadedItem;
  if (!loadedItem) return null;

  physicalItem.updateMatrixWorld(true);

  // mesh-world → loadedItem-local strips the room placement + the item's
  // own rotation. loadedItem-local geometry is at NATIVE size, so we then
  // re-apply loadedItem's scale to land on the real placed/resized size.
  const loadedInv = new Matrix4().getInverse(loadedItem.matrixWorld);
  const scaleM = new Matrix4().makeScale(
    loadedItem.scale.x,
    loadedItem.scale.y,
    loadedItem.scale.z
  );

  const edges = []; // array of [Vector3, Vector3]
  const triangles = []; // flat [x,y,z, x,y,z, ...]

  loadedItem.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    o.updateWorldMatrix(true, false);

    const toCanonical = new Matrix4().multiplyMatrices(
      scaleM,
      new Matrix4().multiplyMatrices(loadedInv, o.matrixWorld)
    );

    // feature edges
    const eg = new EdgesGeometry(o.geometry, edgeAngle);
    const ep = eg.attributes.position;
    if (ep) {
      for (let i = 0; i < ep.count; i += 2) {
        const a = new Vector3()
          .fromBufferAttribute(ep, i)
          .applyMatrix4(toCanonical);
        const b = new Vector3()
          .fromBufferAttribute(ep, i + 1)
          .applyMatrix4(toCanonical);
        edges.push([a, b]);
      }
    }
    eg.dispose();

    // faces (for the depth pass)
    const pos = o.geometry.attributes.position;
    if (pos) {
      const idx = o.geometry.index;
      const v = new Vector3();
      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          v.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(toCanonical);
          triangles.push(v.x, v.y, v.z);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(toCanonical);
          triangles.push(v.x, v.y, v.z);
        }
      }
    }
  });

  if (!edges.length || !triangles.length) return null;
  return { edges, triangles };
}

// ---------------------------------------------------------------------------
// Camera fitting

function makeCamera(view, bbox, margin) {
  const center = bbox.getCenter(new Vector3());
  const size = bbox.getSize(new Vector3());

  // On-screen extents + depth extent depend on the view axis.
  let screenW, screenH, depthExtent;
  if (view.id === "front") {
    screenW = size.x;
    screenH = size.y;
    depthExtent = size.z;
  } else if (view.id === "top") {
    screenW = size.x;
    screenH = size.z;
    depthExtent = size.y;
  } else {
    screenW = size.z;
    screenH = size.y;
    depthExtent = size.x;
  }
  screenW = Math.max(screenW, 1);
  screenH = Math.max(screenH, 1);
  depthExtent = Math.max(depthExtent, 1);

  const halfW = (screenW / 2) * (1 + margin);
  const halfH = (screenH / 2) * (1 + margin);

  const dir = new Vector3(view.dir[0], view.dir[1], view.dir[2]).normalize();
  // Place the camera just outside the object and clip the frustum tightly
  // around it. The depth buffer then spends nearly its whole [0,1] range on
  // the object, keeping Hidden Line Removal precise — even for thin items.
  const dist = depthExtent + 50;
  const near = depthExtent * 0.5 + 45;
  const far = depthExtent * 1.5 + 55;

  const cam = new OrthographicCamera(-halfW, halfW, halfH, -halfH, near, far);
  cam.up.set(view.up[0], view.up[1], view.up[2]);
  cam.position.copy(center).addScaledVector(dir, dist);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  return { cam, halfW, halfH, screenW, screenH };
}

// ---------------------------------------------------------------------------
// Depth pass — renders faces to an offscreen target, reads packed depth back

function renderDepth(renderer, scene, cam, rt, buf, RES) {
  const oldRT = renderer.getRenderTarget();
  const oldAlpha = renderer.getClearAlpha();
  // getClearColor's signature differs across three versions — handle both
  // the "fills the passed target" and the "returns internal color" forms.
  const oldColor = new Color();
  const got = renderer.getClearColor(oldColor);
  if (got && got.isColor && got !== oldColor) oldColor.copy(got);

  renderer.setRenderTarget(rt);
  renderer.setClearColor(0xffffff, 1); // white background = "far"
  renderer.render(scene, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, RES, RES, buf);

  renderer.setRenderTarget(oldRT);
  renderer.setClearColor(oldColor, oldAlpha);
}

// Inverse of THREE's GLSL packDepthToRGBA (UnpackFactors). Returns the
// [0,1] depth stored at the given NDC location.
const UNPACK_DOWNSCALE = 255 / 256;
function sampleDepth(buf, RES, ndcX, ndcY) {
  let col = Math.floor((ndcX * 0.5 + 0.5) * RES);
  let row = Math.floor((ndcY * 0.5 + 0.5) * RES);
  if (col < 0) col = 0;
  else if (col >= RES) col = RES - 1;
  if (row < 0) row = 0;
  else if (row >= RES) row = RES - 1;
  const i = (row * RES + col) * 4;
  return (
    UNPACK_DOWNSCALE *
    (buf[i] / 255 / 16777216 +
      buf[i + 1] / 255 / 65536 +
      buf[i + 2] / 255 / 256 +
      buf[i + 3] / 255)
  );
}

// ---------------------------------------------------------------------------
// Edge classification — split each edge into visible / hidden runs

function pushSegment(out, ax, ay, bx, by, t0, t1, hidden) {
  out.push({
    x1: ax + (bx - ax) * t0,
    y1: ay + (by - ay) * t0,
    x2: ax + (bx - ax) * t1,
    y2: ay + (by - ay) * t1,
    hidden: !!hidden,
  });
}

function classifyEdges(edges, cam, buf, RES, halfW, halfH, opts) {
  const segments = [];
  const pa = new Vector3();
  const pb = new Vector3();

  for (let e = 0; e < edges.length; e++) {
    const A = edges[e][0];
    const B = edges[e][1];
    // Orthographic projection is affine, so projecting the two endpoints
    // and interpolating in NDC is exact — no need to project samples.
    pa.copy(A).project(cam);
    pb.copy(B).project(cam);

    // 2D paper coordinates (mm), centred on the view origin.
    const ax = pa.x * halfW * CM_TO_MM;
    const ay = pa.y * halfH * CM_TO_MM;
    const bx = pb.x * halfW * CM_TO_MM;
    const by = pb.y * halfH * CM_TO_MM;

    // Sample density follows the edge's on-screen pixel length.
    const dpx = (pb.x - pa.x) * 0.5 * RES;
    const dpy = (pb.y - pa.y) * 0.5 * RES;
    const pixLen = Math.hypot(dpx, dpy);
    const steps = Math.min(
      400,
      Math.max(1, Math.ceil(pixLen / opts.samplePx))
    );

    let runStart = 0;
    let runHidden = null;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const ndcX = pa.x + (pb.x - pa.x) * t;
      const ndcY = pa.y + (pb.y - pa.y) * t;
      const ndcZ = pa.z + (pb.z - pa.z) * t;
      const depth01 = ndcZ * 0.5 + 0.5;
      const hidden =
        depth01 > sampleDepth(buf, RES, ndcX, ndcY) + opts.depthBias;

      if (runHidden === null) {
        runHidden = hidden;
      } else if (hidden !== runHidden) {
        pushSegment(segments, ax, ay, bx, by, runStart, k / steps, runHidden);
        runStart = k / steps;
        runHidden = hidden;
      }
    }
    pushSegment(segments, ax, ay, bx, by, runStart, 1, runHidden);
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Generate a 4-view 2D drawing for one furniture item.
 *
 * @param {object} physicalItem  the selected Physical3DItem (has __loadedItem)
 * @param {WebGLRenderer} renderer  the live three.js renderer
 * @param {object} [options]  { resolution, edgeAngle, depthBias, margin,
 *                              samplePx, itemName }
 * @returns {{
 *   itemName:string, unit:string, generatedAt:string,
 *   dimensions:{width:number,height:number,depth:number},
 *   views:Array<{id:string,label:string,width:number,height:number,
 *                segments:Array<{x1,y1,x2,y2,hidden}>}>
 * }}
 */
export function generateItemDrawing(physicalItem, renderer, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  if (!physicalItem || !physicalItem.__loadedItem) {
    throw new Error("No 3D model is loaded for the selected item.");
  }
  if (!renderer || typeof renderer.render !== "function") {
    throw new Error("The 3D renderer is unavailable.");
  }

  const collected = collectGeometry(physicalItem, opts.edgeAngle);
  if (!collected) {
    throw new Error("The selected model has no drawable geometry.");
  }
  const { edges, triangles } = collected;

  // Merged face soup for the depth pass.
  const depthGeom = new BufferGeometry();
  depthGeom.setAttribute(
    "position",
    new Float32BufferAttribute(triangles, 3)
  );
  depthGeom.computeBoundingBox();
  const bbox = depthGeom.boundingBox;
  const size = bbox.getSize(new Vector3());

  const depthMat = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking,
    side: DoubleSide,
  });
  const depthMesh = new Mesh(depthGeom, depthMat);
  const depthScene = new Scene();
  depthScene.add(depthMesh);

  const RES = opts.resolution;
  const rt = new WebGLRenderTarget(RES, RES);
  const buf = new Uint8Array(RES * RES * 4);

  const views = [];
  try {
    for (const view of VIEWS) {
      const { cam, halfW, halfH, screenW, screenH } = makeCamera(
        view,
        bbox,
        opts.margin
      );
      renderDepth(renderer, depthScene, cam, rt, buf, RES);
      const segments = classifyEdges(
        edges,
        cam,
        buf,
        RES,
        halfW,
        halfH,
        opts
      );
      views.push({
        id: view.id,
        label: view.label,
        width: round1(screenW * CM_TO_MM),
        height: round1(screenH * CM_TO_MM),
        segments,
      });
    }
  } finally {
    rt.dispose();
    depthGeom.dispose();
    depthMat.dispose();
  }

  return {
    itemName:
      options.itemName ||
      physicalItem?.__itemModel?.__metadata?.name ||
      "Furniture Item",
    unit: "mm",
    generatedAt: new Date().toISOString(),
    dimensions: {
      width: Math.round(size.x * CM_TO_MM),
      height: Math.round(size.y * CM_TO_MM),
      depth: Math.round(size.z * CM_TO_MM),
    },
    views,
  };
}

export default generateItemDrawing;

// ===========================================================================
// SCHEMATIC MODE  —  one clean rectangle per component (working-drawing look)
// ===========================================================================
//
// generateItemDrawing projects the real mesh edges (accurate, but noisy on
// detailed / organic models like beds and sofas). generateItemSchematic
// instead draws ONE axis-aligned rectangle per component — the box outline of
// each mesh — giving the clean, professional "shop / working drawing" look
// (mattress rectangle, drawer rectangles, headboard rectangle …).
//
// It returns the SAME shape as generateItemDrawing, so BOTH sheet builders
// (Shop Drawing + Working Drawing) consume it unchanged — fixing the shared
// geometry source fixes both sheets at once.

// Per-mesh bounding boxes in the canonical frame (un-rotated, real size) —
// same frame collectGeometry uses, so the schematic lines up with the mesh
// drawing and the sheet layout.
function collectComponentBoxes(physicalItem) {
  const loadedItem = physicalItem.__loadedItem;
  if (!loadedItem) return null;

  physicalItem.updateMatrixWorld(true);

  const loadedInv = new Matrix4().getInverse(loadedItem.matrixWorld);
  const scaleM = new Matrix4().makeScale(
    loadedItem.scale.x,
    loadedItem.scale.y,
    loadedItem.scale.z
  );

  const boxes = [];
  const overall = new Box3();
  const corner = new Vector3();

  loadedItem.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    o.updateWorldMatrix(true, false);

    const toCanonical = new Matrix4().multiplyMatrices(
      scaleM,
      new Matrix4().multiplyMatrices(loadedInv, o.matrixWorld)
    );

    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!bb) return;

    // Transform the 8 corners of the geometry box into the canonical frame,
    // then take their axis-aligned extent (this bakes in the mesh's own
    // rotation, so a rotated part still gets a correct upright box).
    const box = new Box3();
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++) {
          corner
            .set(
              xi ? bb.max.x : bb.min.x,
              yi ? bb.max.y : bb.min.y,
              zi ? bb.max.z : bb.min.z
            )
            .applyMatrix4(toCanonical);
          box.expandByPoint(corner);
          overall.expandByPoint(corner);
        }

    // Drop near-zero helper meshes so they don't add stray dots.
    const bs = box.getSize(new Vector3());
    if (bs.x + bs.y + bs.z < 0.1) return;

    boxes.push({ box, name: (o.name || "").toLowerCase() });
  });

  if (!boxes.length) return null;
  return { boxes, overall };
}

// A readable part label. Sanitized GLBs rename meshes "Mesh_0", "Mesh_1" …,
// which say nothing — for those we fall back to "P1", "P2" (the tag number).
// A model that kept real names ("drawer", "mattress_01") gets those, title-cased.
function labelForBox(rawName, idx) {
  const n = (rawName || "").trim();
  const isGeneric = !n || /^mesh[_\s-]*\d*$/i.test(n) || /^object[_\s-]*\d*$/i.test(n);
  if (isGeneric) return "P" + (idx + 1);
  return n
    .replace(/[_\-.]+/g, " ")
    .replace(/\d+$/g, "")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 22) || "P" + (idx + 1);
}

/**
 * Schematic 2D drawing — one rectangle per component. Same return shape as
 * generateItemDrawing (itemName / unit / dimensions / views[]), plus a `parts`
 * array per view (label + real per-part dimensions), so the sheet builder can
 * annotate each box. The shop and working builders consume it unchanged.
 *
 * @param {object} physicalItem  the selected Physical3DItem (has __loadedItem)
 * @param {object} [options]  { margin, itemName }
 */
export function generateItemSchematic(physicalItem, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  if (!physicalItem || !physicalItem.__loadedItem) {
    throw new Error("No 3D model is loaded for the selected item.");
  }

  const collected = collectComponentBoxes(physicalItem);
  if (!collected) {
    throw new Error("The selected model has no drawable geometry.");
  }
  const { boxes, overall } = collected;
  const size = overall.getSize(new Vector3());

  // Top-level parts list — each component's REAL width x height x depth (mm),
  // used for the PARTS LIST table on the sheet (dimensions live there, not
  // crammed into overlapping boxes).
  const partList = boxes.map((entry, b) => {
    const bs = entry.box.getSize(new Vector3());
    return {
      tag: "P" + (b + 1),
      label: labelForBox(entry.name, b),
      w: Math.round(bs.x * CM_TO_MM),
      h: Math.round(bs.y * CM_TO_MM),
      d: Math.round(bs.z * CM_TO_MM),
    };
  });

  const p = new Vector3();
  const views = [];

  for (const view of VIEWS) {
    // Reuse the SAME camera the mesh drawing uses → identical orientation,
    // framing and paper-coordinate convention as generateItemDrawing.
    const { cam, halfW, halfH, screenW, screenH } = makeCamera(
      view,
      overall,
      opts.margin
    );

    const segments = [];
    const parts = []; // per-component rectangle metadata → labels + dimensions
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b].box;
      // Project all 8 corners; the component's rectangle is their 2D extent.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let xi = 0; xi < 2; xi++)
        for (let yi = 0; yi < 2; yi++)
          for (let zi = 0; zi < 2; zi++) {
            p.set(
              xi ? box.max.x : box.min.x,
              yi ? box.max.y : box.min.y,
              zi ? box.max.z : box.min.z
            ).project(cam);
            const px = p.x * halfW * CM_TO_MM;
            const py = p.y * halfH * CM_TO_MM;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }

      // Skip parts that collapse to a line in this view (e.g. a thin panel
      // seen edge-on) — a zero-area rectangle is just noise.
      if (maxX - minX < 0.5 || maxY - minY < 0.5) continue;

      // Four solid edges of the component rectangle (schematic = no hidden
      // lines, so both sheets stay clean).
      segments.push({ x1: minX, y1: minY, x2: maxX, y2: minY, hidden: false });
      segments.push({ x1: maxX, y1: minY, x2: maxX, y2: maxY, hidden: false });
      segments.push({ x1: maxX, y1: maxY, x2: minX, y2: maxY, hidden: false });
      segments.push({ x1: minX, y1: maxY, x2: minX, y2: minY, hidden: false });

      // Part annotation: paper coords are already REAL millimetres, so the
      // rectangle's on-screen extent IS the part's true size in this view.
      // `idx` is stable per component across all four views, so the same part
      // carries the same tag number everywhere.
      parts.push({
        idx: b,
        label: labelForBox(boxes[b].name, b),
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        x1: minX,
        y1: minY,
        x2: maxX,
        y2: maxY,
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
      });
    }

    views.push({
      id: view.id,
      label: view.label,
      width: round1(screenW * CM_TO_MM),
      height: round1(screenH * CM_TO_MM),
      segments,
      parts,
    });
  }

  return {
    itemName:
      options.itemName ||
      physicalItem?.__itemModel?.__metadata?.name ||
      "Furniture Item",
    unit: "mm",
    generatedAt: new Date().toISOString(),
    style: "schematic",
    dimensions: {
      width: Math.round(size.x * CM_TO_MM),
      height: Math.round(size.y * CM_TO_MM),
      depth: Math.round(size.z * CM_TO_MM),
    },
    parts: partList,
    views,
  };
}

// ===========================================================================
// OUTLINE MODE  —  clean silhouette of the model (no internal edge noise)
// ===========================================================================
//
// Detailed mode draws every mesh edge → busy on realistic models (barred beds,
// tufted sofas). Outline mode instead renders the model as a solid SILHOUETTE
// per view and traces only its BOUNDARY (marching squares). The result is a
// clean shape outline — like the "cartoon" models — from ANY model, at the cost
// of internal detail (which is exactly what makes it clean).

// Marching-squares case table. Corner bits: c00=1, c10=2, c11=4, c01=8.
// Edge codes: L(left) B(bottom) R(right) T(top). Each case lists the edge pairs
// the contour connects inside the cell.
const MS_CASES = {
  1: [["L", "B"]],
  2: [["B", "R"]],
  3: [["L", "R"]],
  4: [["R", "T"]],
  5: [["L", "B"], ["R", "T"]],
  6: [["B", "T"]],
  7: [["L", "T"]],
  8: [["L", "T"]],
  9: [["B", "T"]],
  10: [["B", "R"], ["L", "T"]],
  11: [["R", "T"]],
  12: [["L", "R"]],
  13: [["B", "R"]],
  14: [["L", "B"]],
};

/**
 * Outline (silhouette) 2D drawing. Same return shape as generateItemDrawing.
 *
 * @param {object} physicalItem  the selected Physical3DItem (has __loadedItem)
 * @param {WebGLRenderer} renderer  the live three.js renderer
 * @param {object} [options]  { resolution, margin, itemName }
 */
export function generateItemOutline(physicalItem, renderer, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  if (!physicalItem || !physicalItem.__loadedItem) {
    throw new Error("No 3D model is loaded for the selected item.");
  }
  if (!renderer || typeof renderer.render !== "function") {
    throw new Error("The 3D renderer is unavailable.");
  }

  // Real mesh triangles in the canonical frame → a solid "stamp" to silhouette.
  const collected = collectGeometry(physicalItem, opts.edgeAngle);
  if (!collected) {
    throw new Error("The selected model has no drawable geometry.");
  }
  const { triangles } = collected;

  const maskGeom = new BufferGeometry();
  maskGeom.setAttribute("position", new Float32BufferAttribute(triangles, 3));
  maskGeom.computeBoundingBox();
  const bbox = maskGeom.boundingBox;
  const size = bbox.getSize(new Vector3());

  // Flat black model on a white background → an unambiguous inside/outside mask
  // (far more robust than thresholding packed depth).
  const maskMat = new MeshBasicMaterial({ color: 0x000000, side: DoubleSide });
  const maskMesh = new Mesh(maskGeom, maskMat);
  const maskScene = new Scene();
  maskScene.add(maskMesh);

  const RES = opts.resolution;
  const rt = new WebGLRenderTarget(RES, RES);
  const buf = new Uint8Array(RES * RES * 4);

  // Grid stride — finer = smoother outline, heavier. ~1024 cells reads smooth.
  const stride = Math.max(1, Math.floor(RES / 1024));
  const GW = Math.floor(RES / stride);
  const GH = GW;

  const views = [];
  try {
    for (const view of VIEWS) {
      const { cam, halfW, halfH, screenW, screenH } = makeCamera(
        view,
        bbox,
        opts.margin
      );

      // Render the silhouette pass (white bg = outside, black = inside).
      const oldRT = renderer.getRenderTarget();
      const oldAlpha = renderer.getClearAlpha();
      const oldColor = new Color();
      const got = renderer.getClearColor(oldColor);
      if (got && got.isColor && got !== oldColor) oldColor.copy(got);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0xffffff, 1);
      renderer.render(maskScene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, RES, RES, buf);
      renderer.setRenderTarget(oldRT);
      renderer.setClearColor(oldColor, oldAlpha);

      // Down-sample to the grid: inside = the model (dark) covered this cell.
      const inside = new Uint8Array(GW * GH);
      for (let gy = 0; gy < GH; gy++) {
        const row = gy * stride;
        for (let gx = 0; gx < GW; gx++) {
          const col = gx * stride;
          const i = (row * RES + col) * 4;
          inside[gy * GW + gx] = buf[i] < 128 ? 1 : 0; // R channel
        }
      }

      // Grid coords → paper millimetres (same convention as classifyEdges).
      const toPaper = (gcx, gcy) => [
        (((gcx * stride) / RES) * 2 - 1) * halfW * CM_TO_MM,
        (((gcy * stride) / RES) * 2 - 1) * halfH * CM_TO_MM,
      ];
      const edgePt = (edge, gx, gy) => {
        if (edge === "L") return toPaper(gx, gy + 0.5);
        if (edge === "B") return toPaper(gx + 0.5, gy);
        if (edge === "R") return toPaper(gx + 1, gy + 0.5);
        return toPaper(gx + 0.5, gy + 1); // "T"
      };

      const segments = [];
      for (let gy = 0; gy < GH - 1; gy++) {
        for (let gx = 0; gx < GW - 1; gx++) {
          const c00 = inside[gy * GW + gx];
          const c10 = inside[gy * GW + gx + 1];
          const c11 = inside[(gy + 1) * GW + gx + 1];
          const c01 = inside[(gy + 1) * GW + gx];
          const idx = c00 * 1 + c10 * 2 + c11 * 4 + c01 * 8;
          if (idx === 0 || idx === 15) continue;
          const pairs = MS_CASES[idx];
          for (let k = 0; k < pairs.length; k++) {
            const a = edgePt(pairs[k][0], gx, gy);
            const b = edgePt(pairs[k][1], gx, gy);
            segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], hidden: false });
          }
        }
      }

      views.push({
        id: view.id,
        label: view.label,
        width: round1(screenW * CM_TO_MM),
        height: round1(screenH * CM_TO_MM),
        segments,
      });
    }
  } finally {
    rt.dispose();
    maskGeom.dispose();
    maskMat.dispose();
  }

  return {
    itemName:
      options.itemName ||
      physicalItem?.__itemModel?.__metadata?.name ||
      "Furniture Item",
    unit: "mm",
    generatedAt: new Date().toISOString(),
    style: "outline",
    dimensions: {
      width: Math.round(size.x * CM_TO_MM),
      height: Math.round(size.y * CM_TO_MM),
      depth: Math.round(size.z * CM_TO_MM),
    },
    views,
  };
}

// ===========================================================================
// FULL ROOM VIEW  —  whole 3D scene  →  2D line drawing + rendered snapshots
// ===========================================================================
//
// generateItemDrawing (above) draws ONE furniture item. The functions below
// draw the WHOLE room — every wall, floor and furniture item currently in the
// Viewer3D scene — projected to the same Front / Top / Left / Right set so the
// existing Drawing2DExport sheet layout is reused unchanged.
//
//   generateRoomDrawing()  → vector line drawing; result has the SAME shape as
//                            generateItemDrawing, so Drawing2DExport consumes
//                            it directly (SVG / DXF / PDF).
//   renderRoomSnapshots()  → orthographic PNG renders of the live scene
//                            (textured + lit — a picture, not a CAD drawing).
//
// Elevations (front / left / right) clip away the wall nearest the camera so
// the view looks INTO the room; the plan view needs no clip (no ceiling).

// Room views — the ids MUST stay front/top/left/right because Drawing2DExport's
// sheet layout is hard-coded to those four cells.
const ROOM_VIEWS = [
  { id: "front", label: "Front Elevation", dir: [0, 0, 1], up: [0, 1, 0], clip: "zmax" },
  { id: "top", label: "Plan (Top View)", dir: [0, 1, 0], up: [0, 0, -1], clip: null },
  { id: "left", label: "Left Elevation", dir: [-1, 0, 0], up: [0, 1, 0], clip: "xmin" },
  { id: "right", label: "Right Elevation", dir: [1, 0, 0], up: [0, 1, 0], clip: "xmax" },
];

// Distance (cm) trimmed off the near side of an elevation — removes the wall
// standing between the camera and the room interior.
const ROOM_CLIP_INSET = 30;

// Scene objects that must never enter a drawing/snapshot: grid, sky, helpers.
function collectRoomExcludes(viewer3d) {
  const ex = [];
  const push = (o) => {
    if (o && ex.indexOf(o) === -1) ex.push(o);
  };
  push(viewer3d.gridHelper);
  if (viewer3d.skybox) {
    push(viewer3d.skybox.sky);
    push(viewer3d.skybox.__fineGridFloor);
    push(viewer3d.skybox.__coarseGridFloor);
  }
  viewer3d.traverse((o) => {
    if (o.type && o.type.indexOf("Helper") !== -1) push(o);
  });
  return ex;
}

function isUnderExcluded(o, excludes) {
  let p = o;
  while (p) {
    if (excludes.indexOf(p) !== -1) return true;
    p = p.parent;
  }
  return false;
}

// True for a mesh that should contribute geometry to a room view.
function isDrawableRoomMesh(o, excludes) {
  if (!o.isMesh || !o.geometry || !o.visible) return false;
  if (o.type && o.type.indexOf("Helper") !== -1) return false;
  // Physical3DItem is itself a Mesh wrapping the real model in __loadedItem;
  // skip its own placeholder geometry — its children are still traversed.
  if (o.__loadedItem) return false;
  const mat = o.material;
  if (mat && !Array.isArray(mat)) {
    if (mat.visible === false) return false;
    if (mat.name && mat.name.indexOf("Sky") !== -1) return false;
  }
  if (isUnderExcluded(o, excludes)) return false;
  return true;
}

// Collect per-mesh feature edges + face triangles + world bounding box for
// every drawable mesh, in WORLD space (unlike collectGeometry, which works in
// one item's canonical frame). Returned PER MESH so far-flung stray objects
// can be filtered out before the scene bounding box is computed.
function collectRoomMeshes(viewer3d, edgeAngle) {
  const excludes = collectRoomExcludes(viewer3d);
  viewer3d.updateMatrixWorld(true);

  const meshes = []; // [{ edges:[[Vector3,Vector3]], triangles:[...], box }]

  viewer3d.traverse((o) => {
    if (!isDrawableRoomMesh(o, excludes)) return;
    o.updateWorldMatrix(true, false);
    const m = o.matrixWorld;

    // Walls and floors are built with legacy THREE.Geometry, which has no
    // `.attributes` — convert those to BufferGeometry so the same path
    // (EdgesGeometry + position attribute) works for them and for GLB items.
    let geom = o.geometry;
    let geomIsTemp = false;
    if (geom.isBufferGeometry !== true) {
      geom = new BufferGeometry().fromGeometry(geom);
      geomIsTemp = true;
    }

    const edges = [];
    const triangles = [];
    const box = new Box3();

    const eg = new EdgesGeometry(geom, edgeAngle);
    const ep = eg.attributes.position;
    if (ep) {
      for (let i = 0; i < ep.count; i += 2) {
        const a = new Vector3().fromBufferAttribute(ep, i).applyMatrix4(m);
        const b = new Vector3().fromBufferAttribute(ep, i + 1).applyMatrix4(m);
        edges.push([a, b]);
        box.expandByPoint(a);
        box.expandByPoint(b);
      }
    }
    eg.dispose();

    const pos = geom.attributes.position;
    if (pos) {
      const idx = geom.index;
      const v = new Vector3();
      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          v.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(m);
          triangles.push(v.x, v.y, v.z);
          box.expandByPoint(v);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          triangles.push(v.x, v.y, v.z);
          box.expandByPoint(v);
        }
      }
    }

    if (geomIsTemp) geom.dispose();

    if ((edges.length || triangles.length) && !box.isEmpty()) {
      meshes.push({ edges, triangles, box });
    }
  });

  return meshes;
}

// Median of a numeric array (lower median for even lengths).
function medianOf(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s.length ? s[(s.length - 1) >> 1] : 0;
}

/**
 * Decide which collected meshes actually belong to the room and return a
 * boolean keep-mask plus the resulting bounding box.
 *
 * A corrupt furniture transform or a stray marker mesh placed hundreds of
 * metres away would otherwise blow the scene bounding box up to nonsense
 * (e.g. a 635 m "room"), shrinking the real room to an invisible speck and
 * leaving the drawing/snapshots blank. We anchor on the MEDIAN mesh centre
 * (robust to outliers) and drop meshes that sit far outside the cluster, plus
 * any single mesh that is itself implausibly large. World units are cm.
 */
function filterRoomMeshes(boxes) {
  const n = boxes.length;
  const keep = new Array(n).fill(true);
  const bbox = new Box3();
  if (!n) return { keep, bbox };

  const centers = boxes.map((b) => b.getCenter(new Vector3()));
  const mx = medianOf(centers.map((c) => c.x));
  const my = medianOf(centers.map((c) => c.y));
  const mz = medianOf(centers.map((c) => c.z));
  const dists = centers.map((c) =>
    Math.hypot(c.x - mx, c.y - my, c.z - mz)
  );
  const medDist = medianOf(dists);

  const MAX_MESH_SPAN = 6000; // cm — 60 m; nothing real in a room is bigger
  const distLimit = medDist * 8 + 3000; // cm — cluster-scaled + 30 m slack

  let kept = 0;
  for (let i = 0; i < n; i++) {
    const size = boxes[i].getSize(new Vector3());
    const tooBig = Math.max(size.x, size.y, size.z) > MAX_MESH_SPAN;
    const tooFar = dists[i] > distLimit;
    if (tooBig || tooFar) {
      keep[i] = false;
    } else {
      bbox.union(boxes[i]);
      kept++;
    }
  }

  // Degenerate input (everything rejected) — fall back to using everything.
  if (!kept) {
    for (let i = 0; i < n; i++) {
      keep[i] = true;
      bbox.union(boxes[i]);
    }
  }
  return { keep, bbox };
}

// Collect the room's furniture items for the numbered tags + schedule table.
// Items are grouped by name (Qty = count); each placement keeps its own world
// centre so a tag can be projected into every view. A placement whose centre
// falls well outside the room box is treated as a stray and skipped.
function collectRoomItems(viewer3d, bbox) {
  const list = (viewer3d && viewer3d.physicalRoomItems) || [];
  const region = bbox.clone().expandByScalar(100); // 1 m tolerance
  const groups = new Map(); // name -> schedule row
  const placements = []; // [{ no, center }]
  let nextNo = 1;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    const target = item.__loadedItem || item;
    let box;
    try {
      box = new Box3().setFromObject(target);
    } catch (e) {
      continue;
    }
    if (box.isEmpty() || !isFinite(box.min.x)) continue;
    const center = box.getCenter(new Vector3());
    if (!region.containsPoint(center)) continue; // stray placement — skip

    const meta = item.__itemModel || item.itemModel || null;
    const name =
      (meta && ((meta.__metadata && meta.__metadata.name) || meta.name)) ||
      "Furniture Item";

    let g = groups.get(name);
    if (!g) {
      const size = box.getSize(new Vector3());
      g = {
        no: nextNo++,
        name: name,
        width: Math.round(size.x * CM_TO_MM),
        height: Math.round(size.y * CM_TO_MM),
        depth: Math.round(size.z * CM_TO_MM),
        qty: 0,
      };
      groups.set(name, g);
    }
    g.qty += 1;
    placements.push({ no: g.no, center: center });
  }

  return { schedule: Array.from(groups.values()), placements: placements };
}

// Project each item placement's world centre into a view, returning the tag
// positions in the same 2D paper-mm space (Y up) used by classifyEdges.
function projectRoomTags(placements, cam, halfW, halfH) {
  const tags = [];
  const p = new Vector3();
  for (let i = 0; i < placements.length; i++) {
    p.copy(placements[i].center).project(cam);
    tags.push({
      no: placements[i].no,
      x: p.x * halfW * CM_TO_MM,
      y: p.y * halfH * CM_TO_MM,
    });
  }
  return tags;
}

// Clip plane that trims the near wall for an elevation; null for the plan.
// THREE clips fragments whose signed distance to the plane is negative.
function roomClipPlane(clip, bbox, inset) {
  if (clip === "zmax") return new Plane(new Vector3(0, 0, -1), bbox.max.z - inset);
  if (clip === "xmax") return new Plane(new Vector3(-1, 0, 0), bbox.max.x - inset);
  if (clip === "xmin") return new Plane(new Vector3(1, 0, 0), -(bbox.min.x + inset));
  return null;
}

// Clip the edge list against a plane, keeping the room-interior side. Edges
// fully outside are dropped; straddling edges are cut at the plane.
function clipEdgesToPlane(edges, plane) {
  if (!plane) return edges;
  const out = [];
  for (let i = 0; i < edges.length; i++) {
    const A = edges[i][0];
    const B = edges[i][1];
    const dA = plane.distanceToPoint(A);
    const dB = plane.distanceToPoint(B);
    if (dA >= 0 && dB >= 0) {
      out.push([A, B]);
    } else if (dA < 0 && dB < 0) {
      // edge is fully on the clipped side — drop it
    } else {
      const t = dA / (dA - dB);
      const I = A.clone().lerp(B, t);
      out.push(dA >= 0 ? [A, I] : [I, B]);
    }
  }
  return out;
}

/**
 * Generate a 4-view 2D line drawing (Front / Top / Left / Right) of the whole
 * room — every wall, floor and furniture item in the Viewer3D scene.
 *
 * @param {Scene} viewer3d  the live Viewer3D (it extends THREE.Scene)
 * @param {WebGLRenderer} renderer  the live three.js renderer
 * @param {object} [options]  { resolution, edgeAngle, depthBias, margin,
 *                              samplePx, clipInset, itemName }
 * @returns result with the SAME shape as generateItemDrawing — so the
 *          Drawing2DExport SVG/DXF/PDF renderers consume it unchanged.
 */
export function generateRoomDrawing(viewer3d, renderer, options = {}) {
  // Rooms carry far more geometry than one item: a coarser feature-edge angle
  // and sparser edge sampling keep generation responsive.
  const opts = {
    ...DEFAULTS,
    resolution: 2048,
    edgeAngle: 30,
    samplePx: 6,
    ...options,
  };
  const inset = options.clipInset != null ? options.clipInset : ROOM_CLIP_INSET;

  if (!viewer3d || typeof viewer3d.traverse !== "function") {
    throw new Error("The 3D room scene is unavailable.");
  }
  if (!renderer || typeof renderer.render !== "function") {
    throw new Error("The 3D renderer is unavailable.");
  }

  const meshes = collectRoomMeshes(viewer3d, opts.edgeAngle);
  if (!meshes.length) {
    throw new Error(
      "The room has no drawable geometry yet. Add walls or furniture first."
    );
  }

  // Drop far-flung stray meshes so one corrupt transform cannot blow the
  // scene bounding box up to nonsense (which shrinks the real room to a
  // speck and leaves the drawing/snapshots effectively blank).
  const { keep, bbox } = filterRoomMeshes(meshes.map((mm) => mm.box));
  const strayCount = keep.filter((k) => !k).length;
  if (strayCount) {
    console.debug(
      "generateRoomDrawing: ignored " +
        strayCount +
        " stray mesh(es) far outside the room"
    );
  }

  const edges = [];
  const triangles = [];
  for (let i = 0; i < meshes.length; i++) {
    if (!keep[i]) continue;
    for (let e = 0; e < meshes[i].edges.length; e++) {
      edges.push(meshes[i].edges[e]);
    }
    for (let t = 0; t < meshes[i].triangles.length; t++) {
      triangles.push(meshes[i].triangles[t]);
    }
  }
  if (!edges.length || !triangles.length || bbox.isEmpty()) {
    throw new Error(
      "The room has no drawable geometry yet. Add walls or furniture first."
    );
  }

  const size = bbox.getSize(new Vector3());

  // Furniture items in the room — for numbered tags + the schedule table.
  const roomItems = collectRoomItems(viewer3d, bbox);

  const depthGeom = new BufferGeometry();
  depthGeom.setAttribute("position", new Float32BufferAttribute(triangles, 3));

  const depthMat = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking,
    side: DoubleSide,
  });
  const depthMesh = new Mesh(depthGeom, depthMat);
  const depthScene = new Scene();
  depthScene.add(depthMesh);

  const RES = opts.resolution;
  const rt = new WebGLRenderTarget(RES, RES);
  const buf = new Uint8Array(RES * RES * 4);

  const savedClips = renderer.clippingPlanes;
  const views = [];
  try {
    for (const view of ROOM_VIEWS) {
      const { cam, halfW, halfH, screenW, screenH } = makeCamera(
        view,
        bbox,
        opts.margin
      );
      const plane = roomClipPlane(view.clip, bbox, inset);
      // Global clipping planes apply to every material in the depth pass.
      renderer.clippingPlanes = plane ? [plane] : [];
      renderDepth(renderer, depthScene, cam, rt, buf, RES);

      const viewEdges = clipEdgesToPlane(edges, plane);
      const segments = classifyEdges(
        viewEdges,
        cam,
        buf,
        RES,
        halfW,
        halfH,
        opts
      );

      views.push({
        id: view.id,
        label: view.label,
        width: round1(screenW * CM_TO_MM),
        height: round1(screenH * CM_TO_MM),
        segments,
        tags: projectRoomTags(roomItems.placements, cam, halfW, halfH),
      });
    }
  } finally {
    renderer.clippingPlanes = savedClips;
    rt.dispose();
    depthGeom.dispose();
    depthMat.dispose();
  }

  return {
    itemName: options.itemName || "Full Room View",
    unit: "mm",
    generatedAt: new Date().toISOString(),
    dimensions: {
      width: Math.round(size.x * CM_TO_MM),
      height: Math.round(size.y * CM_TO_MM),
      depth: Math.round(size.z * CM_TO_MM),
    },
    items: roomItems.schedule,
    views,
  };
}

// Flip WebGL bottom-up pixels into a top-down PNG data URL.
function pixelsToPngDataURL(pixels, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * rowBytes;
    img.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Render the live room from the same 4 viewpoints to orthographic PNG
 * snapshots — textured and lit, a picture rather than a CAD drawing.
 *
 * @param {Scene} viewer3d  the live Viewer3D
 * @param {WebGLRenderer} renderer  the live three.js renderer
 * @param {object} [options]  { snapshotLongPx, margin, clipInset }
 * @returns {Array<{id,label,width,height,dataUrl}>}
 */
export function renderRoomSnapshots(viewer3d, renderer, options = {}) {
  const longPx = options.snapshotLongPx || 1600;
  const margin = options.margin != null ? options.margin : DEFAULTS.margin;
  const inset = options.clipInset != null ? options.clipInset : ROOM_CLIP_INSET;

  if (!viewer3d || typeof viewer3d.traverse !== "function") {
    throw new Error("The 3D room scene is unavailable.");
  }
  if (!renderer || typeof renderer.render !== "function") {
    throw new Error("The 3D renderer is unavailable.");
  }

  // World-space bounding box of the drawable geometry, with far-flung stray
  // meshes dropped (see filterRoomMeshes) so the camera frames the real room.
  const excludes = collectRoomExcludes(viewer3d);
  viewer3d.updateMatrixWorld(true);
  const boxes = [];
  viewer3d.traverse((o) => {
    if (!isDrawableRoomMesh(o, excludes)) return;
    const b = new Box3().setFromObject(o);
    if (!b.isEmpty() && isFinite(b.min.x) && isFinite(b.max.x)) {
      boxes.push(b);
    }
  });
  if (!boxes.length) {
    throw new Error("The room has no geometry to render yet.");
  }
  const { bbox } = filterRoomMeshes(boxes);
  if (bbox.isEmpty()) {
    throw new Error("The room has no geometry to render yet.");
  }

  const savedClips = renderer.clippingPlanes;
  const savedRT = renderer.getRenderTarget();
  const savedBg = viewer3d.background;
  const savedClearColor = new Color();
  const gotColor = renderer.getClearColor(savedClearColor);
  if (gotColor && gotColor.isColor && gotColor !== savedClearColor) {
    savedClearColor.copy(gotColor);
  }
  const savedClearAlpha = renderer.getClearAlpha();

  // Hide the grid / sky / helpers for a clean white-background snapshot.
  const reShow = [];
  for (const ex of excludes) {
    if (ex && ex.visible) {
      ex.visible = false;
      reShow.push(ex);
    }
  }
  viewer3d.background = new Color(0xffffff);

  const out = [];
  try {
    for (const view of ROOM_VIEWS) {
      const { cam, screenW, screenH } = makeCamera(view, bbox, margin);
      const aspect = Math.max(screenW, 1) / Math.max(screenH, 1);
      let pxW, pxH;
      if (aspect >= 1) {
        pxW = longPx;
        pxH = Math.max(16, Math.round(longPx / aspect));
      } else {
        pxH = longPx;
        pxW = Math.max(16, Math.round(longPx * aspect));
      }

      const rt = new WebGLRenderTarget(pxW, pxH);
      const plane = roomClipPlane(view.clip, bbox, inset);
      renderer.clippingPlanes = plane ? [plane] : [];
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(viewer3d, cam);

      const pixels = new Uint8Array(pxW * pxH * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, pxW, pxH, pixels);
      rt.dispose();

      out.push({
        id: view.id,
        label: view.label,
        width: pxW,
        height: pxH,
        dataUrl: pixelsToPngDataURL(pixels, pxW, pxH),
      });
    }
  } finally {
    renderer.setRenderTarget(savedRT);
    renderer.clippingPlanes = savedClips;
    renderer.setClearColor(savedClearColor, savedClearAlpha);
    viewer3d.background = savedBg;
    for (const ex of reShow) ex.visible = true;
    viewer3d.needsUpdate = true;
  }

  return out;
}
