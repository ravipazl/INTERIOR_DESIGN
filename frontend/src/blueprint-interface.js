import { BlueprintJS } from "@pazl/main/blueprint.js";
import {
  Configuration,
  configDimUnit,
  viewBounds,
} from "@pazl/main/core/configuration.js";
import { dimFeetAndInch } from "@pazl/main/core/constants.js";
import * as lshape_room_json from "@pazl/rooms/Lshape.json";
import { STORAGE_KEY } from "@pazl/main/core/constants.js";
import { cornerTolerance } from "@pazl/main/core/configuration.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
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
    });
  } catch (e) {
    console.error("attach EVENT_LOADED redrawDoors2D listener failed", e);
  }
  Configuration.setValue(configDimUnit, dimFeetAndInch);
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
    dimFeetAndInch
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

// Set the overall-dimensions overlay mode in the 2D view. Read-only overlay,
// OFF by default. `mode` is "off" | "inner" | "outer"; only one is ever shown
// at a time (OUTER = footprint / outside faces, INNER = clear span / inside
// faces). Returns the active mode.
BlueprintInterface.__dimMode2D = "off";
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
    // Pass 1 — split walls at T-junctions + merge coincident corners.
    // .slice() because the corner/wall arrays mutate as walls split.
    fp.getCorners()
      .slice()
      .forEach((c) => {
        try {
          c.mergeWithIntersected(false);
        } catch (e) {
          /* per-corner, never abort the whole heal */
        }
      });
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
    rp.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: phys });
    return true;
  } catch (e) {
    console.error("selectItem3DById failed", e);
    return false;
  }
};

// Show/hide a placed 3D item by its model id (the outliner's visibility eye).
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
    rp.needsUpdate = true;
    return true;
  } catch (e) {
    console.error("setItem3DVisible failed", e);
    return false;
  }
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
