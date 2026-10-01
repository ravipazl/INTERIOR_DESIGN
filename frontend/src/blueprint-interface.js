import { BlueprintJS } from "@pazl/main/blueprint.js";
import {
  Configuration,
  configDimUnit,
  configWallHeight,
  viewBounds,
} from "@pazl/main/core/configuration.js";
import { dimMilliMeter } from "@pazl/main/core/constants.js";
import * as lshape_room_json from "@pazl/rooms/Lshape.json";
import { STORAGE_KEY } from "@pazl/main/core/constants.js";
import { cornerTolerance } from "@pazl/main/core/configuration.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
// Retry uploaded models from the server when the website has no copy (404).
import "./scripts/helpers/modelUrlFallback";
import { BoxHelper, Color, Vector2, Box3, Vector3 } from "three";
import ActionsHistory2DManager from "@pazl/utils/2dActionsHistoryManager.js";
import GlobalCustomEvent from "@pazl/events/global-custom-event-interface.js";
import { ProjectManager } from "@pazl/services/ProjectManager";
import { handleItemPositionChanged } from "./events/event-interface";
import { MENU_TABS } from "@pazl/components/MenuBar";
import {
  EVENT_ITEM_SELECTED,
  EVENT_NEW_ITEM,
  EVENT_ITEM_REMOVED,
  EVENT_LOADED,
  ACTION_EVENT_2D,
  EVENT_WALL_2D_CLICKED,
} from "@pazl/main/core/events.js";

const BlueprintInterface = {};

BlueprintInterface.modelDataList = {};
BlueprintInterface.GLTFLoader = new GLTFLoader();
BlueprintInterface.actionsHistory2DManager = null;
BlueprintInterface.globalCustomEvents = GlobalCustomEvent;
BlueprintInterface.blueprint3d = null;
BlueprintInterface.wallSelected = false;
BlueprintInterface.configurationHelper = null;
BlueprintInterface.floorplanningHelper = null;
BlueprintInterface.roomplanningHelper = null;
BlueprintInterface.parametricContextInterface = null;
BlueprintInterface.selectedMeshList = null;
BlueprintInterface.selectedModels = [];
BlueprintInterface.selectedMesh = null;
BlueprintInterface.selectedMeshWithObject = null;
BlueprintInterface.selectedColors = null;
BlueprintInterface.textureDataList = [];
BlueprintInterface.textureCategoryList = [];
BlueprintInterface.selectedWall2D = null;
BlueprintInterface.selectedCorner2D = null;
BlueprintInterface.isMultiSelectEnabled = false;
BlueprintInterface.ProjectManagerService = new ProjectManager();
BlueprintInterface.highlightedMeshHelpers = [];

let lShapeRoom = JSON.stringify(lshape_room_json);

BlueprintInterface.opts = {
  viewer2d: {
    id: "bp3djs-viewer2d",
    viewer2dOptions: {
      "corner-radius": 12.5,
      "boundary-point-radius": 5.0,
      "boundary-line-thickness": 2.0,
      "boundary-point-color": "#030303",
      "boundary-line-color": "#090909",
      pannable: true,
      zoomable: true,
      scale: false,
      rotate: true,
      translate: true,
      dimlinecolor: "#3E0000",
      dimarrowcolor: "#FF0000",
      dimtextcolor: "#000000",
      pixiAppOptions: {
        resolution: 1,
      },
      pixiViewportOptions: {
        passiveWheel: true,
      },
    },
  },
  viewer3d: {
    id: "bp3djs-viewer3d",
    viewer3dOptions: {
      // false = each wall renders FrontSide-only. Front half-edge texture is
      // visible from inside the room; back half-edge texture is visible only
      // when the camera orbits to the outside. Setting this to true makes both
      // halves render DoubleSide and z-fight, so front/back appear blended.
      occludedWalls: false,
      occludedRoofs: false,
    },
  },
  textureDir: "assets/models/textures/",
  widget: false,
  resize: true,
};

BlueprintInterface.init = () => {
  console.debug("blueprint-interface.js ~ BlueprintInterface.init");
  Configuration.setValue(viewBounds, 10000); //In CMS
  BlueprintInterface.actionsHistory2DManager = new ActionsHistory2DManager();
  BlueprintInterface.globalCustomEvents = GlobalCustomEvent;
  BlueprintInterface.blueprint3d = new BlueprintJS(BlueprintInterface.opts);
  // Re-draw the 2D door/window symbols after ANY scene finishes loading. Reason:
  // newDesign() redraws the floor plan (running __drawDoors) BEFORE it pushes the
  // items into __roomItems, so the first pass finds no doors/windows. EVENT_LOADED
  // fires after loadSerialized has loaded the items, so this catches them. The
  // small delay lets the floorplan finish its own redraw first.
  try {
    BlueprintInterface.blueprint3d.model.addEventListener(EVENT_LOADED, () => {
      // Heal-on-open for pre-fix bulk imports (AI floor-plan / template). Manual
      // drawing splits a wall when a corner lands in its MIDDLE (T-junction);
      // loadFloorplan does NOT, so imported plans keep unsplit T-junctions and the
      // interior loops never close — you get ONE big room instead of partitions.
      // Detect that exact condition (a corner sitting on a wall it isn't connected
      // to — the same test mergeWithIntersected uses) and heal only then. Healthy/
      // hand-drawn plans have none, so they're skipped: no churn, no risk.
      setTimeout(() => {
        try {
          const fp = BlueprintInterface?.blueprint3d?.model?.floorplan;
          if (!fp || typeof fp.getWalls !== "function") return;
          const walls = fp.getWalls();
          const corners = fp.getCorners();
          if (!walls.length) return; // not loaded yet — retry on next EVENT_LOADED
          // Reliability: run the heal-check AT MOST ONCE per floor-plan per session.
          // EVENT_LOADED can fire many times (undo/redo, template reloads,
          // re-renders); this in-session Set stops the scan/heal from repeating.
          // Together with the persisted repair below, a plan is checked once per
          // session and never re-healed across sessions.
          if (!BlueprintInterface.__healChecked)
            BlueprintInterface.__healChecked = new Set();
          const fpId =
            BlueprintInterface &&
            BlueprintInterface.ProjectManagerService &&
            BlueprintInterface.ProjectManagerService.floorPlan &&
            BlueprintInterface.ProjectManagerService.floorPlan._id;
          if (fpId && BlueprintInterface.__healChecked.has(fpId)) return;
          if (fpId) BlueprintInterface.__healChecked.add(fpId);
          let needsHeal = false;
          for (let wi = 0; wi < walls.length && !needsHeal; wi++) {
            const w = walls[wi];
            if (!w || !w.start || !w.end) continue;
            for (let ci = 0; ci < corners.length; ci++) {
              const c = corners[ci];
              if (c === w.start || c === w.end) continue;
              try {
                if (
                  c.distanceFromWall(w) < cornerTolerance &&
                  !c.isWallConnected(w)
                ) {
                  needsHeal = true;
                  break;
                }
              } catch (e) {
                /* ignore this corner/wall pair */
              }
            }
          }
          if (needsHeal) {
            console.warn(
              "[heal-on-open] unsplit wall T-junctions detected — healing so rooms partition correctly (pre-fix import)"
            );
            BlueprintInterface.healFloorplanIntersections?.();
            // Persist the repair ONCE so it never re-runs: the next open loads the
            // now-split walls, the T-junction scan finds nothing, and no heal
            // happens (only the cheap scan does). Without this, a saved-broken plan
            // would re-heal on every open. Fire-and-forget; if the save fails
            // (e.g. read-only), it simply re-heals next time — still correct.
            try {
              BlueprintInterface.ProjectManagerService?.updateFloorPlan?.(
                "Floorplan repaired (wall intersections)"
              );
            } catch (persistErr) {
              console.error("[heal-on-open] persist failed", persistErr);
            }
          }
        } catch (e) {
          console.error("heal-on-open check failed", e);
        }
      }, 250);
      setTimeout(() => BlueprintInterface.redrawDoors2D?.(), 300);
      // Auto-measure every placed item's panels so BOQ areas populate without a
      // manual click. Two passes because GLBs load asynchronously after
      // EVENT_LOADED — the later pass catches larger models that weren't ready
      // yet (measureAllComponents2D skips any mesh that isn't loaded, and is
      // idempotent, so re-running is safe).
      setTimeout(() => BlueprintInterface.measureAllComponents2D?.(), 1800);
      setTimeout(() => BlueprintInterface.measureAllComponents2D?.(), 5000);
      // Rescue any floor furniture that was saved OUTSIDE the room (e.g. placed
      // before wall-collision existed) by pulling it back inside. Runs a little
      // later so items are fully in __roomItems first.
      setTimeout(() => BlueprintInterface.rescueOutsideItems?.(), 600);
      // Then give any orphaned item its room back. After the rescue, so an item
      // that was outside every room has already been pulled inside one.
      setTimeout(() => BlueprintInterface.reassignOrphanRoomIds?.(), 900);
      // Put back the room you were designing before the reload. Done here, in
      // the engine, rather than left to the chip in the 3D panel: that panel
      // only exists once you are on the 3D tab, so a reload while on the floor
      // plan came back showing the whole house. After the orphan pass, so a
      // room's items belong to it before anything is hidden.
      setTimeout(() => BlueprintInterface.restoreRoomFocus3D?.(), 1000);
    });
  } catch (e) {
    console.error("attach EVENT_LOADED redrawDoors2D listener failed", e);
  }
  Configuration.setValue(configDimUnit, dimMilliMeter);
  BlueprintInterface.blueprint3d.model.loadSerialized(lShapeRoom);
  BlueprintInterface.configurationHelper =
    BlueprintInterface.blueprint3d.configurationHelper;
  BlueprintInterface.floorplanningHelper =
    BlueprintInterface.blueprint3d.floorplanningHelper;
  BlueprintInterface.roomplanningHelper =
    BlueprintInterface.blueprint3d.roomplanningHelper;

  handleItemPositionChanged(async (evt) => {
    console.debug(
      "DEBUG: BlueprintInterface -> handleItemPositionChanged",
      evt.item.itemModel,
      " position ",
      evt.item.position
    );
    await BlueprintInterface.ProjectManagerService.onFurnishedModelPositionChange(
      evt.item.itemModel.id,
      [
        Number(evt.item.position.x),
        Number(evt.item.position.y),
        Number(evt.item.position.z),
      ]
    );
  });
  return Promise.resolve(true);
};

BlueprintInterface.switchViewer = (mode) => {
  if (mode != BlueprintInterface.blueprint3d.view_now) {
    BlueprintInterface.blueprint3d.switchView();
  }
};

BlueprintInterface.handleDrawFreeShape = () => {
  BlueprintInterface.blueprint3d.setViewer2DModeToDraw();
};

BlueprintInterface.getUnit = () => {
  // NULL-SAFE ON PURPOSE. When the editor is re-entered without a page reload,
  // init() runs again and its Configuration.setValue(...) dispatches events. 2D
  // views from the PREVIOUS session are still registered as Configuration
  // listeners (they are never torn down), so they redraw and call this getter
  // while `blueprint3d` is momentarily null — between the unmount cleanup and the
  // new instance being assigned. Dereferencing null there crashed the whole
  // editor ("Cannot read properties of null (reading 'configurationHelper')").
  // Those stale views are detached, so any sane unit is fine: fall back to the
  // configured dimension unit, then to the app default.
  return (
    BlueprintInterface.blueprint3d?.configurationHelper?.unit ??
    Configuration.getStringValue(configDimUnit) ??
    dimMilliMeter
  );
};

BlueprintInterface.getSelectedRoom2D = () => {
  return BlueprintInterface.floorplanningHelper.__selectedRoom;
};

BlueprintInterface.setLocalStorage = () => {
  let items = BlueprintInterface.blueprint3d.model.exportSerialized();
  localStorage.setItem(STORAGE_KEY, items);
};

BlueprintInterface.setWallSelected = (value) => {
  BlueprintInterface.wallSelected = value;
};

BlueprintInterface.setSelectedMeshList = (value) => {
  BlueprintInterface.selectedMeshList = value;
};

