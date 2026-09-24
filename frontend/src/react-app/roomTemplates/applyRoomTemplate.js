/**
 * Auto-furnish — turning a plan from placementEngine into real placed items.
 *
 * Three jobs:
 *   1. describeRoom()  — read the selected room's walls and its doors/windows
 *                        out of the 3D engine, in the shape the engine wants;
 *   2. pickModules()   — find, in THIS server's own catalogue, a model for each
 *                        kind of module (by category + name, never by id, so it
 *                        works on live with live's own models);
 *   3. applyPlan()     — place each module where the plan says, one at a time,
 *                        then save the project once at the end.
 *
 * Placing reuses the app's own drop-a-model-here path: the same fields the
 * drag-and-drop sets (viewer3d-state-interface.handleDropModelAtScreen) are
 * set directly, then handleAddItemsToScene() does the rest. Nothing in the 3D
 * engine is changed.
 */

import BlueprintInterface from "@pazl/blueprint-interface";
import { handleAddItemsToScene } from "@pazl/viewer3d-state-interface";
import { ModelsService } from "@pazl/services/ModelsService";
import { CategoriesService } from "@pazl/services/categoriesService";
import { EVENT_ITEM_LOADED } from "@pazl/main/core/events";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import {
  planStraightRun,
  planLayout,
  slotPlacement,
  pickProblem,
  LAYOUTS,
  freeSpans,
  KITCHEN_DEFAULTS,
} from "./placementEngine";
import kitchenTemplate from "./kitchen.json";

const cm = (millimetres) => millimetres / 10;

/** The room the user has selected in 3D (or null). */
export const selectedRoom3D = () =>
  BlueprintInterface?.roomplanningHelper?.__selectedRoom || null;

/**
 * The selected room as plain geometry: inside-face walls, each with the doors
 * and windows sitting in it, measured along that wall.
 */
