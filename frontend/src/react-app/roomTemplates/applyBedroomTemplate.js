/**
 * Auto-furnish a BEDROOM — the bedroom's plan (bedroomEngine) turned into real
 * placed items, the same way the kitchen's is (applyRoomTemplate):
 *
 *   pickBedroomModules()  this server's own catalogue, by category name and
 *                         path, never by id — so it works on live;
 *   planBedroomRoom()     describe the room and plan it (also the preview);
 *   applyBedroomPlan()    place each item one at a time, then save once.
 *
 * Placing reuses the kitchen's path (the app's own drop-a-model-here), and
 * then puts each item exactly where the plan says using the model's REAL
 * size, measured as it loads. The catalogue's sizes are not always the file's:
 * a cot stored as 400 mm tall is a 1025 mm bed with a headboard. So the plan
 * decides WHERE, from the catalogue; the placer pulls the bed, side tables and
 * wardrobe flush to the wall and lifts a lamp onto its table from what the 3D
 * view really drew.
 */

import BlueprintInterface from "@pazl/blueprint-interface";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import { setFocusedRoom, currentProjectId } from "@pazl/helpers/roomFocus";
import {
  describeRoom,
  modelsOfCategory,
  placeOne,
  saveScene,
  makeVector3,
} from "./applyRoomTemplate";
import { planBedroom, wallPoint, BEDROOM_DEFAULTS } from "./bedroomEngine";
import bedroomTemplate from "./bedroom.json";

const cm = (millimetres) => millimetres / 10;

/**
 * The catalogue for each kind of item in a room template (bedroom.json,
 * livingroom.json), sized in cm for the planner.
 */
export function pickRoomModules(template) {
  const catalogue = {};
  Object.entries(template.modules).forEach(([kind, rule]) => {
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
    catalogue[kind] = list
      .filter((m) => Array.isArray(m.dimensions) && m.dimensions[1] > 0)
      .map((m) => ({
        id: String(m._id),
        name: m.name || "",
        h: cm(m.dimensions[0] || 0),
        w: cm(m.dimensions[1] || 0),
        d: cm(m.dimensions[2] || 0),
        raw: m,
      }));
  });
  return catalogue;
}

export const pickBedroomModules = () => pickRoomModules(bedroomTemplate);

/**
 * Describe the room and plan it. `choice` is { bedWallIndex?, extras? } (see
 * planBedroom). Returns { room, catalogue, plan } — what the preview draws and
 * what applyBedroomPlan places.
 */
export function planBedroomRoom(room, choice = {}) {
  const described = describeRoom(room);
  if (!described || !described.walls.length) return { error: "no walls in this room" };
  const catalogue = pickBedroomModules();
  const plan = planBedroom(described, catalogue, choice, {
    ...BEDROOM_DEFAULTS,
    ...(bedroomTemplate.rules || {}),
  });
  return { room: described, catalogue, plan };
}

/**
 * Place every item of a plan, one at a time (the project records the item
 * just added, so two at once would cross over). onProgress(done, total, label).
 * Shared by every room's auto-furnish: a plan is a list of slots, whatever
 * room it came from.
 */
export async function applyFurnishPlan(room, planned, onProgress) {
  const { room: described, plan } = planned || {};
  const helper = BlueprintInterface?.roomplanningHelper;
  if (!helper || !plan || !plan.slots?.length) return { placed: 0, failed: 0, saved: -1 };

  // Show the room being furnished (as the kitchen does).
  try {
    if (BlueprintInterface?.__roomFocusId && room?.roomByCornersId) {
      if (BlueprintInterface.__roomFocusId !== room.roomByCornersId) {
        setFocusedRoom(currentProjectId(), room.roomByCornersId);
      }
    }
  } catch (e) {
    /* placement matters more than the view */
  }

  let placed = 0;
  let failed = 0;
  const items = []; // slot index → its 3D item, for a lamp to find its table
  for (let i = 0; i < plan.slots.length; i++) {
    const slot = plan.slots[i];
    const model = slot.model?.raw;
    const wall = slot.wallIndex !== undefined ? described.walls[slot.wallIndex] : null;
    try {
      helper.__selectedRoom = room;
      helper.__roomName = room.name;
      let ok = false;
      if (slot.level === "ceiling") {
        ok = await placeOne(model);
      } else if (slot.level === "wall") {
        // Hung on its wall, top at 7 ft (handleAddItemsToScene's wall rule).
        const p = wallPoint(wall, slot.alongCm, 0);
        helper.__selectedEdge = wall.edge;
        helper.__selectedEdgePoint = makeVector3(p.x, 0, p.y);
        helper.__selectedEdgeNormal = makeVector3(wall.normal.x, 0, wall.normal.y);
        ok = await placeOne(model, undefined, { hangWallUnit: true });
        // Hung on something already on the wall (a TV on its back panel):
        // out from the wall by that thing's thickness, so it sits on its face.
        if (ok && slot.standoffCm > 0) await standOff(wall, slot.standoffCm);
      } else {
        const p = wallPoint(wall, slot.alongCm, slot.outCm);
        helper.__hasExplicitDropPoint = true;
        helper.__selectedEdge = wall.edge;
        helper.__selectedEdgePoint = makeVector3(p.x, 0, p.y);
        helper.__selectedEdgeNormal = makeVector3(wall.normal.x, 0, wall.normal.y);
        ok = await placeOne(model);
        if (ok) items[i] = await settle(slot, wall, items);
      }
      if (ok) placed += 1;
      else failed += 1;
    } catch (e) {
      console.error("auto-furnish (bedroom): could not place", model?.name, e);
      failed += 1;
    }
    if (onProgress) onProgress(i + 1, plan.slots.length, slot.label || slot.kind);
  }
  try {
    helper.__hasExplicitDropPoint = false;
  } catch (e) {
    /* nothing to reset */
  }
  const saved = await saveScene(placed);
  return { placed, failed, saved };
}

