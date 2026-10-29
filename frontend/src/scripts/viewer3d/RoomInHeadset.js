/**
 * SEE THE DESIGN IN THE REAL ROOM — a HoloLens 2 (or any WebXR headset) view.
 *
 * The furniture of the 3D view is shown as holograms at real size, standing in
 * the room you are in. On HoloLens black is see-through, so nothing else is
 * drawn: no walls, no floor, no sky — only the furniture, plus faint wall lines
 * when you ask for them, to help line the design up with the real walls.
 *
 *   air-tap the floor   the design's middle moves to that spot;
 *   the floating menu   turn it (90° / 5°), raise or lower the floor, walls
 *                       on/off, exit. It follows you around, a little below
 *                       your eyes.
 *
 * It runs in its OWN renderer and its own scene, so nothing here can touch the
 * 3D view, the plan or the saved project: the items are clones that share the
 * real ones' meshes and materials. The 3D view stops drawing while you are in
 * the headset (it cannot be seen anyway, and the HoloLens needs the power) and
 * starts again when you leave.
 */

import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
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
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import BlueprintInterface from "@pazl/blueprint-interface.js";

const CM = 0.01; // the design is in cm, the headset in metres
const FALLBACK_EYE_M = 1.6; // floor below the eyes when the headset cannot say

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
    optionalFeatures: ["local-floor"],
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
  const camera = new PerspectiveCamera(70, 1, 0.05, 100);
  scene.add(camera);

  // anchor (metres, on the real floor, turned) → scaled to cm → design, with
  // its middle at the anchor.
  const anchor = new Group();
  const scaler = new Group();
  scaler.scale.setScalar(CM);
  const design = new Group();
  anchor.add(scaler);
  scaler.add(design);
  scene.add(anchor);

  const built = buildDesign(viewer);
  built.items.forEach((o) => design.add(o));
  design.position.set(-built.centre.x, 0, -built.centre.z);
  const walls = buildWalls(viewer);
  if (walls) {
    walls.visible = false;
    design.add(walls);
  }
  anchor.position.y = floorY;

  const menu = makeMenu();
  scene.add(menu.mesh);
  const pointer = makePointer();
  scene.add(pointer.line, pointer.ring);

  // --- the 3D view stops drawing while you are in the headset -----------------
  const mainRenderer = viewer && viewer.renderer;
  try {
    if (mainRenderer) mainRenderer.setAnimationLoop(null);
  } catch (e) {
    /* keeps drawing; only slower */
  }

  let placed = false;
  let turn = 0;
  const applyTurn = () => {
    anchor.rotation.y = turn;
  };

  const actions = {
    left90: () => ((turn += Math.PI / 2), applyTurn()),
    left5: () => ((turn += Math.PI / 36), applyTurn()),
    right5: () => ((turn -= Math.PI / 36), applyTurn()),
    walls: () => {
      if (walls) walls.visible = !walls.visible;
      menu.setWalls(!!(walls && walls.visible));
    },
    up: () => ((floorY += 0.02), (anchor.position.y = floorY)),
    down: () => ((floorY -= 0.02), (anchor.position.y = floorY)),
    exit: () => session.end(),
  };
  menu.setStatus(
    built.items.length
      ? `${built.items.length} items · air-tap the floor to place`
      : "No furniture in this view"
  );
  menu.setWalls(false);

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
  const onFloor = (ray) => {
    if (!ray || ray.dir.y > -0.05) return null; // pointing at or above the horizon
    const t = (floorY - ray.origin.y) / ray.dir.y;
    if (t <= 0 || t > 15) return null;
    return ray.origin.clone().addScaledVector(ray.dir, t);
  };
  const menuHit = (ray) => {
    if (!ray) return null;
    raycaster.set(ray.origin, ray.dir);
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    return hit && hit.uv ? menu.buttonAt(hit.uv) : null;
  };

  const onSelect = (event) => {
    const ray = rayFrom(event.frame, event.inputSource);
    const button = menuHit(ray);
    if (button) {
      actions[button]();
      return;
    }
    const spot = onFloor(ray);
    if (spot) {
      anchor.position.set(spot.x, floorY, spot.z);
      placed = true;
    }
  };
  session.addEventListener("select", onSelect);

  // --- every frame -----------------------------------------------------------
  const head = new Vector3();
  const headDir = new Vector3();
  let menuSet = false;
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

      // Start with the design 1.5 m ahead, its front towards you.
      if (!placed) {
        anchor.position.set(head.x + headDir.x * 1.5, floorY, head.z + headDir.z * 1.5);
        turn = Math.atan2(headDir.x, headDir.z) + Math.PI;
        applyTurn();
        placed = true;
      }
      followHead(menu.mesh, head, headDir, !menuSet);
      menuSet = true;
    }

    // The pointer: the first hand (or gaze) ray, ending on the menu or floor.
    let shown = false;
    let hover = null;
    const sources = session.inputSources || [];
    for (let i = 0; i < sources.length && !shown; i++) {
      const ray = rayFrom(frame, sources[i]);
      if (!ray) continue;
      hover = menuHit(ray);
      const spot = hover ? null : onFloor(ray);
      const end = spot || ray.origin.clone().addScaledVector(ray.dir, hover ? 0.6 : 2);
      pointer.show(ray.origin, end, spot);
      shown = true;
    }
    if (!shown) pointer.hide();
    menu.setHover(hover);

    renderer.render(scene, camera);
  });

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    session.removeEventListener("select", onSelect);
    renderer.setAnimationLoop(null);
    // three.js tidies its side of the session in its own "end" handler, which
    // runs after this one — let it, then let the renderer go.
    setTimeout(release, 0);
  };
  const release = () => {
    // Only the clones' own bits; the meshes and materials belong to the 3D view.
    menu.dispose();
    pointer.dispose();
    if (walls) walls.geometry.dispose();
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
    active = null;
    if (onEnd) onEnd();
  };
  session.addEventListener("end", finish, { once: true });

  await renderer.xr.setSession(session);
  return { session, exit: () => session.end().catch(() => finish()) };
}