BlueprintInterface.setSelectedModels = (selectedModel) => {
  const existingIndex = BlueprintInterface.selectedModels.findIndex(
    (model) => model.itemModel.id === selectedModel.itemModel.id
  );
  if (existingIndex !== -1) {
    // Same item id is already selected. Previously this did nothing, which
    // kept a STALE Physical3DItem reference: on a 2nd drag of the same item
    // the release path (handlePositionChange -> selectedModels.find) resolved
    // the old instance and re-applied a stale position, so the item snapped
    // back (notably wall items dragged vertically). Refresh the reference to
    // the LIVE instance instead. Single-/multi-select behaviour is unchanged.
    BlueprintInterface.selectedModels[existingIndex] = selectedModel;
    return;
  }
  if (BlueprintInterface.isMultiSelectEnabled) {
    BlueprintInterface.selectedModels.push(selectedModel);
    BlueprintInterface.selectedModels.map((model) =>
      model.__displayBoxHelperEvent(true)
    );
  } else {
    BlueprintInterface.selectedModels = [selectedModel];
  }
};

BlueprintInterface.setNothingSelected = async () => {
  await Promise.all(
    BlueprintInterface.selectedModels.map((model) =>
      model.__displayBoxHelperEvent(false)
    )
  );
  BlueprintInterface.selectedModels = [];
};

BlueprintInterface.setSelectedMesh = (value) => {
  BlueprintInterface.selectedMesh = value;
};

BlueprintInterface.setSelectedMeshWithObject = (value) => {
  BlueprintInterface.selectedMeshWithObject = value;
};

BlueprintInterface.setSelectedColors = (value) => {
  BlueprintInterface.selectedColors = value;
};

BlueprintInterface.setModelDataList = (modelList) => {
  BlueprintInterface.modelDataList = modelList;
};

BlueprintInterface.setModelTextureDataList = (textureList) => {
  BlueprintInterface.textureDataList = textureList;
};

BlueprintInterface.setModelTextureCategoryList = (textureCatList) => {
  BlueprintInterface.textureCategoryList = textureCatList;
};

BlueprintInterface.setSelectedWall2D = (wall) => {
  BlueprintInterface.selectedWall2D = wall;
};

BlueprintInterface.setSelectedCorner2D = (corner) => {
  BlueprintInterface.selectedCorner2D = corner;
};

BlueprintInterface.setSelectedRoom2D = (room) => {
  BlueprintInterface.floorplanningHelper.__selectedRoom = room;
};

BlueprintInterface.setUnit = (unit) => {
  BlueprintInterface.blueprint3d.configurationHelper.unit = unit;
};

BlueprintInterface.setIsMultiSelectEnabled = (flag) => {
  BlueprintInterface.isMultiSelectEnabled = flag;
  if (!flag) BlueprintInterface.selectedModels = [];
};

BlueprintInterface.setSnapToGrid = (bool) => {
  BlueprintInterface.configurationHelper.snapToGrid = bool;
};

BlueprintInterface.setWallThickness = (thickness) => {
  BlueprintInterface.selectedWall2D.thickness = thickness;
};

BlueprintInterface.setDimension = (endCornerVector) => {
  BlueprintInterface.selectedWall2D.end.move(
    endCornerVector.x,
    endCornerVector.y
  );
};

BlueprintInterface.setCornerElevation = (elevation) => {
  BlueprintInterface.selectedCorner2D.elevation = elevation;
};

BlueprintInterface.setRoomName = (roomName, selectedRoom, tabName) => {
  if (!BlueprintInterface.floorplanningHelper.__selectedRoom && selectedRoom) {
    BlueprintInterface.floorplanningHelper.__selectedRoom = selectedRoom;
  }
  if (!BlueprintInterface.roomplanningHelper.__selectedRoom && selectedRoom) {
    BlueprintInterface.roomplanningHelper.__selectedRoom = selectedRoom;
  } else if (
    BlueprintInterface.roomplanningHelper.__selectedRoom &&
    tabName === MENU_TABS.FURNISH
  ) {
    BlueprintInterface.roomplanningHelper.__selectedRoom.name = roomName;
    BlueprintInterface?.ProjectManagerService?.updateRoomNameInFloorPlan(
      roomName,
      BlueprintInterface.roomplanningHelper.__selectedRoom.uuid
    );
  } else if (
    BlueprintInterface.floorplanningHelper.__selectedRoom &&
    tabName === MENU_TABS.FLOOR_PLAN
  ) {
    BlueprintInterface.floorplanningHelper.__selectedRoom.name = roomName;
    BlueprintInterface?.ProjectManagerService?.updateRoomNameInFloorPlan(
      roomName,
      BlueprintInterface.floorplanningHelper.__selectedRoom.uuid
    );
  }
};

BlueprintInterface.handleTemplateUpdate = (floorPlan) => {
  BlueprintInterface.blueprint3d.model.loadSerialized(floorPlan);
  // After the plan + items load and snap to walls, draw the 2D door symbols.
  setTimeout(() => BlueprintInterface.redrawDoors2D(), 300);
};

// Redraw the 2D door symbols (door leaf + swing arc) on the floor-plan canvas.
// Safe to call any time; no-op if the 2D viewer isn't ready.
BlueprintInterface.redrawDoors2D = () => {
  try {
    const v2d =
      BlueprintInterface.blueprint3d &&
      BlueprintInterface.blueprint3d.floorplanner;
    if (v2d && typeof v2d.__drawDoors === "function") v2d.__drawDoors();
  } catch (e) {
    console.error("redrawDoors2D failed", e);
  }
};

/**
 * Drop the 3D viewer's selection and hide the dimension chips that belong to it.
 *
 * The dimensions a door or window shows in 3D are HTML nodes on document.body
 * plus an SVG line overlay — NOT objects in the Three.js scene. Viewer3d draws
 * them for `__currentItemSelected` on every frame, and hides them only when that
 * item, its model or its wall is missing.
 *
 * Clearing the floor plan deletes the geometry but leaves that selection
 * pointing at the door that used to exist, and the door still holds a reference
 * to its now-detached wall — so the guard never fires and the numbers stay
 * frozen over an empty canvas. Reloading clears them only because the whole
 * viewer is rebuilt from the (empty) saved scene, which is why the leftovers
 * survive a clear but not a refresh.
 *
 * Nulling the selection lets the existing guard do its job on the next frame;
 * the chips are hidden here too so they go at once rather than whenever a render
 * next happens to run.
 */
BlueprintInterface.clearSelection3D = () => {
  try {
    const v3d =
      BlueprintInterface.blueprint3d &&
      BlueprintInterface.blueprint3d.roomplanner;
    if (!v3d) return;
    if (v3d.__currentItemSelected) {
      try {
        v3d.__currentItemSelected.selected = false;
      } catch (e) {
        /* the item may already be torn down */
      }
      v3d.__currentItemSelected = null;
    }
    if (v3d.dragcontrols) v3d.dragcontrols.__selected = null;
    try {
      if (v3d.transformControls) v3d.transformControls.detach();
    } catch (e) {
      /* nothing was attached */
    }
    if (v3d.__dimLabels)
      v3d.__dimLabels.forEach((l) => {
        if (l && !l.__editing) l.style.display = "none";
      });
    if (v3d.__dimLines)
      v3d.__dimLines.forEach((ln) =>
        [ln.main, ln.t1, ln.t2].forEach((l) => {
          if (l) l.style.display = "none";
        })
      );
    v3d.needsUpdate = true;
    v3d.shouldRender = true;
  } catch (e) {
    console.error("clearSelection3D failed", e);
  }
};

// Set the overall-dimensions overlay mode in the 2D view. Read-only overlay,
// OFF by default. `mode` is "off" | "inner" | "outer"; only one is ever shown
// at a time (OUTER = footprint / outside faces, INNER = clear span / inside
// faces). Returns the active mode.
BlueprintInterface.__dimMode2D = "off";
/**
 * SHOW ONE ROOM, OR THE WHOLE HOUSE.
 *
 * Pass a room's `roomByCornersId` to work on that room alone in 3D; pass null
 * to bring the house back. Nothing is split, copied or deleted — this only
 * changes what is DRAWN, which is why leaving focus restores every room's work
 * with no merging to do.
 *
 *   the focused room   floor, walls and furniture
 *   other rooms        nothing at all
 *
 * The neighbours were drawn faintly at first, for context. In practice that
 * read as an empty shell: one small floor patch adrift in a house-sized
 * wireframe, with no way to tell the feature from a bug. Hiding them outright,
 * and pointing the camera at the room, is what makes it look like a room.
 *
 * Items are matched by WHERE THEY STAND rather than by their stored roomId.
 * That id is the room's corner list and goes stale the moment a wall is
 * redrawn (see reassignOrphanRoomIds); geometry cannot go stale. Wall-mounted
 * items — doors and windows — follow their wall instead, so a door stays with
 * whichever side of it you are looking at.
 */
/**
 * One command that prints the whole room-focus chain, so a failure says WHERE
 * it broke instead of "nothing happened". Run it in the browser console:
 *
 *   BlueprintInterface.roomFocusDebug()
 *
 * Read-only; it changes nothing.
 */
