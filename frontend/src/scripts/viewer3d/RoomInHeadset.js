/**
 * SEE THE DESIGN IN THE REAL ROOM — a HoloLens 2 (or any WebXR headset) view.
 *
 * It opens on a MINIATURE of the design: the floor, the wall outlines and the
 * furniture as a model about 0.6 m across, floating ahead at table height. You
 * turn it (menu, or pinch on it and drag sideways), make it bigger or smaller,
 * and point at its floor: a marker shows the spot and an arrow the way you
 * would face — green on clear floor, red too close to a wall or furniture, or
 * outside the room. Air-tap a green spot and the design blinks up to LIFE SIZE
 * with that spot under your feet, facing the arrow's way. "Stand in room
 * centre" does the same for the room's middle, facing the way the 3D view was
 * looking.
 *
 * At life size the menu follows you, a little below your eyes: back to the
 * miniature, "Centre on me" (the chosen spot under your feet again, after you
 * have walked off), turn 90° / 5° (about you, to line the design up with the
 * real walls), raise or lower the floor, "Show" (everything → no wall
 * outlines → furniture only, without doors and windows), exit. The ✕
 * closes the menu to see the room clear; a small "Menu" tab brings it back.
 * A press counts the button the pinch STARTED on, so a hand that moves while
 * pinching does not miss.
 *
 * "Line up room" fits the design to the real room: air-tap two corners on the
 * miniature, then pinch with your fingers on the same two corners for real.
 * The design turns and moves so those corners sit on the real ones, and says
 * how far the real wall length differs from the plan's.
 *
 * "On real wall" checks a fit: pick an item (or the whole run of units on its
 * wall), then point at the two ends of the free space on a real wall. The
 * item stands against that wall with its back on it, as it sits on its wall
 * in the plan, alone in view, and the menu says whether it fits and by how
 * much. Slide it along the wall with the buttons or by pinching and moving.
 * Where the headset can see the room (WebXR hit-test, e.g. Quest 3) you point
 * at the wall itself; where it cannot (HoloLens in Edge), at the line where
 * the wall meets the floor.
 *
 * The room's centre is the room's own — from its corners — not the middle of
 * the furniture, which sat by one wall when that is where the furniture was.
 *
 * On HoloLens black is see-through, so only the design is drawn. It runs in
 * its OWN renderer and scene, so nothing here can touch the 3D view, the plan
 * or the saved project: the items are clones that share the real ones' meshes
 * and materials. The 3D view stops drawing while you are in the headset and
 * starts again when you leave.
 */

import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import BlueprintInterface from "@pazl/blueprint-interface.js";

const CM = 0.01; // the design is in cm, the headset in metres
const FALLBACK_EYE_M = 1.6; // floor below the eyes when the headset cannot say
const UP = new Vector3(0, 1, 0);

// The miniature: its longest side, and where it floats relative to your eyes.
const MINI_SIZE_M = 0.6;
const MINI_AHEAD_M = 0.75;
const MINI_BELOW_EYES_M = 0.5;
const MINI_ZOOM_STEP = 1.25;
const MINI_ZOOM_MIN = 0.5;
const MINI_ZOOM_MAX = 3;
// Pinch on the miniature and move sideways to turn it: the hand ray turns a
// few degrees, the model turns this many times as far.
const MINI_DRAG_GAIN = 3;
const MINI_DRAG_START_RAD = 0.04; // less than this is a tap, not a drag

// A spot to stand on: this far (cm) from any wall and any furniture lower
// than HEADROOM_CM. Furniture higher up (a wall cabinet, a ceiling light) does
// not stop you standing under it.
const CLEAR_CM = 25;
const HEADROOM_CM = 150;
// "Stand in room centre" moves off furniture that stands right there, to the
// nearest clear spot within this far.
const CENTRE_SEARCH_CM = 250;

const BLINK_MS = 240; // the design disappears this long while it changes scale

// Line up with the real room: on the miniature, a corner counts when the ray
// lands within this far (plan cm) of it. Real corners closer together than
// LINE_UP_MIN_M cannot set the turn well; lengths off by more than
// LINE_UP_WARN_CM mean a wrong corner was touched.
const CORNER_PICK_CM = 70;
const LINE_UP_MIN_M = 0.5;
const LINE_UP_WARN_CM = 15;

// On a real wall: units within RUN_CM of the same wall count as one run; the
// two ends must be WALL_MIN_M apart; a slide button moves SLIDE_M; a point
// on the floor counts only within WALL_REACH_M of you.
const RUN_CM = 20;
const WALL_MIN_M = 0.1;
const SLIDE_M = 0.05;
const WALL_REACH_M = 8;

/** Which kind of session this browser can open, or null. AR first. */
export async function headsetMode() {
  const xr = typeof navigator !== "undefined" ? navigator.xr : null;
  if (!xr || !xr.isSessionSupported) return null;
  for (const mode of ["immersive-ar", "immersive-vr"]) {
    try {
      if (await xr.isSessionSupported(mode)) return mode;
    } catch (e) {
      /* try the next one */
    }
  }
  return null;
}

let active = null;

export const isInHeadset = () => !!active;

/**
 * Open the headset view. Must be called straight from a click (the browser
 * only opens a headset session in answer to one). `viewer` is the 3D view
 * (Viewer3D). Resolves when the session has started; onEnd runs when it ends.
 */
export async function enterHeadset(viewer, { mode, onEnd } = {}) {
  if (active) return active;
  const xr = navigator.xr;
  const want = mode || (await headsetMode());
  if (!xr || !want) throw new Error("No headset found on this device.");

  // Ask first, while the click still counts as a click.
  const session = await xr.requestSession(want, {
    // hand-tracking: the fingertip, for touching a real corner when lining up;
    // hit-test: where the headset sees real walls, for "On real wall"
    optionalFeatures: ["local-floor", "hand-tracking", "hit-test"],
  });

  try {
    active = await start(viewer, session, onEnd);
    return active;
  } catch (e) {
    active = null;
    try {
      await session.end();
    } catch (ignore) {
      /* already ended */
    }
    throw e;
  }
}

export function exitHeadset() {
  if (active) active.exit();
}

/** Compass angle of a horizontal direction (0 = +z), the way rotation.y adds. */
const yawOf = (v) => Math.atan2(v.x, v.z);

