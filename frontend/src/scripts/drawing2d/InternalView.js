import { Box3, Vector3 } from "three";

/**
 * INTERNAL VIEW — draw the room with the cabinet fronts taken off.
 *
 * A working drawing of a kitchen normally shows the modules OPEN: the carcass,
 * its shelves and its divisions, not a wall of closed doors. The models already
 * contain all of that. A carcass is modelled as a hollow, open-fronted box —
 * its vertex planes run 0 / 18 … 1132 / 1150 across, 100 / 118 … 807 / 825 up
 * and −550 / −532 back, which is an 18 mm panel on every side with the front
 * left open. The shutter is a separate board covering that opening.
 *
 * So nothing has to be drawn or invented: hide the fronts and the inside is
 * already there. Drawing2DEngine's isDrawableRoomMesh skips anything with
 * `visible === false`, so the drawing, the snapshots and the working drawing
 * all follow with no change to the engine.
 *
 * WHY BY SHAPE AND NOT BY NAME. Every part arrives named Mesh_0, Mesh_1 … —
 * the importer renames them and the original names are not kept, so there is no
 * "Shutter" to look for. The backend bakes wood finishes onto these same parts
 * and has the same problem; detectByShape in scripts/lib/glb-wood-bake.mjs is
 * its answer, and the rule below is that rule, applied to the loaded meshes
 * instead of to the GLB file.
 */

// A shutter is a thin, tall, wide board. Millimetres.
const MAX_FRONT_THICKNESS = 25;
const MIN_FRONT_WIDTH = 120; // a 150 mm oil pull-out has a real shutter too
const MIN_FRONT_HEIGHT = 500; // excludes rails, plinths and drawer rails
// Depth within which boards count as being in the same front plane. Doors of a
// double unit are not always modelled at exactly the same depth.
const FRONT_PLANE_TOLERANCE = 5;
// A handle bar: very thin on its smallest side and short overall.
const MAX_HANDLE_THICKNESS = 12;
const MAX_HANDLE_LENGTH = 200;

/** Size of a mesh along the item's own axes, in millimetres. */
function localSizeMm(mesh, item) {
  const box = new Box3().setFromObject(mesh);
  if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  // The engine works in centimetres; the thresholds above are millimetres.
  // Measuring in the ITEM's frame rather than the world's is what makes this
  // independent of how the unit has been turned in the room.
  const local = item.worldToLocal
    ? item.worldToLocal(centre.clone())
    : centre.clone();
  return {
    mesh,
    size: [size.x * 10, size.y * 10, size.z * 10],
    centreZ: local.z * 10,
  };
}

/**
 * The front boards and handles of one placed module, or an empty array when it
 * has none — a worktop, a sink, an appliance, anything that is not a cabinet.
 */
export function frontPartsOf(item) {
  const root = item && (item.__loadedItem || item);
  if (!root || typeof root.traverse !== "function") return [];
  try {
    if (item.updateMatrixWorld) item.updateMatrixWorld(true);
    const rows = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const row = localSizeMm(o, item);
      if (row) rows.push(row);
    });
    if (rows.length < 2) return []; // a single-part model has no door to remove

    const boards = rows.filter(
      (r) =>
        Math.min(r.size[0], r.size[2]) <= MAX_FRONT_THICKNESS &&
        Math.max(r.size[0], r.size[2]) >= MIN_FRONT_WIDTH &&
        r.size[1] >= MIN_FRONT_HEIGHT
    );
    if (!boards.length) return [];

    // WHICH WAY IS THE FRONT? The side the doors are on, which is the extreme
    // end of the run of boards — a back panel is equally thin and equally tall,
    // and the only thing separating the two is which end they sit at. Taking
    // the furthest board in each direction and keeping the larger group settles
    // it without assuming the model faces +Z; some are modelled facing −Z.
    const near = Math.min(...boards.map((r) => r.centreZ));
    const far = Math.max(...boards.map((r) => r.centreZ));
    const atNear = boards.filter((r) => r.centreZ <= near + FRONT_PLANE_TOLERANCE);
    const atFar = boards.filter((r) => r.centreZ >= far - FRONT_PLANE_TOLERANCE);
    // A back panel is one board; a front is one or two doors. On a tie the
    // outermost wins, which for a cabinet is the door.
    const fronts = atFar.length >= atNear.length ? atFar : atNear;
    const frontZ = fronts[0].centreZ;

    // Handles go with the doors: a bar sitting proud of them, or a profile
    // strip in the door's own plane. Both sit in that plane, so one depth test
    // covers either kind and nothing deeper (a shelf, a rail) is caught.
    const handles = rows.filter((r) => {
      if (fronts.indexOf(r) !== -1) return false;
      const sorted = [...r.size].sort((a, b) => a - b);
      const isBar =
        sorted[0] <= MAX_HANDLE_THICKNESS && sorted[2] <= MAX_HANDLE_LENGTH;
      const inFrontPlane =
        Math.abs(r.centreZ - frontZ) <= MAX_FRONT_THICKNESS + FRONT_PLANE_TOLERANCE;
      return inFrontPlane && (isBar || sorted[2] <= r.size[1] + 1);
    });

    return fronts.concat(handles).map((r) => r.mesh);
  } catch (e) {
    // A module that cannot be read keeps its front — a drawing with one door
    // left on is far better than one that failed to generate.
    return [];
  }
}

/**
 * Take the fronts off every module in the scene. Returns a function that puts
 * them all back; call it in a `finally` so a failed generation cannot leave the
 * room standing open.
 */
export function hideModuleFronts(viewer3d) {
  const hidden = [];
  try {
    const items = (viewer3d && viewer3d.__physicalRoomItems) || [];
    items.forEach((item) => {
      frontPartsOf(item).forEach((mesh) => {
        if (mesh.visible === false) return; // already hidden by something else
        hidden.push(mesh);
        mesh.visible = false;
      });
    });
  } catch (e) {
    /* fall through — whatever was hidden is still restored below */
  }
  return () => {
    hidden.forEach((mesh) => {
      mesh.visible = true;
    });
  };
}
