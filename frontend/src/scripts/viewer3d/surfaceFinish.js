import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
} from "three";

/**
 * HOW A FINISH REFLECTS LIGHT — gloss and metal.
 *
 * A material here was only ever a picture. Matte, High Gloss and a metallic
 * laminate were all drawn through the same dull recipe, so the one thing that
 * tells them apart on a real sheet — how they catch the light — was never on
 * screen: an HD Gloss décor in a solid colour looked like a flat fill.
 *
 * A finish may now say how it behaves:
 *
 *   gloss  0…1   0 = dead matte, 1 = mirror
 *   metal  0…1   0 = laminate/paint, 1 = bare metal
 *
 * The values are DATA. They are set per grade in the Rate Card's Manage lists
 * (and may be overridden on one material); nothing in this file knows what
 * "HD Gloss" is. A finish that states neither is not touched at all — every
 * caller keeps its original material for it, so anything that existed before
 * this is drawn exactly as it was.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/**
 * The surface a finish states, cleaned up — or null when it states none.
 * Null is what keeps the original drawing path; a surface of all zeros is
 * treated the same, since "no gloss, no metal" is what that path already is.
 */
export const readSurface = (surface) => {
  if (!surface || typeof surface !== "object") return null;
  const gloss = clamp01(surface.gloss);
  const metal = clamp01(surface.metal);
  if (!gloss && !metal) return null;
  return { gloss, metal };
};

/**
 * A finish's surface: its own if it has one, else its grade's.
 *
 * `categories` is the grade list the editor already keeps; the finish names
 * its grade by categoryId. A populated `finishing.category` is used when the
 * record came with one.
 */
export const surfaceOfFinishing = (finishing, categories) => {
  if (!finishing) return null;
  const own = readSurface(finishing.surface);
  if (own) return own;
  const populated = readSurface(finishing.category && finishing.category.surface);
  if (populated) return populated;
  const list = Array.isArray(categories)
    ? categories
    : Array.isArray(categories && categories.data)
    ? categories.data
    : [];
  const grade = list.find(
    (c) => c && String(c._id) === String(finishing.categoryId)
  );
  return readSurface(grade && grade.surface);
};

/**
 * SOMETHING TO REFLECT.
 *
 * Gloss is not a property that can be seen on its own: a polished surface
 * shows its surroundings, and in a scene with nothing around it there is
 * nothing to show. So a small room is built once — pale walls, a bright
 * ceiling, a window-like panel and a darker floor — and blurred into the
 * lookup the standard material samples from.
 *
 * It is given ONLY to materials made here. Setting it on the whole scene would
 * relight every furniture model's own materials, which is a change to things
 * nobody asked to change.
 */
let renderer = null;
let envTexture = null;
let envFailed = false;
const waiting = [];

const buildEnvironment = () => {
  if (envTexture || envFailed || !renderer) return envTexture;
  let pmrem = null;
  try {
    const room = new Scene();
    // `power` above 1 is a light source: the lookup is stored in a
    // high-range format, so a window can be many times brighter than a wall,
    // which is what makes its reflection read as a highlight.
    const slab = (w, h, d, x, y, z, hex, power = 1, side) => {
      const material = new MeshBasicMaterial({
        color: new Color(hex).multiplyScalar(power),
      });
      if (side) material.side = side;
      const m = new Mesh(new BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      room.add(m);
    };
    // The shell, seen from inside. DARK, and that matters: the lookup lights
    // the surface as well as being reflected in it, so a bright room adds a
    // flat wash that bleaches the finish's own colour. Kept dim, it adds
    // almost nothing — and the lights below stand out sharply against it.
    slab(20, 12, 20, 0, 0, 0, 0x26282b, 1, BackSide);
    slab(20, 0.2, 20, 0, -5.9, 0, 0x121212);
    slab(20, 0.2, 20, 0, 5.9, 0, 0x34373a);
    // The lights: narrow and very bright. Narrow keeps their total small (no
    // wash); bright is what lets a laminate, which reflects only a few per
    // cent of what it faces, still show a clear highlight. Strips on every
    // wall, so a polished door catches a band of light from any angle and the
    // band slides across it as the view turns — the cue the eye reads as gloss.
    slab(0.35, 0.2, 9, -4.5, 5.7, 0, 0xffffff, 14);
    slab(0.35, 0.2, 9, 4.5, 5.7, 0, 0xffffff, 14);
    [-6, 0, 6].forEach((z) => slab(0.2, 8, 0.3, -9.8, 0.5, z, 0xeaf3ff, 14));
    [-6, 0, 6].forEach((x) => slab(0.3, 8, 0.2, x, 0.5, -9.8, 0xf2f7ff, 14));
    [-6, 0, 6].forEach((x) => slab(0.3, 8, 0.2, x, 0.5, 9.8, 0xffffff, 14));
    [-6, 0, 6].forEach((z) => slab(0.2, 8, 0.3, 9.8, 0.5, z, 0xfff0d8, 14));

    pmrem = new PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(room, 0.03).texture;
    room.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  } catch (e) {
    // A glossy finish without reflections is still a correctly lit material;
    // it must never be the reason a cabinet fails to draw.
    console.warn("surfaceFinish: environment could not be built", e);
    envFailed = true;
    envTexture = null;
  } finally {
    try {
      if (pmrem) pmrem.dispose();
    } catch (_) {}
  }
  return envTexture;
};

const giveEnvironment = (material) => {
  const env = buildEnvironment();
  if (env) {
    material.envMap = env;
    material.needsUpdate = true;
  } else if (!envFailed) {
    // No renderer yet (a design opened before the 3D view exists). Handed over
    // as soon as there is one.
    waiting.push(material);
  }
};

/** Called once by the 3D view with its renderer. */
export const setSurfaceRenderer = (r) => {
  if (!r || renderer === r) return;
  renderer = r;
  envTexture = null;
  envFailed = false;
  const env = buildEnvironment();
  while (waiting.length) {
    const m = waiting.pop();
    if (env) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  }
};

/**
 * The material for a finish that states a surface — or null when it states
 * none, in which case the caller builds what it always built.
 *
 * `map` is the already-prepared texture (tiling, grain and encoding are the
 * caller's business and are not touched here).
 *
 * Roughness is simply the inverse of gloss, floored so a full-gloss surface
 * still spreads a highlight instead of collapsing to a single hot pixel.
 * A metal's reflection takes the colour of the picture, which is what makes
 * a brass or copper laminate read as that metal rather than as chrome.
 */
export const makeSurfaceMaterial = (map, surface) => {
  const s = readSurface(surface);
  if (!s) return null;
  const material = new MeshStandardMaterial({
    map: map || null,
    roughness: Math.max(0.06, 1 - s.gloss),
    metalness: s.metal,
    flatShading: true,
  });
  // A mirror-bright room on a matte-ish finish washes the colour out; the
  // reflection is scaled with how polished the finish says it is.
  material.envMapIntensity = 0.35 + 0.65 * Math.max(s.gloss, s.metal);
  giveEnvironment(material);
  return material;
};