BlueprintInterface.roomFocusDebug = () => {
  const out = {};
  try {
    out.projectIdInUrl =
      new URLSearchParams(window.location.search).get("projectId") || "(none)";
    try {
      out.storedFocus = JSON.parse(localStorage.getItem("pazl-room-focus") || "{}");
    } catch (e) {
      out.storedFocus = "(unreadable)";
    }
    const bp = BlueprintInterface.blueprint3d;
    out.hasBlueprint3d = !!bp;
    const three = bp && (bp.roomplanner || bp.three);
    out.hasThreeView = !!three;
    out.floors3d = three && three.floors3d ? three.floors3d.length : "(none)";
    out.edges3d = three && three.edges3d ? three.edges3d.length : "(none)";
    out.items3d =
      three && three.__physicalRoomItems
        ? three.__physicalRoomItems.length
        : "(none)";
    const rooms =
      (bp && bp.model && bp.model.__floorplan && bp.model.__floorplan.rooms) || [];
    out.roomCount = rooms.length;
    out.roomIds = rooms.map((r) => r && r.roomByCornersId);
    // Would the STORED focus actually match anything? This is the question
    // every failure so far has come down to, so answer it here rather than
    // relying on a log line a filtered console may be hiding.
    const stored =
      out.storedFocus && typeof out.storedFocus === "object"
        ? out.storedFocus[out.projectIdInUrl]
        : null;
    out.focusForThisProject = stored || "(none)";
    if (stored) {
      const same = (r) => !!r && r.roomByCornersId === stored;
      out.roomsMatchingFocus = rooms.filter(same).length;
      out.floorsMatchingFocus =
        three && three.floors3d
          ? three.floors3d.filter((f) => f && same(f.room)).length
          : 0;
      out.wallsMatchingFocus =
        three && three.edges3d
          ? three.edges3d.filter((e) => e && e.edge && same(e.edge.room)).length
          : 0;
    }
    out.floorsKnowTheirRoom =
      three && three.floors3d
        ? three.floors3d.filter((f) => f && f.room).length
        : 0;
    out.edgesKnowTheirRoom =
      three && three.edges3d
        ? three.edges3d.filter((e) => e && e.edge && e.edge.room).length
        : 0;

    // ITEMS, COUNTED THE SAME WAY THE FILTER COUNTS THEM.
    //
    // "Windows of other rooms are still showing" was reported several times
    // while the floor and wall numbers above looked perfect, because items are
    // not in floors3d or edges3d and were being missed. So walk the scene the
    // way applyRoomFocus3D does and report what is actually on screen.
    if (three && three.traverse) {
      let total = 0;
      let shown = 0;
      let onWall = 0;
      three.traverse((o) => {
        if (!o || !(o.__itemModel || o.itemModel)) return;
        total += 1;
        if (o.visible) shown += 1;
        const m = o.__itemModel || o.itemModel;
        if (m && (m.currentWall || m.__currentWall)) onWall += 1;
      });
      out.itemsInScene = total;
      out.itemsVisible = shown;
      out.itemsOnAWall = onWall;
      out.itemsTrackedInArray =
        three.__physicalRoomItems ? three.__physicalRoomItems.length : 0;
    }

    // ANYTHING OF ANOTHER ROOM STILL ON SCREEN.
    //
    // Should be 0 while a room is focused. It was not, for a long time,
    // because Edge3D keeps THREE plane arrays and only one of them was being
    // hidden — the other two drew the rest of the house as faint outlines on
    // the floor. Counting all three here means that class of miss shows up as
    // a number instead of something you have to spot by eye.
    if (stored && three && three.edges3d && three.floors3d) {
      const same = (r) => !!r && r.roomByCornersId === stored;
      let leftovers = 0;
      three.edges3d.forEach((e) => {
        if (!e || (e.edge && same(e.edge.room))) return;
        ["planes", "basePlanes", "phantomPlanes"].forEach((k) => {
          (e[k] || []).forEach((p) => {
            if (p && p.visible) leftovers += 1;
          });
        });
      });
      three.floors3d.forEach((f) => {
        if (!f || same(f.room)) return;
        if (f.floorPlane && f.floorPlane.visible) leftovers += 1;
        if (f.roofPlane && f.roofPlane.visible) leftovers += 1;
      });
      out.otherRoomPartsStillVisible = leftovers;
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  console.log("ROOM FOCUS DEBUG", out);
  return out;
};

/**
 * A room's centre in WORLD space. Corners store x and y, where y is the
 * world's z — mixing those two up puts the camera somewhere else entirely, so
 * the conversion lives here rather than being repeated at each call.
 */
function roomCentre3D(room) {
  try {
    if (room && room.center && typeof room.center.x === "number") {
      return new Vector3(room.center.x, 0, room.center.z);
    }
    const cs = (room && room.corners) || [];
    if (!cs.length) return null;
    let sx = 0;
    let sz = 0;
    cs.forEach((c) => {
      sx += c.x;
      sz += c.y;
    });
    return new Vector3(sx / cs.length, 0, sz / cs.length);
  } catch (e) {
    return null;
  }
}

/**
 * FRAME ONE ROOM IN THE 3D VIEW.
 *
 * Put the whole room on screen, centred, seen from outside — the same job the
 * engine's own "fit the whole plan" does for the house, done for a single room.
 *
 * It computes a distance rather than using a multiple of the room's size,
 * because "far enough" depends on the CAMERA, not only the room: a tall narrow
 * viewport needs more room than a wide one for the same floor. Taking the
 * distance from the field of view and the live canvas aspect is what makes a
 * small room and a large one both sit in the frame the same way.
 *
 * The ELEVATION is fixed rather than inherited. Reusing whatever direction the
 * camera already had was the actual reason the view ended up between the walls:
 * if you were last looking along the floor, the "closer" camera simply slid
 * inside the room. Your left-right orientation is kept, so the room is not spun
 * round underneath you — only the height is corrected.
 */
function frameRoomCamera(three, room) {
  const cs = (room && room.corners) || [];
  if (!three || !three.camera || three.camera.isOrthographicCamera) return false;
  if (cs.length < 3 || !three.controls || !three.__animateCameraTo) return false;

  const xs = cs.map((c) => c.x);
  const zs = cs.map((c) => c.y); // corner.y IS the world z
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = Math.max(maxX - minX, 1);
  const depth = Math.max(maxZ - minZ, 1);
  let wallH = 280;
  try {
    wallH = Configuration.getNumericValue(configWallHeight) || 280;
  } catch (e) {
    /* default is fine */
  }

  // The room's bounding SPHERE, so the fit holds from any direction. Using
  // width or depth alone framed the room correctly from one side and cut it off
  // from the next, because the diagonal is longer than either.
  const radius = 0.5 * Math.sqrt(width * width + depth * depth + wallH * wallH);

  const fov = (((three.camera.fov || 45) * Math.PI) / 180) || 0.785;
  // camera.aspect can still hold its placeholder; the canvas is the truth.
  const el = three.domElement;
  const aspect =
    el && el.clientWidth && el.clientHeight
      ? el.clientWidth / el.clientHeight
      : window.innerWidth / Math.max(1, window.innerHeight);
  const halfV = fov / 2;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 0.2));
  // Whichever way the frustum is tighter is the one that decides the distance.
  const half = Math.min(halfV, halfH);
  // 1.0 would touch the edges of the screen; the extra is breathing room.
  const MARGIN = 1.25;
  const dist = (radius / Math.max(Math.sin(half), 0.05)) * MARGIN;

  // Keep the azimuth you were already looking from, replace the elevation.
  const target = new Vector3(
    (minX + maxX) / 2,
    wallH * 0.45,
    (minZ + maxZ) / 2
  );
  const prev = three.camera.position.clone().sub(three.controls.target);
  let dx = prev.x;
  let dz = prev.z;
  if (dx * dx + dz * dz < 1) {
    dx = 0.55;
    dz = 0.55;
  }
  const flat = Math.sqrt(dx * dx + dz * dz);
  const ELEV = (35 * Math.PI) / 180;
  const cos = Math.cos(ELEV);
  const dir = new Vector3((dx / flat) * cos, Math.sin(ELEV), (dz / flat) * cos);

  three.__animateCameraTo(
    target.clone().add(dir.multiplyScalar(dist)),
    target.clone(),
    700
  );
  return true;
}

/**
 * RE-READ THE SAVED FOCUS AND APPLY IT.
 *
 * The focus is stored per project in localStorage, under the same key the
 * React side writes (helpers/roomFocus.ts). Reading it here as well is
 * deliberate duplication of four lines: it means the engine can restore the
 * focus on load on its own, without waiting for a React panel that only exists
 * on one tab. Writing stays in one place — nothing here ever sets it.
 *
 * Does nothing when no room was saved for this project, so an ordinary project
 * opens on the whole house exactly as before.
 */
BlueprintInterface.restoreRoomFocus3D = () => {
  try {
    const projectId =
      new URLSearchParams(window.location.search).get("projectId") || "";
    if (!projectId) return false;
    const map = JSON.parse(localStorage.getItem("pazl-room-focus") || "{}");
    const id = map && typeof map === "object" ? map[projectId] : null;
    if (!id) return false;
    return BlueprintInterface.applyRoomFocus3D(String(id));
  } catch (e) {
    // Unreadable storage must never stop a project opening.
    return false;
  }
};

// APPLY A FOCUS CHANGE THE MOMENT IT HAPPENS.
//
// "Design this room" and "All rooms" both write the preference and announce
// it. Listening here means the 3D view reacts to that announcement directly,
// instead of the change only taking effect when some React panel next decides
// to re-read it. Registered once, at module load, and harmless when no room is
// focused.
try {
  window.addEventListener("pazl-room-focus-changed", (evt) => {
    try {
      const id = (evt && evt.detail && evt.detail.roomId) || null;
      BlueprintInterface.applyRoomFocus3D?.(id);
    } catch (e) {
      /* never let the focus break the view */
    }
  });
} catch (e) {
  /* no window (tests) */
}

/**
 * WHY IS THIS ITEM NOT FLUSH AGAINST ITS WALL?
 *
 * Select the item in 3D, then run:
 *
 *   BlueprintInterface.snapDebug()
 *
 * Snapping an item to a wall is: project its point onto the wall plane, then
 * push it back out along the wall normal by half the item's depth. Three things
 * can go wrong and they look identical on screen — the normal points the wrong
 * way, the half-depth is measured on the wrong axis, or the item is attached to
 * a different wall than the one it appears to be near.
 *
 * So this measures the one number that settles it: the perpendicular distance
 * from the item to the wall's interior line. Flush means that distance equals
 * `halfDepthUsed`. Bigger means it was pushed too far; negative means it went
 * through the wall to the outside.
 */
