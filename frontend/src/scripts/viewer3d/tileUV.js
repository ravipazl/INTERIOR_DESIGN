import { Vector3, Float32BufferAttribute, BufferGeometry } from "three";

const AXES = ["x", "y", "z"];

/**
 * A clean, non-indexed, non-interleaved copy of a geometry.
 *
 * NOT three's toNonIndexed(). That reads interleaved (packed) buffers with
 * raw index arithmetic in this build and pulls the wrong numbers out — it
 * scrambled a sofa when the group-merge was written, and it shredded a
 * cabinet when this file first tried a per-face projection. Reading through
 * getX/getY/getZ decodes interleaved data correctly, which is the whole
 * point of doing it by hand.
 *
 * Lifted from Viewer3d's __toCleanNonIndexed, which now calls this, so the
 * merge path and the texture path cannot drift apart.
 *
 * Attributes other than position/normal/uv are dropped, and so are material
 * groups — callers must check they are not handing over a multi-material
 * mesh.
 */
export function toCleanNonIndexed(geom) {
  const idx = geom.index;
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const uv = geom.attributes.uv;
  const count = idx ? idx.count : pos.count;
  const outPos = new Float32Array(count * 3);
  const outNor = new Float32Array(count * 3);
  const outUv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const v = idx ? idx.getX(i) : i;
    outPos[i * 3] = pos.getX(v);
    outPos[i * 3 + 1] = pos.getY(v);
    outPos[i * 3 + 2] = pos.getZ(v);
    if (nor) {
      outNor[i * 3] = nor.getX(v);
      outNor[i * 3 + 1] = nor.getY(v);
      outNor[i * 3 + 2] = nor.getZ(v);
    }
    if (uv) {
      outUv[i * 2] = uv.getX(v);
      outUv[i * 2 + 1] = uv.getY(v);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(outPos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(outNor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(outUv, 2));
  if (!nor) g.computeVertexNormals();
  return g;
}

/**
 * Which local axis points up once the mesh is in the room, and what each
 * axis's total scale is.
 *
 * The world matrix's columns are the local axes in world space. The y part of
 * a column divided by the column's own length says how vertical that axis is,
 * so a scaled model is not mistaken for a tilted one; the column's length by
 * itself is that axis's scale, which turns file units into room centimetres.
 */
function frameOf(mesh) {
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  const column = (c) => Math.hypot(e[c], e[c + 1], e[c + 2]);
  const scale = { x: column(0), y: column(4), z: column(8) };
  const uprightness = (c) => (column(c) > 0 ? Math.abs(e[c + 1]) / column(c) : 0);
  const upness = { x: uprightness(0), y: uprightness(4), z: uprightness(8) };
  const up = AXES.reduce((a, b) => (upness[b] > upness[a] ? b : a));
  return { scale, up, level: AXES.filter((a) => a !== up) };
}

/**
 * Turn the grain of a wood texture through 90°.
 *
 * WHICH WAY THE PICTURE ALREADY RUNS DECIDES WHICH SETTING IS THE QUARTER
 * TURN, and getting that backwards puts every part at right angles to its own
 * label. This first assumed the pictures were shot grain-across, so Vertical
 * was the rotation. They are not: a laminate décor is photographed the way an
 * 8 × 4 sheet is shown, standing up, with the grain running DOWN the image —
 * visible in any of the swatches in the panel.
 *
 * So VERTICAL is the do-nothing case and HORIZONTAL is the quarter turn.
 *
 * A part with no direction stored at all also does nothing, which keeps every
 * part made before this control existed looking exactly as it does today; the
 * panel shows those as Vertical, so the label and the cabinet agree.
 *
 * ROTATING MEANS SWAPPING THE REPEATS, which is the part that is easy to get
 * wrong. three.js composes the UV transform so that, at 90°, repeat.x ends up
 * multiplying the mesh's V axis and repeat.y its U axis. Passing the repeats
 * through unswapped would rotate the grain correctly and silently stretch the
 * tile — a 200 cm tall door would get the repeat meant for its 60 cm width.
 * Swapping them keeps one copy measuring the same number of centimetres on
 * the panel whichever way the grain runs.
 *
 * @param {Texture} texture
 * @param {Number} repeatU copies across u
 * @param {Number} repeatV copies across v
 * @param {String} grain   "Vertical" | "Horizontal" | "" (case does not matter)
 * @returns {String} what happened, for the caller to log
 */
export function applyGrainDirection(texture, repeatU, repeatV, grain) {
  if (String(grain || "").trim().toLowerCase() !== "horizontal") {
    texture.repeat.set(repeatU, repeatV);
    return "grain vertical (picture as shot)";
  }
  // Rotate about the middle of the image, not its corner: about the corner
  // the picture swings out of the panel and leaves it half empty.
  texture.center.set(0.5, 0.5);
  texture.rotation = Math.PI / 2;
  texture.repeat.set(repeatV, repeatU);
  return "grain HORIZONTAL (rotated 90°)";
}

// Where a generated projection is remembered on the geometry, so later coats
// of paint measure the panel the same way the first one did.
const PROJECTION = "pazlTileProjection";
const PER_FACE = "pazlPerFaceUV";

/**
 * Lay the wood onto every face of a part, each from the two directions that
 * face actually spans.
 *
 * WHY NOT THE MODEL'S OWN UV MAP
 *
 * A modeller's map is an ATLAS: each face gets its own rectangle inside the
 * 0..1 square, packed however it fits — some laid in sideways to save room,
 * some squashed. Nothing in the file says which is which. One rotation turns
 * the whole square at once, so faces whose rectangles were packed alike move
 * together and any face packed differently is permanently out of step: on a
 * three-sided carcass, two faces obeyed the control and the third showed
 * stretched bands with no grain at all. No single angle can satisfy an atlas
 * whose rectangles disagree, so the atlas has to go.
 *
 * WHY NOT ONE PROJECTION FOR THE WHOLE MESH
 *
 * Tried, and worse. A single plane faces one way; a face at right angles to
 * it has one coordinate constant across its whole surface, so it samples a
 * single line of the picture and smears. Grain on the back, a wash down both
 * sides.
 *
 * SO: PER FACE. Each triangle is mapped from the two directions it spans,
 * never from the one it faces — which is precisely the case that smears.
 *
 *   - An upright face (door, side, back): across × up. The vertical
 *     coordinate is the part's real up, so every upright face of every part
 *     reads the same way.
 *   - A flat face (shelf top, counter, cabinet top): there is no up, so the
 *     grain runs along the surface's LENGTH — its longer level side. That is
 *     how a counter is actually made: a board's grain runs along its length,
 *     laid parallel to the front edge. Front-to-back would mean short pieces
 *     joined every 60 cm, which nobody builds.
 *
 * MEASURED IN CENTIMETRES. The coordinates are real distances along the
 * part, so one `1 / tileCm` tiles every face at the same physical size. This
 * is not a nicety: each face is now mapped differently, and a texture has
 * only ONE repeat — fractions would need a different repeat per face, which
 * cannot be expressed.
 *
 * The geometry is de-indexed first, because a cube's corner is one vertex
 * shared by three faces and each now wants its own coordinates. That is done
 * with toCleanNonIndexed above, NOT three's own version — see the note there.
 *
 * @param {Mesh} mesh
 * @returns {{note: String, cmUV: Boolean}} cmUV true means the caller should
 *   repeat by 1/tileCm. False means nothing was changed and the caller should
 *   fall back to ensureTileableUV.
 */
export function projectPerFaceUV(mesh) {
  const geom0 = mesh && mesh.geometry;
  if (!geom0 || !geom0.attributes || !geom0.attributes.position) {
    return { note: "no geometry", cmUV: false };
  }
  // A multi-material mesh draws its sub-ranges through geometry groups, and
  // the clean copy does not carry them — rebuilding it would paint the whole
  // mesh in one material. Left alone; the caller's fallback handles it.
  if (Array.isArray(mesh.material)) {
    return { note: "multi-material mesh — left alone", cmUV: false };
  }

  const { scale, up, level } = frameOf(mesh);
  // Rebuilt only when something it depends on has actually moved: the
  // model's scale, or which way is up. Repainting a part should not churn
  // its geometry.
  const key = `${scale.x.toFixed(4)},${scale.y.toFixed(4)},${scale.z.toFixed(
    4
  )},${up}`;
  const done = geom0.userData && geom0.userData[PER_FACE];
  if (done && done.key === key) {
    return { note: `uv per-face kept (up=${up})`, cmUV: true };
  }

  // Already clean from an earlier call — only the coordinates need redoing.
  const geom = done ? geom0 : toCleanNonIndexed(geom0);
  if (!done) mesh.geometry = geom;

  const pos = geom.attributes.position;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const size = bb.getSize(new Vector3());
  const roomSize = {
    x: size.x * (scale.x || 1),
    y: size.y * (scale.y || 1),
    z: size.z * (scale.z || 1),
  };
  // The flat-top case, decided once: grain runs along the longer level side.
  const lengthwise =
    roomSize[level[1]] > roomSize[level[0]] ? level[1] : level[0];
  const crosswise = lengthwise === level[0] ? level[1] : level[0];

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const n = new Vector3();
  const out = new Float32Array(pos.count * 2);
  const faces = { x: 0, y: 0, z: 0 };

  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));

    // The axis this triangle FACES along. The other two are the ones it
    // spans, and those are the only ones safe to map from.
    const facing = AXES.reduce((p, q) =>
      Math.abs(n[q]) > Math.abs(n[p]) ? q : p
    );
    faces[facing]++;

    // v is the direction the grain runs along, because the décor photographs
    // are shot with the grain down the image and v follows the image's own
    // vertical. Upright faces take the part's real up; flat ones take the
    // surface's length.
    const axisV = facing === up ? lengthwise : up;
    const axisU =
      facing === up ? crosswise : level[0] === facing ? level[1] : level[0];

    const getU = getterFor(axisU);
    const getV = getterFor(axisV);
    for (let k = 0; k < 3; k++) {
      const j = i + k;
      out[j * 2] = (pos[getU](j) - bb.min[axisU]) * (scale[axisU] || 1);
      out[j * 2 + 1] = (pos[getV](j) - bb.min[axisV]) * (scale[axisV] || 1);
    }
  }

  geom.setAttribute("uv", new Float32BufferAttribute(out, 2));
  geom.attributes.uv.needsUpdate = true;
  geom.userData = geom.userData || {};
  geom.userData[PER_FACE] = { key };

  return {
    note: `uv per-face in cm — up=${up}, along=${lengthwise}, faces x/y/z=${faces.x}/${faces.y}/${faces.z}`,
    cmUV: true,
  };
}