async function start(viewer, session, onEnd) {
  // A context of our own, made ready for the headset before it is handed over.
  const canvas = document.createElement("canvas");
  const gl =
    canvas.getContext("webgl2", { alpha: true, antialias: true, xrCompatible: true }) ||
    canvas.getContext("webgl", { alpha: true, antialias: true, xrCompatible: true });
  if (!gl) throw new Error("This browser could not start 3D for the headset.");
  if (gl.makeXRCompatible) await gl.makeXRCompatible();
  const renderer = new WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0); // black = see-through on HoloLens
  renderer.xr.enabled = true;

  // local-floor puts the floor at y = 0. Without it the start is at the eyes,
  // so the floor is about 1.6 m down (and the menu can move it).
  let floorY = 0;
  try {
    await session.requestReferenceSpace("local-floor");
    renderer.xr.setReferenceSpaceType("local-floor");
  } catch (e) {
    renderer.xr.setReferenceSpaceType("local");
    floorY = -FALLBACK_EYE_M;
  }

  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x8a8070, 1.0));
  const sun = new DirectionalLight(0xffffff, 0.6);
  sun.position.set(1, 3, 2);
  scene.add(sun);
  const camera = new PerspectiveCamera(70, 1, 0.01, 100);
  scene.add(camera);

  // anchor (metres; placed and turned) → scaler (cm → m, and the miniature's
  // shrink) → design (cm, the room's centre at the origin).
  const anchor = new Group();
  const scaler = new Group();
  const design = new Group();
  anchor.add(scaler);
  scaler.add(design);
  scene.add(anchor);

  const plan = buildPlan(viewer);
  const built = buildDesign(viewer);
  built.items.forEach((o) => design.add(o));
  if (plan.walls) design.add(plan.walls);
  plan.floors.forEach((f) => design.add(f));
  design.position.set(-plan.centre.x, 0, -plan.centre.z);
  const extentM = Math.max(plan.size.x, plan.size.z, 100) * CM;
  const miniFit = MINI_SIZE_M / extentM;

  const menu = makeMenu();
  scene.add(menu.mesh);
  // With the menu closed, a small "Menu" tab low in view brings it back.
  const menuTab = makeMenuTab();
  menuTab.mesh.visible = false;
  scene.add(menuTab.mesh);
  const pointer = makePointer();
  scene.add(pointer.line);
  const marker = makeMarker();
  scene.add(marker.group);
  const dots = makeCornerDots(plan.corners);
  scaler.add(dots.group);
  // On a real wall: an outline round the chosen item (design cm), and the
  // free wall space you marked (headset metres).
  const selBox = makeSelBox();
  design.add(selBox.lines);
  const span = makeSpan();
  scene.add(span.group);

  // --- the 3D view stops drawing while you are in the headset -----------------
  const mainRenderer = viewer && viewer.renderer;
  try {
    if (mainRenderer) mainRenderer.setAnimationLoop(null);
  } catch (e) {
    /* keeps drawing; only slower */
  }

  // The way the 3D view was looking, as a facing in the design.
  const viewFacing = (() => {
    try {
      const dir = viewer.controls.target.clone().sub(viewer.camera.position);
      dir.y = 0;
      return dir.lengthSq() > 1e-6 ? yawOf(dir) : 0;
    } catch (e) {
      return 0;
    }
  })();

  // --- what is going on ---------------------------------------------------------
  const head = new Vector3();
  const headDir = new Vector3(0, 0, -1);
  let tracked = false;
  let mode = "mini";
  let zoom = 1;
  // What the life-size view shows, one tap of "Show" to the next: everything,
  // no wall outlines, or the furniture alone (no doors or windows either — in
  // the real room the real ones are there).
  let show = "all";
  // The spot chosen to stand on: p in design cm about the room's centre, and
  // the facing (compass angle in the design) you look along when standing.
  let spot = null;
  let aim = null; // what the hand ray points at on the miniature this frame
  let drag = null; // pinch-and-drag on the miniature
  let blink = null;
  let miniPlaced = false;
  let menuOpen = true;
  let menuSet = false;
  // The button lit up now. It stays lit a moment after the ray slips off, so
  // a shaky hand does not make it flicker or miss.
  let hover = null;
  let hoverSeenAt = 0;
  // The button each hand was on when its pinch STARTED: pinching moves the
  // hand, so by the release the ray has often slid off it.
  const pressedAt = new Map();
  // Lining up with the real room: { step, a, b, realA }. Steps: pickA, pickB
  // (corners on the miniature), touchA, touchB (the same corners for real).
  let lineUp = null;
  let cornerAimed = null; // the corner the ray is on, while picking
  // On a real wall: { step, sel, run, A, B, n, slide, fit }. Steps: pick (the
  // item), touchA, touchB (the two ends of the free space), placed.
  let wall = null;
  let wallAimed = null; // the real point the ray is on, while marking the wall
  let wallDrag = null; // pinch-and-move along the wall
  const pickable = built.items.filter((o) => !o.userData.opening && o.userData.box);
  const lastWallAim = new Map(); // per hand, the last frame's point
  const hitSources = new Map(); // per hand, its hit-test source (or null)

  const setScale = () => scaler.scale.setScalar(mode === "mini" ? CM * miniFit * zoom : CM);

  /** The miniature ahead of you, at table height, its turn kept. */
  const placeMini = () => {
    anchor.position.set(
      head.x + headDir.x * MINI_AHEAD_M,
      head.y - MINI_BELOW_EYES_M,
      head.z + headDir.z * MINI_AHEAD_M
    );
    miniPlaced = true;
  };

  /** Life size: `spot` under your feet, facing along where you are looking. */
  const standOnSpot = () => {
    if (!spot) return;
    const turn = yawOf(headDir) - spot.facing;
    anchor.rotation.y = turn;
    const at = new Vector3(spot.p.x * CM, 0, spot.p.z * CM).applyAxisAngle(UP, turn);
    anchor.position.set(head.x - at.x, floorY, head.z - at.z);
  };

  /** Show the change with the design hidden for a moment, like a blink. */
  const blinkTo = (change) => {
    blink = { until: performance.now() + BLINK_MS, change, changed: false };
  };

  const LINE_UP_STEPS = {
    pickA: ["Line up · 1 of 4", "On the model, air-tap a corner you can reach"],
    pickB: ["Line up · 2 of 4", "Air-tap a second corner, best along one wall"],
    touchA: ["Line up · 3 of 4", "Go to the real GREEN corner · pinch on it"],
    touchB: ["Line up · 4 of 4", "Now the real ORANGE corner · pinch on it"],
  };
  const showLineUp = () => {
    const [title, status] = LINE_UP_STEPS[lineUp.step];
    menu.setButtons(LINE_UP_BUTTONS);
    menu.setTitle(title);
    menu.setStatus(status);
    marker.hide();
  };

  /**
   * Wall outlines, doors and windows as "Show" says. The miniature shows all.
   * On a real wall, once the wall is being marked, only the chosen item.
   */
  const applyShow = () => {
    const life = mode === "life";
    const keep = wall && wall.step !== "pick" ? new Set(selection()) : null;
    if (plan.walls) plan.walls.visible = !keep && (!life || show === "all");
    built.items.forEach((o) => {
      o.visible = keep ? keep.has(o) : !o.userData.opening || !life || show !== "furniture";
    });
    menu.setShow(SHOW_LABELS[show], show !== "all");
  };

  const showMode = () => {
    setScale();
    plan.floors.forEach((f) => (f.visible = mode === "mini"));
    applyShow();
    marker.group.visible = false;
    dots.group.visible = mode === "mini" && !!lineUp;
    selBox.lines.visible = !!wall && wall.step === "pick";
    span.group.visible = !!wall && wall.step === "placed";
    if (wall) {
      showWall();
      return;
    }
    if (lineUp) {
      showLineUp();
      return;
    }
    menu.setButtons(mode === "mini" ? MINI_BUTTONS : LIFE_BUTTONS);
    menu.setTitle(mode === "mini" ? "Pazl · choose where to stand" : "Pazl · your design in this room");
    menu.setStatus(
      mode === "mini"
        ? built.items.length
          ? "Point at the floor · air-tap to step in"
          : "No furniture in this view · point at the floor"
        : "Life size · 'Miniature' to choose another spot"
    );
  };

  const goLife = (chosen) => {
    spot = chosen;
    blinkTo(() => {
      mode = "life";
      showMode();
      standOnSpot();
    });
  };

  const goMini = () => {
    blinkTo(() => {
      mode = "mini";
      anchor.rotation.y = 0;
      placeMini();
      showMode();
    });
  };

  /** Start lining up: on the miniature, with the room's corners shown. */
  const startLineUp = () => {
    if (plan.corners.length < 3) {
      menu.setStatus("No room outline to line up with");
      return;
    }
    const begin = () => {
      lineUp = { step: "pickA", a: null, b: null, realA: null };
      showMode();
    };
    if (mode === "mini") begin();
    else
      blinkTo(() => {
        mode = "mini";
        anchor.rotation.y = 0;
        placeMini();
        begin();
      });
  };
  const stopLineUp = () => {
    lineUp = null;
    cornerAimed = null;
    showMode();
  };

  /** The corner of the room nearest where a ray meets the miniature's floor. */
  const cornerAim = (ray) => {
    if (!ray || mode !== "mini" || !lineUp) return null;
    const floorAt = scaler.localToWorld(new Vector3(0, 0.5, 0)).y;
    const point = new Vector3();
    raycaster.set(ray.origin, ray.dir);
    if (!raycaster.ray.intersectPlane(new Plane(UP.clone(), -floorAt), point)) return null;
    const p = scaler.worldToLocal(point);
    let best = null;
    plan.corners.forEach((c, i) => {
      if (lineUp.step === "pickB" && i === lineUp.a) return;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < CORNER_PICK_CM && (!best || d < best.d)) best = { i, d };
    });
    return best ? best.i : null;
  };

  /** Where the pinching hand is: the fingertip, else the hand, else the ray's start. */
  const touchPoint = (frame, source) => {
    const ref = renderer.xr.getReferenceSpace();
    const at = (pose) => {
      const p = pose.transform.position;
      return new Vector3(p.x, p.y, p.z);
    };
    try {
      const tip = source.hand && source.hand.get && source.hand.get("index-finger-tip");
      const pose = tip && frame.getJointPose && frame.getJointPose(tip, ref);
      if (pose) return at(pose);
    } catch (e) {
      /* no finger joints here */
    }
    try {
      const pose = source.gripSpace && frame.getPose(source.gripSpace, ref);
      if (pose) return at(pose);
    } catch (e) {
      /* no grip */
    }
    const ray = rayFrom(frame, source);
    return ray ? ray.origin.clone() : head.clone();
  };

  /**
   * Both real corners touched: turn and place the life-size design so its two
   * corners sit on them. The turn comes from the line between them, the place
   * from their middle, which shares out any small error between the two.
   */
  const finishLineUp = (realA, realB) => {
    const pa = plan.corners[lineUp.a];
    const pb = plan.corners[lineUp.b];
    const real = new Vector3(realB.x - realA.x, 0, realB.z - realA.z);
    const inPlan = new Vector3(pb.x - pa.x, 0, pb.z - pa.z);
    if (real.length() < LINE_UP_MIN_M) {
      lineUp.step = "touchA";
      showLineUp();
      menu.setStatus("Those were too close together · touch GREEN again");
      return;
    }
    const turn = yawOf(real) - yawOf(inPlan);
    const midPlan = pa.clone().add(pb).multiplyScalar(0.5 * CM).applyAxisAngle(UP, turn);
    const midReal = realA.clone().add(realB).multiplyScalar(0.5);
    const offCm = Math.round(Math.abs(real.length() - inPlan.length() * CM) * 100);
    lineUp = null;
    cornerAimed = null;
    blinkTo(() => {
      mode = "life";
      showMode();
      anchor.rotation.y = turn;
      anchor.position.set(midReal.x - midPlan.x, floorY, midReal.z - midPlan.z);
      // Where you stand now, so "Centre on me" keeps to it.
      anchor.updateMatrixWorld(true);
      const here = scaler.worldToLocal(new Vector3(head.x, anchor.position.y, head.z));
      spot = { p: new Vector3(here.x, 0, here.z), facing: yawOf(headDir) - turn };
      menu.setStatus(
        offCm > LINE_UP_WARN_CM
          ? `Lined up · lengths differ by ${offCm} cm · check the corners`
          : `Lined up with the real room · within ${offCm} cm`
      );
    });
  };

  /** An air-tap while lining up: pick a corner, or take the hand's place. */
  const lineUpSelect = (frame, source, ray) => {
    const step = lineUp.step;
    if (step === "pickA" || step === "pickB") {
      const i = cornerAim(ray);
      if (i === null) {
        menu.setStatus("Point closer to a corner of the room");
        return;
      }
      if (step === "pickA") ((lineUp.a = i), (lineUp.step = "pickB"));
      else ((lineUp.b = i), (lineUp.step = "touchA"));
      showLineUp();
      return;
    }
    const p = touchPoint(frame, source);
    if (step === "touchA") {
      lineUp.realA = p;
      lineUp.step = "touchB";
      showLineUp();
      return;
    }
    finishLineUp(lineUp.realA, p);
  };

  /** Turn the life-size design about you, so you stay where you are in it. */
  const turnAboutYou = (angle) => {
    const from = anchor.position.clone().sub(new Vector3(head.x, anchor.position.y, head.z));
    from.applyAxisAngle(UP, angle);
    anchor.position.set(head.x + from.x, anchor.position.y, head.z + from.z);
    anchor.rotation.y += angle;
  };

  // --- an item on a real wall -------------------------------------------------
  // Design cm here are the 3D view's own (the design group's inside), and the
  // plan's x, y are its x, z.

  /** The item chosen, or with "Whole run" every unit on the same wall. */
  const selection = () => {
    if (!wall || !pickable.length) return [];
    const one = pickable[wall.sel];
    if (!wall.run) return [one];
    const w = wallOf([one]);
    if (!w) return [one];
    // Units that stand on this same wall (a corner unit on the next wall is
    // that wall's), close to its face.
    return pickable.filter((o) => {
      if (o === one) return true;
      const own = wallOf([o]);
      return own && own.seg === w.seg && alongWall(w, [o]).off < RUN_CM;
    });
  };

  /** The items' footprint corners (plan x, z). */
  const footprint = (items) => {
    const pts = [];
    items.forEach((o) => {
      const b = o.userData.box;
      pts.push(
        new Vector2(b.min.x, b.min.z),
        new Vector2(b.max.x, b.min.z),
        new Vector2(b.max.x, b.max.z),
        new Vector2(b.min.x, b.max.z)
      );
    });
    return pts;
  };

  /**
   * The plan wall the items stand against: the one nearest their middle.
   * `u` runs along it, `nrm` points from it into the room, `face` is how far
   * its inside face is from its centre line.
   */
  const wallOf = (items) => {
    const pts = footprint(items);
    if (!pts.length || !plan.wallSegs.length) return null;
    const c = new Vector2();
    pts.forEach((p) => c.add(p));
    c.divideScalar(pts.length);
    let best = null;
    plan.wallSegs.forEach((s) => {
      const d = s.b.clone().sub(s.a);
      const len = d.length();
      if (len < 1) return;
      const u = d.divideScalar(len);
      const t = Math.max(0, Math.min(len, c.clone().sub(s.a).dot(u)));
      const dist = c.distanceTo(s.a.clone().addScaledVector(u, t));
      if (!best || dist < best.dist) {
        let nrm = new Vector2(-u.y, u.x);
        if (c.clone().sub(s.a).dot(nrm) < 0) nrm = nrm.negate();
        best = { seg: s, dist, a: s.a, u, nrm, face: s.half, len };
      }
    });
    return best;
  };

  /** Where items reach along a wall (cm from its start), and how far off its face. */
  const alongWall = (w, items) => {
    let min = Infinity;
    let max = -Infinity;
    let off = Infinity;
    footprint(items).forEach((p) => {
      const q = p.clone().sub(w.a);
      const s = q.dot(w.u);
      min = Math.min(min, s);
      max = Math.max(max, s);
      off = Math.min(off, Math.abs(q.dot(w.nrm) - w.face));
    });
    return { min, max, off };
  };

  const nameOf = (o) => (o && o.userData.name) || "Item";
  const mmOf = (items) => {
    const w = wallOf(items.slice(0, 1));
    if (w) {
      const s = alongWall(w, items);
      return Math.round((s.max - s.min) * 10);
    }
    const b = items[0].userData.box;
    return Math.round(Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 10);
  };

  /** Outline the chosen item(s) while choosing. */
  const outlineSelection = () => {
    const items = selection();
    if (!items.length) return;
    const box = new Box3();
    items.forEach((o) => box.union(o.userData.box));
    selBox.set(box);
  };

  /**
   * Stand the chosen item(s) against the marked real wall: the plan wall's
   * inside face on the real line A–B, into the room on your side, the middle
   * of the item(s) at the middle of the space, moved along by `slide`.
   */
  const placeOnWall = () => {
    const items = selection();
    // The chosen item's own wall (a whole run shares it).
    const w = wallOf(items.slice(0, 1));
    if (!w || !wall.A || !wall.B) return;
    const real = wall.B.clone().sub(wall.A).setY(0);
    const lengthM = real.length();
    const dir = real.divideScalar(lengthM);
    const nrm = new Vector3(w.nrm.x, 0, w.nrm.y);
    const turn = yawOf(wall.n) - yawOf(nrm);
    const s = alongWall(w, items);
    const mid = (s.min + s.max) / 2;
    const inPlan = new Vector3(
      w.a.x + w.nrm.x * w.face + w.u.x * mid - plan.centre.x,
      0,
      w.a.y + w.nrm.y * w.face + w.u.y * mid - plan.centre.z
    )
      .multiplyScalar(CM)
      .applyAxisAngle(UP, turn);
    const at = wall.A.clone().addScaledVector(dir, lengthM / 2 + wall.slide);
    mode = "life";
    setScale();
    anchor.rotation.y = turn;
    anchor.position.set(at.x - inPlan.x, floorY, at.z - inPlan.z);
    const needMm = Math.round((s.max - s.min) * 10);
    const freeMm = Math.round(lengthM * 1000);
    wall.fit = { needMm, freeMm, spareMm: freeMm - needMm, lengthM };
    span.set(wall.A, wall.B, floorY, wall.fit.spareMm >= 0);
  };

  const fitText = () => {
    const f = wall.fit;
    if (!f) return "";
    return f.spareMm >= 0
      ? `Fits · ${f.needMm} mm in ${f.freeMm} mm · ${f.spareMm} mm spare`
      : `Too wide by ${-f.spareMm} mm · ${f.needMm} mm in ${f.freeMm} mm`;
  };

  // Can this headset see the real walls? (Asked for; it may say no.)
  const canScan = () =>
    !!session.requestHitTestSource &&
    (!session.enabledFeatures || session.enabledFeatures.indexOf("hit-test") >= 0);

  const showWall = () => {
    menu.setLabel("wallRun", wall.run ? "One item" : "Whole run");
    const items = selection();
    const what = items.length > 1 ? `${items.length} units` : nameOf(items[0]);
    if (wall.step === "pick") {
      menu.setButtons(WALL_PICK_BUTTONS);
      menu.setTitle("On real wall · 1 of 3 · choose");
      menu.setStatus(`${what} · ${mmOf(items)} mm · air-tap another or Next`);
      outlineSelection();
      return;
    }
    if (wall.step === "placed") {
      menu.setButtons(WALL_PLACED_BUTTONS);
      menu.setTitle(`${what} on your wall`);
      menu.setStatus(fitText());
      return;
    }
    menu.setButtons(WALL_TOUCH_BUTTONS);
    const end = wall.step === "touchA" ? "START" : "END";
    menu.setTitle(`On real wall · ${wall.step === "touchA" ? 2 : 3} of 3`);
    menu.setStatus(
      canScan()
        ? `Point at the real wall where the space ${end}S · air-tap`
        : `Point where the wall meets the floor · its ${end} · air-tap`
    );
  };

  const startWall = () => {
    if (!pickable.length) {
      menu.setStatus("No furniture in this view to place");
      return;
    }
    const begin = () => {
      wall = { step: "pick", sel: 0, run: false, A: null, B: null, n: null, slide: 0, fit: null };
      showMode();
    };
    if (mode === "life") begin();
    else
      blinkTo(() => {
        mode = "life";
        if (!spot) spot = { p: plan.nearestClear(new Vector3()) || new Vector3(), facing: viewFacing };
        standOnSpot();
        begin();
      });
  };

  const stopWall = () => {
    wall = null;
    wallAimed = null;
    wallDrag = null;
    showMode();
  };

  /** A real point marked on the wall: the start, then the end, then place. */
  const wallMark = (p) => {
    if (!p) {
      menu.setStatus(
        canScan() ? "Point at the real wall or floor" : "Point lower · at the floor by the wall"
      );
      return;
    }
    if (wall.step === "touchA") {
      wall.A = p.clone();
      wall.step = "touchB";
      span.mark(wall.A, floorY);
      showWall();
      return;
    }
    if (p.distanceTo(wall.A) < WALL_MIN_M) {
      menu.setStatus("Too close to the start · point at the END");
      return;
    }
    wall.B = p.clone();
    // Into the room: the side of the line you are standing on.
    const d = wall.B.clone().sub(wall.A).setY(0).normalize();
    wall.n = new Vector3(-d.z, 0, d.x);
    if (wall.n.dot(head.clone().sub(wall.A).setY(0)) < 0) wall.n.negate();
    wall.slide = 0;
    wall.step = "placed";
    blinkTo(() => {
      placeOnWall();
      showMode();
    });
  };

  /** Slide along the wall: "◀" to your left as you face it. */
  const slideBy = (m) => {
    const d = wall.B.clone().sub(wall.A).setY(0).normalize();
    const left = new Vector3().crossVectors(UP, wall.n.clone().negate());
    wall.slide += m * Math.sign(left.dot(d) || 1);
    placeOnWall();
    menu.setStatus(fitText());
  };

  /** Where a ray meets the marked wall's upright plane, along the wall (m from A). */
  const alongRealWall = (ray) => {
    if (!wall || !wall.A || !wall.n) return null;
    const point = new Vector3();
    raycaster.set(ray.origin, ray.dir);
    const plane = new Plane().setFromNormalAndCoplanarPoint(wall.n, wall.A);
    if (!raycaster.ray.intersectPlane(plane, point)) return null;
    const d = wall.B.clone().sub(wall.A).setY(0).normalize();
    return point.sub(wall.A).dot(d);
  };

  /** This hand's hit-test source, asked for once. */
  const hitSourceFor = (source) => {
    if (!canScan() || !source.targetRaySpace) return null;
    if (!hitSources.has(source)) {
      hitSources.set(source, null);
      session
        .requestHitTestSource({ space: source.targetRaySpace })
        .then((hs) => hitSources.set(source, hs))
        .catch(() => hitSources.set(source, null));
    }
    return hitSources.get(source);
  };

  /**
   * The real point a hand points at, at floor height: the real wall where the
   * headset sees it, else where the ray meets the floor (aim at the skirting).
   */
  const wallAimFrom = (frame, source, ray) => {
    const hs = hitSourceFor(source);
    if (hs) {
      try {
        const result = frame.getHitTestResults(hs)[0];
        const pose = result && result.getPose(renderer.xr.getReferenceSpace());
        if (pose) {
          const p = pose.transform.position;
          return new Vector3(p.x, floorY, p.z);
        }
      } catch (e) {
        /* no result this frame */
      }
    }
    if (ray.dir.y > -0.05) return null;
    const point = new Vector3();
    raycaster.set(ray.origin, ray.dir);
    if (!raycaster.ray.intersectPlane(new Plane(UP.clone(), -floorY), point)) return null;
    return point.distanceTo(head) < WALL_REACH_M ? point.setY(floorY) : null;
  };

  /** The item a ray lands on, as its place in `pickable`. */
  const itemHit = (ray) => {
    raycaster.set(ray.origin, ray.dir);
    const hit = raycaster.intersectObjects(pickable, true)[0];
    for (let o = hit && hit.object; o; o = o.parent) {
      const i = pickable.indexOf(o);
      if (i >= 0) return i;
    }
    return null;
  };

  const actions = {
    // miniature
    centre: () => {
      const p = plan.nearestClear(new Vector3(0, 0, 0));
      if (!p) {
        menu.setStatus("No clear floor near the room's centre");
        return;
      }
      goLife({ p, facing: viewFacing });
    },
    bigger: () => {
      zoom = Math.min(MINI_ZOOM_MAX, zoom * MINI_ZOOM_STEP);
      setScale();
    },
    smaller: () => {
      zoom = Math.max(MINI_ZOOM_MIN, zoom / MINI_ZOOM_STEP);
      setScale();
    },
    miniTurn: () => (anchor.rotation.y += Math.PI / 2),
    // life size
    more: () => menu.setButtons(LIFE_MORE_BUTTONS),
    back: () => menu.setButtons(LIFE_BUTTONS),
    mini: () => goMini(),
    me: () => standOnSpot(),
    left90: () => turnAboutYou(Math.PI / 2),
    left5: () => turnAboutYou(Math.PI / 36),
    right5: () => turnAboutYou(-Math.PI / 36),
    up: () => {
      floorY += 0.02;
      if (mode === "life") anchor.position.y = floorY;
    },
    down: () => {
      floorY -= 0.02;
      if (mode === "life") anchor.position.y = floorY;
    },
    show: () => {
      show = SHOW_NEXT[show];
      applyShow();
    },
    exit: () => session.end(),
    lineUp: () => startLineUp(),
    cancelLineUp: () => stopLineUp(),
    // on a real wall
    wall: () => startWall(),
    wallNext: () => {
      wall.sel = (wall.sel + 1) % pickable.length;
      if (wall.step === "placed") placeOnWall();
      showMode();
    },
    wallRun: () => {
      wall.run = !wall.run;
      if (wall.step === "placed") placeOnWall();
      showMode();
    },
    wallGo: () => {
      wall.step = "touchA";
      wall.A = wall.B = null;
      span.clear();
      showMode();
    },
    wallAgain: () => actions.wallGo(),
    slideL: () => slideBy(SLIDE_M),
    slideR: () => slideBy(-SLIDE_M),
    // Done keeps the design where it now stands, lined up on that wall.
    wallDone: () => stopWall(),
    wallCancel: () => {
      const placed = wall && wall.fit;
      stopWall();
      if (!placed) standOnSpot();
    },
    // the menu itself: close it to see the room, open it from the small tab
    close: () => {
      menuOpen = false;
      menu.mesh.visible = false;
      menuTab.mesh.visible = true;
      menuTab.mesh.userData.placed = false;
    },
    open: () => {
      menuOpen = true;
      menuSet = false; // straight in front of you, not drifting in
      menu.mesh.visible = true;
      menuTab.mesh.visible = false;
    },
  };

  const raycaster = new Raycaster();
  const rayFrom = (frame, source) => {
    const ref = renderer.xr.getReferenceSpace();
    if (!frame || !ref || !source || !source.targetRaySpace) return null;
    const pose = frame.getPose(source.targetRaySpace, ref);
    if (!pose) return null;
    const m = new Matrix4().fromArray(pose.transform.matrix);
    const origin = new Vector3().setFromMatrixPosition(m);
    const dir = new Vector3(0, 0, -1).applyQuaternion(new Quaternion().setFromRotationMatrix(m));
    return { origin, dir };
  };
  // The ray finds hidden meshes too, so only the one on show is tried.
  const menuHit = (ray) => {
    if (!ray) return null;
    raycaster.set(ray.origin, ray.dir);
    if (!menuOpen) return raycaster.intersectObject(menuTab.mesh, false)[0] ? "open" : null;
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    return hit && hit.uv ? menu.buttonAt(hit.uv, hover) : null;
  };
  /** A button pressed: a flash to show it took, then what it does. */
  const press = (key) => {
    if (!actions[key]) return;
    if (menuOpen) menu.flash(key);
    hover = null;
    actions[key]();
  };
  /** Where a ray meets the miniature's floor: the world point and the spot. */
  const miniFloorHit = (ray) => {
    if (!ray || mode !== "mini") return null;
    raycaster.set(ray.origin, ray.dir);
    const hit = raycaster.intersectObjects(plan.floors, false)[0];
    if (!hit) return null;
    const p = scaler.worldToLocal(hit.point.clone());
    p.y = 0;
    // You will face the way you look across the model now.
    const facing = yawOf(headDir) - anchor.rotation.y;
    return { world: hit.point, spot: { p, facing }, clear: plan.isClear(p) };
  };

  const onSelectStart = (event) => {
    if (blink) return;
    const ray = rayFrom(event.frame, event.inputSource);
    const button = (ray && menuHit(ray)) || hover;
    pressedAt.set(event.inputSource, button || null);
    // Placed on a real wall: pinch and move to slide it along.
    if (wall) {
      const s = !button && ray && wall.step === "placed" ? alongRealWall(ray) : null;
      if (s !== null)
        wallDrag = { source: event.inputSource, start: s, slide: wall.slide, moved: false };
      return;
    }
    // No turning the model while touching real corners.
    const touching = lineUp && lineUp.step.startsWith("touch");
    if (button || touching || mode !== "mini" || !ray || !miniFloorHit(ray)) return;
    drag = {
      source: event.inputSource,
      start: yawOf(ray.dir),
      turn: anchor.rotation.y,
      moved: false,
    };
  };
  const onSelectEnd = (event) => {
    pressedAt.delete(event.inputSource);
    if (wallDrag && wallDrag.source === event.inputSource) setTimeout(() => (wallDrag = null), 0);
    if (drag && drag.source === event.inputSource) {
      // "select" comes before "selectend": let it see the drag first.
      setTimeout(() => (drag = null), 0);
    }
  };
  const onSelect = (event) => {
    if (blink) return;
    const ray = rayFrom(event.frame, event.inputSource);
    // The button the pinch started on wins; with no start seen, where it is now.
    const started = pressedAt.has(event.inputSource);
    const button = started ? pressedAt.get(event.inputSource) : menuHit(ray);
    pressedAt.delete(event.inputSource);
    if (button) {
      press(button);
      return;
    }
    if ((drag && drag.moved) || (wallDrag && wallDrag.moved)) return;
    if (wall) {
      if (wall.step === "pick") {
        const i = ray ? itemHit(ray) : null;
        if (i !== null) ((wall.sel = i), showWall());
      } else if (wall.step.startsWith("touch")) {
        // The point from the last frame: hit-test answers only on a frame.
        const p = lastWallAim.get(event.inputSource) || (ray && wallAimFrom(event.frame, event.inputSource, ray));
        wallMark(p || null);
      }
      return;
    }
    if (lineUp) {
      lineUpSelect(event.frame, event.inputSource, ray);
      return;
    }
    if (mode !== "mini") return;
    const hit = miniFloorHit(ray);
    if (!hit) return;
    if (!hit.clear) {
      menu.setStatus("Not there · too close to a wall or furniture");
      return;
    }
    goLife(hit.spot);
  };
  session.addEventListener("selectstart", onSelectStart);
  session.addEventListener("selectend", onSelectEnd);
  session.addEventListener("select", onSelect);

  showMode();

  // --- every frame -----------------------------------------------------------
  renderer.setAnimationLoop((time, frame) => {
    const ref = renderer.xr.getReferenceSpace();
    const viewerPose = frame && ref ? frame.getViewerPose(ref) : null;
    if (viewerPose) {
      const m = new Matrix4().fromArray(viewerPose.transform.matrix);
      head.setFromMatrixPosition(m);
      headDir.set(0, 0, -1).applyQuaternion(new Quaternion().setFromRotationMatrix(m));
      headDir.y = 0;
      if (headDir.lengthSq() < 1e-6) headDir.set(0, 0, -1);
      headDir.normalize();
      tracked = true;
      if (!miniPlaced) {
        placeMini();
        setScale();
      }
      if (menuOpen) {
        followHead(menu.mesh, head, headDir, !menuSet);
        menuSet = true;
      } else {
        followHead(menuTab.mesh, head, headDir, !menuTab.mesh.userData.placed, TAB_AHEAD_M, TAB_BELOW_EYES_M);
        menuTab.mesh.userData.placed = true;
      }
    }

    // The blink: hide, change once hidden, show again.
    if (blink) {
      const now = performance.now();
      anchor.visible = false;
      if (!blink.changed && now >= blink.until - BLINK_MS / 2) {
        blink.changed = true;
        blink.change();
      }
      if (now >= blink.until) {
        blink = null;
        anchor.visible = true;
      }
    }

    // Pointer, menu hover, the marker on the miniature's floor, and a drag.
    // With both hands up, the one pointing at something wins — not simply the
    // first in the list, which left the other hand's ray dead.
    aim = null;
    let best = null;
    const sources = session.inputSources || [];
    for (let i = 0; i < sources.length; i++) {
      const ray = rayFrom(frame, sources[i]);
      if (!ray) continue;
      if (drag && drag.source === sources[i]) {
        let turned = yawOf(ray.dir) - drag.start;
        turned = Math.atan2(Math.sin(turned), Math.cos(turned));
        if (Math.abs(turned) > MINI_DRAG_START_RAD) drag.moved = true;
        if (drag.moved) anchor.rotation.y = drag.turn + turned * MINI_DRAG_GAIN;
      }
      if (wallDrag && wallDrag.source === sources[i]) {
        const s = alongRealWall(ray);
        if (s !== null) {
          const moved = s - wallDrag.start;
          if (Math.abs(moved) > 0.01) wallDrag.moved = true;
          if (wallDrag.moved) {
            wall.slide = wallDrag.slide + moved;
            placeOnWall();
            menu.setStatus(fitText());
          }
        }
      }
      const onMenu = menuHit(ray);
      // While lining up there is no spot to stand on, only corners to pick.
      const picking = lineUp && lineUp.step.startsWith("pick");
      const hit = onMenu || blink || lineUp || wall ? null : miniFloorHit(ray);
      const corner = onMenu || blink || !picking ? null : cornerAim(ray);
      // Marking a real wall: the real point this hand is on.
      const marking = wall && wall.step.startsWith("touch") && !blink;
      const real = !onMenu && marking ? wallAimFrom(frame, sources[i], ray) : null;
      if (marking) lastWallAim.set(sources[i], real);
      const rank = onMenu ? 2 : hit || corner !== null || real ? 1 : 0;
      if (!best || rank > best.rank) best = { ray, onMenu, hit, corner, real, rank };
    }
    cornerAimed = best && !best.onMenu ? best.corner : null;
    wallAimed = best && !best.onMenu ? best.real || null : null;
    if (wall && wall.step === "touchB" && wall.A) span.preview(wall.A, wallAimed, floorY);
    if (lineUp && mode === "mini") dots.show(cornerAimed, lineUp.a, lineUp.b);
    const now = performance.now();
    if (best && best.onMenu) {
      hover = best.onMenu;
      hoverSeenAt = now;
    } else if (now - hoverSeenAt > HOVER_HOLD_MS || (best && best.hit)) {
      hover = null;
    }
    if (best) {
      aim = best.hit;
      const end = aim
        ? aim.world
        : wallAimed
          ? wallAimed
        : cornerAimed !== null
          ? scaler.localToWorld(plan.corners[cornerAimed].clone().setY(0.5))
          : best.ray.origin.clone().addScaledVector(best.ray.dir, hover ? 0.6 : 2);
      pointer.show(best.ray.origin, end);
    } else {
      pointer.hide();
    }
    menu.setHover(hover);
    menuTab.setHover(hover === "open");
    if (aim && !(drag && drag.moved)) {
      marker.show(aim.world, yawOf(headDir), aim.clear, miniFit * zoom);
    } else if (wallAimed) {
      // A small ring (about 6 cm) on the spot, arrow along your view.
      marker.show(wallAimed, yawOf(headDir), true, 0.24);
    } else {
      marker.hide();
    }

    renderer.render(scene, camera);
  });

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    session.removeEventListener("selectstart", onSelectStart);
    session.removeEventListener("selectend", onSelectEnd);
    session.removeEventListener("select", onSelect);
    renderer.setAnimationLoop(null);
    // three.js tidies its side of the session in its own "end" handler, which
    // runs after this one — let it, then let the renderer go.
    setTimeout(release, 0);
  };
  const release = () => {
    // Only the copies' own bits; the meshes and materials belong to the 3D view.
    menu.dispose();
    menuTab.dispose();
    pointer.dispose();
    marker.dispose();
    dots.dispose();
    selBox.dispose();
    span.dispose();
    hitSources.forEach((hs) => {
      try {
        if (hs) hs.cancel();
      } catch (e) {
        /* gone with the session */
      }
    });
    plan.dispose();
    try {
      renderer.dispose();
      renderer.forceContextLoss();
    } catch (e) {
      /* already gone */
    }
    try {
      if (mainRenderer && viewer.render) mainRenderer.setAnimationLoop(viewer.render.bind(viewer));
    } catch (e) {
      console.error("headset: could not restart the 3D view", e);
    }
    if (viewer) viewer.__headset = null;
    active = null;
    if (onEnd) onEnd();
  };
  session.addEventListener("end", finish, { once: true });

  await renderer.xr.setSession(session);
  const handle = {
    session,
    exit: () => session.end().catch(() => finish()),
    // What the view is doing, for a look from the console (and the emulator).
    get state() {
      return {
        mode,
        tracked,
        zoom,
        show,
        menuOpen,
        lineUp: lineUp && { step: lineUp.step, a: lineUp.a, b: lineUp.b },
        cornerAimed,
        wall: wall && {
          step: wall.step,
          sel: wall.sel,
          run: wall.run,
          items: selection().map(nameOf),
          fit: wall.fit,
          slide: wall.slide,
          scan: canScan(),
        },
        spot: spot && { x: spot.p.x, z: spot.p.z, facing: spot.facing },
        aim: aim && { x: aim.spot.p.x, z: aim.spot.p.z, clear: aim.clear },
        drag: drag && { moved: drag.moved },
        anchor: {
          x: anchor.position.x,
          y: anchor.position.y,
          z: anchor.position.z,
          turn: anchor.rotation.y,
          scale: scaler.scale.x,
        },
        head: { x: head.x, y: head.y, z: head.z, facing: yawOf(headDir) },
        roomCentre: { x: plan.centre.x, z: plan.centre.z },
        items: built.items.length,
      };
    },
    /** Where a design spot (cm about the room's centre) is in the headset. */
    worldOf: (x, z) => scaler.localToWorld(new Vector3(x, 0, z)),
    /** The room's corners (cm about its centre), as lining up uses them. */
    corners: plan.corners.map((c) => ({ x: c.x, z: c.z })),
    /** Press a menu button by its key, as an air-tap on it would. */
    press: (key) => press(key),
    /** Mark a real floor point (m) on the wall, as an air-tap on it would. */
    wallTouch: (x, z) => wall && wallMark(new Vector3(x, floorY, z)),
    /** Where the chosen item's design spot (cm) is now, for checking a placement. */
    itemWorld: (i) => {
      const o = pickable[i];
      if (!o) return null;
      const c = new Vector3();
      o.userData.box.getCenter(c);
      return design.localToWorld(c.setY(o.userData.box.min.y));
    },
    /** The keys on the menu now. */
    get buttons() {
      return menu.keys();
    },
  };
  if (viewer) viewer.__headset = handle;
  return handle;
}