/**
 * Clones of every piece of furniture the 3D view is showing (a focused room
 * shows only its own), placed as they are in the design, plus the middle of
 * them all on the floor.
 */
function buildDesign(viewer) {
  const list = (viewer && viewer.__physicalRoomItems) || [];
  const items = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const at = new Vector3();
  list.forEach((phys) => {
    const loaded = phys && phys.__loadedItem;
    if (!loaded || !shownInView(phys)) return;
    loaded.updateWorldMatrix(true, false);
    const copy = loaded.clone(true);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(loaded.matrixWorld);
    copy.updateMatrixWorld(true);
    items.push(copy);
    at.setFromMatrixPosition(loaded.matrixWorld);
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x);
    minZ = Math.min(minZ, at.z);
    maxZ = Math.max(maxZ, at.z);
  });
  const centre = items.length
    ? new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    : new Vector3();
  return { items, centre };
}

function shownInView(obj) {
  for (let o = obj; o; o = o.parent) if (o.visible === false) return false;
  return true;
}

/**
 * Faint lines where the walls are: the focused room's outline (or every wall)
 * on the floor and at the top, and an upright at each corner.
 */
function buildWalls(viewer) {
  const plan = (viewer && viewer.floorplan) || null;
  const focusId = BlueprintInterface?.__roomFocusId || null;
  const segments = [];
  const rooms = (plan && plan.getRooms && plan.getRooms()) || [];
  const room = focusId ? rooms.find((r) => r && r.roomByCornersId === focusId) : null;
  if (room && room.corners && room.corners.length > 2) {
    const cs = room.corners;
    cs.forEach((c, i) => segments.push([c, cs[(i + 1) % cs.length]]));
  } else {
    const ws = (plan && plan.getWalls && plan.getWalls()) || [];
    ws.forEach((w) => w && w.start && w.end && segments.push([w.start, w.end]));
  }
  if (!segments.length) return null;
  const pts = [];
  const height = (c) => Number(c.elevation) || 270;
  segments.forEach(([a, b]) => {
    pts.push(a.x, 0, a.y, b.x, 0, b.y); // on the floor
    pts.push(a.x, height(a), a.y, b.x, height(b), b.y); // along the top
    pts.push(a.x, 0, a.y, a.x, height(a), a.y); // the corner upright
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
  return new LineSegments(
    geometry,
    new LineBasicMaterial({ color: new Color(0x5fd0ff), transparent: true, opacity: 0.8 })
  );
}

/** Keep the menu in sight: ahead and a little low, catching up when you turn. */
function followHead(mesh, head, dir, snap) {
  const want = new Vector3(head.x + dir.x * 0.7, head.y - 0.28, head.z + dir.z * 0.7);
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

/** The floating menu: a picture of buttons on a small panel. */
function makeMenu() {
  const W = 1024;
  const H = 560;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new PlaneGeometry(0.5, 0.5 * (H / W)),
    new MeshBasicMaterial({ map: texture, transparent: true })
  );
  mesh.renderOrder = 10;

  // [key, label, column, row]
  const BUTTONS = [
    ["left90", "Turn 90°", 0, 0],
    ["left5", "Turn ⟲ 5°", 1, 0],
    ["right5", "Turn 5° ⟳", 2, 0],
    ["walls", "Walls", 3, 0],
    ["up", "Floor ▲", 0, 1],
    ["down", "Floor ▼", 1, 1],
    ["exit", "Exit", 3, 1],
  ];
  const TOP = 130;
  const PAD = 24;
  const BW = (W - PAD * 5) / 4;
  const BH = (H - TOP - PAD * 3) / 2;
  const rect = (col, row) => [PAD + col * (BW + PAD), TOP + PAD + row * (BH + PAD), BW, BH];

  let status = "";
  let hover = null;
  let wallsOn = false;
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(20,26,38,0.92)";
    roundRect(ctx, 0, 0, W, H, 36);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 44px Segoe UI, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("Pazl · your design in this room", PAD + 8, 52);
    ctx.fillStyle = "#9fd8ff";
    ctx.font = "34px Segoe UI, Arial, sans-serif";
    ctx.fillText(status, PAD + 8, 104);
    BUTTONS.forEach(([key, label, col, row]) => {
      const [x, y, w, h] = rect(col, row);
      const on = key === "walls" && wallsOn;
      ctx.fillStyle = key === hover ? "#3b82f6" : on ? "#1f6f9f" : key === "exit" ? "#7f1d1d" : "#2a3446";
      roundRect(ctx, x, y, w, h, 22);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 38px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(key === "walls" ? (wallsOn ? "Walls: on" : "Walls: off") : label, x + w / 2, y + h / 2);
    });
    texture.needsUpdate = true;
  };
  draw();

  return {
    mesh,
    setStatus: (text) => {
      if (text !== status) ((status = text), draw());
    },
    setHover: (key) => {
      if (key !== hover) ((hover = key), draw());
    },
    setWalls: (on) => {
      if (on !== wallsOn) ((wallsOn = on), draw());
    },
    buttonAt: (uv) => {
      const px = uv.x * W;
      const py = (1 - uv.y) * H;
      const found = BUTTONS.find(([, , col, row]) => {
        const [x, y, w, h] = rect(col, row);
        return px >= x && px <= x + w && py >= y && py <= y + h;
      });
      return found ? found[0] : null;
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

/** The hand ray and, on the floor, a ring where an air-tap would place it. */
function makePointer() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
  const line = new Line(
    geometry,
    new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
  );
  line.frustumCulled = false;
  const ring = new Mesh(
    new RingGeometry(0.07, 0.1, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.9 })
  );
  line.visible = false;
  ring.visible = false;
  return {
    line,
    ring,
    show: (from, to, spot) => {
      const p = geometry.attributes.position;
      p.setXYZ(0, from.x, from.y, from.z);
      p.setXYZ(1, to.x, to.y, to.z);
      p.needsUpdate = true;
      line.visible = true;
      ring.visible = !!spot;
      if (spot) ring.position.set(spot.x, spot.y + 0.005, spot.z);
    },
    hide: () => {
      line.visible = false;
      ring.visible = false;
    },
    dispose: () => {
      geometry.dispose();
      line.material.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
    },
  };
}