/**
 * Put the floor item just added exactly where its slot says: facing into the
 * room, back flush on the wall (by its real depth), or — a lamp — standing on
 * the table placed for it. Returns the 3D item.
 */
async function settle(slot, wall, items) {
  const rp = BlueprintInterface?.blueprint3d?.roomplanner;
  const list = rp && rp.__physicalRoomItems;
  const phys = list && list[list.length - 1];
  if (!phys || !phys.__itemModel) return null;

  // Facing into the room: rotation 0 faces +z. A carpet laid the other way
  // takes a quarter turn more; an item with its own `facing` (an armchair
  // turned to the table) looks that way instead.
  const look = slot.facing || wall.normal;
  const radians = Math.atan2(look.x, look.y) + (slot.quarterTurn ? Math.PI / 2 : 0);
  phys.__itemModel.rotation = makeVector3(0, radians, 0);

  const half = phys.halfSize || { x: 0, y: 0, z: 0 };
  let x;
  let z;
  let y = phys.position.y;
  if (slot.level === "onTop" && items[slot.onTop]) {
    const base = items[slot.onTop];
    x = base.position.x;
    z = base.position.z;
    // Its foot on the table top.
    y = base.position.y + (base.halfSize?.y || 0) + (half.y || 0);
  } else {
    // The model's real depth decides how far from the wall its middle is.
    const out = slot.flush ? (half.z || 0) + 0.5 : slot.outCm;
    const p = wallPoint(wall, slot.alongCm, out);
    x = p.x;
    z = p.y;
  }
  phys.__itemModel.position = makeVector3(x, y, z);
  phys.position.set(x, y, z);
  try {
    phys.parent?.model?.updateRoomItemPosition?.(phys);
  } catch (e) {
    /* the scene save at the end records it anyway */
  }
  if (rp) rp.needsUpdate = true;

  let degrees = Math.round((radians * 180) / Math.PI);
  degrees = ((degrees % 360) + 360) % 360;
  await persist(phys.itemModel?.__id || phys.__itemModel?.__id, {
    rotation: degrees,
    position: [x, y, z],
  });
  return phys;
}

/** Move the wall item just added `cm` out from its wall, and save the spot. */
async function standOff(wall, cm) {
  const rp = BlueprintInterface?.blueprint3d?.roomplanner;
  const list = rp && rp.__physicalRoomItems;
  const phys = list && list[list.length - 1];
  if (!phys || !phys.__itemModel) return;
  const x = phys.position.x + wall.normal.x * cm;
  const y = phys.position.y;
  const z = phys.position.z + wall.normal.y * cm;
  phys.__itemModel.position = makeVector3(x, y, z);
  phys.position.set(x, y, z);
  try {
    phys.parent?.model?.updateRoomItemPosition?.(phys);
  } catch (e) {
    /* the scene save at the end records it anyway */
  }
  if (rp) rp.needsUpdate = true;
  const id = phys.itemModel?.__id || phys.__itemModel?.__id;
  const pm = BlueprintInterface?.ProjectManagerService;
  for (let wait = 0; id && pm?.getFurnishedModelById && wait < 20; wait++) {
    const record = pm.getFurnishedModelById(id);
    if (record) {
      record.position = [x, y, z];
      await new FurnishedModel({ ...record, position: [x, y, z] }).update();
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Write the turn and the spot on the item's own record. The record is made a
 * moment after the item appears, so wait for it (as the kitchen's persistTurn).
 */
async function persist(id, { rotation, position }) {
  const pm = BlueprintInterface?.ProjectManagerService;
  if (!id || !pm?.getFurnishedModelById) return;
  for (let wait = 0; wait < 20; wait++) {
    const record = pm.getFurnishedModelById(id);
    if (record) {
      const current = Array.isArray(record.rotation) ? record.rotation : [0, 0, 0];
      const turned = [current[0] || 0, rotation, current[2] || 0];
      record.rotation = turned;
      record.position = position;
      await new FurnishedModel({ ...record, rotation: turned, position }).update();
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn("auto-furnish (bedroom): the item's record never appeared", id);
}

export const applyBedroomPlan = applyFurnishPlan;
export { bedroomTemplate };
