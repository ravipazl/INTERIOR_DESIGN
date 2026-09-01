import {
  LineBasicMaterial,
  EdgesGeometry,
  LineSegments,
  BoxBufferGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from "three";
import { TEXTURE_PROPERTY_COLOR } from "../core/constants";
import { Dimensioning } from "../core/dimensioning";
import {
  EVENT_NO_ITEM_SELECTED,
  EVENT_ITEM_SELECTED,
  EVENT_WALL_CLICKED,
  EVENT_ROOM_CLICKED,
} from "../core/events";
import { InWallFloorItem } from "../items/in_wall_floor_item";
import { InWallItem } from "../items/in_wall_item";
import { WallItem } from "../items/wall_item";
import { FloorItem } from "../items/floor_item";
import { RoofItem } from "../items/roof_item";
import BlueprintInterface from "@pazl/blueprint-interface";

export class RoomPlannerHelper {
  constructor(model, floorplan, roomplanner) {
    this.__model = model;
    this.__floorplan = floorplan;
    this.__roomplanner = roomplanner;

    this.__wallThickness = Dimensioning.cmToMeasureRaw(20);
    this.__cornerElevation = Dimensioning.cmToMeasureRaw(250);
    this.__roomName = "A New Room";

    this.__selectedEdge = null;
    this.__selectedEdgeNormal = null;
    this.__selectedEdgePoint = null;
    this.__selectedWall = null;
    this.__selectedItem = null;
    this.__selectedRoom = null;
    this.__wallTexturePack = null;
    this.__roomTexturePack = null;
    this.__roomWallsTexturePack = null;

    this.__nothingSelectedEvent = this.__nothingSelected.bind(this);
    this.__itemSelectedEvent = this.__itemSelected.bind(this);
    this.__wallSelectedEvent = this.__wallSelected.bind(this);
    this.__roomSelectedEvent = this.__roomSelected.bind(this);

    this.__roomplanner.addRoomplanListener(
      EVENT_NO_ITEM_SELECTED,
      this.__nothingSelectedEvent
    );
    this.__roomplanner.addRoomplanListener(
      EVENT_ITEM_SELECTED,
      this.__itemSelectedEvent
    );
    this.__roomplanner.addRoomplanListener(
      EVENT_WALL_CLICKED,
      this.__wallSelectedEvent
    );
    this.__roomplanner.addRoomplanListener(
      EVENT_ROOM_CLICKED,
      this.__roomSelectedEvent
    );
  }

  __itemSelected(evt) {
    this.__selectedItem = evt.item;
  }

  __wallSelected(evt) {
    console.debug("RoomplannerHelper.js ~ __wallSelected ~ event", evt);
    this.__selectedEdge = evt.item;
    this.__selectedEdgeNormal = evt.normal;
    this.__selectedEdgePoint = evt.point;
    this.__wallThickness = Dimensioning.cmToMeasureRaw(evt.item.thickness);
    this.__selectedWall = evt.item.wall;
    this.__floorplan.walls = this.__floorplan.walls.map((wall) => {
      if (wall.id === evt.item.wall.id) {
        this.__roomplanner.remove(this.__boxhelper);
        console.debug(
          "RoomplannerHelper.js ~ __wallSelected ~ selectedWall",
          wall
        );
        this.__selectedMaterial = new LineBasicMaterial({
          color: 0x0000f0,
          linewidth: 1,
        });

        this.__boxhelper = new LineSegments(
          new EdgesGeometry(
            new BoxBufferGeometry(
              wall.wallSize - wall.thickness,
              wall.height - wall.thickness,
              wall.thickness
            )
          ),
          this.__selectedMaterial
        );
        if (Math.round(evt.normal.z) === 0) {
          console.debug("RoomplannerHelper.js ~ __wallSelected ~ normal", evt.normal.z);
          this.__boxhelper.position.set(
            evt.item.center.x,
            evt.item.center.y,
            evt.item.center.z
          );
          this.__boxhelper.rotation.set(0, 1.57, 0);
        } else {
          this.__boxhelper.position.set(
            evt.item.center.x,
            evt.item.center.y,
            evt.item.min.z
          );
        }
        this.__boxhelper.material.linewidth = 1;
        this.__roomplanner.add(this.__boxhelper);
      }
      return wall;
    });
    this.__floorplan.update();
  }

  __roomSelected(evt) {
    // EVENT_ROOM_CLICKED is also fired with a NULL item, to mean "the click
    // landed on nothing". That is what lets the mouse-UP handler be the single
    // decider for room selection (the mouse-DOWN deselect no longer clears it,
    // which was making the Room Properties panel blink on every floor click).
    //
    // Treat it as a deselect: hide the room outline and drop the reference. The
    // old code went straight to `evt.item.name` and threw on the null.
    if (!evt || !evt.item) {
      this.__selectedRoom = null;
      this.__roomName = null;
      if (this.__boxhelper) this.__boxhelper.visible = false;
      return;
    }
    this.__selectedRoom = evt.item;
    this.__selectedEdgeNormal = evt.normal;
    this.__selectedEdgePoint = evt.point;
    this.__roomName = evt.item.name;
    this.__selectedMaterial = new LineBasicMaterial({
      color: 0x0000f0,
      linewidth: 1,
    });
    this.__boxhelper = new LineSegments(
      new EdgesGeometry(
        new ShapeGeometry(new Shape(this.__selectedRoom.interiorCorners))
      ),
      this.__selectedMaterial
    );
    this.__boxhelper.position.set(0, 5, 0);
    this.__boxhelper.rotation.set(1.57, 0, 0);
    this.__boxhelper.material.linewidth = 1;
    this.__roomplanner.add(this.__boxhelper);
  }

  __nothingSelected() {
    console.debug("Debug: EVENT_NO_ITEM_SELECTED");
    BlueprintInterface?.setNothingSelected();
    if (this.__boxhelper) this.__boxhelper.visible = false;
    // this.__selectedEdge = null;
    // this.__selectedRoom = null;
    // this.__selectedItem = null;
  }

  addWallItems(data) {
    if (!this.__selectedEdge) {
      /* No wall was clicked — pick a sensible fallback HalfEdge so the item
       * still lands somewhere reasonable. Preference order:
       *   1. rooms[0].edgePointer  — guaranteed room-bound HalfEdge with a
       *      .room ref and normal pointing INTO that room (Room.updateWalls
       *      builds it with the correct `front` flag for the polygon).
       *   2. walls[0].__frontEdge ?? __backEdge — last-ditch when no room
       *      has been computed yet (e.g. during very early scene init). The
       *      direction-sanity check inside WallItem.snapToWall will flip
       *      the normal inward if needed.
       * Never early-return — addWallItems being a no-op leaves the user
       * with a model that was scraped/uploaded but silently never appears,
       * which is far more confusing than a slightly misplaced item. */
      const room = this.__model.__floorplan.rooms?.[0];
      // Prefer the room's LONGEST wall (a proper main wall) over its first edge,
      // which on an L-shaped room is often a short inner-corner wall — that's
      // what made a "+ Add" TV land awkwardly at the inner corner. Wall items
      // only; floor items don't reach this path.
      let fallbackEdge =
        (room && typeof room.getDefaultWallEdge === "function"
          ? room.getDefaultWallEdge()
          : null) ??
        room?.edgePointer ??
        null;
      if (!fallbackEdge) {
        const firstWall = this.__model.__floorplan.walls?.[0];
        fallbackEdge = firstWall?.__frontEdge ?? firstWall?.__backEdge ?? null;
      }
      if (fallbackEdge) {
        this.__selectedEdge = fallbackEdge;
        this.__selectedEdgeNormal =
          fallbackEdge.normal ?? { x: 0, y: 0, z: 1 };
        this.__selectedEdgePoint = fallbackEdge.center ?? null;
        if (fallbackEdge.wall?.thickness != null) {
          this.__wallThickness = Dimensioning.cmToMeasureRaw(
            fallbackEdge.wall.thickness
          );
        }
      } else {
        console.warn(
          "RoomplannerHelper.addWallItems: no room and no wall available — placing item via floor-item path so it still lands in the scene"
        );
        // Last-ditch: route through addFloorItem so the user at least
        // sees the model in the scene and can move it manually.
        return this.addFloorItem(data);
      }
    }
    this.addWallItemScene(data);
  }

  addWallItemScene(data) {
    let type = data.type;
    let itemMetaData = {
      itemName: data.name,
      dbid: data.dbid,
      price: data.price,
      thumbnail: data.image,
      description: data.description,
      isParametric: false,
      itemType: type,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      // Intrinsic model turn (Swap uses this to put a door's width along the
      // wall when its GLB models width on the Z axis). Default: no turn.
      innerRotation: Array.isArray(data.innerRotation)
        ? data.innerRotation
        : [0, 0, 0],
      // Honour the auto-scale baseline if the caller passed one
      // (viewer3d-state-interface.js sets `data.scale = [metaScale, ...]`
      // so per-GLB calibration survives into the in-scene FloorItem).
      // Fallback to [1,1,1] for legacy callers that don't pass scale.
      scale: Array.isArray(data.scale) ? data.scale : [1, 1, 1],
      size: data.size,
      modelURL: data.url,
      fixed: false,
      resizable: false,
      wall: this.__selectedEdge.id,
      mesh: data.mesh,
      meshmap: data.meshmap,
    };
    let item = null;
    if (data.type == 2) {
      item = new WallItem(itemMetaData, this.__model, itemMetaData.dbid);
    } else if (data.type == 7) {
      item = new InWallFloorItem(itemMetaData, this.__model, itemMetaData.dbid);
    } else {
      item = new InWallItem(itemMetaData, this.__model, itemMetaData.dbid);
    }

    this.__model.addItem(item);
    // `__selectedEdge` IS the HalfEdge the user clicked (set by
    // __wallSelected from evt.item, dispatched by DragRoomItemsControl3D
    // as `wallPlanesThatIntersect[0].object.edge`). Pass it directly so
    // snapToWall uses the CLICKED face's inward-pointing normal — going
    // through `wall.__frontEdge` ignored which side the user clicked and
    // pushed items to the wrong side of the wall (outside the room when
    // the user clicked the back face, or vice-versa). This mirrors how
    // addParametricDoorToCurrentWall (line 305) already does it. */
    item.snapToWall(
      this.__selectedEdgePoint,
      this.__selectedEdge.wall,
      this.__selectedEdge
    );
  }
  /* Add FloorItem Model */
  addItemScene(data) {
    let itemMetaData = {
      itemName: data.name,
      // see addWallItemScene above — keep the metadata.scale we were passed
      // so the FloorItem's __scale reflects the auto-scale baseline rather
      // than being reset to a flat [1,1,1] (which renders all GLBs at 100×
      // native, ignoring the inspector's calibration).
      dbid: data.dbid,
      price: data.price,
      thumbnail: data.image,
      description: data.description,
      isParametric: false,
      itemType: data.type,
      position: [0, 0, 0],
      rotation: data.rotation ? data.rotation : [0, 0, 0],
      scale: Array.isArray(data.scale) ? data.scale : [1, 1, 1],
      size: data.size,
      modelURL: data.url,
      fixed: false,
      resizable: false,
      mesh: data.mesh,
      meshmap: data.meshmap,
    };
    console.debug(
      "RoomplannerHelper.js ~ addItemScene ~ itemMetaData",
      itemMetaData
    );
    let item = new FloorItem(itemMetaData, this.__model, itemMetaData.dbid);
    console.debug("RoomplannerHelper.js ~ addItemScene ~ item", item);
    this.__model.addItem(item);

    // FINAL SAFETY NET: a floor item must land ON the floor, INSIDE a room.
    // Whatever the placement point ended up being (default centre, a stale
    // point left by a previous item, or an outside drop), if it is missing or
    // falls OUTSIDE the room polygon, replace it with a guaranteed-inside
    // point. This is the single choke-point every floor add passes through, so
    // it catches all paths ("+ Add", drag-drop, programmatic).
    try {
      let room = this.__selectedRoom;
      if (!room || typeof room.pointInRoom !== "function") {
        room = this.__model.__floorplan.rooms && this.__model.__floorplan.rooms[0];
      }
      if (room && typeof room.pointInRoom === "function") {
        const pt = this.__selectedEdgePoint;
        const inside =
          pt &&
          Number.isFinite(pt.x) &&
          Number.isFinite(pt.z) &&
          room.pointInRoom(new Vector2(pt.x, pt.z));
        if (!inside && typeof room.getInsidePoint === "function") {
          this.__selectedRoom = room;
          this.__selectedEdgePoint = room.getInsidePoint();
          this.__selectedEdgeNormal = { x: 0, y: 0, z: 1 };
        }
      }
    } catch (e) {
      /* non-fatal — fall through with the original point */
    }

    item.snapToPoint(
      this.__selectedEdgePoint,
      this.__selectedEdgeNormal,
      this.__selectedRoom
    );
  }
  /* Add FloorItem Model */
  addFloorItem(data) {
    // A drag-drop sets an EXPLICIT drop point (handleDropModelAtScreen) and
    // wants the item to land exactly there. The "+ Add" button sets no such
    // point and wants the item CENTRED in the room. The flag distinguishes
    // them; it's consumed here so it never leaks into the next add.
    const explicitDrop = this.__hasExplicitDropPoint === true;
    this.__hasExplicitDropPoint = false;

    if (!explicitDrop) {
      /* "+ Add" (or any non-drop add): ALWAYS place at a point GUARANTEED to be
       * inside the room's floor. Previously this only ran when no room was
       * selected yet — so after the first interaction a STALE wall/corner point
       * was reused and the item landed at the side / outside the room. Now we
       * always recompute the room's inside-centre for a non-drop add.
       * `room.center` is only the bounding-box centre, which for an L-shaped /
       * concave room lands OUTSIDE the floor — getInsidePoint() returns the
       * centroid (or nearest inside point) so any room shape places the item on
       * the actual floor. Keep the currently selected room if there is one, so
       * the item is centred in the room the user is working in. */
      const room = this.__selectedRoom ?? this.__model.__floorplan.rooms[0];
      if (room) {
        this.__selectedRoom = room;
        this.__selectedEdgeNormal = { x: -0, y: 0, z: 1 };
        this.__selectedEdgePoint =
          typeof room.getInsidePoint === "function"
            ? room.getInsidePoint()
            : room.center;
        this.__roomName = room.name;
      }
      this.addItemScene(data);
    } else {
      this.addItemScene(data);
    }
  }

  /* Add RoofItem Model (ceiling-mounted: fan, chandelier, downlight).
   * Mirrors addFloorItem, but the placement point is lifted to the room's
   * ceiling height. RoofItem.snapToPoint then drops the item by half its
   * height so it hangs just under the ceiling. */
  addRoofItem(data) {
    const room = this.__selectedRoom ?? this.__model.__floorplan.rooms?.[0];
    if (!room) {
      console.warn(
        "RoomplannerHelper.addRoofItem: no room available — cannot place ceiling item"
      );
      return;
    }
    this.__selectedRoom = room;
    this.__roomName = room.name;
    this.addRoofItemScene(data);
  }

  addRoofItemScene(data) {
    const room = this.__selectedRoom;
    // Ceiling height = the room's wall height (HalfEdge.height mirrors
    // wall.height). Fall back to the default corner elevation, then 250 cm.
    const ceilingY =
      room?.edgePointer?.height ??
      room?.edgePointer?.wall?.height ??
      Dimensioning.cmFromMeasureRaw(this.__cornerElevation) ??
      250;
    const center = room?.center;
    // Fresh Vector3 — RoofItem.snapToPoint MUTATES point.y, so never pass a
    // shared reference like room.center directly.
    this.__selectedEdgePoint = new Vector3(
      center?.x ?? 0,
      ceilingY,
      center?.z ?? 0
    );
    // Ceiling normal points straight down into the room.
    this.__selectedEdgeNormal = { x: 0, y: -1, z: 0 };

    let itemMetaData = {
      itemName: data.name,
      dbid: data.dbid,
      price: data.price,
      thumbnail: data.image,
      description: data.description,
      isParametric: false,
      itemType: data.type,
      position: [0, 0, 0],
      rotation: data.rotation ? data.rotation : [0, 0, 0],
      scale: Array.isArray(data.scale) ? data.scale : [1, 1, 1],
      size: data.size,
      modelURL: data.url,
      fixed: false,
      resizable: false,
      mesh: data.mesh,
      meshmap: data.meshmap,
    };
    let item = new RoofItem(itemMetaData, this.__model, itemMetaData.dbid);
    this.__model.addItem(item);
    item.snapToPoint(
      this.__selectedEdgePoint,
      this.__selectedEdgeNormal,
      this.__selectedRoom
    );
  }

  addParametricDoorToCurrentWall(doorType) {
    if (!this.__selectedEdge) {
      return;
    }
    let itemMetaData = {
      itemName: "Parametric Door",
      isParametric: true,
      baseParametricType: "DOOR",
      subParametricData: {
        type: doorType,
        frameColor: "#E7E7E7",
        doorColor: "#E7E7E7",
        doorHandleColor: "#F0F0F0",
        glassColor: "#87CEEB",
        frameWidth: 100,
        frameHeight: 200,
        frameSize: 5,
        frameThickness: 20,
        doorRatio: 0.5,
        openDirection: "RIGHT",
        handleType: "HANDLE_01",
      },
      itemType: 7,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [100, 200, 20],
      fixed: false,
      resizable: false,
      wall: this.__selectedEdge.id,
    };

    let item = new InWallFloorItem(itemMetaData, this.__model);
    this.__model.addItem(item);
    item.snapToWall(
      this.__selectedEdgePoint,
      this.__selectedEdge.wall,
      this.__selectedEdge
    );
  }

  /**
   * Place a parametric door at an explicit floor-plan point (cm) on the NEAREST
   * wall, with an explicit width — the non-interactive sibling of
   * addParametricDoorToCurrentWall, used by the AI floor-plan import to place
   * detected doors. Placement relies on the wall/edge OBJECTS passed to
   * snapToWall (which __addToAWall consumes), not on metadata, so it mirrors the
   * proven interactive path. Returns true if a door was placed.
   */
  addParametricDoorAtPoint(cxCm, cyCm, widthCm, doorType = 1, openDirection = "RIGHT", heightCm = 210, itemName = "Parametric Door") {
    const fp = this.__model && this.__model.floorplan;
    if (!fp || !fp.walls || !fp.walls.length) return false;

    // Nearest wall: a door's centre must lie on a wall, so pick the closest edge.
    let bestWall = null;
    let bestEdge = null;
    let bestDist = Infinity;
    fp.walls.forEach((wall) => {
      const edge = wall.frontEdge || wall.backEdge;
      if (!edge) return;
      let d;
      try {
        d = edge.distanceTo(cxCm, cyCm);
      } catch (e) {
        d = Infinity;
      }
      if (d < bestDist) {
        bestDist = d;
        bestWall = wall;
        bestEdge = edge;
      }
    });
    // > ~60cm from any wall means the AI point is off — skip rather than misplace.
    if (!bestWall || !bestEdge || bestDist > 60) return false;

    const w = Math.min(300, Math.max(40, Math.round(widthCm) || 90));
    const h = Math.min(300, Math.max(150, Math.round(heightCm) || 210));
    const itemMetaData = {
      itemName: itemName,
      isParametric: true,
      baseParametricType: "DOOR",
      subParametricData: {
        type: doorType,
        frameColor: "#E7E7E7",
        doorColor: "#E7E7E7",
        doorHandleColor: "#F0F0F0",
        glassColor: "#87CEEB",
        frameWidth: w,
        frameHeight: h,
        frameSize: 5,
        frameThickness: 20,
        doorRatio: 0.5,
        openDirection: openDirection,
        handleType: "HANDLE_01",
      },
      itemType: 7,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [w, h, 20],
      fixed: false,
      resizable: false,
      wall: bestEdge.id,
    };

    try {
      const item = new InWallFloorItem(itemMetaData, this.__model);
      this.__model.addItem(item);
      item.snapToWall(new Vector3(cxCm, 0, cyCm), bestWall, bestEdge);
      return true;
    } catch (e) {
      console.error("RoomplannerHelper.addParametricDoorAtPoint failed", e);
      return false;
    }
  }

  // Place an AI-detected window: a glass pane on the nearest wall, at sill
  // height. Mirrors addParametricDoorAtPoint but uses an InWallItem (not floor-
  // seated) so it sits up at the sill, and the WINDOW parametric type.
  addParametricWindowAtPoint(cxCm, cyCm, widthCm, windowType = 1, itemName = "Parametric Window") {
    const fp = this.__model && this.__model.floorplan;
    if (!fp || !fp.walls || !fp.walls.length) return false;

    let bestWall = null;
    let bestEdge = null;
    let bestDist = Infinity;
    fp.walls.forEach((wall) => {
      const edge = wall.frontEdge || wall.backEdge;
      if (!edge) return;
      let d;
      try {
        d = edge.distanceTo(cxCm, cyCm);
      } catch (e) {
        d = Infinity;
      }
      if (d < bestDist) {
        bestDist = d;
        bestWall = wall;
        bestEdge = edge;
      }
    });
    if (!bestWall || !bestEdge || bestDist > 60) return false;

    const w = Math.min(300, Math.max(40, Math.round(widthCm) || 120));
    const WINDOW_H = 120; // window height (cm)
    const SILL = 90; // sill height from floor (cm)
    const centerY = SILL + WINDOW_H / 2; // window centre height
    const itemMetaData = {
      itemName: itemName,
      isParametric: true,
      baseParametricType: "WINDOW",
      subParametricData: {
        type: windowType,
        glassColor: "#BCD4E6",
        frameWidth: w,
        frameHeight: WINDOW_H,
        frameThickness: 10,
      },
      itemType: 3, // InWallItem (not floor-seated) — sits at sill height
      position: [cxCm, centerY, cyCm],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [w, WINDOW_H, 10],
      fixed: false,
      resizable: false,
      wall: bestEdge.id,
    };

    try {
      const item = new InWallItem(itemMetaData, this.__model);
      this.__model.addItem(item);
      item.snapToWall(new Vector3(cxCm, centerY, cyCm), bestWall, bestEdge);
      const pos = item.position || { x: cxCm, y: centerY, z: cyCm };
      item.__metadata.wall = bestWall.id;
      item.__metadata.wallSide = bestEdge.front ? "front" : "back";
      item.__metadata.wallSurfacePoint = [pos.x, pos.y, pos.z];
      item.__metadata.position = [pos.x, pos.y, pos.z];
      return true;
    } catch (e) {
      console.error("RoomplannerHelper.addParametricWindowAtPoint failed", e);
      return false;
    }
  }

  set wallThickness(value) {
    if (this.__selectedEdge) {
      let cms = Dimensioning.cmFromMeasureRaw(value);
      this.__selectedEdge.thickness = cms;
      this.__wallThickness = value;
    }
  }
  get wallThickness() {
    return Dimensioning.cmToMeasureRaw(this.__wallThickness);
  }

  set cornerElevation(value) {
    if (this.__selectedCorner) {
      let cms = Dimensioning.cmFromMeasureRaw(value);
      this.__selectedCorner.elevation = cms;
      this.__cornerElevation = value;
    }
  }
  get cornerElevation() {
    return Dimensioning.cmToMeasureRaw(this.__cornerElevation);
  }

  set roomName(value) {
    if (this.__selectedRoom) {
      this.__selectedRoom.name = value;
      this.__roomName = value;
    }
  }
  get roomName() {
    return this.__roomName;
  }

  get wallTexturePack() {
    return this.__wallTexturePack;
  }

  set wallTexturePack(tpack) {
    console.debug("wallTexturePack setting texture");
    this.__wallTexturePack = tpack;
    if (this.__selectedEdge) {
      this.__selectedEdge.setTextureMaps(tpack);
    }
  }

  get roomTexturePack() {
    return this.__roomTexturePack;
  }

  set roomTexturePack(tpack) {
    console.debug("roomTexturePack setting texture");
    this.__roomTexturePack = tpack;
    if (this.__selectedRoom) {
      this.__selectedRoom.setTextureMaps(tpack);
    }
  }

  get roomWallsTexturePack() {
    return this.__roomWallsTexturePack;
  }

  set roomWallsTexturePack(tpack) {
    this.__roomTexturePack = tpack;
    if (this.__selectedRoom) {
      this.__selectedRoom.setRoomWallsTextureMaps(tpack);
    }
  }

  setWallColor(color) {
    if (this.__selectedEdge) {
      this.__selectedEdge.setTextureMapAttribute(TEXTURE_PROPERTY_COLOR, color);
    }
  }

  setRoomWallsTextureColor(color) {
    if (this.__selectedRoom) {
      this.__selectedRoom.setRoomWallsTextureMapsAttribute(
        TEXTURE_PROPERTY_COLOR,
        color
      );
    }
  }

  setRoomFloorColor(color) {
    if (this.__selectedRoom) {
      this.__selectedRoom.setTextureMapAttribute(TEXTURE_PROPERTY_COLOR, color);
    }
  }
}
