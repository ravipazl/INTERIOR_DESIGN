/**
 * SWAP THE ITEM SELECTED IN 3D FOR ANOTHER CATALOGUE MODEL — IN PLACE.
 *
 * Doors and windows keep their own path (handleSwapSelectedObject), which
 * seats the new one in the same wall opening at the same height. Everything
 * else — an AC, a candle, a sofa, a lamp — comes here, and the new model takes
 * over the old one exactly:
 *
 *   size      stretched to the old item's width × height × depth (the same
 *             fit-to-slot the door swap uses);
 *   place     the old item's position, height included (a candle stays on its
 *             table, an AC at its height on the wall);
 *   placement the old one's type — floor, wall or ceiling — and, on a wall, the
 *             same wall;
 *   facing    the old one's turn.
 *
 * It is added through the app's own add path, then put exactly where the old
 * one was and saved on its record — the way auto-furnish settles its items.
 */

import BlueprintInterface from "@pazl/blueprint-interface";
import { handleSwapSelectedObject, measureAlongWall } from "@pazl/viewer3d-state-interface";
import { EVENT_ITEM_SELECTED } from "@pazl/main/core/events";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import { placeOne, makeVector3 } from "../roomTemplates/applyRoomTemplate";
import { swapKindOf } from "./swapCatalog";

// Types that live on a wall: wall unit, in-wall, in-wall floor, wall-floor.
const WALL_TYPES = [2, 3, 7, 9];

/**
 * Resolves { ok: true }, or { ok: false, reason } with a sentence for the user.
 * The old item goes only once the new one is in the scene, so a model that
 * cannot be loaded leaves the room as it was.
 */
