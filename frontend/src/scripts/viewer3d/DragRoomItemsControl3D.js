import {
  EventDispatcher,
  Vector2,
  Box3,
  ArrowHelper,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
} from "three";
import { Plane, Raycaster, Vector3, Matrix4 } from "three/build/three.module";
import {
  EVENT_WALL_SELECT,
  EVENT_ROOM_SELECT,
  EVENT_ROTATE_ITEM_SELECTED,
  EVENT_ITEM_SELECTED,
  EVENT_ITEM_MOVE,
  EVENT_ITEM_HOVERON,
  EVENT_ITEM_HOVEROFF,
  EVENT_ITEM_MOVE_FINISH,
  EVENT_NO_ITEM_SELECTED,
  EVENT_WALL_CLICKED,
  EVENT_FLOOR_CLICKED,
  EVENT_ROOM_CLICKED,
  EVENT_MOVED,
  EVENT_MOVED_DRAG,
} from "../core/events";
import { IS_TOUCH_DEVICE } from "../../DeviceInfo";
import { remove } from "jszip";
import BlueprintInterface from "@pazl/blueprint-interface";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import { MODEL_TYPES } from "@pazl/entities/Model";
import { SnapManager } from "../snap/SnapEngine";
import { SnapIndicator } from "../snap/SnapIndicator";

/**
 * How far the dragged item travels toward the cursor each frame, 0–1.
 *
 * 1.0 = the item sits exactly under the cursor. Lower values damp the motion,
 * which smears any single-frame snap pop — but they also make the item TRAIL
 * the cursor, and it never catches up while the mouse keeps moving.
 *
 * This was 0.35: only a third of the remaining gap closed per frame, so the
 * item needed ~10 frames (~160 ms) to arrive and the drag felt like elastic.
 * 0.8 arrives in ~3 frames (~50 ms) — indistinguishable from instant — while
 * still absorbing a fifth of any one-frame jump from the snap engine.
 */
const DRAG_FOLLOW = 0.8;

/**
 * This is a custom implementation of the DragControls class
 * In this class the raycaster intersection will not check for children
 * This is supposed to work only for physicalroomitems because it creates
 * a invisible box geometry based on the loaded gltf
 */
export class DragRoomItemsControl3D extends EventDispatcher {
  constructor(walls, floors, items, camera, domElement, hud) {
    super();
    this.__walls = walls;
    this.__floors = floors;
    this.__draggableItems = items;
    // Bright, vivid cyan outline on the VISIBLE wall/floor mesh under the mouse.
    this.__surfaceHoverMaterial = new LineBasicMaterial({ color: 0x00e5ff });
    this.__hoveredSurface = null;
    this.__surfaceOutline = null;
    this.__camera = camera;
    this.__domElement = domElement;
    this.__enabled = true;
    this.__transformGroup = false;
    this.__allowDragging = true;
    this.__intialModelMovementParams = null;
    this.hud = hud;

    this.__intersections = [];

    this.__plane = new Plane();
    this.__raycaster = new Raycaster();
    this.__mouse = new Vector2();
    this.__offset = new Vector3();
    this.__intersection = new Vector3();

    this.__worldPosition = new Vector3();
    this.__inverseMatrix = new Matrix4();
    this.__selected = null;
    this.__hovered = null;
    this.__lastInterectionPoint = null;
    this.__lastInterectionPointNormal = null;
    this.__lastInterectionPointObjet = null;
    this.__releasetimestamp = Date.now();
    this.__timestamp = Date.now();

    // Snap engine — Phase 1: WallSnap + GridSnap. Phase 2: object edge /
    // centre. Phase 3: CornerSnap + a visual SnapIndicator. See
    // ../snap/SnapEngine.js and ../snap/SnapIndicator.js
    this.__snapManager = new SnapManager();
    this.__snapIndicator = new SnapIndicator();
    this.__shiftHeld = false;
    this.__onKeyDown = (e) => {
      if (e.key === "Shift") this.__shiftHeld = true;
    };
    this.__onKeyUp = (e) => {
      if (e.key === "Shift") this.__shiftHeld = false;
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.__onKeyDown);
      window.addEventListener("keyup", this.__onKeyUp);
    }

    // Newest pointer position waiting to be processed, and the animation frame
    // queued to process it. See __moveListener.
    this.__pendingMove = null;
    this.__moveFrame = null;