/**
 * Copies of every piece of furniture the 3D view is showing (a focused room
 * shows only its own), placed as they are in the design, with their outlines
 * on the floor for the spot check.
 */
function buildDesign(viewer) {
  const list = (viewer && viewer.__physicalRoomItems) || [];
  const items = [];
  list.forEach((phys) => {
    const loaded = phys && phys.__loadedItem;
    if (!loaded || !shownInView(phys)) return;
    loaded.updateWorldMatrix(true, false);
    const copy = loaded.clone(true);
    copy.userData.opening = isOpening(phys);
    // Its footprint in the design (cm) and its name, for "On real wall".
    try {
      const box = new Box3().setFromObject(loaded);
      if (!box.isEmpty()) copy.userData.box = box;
    } catch (e) {
      /* cannot be measured: it cannot be placed on its own */
    }
    try {
      const md = (phys.__itemModel && phys.__itemModel.__metadata) || {};
      copy.userData.name = md.itemName || md.name || "";
    } catch (e) {
      copy.userData.name = "";
    }
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(loaded.matrixWorld);
    copy.updateMatrixWorld(true);
    items.push(copy);
  });
  return { items };
}

/**
 * A door or a window: set in a wall (item types 3 and 7), or a parametric one
 * whose type says so. "Show: Furniture only" hides these, as the real room
 * has its own.
 */
