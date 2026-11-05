// The landing page's 3D: a real Pazl kitchen built from the Designer's own
// unit models (copied to public/landing/models), and small turntable views of
// single units. three.js 0.118, as the Designer uses.
//
// The models are in metres with their origin at the FRONT-LEFT-BOTTOM corner,
// fronts facing +z and backs at z = -depth.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const BASE = "/landing/models/";

// --- the home: kitchen | living | bedroom along one back wall -----------------
// Pazl's own units: [model, x, z, turn (radians about up), y]. Their origin is
// the front-left-bottom corner, front towards +z; the back wall is z = -0.6.
const WALL_Z = -0.6;
const UNIT_Z = 0; // fronts of 0.55-deep units, backs on the wall
export const HOME = [
  // kitchen, x 0 – 4.1
  ["tall-600", 0.0, UNIT_Z, 0],
  ["base-600", 0.6, UNIT_Z, 0],
  ["pullout-200", 1.2, UNIT_Z, 0],
  ["sink-1200", 1.4, UNIT_Z, 0],
  ["drawer-900", 2.6, UNIT_Z, 0],
  ["base-600", 3.5, UNIT_Z, 0],
  ["wall-600", 0.6, -0.282, 0, 1.45],
  ["wall-600", 1.2, -0.282, 0, 1.45],
  ["wall-600", 1.8, -0.282, 0, 1.45],
  ["wall-600", 2.4, -0.282, 0, 1.45],
  ["wall-450", 3.0, -0.282, 0, 1.45],
  ["wall-600", 3.45, -0.282, 0, 1.45],
  // living, x 4.7 – 8.9: TV unit with its panel on the wall
  ["tv-panel-1800", 5.9, WALL_Z, 0, 0.42],
  ["tv-unit-1800", 5.9, WALL_Z + 0.45, 0],
  // bedroom, x 9.1 – 13.4: a pair of wardrobes
  ["wardrobe-600-l", 9.3, -0.05, 0],
  ["wardrobe-600-r", 9.9, -0.05, 0],
];
// Bought-in pieces with their own scale and origin: fitted by their box.
// [model, centre x, centre z, turn, longest side in metres]
const FITTED = [
  ["sofa", 6.8, 2.9, Math.PI, 2.1],
  ["bed", 11.95, 0.66, 0, 2.3],
];
export const HOME_PIECES = HOME.length + FITTED.length;
export const ROOMS = ["Kitchen", "Living", "Bedroom"];

// Laminate looks the hero steps through: a tint over the shutter's wood.
export const LAMINATES = [
  { name: "Natural oak", tint: "#ffffff" },
  { name: "Walnut", tint: "#b88a64" },
  { name: "Graphite", tint: "#8d939c" },
  { name: "Sage", tint: "#b4c2a8" },
];

const loader = new GLTFLoader();
const cache = new Map();
/** A model, loaded once; each use gets its own copy (materials shared). */
export function loadModel(name) {
  if (!cache.has(name)) {
    cache.set(
      name,
      new Promise((resolve, reject) => loader.load(BASE + name + ".glb", (g) => resolve(g.scene), undefined, reject))
    );
  }
  return cache.get(name).then((scene) => scene.clone(true));
}

function prepare(object, shadows) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadows;
    o.receiveShadow = shadows;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (m && m.map) m.map.encoding = THREE.sRGBEncoding;
      // Remember which materials are shutters, for the laminate tint.
      if (m && /shutter/i.test(m.name || "")) {
        m.userData.shutter = true;
        if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
      }
    });
  });
  return object;
}

function lights(scene, shadows) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfc4, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(-2.5, 5.5, 4.5);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -3;
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0006;
  }
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xfff4e8, 0.35);
  fill.position.set(4, 3, 6);
  scene.add(fill);
}

function renderer(canvas, transparent) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, powerPreference: "low-power" });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  if (transparent) r.setClearColor(0x000000, 0);
  return r;
}

// Hex colours are sRGB; with sRGB output the material colour must be linear.
const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();

const reducedMotion = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The hero: an open-plan home cut away — kitchen, living, bedroom — turning
 * slowly; drag to look round. Draws only while on screen. `onReady` fires
 * once the furniture is in.
 */
