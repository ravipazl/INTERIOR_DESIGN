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
import {
  isKitchenCabinetModel,
  isWallUnitModel,
  wallUnitTopCm,
} from "@pazl/react-app/roomTemplates/wallUnitPlacement";
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
 * Which click picks what on a 3D item.
 *
 *   true  - a click picks the PART under the mouse (a door, a drawer front) and
 *           a double-click picks the whole object.
 *   false - the reverse: a click picks the whole object, a double-click a part.
 *
 * Dragging always moves the whole object either way; this only decides what a
 * click that did not move announces. The announcement is a window event
 * ("pazl:part-pick") that the Components panel turns into an open row and the
 * quick-action popup.
 */
export const CLICK_SELECTS_PART = true;

// A press and release closer than this (px) is a click; anything further is a
// drag, and a drag never picks a part.
const CLICK_MOVE_TOLERANCE_PX = 5;
const DOUBLE_TAP_MS = 350;

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
    // Part hover (see __setPartHoverHighlight): drawn over the model, so the
    // outline of a thin part (a handle) is never hidden by its own faces.
    this.__partHoverMaterial = new LineBasicMaterial({
      color: 0x00e5ff,
      depthTest: false,
      transparent: true,
    });
    this.__hoveredPart = null;
    this.__partOutline = null;
    /** geometry uuid → its outline edges, so a part's edges are built once. */
    this.__partEdgesCache = new Map();
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
    this.__dblClickListenerEvent = this.__dblClickListener.bind(this);
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

  /**
   * The PART (mesh) of `phys` under the cursor — the very rule a click uses to
   * pick a part (__emitPick), so what lights up on hover is what a click picks.
   * Null while the model is still loading or when nothing inside it is hit.
   */
  __partUnderCursor(phys) {
    if (!phys || !phys.__loadedItem) return null;
    const hit = this.__raycaster
      .intersectObject(phys.__loadedItem, true)
      .find((h) => h.object && h.object.isMesh && h.object.visible);
    return hit ? hit.object : null;
  }

  /**
   * Outline ONE part of an item (its real edges, like the wall/floor hover) so
   * the user sees exactly which part a click will select. Rebuilt only when the
   * part under the cursor changes; otherwise just kept on the part (it may move).
   * Pass null to clear.
   */
  __setPartHoverHighlight(mesh) {
    try {
      if (mesh === this.__hoveredPart) {
        if (this.__partOutline && mesh) {
          mesh.updateWorldMatrix(true, false);
          this.__partOutline.matrix.copy(mesh.matrixWorld);
        }
        return;
      }
      this.__clearPartHover();
      if (!mesh || !mesh.geometry) return;
      let root = mesh;
      while (root.parent) root = root.parent;
      let edges = this.__partEdgesCache.get(mesh.geometry.uuid);
      if (!edges) {
        // 20°: box edges and real creases only, not every facet of a curved part.
        edges = new EdgesGeometry(mesh.geometry, 20);
        this.__partEdgesCache.set(mesh.geometry.uuid, edges);
      }
      mesh.updateWorldMatrix(true, false);
      const outline = new LineSegments(edges, this.__partHoverMaterial);
      outline.matrixAutoUpdate = false;
      outline.matrix.copy(mesh.matrixWorld);
      outline.renderOrder = 9999;
      outline.raycast = () => {}; // never hit by picking
      root.add(outline);
      this.__partOutline = outline;
      this.__hoveredPart = mesh;
      this.__requestRender();
    } catch (e) {
      // Hover highlight is cosmetic — never let it break interaction.
    }
  }

  __clearPartHover() {
    try {
      if (this.__partOutline && this.__partOutline.parent) {
        this.__partOutline.parent.remove(this.__partOutline);
        this.__requestRender();
      }
    } catch (e) {
      // cosmetic
    }
    // The edges geometry stays cached for the next hover of the same part.
    this.__partOutline = null;
    this.__hoveredPart = null;
  }

  __requestRender() {
    const bp = BlueprintInterface && BlueprintInterface.blueprint3d;
    const v = bp && (bp.roomplanner || bp.viewer3d);
    if (v) v.needsUpdate = true;
  }

  // The VISIBLE wall/floor meshes (correct shape) — NOT the giant invisible
  // click-planes. Walls: each Edge3D.planes; floors: each Floor3D.floorPlane.
  /**
   * ONLY WHAT THE USER CAN ACTUALLY ACT ON IS PICKABLE.
   *
   * Two separate reasons something must not be clickable, because the engine
   * has two separate kinds of object here:
   *
   * 1. DRAWN meshes (furniture, the wall and floor surfaces you see). three.js
   *    does not skip invisible objects when raycasting — Raycaster's
   *    intersectObject tests `layers` and nothing else (three 0.118) — so a
   *    hidden room's furniture still showed a pointer cursor and a hover
   *    outline over what looked like empty floor. Parents are walked too,
   *    because hiding a Physical3DItem leaves its children visible=true: they
   *    are invisible only by inheritance, which raycasting does not follow.
   *
   * 2. PICKING planes (room.floorPlane, halfEdge.plane). These are NOT the
   *    meshes you see; they are invisible by material and marked visible=true
   *    on purpose so the raycaster finds them. No visibility test can ever
   *    exclude them, so they are judged on which room they belong to instead.
   *
   * With no room focused both tests pass everything they did before.
   */
  __pickable(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((o) => {
      if (!o) return false;
      let node = o;
      while (node) {
        if (node.visible === false) return false;
        node = node.parent;
      }
      return BlueprintInterface?.pickableUnderFocus?.(o) !== false;
    });
  }

  // The room whose CEILING is under the pointer, seen from below — or null.
  // The ceiling is drawn one-sided, facing down into the room, so the ray
  // only meets it from inside; from above (the ceiling hidden or not) there
  // is nothing to hit. Never allowed to break a click.
  __ceilingRoomAtMouse() {
    try {
      const bp = BlueprintInterface && BlueprintInterface.blueprint3d;
      const v = bp && (bp.roomplanner || bp.viewer3d);
      const floors = ((v && v.floors3d) || []).filter(
        (f) => f && f.roofPlane && f.room
      );
      if (!floors.length) return null;
      const roofs = this.__pickable(floors.map((f) => f.roofPlane));
      if (!roofs.length) return null;
      this.__raycaster.setFromCamera(this.__mouse, this.__camera);
      const hits = this.__raycaster.intersectObjects(roofs, true);
      // Looking UP at it: the camera is under the ceiling.
      if (!hits.length || !(this.__camera.position.y < hits[0].point.y)) return null;
      // The panel hit may be one of the ceiling's areas, a child of its roof.
      let node = hits[0].object;
      while (node && !roofs.includes(node)) node = node.parent;
      const floor = floors.find((f) => f.roofPlane === node);
      if (!floor) return null;
      return {
        room: floor.room,
        point: hits[0].point,
        normal: hits[0].face ? hits[0].face.normal : null,
      };
    } catch (e) {
      return null;
    }
  }

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
    return this.__pickable(meshes);
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
    // A SECOND FINGER makes this a camera gesture (pinch / two-finger pan), not
    // a drag: let go of any item the first finger picked up, in place.
    if (evt.touches && evt.touches.length > 1) {
      evt.preventDefault();
      this.__twoFingers = true;
      this.__pendingMove = null;
      if (this.__selected) {
        const item = this.__selected;
        item.__dragRawTarget = null;
        this.__selected = null;
        this.dispatchEvent({ type: EVENT_ITEM_MOVE_FINISH, item });
      }
      return;
    }
    const pressed = evt.changedTouches !== undefined ? evt.changedTouches[0] : evt;
    let rect = this.__domElement.getBoundingClientRect();
    // A FINGER HAS NO HOVER. __mouse is otherwise only updated by moves, so a
    // mouse has always told us where it is before the press. A finger lands
    // with no move first, so the pick below tested wherever the last touch
    // ended: the item under the finger was missed and the camera turned instead.
    if (evt.changedTouches !== undefined) {
      this.__mouse.x = ((pressed.clientX - rect.left) / rect.width) * 2 - 1;
      this.__mouse.y = -((pressed.clientY - rect.top) / rect.height) * 2 + 1;
    }
    this.dispatchEvent({
      type: EVENT_MOVED_DRAG,
      event: evt,
    });
    // A press may start a drag, which moves the whole item: drop the part
    // outline so it isn't left floating where the part used to be.
    this.__setPartHoverHighlight(null);
    this.__allowDragging = true;
    this.__intialModelMovementParams = {
      startX: pressed.clientX,
      startY: pressed.clientY,
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
    this.__pressPoint = { x: evt.clientX, y: evt.clientY };

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
      // A new drag: a wall unit's held height is read from where it is now.
      this.__selected.__wallUnitSnapTop = undefined;
      // …and where the pointer holds the item is measured afresh.
      this.__grabOffset = null;
      this.__rememberSpots(this.__selected);

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
      // A finger on an item holds the camera still from the very start. Moves
      // arrive once per frame here but straight away in OrbitControls, so
      // otherwise the view turned a little before the item began to move.
      if (evt.identifier !== undefined) {
        this.dispatchEvent({ type: EVENT_ITEM_MOVE, item: this.__selected });
      }
      return;
    }
    //if (deltaTime < 300) {
    this.dispatchEvent({ type: EVENT_NO_ITEM_SELECTED, item: this.__selected });
    this.__allowDragging = true;
    // //}
  }

  /**
   * Double-click on an item: the other half of CLICK_SELECTS_PART. The browser
   * has already delivered two ordinary clicks by now (so in the default mode the
   * part lit up for an instant); this upgrades the pick.
   */
  __dblClickListener(evt) {
    try {
      if (this.__transformGroup) return;
      const visible = this.__draggableItems.filter((d) => d && d.visible);
      this.__raycaster.setFromCamera(this.__mouse, this.__camera);
      const hits = this.__raycaster.intersectObjects(visible, false);
      if (!hits.length) return;
      this.__emitPick(
        hits[0].object,
        CLICK_SELECTS_PART ? "whole" : "part",
        evt.clientX,
        evt.clientY
      );
    } catch (e) {
      // never let a double-click break the scene
    }
  }

  /**
   * Tell the UI what a click picked.
   *
   * For a part, the ray is cast again INTO the item's loaded model (the item
   * itself is hit as one box, which is why a click has always selected the whole
   * thing). The names of the hit mesh and its parents are sent, nearest first;
   * the Components panel matches them against each part's meshName (Mesh_0…N).
   * No hit inside the model (still loading, one-piece model) falls back to the
   * whole object.
   *
   * Also left on window.__pazlLastPartPick, because the click that FIRST
   * selects an item arrives before the panel that listens for it has mounted.
   */
  __emitPick(item, mode, clientX, clientY) {
    if (!item || this.__transformGroup) return;
    const names = [];
    if (mode === "part" && item.__loadedItem) {
      this.__raycaster.setFromCamera(this.__mouse, this.__camera);
      const hit = this.__raycaster
        .intersectObject(item.__loadedItem, true)
        .find((h) => h.object && h.object.isMesh && h.object.visible);
      for (let o = hit && hit.object; o && o !== item; o = o.parent) {
        if (o.name) names.push(o.name);
      }
    }
    const detail = {
      mode: mode === "part" && names.length ? "part" : "whole",
      names,
      itemId: item.__itemModel && item.__itemModel.__id,
      clientX,
      clientY,
      t: Date.now(),
    };
    window.__pazlLastPartPick = detail;
    window.dispatchEvent(new CustomEvent("pazl:part-pick", { detail }));
  }

  __releaseListener(evt) {
    console.debug(
      "DragRoomItemsControl3D.js ~ __releaseListener ~ release the drag",
      evt
    );
    // The end of a two-finger camera gesture is not a tap on whatever is under
    // the fingers. Wait until the last finger has lifted.
    if (this.__twoFingers) {
      evt.preventDefault();
      if (!evt.touches || evt.touches.length === 0) this.__twoFingers = false;
      return;
    }
    this.__allowDragging = true;
    // The drag is over — clear the snap guide line.
    this.__snapIndicator?.hide();
    this.__showBackLabel(false);

    let time = Date.now();
    //  this.checkThresholdAndSetPosition();
    let deltaTime = time - this.__releasetimestamp;
    this.__releasetimestamp = time;
    evt.preventDefault();
    if (this.__selected) {
      // Released where it was pressed: that was a click, not a drag. Announce
      // which part of the item was clicked. Runs before the landing code below
      // and changes nothing about it — a click never moved the item anyway.
      try {
        const pt =
          evt.changedTouches !== undefined ? evt.changedTouches[0] : evt;
        const p0 = this.__pressPoint;
        if (
          p0 &&
          pt &&
          Math.hypot(pt.clientX - p0.x, pt.clientY - p0.y) <
            CLICK_MOVE_TOLERANCE_PX
        ) {
          this.__emitPick(
            this.__selected,
            CLICK_SELECTS_PART ? "part" : "whole",
            pt.clientX,
            pt.clientY
          );
          // The press cancels the browser's own dblclick on a touch screen, so
          // a double-tap has to be recognised here.
          if (evt.changedTouches !== undefined) {
            if (time - (this.__lastTapTime || 0) < DOUBLE_TAP_MS) {
              this.__dblClickListener(pt);
              this.__lastTapTime = 0;
            } else {
              this.__lastTapTime = time;
            }
          }
        }
      } catch (e) {
        // The pick is a UI shortcut — it must never break a release.
      }
      // Land EXACTLY on the last target: the smooth-move trail (above) may leave
      // the item a hair short of where the user aimed, so snap it precisely onto
      // the final target before any wall-cleanup runs.
      try {
        const t = this.__selected.__dragRawTarget;
        if (t && t.location) {
          this.__selected.snapToPoint(t.location, t.normal, t.intersectingPlane);
        }
        // Only a real drag settles a cabinet: this release also runs for a plain
        // click, and clicking a cabinet must never move it. Nor does one that
        // came back to its old spot: that spot is exactly where it belongs.
        this.__selected.__settleCabinet = !!t && !this.__selected.__wentBack;
        this.__selected.__dragRawTarget = null;
      } catch (e) {
        /* non-fatal — fall through to the wall-cleanup below */
      }
      // The next drag reads the wall unit's height afresh (it may have been
      // typed in the Properties panel since).
      if (this.__selected) this.__selected.__wallUnitSnapTop = undefined;
      // Settle a floor item flush beside any wall it was dropped straddling
      // (free dragging is allowed during the drag; overlap is cleaned up here).
      try {
        const resolved = this.__resolveFloorItemOffWalls(this.__selected);
        // A kitchen cabinet then closes a small gap to the cabinet beside it.
        const closed = this.__closeCabinetGap(this.__selected, resolved);
        const settled = closed || resolved;
        if (settled && this.__selected.__itemModel) {
          this.__selected.__itemModel.position = settled;
        }
      } catch (e) {
        console.warn("release resolve off walls failed", e);
      }
      // A WALL UNIT settles exactly flush as well: its back on the wall, and
      // its side against the end wall when brought within 3 cm of a corner.
      try {
        const flush = this.__settleWallUnit(this.__selected);
        if (flush && this.__selected.__itemModel) {
          this.__selected.__itemModel.position = flush;
        }
      } catch (e) {
        console.warn("release settle wall unit failed", e);
      }
      this.dispatchEvent({
        type: EVENT_ITEM_MOVE_FINISH,
        item: this.__selected,
      });
      this.__selected = null;
    } else {
      const isTouch = evt.changedTouches !== undefined;
      evt = isTouch ? evt.changedTouches[0] : evt;
      if (isTouch) {
        // Lifting a finger that turned the view is not a tap on what it ended
        // over, and it leaves no hover behind to clear later.
        this.__clearPartHover();
        const p0 = this.__pressPoint;
        if (
          p0 &&
          Math.hypot(evt.clientX - p0.x, evt.clientY - p0.y) >=
            CLICK_MOVE_TOLERANCE_PX
        ) {
          return;
        }
      }
      this.__raycaster.setFromCamera(this.__mouse, this.__camera);
      let wallPlanesThatIntersect = this.__raycaster.intersectObjects(
        this.__pickable(this.__walls),
        false
      );
      console.debug("Release Listener: floors", this.__floors);
      let floorPlanesThatIntersect = this.__raycaster.intersectObjects(
        this.__pickable(this.__floors),
        false
      );
      let ceilingHit = null;
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
      } else if ((ceilingHit = this.__ceilingRoomAtMouse())) {
        // The CEILING, seen from inside the room: it selects that room, so
        // Room Properties — and its Ceiling Editor — opens for it. Only a
        // click that used to hit nothing at all comes here.
        this.dispatchEvent({
          type: EVENT_ROOM_CLICKED,
          item: ceilingHit.room,
          point: ceilingHit.point,
          normal: ceilingHit.normal,
          ceiling: true,
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
      // The room's own inside wall faces when the item stands in a room; the
      // older wall-line estimate below only for an item in no room at all.
      const onRoomWalls = this.__settleOnRoomWalls(item);
      if (onRoomWalls !== undefined) return onRoomWalls;
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

  /**
   * A WALL UNIT, FLUSH: its real outline's back exactly on the wall it hangs
   * on, and — when within 3 cm of either end of that wall — its side exactly
   * against the end, so a unit pushed into a corner reads X = 0 / Z = 0 like a
   * base unit does. Further from an end than that, it stays where it is.
   * Returns the corrected position, or null when nothing needs to move.
   */
  __settleWallUnit(item) {
    const SNAP = 3; // cm
    if (!item || item.__itemType != MODEL_TYPES.WALL_UNIT) return null;
    if (this.__wallUnitSnapTopCm(item) === null) return null; // not a wall unit
    const model = item.__itemModel;
    const edge = model && model.__currentWallEdge;
    if (!edge || !model.position) return null;
    const a = edge.interiorStart();
    const b = edge.interiorEnd();
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1)) return null;
    const ux = (b.x - a.x) / len;
    const uz = (b.y - a.y) / len;
    // The normal into the room the unit hangs in.
    let nx = -uz;
    let nz = ux;
    const room = edge.room;
    const mx = (a.x + b.x) / 2;
    const mz = (a.y + b.y) / 2;
    if (room && typeof room.pointInRoom === "function") {
      if (!room.pointInRoom({ x: mx + nx * 2, y: mz + nz * 2 })) {
        nx = -nx;
        nz = -nz;
      }
    } else if ((model.position.x - mx) * nx + (model.position.z - mz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    if (typeof item.updateMatrixWorld === "function") item.updateMatrixWorld(true);
    const box = new Box3().setFromObject(item.__loadedItem || item);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
    let back = Infinity;
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const z of [box.min.z, box.max.z]) {
        const rx = x - a.x;
        const rz = z - a.y;
        back = Math.min(back, rx * nx + rz * nz);
        const t = rx * ux + rz * uz;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
    let dn = 0;
    let dt = 0;
    if (Math.abs(back) < SNAP && Math.abs(back) > 0.01) dn = -back;
    if (Math.abs(lo) < SNAP && Math.abs(lo) > 0.01) dt = -lo;
    else if (Math.abs(len - hi) < SNAP && Math.abs(len - hi) > 0.01) dt = len - hi;
    if (!dn && !dt) return null;
    const p = model.position.clone();
    p.x += ux * dt + nx * dn;
    p.z += uz * dt + nz * dn;
    return p;
  }

  /**
   * FLUSH AGAINST THE ROOM'S REAL INSIDE WALLS.
   *
   * The estimate above works the inside face out from the wall's corner line
   * and its thickness, then adds 1 cm of clearance — so depending on how the
   * walls were drawn, a cabinet dropped into a corner came to rest a few mm
   * off it, or a few mm into it (−4 / 14 mm), and the Properties panel, which
   * measures from the room's real inside corner, showed exactly that.
   *
   * Here the faces are the room's own (HalfEdge interiorStart → interiorEnd,
   * the same lines the panel measures from) and the item is its real outline
   * (the loaded model, not the selection box drawn around it). An item whose
   * outline is INTO a wall, or within SNAP cm of it, is moved so its outline
   * touches the face exactly — so a cabinet dropped into a corner reads
   * X = 0, Z = 0. An item further from a wall than that is left where it is.
   *
   * Returns the corrected position, null for "already right", or undefined
   * when the item stands in no room (the caller then uses the estimate).
   */
  __settleOnRoomWalls(item) {
    // A KITCHEN CABINET belongs against its wall, so a dragged one reaches
    // further: 30 cm to the wall behind it, 5 cm to one beside it (a corner unit
    // has both). Anything else, or a drop with Shift held, keeps the 3 cm.
    const facing = item.__settleCabinet
      ? this.__kitchenCabinetFacing(item)
      : null;
    const snapFor = (f) =>
      !facing
        ? 3
        : f.nx * facing.x + f.nz * facing.z > 0.7
        ? 30.01
        : 5;
    const fp = BlueprintInterface?.blueprint3d?.model?.__floorplan;
    const rooms = (fp && (fp.rooms || (fp.getRooms && fp.getRooms()))) || [];
    const at = { x: item.position.x, y: item.position.z };
    const room = rooms.find(
      (r) => r && typeof r.pointInRoom === "function" && r.pointInRoom(at)
    );
    if (!room || !room.edgePointer) return undefined;

    // The room's inside faces, each with the normal that points into it.
    const faces = [];
    let edge = room.edgePointer;
    let guard = 0;
    do {
      try {
        const a = edge.interiorStart();
        const b = edge.interiorEnd();
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 1) {
          const ux = (b.x - a.x) / len;
          const uz = (b.y - a.y) / len;
          let nx = -uz;
          let nz = ux;
          const mx = (a.x + b.x) / 2;
          const mz = (a.y + b.y) / 2;
          if (!room.pointInRoom({ x: mx + nx * 2, y: mz + nz * 2 })) {
            nx = -nx;
            nz = -nz;
          }
          faces.push({ ax: a.x, az: a.y, ux, uz, nx, nz, len });
        }
      } catch (e) {
        /* skip a malformed edge */
      }
      edge = edge.next;
      guard += 1;
    } while (edge && edge !== room.edgePointer && guard < 200);
    if (!faces.length) return undefined;

    // The item's real outline on the floor (the model, not its outline box).
    // Its world matrices are brought up to date first: the item has only just
    // been moved, and measuring the model alone reads its parent's matrix as
    // it was before the move — the outline of where the item USED to be.
    if (typeof item.updateMatrixWorld === "function") item.updateMatrixWorld(true);
    const box = new Box3().setFromObject(item.__loadedItem || item);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return undefined;
    let dx = 0;
    let dz = 0;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const xs = [box.min.x + dx, box.max.x + dx];
      const zs = [box.min.z + dz, box.max.z + dz];
      for (const f of faces) {
        // Nearest point of the outline to this face, and its reach along it.
        let gap = Infinity;
        let lo = Infinity;
        let hi = -Infinity;
        for (const x of xs) {
          for (const z of zs) {
            const rx = x - f.ax;
            const rz = z - f.az;
            gap = Math.min(gap, rx * f.nx + rz * f.nz);
            const t = rx * f.ux + rz * f.uz;
            lo = Math.min(lo, t);
            hi = Math.max(hi, t);
          }
        }
        // Only a wall the item is actually beside, and only when it is into
        // the wall or almost touching it — not one far across the room.
        if (hi <= 0 || lo >= f.len) continue;
        if (gap >= snapFor(f) || Math.abs(gap) < 0.01) continue;
        const depth = Math.max(
          Math.abs(f.nx) * (box.max.x - box.min.x) +
            Math.abs(f.nz) * (box.max.z - box.min.z),
          1
        );
        if (gap < -depth) continue; // across the wall, not into it
        dx -= gap * f.nx;
        dz -= gap * f.nz;
        moved = true;
        xs[0] = box.min.x + dx;
        xs[1] = box.max.x + dx;
        zs[0] = box.min.z + dz;
        zs[1] = box.max.z + dz;
      }
      if (!moved) break;
    }
    if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return null;
    const p = item.position.clone();
    p.x += dx;
    p.z += dz;
    return p;
  }

  /**
   * Which way a below-counter or tall unit faces, or null for any other item
   * (or while Shift is held, which places it freely). Its saved turn, in
   * degrees: 0 faces +Z.
   */
  __kitchenCabinetFacing(item) {
    try {
      if (!item || this.__shiftHeld) return null;
      if (parseInt(item.__itemType, 10) !== MODEL_TYPES.FLOOR_UNIT) return null;
      const record =
        BlueprintInterface?.ProjectManagerService?.getFurnishedModelById?.(
          item.__itemModel?.id
        );
      if (!record || !isKitchenCabinetModel(record.model || record)) return null;
      const turn = ((Number(record.rotation?.[1]) || 0) * Math.PI) / 180;
      return { x: Math.sin(turn), z: Math.cos(turn) };
    } catch (e) {
      return null; // never let the check break a drop
    }
  }

  /**
   * A kitchen cabinet let go within 10 cm of the one beside it closes the gap.
   * Only along the way the row runs, and only with a cabinet standing in the
   * same row (they share at least half their depth). `at` is where the item is
   * being settled to, or null for where it stands. Returns the new position, or
   * null when there is nothing to close.
   */
  __closeCabinetGap(item, at) {
    const REACH = 10; // cm
    if (!item.__settleCabinet) return null;
    const facing = this.__kitchenCabinetFacing(item);
    if (!facing) return null;
    // Square rooms only: on a slanted wall these outlines say nothing exact.
    const alongX = Math.abs(facing.z) > 0.99;
    if (!alongX && Math.abs(facing.x) <= 0.99) return null;

    const from = at || item.position;
    if (typeof item.updateMatrixWorld === "function") item.updateMatrixWorld(true);
    const mine = new Box3().setFromObject(item.__loadedItem || item);
    if (!isFinite(mine.min.x)) return null;
    mine.translate(from.clone().sub(item.position));
    const run = alongX ? "x" : "z";
    const across = alongX ? "z" : "x";

    let best = REACH;
    let shift = 0;
    (this.__draggableItems || []).forEach((other) => {
      if (other === item || other.visible === false) return;
      if (!this.__kitchenCabinetFacing(other)) return;
      const box = new Box3().setFromObject(other.__loadedItem || other);
      if (!isFinite(box.min.x)) return;
      const shared =
        Math.min(mine.max[across], box.max[across]) -
        Math.max(mine.min[across], box.min[across]);
      const depth = Math.min(
        mine.max[across] - mine.min[across],
        box.max[across] - box.min[across]
      );
      if (shared < depth / 2) return;
      const ahead = box.min[run] - mine.max[run];
      const behind = mine.min[run] - box.max[run];
      if (ahead > 0.01 && ahead <= best) {
        best = ahead;
        shift = ahead;
      }
      if (behind > 0.01 && behind <= best) {
        best = behind;
        shift = -behind;
      }
    });
    if (!shift) return null;
    const p = from.clone();
    p[run] += shift;
    return p;
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
    if (this.__twoFingers) return;
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

  /**
   * WHERE AN ITEM CAME FROM, so it can go back exactly.
   *
   * A drag ends wherever the mouse is, and nobody can hit a spot to the
   * millimetre by hand. Each item keeps two spots, on the 3D item itself, so
   * only while the page is open (a reload starts from the saved position):
   *
   *   home  where it was the first time it was picked up;
   *   last  where it was when this drag began.
   *
   * A spot only pulls once the item has been dragged clear of it: without that,
   * a small nudge of 30 mm would be snapped straight back and could never be
   * made. An item let go 30 mm from home can likewise still be nudged away.
   * Shift places it anywhere at all.
   */
  __rememberSpots(item) {
    const p = item.position;
    const spot = {
      x: p.x,
      y: p.y,
      z: p.z,
      wall: item.__itemModel?.__currentWall || null,
    };
    if (!item.__homeSpot) item.__homeSpot = spot;
    item.__lastSpot = spot;
    item.__armedSpots = [];
    item.__wentBack = false;
  }

  /**
   * Within 15 cm of a spot, the cursor's point becomes that spot. A wall item
   * measures along the wall and up it, on the same wall only (the wall's own
   * placement then gives it the same distance out, and the same facing). A floor
   * or ceiling item measures across the room; its height stays its own business
   * (the floor, or the table it rests on).
   */
  __snapBackToSpot(item, location, intersectingPlane) {
    item.__wentBack = false;
    const TOLERANCE_CM = 15;
    const type = parseInt(item.__itemType, 10);
    const onWall = [2, 3, 7, 9].includes(type);
    // These stand on the floor in their wall: only along it matters.
    const heightFree = !onWall || type === 7 || type === 9;
    const plane = intersectingPlane;
    const planeWall = plane?.wall || plane?.edge?.wall || null;
    const normal = plane?.edge?.normal || null;
    if (onWall && (!planeWall || !normal)) return false;

    const gapTo = (spot) => {
      if (onWall && spot.wall !== planeWall) return Infinity;
      let dx = spot.x - location.x;
      let dz = spot.z - location.z;
      if (onWall) {
        // Along the wall only: the spot stands out from the wall, the cursor
        // is on its face.
        const out = dx * normal.x + dz * normal.z;
        dx -= normal.x * out;
        dz -= normal.z * out;
      }
      const dy = heightFree ? 0 : spot.y - location.y;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    let best = null;
    let bestGap = TOLERANCE_CM;
    [item.__homeSpot, item.__lastSpot].forEach((spot) => {
      if (!spot) return;
      const gap = gapTo(spot);
      if (gap > TOLERANCE_CM) {
        if (!item.__armedSpots.includes(spot)) item.__armedSpots.push(spot);
      } else if (item.__armedSpots.includes(spot) && gap <= bestGap) {
        best = spot;
        bestGap = gap;
      }
    });
    if (!best) return false;
    location.x = best.x;
    location.z = best.z;
    if (!heightFree) location.y = best.y;
    item.__wentBack = true;
    return true;
  }

  /**
   * A wall unit lines up with the other wall units on its wall, within 5 cm:
   * the same top, and side by side with no gap.
   */
  __lineUpWallUnit(item, location, intersectingPlane) {
    if (parseInt(item.__itemType, 10) !== MODEL_TYPES.WALL_UNIT) return;
    const wall = intersectingPlane?.wall || intersectingPlane?.edge?.wall;
    const normal = intersectingPlane?.edge?.normal;
    const half = item.__itemModel?.__halfSize;
    if (!wall || !normal || !half) return;
    const TOLERANCE_CM = 5;
    const along = { x: -normal.z, z: normal.x };
    const alongOf = (p) => p.x * along.x + p.z * along.z;

    let bestTop = TOLERANCE_CM;
    let topY = null;
    let bestSide = TOLERANCE_CM;
    let shift = null;
    (this.__draggableItems || []).forEach((other) => {
      if (other === item || other.visible === false) return;
      if (parseInt(other.__itemType, 10) !== MODEL_TYPES.WALL_UNIT) return;
      if (other.__itemModel?.__currentWall !== wall) return;
      const otherHalf = other.__itemModel?.__halfSize;
      if (!otherHalf) return;

      const topGap = Math.abs(
        other.position.y + otherHalf.y - (location.y + half.y)
      );
      if (topGap <= bestTop) {
        bestTop = topGap;
        topY = other.position.y + otherHalf.y - half.y;
      }
      const reach = half.x + otherHalf.x;
      const apart = alongOf(location) - alongOf(other.position);
      const sideGap = Math.abs(Math.abs(apart) - reach);
      if (sideGap <= bestSide) {
        bestSide = sideGap;
        shift = (apart >= 0 ? reach : -reach) - apart;
      }
    });
    if (topY !== null) location.y = topY;
    if (shift !== null) {
      location.x += along.x * shift;
      location.z += along.z * shift;
    }
  }

  /** A small note by the cursor while the item is held at its old spot. */
  __showBackLabel(show) {
    try {
      if (!show) {
        if (this.__backLabel) this.__backLabel.style.display = "none";
        return;
      }
      if (!this.__backLabel) {
        const el = document.createElement("div");
        el.textContent = "Original position";
        el.style.cssText =
          "position:fixed;z-index:40;pointer-events:none;padding:2px 8px;" +
          "border-radius:4px;background:#111827;color:#fff;font-size:11px;";
        document.body.appendChild(el);
        this.__backLabel = el;
      }
      const rect = this.__domElement.getBoundingClientRect();
      this.__backLabel.style.left =
        rect.left + ((this.__mouse.x + 1) / 2) * rect.width + 14 + "px";
      this.__backLabel.style.top =
        rect.top + ((1 - this.__mouse.y) / 2) * rect.height + 14 + "px";
      this.__backLabel.style.display = "block";
    } catch (e) {
      /* only a note: never let it break a drag */
    }
  }

  /**
   * The studio's wall-unit top height (cm, 7 ft) when this item is a wall
   * unit, or null for any other item. Read once per drag (the record lookup
   * is not free), cleared on press and on release.
   *
   * A wall unit is a wall-mounted item whose catalogue product is in the
   * kitchen template's Wall Unit category (wallUnitPlacement.isWallUnitModel).
   */
  __wallUnitSnapTopCm(item) {
    if (!item) return null;
    if (item.__wallUnitSnapTop === undefined) {
      let top = null;
      try {
        const model = item.__itemModel;
        if (model && item.__itemType == MODEL_TYPES.WALL_UNIT) {
          const record =
            BlueprintInterface?.ProjectManagerService?.getFurnishedModelById?.(
              model.id
            );
          if (record && isWallUnitModel(record.model || record)) {
            top = wallUnitTopCm();
          }
        }
      } catch (e) {
        top = null; // never let the check break a drag
      }
      item.__wallUnitSnapTop = Number(top) > 0 ? Number(top) : null;
    }
    return item.__wallUnitSnapTop;
  }

  __processMove(evt) {
    // A locked item (the toolbar's Lock) can still be clicked and looked at,
    // it just doesn't move with the pointer.
    if (this.__selected && this.__selected.__pzLocked) return;
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
          // THE POINTER CAN BE OVER THE ITEM WHILE THE FLOOR UNDER IT IS NOT.
          // A tall unit near a wall is grabbed high up; the line through the
          // pointer meets floor level beyond the wall, off the room's floor, so
          // nothing was hit and the unit could not be moved at all from there.
          // Floor level is used instead; the room confinement below still keeps
          // the unit inside.
          if (
            !customPlanesThatIntersect.length &&
            this.__selected.__itemType == MODEL_TYPES.FLOOR_UNIT &&
            customIntersectingPlanes[0]
          ) {
            const floor = customIntersectingPlanes[0];
            floor.updateMatrixWorld();
            const floorY = new Vector3().setFromMatrixPosition(floor.matrixWorld).y;
            const point = new Vector3();
            if (
              this.__raycaster.ray.intersectPlane(
                new Plane(new Vector3(0, 1, 0), -floorY),
                point
              )
            ) {
              // Shaped like a hit on the floor plane itself (its own +Z is up).
              customPlanesThatIntersect = [
                { point, face: { normal: new Vector3(0, 0, 1) }, object: floor },
              ];
            }
          }

          /* PERF-REMOVED console.debug — ran on every pointer move */
          if (customPlanesThatIntersect.length) {
            let intersectionData = customPlanesThatIntersect[0];
            this.__intersection = intersectionData.point;
            let location = intersectionData.point;
            // KEEP THE ITEM WHERE IT WAS GRABBED. The pointer lands on the item
            // part-way up it, but the floor point under the pointer is further
            // away than the item's foot, so the first move threw the item about
            // a metre to that point. The gap between the two is taken at the
            // first move and kept for the whole drag. Floor planes only: a wall
            // item's height is held by its own rules below.
            // (The face normal is in the plane's own frame — a floor plane is
            // a rotated XY plane, so it reads +Z there — hence the world turn.)
            const upward =
              intersectionData.face &&
              intersectionData.face.normal
                .clone()
                .transformDirection(intersectionData.object.matrixWorld);
            if (upward && Math.abs(upward.y) > 0.9) {
              if (!this.__grabOffset) {
                this.__grabOffset = {
                  x: this.__selected.position.x - location.x,
                  z: this.__selected.position.z - location.z,
                };
              }
              location.x += this.__grabOffset.x;
              location.z += this.__grabOffset.z;
            }
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
              // Back where it came from wins over every other snap. Otherwise a
              // wall unit lines up with its neighbours on the wall.
              const snappingOn =
                this.__snapManager.active && !this.__shiftHeld;
              const wentBack =
                snappingOn &&
                this.__snapBackToSpot(this.__selected, location, intersectingPlane);
              this.__showBackLabel(wentBack);
              if (snappingOn && !wentBack) {
                this.__lineUpWallUnit(this.__selected, location, intersectingPlane);
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
                wentBack ||
                snap?.kind === "objectEdge" ||
                snap?.kind === "objectCenter";
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
            // A WALL UNIT DRAGS UP AND DOWN AS WELL AS ALONG THE WALL, and
            // settles at the studio's height (its top at 7 ft) when it comes
            // within 5 cm of it — so a unit moved by hand is easily put back
            // in line with the others. Holding Shift turns the snap off, as
            // it does every other snap. The clamp above already keeps it
            // between the floor and the ceiling.
            const snapTop = this.__wallUnitSnapTopCm(this.__selected);
            if (
              snapTop !== null &&
              !this.__shiftHeld &&
              !this.__selected.__wentBack
            ) {
              const halfY = this.__selected.__itemModel?.__halfSize?.y ?? 0;
              if (Math.abs(location.y + halfY - snapTop) <= 5) {
                location.y = snapTop - halfY;
              }
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
    // The press handler already filters by visibility; hover did not, so a
    // hidden room's furniture still showed a pointer cursor and a hover outline
    // over what looked like empty floor.
    this.__raycaster.intersectObjects(
      this.__pickable(this.__draggableItems),
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
      }
      // Hover shows the PART a click would pick. Only when there is no part to
      // show (model still loading, nothing hit inside it) does the whole item
      // get the cyan outline instead.
      const part = CLICK_SELECTS_PART ? this.__partUnderCursor(object) : null;
      if (part) {
        if (this.__hoveredPhysical) this.__setHoverHighlight(null);
        this.__setPartHoverHighlight(part);
      } else {
        this.__setPartHoverHighlight(null);
        if (this.__hoveredPhysical !== object) this.__setHoverHighlight(object); // cyan hover outline
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
      this.__setPartHoverHighlight(null);
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
      "dblclick",
      this.__dblClickListenerEvent,
      false
    );
    this.__domElement.addEventListener(
      "touchend",
      this.__releaseListenerEvent,
      false
    );
    // The system can take a touch back (a palm, an edge swipe). Treat it as a
    // release, or the item stays stuck to a finger that has gone.
    this.__domElement.addEventListener(
      "touchcancel",
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
    this.__clearPartHover();
    this.__partEdgesCache.forEach((edges) => edges.dispose());
    this.__partEdgesCache.clear();
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
      "dblclick",
      this.__dblClickListenerEvent,
      false
    );
    this.__domElement.removeEventListener(
      "touchend",
      this.__releaseListenerEvent,
      false
    );
    this.__domElement.removeEventListener(
      "touchcancel",
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