function isOpening(phys) {
  try {
    const md = (phys.__itemModel && phys.__itemModel.__metadata) || {};
    const type = Number(phys.__itemType != null ? phys.__itemType : md.itemType);
    if (type === 3 || type === 7) return true;
    const kind = String(md.baseParametricType || "").toUpperCase();
    return kind.indexOf("DOOR") >= 0 || kind.indexOf("WINDOW") >= 0;
  } catch (e) {
    return false;
  }
}

function shownInView(obj) {
  for (let o = obj; o; o = o.parent) if (o.visible === false) return false;
  return true;
}

/**
 * The plan as the headset needs it, in design cm: the room's centre and the
 * plan's size, floors to point at on the miniature, faint wall outlines, and
 * the check for a clear spot to stand on.
 *
 * The centre is the room's own: the focused room, else the room the 3D view
 * is looking at, else the largest. Its middle is its area centre, or the
 * middle of its outline when that falls outside an L-shaped room.
 */
function buildPlan(viewer) {
  const fp = (viewer && viewer.floorplan) || null;
  const rooms = ((fp && fp.getRooms && fp.getRooms()) || []).filter(
    (r) => r && r.corners && r.corners.length > 2
  );
  const walls = ((fp && fp.getWalls && fp.getWalls()) || []).filter(
    (w) => w && w.start && w.end
  );
  const inRoom = (r, x, z) => {
    try {
      return !!r.pointInRoom(new Vector2(x, z));
    } catch (e) {
      return false;
    }
  };
  const areaOf = (cs) => {
    let a = 0;
    cs.forEach((c, i) => {
      const n = cs[(i + 1) % cs.length];
      a += c.x * n.y - n.x * c.y;
    });
    return a / 2;
  };

  const focusId = BlueprintInterface?.__roomFocusId || null;
  let room = focusId ? rooms.find((r) => r.roomByCornersId === focusId) : null;
  if (!room && viewer && viewer.controls) {
    const t = viewer.controls.target;
    room = rooms.find((r) => inRoom(r, t.x, t.z)) || null;
  }
  if (!room && rooms.length) {
    room = rooms.reduce((a, b) =>
      Math.abs(areaOf(b.corners)) > Math.abs(areaOf(a.corners)) ? b : a
    );
  }

  const centre = new Vector3();
  if (room) {
    const cs = room.corners;
    const a = areaOf(cs);
    let cx = 0;
    let cz = 0;
    cs.forEach((c, i) => {
      const n = cs[(i + 1) % cs.length];
      const k = c.x * n.y - n.x * c.y;
      cx += (c.x + n.x) * k;
      cz += (c.y + n.y) * k;
    });
    if (Math.abs(a) > 1e-6) centre.set(cx / (6 * a), 0, cz / (6 * a));
    if (!inRoom(room, centre.x, centre.z)) {
      const xs = cs.map((c) => c.x);
      const zs = cs.map((c) => c.y);
      centre.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
    }
  }

  // The room's corners as you can touch them — the walls' inside faces, not
  // their centre lines — in cm about the centre, for lining up.
  const inner = room && room.interiorCorners && room.interiorCorners.length > 2 ? room.interiorCorners : null;
  const corners = ((room && (inner || room.corners)) || []).map(
    (c) => new Vector3(c.x - centre.x, 0, c.y - centre.z)
  );

  // The whole plan's size, for the miniature's scale.
  const all = [];
  rooms.forEach((r) => r.corners.forEach((c) => all.push(c)));
  walls.forEach((w) => all.push(w.start, w.end));
  const size = new Vector3(100, 0, 100);
  if (all.length) {
    const xs = all.map((c) => c.x);
    const zs = all.map((c) => c.y);
    size.set(Math.max(...xs) - Math.min(...xs), 0, Math.max(...zs) - Math.min(...zs));
  }

  // Floors, to point at on the miniature (hidden at life size).
  const floorMaterial = new MeshBasicMaterial({
    color: new Color(0x8fc6e8),
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
  });
  const floors = rooms.map((r) => {
    const shape = new Shape(r.corners.map((c) => new Vector2(c.x, c.y)));
    const geometry = new ShapeGeometry(shape).rotateX(Math.PI / 2);
    const mesh = new Mesh(geometry, floorMaterial);
    mesh.position.y = 0.5; // just above the furniture's feet
    return mesh;
  });

  // Faint wall outlines: on the floor, along the top, an upright at each end.
  let wallLines = null;
  if (walls.length) {
    const pts = [];
    const height = (c) => Number(c.elevation) || 270;
    walls.forEach((w) => {
      const a = w.start;
      const b = w.end;
      pts.push(a.x, 0, a.y, b.x, 0, b.y);
      pts.push(a.x, height(a), a.y, b.x, height(b), b.y);
      pts.push(a.x, 0, a.y, a.x, height(a), a.y);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
    wallLines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: new Color(0x5fd0ff), transparent: true, opacity: 0.8 })
    );
  }

  // What stands on the floor and would be in the way (plan cm, x and z).
  const obstacles = [];
  ((viewer && viewer.__physicalRoomItems) || []).forEach((phys) => {
    const loaded = phys && phys.__loadedItem;
    if (!loaded || !shownInView(phys)) return;
    try {
      const box = new Box3().setFromObject(loaded);
      if (box.isEmpty() || box.min.y > HEADROOM_CM) return;
      obstacles.push(box);
    } catch (e) {
      /* an item that cannot be measured does not block */
    }
  });
  const distToSegment = (px, pz, a, b) => {
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.y) * dz) / l2));
    return Math.hypot(px - (a.x + t * dx), pz - (a.y + t * dz));
  };

  /** Can you stand at p (cm about the room's centre)? */
  const isClear = (p) => {
    const x = p.x + centre.x;
    const z = p.z + centre.z;
    if (rooms.length && !rooms.some((r) => inRoom(r, x, z))) return false;
    for (const w of walls) {
      const half = (Number(w.thickness) || 10) / 2;
      if (distToSegment(x, z, w.start, w.end) < CLEAR_CM + half) return false;
    }
    for (const b of obstacles) {
      if (
        x > b.min.x - CLEAR_CM &&
        x < b.max.x + CLEAR_CM &&
        z > b.min.z - CLEAR_CM &&
        z < b.max.z + CLEAR_CM
      ) {
        return false;
      }
    }
    return true;
  };

  /** p itself when clear, else the nearest clear spot within reach, or null. */
  const nearestClear = (p) => {
    if (isClear(p)) return p.clone();
    for (let r = 10; r <= CENTRE_SEARCH_CM; r += 10) {
      const steps = Math.max(8, Math.round((2 * Math.PI * r) / 10));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const q = new Vector3(p.x + Math.sin(a) * r, 0, p.z + Math.cos(a) * r);
        if (isClear(q)) return q;
      }
    }
    return null;
  };

  return {
    centre,
    corners,
    size,
    floors,
    walls: wallLines,
    // The walls as lines (plan cm, not about the centre), for "On real wall".
    wallSegs: walls.map((w) => ({
      a: new Vector2(w.start.x, w.start.y),
      b: new Vector2(w.end.x, w.end.y),
      half: (Number(w.thickness) || 10) / 2,
    })),
    isClear,
    nearestClear,
    dispose: () => {
      floors.forEach((f) => f.geometry.dispose());
      floorMaterial.dispose();
      if (wallLines) {
        wallLines.geometry.dispose();
        wallLines.material.dispose();
      }
    },
  };
}