export function mountHome(canvas, { onReady, onLaminate } = {}) {
  const r = renderer(canvas, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#efecf9");
  r.toneMappingExposure = 0.92;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9bca9, 0.62));
  const sun = new THREE.DirectionalLight(0xfff6ea, 0.95);
  sun.position.set(3, 9, 9);
  sun.target.position.set(6.7, 0, 1);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xfff4e8, 0.35);
  fill.position.set(12, 4, 8);
  scene.add(fill);

  // The home's shell: three floors, the back wall, two end walls, two
  // part-height partitions between the rooms, a splash band and worktop.
  const shell = new THREE.Group();
  const DEPTH = 4.6; // floor from the back wall towards you
  const ROOM_X = [0, 4.6, 9.0, 13.4];
  const FLOORS = ["#cfcac2", "#c4a37a", "#dcc9ae"];
  FLOORS.forEach((colour, i) => {
    const w = ROOM_X[i + 1] - ROOM_X[i];
    const f = new THREE.Mesh(
      new THREE.PlaneGeometry(w, DEPTH),
      new THREE.MeshStandardMaterial({ color: srgb(colour), roughness: 0.9 })
    );
    f.rotation.x = -Math.PI / 2;
    f.position.set(ROOM_X[i] + w / 2, 0, WALL_Z + DEPTH / 2);
    f.receiveShadow = true;
    shell.add(f);
  });
  const wallMat = new THREE.MeshStandardMaterial({ color: srgb("#f4f1ec"), roughness: 1 });
  const box = (w, h, d, x, y, z, mat = wallMat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    shell.add(m);
    return m;
  };
  const H = 2.7;
  box(13.6, H, 0.1, 6.7, H / 2, WALL_Z - 0.05); // back wall
  box(0.1, H, 2.2, -0.05, H / 2, WALL_Z + 1.1); // end walls, cut short
  box(0.1, H, 2.2, 13.45, H / 2, WALL_Z + 1.1);
  box(0.1, H, 1.9, 4.6, H / 2, WALL_Z + 0.95); // partitions
  box(0.1, H, 1.9, 9.0, H / 2, WALL_Z + 0.95);
  const splash = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 0.56),
    new THREE.MeshStandardMaterial({ color: srgb("#dfe7ee"), roughness: 0.6 })
  );
  splash.position.set(0.6 + 3.5 / 2, 1.17, WALL_Z + 0.002);
  shell.add(splash);
  const stone = new THREE.MeshStandardMaterial({ color: srgb("#2e3238"), roughness: 0.38, metalness: 0.05 });
  box(3.5, 0.04, 0.64, 0.6 + 3.5 / 2, 0.87, WALL_Z + 0.31, stone); // worktop over the base run
  // The TV on its panel, and rugs that mark the living room and the bedroom.
  const screen = new THREE.MeshStandardMaterial({ color: srgb("#15171c"), roughness: 0.25, metalness: 0.3 });
  box(1.32, 0.76, 0.04, 6.8, 1.24, WALL_Z + 0.06, screen);
  const rug = (w, d, x, z, colour) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: srgb(colour), roughness: 1 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.receiveShadow = true;
    shell.add(m);
  };
  rug(2.8, 1.9, 6.8, 2.2, "#b3a2e2");
  rug(3.0, 1.2, 11.95, 2.55, "#b9a48a");
  scene.add(shell);

  const furniture = new THREE.Group();
  scene.add(furniture);
  const shutters = new Set();
  const collect = (m) =>
    m.traverse((o) => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
        if (mat && mat.userData.shutter) shutters.add(mat);
      });
    });
  const placed = HOME.map(([name, x, z, turn, y]) =>
    loadModel(name).then((m) => {
      prepare(m, true);
      m.position.set(x, y || 0, z);
      m.rotation.y = turn;
      furniture.add(m);
      collect(m);
    })
  );
  const fitted = FITTED.map(([name, cx, cz, turn, longest]) =>
    loadModel(name).then((m) => {
      prepare(m, true);
      // Bring it to metres if it is not already, then stand it on the floor
      // with its middle at (cx, cz).
      const holder = new THREE.Group();
      holder.add(m);
      let b = new THREE.Box3().setFromObject(m);
      let s = b.getSize(new THREE.Vector3());
      const side = Math.max(s.x, s.z);
      if (side < 0.5 || side > 4) m.scale.multiplyScalar(longest / side);
      b = new THREE.Box3().setFromObject(m);
      const c = b.getCenter(new THREE.Vector3());
      m.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
      holder.position.set(cx, 0, cz);
      holder.rotation.y = turn;
      furniture.add(holder);
    })
  );
  Promise.all(placed.concat(fitted))
    .then(() => onReady && onReady())
    .catch((e) => {
      console.warn("landing: home models", e);
      onReady && onReady();
    });

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  const target = new THREE.Vector3(6.7, 0.95, 0.75);
  camera.position.set(6.7, 6.6, 12.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.42;
  controls.minAzimuthAngle = -Math.PI * 0.12;
  controls.maxAzimuthAngle = Math.PI * 0.12;
  controls.autoRotate = !reducedMotion();
  controls.autoRotateSpeed = 0.45;
  controls.update();
  // Turn back and forth inside the limits instead of stopping at one end.
  let dir = 1;

  let laminate = 0;
  const setLaminate = (i) => {
    laminate = i;
    const tint = new THREE.Color(LAMINATES[i].tint);
    shutters.forEach((m) => m.color.copy(m.userData.baseColor).multiply(tint));
    onLaminate && onLaminate(i);
  };
  const timer = reducedMotion()
    ? null
    : window.setInterval(() => setLaminate((laminate + 1) % LAMINATES.length), 4200);

  const size = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    r.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow frames (phones) see the whole home by stepping back.
    camera.position.sub(target).setLength(w / h < 1.2 ? 20 : 13.8).add(target);
    camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(canvas);

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.01 });
  io.observe(canvas);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const az = controls.getAzimuthalAngle();
    if (controls.autoRotate) {
      if (az <= controls.minAzimuthAngle + 0.01) dir = -1;
      else if (az >= controls.maxAzimuthAngle - 0.01) dir = 1;
      controls.autoRotateSpeed = 0.45 * dir;
    }
    controls.update();
    r.render(scene, camera);
  };
  tick();

  // For checking the picture while building the page (?lpshot): one frame as
  // an image, drawn on demand.
  if (/[?&]lpshot(&|=|$)/.test(window.location.search)) {
    window.__lpShot = () => {
      controls.update();
      r.render(scene, camera);
      return canvas.toDataURL("image/jpeg", 0.85);
    };
  }

  return {
    setLaminate,
    dispose() {
      cancelAnimationFrame(raf);
      if (timer) window.clearInterval(timer);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      r.dispose();
    },
  };
}