export async function swapSelectedItem(newModel) {
  const BI = BlueprintInterface;
  const sel = BI?.selectedModels && BI.selectedModels[0];
  const refuse = (reason) => ({ ok: false, reason });
  if (!sel || !newModel) return refuse("Select the item to swap first.");

  const kind = swapKindOf(sel);
  if (kind) {
    await handleSwapSelectedObject(newModel, { kind });
    return { ok: true };
  }

  const item = sel.__itemModel || sel.itemModel || sel;
  const id = item && item.__id;
  const pm = BI.ProjectManagerService;
  const helper = BI.roomplanningHelper;
  const rp = BI?.blueprint3d?.roomplanner;
  if (!id || !pm || !helper || !rp) return refuse("This item cannot be swapped.");
  const record = pm.getFurnishedModelById ? pm.getFurnishedModelById(id) : null;

  // --- what the old item is, before it goes ----------------------------------
  const picked = newModel.model ? newModel.model : newModel;
  const type =
    parseInt(item.__metadata?.itemType ?? record?.model?.type ?? picked.type ?? 1, 10) || 1;
  const onWall = WALL_TYPES.includes(type);

  const pos = item.position ? item.position.clone() : null;
  if (!pos) return refuse("This item's position is unknown, so it was not swapped.");
  const turn = item.rotation && item.rotation.clone ? item.rotation.clone() : null;
  const savedTurn = Array.isArray(record?.rotation) ? record.rotation.slice() : null;
  const wallEdge = item.__currentWallEdge || null;

  // Size [H, W, D] in mm, as the 3D view draws it, measured the way the new one
  // will stand: along its wall, or square to the item's own turn. (The record's
  // W and D are the model's own axes, the other way round on a model turned
  // inside its item.) A side can be 0 — a carpet's file can be perfectly flat —
  // so two real sides are enough; the fit keeps a flat side thin.
  const usable = (d) => !!d && d.filter((n) => n > 0).length >= 2;
  const angle = turn ? turn.y : 0;
  const facing =
    onWall && wallEdge
      ? item.__currentWallNormal || wallEdge.normal
      : { x: Math.sin(angle), z: Math.cos(angle) };
  const drawn = measureAlongWall(sel.__loadedItem, facing);
  let dims = drawn
    ? [drawn.h * 10, drawn.w * 10, drawn.d * 10].map((n) => Math.round(n))
    : null;
  if (!usable(dims) && Array.isArray(record?.dimensions) && record.dimensions.length >= 3) {
    dims = record.dimensions.slice(0, 3).map((n) => Math.abs(Number(n)) || 0);
  }
  if (!usable(dims)) return refuse("This item's size is unknown, so it was not swapped.");

  // --- the new one: same type, stretched to the old one's box ----------------
  const swapModel = {
    ...picked,
    type,
    // FIT-TO-SLOT in mm (viewer3d-state-interface): per-axis stretch to exactly
    // this box. The model's own declared dimensions are left alone — they tell
    // the fit which way round the model is.
    __slot: { w: dims[1], h: dims[0], d: dims[2], keepAxes: !onWall },
  };

  // Seat the add flow where the old one was, so it lands on the same wall.
  if (onWall && wallEdge) {
    helper.__selectedEdge = wallEdge;
    helper.__selectedEdgePoint = pos.clone();
    helper.__selectedEdgeNormal = item.__currentWallNormal || wallEdge.normal || { x: 0, y: 0, z: 1 };
    helper.__selectedRoom = wallEdge.room || helper.__selectedRoom || null;
    if (helper.__selectedRoom) helper.__roomName = helper.__selectedRoom.name;
  } else {
    // All of these, as a catalogue drop sets them: FloorItem.snapToPoint reads
    // the normal, and nothing has set one if no wall or room was clicked yet.
    helper.__selectedEdgePoint = pos.clone();
    helper.__selectedEdgeNormal = { x: 0, y: 0, z: 1 };
    helper.__selectedRoom =
      BI.focusedRoom3D?.() ||
      helper.__selectedRoom ||
      BI?.blueprint3d?.model?.__floorplan?.rooms?.[0] ||
      null;
    if (helper.__selectedRoom) helper.__roomName = helper.__selectedRoom.name;
    helper.__hasExplicitDropPoint = true;
  }

  // --- in with the new --------------------------------------------------------
  const arrived = await placeOne(swapModel, 12000);
  try {
    helper.__hasExplicitDropPoint = false;
  } catch (e) {
    /* nothing to reset */
  }
  if (!arrived) {
    console.error("swap: the new model did not load", picked && picked.name);
    return refuse("The new model could not be loaded. Your item was not changed.");
  }

  // --- exactly where the old one was -----------------------------------------
  const list = rp.__physicalRoomItems || [];
  const phys = list[list.length - 1];
  if (!phys || !phys.__itemModel) {
    return refuse("The new model could not be placed. Your item was not changed.");
  }
  // The position is the item's middle. A thin item can differ a little in
  // thickness from the one it replaces, so away from a wall it keeps the old
  // one's FOOT: a carpet stays on the floor rather than half under it.
  const y = onWall
    ? pos.y
    : pos.y - dims[0] / 20 + (Number(phys.halfSize?.y) || dims[0] / 20);
  pos.y = y;
  const at = makeVector3(pos.x, pos.y, pos.z);
  phys.__itemModel.position = at;
  phys.position.set(pos.x, pos.y, pos.z);
  // A wall item faces out of its wall by itself (snapToWall); anything else
  // gets the old one's turn.
  if (!onWall && turn) phys.__itemModel.rotation = makeVector3(turn.x, turn.y, turn.z);
  try {
    phys.parent?.model?.updateRoomItemPosition?.(phys);
  } catch (e) {
    /* the record below keeps it */
  }
  rp.needsUpdate = true;

  const saved = await persist(phys.itemModel?.__id || phys.__itemModel?.__id, {
    position: [pos.x, pos.y, pos.z],
    rotation: !onWall ? savedTurn : null,
  });
  // NO RECORD, NO SWAP. An add that fails half way leaves an item in the view
  // that was never saved. Removing the old one then would lose it for good on
  // the next reload, so take the stray back out and keep the old one.
  if (!saved) {
    try {
      BI.blueprint3d.model.removeItemByMetaData(phys);
    } catch (e) {
      console.warn("swap: could not remove the unsaved item", e);
    }
    rp.needsUpdate = true;
    return refuse("The new model could not be saved. Your item was not changed.");
  }

  // --- out with the old -------------------------------------------------------
  // removeFurnishedModel takes the id for the RECORD but removes from the scene
  // whatever is SELECTED, and by now that is the new item. Without this the new
  // one vanished from the view and the old one stayed, with no record behind it
  // (so no panel and no Swap button).
  BI.selectedModels = [sel];
  try {
    await pm.removeFurnishedModel(id);
  } catch (e) {
    console.error("swap: could not remove the old item", e);
    return refuse("The new model was added, but the old one could not be removed. Please delete it.");
  }

  // The new item ends up selected, as if clicked: its toolbar shows, and the
  // side panel shows IT rather than the record just deleted.
  try {
    BI.selectedModels = [];
    rp.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: phys, __user: true });
  } catch (e) {
    console.warn("swap: could not select the new item", e);
  }
  return { ok: true };
}

/**
 * Save the spot (and turn) on the new item's record, once it exists. Resolves
 * whether there was a record to save it on.
 */
async function persist(id, { position, rotation }) {
  const pm = BlueprintInterface?.ProjectManagerService;
  if (!id || !pm?.getFurnishedModelById) return false;
  for (let wait = 0; wait < 30; wait++) {
    const record = pm.getFurnishedModelById(id);
    if (record) {
      const next = { ...record, position };
      if (rotation) next.rotation = rotation;
      record.position = position;
      if (rotation) record.rotation = rotation;
      await new FurnishedModel(next).update();
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn("swap: the new item's record never appeared", id);
  return false;
}