// HoloLens 2 shows only about 15° above and below where you look, so the menu
// sits just under eye level, where all of it is in view without bowing your head.
const MENU_AHEAD_M = 0.7;
const MENU_BELOW_EYES_M = 0.07;
// The small "Menu" tab: near the bottom edge of what you see, out of the way.
const TAB_AHEAD_M = 0.8;
const TAB_BELOW_EYES_M = 0.17;
// How long a button stays lit after the hand ray slips off it.
const HOVER_HOLD_MS = 250;

/** Keep the menu in sight: ahead and a little low, catching up when you turn. */
function followHead(mesh, head, dir, snap, ahead = MENU_AHEAD_M, below = MENU_BELOW_EYES_M) {
  const want = new Vector3(head.x + dir.x * ahead, head.y - below, head.z + dir.z * ahead);
  const toMenu = mesh.position.clone().sub(head).setY(0).normalize();
  const off = Math.acos(Math.max(-1, Math.min(1, toMenu.dot(dir))));
  if (snap) mesh.position.copy(want);
  else if (off > 0.6 || mesh.position.distanceTo(want) > 0.45) mesh.userData.moving = true;
  if (mesh.userData.moving) {
    mesh.position.lerp(want, 0.08);
    if (mesh.position.distanceTo(want) < 0.03) mesh.userData.moving = false;
  }
  mesh.lookAt(head.x, head.y, head.z); // tilted up to face your eyes
}