/**
 * Turntables for single units: ONE renderer draws each unit and copies the
 * picture into that card's own 2D canvas, so the page holds one 3D context
 * however many cards there are. Drag a card to turn its unit any way.
 */
export function mountTurntables(entries) {
  const glCanvas = document.createElement("canvas");
  const r = renderer(glCanvas, true);
  const views = [];
  let raf = 0;

  entries.forEach(({ canvas, model }) => {
    const scene = new THREE.Scene();
    lights(scene, false);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
    const pivot = new THREE.Group();
    scene.add(pivot);
    const view = { canvas, scene, camera, pivot, yaw: -0.6, pitch: 0.32, spin: !reducedMotion(), visible: false, ready: false };
    views.push(view);
    loadModel(model)
      .then((m) => {
        prepare(m, false);
        // Centre it on the pivot and frame it.
        const box = new THREE.Box3().setFromObject(m);
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        m.position.sub(c);
        pivot.add(m);
        const radius = Math.max(s.x, s.y, s.z) * 0.62;
        view.distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
        view.ready = true;
      })
      .catch((e) => console.warn("landing: unit model", model, e));

    // Drag to turn (pointer events, so mouse, pen and finger alike).
    let last = null;
    canvas.addEventListener("pointerdown", (e) => {
      last = { x: e.clientX, y: e.clientY };
      view.spin = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      view.yaw += (e.clientX - last.x) * 0.012;
      view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + (e.clientY - last.y) * 0.01));
      last = { x: e.clientX, y: e.clientY };
    });
    const end = () => (last = null);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  });

  const io = new IntersectionObserver((list) => {
    list.forEach((e) => {
      const v = views.find((x) => x.canvas === e.target);
      if (v) v.visible = e.isIntersecting;
    });
  });
  views.forEach((v) => io.observe(v.canvas));

  const ctxs = new Map();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    views.forEach((v) => {
      if (!v.visible || !v.ready) return;
      const w = v.canvas.clientWidth;
      const h = v.canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (v.canvas.width !== Math.round(w * dpr) || v.canvas.height !== Math.round(h * dpr)) {
        v.canvas.width = Math.round(w * dpr);
        v.canvas.height = Math.round(h * dpr);
      }
      r.setPixelRatio(dpr);
      r.setSize(w, h, false);
      if (v.spin) v.yaw += 0.006;
      v.pivot.rotation.set(0, v.yaw, 0);
      v.camera.aspect = w / h;
      v.camera.position.set(0, Math.sin(v.pitch) * v.distance, Math.cos(v.pitch) * v.distance);
      v.camera.lookAt(0, 0, 0);
      v.camera.updateProjectionMatrix();
      r.render(v.scene, v.camera);
      let ctx = ctxs.get(v.canvas);
      if (!ctx) ctxs.set(v.canvas, (ctx = v.canvas.getContext("2d")));
      ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
      ctx.drawImage(glCanvas, 0, 0, v.canvas.width, v.canvas.height);
    });
  };
  tick();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      r.dispose();
    },
  };
}