export function describeRoom(room) {
  if (!room) return null;
  const walls = [];
  let edge = room.edgePointer;
  const first = edge;
  let guard = 0;
  while (edge && guard++ < 64) {
    const a = edge.interiorStart();
    const b = edge.interiorEnd();
    const lengthCm = Math.hypot(b.x - a.x, b.y - a.y);
    if (lengthCm > 1) {
      const ux = (b.x - a.x) / lengthCm;
      const uy = (b.y - a.y) / lengthCm;
      // Inward normal: turn the wall direction 90° and point it at the room.
      let nx = -uy;
      let ny = ux;
      const centre = room.areaCenter || room.center;
      if (centre) {
        const toCentreX = centre.x - (a.x + b.x) / 2;
        const toCentreZ = (centre.z !== undefined ? centre.z : centre.y) - (a.y + b.y) / 2;
        if (nx * toCentreX + ny * toCentreZ < 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      walls.push({
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        normal: { x: nx, y: ny },
        lengthCm,
        edge,
        openings: openingsOnWall(edge, a, { x: ux, y: uy }),
      });
    }
    edge = edge.next;
    if (edge === first) break;
  }
  return { walls, name: room.name };
}

/** The doors and windows in one wall, as spans measured along it. */
function openingsOnWall(edge, startPoint, unit) {
  const wall = edge && edge.wall;
  const items = (wall && wall.inWallItems) || [];
  const openings = [];
  items.forEach((item) => {
    if (!item || !item.position || !item.halfSize) return;
    const alongCm =
      (item.position.x - startPoint.x) * unit.x + (item.position.z - startPoint.y) * unit.y;
    const half = item.halfSize.x || 0;
    const sill = item.position.y - (item.halfSize.y || 0);
    openings.push({
      // A door reaches the floor; anything sitting above it is a window.
      kind: sill <= 10 ? "door" : "window",
      startCm: alongCm - half,
      endCm: alongCm + half,
      sillCm: sill,
      headCm: item.position.y + (item.halfSize.y || 0),
    });
  });
  return openings.sort((p, q) => p.startCm - q.startCm);
}

/** Models of one category, by the category's NAME (live has its own ids). */
function modelsOfCategory(name) {
  const cats = CategoriesService.getCategoriesFromLocalStorage() || [];
  const cat = cats.find((c) => String(c.name || "").toLowerCase() === name.toLowerCase());
  if (!cat) return [];
  const all = ModelsService.getModelsFromLocalStorage() || [];
  return all.filter((m) => String(m.categoryId) === String(cat._id));
}

/**
 * A model for each kind of module in the preset, plus the widths available —
 * the engine needs the widths to decide what fits.
 */
export function pickModules(preset) {
  const catalogue = {};
  const widths = {};
  Object.entries(preset.modules).forEach(([kind, rule]) => {
    let list = modelsOfCategory(rule.category);
    if (rule.match) {
      const re = new RegExp(rule.match, "i");
      list = list.filter((m) => re.test(m.name || ""));
    }
    if (rule.exclude) {
      const re = new RegExp(rule.exclude, "i");
      list = list.filter((m) => !re.test(m.name || ""));
    }
    // dimensions = [height, width, depth] in mm.
    list = list.filter((m) => Array.isArray(m.dimensions) && m.dimensions[1] > 0);
    catalogue[kind] = list;
    widths[kind] = [...new Set(list.map((m) => Math.round(m.dimensions[1])))].sort((a, b) => a - b);
  });
  return { catalogue, widths };
}

/** The model of this kind with exactly this width. */
const modelOfWidth = (list, widthMm) =>
  (list || []).find((m) => Math.round(m.dimensions[1]) === Math.round(widthMm)) || null;

/**
 * Plan a kitchen over the walls the user picked in 2D.
 *   layout: "straight" | "l" | "u" | "parallel"
 *   wallIndexes: the walls, in the order they were clicked
 */
export function planKitchenLayout(room, layout, wallIndexes, options = {}) {
  const preset = kitchenTemplate.presets[0];
  const described = describeRoom(room);
  if (!described || !described.walls.length) return { error: "no walls in this room" };
  const { catalogue, widths } = pickModules(preset);
  const plan = planLayout(described, widths, layout, wallIndexes, {
    ...preset.rules,
    ...options,
  });
  const missing = Object.entries(widths)
    .filter(([, list]) => !list.length)
    .map(([kind]) => kind);
  return { preset, room: described, catalogue, widths, plan, missing };
}

/** Work out the whole layout without placing anything (used by the preview). */
export function planKitchen(room, presetId = "straight", options = {}) {
  const preset = kitchenTemplate.presets.find((p) => p.id === presetId);
  if (!preset) return { error: "unknown preset" };
  const described = describeRoom(room);
  if (!described || !described.walls.length) return { error: "no walls in this room" };
  const { catalogue, widths } = pickModules(preset);
  const missing = Object.entries(widths)
    .filter(([, list]) => !list.length)
    .map(([kind]) => kind);
  const plan = planStraightRun(described, widths, { ...preset.rules, ...options });
  return { preset, room: described, catalogue, widths, plan, missing };
}

/**
 * Place every module of a plan. Serialised on purpose: the project records the
 * position of the item that was just added, so two at once would cross over.
 * Calls onProgress(done, total, kind) as it goes.
 */
export async function applyPlan(room, planned, onProgress) {
  const { preset, room: described, catalogue, plan } = planned;
  const helper = BlueprintInterface?.roomplanningHelper;
  if (!helper || !plan || !plan.slots.length) return { placed: 0, failed: 0 };
  let placed = 0;
  let failed = 0;

  for (let i = 0; i < plan.slots.length; i++) {
    const slot = plan.slots[i];
    const model = modelOfWidth(catalogue[slot.kind], slot.widthMm);
    if (!model) {
      failed += 1;
      continue;
    }
    const wall = described.walls[slot.wallIndex !== undefined ? slot.wallIndex : plan.wallIndex];
    if (!wall) {
      failed += 1;
      continue;
    }
    const where = slotPlacement(described, plan, slot, {
      depthMm: model.dimensions[2],
      heightMm: model.dimensions[0],
    }, preset.rules);
    try {
      // The same five fields the drag-and-drop sets before dropping a model.
      helper.__selectedRoom = room;
      helper.__roomName = room.name;
      helper.__hasExplicitDropPoint = true;
      helper.__selectedEdge = wall.edge;
      helper.__selectedEdgePoint = makeVector3(
        where.point.x,
        slot.level === "wall" ? where.centreHeightCm : 0,
        where.point.y
      );
      helper.__selectedEdgeNormal = makeVector3(wall.normal.x, 0, wall.normal.y);
      // Counted as placed only if an item really arrived in the scene — a GLB
      // that fails to load must not be reported as a success.
      if (await placeOne(model)) {
        // Turn it to face into the room. A floor item keeps the rotation it was
        // added with, which is only right for one wall — on any other wall the
        // cabinet would stand side-on.
        //
        // A WALL unit needs none of this: it is hung by snapToWall, which
        // already turns it to the wall it is going on (items/wall_item.js).
        // Turning it again put a second angle on top of that one, which is why
        // the wall units stayed wrong along the side walls after the base units
        // came right.
        if (slot.kind === "corner" && Array.isArray(slot.cornerWalls)) {
          // A corner unit answers to both of its walls — see faceTheCorner.
          const a = described.walls[slot.cornerWalls[0]];
          const b = described.walls[slot.cornerWalls[1]];
          if (a && b) await faceTheCorner(a.normal, b.normal);
          else await faceTheRoom(wall.normal);
        } else if (slot.level !== "wall") await faceTheRoom(wall.normal);
        placed += 1;
      } else failed += 1;
    } catch (e) {
      console.error("auto-furnish: could not place", model?.name, e);
      failed += 1;
    }
    if (onProgress) onProgress(i + 1, plan.slots.length, slot.kind);
  }

  try {
    helper.__hasExplicitDropPoint = false;
  } catch (e) {
    /* nothing to reset */
  }

  // SAVE THE SCENE, AND CHECK IT REALLY HOLDS THE ITEMS.
  //
  // A placed module lives in two places: its own furnished_models record, and
  // an entry in the floor plan's scene. loadSceneInitially() keeps only the
  // records the scene refers to and DELETES the rest as orphans — so a kitchen
  // whose modules never reached the scene is wiped by the next page reload,
  // with nothing left to show for it.
  const saved = await saveScene(placed);
  return { placed, failed, saved };
}

/**
 * Write the scene and report how many items it ended up holding. Returns the
 * count, or -1 when the scene could not be read back.
 */
async function saveScene(expected) {
  try {
    const pm = BlueprintInterface?.ProjectManagerService;
    if (!pm?.updateFloorPlan) return -1;
    // Let any turn finish before reading the scene. Turning an item is animated
    // (a quarter second), and the plan records the angle the item has AT THAT
    // MOMENT — a save taken mid-turn wrote half-finished angles like 98° and
    // 173° into the plan, which is then what came back on the next reload.
    await new Promise((r) => setTimeout(r, 400));
    await pm.updateFloorPlan(HISTORY_TITLES_FLOOR_ITEM_ADDED);
    const model = BlueprintInterface?.blueprint3d?.model;
    const items = (model && model.__roomItems && model.__roomItems.length) || 0;
    if (expected && items < expected) {
      console.warn(
        `auto-furnish: the scene holds ${items} items but ${expected} were placed — ` +
          "the missing ones would be dropped on the next reload"
      );
    }
    return items;
  } catch (e) {
    console.error("auto-furnish: could not save the scene", e);
    return -1;
  }
}

/** The history label the app uses for an added floor item. */
const HISTORY_TITLES_FLOOR_ITEM_ADDED = "Floor item added";

/**
 * Add ONE model and wait until its 3D item is in the scene.
 * Resolves true when an item really arrived, false when it didn't (a GLB that
 * can't be downloaded, for instance) — the run then carries on with the rest.
 */
function placeOne(model, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const rp = BlueprintInterface?.blueprint3d?.roomplanner;
    const before = (rp && rp.__physicalRoomItems && rp.__physicalRoomItems.length) || 0;
    const arrived = () =>
      ((rp && rp.__physicalRoomItems && rp.__physicalRoomItems.length) || 0) > before;
    let done = false;
    let timer = null;
    let poll = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      try {
        rp?.removeRoomplanListener?.(EVENT_ITEM_LOADED, onLoaded);
      } catch (e) {
        /* already gone */
      }
      resolve(ok);
    };
    const onLoaded = () => finish(true);
    try {
      rp?.addRoomplanListener?.(EVENT_ITEM_LOADED, onLoaded);
    } catch (e) {
      /* the poll below still catches it */
    }
    // The item can land without that event (a cached GLB), so watch the scene.
    poll = setInterval(() => {
      if (arrived()) finish(true);
    }, 150);
    timer = setTimeout(() => finish(arrived()), timeoutMs);
    handleAddItemsToScene(model);
  });
}