BlueprintInterface.snapDebug = () => {
  const out = {};
  try {
    const bp = BlueprintInterface.blueprint3d;
    const three = bp && (bp.roomplanner || bp.three);
    const phys = three && three.__currentItemSelected;
    const m = phys && (phys.itemModel || phys.__itemModel);
    if (!m) {
      out.error = "Select the item in 3D first, then run this again.";
      console.log("SNAP DEBUG", out);
      return out;
    }
    const meta = m.metadata || m.__metadata || {};
    out.item = meta.itemName || m.__id;
    out.itemType = meta.itemType;
    out.position = [
      Math.round(m.position.x),
      Math.round(m.position.y),
      Math.round(m.position.z),
    ];
    // The size the snap maths uses, and the size the model was saved with.
    out.size = m.__size
      ? [Math.round(m.__size.x), Math.round(m.__size.y), Math.round(m.__size.z)]
      : null;
    out.halfDepthUsed = m.__halfSize ? Math.round(m.__halfSize.z) : null;
    out.scale = m.__scale
      ? [m.__scale.x, m.__scale.y, m.__scale.z].map((v) => Number(v.toFixed(4)))
      : null;

    const edge = m.__currentWallEdge;
    const wall = m.currentWall || m.__currentWall;
    out.attachedToWall = !!wall;
    if (edge) {
      const a = edge.interiorStart();
      const b = edge.interiorEnd();
      out.wallFrom = a ? [Math.round(a.x), Math.round(a.y)] : null;
      out.wallTo = b ? [Math.round(b.x), Math.round(b.y)] : null;
      out.wallThickness = wall ? Math.round(wall.thickness) : null;
      const n = edge.normal;
      out.edgeNormal = n
        ? [Number(n.x.toFixed(3)), Number(n.z.toFixed(3))]
        : null;
      const room = edge.room;
      out.edgeKnowsItsRoom = !!room;
      if (room && room.center && edge.center && n) {
        const dot =
          n.x * (room.center.x - edge.center.x) +
          n.z * (room.center.z - edge.center.z);
        // Negative means the stored normal faces OUT of the room, so anything
        // that does not flip it first pushes the item the wrong way.
        out.normalPointsIntoRoom = dot >= 0;
      }
      // THE NUMBER THAT MATTERS. Perpendicular distance from the item to the
      // wall's interior line. Compare it with halfDepthUsed above.
      if (a && b) {
        const vx = b.x - a.x;
        const vz = b.y - a.y;
        const len = Math.hypot(vx, vz) || 1;
        const px = m.position.x - a.x;
        const pz = m.position.z - a.y;
        const signed = (px * -vz + pz * vx) / len;
        out.distanceFromWall = Math.round(signed);
        out.distanceAbs = Math.abs(out.distanceFromWall);
      }
    } else {
      out.note = "Item has no wall edge — it was never snapped to a wall.";
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  console.log("SNAP DEBUG", out);
  return out;
};

/**
 * WHERE DID EVERY PLACED ITEM ACTUALLY GO?
 *
 * Run in the console after an auto-furnish that came out wrong:
 *
 *   copy(JSON.stringify(BlueprintInterface.placementDebug(), null, 1))
 *
 * For each item it reports the position, the wall it is attached to, the room
 * the geometry says it is standing in, and the room its record claims. When a
 * kitchen run lands scattered, those three disagreeing is the answer — and
 * which pair disagrees says whether the fault is in the placement, in the
 * room bookkeeping, or in something moving items afterwards.
 */
BlueprintInterface.placementDebug = () => {
  const out = { focus: null, rooms: [], items: [] };
  try {
    const bp = BlueprintInterface.blueprint3d;
    const three = bp && (bp.roomplanner || bp.three);
    const rooms =
      (bp && bp.model && bp.model.__floorplan && bp.model.__floorplan.rooms) ||
      [];
    out.focus = BlueprintInterface.__roomFocusId || "(none)";
    const nameOf = (r) =>
      r ? `${r.name || "Room"}#${String(r.roomByCornersId).slice(0, 12)}` : null;
    rooms.forEach((r) => {
      const cs = (r && r.corners) || [];
      out.rooms.push({
        room: nameOf(r),
        corners: cs.length,
        bounds: cs.length
          ? {
              x: [
                Math.round(Math.min(...cs.map((c) => c.x))),
                Math.round(Math.max(...cs.map((c) => c.x))),
              ],
              z: [
                Math.round(Math.min(...cs.map((c) => c.y))),
                Math.round(Math.max(...cs.map((c) => c.y))),
              ],
            }
          : null,
        focused: r.roomByCornersId === BlueprintInterface.__roomFocusId,
      });
    });
    const items = (bp && bp.model && bp.model.__roomItems) || [];
    items.forEach((it) => {
      if (!it || !it.position) return;
      const here = new Vector2(it.position.x, it.position.z);
      const geometric = rooms.filter(
        (r) => r && r.pointInRoom && r.pointInRoom(here)
      );
      const phys =
        (three &&
          three.__physicalRoomItems &&
          three.__physicalRoomItems.find(
            (p) => p && (p.itemModel === it || p.__itemModel === it)
          )) ||
        null;
      out.items.push({
        name: (it.metadata && it.metadata.itemName) || it.__id || "(unnamed)",
        at: [
          Math.round(it.position.x),
          Math.round(it.position.y),
          Math.round(it.position.z),
        ],
        onWall: !!(it.currentWall || it.__currentWall),
        // Which room the item is physically standing in, by geometry.
        standingIn: geometric.map(nameOf),
        // Which room its saved record says it belongs to.
        recordSays:
          (it.metadata && (it.metadata.roomName || it.metadata.roomId)) || null,
        visible: phys ? phys.visible : "(no 3d object)",
      });
    });
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  console.log("PLACEMENT DEBUG", out);
  return out;
};

/**
 * MAY THE USER CLICK THIS RIGHT NOW?
 *
 * Clicking a wall or a floor does NOT use the meshes you can see. The model
 * keeps its own set of picking planes — room.floorPlane, halfEdge.plane,
 * halfEdge.exteriorPlane — and half_edge.js sets `plane.visible = true` on
 * purpose, with a comment saying the raycaster needs it. They are invisible
 * because their MATERIAL is invisible, not because the object is hidden.
 *
 * So a visibility test can never exclude them, which is why clicking the empty
 * space beside the focused room still selected a room that was not on screen.
 * They do carry a back-reference to what they belong to, so ownership is the
 * test that works: `floorPlane.room`, and `plane.edge.room` for a wall.
 *
 * Returns true for everything when no room is focused, so ordinary editing of
 * the whole house is completely unchanged.
 */
BlueprintInterface.pickableUnderFocus = (obj) => {
  try {
    const id = BlueprintInterface.__roomFocusId;
    if (!id) return true;
    if (!obj) return false;
    const same = (r) => !!r && r.roomByCornersId === id;
    if (obj.room) return same(obj.room);
    if (obj.edge) return same(obj.edge.room);
    // Not one of the model's picking planes — judged on visibility instead.
    return true;
  } catch (e) {
    // A broken check must never make the plan unclickable.
    return true;
  }
};

/**
 * The room currently being designed, or null for the whole house.
 */
BlueprintInterface.focusedRoom3D = () => {
  try {
    const id = BlueprintInterface.__roomFocusId;
    if (!id) return null;
    const rooms =
      (BlueprintInterface.blueprint3d &&
        BlueprintInterface.blueprint3d.model &&
        BlueprintInterface.blueprint3d.model.__floorplan &&
        BlueprintInterface.blueprint3d.model.__floorplan.rooms) ||
      [];
    return rooms.find((r) => r && r.roomByCornersId === id) || null;
  } catch (e) {
    return null;
  }
};

/**
 * KEEP FLOOR ITEMS IN THE ROOM BEING DESIGNED.
 *
 * Dragged past its walls, an item really did move into the next room — and then
 * vanished, because that room is hidden. Not lost, but it looked lost. Anything
 * ending up outside is walked back toward the centre until it is inside, so it
 * lands just past the wall it was pushed through rather than in the middle.
 *
 * Doors and windows are exempt: they belong to a wall, and a wall is shared.
 * So is the item you are HOLDING — correcting it mid-drag pulled it back as
 * fast as you pulled it out, and a cabinet could not be pushed against a wall
 * at all. It is corrected the moment you let go. While held it stays visible
 * even outside the room (see applyRoomFocus3D), so it never appears lost.
 */
BlueprintInterface.keepItemsInFocusedRoom = () => {
  try {
    const room = BlueprintInterface.focusedRoom3D();
    if (!room || !room.pointInRoom) return 0;
    const three =
      BlueprintInterface.blueprint3d &&
      (BlueprintInterface.blueprint3d.roomplanner ||
        BlueprintInterface.blueprint3d.three);
    const heldModel =
      (three &&
        three.__currentItemSelected &&
        (three.__currentItemSelected.itemModel ||
          three.__currentItemSelected.__itemModel)) ||
      null;
    const items =
      (BlueprintInterface.blueprint3d &&
        BlueprintInterface.blueprint3d.model &&
        BlueprintInterface.blueprint3d.model.__roomItems) ||
      [];
    const centre = roomCentre3D(room);
    if (!centre) return 0;
    let pulled = 0;
    // `__roomItems` holds the MODEL items, so a correction here is the real
    // move: assigning `position` runs Item's setter, which updates the 2D
    // position, the saved metadata and the 3D object. Writing position.x
    // directly mutates the vector behind the engine's back — the number
    // changes and nothing moves.
    items.forEach((it) => {
      if (!it || !it.position) return;
      // `currentWall` is the PUBLIC getter; `__currentWall` is the private
      // field and is not always set. Reading only the private one made every
      // door look like floor furniture.
      if (it.currentWall || it.__currentWall) return;
      if (it === heldModel) return;
      if (room.pointInRoom(new Vector2(it.position.x, it.position.z))) return;
      const put = (x, z) => {
        it.position = new Vector3(x, it.position.y, z);
        pulled += 1;
      };
      for (let step = 0.15; step <= 1.0001; step += 0.15) {
        const x = it.position.x + (centre.x - it.position.x) * step;
        const z = it.position.z + (centre.z - it.position.z) * step;
        if (room.pointInRoom(new Vector2(x, z))) return put(x, z);
      }
      put(centre.x, centre.z);
    });
    return pulled;
  } catch (e) {
    return 0;
  }
};

/**
 * Re-apply the current focus. Called every frame and after a scene rebuild, so
 * nothing the engine does to `visible` can survive even one frame.
 */
BlueprintInterface.reapplyRoomFocus3D = () => {
  const id = BlueprintInterface.__roomFocusId;
  if (!id) return false;
  BlueprintInterface.keepItemsInFocusedRoom();
  return BlueprintInterface.applyRoomFocus3D(id, { moveCamera: false });
};

/**
 * SHOW ONE ROOM, OR THE WHOLE HOUSE.
 *
 * Pass a room's `roomByCornersId` to work on it alone in 3D; pass null to bring
 * the house back. Nothing is split, copied or deleted — only what is DRAWN
 * changes, which is why leaving focus restores every room's work with nothing
 * to merge.
 */
BlueprintInterface.applyRoomFocus3D = (roomId, opts) => {
  try {
    // Kept so a RELEASE can be told apart from "there was never a focus". This
    // function is called with no room on every mount, and the two must not look
    // the same — see the camera block at the end.
    const prevId = BlueprintInterface.__roomFocusId || null;
    BlueprintInterface.__roomFocusId = roomId || null;
    const three =
      BlueprintInterface.blueprint3d &&
      (BlueprintInterface.blueprint3d.roomplanner ||
        BlueprintInterface.blueprint3d.three);
    if (!three) return false;
    const floors = three.floors3d || [];
    const edges = three.edges3d || [];
    const items = three.__physicalRoomItems || [];

    const rooms =
      (BlueprintInterface.blueprint3d.model &&
        BlueprintInterface.blueprint3d.model.__floorplan &&
        BlueprintInterface.blueprint3d.model.__floorplan.rooms) ||
      [];
    const room = roomId
      ? rooms.find((r) => r && r.roomByCornersId === roomId)
      : null;

    if (roomId && !room) {
      // NO ROOMS YET IS NOT THE SAME AS NO SUCH ROOM.
      //
      // The list is empty for a moment whenever the floorplan rebuilds —
      // exactly while you are working — and treating that as "no focus" unhid
      // the whole house. Leave the scene alone; the next call finds it.
      if (!rooms.length) return false;
      // A real list with no match means the room is genuinely gone: its corners
      // changed, so its id did too. Keeping it would leave the view filtered by
      // an id nothing matches — nothing counted as this room's, and nothing
      // clickable either, because picking asks the same question. That is a
      // dead editor, so let the focus go and show the house.
      BlueprintInterface.__roomFocusId = null;
      BlueprintInterface.__roomFocusWantsCamera = false;
      return BlueprintInterface.applyRoomFocus3D(null);
    }
    const focused = roomId ? room : null;

    // Match by ID, never by object identity: `focused` comes from the model's
    // floorplan while floors and walls hold whatever room object the VIEW was
    // built from, and those are not the same instances.
    const wantedId = focused ? focused.roomByCornersId : null;
    const isMine = (r) => !!r && r.roomByCornersId === wantedId;

    // The room's extent plus a wall's worth of margin. Used ONLY for a
    // wall-mounted item whose wall could not be identified: such an item sits
    // inside the wall, on the room's own boundary, where pointInRoom can answer
    // either way depending on which side of the mitre it lands. A margin there
    // keeps this room's doors and windows on screen; items out in another room
    // are nowhere near it and are still hidden.
    let nearRoom = () => false;
    const fcs = (focused && focused.corners) || [];
    if (fcs.length) {
      const fxs = fcs.map((c) => c.x);
      const fzs = fcs.map((c) => c.y);
      const pad = 40;
      const loX = Math.min(...fxs) - pad;
      const hiX = Math.max(...fxs) + pad;
      const loZ = Math.min(...fzs) - pad;
      const hiZ = Math.max(...fzs) + pad;
      nearRoom = (x, z) => x >= loX && x <= hiX && z >= loZ && z <= hiZ;
    }

    let changed = 0;
    const setVisible = (obj, on) => {
      if (!obj || obj.visible === on) return;
      obj.visible = on;
      changed += 1;
    };

    floors.forEach((f) => {
      if (!f) return;
      const mine = !focused || isMine(f.room);
      // Marked so the engine's own visibility passes leave a hidden room hidden.
      f.__focusHidden = !mine;
      setVisible(f.floorPlane, mine);
      // The ceiling also answers to updateAdaptiveCeiling, which hides it from
      // overhead; only force it OFF for a room being hidden entirely.
      if (!mine) setVisible(f.roofPlane, false);
    });

    // THE WALLS THIS ROOM IS MADE OF, collected while hiding them.
    //
    // A door or window is shown or hidden with the wall it is cut into, and
    // this is the only reliable way to know which wall that is. Asking the wall
    // itself (wall.frontEdge.room / wall.backEdge.room) is a second, separate
    // path to the same answer — and it was the one that left other rooms'
    // doors and windows hanging in mid-air. Reading the set straight off the
    // edges whose visibility was just decided means an opening can never
    // disagree with its own wall.
    // WALLS *AND* FACES.
    //
    // A wall between two rooms belongs to both of them, but each of its two
    // FACES belongs to one room only. That difference is the whole of this:
    // a door is cut through the wall and is rightly seen from both rooms,
    // while a cabinet hangs on one face and must not appear in the room on the
    // other side. Matching on the wall alone showed the neighbour's cabinets
    // along every shared wall.
    const myWalls = new Set();
    const knownWalls = new Set();
    const myEdges = new Set();
    const knownEdges = new Set();
    edges.forEach((e) => {
      if (!e) return;
      const mine = !focused || (e.edge && isMine(e.edge.room));
      if (e.edge) {
        knownEdges.add(e.edge);
        if (mine) myEdges.add(e.edge);
        if (e.edge.wall) {
          knownWalls.add(e.edge.wall);
          if (mine) myWalls.add(e.edge.wall);
        }
      }
      e.__focusHidden = !mine;
      // ALL THREE PLANE ARRAYS, NOT JUST `planes`.
      //
      // Edge3D.addToScene adds `planes`, `basePlanes` AND `phantomPlanes`.
      // Only `planes` was being hidden, so every other room left its skirting
      // footprint drawn flat on the floor — the faint outlines of the rest of
      // the house that stayed on screen around the one room you had chosen.
      // `basePlanes` is even commented "always visible", which is exactly why
      // nothing else in the engine was ever going to hide it.
      (e.planes || []).forEach((plane) => setVisible(plane, mine));
      (e.basePlanes || []).forEach((plane) => setVisible(plane, mine));
      (e.phantomPlanes || []).forEach((plane) => setVisible(plane, mine));
    });

    // EVERY ITEM IN THE SCENE, NOT JUST ONE LIST.
    //
    // __physicalRoomItems held 7 objects on a plan that visibly has more, so
    // doors and windows are registered elsewhere and stayed hanging in mid-air
    // in rooms that were otherwise gone. Walking the scene for anything
    // carrying an item model catches them wherever they are tracked.
    const seen = new Set();
    const held = three.__currentItemSelected || null;
    const judge = (it) => {
      if (!it || seen.has(it)) return;
      seen.add(it);
      const model = it.__itemModel || it.itemModel;
      if (!model || !it.position) return;
      if (!focused) {
        setVisible(it, true);
        return;
      }
      // The item you are HOLDING is always drawn, even when the drag has taken
      // it outside the room. Hiding it mid-drag is what "it vanished into the
      // next room" looked like; keepItemsInFocusedRoom brings it back on
      // release instead.
      if (it === held) {
        setVisible(it, true);
        return;
      }
      const wall = model.currentWall || model.__currentWall || null;
      // A door belongs to its wall: shown exactly when that wall is one of this
      // room's, including a wall shared with the room next door.
      //
      // Only trust that when the wall is one the view actually drew. If an item
      // points at a wall no edge knows about — a stale reference after a
      // redraw — treating it as "not mine" would hide this room's OWN doors,
      // which is worse than the bug being fixed. Fall through to position
      // instead, and let geometry decide.
      if (wall && knownWalls.has(wall)) {
        // Types 3 and 7 are InWallItem and InWallFloorItem (items/factory.js):
        // windows and doors, cut THROUGH the wall. They belong to both rooms
        // the wall divides, so they go by the wall.
        const meta = model.metadata || model.__metadata || {};
        const type = parseInt(meta.itemType, 10);
        if (type === 3 || type === 7) {
          setVisible(it, myWalls.has(wall));
          return;
        }
        // Everything else hangs on ONE face, and the engine records which:
        // __currentWallEdge is the half-edge it was attached to. Judge it by
        // that face, so the cabinets on the far side of a shared wall stay with
        // the room they belong to.
        //
        // `wallSide` is the same fallback the engine uses itself in
        // Item.__edgeDeleted, which clears the live edge but leaves the saved
        // side intact — so an item that has lived through a wall edit still
        // knows which face it is on.
        const edge =
          model.__currentWallEdge ||
          (meta.wallSide === "front"
            ? wall.frontEdge
            : meta.wallSide === "back"
            ? wall.backEdge
            : null);
        if (edge && knownEdges.has(edge)) {
          setVisible(it, myEdges.has(edge));
          return;
        }
        // No usable face — fall back to the wall rather than guessing, so an
        // item with incomplete wall data errs towards being visible in the
        // room whose wall it is on instead of disappearing from both.
        setVisible(it, myWalls.has(wall));
        return;
      }
      const inside = !!(
        focused.pointInRoom &&
        focused.pointInRoom(new Vector2(it.position.x, it.position.z))
      );
      setVisible(
        it,
        wall ? inside || nearRoom(it.position.x, it.position.z) : inside
      );
    };
    items.forEach(judge);
    try {
      const root = three.scene || three; // Viewer3D is itself the scene
      if (root && root.traverse) {
        root.traverse((o) => {
          if (o && (o.__itemModel || o.itemModel)) judge(o);
        });
      }
    } catch (e) {
      /* the array pass above still applies */
    }

    // POINT THE CAMERA AT THE ROOM — ONCE, WHEN THE 3D VIEW IS ACTUALLY LIVE.
    //
    // Asking for it is not the same as doing it. "Design this room" is pressed
    // on the FLOOR PLAN page: at that moment the 3D camera and controls may not
    // exist yet, and the tab switch that follows sets the camera itself — so a
    // move made there was either dropped (__animateCameraTo returns early with
    // no controls) or immediately overwritten. That is why the chosen room came
    // up as a small shape in the distance instead of filling the view.
    //
    // So the request is REMEMBERED and carried out on the first pass where the
    // viewer is ready, then cleared. The per-frame re-assert passes
    // moveCamera:false and never sets the flag, so it can never pin the view
    // and stop you looking around.
    if (!opts || opts.moveCamera !== false) {
      BlueprintInterface.__roomFocusWantsCamera = !!focused;
      // LETTING A ROOM GO SHOULD PULL BACK TO THE WHOLE HOUSE.
      //
      // The mirror of taking a room up, which moves in to it. Without this the
      // house came back around a camera still parked where the room had been,
      // so "All rooms" looked like it had done nothing but reveal a wall at
      // arm's length — only a reload showed the plan properly.
      //
      // Strictly on a RELEASE (`prevId` set, no room now). Asking for no focus
      // when there was none already happens on every mount, and re-framing
      // then would drag the camera away from wherever the user had put it.
      if (!focused && prevId) {
        BlueprintInterface.__roomFocusWantsHouse = true;
      }
    }
    if (focused && BlueprintInterface.__roomFocusWantsCamera && three.enabled) {
      // Only clear the request once the framing actually happened. Clearing it
      // on the attempt meant a pass made before the canvas had a size used a
      // nonsense aspect ratio, and there was no second chance to correct it.
      if (frameRoomCamera(three, focused)) {
        BlueprintInterface.__roomFocusWantsCamera = false;
      }
    } else if (
      !focused &&
      BlueprintInterface.__roomFocusWantsHouse &&
      three.enabled &&
      typeof three.frameFloorplan === "function"
    ) {
      // The engine's own pulled-back "dollhouse" fit — the one that runs on
      // load. Reusing it is what makes releasing a focus land in exactly the
      // view a reload gives, rather than a second, slightly different framing.
      BlueprintInterface.__roomFocusWantsHouse = false;
      three.frameFloorplan(true);
    }

    // Only ask for a frame when something actually moved, so re-asserting this
    // every frame costs nothing.
    if (changed) three.shouldRender = true;
    return true;
  } catch (e) {
    console.error("applyRoomFocus3D failed", e);
    return false;
  }
};

BlueprintInterface.setDimensionsMode2D = (mode) => {
  try {
    const v2d =
      BlueprintInterface.blueprint3d &&
      BlueprintInterface.blueprint3d.floorplanner;
    if (v2d && typeof v2d.setDimensionsMode2D === "function") {
      BlueprintInterface.__dimMode2D = v2d.setDimensionsMode2D(mode);
    }
  } catch (e) {
    console.error("setDimensionsMode2D failed", e);
  }
  return BlueprintInterface.__dimMode2D;
};

// Heal wall intersections after a bulk import (AI floor-plan / template).
// Manual drawing splits a wall when a corner lands in its MIDDLE (T-junction)
// and splits two crossing walls (X) — via corner.mergeWithIntersected /
// floorplan.newWallsForIntersections. loadFloorplan builds the graph directly
// and does NEITHER, so AI plans (full of T-junctions where a partition meets
// the middle of a perimeter wall) don't connect → rooms never close. This runs
// the same healing in bulk so imported plans form rooms like hand-drawn ones.
// Fully guarded + idempotent; safe to call once after an import.
BlueprintInterface.healFloorplanIntersections = () => {
  try {
    const fp =
      BlueprintInterface.blueprint3d &&
      BlueprintInterface.blueprint3d.model &&
      BlueprintInterface.blueprint3d.model.floorplan;
    if (!fp || typeof fp.getCorners !== "function") return;
    // Doors/windows already on the walls (heal-on-open runs on a furnished
    // plan). A split shortens a wall, and whatever sat on the cut-off half gets
    // dragged along with it — so remember where each one is now, and which
    // wall (by corners) it was on, to put it back afterwards.
    const wallItems = (BlueprintInterface.blueprint3d.model.roomItems || [])
      .filter((it) => it && it.__currentWall && it.position)
      .map((it) => ({
        it,
        pos: it.position.clone(),
        wallKey: it.__currentWall.getUuid(),
        side: it.__metadata && it.__metadata.wallSide,
      }));
    // Pass 1 — split walls at T-junctions + merge coincident corners.
    // mergeWithIntersected fixes ONE wall per corner per call, so a single sweep
    // could leave T-junctions behind (which heal-on-open then split later, under
    // the doors). Sweep until nothing changes. .slice() because the corner/wall
    // arrays mutate as walls split.
    for (let sweep = 0; sweep < 10; sweep++) {
      let changed = false;
      fp.getCorners()
        .slice()
        .forEach((c) => {
          try {
            if (c.mergeWithIntersected(false)) changed = true;
          } catch (e) {
            /* per-corner, never abort the whole heal */
          }
        });
      if (!changed) break;
    }
    // Pass 2 — split any remaining X crossings (walls that cross without a
    // shared endpoint). newWallsForIntersections runs its own update().
    fp.getWalls()
      .slice()
      .forEach((w) => {
        try {
          if (w && w.start && w.end) fp.newWallsForIntersections(w.start, w.end);
        } catch (e) {
          /* per-wall */
        }
      });
    fp.update();
    // Put each door/window whose wall was split back where it was, on the piece
    // of wall it actually sits on (it may now be the new half).
    const walls = fp.getWalls();
    wallItems.forEach(({ it, pos, wallKey, side }) => {
      try {
        const cur = it.__currentWall;
        if (cur && walls.includes(cur) && cur.getUuid() === wallKey) return; // untouched
        const target = it.__nearestWallTo([pos.x, pos.y, pos.z]);
        if (!target) return;
        const edge =
          side === "front"
            ? target.frontEdge || target.backEdge
            : target.backEdge || target.frontEdge;
        if (edge) it.snapToWall(pos.clone(), target, edge);
      } catch (e) {
        console.error("heal: re-placing a door/window failed", e);
      }
    });
    if (wallItems.length) BlueprintInterface.redrawDoors2D?.();
  } catch (e) {
    console.error("healFloorplanIntersections failed", e);
  }
};

// Measure EVERY placed item's meshes and save each panel's size to its matching
// component, so the BOQ can compute area AUTOMATICALLY — no manual click needed.
// Runs on scene load (see EVENT_LOADED above). Traverses the FULL object graph
// (Sketchfab imports nest their meshes many levels deep under a wrapper node, so
// a shallow scan misses them) and matches components by mesh INDEX ("Mesh_N"),
// because the raw mesh node names ("Sketchfab_model", "mesh_0", "Mesh_0.002")
// are unreliable. Idempotent + fully guarded so it can never break scene load.
BlueprintInterface.measureAllComponents2D = async () => {
  try {
    // Dynamic import (not a top-level `import`) so this file does NOT statically
    // depend on FurnishedModelComponent — which imports BlueprintInterface back.
    // Deferring it here breaks the circular import while keeping behaviour identical.
    const { FurnishedModelComponent } = await import(
      "@pazl/entities/FurnishedModelComponent"
    );
    const items =
      BlueprintInterface?.blueprint3d?.roomplanner?.__physicalRoomItems || [];
    for (const item of items) {
      const furnishedModelId =
        item?.__itemModel?.__id || item?.itemModel?.__id;
      if (!furnishedModelId) continue;
      const meshes = [];
      try {
        item?.traverse?.((o) => {
          if (o?.isMesh) meshes.push(o);
        });
      } catch (e) {
        continue;
      }
      for (let i = 0; i < meshes.length; i++) {
        const box = new Box3().setFromObject(meshes[i]);
        const size = box.getSize(new Vector3());
        const height = size.y;
        const width = Math.max(size.x, size.z);
        if (!height || !width) continue; // mesh not loaded yet / degenerate
        // Match by the mesh's own clean "Mesh_N" name when present (keeps the
        // correct panel↔component mapping for well-formed GLBs); fall back to the
        // traversal index only for Sketchfab meshes whose names are empty or
        // suffixed ("", "mesh_0", "Mesh_0.002").
        const nm = String(meshes[i]?.name || "");
        const compName = /^Mesh_\d+$/.test(nm) ? nm : "Mesh_" + i;
        const comp =
          await BlueprintInterface.ProjectManagerService.getFurnishedModelCompByNameAndFurnishedModelId(
            compName,
            furnishedModelId
          );
        // Only write if this panel hasn't been measured yet (still the "1"
        // fallback or empty). This fixes broken/new items ONCE and avoids
        // re-writing every component on every project load (no sync churn). New
        // GLBs start unmeasured so they're still caught; the selection path
        // (getSelectedModel) re-measures the actively-edited item, so resizes
        // are still reflected there.
        const alreadyMeasured =
          comp && comp.width && comp.width !== "1" && comp.width !== "";
        if (comp && !alreadyMeasured) {
          await new FurnishedModelComponent({ ...comp }).updateDimensions(
            height,
            width
          );
        }
      }
    }
  } catch (e) {
    console.error("measureAllComponents2D failed", e);
  }
};

// Rescue floor furniture that was saved OUTSIDE every room (e.g. items placed
// before wall-collision existed, or snapped to a wall's outer face). Any floor
// item whose CENTRE is not inside any room is pulled back to the nearest room's
// centre and the new position is persisted. Items already inside are NEVER
// touched. Fully live-safe: only clearly-outside items move, and each move goes
// through the normal save path so it sticks.
/**
 * GIVE EVERY ITEM BACK ITS ROOM.
 *
 * A placed item remembers its room by the room's id — and that id is the room's
 * CORNER LIST, joined with commas:
 *
 *   06b4d848-…,7c4b76d9-…,beb053f2-…,c770385c-…
 *
 * Rooms are not stored with the plan; they are re-derived on load by finding
 * closed loops of walls. So the moment a corner is added, merged or removed,
 * the room's id changes and every item inside it is ORPHANED — its stored
 * roomId matches no room any longer. Nothing visibly breaks, which is why this
 * has gone unnoticed: the furniture still draws. But anything that asks "which
 * room is this in" — the room-name change above, and room-by-room working —
 * silently finds nothing.
 *
 * The fix is to treat roomId as a CACHE rather than a fact. An item's real room
 * is the one it physically stands in, so any orphan is re-stamped from its own
 * position. Items that still match a real room are not touched, and neither are
 * wall-mounted items (doors and windows belong to a wall, not a floor).
 *
 * Safe to call at any time; it only writes when something is actually wrong.
 */
BlueprintInterface.reassignOrphanRoomIds = async () => {
  try {
    const model =
      BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.model;
    const floorplan = model && model.__floorplan;
    const rooms = (floorplan && floorplan.rooms) || [];
    const pm = BlueprintInterface.ProjectManagerService;
    const records = (pm && pm.furnishedModels) || [];
    if (!rooms.length || !records.length) return 0;

    const liveIds = new Set(
      rooms.map((r) => r && r.roomByCornersId).filter(Boolean)
    );
    // Items in the scene, so an orphan can be located by where it stands.
    const placed = new Map();
    ((model && model.__roomItems) || []).forEach((it) => {
      const id = it && it.__itemModel && it.__itemModel.__id;
      if (id) placed.set(String(id), it);
    });

    // Imported here, not at the top: the entities import BlueprintInterface
    // back, and a static import would close that circle. Same reason
    // FurnishedModelComponent is loaded this way further down.
    const { FurnishedModel } = await import("@pazl/entities/FurnishedModel");

    let fixed = 0;
    for (const record of records) {
      if (!record || !record._id) continue;
      if (record.roomId && liveIds.has(record.roomId)) continue; // still valid
      const item = placed.get(String(record._id));
      if (!item || !item.position) continue;
      // A door or window belongs to its wall; it has no floor to stand on.
      if (item.__itemModel && item.__itemModel.__currentWall) continue;

      const here = new Vector2(item.position.x, item.position.z);
      const room = rooms.find((r) => r && r.pointInRoom && r.pointInRoom(here));
      if (!room || !room.roomByCornersId) continue;
      if (room.roomByCornersId === record.roomId) continue;

      console.debug(
        "reassignOrphanRoomIds ~ re-homing item",
        record._id,
        "->",
        room.roomByCornersId
      );
      record.roomId = room.roomByCornersId;
      if (room.name) record.roomName = room.name;
      // eslint-disable-next-line no-await-in-loop
      await new FurnishedModel({ ...record }).update();
      fixed += 1;
    }
    if (fixed) console.debug(`reassignOrphanRoomIds ~ ${fixed} item(s) re-homed`);
    return fixed;
  } catch (e) {
    console.error("reassignOrphanRoomIds failed", e);
    return 0;
  }
};

BlueprintInterface.rescueOutsideItems = async () => {
  try {
    const model =
      BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.model;
    const floorplan = model && model.__floorplan;
    const rooms = (floorplan && floorplan.rooms) || [];
    const items = (model && model.__roomItems) || [];
    const pm = BlueprintInterface.ProjectManagerService;
    if (!rooms.length || !items.length || !pm) return;

    // World-space {x, z} centre of a room (Room.center is a Vector3; fall back
    // to the corner centroid — corners store .x and .y where y → world z).
    const roomCentre = (r) => {
      if (r && r.center && typeof r.center.x === "number") {
        return { x: r.center.x, z: r.center.z };
      }
      const cs = (r && r.corners) || [];
      if (!cs.length) return null;
      let sx = 0;
      let sz = 0;
      cs.forEach((c) => {
        sx += c.x;
        sz += c.y;
      });
      return { x: sx / cs.length, z: sz / cs.length };
    };

    for (const item of items) {
      if (!item || !item.position) continue;
      // Floor furniture only — skip wall-bound items (doors/windows).
      const isFloor = item.__itemType === 1;
      if (!isFloor) continue;
      const im = item.__itemModel;
      if (im && im.__currentWall) continue;

      const x = item.position.x;
      const z = item.position.z;
      const inside = rooms.some(
        (r) => r && r.pointInRoom && r.pointInRoom(new Vector2(x, z))
      );
      if (inside) continue; // already inside — leave it alone

      // Outside every room → move to the nearest room centre (surely inside).
      let target = null;
      let bestD = Infinity;
      rooms.forEach((r) => {
        const c = roomCentre(r);
        if (!c) return;
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < bestD) {
          bestD = d;
          target = c;
        }
      });
      const id = im && im.__id;
      if (!target || !id) continue;

      console.debug(
        "rescueOutsideItems ~ pulling item inside",
        id,
        "from",
        [x, z],
        "to",
        [target.x, target.z]
      );
      // eslint-disable-next-line no-await-in-loop
      await pm.onFurnishedModelPositionChange(id, [
        target.x,
        item.position.y,
        target.z,
      ]);
    }
  } catch (e) {
    console.error("rescueOutsideItems failed", e);
  }
};

// --- AI floor-plan import: annotate a freshly-loaded plan ------------------
// Place AI-detected doors on the nearest wall. `doors` are { cxCm, cyCm, widthCm }
// (already converted to cm). Returns how many were placed.
BlueprintInterface.placeAiDoors = (doors) => {
  const helper = BlueprintInterface.roomplanningHelper;
  if (!helper || !Array.isArray(doors)) return 0;
  let placed = 0;
  doors.forEach((d) => {
    if (helper.addParametricDoorAtPoint(d.cxCm, d.cyCm, d.widthCm)) placed += 1;
  });
  BlueprintInterface.redrawDoors2D();
  return placed;
};

// Place AI-detected windows on the nearest wall (at sill height). `windows` are
// { cxCm, cyCm, widthCm } (already converted to cm). Returns how many placed.
BlueprintInterface.placeAiWindows = (windows) => {
  const helper = BlueprintInterface.roomplanningHelper;
  if (!helper || !Array.isArray(windows)) return 0;
  let placed = 0;
  windows.forEach((wn) => {
    if (helper.addParametricWindowAtPoint(wn.cxCm, wn.cyCm, wn.widthCm))
      placed += 1;
  });
  BlueprintInterface.redrawDoors2D();
  return placed;
};

// Apply AI-detected room names by matching each label point to the room that
// contains it. `rooms` are { name, cxCm, cyCm }. Returns how many were named.
BlueprintInterface.applyAiRoomNames = (rooms) => {
  const fp =
    BlueprintInterface.blueprint3d &&
    BlueprintInterface.blueprint3d.model &&
    BlueprintInterface.blueprint3d.model.floorplan;
  if (!fp || !Array.isArray(rooms)) return 0;
  let named = 0;
  rooms.forEach((r) => {
    if (!r || !r.name) return;
    const room = fp.rooms.find((rm) => {
      try {
        return rm.pointInRoom({ x: r.cxCm, y: r.cyCm });
      } catch (e) {
        return false;
      }
    });
    if (room) {
      room.name = r.name;
      named += 1;
    }
  });
  return named;
};

// --- Scene outliner -------------------------------------------------------
// Flat snapshot of the current floor plan for the outliner panel: rooms, walls
// and placed items. Returns the live model objects (by reference) so the panel
// can pass them straight back to selectFromOutliner.
BlueprintInterface.getOutlineData = () => {
  const model =
    BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.model;
  const fp = model && model.floorplan;
  if (!fp) return { rooms: [], walls: [], items: [] };
  const rooms = (fp.rooms || []).map((r) => ({
    obj: r,
    name: r.name || "Room",
  }));
  const walls = (fp.walls || []).map((w, i) => ({
    obj: w,
    label: `Wall ${i + 1}`,
  }));
  const items = (model.__roomItems || []).map((it, i) => ({
    id: it.__id,
    name: (it.metadata && (it.metadata.itemName || it.metadata.name)) || `Item ${i + 1}`,
  }));
  return { rooms, walls, items };
};

// Subscribe to item add/remove on the live model so outliner panels can
// refresh their counts in real time. The model is only available after the
// blueprint loads, so we wire up listeners now (if model exists) AND on the
// next EVENT_LOADED — whichever comes first. Returns an unsubscribe function.
// Safe additive helper: existing callers are unaffected.
BlueprintInterface.onItemsChanged = (callback) => {
  if (typeof callback !== "function") return () => {};
  let attached = null;

  const attach = () => {
    try {
      const model =
        BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.model;
      if (!model || attached === model) return;
      if (attached) {
        try {
          attached.removeEventListener(EVENT_NEW_ITEM, callback);
          attached.removeEventListener(EVENT_ITEM_REMOVED, callback);
        } catch (e) {}
      }
      model.addEventListener(EVENT_NEW_ITEM, callback);
      model.addEventListener(EVENT_ITEM_REMOVED, callback);
      attached = model;
    } catch (e) {
      console.error("onItemsChanged attach failed", e);
    }
  };

  attach();
  const onLoaded = () => attach();
  try {
    BlueprintInterface.globalCustomEvents &&
      BlueprintInterface.globalCustomEvents.addEventListener(
        EVENT_LOADED,
        onLoaded
      );
  } catch (e) {}

  return () => {
    try {
      if (attached) {
        attached.removeEventListener(EVENT_NEW_ITEM, callback);
        attached.removeEventListener(EVENT_ITEM_REMOVED, callback);
      }
      BlueprintInterface.globalCustomEvents &&
        BlueprintInterface.globalCustomEvents.removeEventListener(
          EVENT_LOADED,
          onLoaded
        );
    } catch (e) {}
  };
};

// --- 3D (furnish) outliner: select + camera-focus -------------------------
// Select a placed item in the 3D view by its model id: highlights it, attaches
// the transform gizmo (via the engine's own __roomItemSelected) and flies the
// camera to frame it (__objectFocus) — i.e. Pascal-style "node focusing".
BlueprintInterface.selectItem3DById = (id) => {
  try {
    const rp =
      BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.roomplanner;
    if (!rp || !rp.__physicalRoomItems) return false;
    const phys = rp.__physicalRoomItems.find(
      (p) => (p.itemModel && p.itemModel.__id) === id ||
             (p.__itemModel && p.__itemModel.__id) === id
    );
    if (!phys) return false;
    // Select + highlight + show gizmo only. We intentionally do NOT move the
    // camera here — auto-zooming on every click is jarring. Camera framing is a
    // deliberate action (the Object/Room Focus buttons).
    // __user: picked from the items list — counts as the user's selection
    // even straight after a reload (see Viewer3d.__roomItemSelected).
    rp.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: phys, __user: true });
    return true;
  } catch (e) {
    console.error("selectItem3DById failed", e);
    return false;
  }
};