function getterFor(axis) {
  return axis === "x" ? "getX" : axis === "y" ? "getY" : "getZ";
}

/**
 * Make sure a mesh can actually show a tiled texture.
 *
 * WHY THIS EXISTS
 *
 * `texture.repeat` does not move pixels around on its own — it multiplies the
 * mesh's UV coordinates. A mesh whose UVs are missing, or whose UVs are all
 * the same point (every vertex at 0,0 is the common case in an exported GLB
 * that was never unwrapped), samples ONE texel of the image and paints the
 * whole surface with it. The result is a flat solid colour that looks exactly
 * like a material that failed to load — but nothing failed: the texture is
 * there, the repeat is correct, and there is no error anywhere.
 *
 * Floors never hit this because their geometry is generated in code with
 * proper UVs. Furniture comes from uploaded GLBs, whose UVs are whatever the
 * person who modelled them left behind.
 *
 * WHAT IT DOES
 *
 * A usable UV map is left alone. The modeller unwrapped the WHOLE box — back,
 * sides, top — and nothing derivable here can match that: a projection built
 * from a bounding box faces one way, so the faces at right angles to it have
 * one coordinate constant across their whole surface and smear. A carcass
 * came out with grain on its back and a stretched wash down both sides.
 *
 * The grain control does not need these UVs to be ours. Rotating the texture
 * turns the picture on whatever layout is present, so Vertical works either
 * way, and leaving a good map alone costs the feature nothing.
 *
 * A map is built only where there is none, or where it has collapsed to a
 * point — the case that paints a whole panel in one texel and looks exactly
 * like a material that failed to load. There, anything is an improvement.
 *
 * `force` builds one regardless. Nothing passes it today; it was used by the
 * tiled path and withdrawn for the smearing above. Kept because the choice is
 * a real one, not because it is currently wanted.
 *
 * THE AXES ARE CHOSEN BY ORIENTATION, NOT BY SIZE. Picking the two LARGEST
 * sides seems natural and is wrong: on a tall door the biggest side is its
 * height, so the picture gets laid on its side; on a wide shelf the biggest
 * side is its width, so the same picture stands upright. So v follows the
 * part's real up-and-down direction and u the wider of its two level sides.
 *
 * Which local axis points up is read from the mesh's world matrix rather than
 * assumed to be y, because a part may be rotated inside its GLB.
 *
 * AND THE PROJECTION IS REMEMBERED alongside the attribute. Building the UVs
 * is a one-off, but the caller needs the two sides they were built from on
 * EVERY repaint, to size the tile. Without a record, the second coat of paint
 * finds the UVs already present and leaves the caller to fall back to a
 * different measurement — so a part looked one way the first time a material
 * was applied and another way every time after. The stored sides are in file
 * units, with the model's current scale applied on each read, so resizing a
 * cabinet re-measures rather than replaying a stale number.
 *
 * KNOWN LIMITATION — ONE PLANE PER MESH. A single projection can only face
 * one way, so a face at right angles to it has one coordinate constant across
 * its whole surface and samples a single line of the picture, stretched: a
 * cabinet can show grain on its front and a smooth gradient on its side. A
 * per-triangle projection was tried as a cure and withdrawn — it mangled the
 * geometry — so this is recorded, not yet solved.
 *
 * @param {Mesh} mesh
 * @param {{force?: Boolean}} [options] force: project here even if the model
 *   brought its own UVs.
 * @returns {{note: String, uLen: Number|null, vLen: Number|null}}
 *   uLen/vLen are the panel's sides along u and v in room centimetres, for the
 *   caller to size the tile with — null only when the model's own UV layout
 *   was left in place, which cannot be measured from here.
 */