// A WALL UNIT'S ANGLE IS NOT WRITTEN TO ITS RECORD, ON PURPOSE.
//
// It is tempting to copy the angle snapToWall gave it onto the record, which
// keeps a flat 0 for every wall item. Don't: the only way to write it is
// onFurnishedModelRotationChange, and that TURNS the item as well as saving it,
// landing a second angle on top of the one it already has (90 + 90 = 180, and
// 270 + 270 = 180 again after wrapping). The scene keeps the real angle either
// way, which is what the 3D view and the next reload read, and a hand-placed
// wall unit has always behaved exactly like this.

/**
 * Save an angle (degrees) on the item's record. The record is written a moment
 * after the item appears in the scene, so wait for it — without this the turn
 * is lost and the item comes back square to the room on the next reload.
 */
async function persistTurn(id, degrees) {
  const pm = BlueprintInterface?.ProjectManagerService;
  if (!pm?.getFurnishedModelById) return;
  for (let wait = 0; wait < 20; wait++) {
    const record = pm.getFurnishedModelById(id);
    if (record) {
      // WRITE THE RECORD, DON'T ASK THE APP TO TURN IT.
      //
      // The obvious call here is onFurnishedModelRotationChange, but that turns
      // the item as well as saving it — and it turns whatever is SELECTED at
      // that moment, which during a run of placements is often the PREVIOUS
      // cabinet. That one then got a second 90° on top of its own and came out
      // at 180°, facing into the wall, while its neighbours were fine. The item
      // has already been turned by faceTheRoom, so all that is left is to write
      // the number down.
      const current = Array.isArray(record.rotation) ? record.rotation : [0, 0, 0];
      const turned = [current[0] || 0, degrees, current[2] || 0];
      record.rotation = turned; // keep the copy ProjectManager holds in step
      // Rows reach here either as entities or as plain objects from the API,
      // and a plain one has no update(); wrapping covers both, the same way
      // ProjectManager does when it saves rows it was handed.
      await new FurnishedModel({ ...record, rotation: turned }).update();
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn("auto-furnish: the item's record never appeared, turn not saved", id);
}

/**
 * Turn the item that was just added so its front looks along `normal` (into
 * the room). Rotation 0 means facing +z, so the angle is measured from there.
 */
async function faceTheRoom(normal) {
  return turnTheLastItem(Math.atan2(normal.x, normal.y)); // 0 = facing +z
}

/**
 * Turn a CORNER unit for the two walls it tucks into.
 *
 * A corner unit is closed on two adjacent sides and open into the room across
 * the diagonal between them, so its angle follows BOTH walls, not the one it
 * happens to be measured along. Left square-on it only ever suited one corner
 * of the room — right in a back-left corner, backwards in a back-right one.
 *
 * Square-on it opens towards +x and +z, i.e. along the 45° diagonal, so the
 * turn is the diagonal of the two walls' inward normals less that built-in 45°.
 */
async function faceTheCorner(normalA, normalB) {
  const x = normalA.x + normalB.x;
  const y = normalA.y + normalB.y;
  if (!x && !y) return; // facing walls — no corner between them
  return turnTheLastItem(Math.atan2(x, y) - Math.PI / 4);
}

/** Turn the item that was just added to `radians`, and save that turn. */
async function turnTheLastItem(radians) {
  try {
    const rp = BlueprintInterface?.blueprint3d?.roomplanner;
    const items = rp && rp.__physicalRoomItems;
    const phys = items && items[items.length - 1];
    const id = phys && (phys.itemModel?.__id || phys.__itemModel?.__id);
    if (!phys || !id) return;
    let degrees = Math.round((radians * 180) / Math.PI);
    degrees = ((degrees % 360) + 360) % 360;
    if (degrees === 0) return; // already the right way round

    // 1. Turn it in the view straight away, so what you see is right.
    //
    // TURN IT IN ONE PLACE ONLY, AND MAKE IT THE MODEL'S OWN ANGLE. A turn can
    // live on the item or on the mesh inside it, and the two ADD UP. Setting it
    // on the item looked reasonable — that is where the app's own Rotate puts
    // it — but the angle a plan is RELOADED with is written back to the mesh, so
    // as soon as anything rebuilt the scene mid-run the item still held 90° and
    // the mesh gained 90° too: 180°, facing into the wall. Going through the
    // model's own rotation puts it on the mesh, the same path snapToWall uses
    // for wall units (which is exactly why those stayed right), so placing and
    // reloading now agree and nothing can stack.
    phys.__itemModel.rotation = makeVector3(0, radians, 0);
    rp.needsUpdate = true;

    // 2. Then save the turn on the item's own record.
    await persistTurn(id, degrees);
  } catch (e) {
    console.error("auto-furnish: could not turn an item", e);
  }
}

/** A THREE.Vector3 without importing three here (the engine's own class). */
function makeVector3(x, y, z) {
  const sample = BlueprintInterface?.blueprint3d?.model?.floorplan?.corners?.[0]?.location;
  if (sample && typeof sample.clone === "function") {
    // Corner.location is a Vector2 — build a Vector3 from the item API instead.
  }
  const V = BlueprintInterface?.blueprint3d?.roomplanner?.camera?.position?.constructor;
  if (V) return new V(x, y, z);
  return { x, y, z };
}

export { KITCHEN_DEFAULTS, kitchenTemplate, pickProblem, LAYOUTS, freeSpans };