// Show/hide a placed 3D item by its model id (the outliner's visibility eye).
/**
 * The items the user has hidden, by model id.
 *
 * The 3D view rebuilds EVERY item from scratch whenever the plan reloads
 * (Viewer3d.addRoomItems on EVENT_LOADED — after a save, an undo, a template
 * load…), and a rebuilt item is visible again. Without this list a hidden door
 * came back on its own a moment later. Kept for this session only; it is not
 * saved with the project.
 */
BlueprintInterface.__hiddenItemIds = new Set();

BlueprintInterface.setItem3DVisible = (id, visible) => {
  try {
    const rp =
      BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.roomplanner;
    if (!rp || !rp.__physicalRoomItems) return false;
    const phys = rp.__physicalRoomItems.find(
      (p) =>
        (p.itemModel && p.itemModel.__id) === id ||
        (p.__itemModel && p.__itemModel.__id) === id
    );
    if (!phys) return false;
    phys.visible = visible;
    if (visible) BlueprintInterface.__hiddenItemIds.delete(id);
    else BlueprintInterface.__hiddenItemIds.add(id);
    rp.needsUpdate = true;
    return true;
  } catch (e) {
    console.error("setItem3DVisible failed", e);
    return false;
  }
};

BlueprintInterface.isItem3DVisible = (id) => !BlueprintInterface.__hiddenItemIds.has(id);