// [key, label, column, row] — three big buttons a row, two rows; the rarer
// life-size ones are under "More".
// (The walls always show on the miniature, so its menu has "Line up" instead.)
const MINI_BUTTONS = [
  ["centre", "Stand in centre", 0, 0],
  ["miniTurn", "Turn 90°", 1, 0],
  ["lineUp", "Line up room", 2, 0],
  ["bigger", "Bigger", 0, 1],
  ["smaller", "Smaller", 1, 1],
  ["exit", "Exit", 2, 1],
];
const LIFE_BUTTONS = [
  ["mini", "Miniature", 0, 0],
  ["me", "Centre on me", 1, 0],
  ["show", "Show", 2, 0],
  ["wall", "On real wall", 0, 1],
  ["more", "More…", 1, 1],
  ["exit", "Exit", 2, 1],
];
// (Line up room is on the miniature's menu.)
const LIFE_MORE_BUTTONS = [
  ["left90", "Turn 90°", 0, 0],
  ["left5", "Turn ⟲ 5°", 1, 0],
  ["right5", "Turn 5° ⟳", 2, 0],
  ["up", "Floor ▲", 0, 1],
  ["down", "Floor ▼", 1, 1],
  ["back", "‹ Back", 2, 1],
];
const LINE_UP_BUTTONS = [["cancelLineUp", "Cancel", 2, 1]];
// On a real wall: choose the item, mark the wall, then slide and check.
const WALL_PICK_BUTTONS = [
  ["wallNext", "Next item", 0, 0],
  ["wallRun", "Whole run", 1, 0],
  ["wallGo", "Mark wall ▶", 2, 0],
  ["wallCancel", "Cancel", 2, 1],
];
const WALL_TOUCH_BUTTONS = [["wallCancel", "Cancel", 2, 1]];
const WALL_PLACED_BUTTONS = [
  ["slideL", "◀ 5 cm", 0, 0],
  ["slideR", "5 cm ▶", 1, 0],
  ["wallAgain", "Mark again", 2, 0],
  ["wallNext", "Next item", 0, 1],
  ["wallRun", "Whole run", 1, 1],
  ["wallDone", "Done", 2, 1],
];
// "Show", tap by tap, and what its button reads.
const SHOW_NEXT = { all: "noWalls", noWalls: "furniture", furniture: "all" };
const SHOW_LABELS = { all: "Show: Everything", noWalls: "Show: No walls", furniture: "Furniture only" };