export function ensureTileableUV(mesh, options) {
  const force = !!(options && options.force);
  const geom = mesh && mesh.geometry;
  const pos = geom && geom.attributes && geom.attributes.position;
  if (!pos) return { note: "no geometry", uLen: null, vLen: null };

  // Needed in both halves below: to judge which way each axis points, and to
  // turn file units into room centimetres.
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  const column = (c) => Math.hypot(e[c], e[c + 1], e[c + 2]);
  const worldScale = { x: column(0), y: column(4), z: column(8) };
  const toRoom = (len, axis) => len * (worldScale[axis] || 1);

  // OURS FIRST, always. A projection this function built is correct for every
  // later coat of paint, so reuse it whether or not `force` was passed — that
  // keeps a part looking the same however many times it is repainted.
  const was = geom.userData && geom.userData[PROJECTION];
  if (was) {
    const uLen = toRoom(was.lenU, was.axisU);
    const vLen = toRoom(was.lenV, was.axisV);
    return {
      note: `uv kept — across=${was.axisU}(${Math.round(
        uLen
      )}cm) up=${was.axisV}(${Math.round(vLen)}cm)`,
      uLen,
      vLen,
    };
  }

  // The model's own layout is honoured only for untiled materials.
  const uv = geom.attributes.uv;
  if (!force && uv && uv.count) {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    // A thousandth of the 0..1 space. Anything narrower than this collapses to
    // a single texel on screen whatever the repeat is.
    if (maxU - minU > 1e-3 && maxV - minV > 1e-3) {
      return {
        note: `uv ok, model's own (${minU.toFixed(2)}..${maxU.toFixed(
          2
        )} x ${minV.toFixed(2)}..${maxV.toFixed(2)})`,
        uLen: null,
        vLen: null,
      };
    }
  }

  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const size = bb.getSize(new Vector3());
  const extent = { x: size.x, y: size.y, z: size.z };

  /**
   * HOW NEARLY EACH LOCAL AXIS POINTS STRAIGHT UP, and how long it is in the
   * room rather than in the file.
   *
   * The world matrix's columns are the local axes in world space. The y part
   * of a column, divided out by the column's own length, says how vertical
   * that axis is without a scaled model being mistaken for a tilted one; the
   * column's length on its own is that axis's total scale.
   *
   * The scale is not a detail. geometry.boundingBox measures the mesh as the
   * modeller drew it, and the caller divides by a tile size in real
   * centimetres. A GLB authored in metres reports a 2 m door as "2", 2/30 is
   * below one copy, Math.max clamps it to exactly 1, and the picture is
   * stretched once over the whole panel — a flat wash, with no error anywhere.
   */
  const uprightness = (c) => {
    const len = column(c);
    return len > 0 ? Math.abs(e[c + 1]) / len : 0;
  };
  const upness = { x: uprightness(0), y: uprightness(4), z: uprightness(8) };

  // v = the most vertical axis. u = the wider of the two that are left, which
  // for a flat panel is its face and not its thickness. Compared at room
  // scale, since the axes can be scaled by different amounts.
  const axisV = ["x", "y", "z"].reduce((a, b) => (upness[b] > upness[a] ? b : a));
  const worldExtent = (a) => toRoom(extent[a], a);
  const axisU = ["x", "y", "z"]
    .filter((a) => a !== axisV)
    .reduce((a, b) => (worldExtent(b) > worldExtent(a) ? b : a));

  const lenU = extent[axisU];
  const lenV = extent[axisV];
  // A mesh with no extent on two axes is a line or a point; there is no face
  // to map a texture onto, and dividing by its length would give Infinity.
  if (!(lenU > 0) || !(lenV > 0)) {
    return { note: "degenerate geometry — left alone", uLen: null, vLen: null };
  }
  const worldLenU = worldExtent(axisU);
  const worldLenV = worldExtent(axisV);

  const getter = (a) => (a === "x" ? "getX" : a === "y" ? "getY" : "getZ");
  const getU = getter(axisU);
  const getV = getter(axisV);
  const out = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    out[i * 2] = (pos[getU](i) - bb.min[axisU]) / lenU;
    out[i * 2 + 1] = (pos[getV](i) - bb.min[axisV]) / lenV;
  }
  geom.setAttribute("uv", new Float32BufferAttribute(out, 2));
  geom.attributes.uv.needsUpdate = true;
  // The record every later repaint reads back, so the tile is measured from
  // the same two sides each time. File units — the scale is applied on read,
  // so a resized cabinet re-measures instead of replaying this number.
  geom.userData = geom.userData || {};
  geom.userData[PROJECTION] = { axisU, axisV, lenU, lenV };

  return {
    note: `${uv ? "uv REBUILT" : "uv GENERATED"} — across=${axisU}(${Math.round(
      worldLenU
    )}cm) up=${axisV}(${Math.round(worldLenV)}cm)`,
    // Room centimetres, matching the units the tile size is quoted in — NOT
    // the file units lenU/lenV above, which only normalise the coordinates.
    uLen: worldLenU,
    vLen: worldLenV,
  };
}