/** Re-hide everything the user hid. Runs after the 3D items are rebuilt. */
BlueprintInterface.reapplyHiddenItems3D = () => {
  const ids = BlueprintInterface.__hiddenItemIds;
  if (!ids.size) return 0;
  const rp =
    BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.roomplanner;
  if (!rp || !rp.__physicalRoomItems) return 0;
  let hidden = 0;
  rp.__physicalRoomItems.forEach((p) => {
    const id = (p.itemModel && p.itemModel.__id) || (p.__itemModel && p.__itemModel.__id);
    if (id && ids.has(id)) {
      p.visible = false;
      hidden += 1;
    }
  });
  if (hidden) rp.needsUpdate = true;
  return hidden;
};

// --- Actions for the toolbar that pops up on a selected 3D item -------------
// (components/MenuBar/ItemToolbar3D.tsx). Each takes the placed item's model id
// and works on the item in the 3D scene; all are guarded and return true/false.

const __roomplanner = () =>
  (BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.roomplanner) || null;

/** The placed 3D item with this model id (the one the toolbar is showing for). */
BlueprintInterface.getItem3DById = (id) => {
  const rp = __roomplanner();
  if (!rp || !rp.__physicalRoomItems || !id) return null;
  return (
    rp.__physicalRoomItems.find(
      (p) => ((p.itemModel && p.itemModel.__id) || (p.__itemModel && p.__itemModel.__id)) === id
    ) || null
  );
};