/** The floating menu: a picture of buttons on a small panel. */
function makeMenu() {
  const W = 1024;
  const H = 582;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  // 42 cm wide: each button about 13 × 8 cm, easy to land a ray on.
  const mesh = new Mesh(
    new PlaneGeometry(0.42, 0.42 * (H / W)),
    new MeshBasicMaterial({ map: texture, transparent: true })
  );
  mesh.renderOrder = 10;

  const TOP = 130;
  const PAD = 24;
  const COLS = 3;
  const ROWS = 2;
  const BW = (W - PAD * (COLS + 1)) / COLS;
  const BH = (H - TOP - PAD * (ROWS + 1)) / ROWS;
  const rect = (col, row) => [PAD + col * (BW + PAD), TOP + PAD + row * (BH + PAD), BW, BH];
  // The close "✕", top right beside the title.
  const CLOSE = [W - PAD - 96, PAD, 96, 96];
  const inside = (px, py, [x, y, w, h], m = 0) =>
    px >= x - m && px <= x + w + m && py >= y - m && py <= y + h + m;
  const rectOf = (key) => {
    if (key === "close") return CLOSE;
    const b = buttons.find(([k]) => k === key);
    return b ? rect(b[2], b[3]) : null;
  };

  let buttons = [];
  let title = "";
  let status = "";
  let hover = null;
  let flashed = null; // just pressed: green for a moment
  let showLabel = "Show";
  let showOn = false; // lit while the view hides something
  const labels = {}; // a button's label for now ("Whole run" ↔ "One item")
  let gone = false;
  const draw = () => {
    if (gone) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(20,26,38,0.92)";
    roundRect(ctx, 0, 0, W, H, 36);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 44px Segoe UI, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(title, PAD + 8, 52);
    ctx.fillStyle = "#9fd8ff";
    ctx.font = "34px Segoe UI, Arial, sans-serif";
    ctx.fillText(status, PAD + 8, 104);
    buttons.forEach(([key, label, col, row]) => {
      const [x, y, w, h] = rect(col, row);
      const on = key === "show" && showOn;
      ctx.fillStyle =
        key === flashed
          ? "#22c55e"
          : key === hover
            ? "#3b82f6"
            : on
              ? "#1f6f9f"
              : key === "exit"
                ? "#7f1d1d"
                : "#2a3446";
      roundRect(ctx, x, y, w, h, 22);
      ctx.fill();
      if (key === hover && key !== flashed) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      // Long labels ("Show: Everything") step down in size to fit the button.
      const text = key === "show" ? showLabel : labels[key] || label;
      let size = 42;
      ctx.font = `600 ${size}px Segoe UI, Arial, sans-serif`;
      while (size > 26 && ctx.measureText(text).width > w - 28) {
        size -= 2;
        ctx.font = `600 ${size}px Segoe UI, Arial, sans-serif`;
      }
      ctx.fillText(text, x + w / 2, y + h / 2);
    });
    const [cx, cy, cw, ch] = CLOSE;
    ctx.fillStyle = flashed === "close" ? "#22c55e" : hover === "close" ? "#3b82f6" : "#2a3446";
    roundRect(ctx, cx, cy, cw, ch, cw / 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + 32, cy + 32);
    ctx.lineTo(cx + cw - 32, cy + ch - 32);
    ctx.moveTo(cx + cw - 32, cy + 32);
    ctx.lineTo(cx + 32, cy + ch - 32);
    ctx.stroke();
    texture.needsUpdate = true;
  };
  draw();

  return {
    mesh,
    setButtons: (list) => {
      if (list !== buttons) ((buttons = list), (hover = null), draw());
    },
    setTitle: (text) => {
      if (text !== title) ((title = text), draw());
    },
    setStatus: (text) => {
      if (text !== status) ((status = text), draw());
    },
    setHover: (key) => {
      if (key !== hover) ((hover = key), draw());
    },
    setShow: (label, on) => {
      if (label !== showLabel || on !== showOn) ((showLabel = label), (showOn = on), draw());
    },
    setLabel: (key, text) => {
      if (labels[key] !== text) ((labels[key] = text), draw());
    },
    /** The button at a point; the lit one (`keep`) reaches out into the gap round it. */
    buttonAt: (uv, keep) => {
      const px = uv.x * W;
      const py = (1 - uv.y) * H;
      const kept = keep && rectOf(keep);
      if (kept && inside(px, py, kept, PAD)) return keep;
      if (inside(px, py, CLOSE)) return "close";
      const found = buttons.find(([, , col, row]) => inside(px, py, rect(col, row)));
      return found ? found[0] : null;
    },
    flash: (key) => {
      flashed = key;
      draw();
      setTimeout(() => {
        if (flashed === key) ((flashed = null), draw());
      }, 200);
    },
    keys: () => ["close", ...buttons.map(([k]) => k)],
    dispose: () => {
      gone = true;
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
    },
  };
}