    this.__pressListenerEvent = this.__pressListener.bind(this);
    this.__releaseListenerEvent = this.__releaseListener.bind(this);
    this.__moveListenerEvent = this.__moveListener.bind(this);
    this.__hoverListenerEvent = this.__hoverListener.bind(this);
    this.activate();
  }

  __hoverListener(evt) {}

  // Show a CYAN hover outline on the item under the cursor (and clear the
  // previous one). Walks up from the hit mesh to its Physical3DItem (which
  // carries `__itemModel`), then toggles that item's `hovered` flag. Selection
  // (blue) still wins over hover inside the item's own highlight logic.
  __setHoverHighlight(object) {
    try {
      let phys = object;
      while (phys && phys.__itemModel === undefined) {
        phys = phys.parent;
      }
      if (this.__hoveredPhysical && this.__hoveredPhysical !== phys) {
        this.__hoveredPhysical.hovered = false;
      }
      this.__hoveredPhysical = phys || null;
      if (phys) {
        phys.hovered = true;
      }
    } catch (e) {
      // Hover highlight is cosmetic — never let it break interaction.
    }
  }

  // The VISIBLE wall/floor meshes (correct shape) — NOT the giant invisible
  // click-planes. Walls: each Edge3D.planes; floors: each Floor3D.floorPlane.
  __getSurfaceMeshes() {
    const bp = BlueprintInterface && BlueprintInterface.blueprint3d;
    // The Viewer3D instance is `roomplanner` (see blueprint.js). Fall back to
    // `viewer3d` just in case.
    const v = bp && (bp.roomplanner || bp.viewer3d);
    if (!v) return [];
    const meshes = [];
    (v.edges3d || []).forEach((e) => {
      if (e && Array.isArray(e.planes)) {
        e.planes.forEach((p) => {
          if (p) meshes.push(p);
        });
      }
    });
    (v.floors3d || []).forEach((f) => {
      if (f && f.floorPlane) meshes.push(f.floorPlane);
    });
    return meshes;
  }

  // Remove any wall/floor hover outline.
  __clearSurfaceHover() {
    try {
      if (this.__surfaceOutline && this.__surfaceOutline.parent) {
        this.__surfaceOutline.parent.remove(this.__surfaceOutline);
        if (this.__surfaceOutline.geometry) {
          this.__surfaceOutline.geometry.dispose();
        }
      }
    } catch (e) {
      // cosmetic
    }
    this.__surfaceOutline = null;
    this.__hoveredSurface = null;
  }

  // Draw a CYAN outline on the VISIBLE wall/floor mesh under the cursor — its
  // real shape, so it's a clean rectangle (Coohom-style), not a grid. Added to
  // the scene root (the meshes themselves render fine), rebuilt only on change.
  __setSurfaceHoverHighlight() {
    try {
      const surfaces = this.__getSurfaceMeshes();
      if (!surfaces.length) {
        this.__clearSurfaceHover();
        return;
      }
      const hits = this.__raycaster.intersectObjects(surfaces, true);
      const mesh = hits.length ? hits[0].object : null;
      if (mesh === this.__hoveredSurface) return; // no change → keep outline
      this.__clearSurfaceHover();
      this.__hoveredSurface = mesh;
      if (mesh && mesh.geometry) {
        let root = mesh;
        while (root.parent) root = root.parent;
        mesh.updateWorldMatrix(true, false);
        const edges = new EdgesGeometry(mesh.geometry);
        const outline = new LineSegments(edges, this.__surfaceHoverMaterial);
        outline.applyMatrix4(mesh.matrixWorld);
        outline.renderOrder = 9999;
        root.add(outline);
        this.__surfaceOutline = outline;
      }
    } catch (e) {
      // Hover highlight is cosmetic — never let it break interaction.
    }
  }

  __pressListener(evt) {
    console.debug(
      "DragRoomItemsControl3D.js ~ __releaseListener ~ __pressListener",
      evt
    );
    this.dispatchEvent({
      type: EVENT_MOVED_DRAG,
      event: evt,
    });
    this.__allowDragging = true;
    let rect = this.__domElement.getBoundingClientRect();
    this.__intialModelMovementParams = {
      startX: evt.clientX,
      startY: evt.clientY,
      startLeft: rect.left,
    };
    // console.log(
    //   this.__intialModelMovementParams,
    //   "__intialModelMovementParams"
    // );
    let time = Date.now();
    let deltaTime = time - this.__timestamp;
    this.__timestamp = time;
    evt.preventDefault();
    evt = evt.changedTouches !== undefined ? evt.changedTouches[0] : evt;

    this.__intersections.length = 0;

    let visibleDraggableItems = [];
    for (let i = 0; i < this.__draggableItems.length; i++) {
      if (this.__draggableItems[i].visible) {
        //this.__intersections.push(this.__draggableItems[i].__arrowHelper)
        visibleDraggableItems.push(this.__draggableItems[i]);
      }
    }

    this.__raycaster.setFromCamera(this.__mouse, this.__camera);
    // this.__raycaster.intersectObjects(this.__draggableItems, false, this.__intersections);
    this.__raycaster.intersectObjects(
      visibleDraggableItems,
      false,
      this.__intersections
    );

    if (this.__intersections.length) {
      this.__selected = this.__transformGroup
        ? this.__draggableItems[0]
        : this.__intersections[0].object;

      // A draggable can land in __draggableItems before its Physical3DItem has
      // been parented to the scene (loading race), in which case .parent is
      // null and getInverse(null.matrixWorld) crashes the press handler.
      // Bail this click — the next mouse-down after the item finishes
      // attaching will resolve cleanly.
      if (!this.__selected || !this.__selected.parent) {
        this.__selected = null;
        return;
      }

      if (
        this.__raycaster.ray.intersectPlane(this.__plane, this.__intersection)
      ) {
        this.__inverseMatrix.getInverse(this.__selected.parent.matrixWorld);
        /**
         * The belwo line for plane setting normal and coplanar point is necessary for touch based events (ref: DragCOntrols.js in three)
         */
        this.__plane.setFromNormalAndCoplanarPoint(
          this.__camera.getWorldDirection(this.__plane.normal),
          this.__worldPosition.setFromMatrixPosition(
            this.__selected.matrixWorld
          )
        );

        this.__offset
          .copy(this.__intersection)
          .sub(
            this.__worldPosition.setFromMatrixPosition(
              this.__selected.matrixWorld
            )
          );
      }
      this.__domElement.style.cursor = "move";
      this.dispatchEvent({ type: EVENT_ITEM_SELECTED, item: this.__selected });
      return;
    }
    //if (deltaTime < 300) {
    this.dispatchEvent({ type: EVENT_NO_ITEM_SELECTED, item: this.__selected });
    this.__allowDragging = true;
    // //}
  }

  __releaseListener(evt) {
    console.debug(
      "DragRoomItemsControl3D.js ~ __releaseListener ~ release the drag",
      evt
    );
    this.__allowDragging = true;
    // The drag is over — clear the snap guide line.
    this.__snapIndicator?.hide();

    let time = Date.now();
    //  this.checkThresholdAndSetPosition();
    let deltaTime = time - this.__releasetimestamp;
    this.__releasetimestamp = time;
    evt.preventDefault();
    if (this.__selected) {
      // Land EXACTLY on the last target: the smooth-move trail (above) may leave
      // the item a hair short of where the user aimed, so snap it precisely onto
      // the final target before any wall-cleanup runs.
      try {
        const t = this.__selected.__dragRawTarget;
        if (t && t.location) {
          this.__selected.snapToPoint(t.location, t.normal, t.intersectingPlane);
        }
        this.__selected.__dragRawTarget = null;
      } catch (e) {
        /* non-fatal — fall through to the wall-cleanup below */
      }
      // Settle a floor item flush beside any wall it was dropped straddling
      // (free dragging is allowed during the drag; overlap is cleaned up here).
      try {
        const resolved = this.__resolveFloorItemOffWalls(this.__selected);
        if (resolved && this.__selected.__itemModel) {
          this.__selected.__itemModel.position = resolved;
        }
      } catch (e) {
        console.warn("release resolve off walls failed", e);
      }
      this.dispatchEvent({
        type: EVENT_ITEM_MOVE_FINISH,
        item: this.__selected,
      });
      this.__selected = null;
    } else {
      evt = evt.changedTouches !== undefined ? evt.changedTouches[0] : evt;
      this.__raycaster.setFromCamera(this.__mouse, this.__camera);
      let wallPlanesThatIntersect = this.__raycaster.intersectObjects(
        this.__walls,
        false
      );
      console.debug("Release Listener: floors", this.__floors);
      let floorPlanesThatIntersect = this.__raycaster.intersectObjects(
        this.__floors,
        false
      );
      //if (deltaTime < 300) {
      if (wallPlanesThatIntersect.length) {
        this.dispatchEvent({
          type: EVENT_WALL_CLICKED,
          item: wallPlanesThatIntersect[0].object.edge,
          point: wallPlanesThatIntersect[0].point,
          normal: wallPlanesThatIntersect[0].face.normal,
        });
      } else if (floorPlanesThatIntersect.length) {
        this.dispatchEvent({
          type: EVENT_ROOM_CLICKED,
          item: floorPlanesThatIntersect[0].object.room,
          point: floorPlanesThatIntersect[0].point,
          normal: floorPlanesThatIntersect[0].face.normal,
        });
      } else {
        // Nothing hit — still announce the click, with no room.
        //
        // The mouse-UP handler is the single decider for room selection: the
        // mouse-DOWN NO_ITEM_SELECTED no longer clears it, because clearing on
        // the way down and re-setting on the way up made the Room Properties
        // panel blink for one click. Without this branch a click on genuinely
        // empty space (outside any floor) would emit nothing at all on mouse-up
        // and the panel would stay open.
        this.dispatchEvent({ type: EVENT_ROOM_CLICKED, item: null });
      }
      //}
    }
    this.__domElement.style.cursor = this.__hovered ? "pointer" : "auto";
  }

  _deductDargAxis(evt) {
    //console.log(evt, "keyCode");
    const deltaX = Math.abs(evt.clientX - evt.screenX);
    const deltaY = Math.abs(evt.clientY - evt.screenY);
    console.debug(deltaX, deltaY, "this.__oldPageX");
    if (deltaX > deltaY) {
      return "left";
    } else {
      return "right";
    }
  }

  // On drag RELEASE, push a floor item out of any wall its footprint is
  // overlapping so it never comes to REST inside/straddling a wall. This is the
  // counterpart to free dragging: the item can be dragged anywhere (including
  // across rooms) during the drag, and when dropped it settles flush beside any
  // wall it was straddling instead of overlapping it. Returns the corrected
  // world position (Vector3) or null when no correction is needed.
  __resolveFloorItemOffWalls(item) {
    try {
      // Accept BOTH floor-grounded types, as number or string. `__itemType`
      // comes straight from model metadata, where it can arrive as "1". The
      // old `!= MODEL_TYPES.FLOOR_UNIT` also rejected type 0 (ITEM), which the
      // rest of the engine treats as floor-grounded — those items were getting
      // no wall cleanup at all. Mirrors the isFloorGrounded test in
      // Physical3DItem.handleFloorItemsPositioning.
      if (!item) return null;
      const t = item.__itemType;
      const isFloorGrounded =
        t === MODEL_TYPES.ITEM ||
        t === MODEL_TYPES.FLOOR_UNIT ||
        t === 0 ||
        t === "0" ||
        t === 1 ||
        t === "1";
      if (!isFloorGrounded) return null;
      if (!item.position) return null;
      const walls =
        BlueprintInterface?.blueprint3d?.model?.__floorplan?.walls || [];
      if (!walls.length) return null;

      const box = new Box3().setFromObject(item);
      if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
      const halfX = (box.max.x - box.min.x) / 2;
      const halfZ = (box.max.z - box.min.z) / 2;

      const startX = item.position.x;
      const startZ = item.position.z;
      let cx = startX;
      let cz = startZ;
      const MARGIN = 1; // cm clearance off the wall (snug, Coohom-style corner)

      // Iterate a few times so a corner (two walls at once) resolves fully.
      for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const w of walls) {
          const s = w.start;
          const e = w.end;
          if (!s || !e) continue;
          const ax = s.x;
          const az = s.y;
          const dx = e.x - s.x;
          const dz = e.y - s.y;
          const len = Math.hypot(dx, dz);
          if (len < 1e-3) continue;
          const nx = -dz / len;
          const nz = dx / len;
          // perpendicular signed distance of the centre to the wall line
          const dist = (cx - ax) * nx + (cz - az) * nz;
          const halfPerp = Math.abs(nx) > Math.abs(nz) ? halfX : halfZ;
          // Clear the wall's INNER FACE. `w.thickness` was ignored here, so an
          // item was only pushed until its edge reached the corner-to-corner
          // line — leaving it a whole wall thickness buried.
          //
          // FULL thickness, not half: that corner line is the wall's EXTERIOR
          // face, and the interior face sits a whole thickness inward. Same
          // calibration SnapEngine documents for `wallExtraOffset` (default 10).
          const wallInset = Number(w.thickness) || 10;
          const penetration = wallInset + halfPerp - Math.abs(dist);
          if (penetration <= 0) continue; // clear of this wall (perpendicular)
          // must also overlap the wall ALONG its length to actually straddle it
          const along = ((cx - ax) * dx + (cz - az) * dz) / len; // 0..len
          const halfPar = Math.abs(nx) > Math.abs(nz) ? halfZ : halfX;
          if (along < -halfPar || along > len + halfPar) continue;
          // push to whichever side the centre is on, flush + a small margin
          const sign = dist >= 0 ? 1 : -1;
          const push = penetration + MARGIN;
          cx += sign * push * nx;
          cz += sign * push * nz;
          moved = true;
        }
        if (!moved) break;
      }

      if (Math.abs(cx - startX) < 0.5 && Math.abs(cz - startZ) < 0.5) {
        return null; // nothing meaningful to correct
      }
      const p = item.position.clone();
      p.x = cx;
      p.z = cz;
      return p;
    } catch (e) {
      console.warn("resolve floor item off walls failed", e);
      return null;
    }
  }

  // Pointer moves arrive far faster than the screen refreshes — a mouse can
  // emit 120+ events a second, and each one used to run the FULL drag pipeline
  // (raycasts, wall/room containment, snap queries, polygon collision). Most of
  // that work was thrown away by the next event microseconds later.
  //
  // Keep only the newest pointer position and process it once per animation
  // frame, so the cost is capped at the refresh rate no matter how fast the
  // mouse reports. This is what makes a fast drag stop stuttering.
  __moveListener(evt) {
    evt.preventDefault();
    const src = evt.changedTouches !== undefined ? evt.changedTouches[0] : evt;
    // Copy the fields the pipeline reads; the event object itself must not be
    // held across a frame boundary.
    this.__pendingMove = {
      clientX: src.clientX,
      clientY: src.clientY,
      screenX: src.screenX,
      screenY: src.screenY,
    };
    if (this.__moveFrame != null) return; // a frame is already queued
    this.__moveFrame = requestAnimationFrame(() => {
      this.__moveFrame = null;
      const pending = this.__pendingMove;
      this.__pendingMove = null;
      if (pending) {
        try {
          this.__processMove(pending);
        } catch (e) {
          console.warn("drag move failed", e);
        }
      }
    });
  }

  __processMove(evt) {
    let rect = this.__domElement.getBoundingClientRect();

    if (this.__allowDragging) {
      this.__mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      this.__mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    }

    this.__raycaster.setFromCamera(this.__mouse, this.__camera);
    // `checkThreshold` used to run here. It looped EVERY draggable item and
    // built two Box3.setFromObject boxes per item — each a full traversal of
    // that object's tree — on every pointer move. The only thing it could do
    // with the result was set `__allowDragging = false`, and that line is
    // commented out (see checkCollision), so the entire result was discarded.
    // Pure waste in the hottest path; removed. The method is left in place for
    // the copy/paste flow that still calls it.
    if (this.__selected && this.__enabled) {
      if (!this.__selected.__itemModel.__metadata.fixed) {
        //Check if the item has customIntersectionPlanes, otherwise move it freely
        if (!this.__selected.intersectionPlanes.length) {
          /* PERF-REMOVED console.debug — ran on every pointer move */
          if (
            this.__raycaster.ray.intersectPlane(
              this.__plane,
              this.__intersection
            )
          ) {
            let location = this.__selected.location
              .clone()
              .copy(
                this.__intersection
                  .sub(this.__offset)
                  .applyMatrix4(this.__inverseMatrix)
              );
            this.__selected.location = location;
          }
        } else {
          /* PERF-REMOVED console.debug — ran on every pointer move */
          let customIntersectingPlanes = this.__selected.intersectionPlanes;
          let customPlanesThatIntersect = this.__raycaster.intersectObjects(
            customIntersectingPlanes,
            false
          );

          /* PERF-REMOVED console.debug — ran on every pointer move */
          if (customPlanesThatIntersect.length) {
            let intersectionData = customPlanesThatIntersect[0];
            this.__intersection = intersectionData.point;
            let location = intersectionData.point;
            this.__lastInterectionPoint = location;
            let normal = intersectionData.face.normal;
            this.__lastInterectionPointNormal = normal;
            let intersectingPlane = intersectionData.object;
            this.__lastInterectionPointObjet = intersectingPlane;
            // console.log(intersectingPlane,'intersectingPlane');

            // Keep floor furniture INSIDE THE BUILDING but let it move FREELY to
            // any floor spot / corner. We only stop the item from leaving the
            // building outline — internal partition walls do NOT block dragging
            // (so you can move furniture between compartments and into any
            // corner). Overlapping a wall is prevented by the inside-only wall
            // SNAP, not by a hard barrier. A move is blocked only if it pushes
            // the item FURTHER outside the building than it already is — so you
            // can always drag an outside item back in and slide along a wall.
            // Only floor items are confined; wall/in-wall items keep their own
            // logic below.
            if (this.__selected.__itemType == MODEL_TYPES.FLOOR_UNIT) {
              const cf =
                this.__selected.__itemModel &&
                this.__selected.__itemModel.__currentFloor;
              // __currentFloor may be a Room (has pointInRoom) or a floor plane
              // (whose .room is the Room). Resolve to the Room either way.
              const itemRoom =
                cf && typeof cf.pointInRoom === "function" ? cf : cf && cf.room;

              // Test against ALL rooms (the whole building interior), not just
              // the item's own room, so furniture can be dragged to EVERY floor
              // area and corner in the plan — only truly outside the building is
              // blocked. Fall back to the item's own room if no room list.
              const allRooms =
                BlueprintInterface?.blueprint3d?.model?.__floorplan?.rooms ||
                (itemRoom ? [itemRoom] : []);
              const insideBuilding = (px, pz) => {
                const p = new Vector2(px, pz);
                return allRooms.some(
                  (r) => r && r.pointInRoom && r.pointInRoom(p)
                );
              };

              if (allRooms.length) {
                // CORNER-FRIENDLY confinement (Coohom method): block a move only
                // when it would take the item's CENTRE outside the building. The
                // item's EDGES are allowed to overlap the walls freely, so a big
                // item (like a tall bookshelf) can be pushed FULLY into a corner
                // instead of stopping short. On release, __resolveFloorItemOffWalls
                // settles it flush beside the corner walls. Never trap an item
                // that is already outside (so it can always be dragged back in).
                const newInside = insideBuilding(location.x, location.z);
                if (!newInside) {
                  const cur = this.__selected.position;
                  const curInside = insideBuilding(cur.x, cur.z);
                  if (curInside) {
                    return;
                  }
                }
              }
            }

            if (
              this.__selected.__itemType == MODEL_TYPES.WALL_UNIT ||
              this.__selected.__itemType == MODEL_TYPES.IN_WALL_UNIT
            ) {
              // Allow VERTICAL (height) dragging of wall items, not just
              // horizontal sliding. `location` is the raycast hit on the
              // wall plane, so location.y is already the cursor's height on
              // the wall — previously we overwrote it with the item's
              // current Y, hard-locking the height. Instead, keep the
              // cursor's Y but CLAMP it so the whole item stays on the wall
              // (can't sink below the floor or poke above the ceiling).
              const dragWall =
                intersectingPlane?.wall || intersectingPlane?.edge?.wall;
              const wallHeight =
                dragWall?.height ??
                dragWall?.startElevation ??
                dragWall?.endElevation ??
                250;
              const halfY =
                this.__selected.__itemModel?.__halfSize?.y ?? 0;
              const minY = halfY;
              const maxY = Math.max(halfY, wallHeight - halfY);
              location.y = Math.min(Math.max(location.y, minY), maxY);
            }
            // SnapEngine (Phase 1): if the cursor is close to a wall or grid
            // line, override `location` with the snapped position. Holding
            // Shift bypasses snapping for this tick.
            try {
              const floorplan =
                BlueprintInterface?.blueprint3d?.model?.__floorplan;
              const snap = this.__snapManager.query({
                dragged: this.__selected,
                candidate: location,
                candidateNormal: normal,
                intersectingPlane,
                floorplan,
                draggableItems: this.__draggableItems,
                shiftHeld: this.__shiftHeld,
              });
              if (snap?.position) {
                location.copy(snap.position);
              }
              // Mark the item when this position came from a WALL snap. A wall
              // snap sits the item flush against the wall, so its polygon edge
              // lands right on the room's interior boundary — the strict
              // "fully inside the room" test in handleFloorItemsPositioning
              // would otherwise reject it on some walls. The flag tells that
              // code to trust the snap instead of rejecting it.
              this.__selected.__activeWallSnap = snap?.kind === "wall";
              // Mark the item when this position came from an OBJECT snap
              // (edge/centre against another item). The SnapEngine already
              // computed a clean flush position for all four faces; the legacy
              // corner-based collision alignment in handleFloorItemsPositioning
              // is one-sided and would override it. The flag tells that code to
              // keep the snap instead.
              this.__selected.__activeObjectSnap =
                snap?.kind === "objectEdge" || snap?.kind === "objectCenter";
              // (Auto-orient removed: rotating the item mid-snap changed its
              // footprint and destabilised corner/floor placement. Rotation is
              // manual again; the snap's `normal` field below is left unused.)
              // Surface stacking: if the item's centre is over another item,
              // rest it ON TOP (flower pot on a table). Queried separately
              // because it only affects the resting HEIGHT, not X/Z. `location`
              // here already includes any wall/object X/Z snap. When there's no
              // support, both are cleared so the item drops back to the floor.
              const support = this.__snapManager.querySupport({
                dragged: this.__selected,
                candidate: location,
                draggableItems: this.__draggableItems,
                shiftHeld: this.__shiftHeld,
              });
              this.__selected.__restPivotY = support ? support.restPivotY : null;
              this.__selected.__supportItem = support ? support.item : null;
              // Phase 3: draw a guide line showing what we snapped to.
              // Holding Shift returns no snap, so the indicator hides.
              if (snap && this.__selected?.parent) {
                this.__snapIndicator.show(this.__selected.parent, snap);
              } else {
                this.__snapIndicator.hide();
              }
            } catch (snapErr) {
              // Never let a snap glitch break drag — log and continue.
              this.__snapIndicator?.hide();
              console.warn(
                "SnapEngine.query failed during drag — ignoring",
                snapErr
              );
            }
            // SMOOTH MOVE: ease the item TOWARD the (snapped) target each frame
            // instead of teleporting straight to it — so it glides fluidly and
            // eases into walls/corners instead of jumping. The raw target is
            // kept so __releaseListener can land the item EXACTLY on release.
            this.__selected.__dragRawTarget = {
              location: location.clone(),
              normal: normal && normal.clone ? normal.clone() : normal,
              intersectingPlane,
            };
            const smoothed = this.__selected.position
              .clone()
              .lerp(location, DRAG_FOLLOW);
            this.__selected.snapToPoint(smoothed, normal, intersectingPlane);
            if (this.__selected.__itemType != 1) {
              //this.magnetEffect(this.__selected, "wall");
            }
            this.__selected.userData.currentPosition.copy(
              this.__selected.position
            );
          }
        }

        //console.log(this.__allowDragging,'this.this.__allowDragging()');
        this.dispatchEvent({ type: EVENT_ITEM_MOVE, item: this.__selected });
        // if(!this.checkThreshold()){
        //     this.__selected.isDrag=true;
        // this.dispatchEvent({ type: EVENT_ITEM_MOVE, item: this.__selected });
        // } else {
        //     console.log(this.__selected.position,'cmg here after touching');
        //     this.__selected.position.x +=0.1;
        //     // this.__selected.userData.currentPosition.copy(this.__selected.position);
        //     // this.__selected.isDrag=false;
        //     // this.dispatchEvent({ type: EVENT_ITEM_MOVE, item: this.__selected });
        // }
        return;
      }
    }

    if (IS_TOUCH_DEVICE) {
      return;
    }

    this.__intersections.length = 0;
    this.__raycaster.setFromCamera(this.__mouse, this.__camera);
    this.__raycaster.intersectObjects(
      this.__draggableItems,
      false,
      this.__intersections
    );

    if (this.__intersections.length) {
      let object = this.__intersections[0].object;
      this.__plane.setFromNormalAndCoplanarPoint(
        this.__camera.getWorldDirection(this.__plane.normal),
        this.__worldPosition.setFromMatrixPosition(object.matrixWorld)
      );
      if (this.__hovered !== object) {
        this.__hovered = object;
        this.__domElement.style.cursor = "pointer";
        this.dispatchEvent({ type: EVENT_ITEM_HOVERON, item: this.__hovered });
        this.__setHoverHighlight(object); // cyan hover outline
      }
      // An item is under the cursor → it takes priority over walls/floors.
      this.__clearSurfaceHover();
    } else {
      if (this.__hovered !== null) {
        this.__domElement.style.cursor = "auto";
        this.dispatchEvent({ type: EVENT_ITEM_HOVEROFF, item: this.__hovered });
        this.__hovered = null;
        this.__setHoverHighlight(null); // clear hover outline
      }
      // No item under the cursor → check the VISIBLE walls / floors for hover.
      this.__setSurfaceHoverHighlight();
    }
  }

  dispose() {
    this.deactivate();
  }

  __rotateItem(evt) {
    evt.item.rotation._x = evt.x;
  }

  checkThreshold(evt) {
    let items = this.__draggableItems;
    //console.log(items,'items');
    // console.log(this.__selected.intersectionPlanes,'this.__selected.intersectionPlanes;');
    // console.log(this.__floors,'__floors');
    //     if(this.__selected && this.__selected.uuid){
    //    // console.log(this.__selected,items,'this.__selected,items');
    //     const intersects = this.__raycaster.intersectObjects([...items], false);
    //     console.log(intersects,'intersects');
    //     if(intersects.length==0){
    //         this.__allowDragging=false;
    //     } else {
    //         this.__allowDragging=true;
    //     }
    // console.log(intersects,'intersects');
    if (this.__selected && this.__selected.uuid) {
      for (let i = 0; i < items.length; i++) {
        if (this.__selected.uuid != items[i].uuid) {
          this.checkCollision(this.__selected, items[i], evt);
        }
      }
    }
  }

  checkThresholdAndSetPosition(evt) {
    let items = this.__draggableItems;
    if (this.__selected && this.__selected.uuid) {
      const intersects = this.__raycaster.intersectObjects([...items], false);
      if (intersects.length) {
        let intersectionData = intersects[0];
        console.log(intersectionData, "checkThresholdAndSetPosition");
      }
      // console.log(intersects,'intersects');}
      // for (let i = 0; i < items.length; i++) {
      //     if(this.__selected.uuid != items[i].uuid){
      //      this.checkCollision(this.__selected,items[i]);
      //     }
      // }
    }
  }

  checkDirectionDrag(deltaX) {
    return deltaX > 0 ? "right" : "left";
  }

  checkCollision(draggedModel1, model2, evt) {
    //console.log(evt,'e.pageX');
    const box1 = new Box3().setFromObject(draggedModel1);
    const box2 = new Box3().setFromObject(model2);

    if (box2.intersectsBox(box1)) {
      console.debug(
        "DEBUG: checkCollision -> collision detected at distance ",
        box2.min.distanceTo(box1.min)
      );
      // console.log(this.__lastInterectionPoint.z,draggedModel1,'drag disable');
      //this.__allowDragging = false;

      // // let rect = this.__domElement.getBoundingClientRect();
      // // this.__mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      // // this.__mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
      //setTimeout(() => {
      if (!this.__allowDragging && this.__lastInterectionPoint) {
        let calcZaxis = 0;
        let location = { ...this.__lastInterectionPoint };
        //  console.log(location.z,'location z');
        const deltaX = evt.clientX - this.__intialModelMovementParams.startX;
        console.debug(deltaX, "deltaX");
        if (this.checkDirectionDrag(deltaX) == "right") {
          console.debug("right");
          calcZaxis = this.__lastInterectionPoint.z + 50;
        } else {
          console.debug("left");
          calcZaxis = this.__lastInterectionPoint.z - 50;
        }
        location.z = calcZaxis;
        console.debug(calcZaxis, "calcZaxis");
        console.debug(
          location,
          this.__lastInterectionPointNormal,
          this.__lastInterectionPointObjet,
          "location"
        );
        this.__selected.snapToPoint(
          location,
          this.__lastInterectionPointNormal,
          this.__lastInterectionPointObjet
        );
      }
      //}, 200);
    } else {
      this.__allowDragging = true;
    }
  }

  //  checkClosestDistance(model1,model2) {
  //     // Get the vertices of both models
  //     const verticesModel1 = this.getVertices(model1);
  //     const verticesModel2 = this.getVertices(model2);
  //     // Find the closest distance between the vertices of the two models
  //     let minDistance = Number.MAX_VALUE;
  //     verticesModel1.forEach(vertex1 => {
  //       verticesModel2.forEach(vertex2 => {
  //         const distance = vertex1.distanceTo(vertex2);
  //         minDistance = Math.min(minDistance, distance);
  //       });
  //     });
  //     console.log('Closest distance between models:', minDistance);
  //   }

  /* magnetEffect */
  magnetEffect(selected, type) {
    console.debug("Drag -> magnetEffect -> type", selected, type);
    let scope = this;
    let itemsList = scope.__draggableItems;
    let dirx = new Vector3(-1, 0, 0);
    let dirz = new Vector3(0, 0, -1);
    let dirx1 = new Vector3(1, 0, 0);
    let dirz1 = new Vector3(0, 0, 1);
    let diry = new Vector3(0, -1, 0);
    let diry1 = new Vector3(0, 1, 0);
    if (type == "floor") {
      itemsList = itemsList.filter(function (el) {
        return el.__itemType === "1";
      });
      scope.snapItemEffect(selected, dirx, itemsList, "x", 1);
      scope.snapItemEffect(selected, dirx1, itemsList, "x", -1);
      scope.snapItemEffect(selected, dirz, itemsList, "z", 1);
      scope.snapItemEffect(selected, dirz1, itemsList, "z", -1);
    } else {
      let itemModel = selected.itemModel;
      let normal = itemModel.__currentWallNormal;
      if (!itemModel.__currentWallEdge) {
        return new Vector3();
      }
      if (!itemModel.__currentWallNormal) {
        normal = itemModel.__currentWallEdge.normal.clone().normalize();
      }
      let normalarray = normal.toArray();
      normalarray = normalarray.map(Math.abs);
      itemsList = itemsList.filter(function (el) {
        return el.__itemType === "2";
      });
      scope.snapItemEffectWall(selected, diry, itemsList, "y", 1);
      scope.snapItemEffectWall(selected, diry1, itemsList, "y", -1);
      if (normalarray.indexOf(1) == 0) {
        scope.snapItemEffectWall(selected, dirz, itemsList, "z", 1);
        scope.snapItemEffectWall(selected, dirz1, itemsList, "z", -1);
      } else {
        scope.snapItemEffectWall(selected, dirx, itemsList, "x", 1);
        scope.snapItemEffectWall(selected, dirx1, itemsList, "x", -1);
      }
    }
  }

  snapItemEffect(selected, dir, itemsList, axis, sign) {
    let scope = this;
    let size1 = selected.itemModel.halfSize;
    let offset = 0;
    if (axis == "x") {
      offset = size1.x;
    } else {
      offset = size1.z;
    }
    let position = selected.position;

    scope.__raycaster.set(position, dir);
    let distance = scope.__raycaster.intersectObjects(itemsList, false);
    if (distance.length) {
      if (distance[0].distance < offset) {
        let obj = distance[0].object;
        let size = obj.itemModel.halfSize;
        let pos = obj.position.clone();
        if (axis == "x") {
          pos.x = pos.x + size.x * sign + size1.x * sign;
        } else {
          pos.z = pos.z + size.z * sign + size1.z * sign;
        }
        pos.y = selected.location.y;
        selected.location = pos;
      }
    }
  }

  snapItemEffectWall(selected, dir, itemsList, axis, sign) {
    let scope = this;
    let size1 = selected.itemModel.halfSize;
    let offset = 0;
    let position = selected.position;
    if (axis == "x") {
      offset = size1.x;
    } else if (axis == "z") {
      offset = size1.x;
    } else {
      offset = size1.y;
    }
    scope.__raycaster.set(position, dir);
    let distance = scope.__raycaster.intersectObjects(itemsList, false);
    if (distance.length) {
      if (distance[0].distance < offset) {
        let obj = distance[0].object;
        let size = obj.itemModel.halfSize;
        let pos = obj.position.clone();
        if (axis == "x") {
          pos.x = pos.x + size.x * sign + size1.x * sign;
        } else if (axis == "z") {
          pos.z = pos.z + size.x * sign + size1.x * sign;
        } else {
          pos.y = pos.y + size.y * sign + size1.y * sign;
        }
        selected.location = pos;
      }
    }
  }
  /* End magnetEffect */

  activate() {
    this.__domElement.addEventListener(
      "mousedown",
      this.__pressListenerEvent,
      false
    );
    this.__domElement.addEventListener(
      "touchstart",
      this.__pressListenerEvent,
      false
    );

    this.__domElement.addEventListener(
      "mousemove",
      this.__moveListenerEvent,
      false
    );
    this.__domElement.addEventListener(
      "touchmove",
      this.__moveListenerEvent,
      false
    );

    this.__domElement.addEventListener(
      "hoveron",
      this.__hoverListenerEvent,
      false
    );
    this.__domElement.addEventListener(
      "hoveroff",
      this.__hoverListenerEvent,
      false
    );

    this.__domElement.addEventListener(
      "mouseup",
      this.__releaseListenerEvent,
      false
    );
    // this.__domElement.addEventListener('mouseleave', this.__releaseListenerEvent, false);//Not necessary
    this.__domElement.addEventListener(
      "touchend",
      this.__releaseListenerEvent,
      false
    );
  }

  deactivate() {
    // Drop any move queued for the next frame — without this a pending
    // callback can run after teardown and touch a disposed scene.
    if (this.__moveFrame != null) {
      cancelAnimationFrame(this.__moveFrame);
      this.__moveFrame = null;
    }
    this.__pendingMove = null;
    this.__domElement.removeEventListener(
      "mousedown",
      this.__pressListenerEvent,
      false
    );
    this.__domElement.removeEventListener(
      "touchstart",
      this.__pressListenerEvent,
      false
    );

    this.__domElement.removeEventListener(
      "mousemove",
      this.__moveListenerEvent,
      false
    );
    this.__domElement.removeEventListener(
      "touchmove",
      this.__moveListenerEvent,
      false
    );

    this.__domElement.removeEventListener(
      "mouseup",
      this.__releaseListenerEvent,
      false
    );
    // this.__domElement.removeEventListener('mouseleave', this.__releaseListenerEvent, false);//Not necessary
    this.__domElement.removeEventListener(
      "touchend",
      this.__releaseListenerEvent,
      false
    );

    this.__domElement.style.cursor = "";

    // Tear down the snap guide line and its geometry/material.
    this.__snapIndicator?.dispose();
  }

  get enabled() {
    return this.__enabled;
  }

  set enabled(flag) {
    this.__enabled = flag;
  }

  get draggableItems() {
    return this.__draggableItems;
  }

  set draggableItems(items) {
    this.__draggableItems = items;
  }
}