/**
 * Mirror the item left-to-right (a left-hand cabinet becomes a right-hand one).
 * A negative scale turns the model's faces inside out, so the materials are put
 * on both sides — otherwise the item looks hollow from the front.
 */
BlueprintInterface.mirrorItem3D = (id) => {
  const item = BlueprintInterface.getItem3DById(id);
  if (!item || !item.__itemModel) return false;
  try {
    const s = item.__itemModel.__scale;
    item.__itemModel.scale = new Vector3(-s.x, s.y, s.z);
    if (item.__loadedItem) {
      item.__loadedItem.scale.x = -item.__loadedItem.scale.x;
      item.__loadedItem.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m) {
            m.side = 2; // THREE.DoubleSide
            m.needsUpdate = true;
          }
        });
      });
    }
    const rp = __roomplanner();
    if (rp) {
      rp.needsUpdate = true;
      rp.shouldRender = true;
    }
    return true;
  } catch (e) {
    console.error("mirrorItem3D failed", e);
    return false;
  }
};

/** Add a copy of the item beside it (the Ctrl+C / Ctrl+V path, in one step). */
BlueprintInterface.duplicateItem3D = (id) => {
  const rp = __roomplanner();
  const item = BlueprintInterface.getItem3DById(id);
  if (!rp || !item) return false;
  try {
    const previous = rp.__copiedItem;
    rp.__copiedItem = item;
    rp.__pasteCopiedItem();
    rp.__copiedItem = previous; // leave the user's own copy alone
    return true;
  } catch (e) {
    console.error("duplicateItem3D failed", e);
    return false;
  }
};

/**
 * Lock / unlock: a locked item can't be dragged or turned in the 3D view.
 * Its own flag — the engine's `fixed` flag is true for almost every item and
 * means something else (how it snaps to walls and floors).
 * Lasts for this session; it is not saved with the project.
 */
BlueprintInterface.setItem3DLocked = (id, locked) => {
  const item = BlueprintInterface.getItem3DById(id);
  if (!item) return false;
  try {
    item.__pzLocked = !!locked;
    const rp = __roomplanner();
    // Drop the move/turn gizmo while it is locked.
    if (locked && rp?.transformControls?.object === item) rp.transformControls.detach();
    else if (!locked && rp?.transformControls && rp.__currentItemSelected === item) {
      rp.transformControls.attach(item);
    }
    if (rp) rp.needsUpdate = true;
    return true;
  } catch (e) {
    console.error("setItem3DLocked failed", e);
    return false;
  }
};

BlueprintInterface.isItem3DLocked = (id) => !!BlueprintInterface.getItem3DById(id)?.__pzLocked;

/**
 * Draw the Auto-furnish preview on the 2D plan (the cabinets that WOULD be
 * placed, and the picked walls). `shapes` is the list Viewer2D.setPlanOverlay
 * takes; null clears it.
 */
BlueprintInterface.setPlanOverlay2D = (shapes) => {
  try {
    BlueprintInterface.blueprint3d?.floorplanner?.setPlanOverlay?.(shapes);
    return true;
  } catch (e) {
    console.error("setPlanOverlay2D failed", e);
    return false;
  }
};

/** Listen for wall clicks in the 2D plan. Returns a function that stops it. */
BlueprintInterface.onWall2DClicked = (callback) => {
  const fp = BlueprintInterface.blueprint3d?.floorplanner;
  if (!fp?.addFloorplanListener) return () => {};
  const handler = (evt) => callback(evt?.item || null);
  fp.addFloorplanListener(EVENT_WALL_2D_CLICKED, handler);
  return () => fp.removeFloorplanListener?.(EVENT_WALL_2D_CLICKED, handler);
};

// Fly the 3D camera to frame a room (or the whole plan if no room given).
BlueprintInterface.focusRoom3D = (room) => {
  try {
    const rp =
      BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.roomplanner;
    if (!rp) return false;
    rp.__roomFocus({ room });
    return true;
  } catch (e) {
    console.error("focusRoom3D failed", e);
    return false;
  }
};

// Select a room/wall/corner from the outliner exactly as a 2D canvas click
// would: find its 2D entity, mark it selected (highlights it) and run the
// viewer's selection monitor (which opens the matching properties panel).
BlueprintInterface.selectFromOutliner = (modelObj, kind) => {
  try {
    const fp =
      BlueprintInterface.blueprint3d &&
      BlueprintInterface.blueprint3d.floorplanner;
    if (!fp || !fp.__entities2D) return false;
    const entity = fp.__entities2D.find((e) => {
      if (kind === "room") return e.room === modelObj;
      if (kind === "wall") return e.wall === modelObj;
      if (kind === "corner") return e.corner === modelObj;
      return false;
    });
    if (!entity) return false;
    entity.selected = true;
    fp.__selectionMonitor({ item: entity });
    return true;
  } catch (e) {
    console.error("selectFromOutliner failed", e);
    return false;
  }
};

// Items (doors) are 3D objects with no 2D shape of their own, so they can't be
// highlighted on the 2D canvas directly. But every in-wall item (door) sits on
// a wall. Clicking the item's row selects that HOST WALL — same 2D behaviour as
// clicking the wall's row (wall highlights + its properties panel opens).
BlueprintInterface.selectItemHostWall2D = (itemId) => {
  try {
    const model =
      BlueprintInterface.blueprint3d && BlueprintInterface.blueprint3d.model;
    if (!model) return false;
    const items = model.__roomItems || [];
    let item = items.find((it) => it && it.__id === itemId);
    if (!item && typeof itemId === "number" && items[itemId]) {
      item = items[itemId];
    }
    if (!item) return false;

    const meta = item.__metadata || {};
    const fp = model.floorplan;
    const walls = (fp && fp.walls) || [];
    let wall = item.__currentWall;

    // Fallback 1: metadata.wall may be a WALL id OR an EDGE id (front/back).
    if (!wall && meta.wall) {
      wall = walls.find(
        (w) =>
          w &&
          (w.id === meta.wall ||
            (w.frontEdge && w.frontEdge.id === meta.wall) ||
            (w.backEdge && w.backEdge.id === meta.wall))
      );
    }

    // Fallback 2: nearest wall to the item's snap point / position (AI-placed
    // doors can arrive with no wall link — this still selects a wall).
    if (!wall && walls.length) {
      const p =
        item.__currentWallSnapPoint ||
        (item.position && { x: item.position.x, z: item.position.z });
      if (p) {
        let best = Infinity;
        walls.forEach((w) => {
          const edge = w.frontEdge || w.backEdge;
          if (!edge) return;
          let d;
          try {
            d = edge.distanceTo(p.x, p.z);
          } catch (e) {
            d = Infinity;
          }
          if (d < best) {
            best = d;
            wall = w;
          }
        });
      }
    }

    if (!wall) return false;
    return BlueprintInterface.selectFromOutliner(wall, "wall");
  } catch (e) {
    console.error("selectItemHostWall2D failed", e);
    return false;
  }
};

BlueprintInterface.removeWall = () => {
  BlueprintInterface.selectedWall2D.remove();
};

BlueprintInterface.removeCorner = () => {
  BlueprintInterface.selectedCorner2D.remove();
};

BlueprintInterface.removeRoom2D = (roomTarget) => {
  const room = (roomTarget && roomTarget.room) || roomTarget || BlueprintInterface.getSelectedRoom2D();
  if (!room) return false;

  const fp =
    BlueprintInterface.blueprint3d &&
    BlueprintInterface.blueprint3d.model &&
    BlueprintInterface.blueprint3d.model.floorplan;
  if (!fp) return false;

  const allRooms = fp.getRooms() || [];
  const otherRooms = allRooms.filter(
    (r) => r !== room && (typeof r.getUuid === "function" ? r.getUuid() !== room.getUuid() : true)
  );

  const roomCorners = room.corners || room._corners || [];
  if (!roomCorners.length) return false;

  // Gather all walls connected to this room's corners + explicit walls
  const roomWallsSet = new Set();
  roomCorners.forEach((c) => {
    if (c.wallStarts) c.wallStarts.forEach((w) => roomWallsSet.add(w));
    if (c.wallEnds) c.wallEnds.forEach((w) => roomWallsSet.add(w));
  });
  const explicitRoomWalls = room.__walls || room.walls || [];
  explicitRoomWalls.forEach((w) => roomWallsSet.add(w));

  const roomWalls = Array.from(roomWallsSet);
  const wallsToRemove = [];

  // Find walls exclusive to this room (not shared by any other room)
  roomWalls.forEach((wall) => {
    const isShared = otherRooms.some((r) => {
      const otherWalls = r.__walls || r.walls || [];
      if (otherWalls.includes(wall)) return true;
      const otherCorners = r.corners || r._corners || [];
      return otherCorners.includes(wall.start) && otherCorners.includes(wall.end);
    });
    if (!isShared) {
      wallsToRemove.push(wall);
    }
  });

  // Temporarily pause heavy floorplan updates while removing walls in batch
  const prevUpdatesState = fp.__updatesOn;
  fp.__updatesOn = false;

  // Remove exclusive walls
  wallsToRemove.forEach((wall) => {
    try {
      wall.remove();
    } catch (e) {
      console.error("Failed to remove room wall", e);
    }
  });

  // Clean up any orphan corners that no longer have walls
  const allCornersInPlan = fp.getCorners() || [];
  allCornersInPlan.forEach((corner) => {
    if (corner && corner.wallStarts && corner.wallEnds) {
      if (corner.wallStarts.length === 0 && corner.wallEnds.length === 0) {
        try {
          corner.remove();
        } catch (e) {
          console.error("Failed to remove orphan corner", e);
        }
      }
    }
  });

  // Re-enable updates and run single update
  fp.__updatesOn = prevUpdatesState !== false;

  BlueprintInterface.resetSelections();
  try {
    fp.update();
  } catch (e) {
    console.error("Error updating floorplan after room removal", e);
  }

  try {
    BlueprintInterface.redrawDoors2D?.();
    BlueprintInterface.snapshot2D?.();
    BlueprintInterface.ProjectManagerService?.updateFloorPlan?.("Room deleted");
  } catch (e) {
    console.error("Error persisting room deletion", e);
  }

  return true;
};