/** The small tab that opens the menu again once it is closed. */
function makeMenuTab() {
  const W = 320;
  const H = 120;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new PlaneGeometry(0.14, 0.14 * (H / W)),
    new MeshBasicMaterial({ map: texture, transparent: true })
  );
  mesh.renderOrder = 10;
  let hover = null;
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = hover ? "rgba(59,130,246,0.95)" : "rgba(20,26,38,0.85)";
    roundRect(ctx, 0, 0, W, H, H / 2);
    ctx.fill();
    // three bars, then the word
    ctx.fillStyle = "#ffffff";
    [36, 56, 76].forEach((y) => {
      roundRect(ctx, 44, y, 56, 9, 4);
      ctx.fill();
    });
    ctx.font = "600 48px Segoe UI, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("Menu", 124, H / 2 + 2);
    texture.needsUpdate = true;
  };
  draw();
  return {
    mesh,
    setHover: (on) => {
      if (on !== hover) ((hover = on), draw());
    },
    dispose: () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The hand ray. */
function makePointer() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
  const line = new Line(
    geometry,
    new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
  );
  line.frustumCulled = false;
  line.visible = false;
  return {
    line,
    show: (from, to) => {
      const p = geometry.attributes.position;
      p.setXYZ(0, from.x, from.y, from.z);
      p.setXYZ(1, to.x, to.y, to.z);
      p.needsUpdate = true;
      line.visible = true;
    },
    hide: () => {
      line.visible = false;
    },
    dispose: () => {
      geometry.dispose();
      line.material.dispose();
    },
  };
}

/**
 * Where you would stand, on the miniature: a ring the size of a person's
 * footprint in the model, and an arrow the way you would face. Green when you
 * can stand there, red when you cannot.
 */
function makeMarker() {
  const group = new Group();
  const ringMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.9, side: DoubleSide });
  const ring = new Mesh(new RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2), ringMaterial);
  const arrowGeometry = new BufferGeometry();
  // A flat triangle pointing along +z, from the ring's edge outwards.
  arrowGeometry.setAttribute(
    "position",
    new Float32BufferAttribute([-0.45, 0, 1.05, 0.45, 0, 1.05, 0, 0, 2.1], 3)
  );
  const arrow = new Mesh(arrowGeometry, ringMaterial);
  group.add(ring, arrow);
  group.visible = false;
  const green = new Color(0x34d399);
  const red = new Color(0xf87171);
  return {
    group,
    show: (at, facing, clear, miniScale) => {
      // A person is about 50 cm across; in the miniature, that shrunk.
      group.scale.setScalar(Math.max(0.006, 25 * CM * miniScale));
      group.position.set(at.x, at.y + 0.002, at.z);
      group.rotation.y = facing;
      ringMaterial.color.copy(clear ? green : red);
      group.visible = true;
    },
    hide: () => {
      group.visible = false;
    },
    dispose: () => {
      ring.geometry.dispose();
      arrowGeometry.dispose();
      ringMaterial.dispose();
    },
  };
}

/** A box outline round the item being chosen, in design cm. */
function makeSelBox() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Array(72).fill(0), 3));
  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95, depthTest: false })
  );
  lines.renderOrder = 6;
  lines.frustumCulled = false;
  lines.visible = false;
  return {
    lines,
    set: (box) => {
      const { min: a, max: b } = box;
      const c = [
        [a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, a.y, b.z], [a.x, a.y, b.z],
        [a.x, b.y, a.z], [b.x, b.y, a.z], [b.x, b.y, b.z], [a.x, b.y, b.z],
      ];
      const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      const p = geometry.attributes.position;
      edges.forEach((k, i) => p.setXYZ(i, c[k][0], c[k][1], c[k][2]));
      p.needsUpdate = true;
    },
    dispose: () => {
      geometry.dispose();
      lines.material.dispose();
    },
  };
}

/**
 * The free wall space marked on the real wall, in headset metres: a line on
 * the floor along the wall, an upright at each end. White while marking,
 * green when the item fits, red when it does not.
 */
function makeSpan() {
  const group = new Group();
  group.visible = false;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Array(18).fill(0), 3));
  const material = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
  const lines = new LineSegments(geometry, material);
  lines.renderOrder = 6;
  lines.frustumCulled = false;
  group.add(lines);
  const TICK_M = 0.3;
  const write = (a, b, y) => {
    const p = geometry.attributes.position;
    const end = b || a;
    p.setXYZ(0, a.x, y + 0.005, a.z);
    p.setXYZ(1, end.x, y + 0.005, end.z);
    p.setXYZ(2, a.x, y, a.z);
    p.setXYZ(3, a.x, y + TICK_M, a.z);
    p.setXYZ(4, end.x, y, end.z);
    p.setXYZ(5, end.x, y + (b ? TICK_M : 0), end.z);
    p.needsUpdate = true;
    group.visible = true;
  };
  return {
    group,
    /** The start marked: its upright alone. */
    mark: (a, y) => {
      material.color.set(0xffffff);
      write(a, null, y);
    },
    /** Marking the end: from the start to where you point. */
    preview: (a, b, y) => {
      material.color.set(0xffffff);
      write(a, b, y);
    },
    set: (a, b, y, fits) => {
      material.color.set(fits ? 0x22c55e : 0xef4444);
      write(a, b, y);
    },
    clear: () => {
      group.visible = false;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * The room's corners on the miniature, for lining up: white to pick from,
 * yellow under the ray, GREEN for the first corner chosen, ORANGE the second.
 * In the scaler's cm, so they shrink and turn with the model.
 */
function makeCornerDots(corners) {
  const group = new Group();
  group.visible = false;
  const disc = new RingGeometry(0, 1, 24).rotateX(-Math.PI / 2);
  const colours = {
    idle: new Color(0xffffff),
    aimed: new Color(0xfacc15),
    a: new Color(0x22c55e),
    b: new Color(0xf97316),
  };
  const dots = corners.map((c) => {
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.95, side: DoubleSide, depthTest: false });
    const mesh = new Mesh(disc, material);
    mesh.position.set(c.x, 1, c.z);
    mesh.renderOrder = 5;
    group.add(mesh);
    return mesh;
  });
  return {
    group,
    show: (aimed, a, b) => {
      dots.forEach((mesh, i) => {
        const role = i === a ? "a" : i === b ? "b" : i === aimed ? "aimed" : "idle";
        mesh.material.color.copy(colours[role]);
        // Chosen and aimed corners stand out a little bigger (radius in cm).
        mesh.scale.setScalar(role === "idle" ? 14 : 22);
      });
      group.visible = true;
    },
    dispose: () => {
      disc.dispose();
      dots.forEach((mesh) => mesh.material.dispose());
    },
  };
}