BlueprintInterface.resetSelections = () => {
  BlueprintInterface.setSelectedWall2D(null);
  BlueprintInterface.setSelectedCorner2D(null);
  BlueprintInterface.setSelectedRoom2D(null);
};

BlueprintInterface.getLocalStorage = () => {
  let rooms = localStorage.getItem(STORAGE_KEY);
  if (rooms != undefined && rooms != "" && rooms.length != 0) {
    let json = JSON.parse(rooms);
    delete json.floorplan.boundary;

    if (json["floorplan"].walls.length != 0) {
      BlueprintInterface.blueprint3d.model.loadSerialized(rooms);
    }
  }
};

BlueprintInterface.toggleCanvasMode = () => {
  BlueprintInterface?.blueprint3d?.toggleThemeMode();
};

// Outline a specific set of meshes (by mesh.name) inside the currently
// selected Physical3DItem so the user can see which 3D part a panel row
// refers to. Called from objectComponents.tsx when a Components row is
// clicked.
BlueprintInterface.highlightMeshes = (meshNames) => {
  BlueprintInterface.clearMeshHighlight();
  if (!Array.isArray(meshNames) || meshNames.length === 0) return;
  const physical = BlueprintInterface.selectedModels?.[0];
  if (!physical?.__loadedItem || !physical.parent) return;
  const wanted = new Set(meshNames);
  const helpers = [];
  physical.__loadedItem.traverse((o) => {
    if (o.isMesh && wanted.has(o.name)) {
      const helper = new BoxHelper(o, new Color(0x00aaff));
      // Render the outline on top of whatever else is at that depth so it
      // remains visible when the highlighted mesh is occluded.
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.renderOrder = 999;
      physical.parent.add(helper);
      helpers.push(helper);
    }
  });
  BlueprintInterface.highlightedMeshHelpers = helpers;
  if (BlueprintInterface.blueprint3d?.viewer3d) {
    BlueprintInterface.blueprint3d.viewer3d.needsUpdate = true;
  }
};

// Snap engine controls — proxies to the SnapManager held inside the
// DragRoomItemsControl3D. Wired in Phase 3 to a toolbar; safe to call
// from anywhere now.
BlueprintInterface.getSnapManager = () => {
  return (
    BlueprintInterface?.blueprint3d?.roomplanner?.dragcontrols
      ?.__snapManager || null
  );
};

// Master snap on/off — the toolbar's single "Snapping" switch.
BlueprintInterface.setSnapActive = (on) => {
  const mgr = BlueprintInterface.getSnapManager();
  mgr?.setActive(on);
};

BlueprintInterface.setSnapEnabled = (kind, enabled) => {
  const mgr = BlueprintInterface.getSnapManager();
  mgr?.setEnabled(kind, enabled);
};

BlueprintInterface.setSnapTolerance = (kind, cm) => {
  const mgr = BlueprintInterface.getSnapManager();
  mgr?.setTolerance(kind, cm);
};

BlueprintInterface.setSnapGridStep = (cm) => {
  const mgr = BlueprintInterface.getSnapManager();
  mgr?.setGridStep(cm);
};

BlueprintInterface.setSnapDebug = (on) => {
  const mgr = BlueprintInterface.getSnapManager();
  mgr?.setDebug(on);
};

BlueprintInterface.setSnapWallOffset = (cm) => {
  const mgr = BlueprintInterface.getSnapManager();
  mgr?.setWallOffset(cm);
};

BlueprintInterface.clearMeshHighlight = () => {
  const helpers = BlueprintInterface.highlightedMeshHelpers;
  if (helpers?.length) {
    for (const h of helpers) {
      h.parent?.remove(h);
      h.geometry?.dispose();
      h.material?.dispose();
    }
  }
  BlueprintInterface.highlightedMeshHelpers = [];
  if (BlueprintInterface.blueprint3d?.viewer3d) {
    BlueprintInterface.blueprint3d.viewer3d.needsUpdate = true;
  }
};

// Select an opening (door/window) from the ITEMS list by its __id and open its
// 2D properties panel. Returns false if the id isn't a parametric opening (so
// the caller can fall back to selecting the host wall).
BlueprintInterface.selectOpeningById = (id) => {
  const items =
    (BlueprintInterface.blueprint3d &&
      BlueprintInterface.blueprint3d.model &&
      BlueprintInterface.blueprint3d.model.__roomItems) ||
    [];
  const item = items.find((it) => it && it.__id === id);
  if (item && item.parametricClass) {
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("pazl-opening-2d-selected", { detail: { item } })
        );
      }
    } catch (e) {
      /* ignore */
    }
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// 2D editor basics: undo snapshot + opening (door/window) clipboard. All route
// through the model + the existing snapshot history, so measurements (which are
// derived from geometry at render time) update automatically and are unaffected.

// Record the current state into the 2D undo history.
BlueprintInterface.snapshot2D = () => {
  try {
    BlueprintInterface.actionsHistory2DManager?.rise2DActionEvent?.(
      ACTION_EVENT_2D,
      null
    );
  } catch (e) {
    console.error("snapshot2D failed", e);
  }
};

// Coohom-style 2D drawing tools (scripts/viewer2d/DrawTools2D.js) — the
// toolbar's Arc, Rectangle, Circle, Fillet, Merge, Split, Align and
// Guides, plus the Orthogonal option (also honoured by Line).
const __drawTools2D = () =>
  BlueprintInterface?.blueprint3d?.floorplanner?.__drawTools || null;
BlueprintInterface.setDrawTool2D = (tool) => {
  try {
    return !!__drawTools2D()?.activate(tool);
  } catch (e) {
    console.error("setDrawTool2D failed", e);
    return false;
  }
};
BlueprintInterface.setOrthogonal2D = (on) => __drawTools2D()?.setOrthogonal(on);
BlueprintInterface.setFilletRadius2D = (cm) =>
  __drawTools2D()?.setFilletRadiusCm(cm);
BlueprintInterface.clearGuides2D = () => __drawTools2D()?.clearGuides();
// Circle: "corner" (circumscribed corner) | "radius". Arc: "radius" | "chord".
BlueprintInterface.setCircleMode2D = (mode) => __drawTools2D()?.setCircleMode(mode);
BlueprintInterface.setArcMode2D = (mode) => __drawTools2D()?.setArcMode(mode);
// Arc's own Orthogonal option (separate from Line / Guides).
BlueprintInterface.setArcOrthogonal2D = (on) => __drawTools2D()?.setArcOrthogonal(on);
// Fillet: "fillet" | "inner" (inner fillet) | "rightangle" (inner right angle) | "chamfer".
BlueprintInterface.setFilletMode2D = (mode) => __drawTools2D()?.setFilletMode(mode);
BlueprintInterface.exitDrawTool2D = () =>
  BlueprintInterface?.blueprint3d?.floorplanner?.__exitToolMode?.();

// The opening currently highlighted in the 2D view (set by Viewer2D).
BlueprintInterface.getSelectedOpening2D = () =>
  BlueprintInterface?.blueprint3d?.floorplanner?.__selectedOpening || null;

BlueprintInterface.__opening2DClipboard = null;

// Copy the selected door/window's definition to an in-memory clipboard.
BlueprintInterface.copyOpening2D = () => {
  const item = BlueprintInterface.getSelectedOpening2D();
  if (!item || !item.parametricClass) return false;
  const dc = item.parametricClass;
  const md = item.__metadata || {};
  const isWindow =
    dc.__windowType !== undefined ||
    dc.__name === "Window" ||
    md.baseParametricType === "WINDOW";
  const sp = item.__currentWallSnapPoint || item.position || { x: 0, z: 0 };
  BlueprintInterface.__opening2DClipboard = {
    isWindow,
    w: dc.frameWidth || 90,
    h: dc.frameHeight || 210,
    openDir: dc.openDirection || "RIGHT",
    type: (md.subParametricData && md.subParametricData.type) || 1,
    swingFlip: !!(md.swingFlip || item.__swingFlip),
    name: md.itemName || (isWindow ? "Window" : "Door"),
    wall: item.__currentWall || null,
    x: sp.x || 0,
    z: sp.z || 0,
  };
  return true;
};

// Paste the clipboard opening onto its wall, offset along the wall so it doesn't
// overlap the original. Records the action for undo.
BlueprintInterface.pasteOpening2D = () => {
  const clip = BlueprintInterface.__opening2DClipboard;
  const helper = BlueprintInterface?.blueprint3d?.roomplanningHelper;
  if (!clip || !helper) return false;
  let px = clip.x;
  let pz = clip.z;
  const wall = clip.wall;
  if (wall && wall.start && wall.end) {
    const dx = wall.end.location.x - wall.start.location.x;
    const dz = wall.end.location.y - wall.start.location.y;
    const len = Math.hypot(dx, dz) || 1;
    const off = (clip.w || 90) + 20;
    px = clip.x + (dx / len) * off;
    pz = clip.z + (dz / len) * off;
  } else {
    px = clip.x + 40;
    pz = clip.z + 40;
  }
  try {
    if (clip.isWindow) {
      helper.addParametricWindowAtPoint(px, pz, clip.w, clip.type, clip.name);
    } else {
      helper.addParametricDoorAtPoint(
        px,
        pz,
        clip.w,
        clip.type,
        clip.openDir,
        clip.h,
        clip.name
      );
    }
    if (clip.swingFlip) {
      const items = BlueprintInterface?.blueprint3d?.model?.__roomItems || [];
      const newItem = items[items.length - 1];
      if (newItem) {
        newItem.__swingFlip = true;
        newItem.__metadata = newItem.__metadata || {};
        newItem.__metadata.swingFlip = true;
      }
    }
    setTimeout(() => BlueprintInterface.redrawDoors2D?.(), 200);
    BlueprintInterface.snapshot2D();
    return true;
  } catch (e) {
    console.error("pasteOpening2D failed", e);
    return false;
  }
};

BlueprintInterface.duplicateOpening2D = () =>
  BlueprintInterface.copyOpening2D() ? BlueprintInterface.pasteOpening2D() : false;

BlueprintInterface.deleteSelectedOpening2D = () => {
  const item = BlueprintInterface.getSelectedOpening2D();
  if (!item) return false;
  try {
    BlueprintInterface.blueprint3d.model.removeItem(item);
    BlueprintInterface.redrawDoors2D?.();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pazl-opening-2d-deselected"));
    }
    BlueprintInterface.snapshot2D();
    return true;
  } catch (e) {
    console.error("deleteSelectedOpening2D failed", e);
    return false;
  }
};

// Expose on `window` for DevTools console debugging. Has no effect on
// production behaviour — just lets you type `BlueprintInterface.foo()` in
// the console without going through a module import.
if (typeof window !== "undefined") {
  window.BlueprintInterface = BlueprintInterface;
}

export default BlueprintInterface;
