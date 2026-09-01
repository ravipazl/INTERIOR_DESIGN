import {
  TrackballControls,
  LoadingManager,
  WebGLRenderer,
  ImageUtils,
  PerspectiveCamera,
  OrthographicCamera,
  AxesHelper,
  ArrowHelper,
  Scene,
  RGBFormat,
  LinearMipmapLinearFilter,
  sRGBEncoding,
  Vector3,
  Box3,
  Matrix4,
  MeshPhongMaterial,
  TextureLoader,
  RepeatWrapping,
  MeshStandardMaterial,
  GridHelper,
  PCFSoftShadowMap,
  WebGLCubeRenderTarget,
  CubeCamera,
  MathUtils,
  MOUSE,
  Quaternion,
  Object3D,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  AmbientLight,
  DirectionalLight,
} from "three";
import {
  OrbitControls,
  MapControls,
} from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import {
  EVENT_MOVED_DRAG,
  EVENT_ROOM_SELECT,
  EVENT_ITEM_UPDATE,
  EVENT_ROTATE_ITEM,
  EVENT_ITEM_REMOVED,
  EVENT_ITEM_HOVERON,
  EVENT_ITEM_HOVEROFF,
  EVENT_UPDATED,
  EVENT_LOADED,
  EVENT_ITEM_SELECTED,
  EVENT_ITEM_MOVE,
  EVENT_ITEM_MOVE_FINISH,
  EVENT_NO_ITEM_SELECTED,
  EVENT_WALL_CLICKED,
  EVENT_ROOM_CLICKED,
  EVENT_GLTF_READY,
  EVENT_NEW_ITEM,
  EVENT_NEW_ROOMS_ADDED,
  EVENT_MODE_RESET,
  EVENT_EXTERNAL_FLOORPLAN_LOADED,
  EVENT_ROTATE_ITEM_SELECTED,
  EVENT_ITEM_COPIED,
  EVENT_REDRAW,
  EVENT_ITEM_LOADED,
} from "../core/events.js";

import { Skybox } from "./skybox.js";

/**
 * How close the orbit camera may get to straight-up or straight-down.
 *
 * At exactly 0 or π the camera direction is parallel to its up-vector, the
 * orientation becomes undefined, and the view snaps 180°. A hundredth of a
 * radian (~0.6°) is far too small to notice but keeps the maths well-defined.
 */
const POLAR_EPSILON = 0.01;

/**
 * Closest the orbit camera may sit to its target, in centimetres.
 *
 * Small enough to get inside a room and frame a single fitting, but not zero —
 * at zero the orbit target and the camera coincide and the view direction
 * becomes undefined.
 */
const MIN_ZOOM_DISTANCE = 15;
import { Edge3D } from "./edge3d.js";
import { Floor3D } from "./floor3d.js";
import { Lights3D } from "./lights3d.js";
import { HUD } from "./hud.js";
import { Physical3DItem } from "./Physical3DItem.js";
import { DragRoomItemsControl3D } from "./DragRoomItemsControl3D.js";
import { Configuration, viewBounds, configDimUnit, configWallHeight } from "../core/configuration.js";
import { Dimensioning } from "../core/dimensioning.js";
import {
  dimInch,
  dimFeetAndInch,
  dimMeter,
  dimCentiMeter,
  dimMilliMeter,
} from "../core/constants.js";
import { BoundaryView3D } from "./BoundaryView3D.js";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { handleAddFurnishedModelToScene } from "@pazl/viewer3d-state-interface.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";

// Short unit suffix for the on-screen 3D dimension chips, keyed by the current
// global measurement unit — so the chips read "mm"/"ft"/… like the floor plan
// instead of a hardcoded "cm".
const DIM_UNIT_SUFFIX = {
  [dimFeetAndInch]: "ft",
  [dimInch]: "in",
  [dimMeter]: "m",
  [dimCentiMeter]: "cm",
  [dimMilliMeter]: "mm",
};

export class Viewer3D extends Scene {
  constructor(model, element, opts) {
    super();
    let options = {
      occludedRoofs: false,
      occludedWalls: false,
      resize: true,
      pushHref: false,
      spin: true,
      spinSpeed: 0.00002,
      clickPan: true,
      canMoveFixedItems: false,
    };
    for (let opt in options) {
      if (options.hasOwnProperty(opt) && opts.hasOwnProperty(opt)) {
        options[opt] = opts[opt];
      }
    }

    this.__physicalRoomItems = [];
    this.__enabled = true;
    this.model = model;
    this.floorplan = this.model.floorplan;
    this.__options = options;
    this.loadlight = true;
    this.lights = [];
    this.container = "bp3djs-viewer3d";

    this.domElement = document.getElementById(element);

    this.perspectivecamera = null;
    this.camera = null;
    this.__environmentCamera = null;

    this.cameraNear = 10;
    this.cameraFar = 100000;

    this.controls = null;
    this.transformControls = null;
    this.renderer = null;
    this.controller = null;
    this.mouse3D = { x: 0, y: 0 };

    this.needsUpdate = false;
    this.lastRender = Date.now();

    this.heightMargin = null;
    this.widthMargin = null;
    this.elementHeight = null;
    this.elementWidth = null;
    this.pauseRender = false;

    this.edges3d = [];
    this.floors3d = [];

    this.__externalEdges3d = [];
    this.__externalFloors3d = [];

    this.__boundaryRegion3D = null;
    this.__currentItemSelected = null;
    this.ctrlDown = false;
    this.__copiedItem = null;

    this.needsUpdate = true;

    this.__newItemEvent = this.__addNewItem.bind(this);
    this.__removeItemEvent = this.__removeItem.bind(this);
    this.__itemUpdateEvent = this.__itemUpdate.bind(this);

    this.__wallSelectedEvent = this.__wallSelected.bind(this);
    this.__roomSelectedEvent = this.__roomSelected.bind(this);
    this.__dragSelected = this.__dragSelected.bind(this);
    this.__zoomEvent = this.__zoom.bind(this);
    this.__snapshotEvent = this.__snapshot.bind(this);
    this.__objectFocusEvent = this.__objectFocus.bind(this);
    this.__roomFocusEvent = this.__roomFocus.bind(this);

    //this.__wallSelectedEventClick = this.__wallSelectedClick.bind(this);
    //this.__roomSelectedEventClick = this.__roomSelectedClick.bind(this);

    this.__roomItemSelectedEvent = this.__roomItemSelected.bind(this);
    this.__roomItemUnselectedEvent = this.__roomItemUnselected.bind(this);
    this.__roomItemDraggedEvent = this.__roomItemDragged.bind(this);
    this.__roomItemDragFinishEvent = this.__roomItemDragFinish.bind(this);
    this.__rotateItemEvent = this.__rotateItem.bind(this);
    this.__roomItemHoverEvent = this.__ItemHoverEvent.bind(this);
    this.__pasteCopiedItemEvent = this.__pasteCopiedItem.bind(this);
    this.__resetDesignEvent = this.__resetDesign.bind(this);
    //this.__ArrowObjectMakeEvent = this._MakeObjectSelect.bind(this);
    this.hud = null;
    this.gridHelper = null;

    this.init();
  }

  setCamera(scope, camera) {
    let currentCamera = camera;
    scope.camera = currentCamera;
    if (scope.camera.isOrthographicCamera) {
      scope.camera.position.set(0, 1000, 0);
      scope.camera.setRotationFromAxisAngle(
        new Vector3(1, 0, 0),
        -(Math.PI / 2)
      );
    }
    scope.renderer.setSize(window.innerWidth, window.innerHeight);
    scope.renderer.render(scope, scope.camera);

    if (scope.controls) {
      scope.controls.dispose();
    }

    scope.controls = new OrbitControls(scope.camera, scope.domElement);
    scope.controls.enableDamping = true;
    scope.controls.dampingFactor = 0.08;
    // Full vertical orbit for the perspective camera: 0.45π stopped the camera
    // just above the horizon, so the ceiling could never be looked at from
    // inside and the model could not be viewed from below. The epsilon keeps
    // the camera off the exact poles, where the up-vector flips and the view
    // snaps around. The orthographic camera stays locked to its top-down plan.
    scope.controls.minPolarAngle = scope.camera.isOrthographicCamera
      ? 0
      : POLAR_EPSILON;
    scope.controls.maxPolarAngle = scope.camera.isOrthographicCamera
      ? 0
      : Math.PI - POLAR_EPSILON;
    scope.controls.maxDistance = Configuration.getNumericValue(viewBounds); // 7500; //2500
    // 100 cm held the camera a metre back from its target, which is outside
    // the room looking in — close-ups of a fan, a handle or a skirting board
    // were impossible. 15 cm lets the camera sit inside the space.
    scope.controls.minDistance = MIN_ZOOM_DISTANCE;
    scope.controls.screenSpacePanning = true;
    if (scope.camera.isOrthographicCamera) {
      scope.controls.mouseButtons = {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.MIDDLE,
        RIGHT: MOUSE.ROTATE,
      };
    } else {
      scope.controls.mouseButtons = {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      };
    }
    scope.controls.update();

    if (scope.dragcontrols) {
      scope.dragcontrols.dispose();
    }

    scope.dragcontrols = new DragRoomItemsControl3D(
      this.floorplan.wallPlanesForIntersection,
      this.floorplan.floorPlanesForIntersection,
      this.physicalRoomItems,
      scope.camera,
      scope.renderer.domElement,
      scope.hud
    );

    if (scope.transformControls) {
      scope.transformControls.dispose();
    }

    scope.transformControls = new TransformControls(
      scope.camera,
      scope.renderer.domElement
    );

    scope.transformControls.addEventListener("change", () => {
      scope.needsUpdate = true;
    });
    scope.transformControls.addEventListener("objectChange", (event) => {
      scope.rotateUpdateMetadata();
    });
    scope.transformControls.addEventListener("dragging-changed", (event) => {
      scope.controls.enabled = !event.value;
    });
    scope.dragcontrols.addEventListener("mousedown", (event) => {
      console.debug("mousedown");
    });
    // handle window resizing
    scope.updateWindowSize();
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_SELECTED,
      this.__roomItemSelectedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_MOVE,
      this.__roomItemDraggedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_HOVERON,
      this.__roomItemHoverEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_HOVEROFF,
      this.__roomItemHoverEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_MOVE_FINISH,
      this.__roomItemDragFinishEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_NO_ITEM_SELECTED,
      this.__roomItemUnselectedEvent
    );

    scope.dragcontrols.addEventListener(
      EVENT_WALL_CLICKED,
      this.__wallSelectedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_MOVED_DRAG,
      this.__roomItemDraggedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ROOM_CLICKED,
      this.__roomSelectedEvent
    );

    scope.dragcontrols.addEventListener(EVENT_MOVED_DRAG, this.__dragSelected);

    // scope.dragcontrols.addEventListener(EVENT_WALL_SELECT, this.__wallSelectedEventClick);
    // scope.dragcontrols.addEventListener(EVENT_ROOM_SELECT, this.__roomSelectedEventClick);

    scope.dragcontrols.addEventListener(
      EVENT_ROTATE_ITEM_SELECTED,
      this.__rotateItemEvent
    );
  }

  // Frame the WHOLE floor plan in a pulled-back, angled "dollhouse" view (like
  // Coohom) — instead of the old fixed top-down position that left the camera
  // too close / poorly framed. Auto-fits the distance to the plan's size so any
  // room, large or small, lands nicely in view.
  frameFloorplan(animate = false) {
    const scope = this;
    try {
      // Cutaway is OFF — we use wall/floor OPACITY (Coohom's slider approach)
      // instead, so walls stay visible (and don't hide the ceiling fan).
      scope.__cutawayEnabled = false;
      if (
        !scope.floorplan ||
        !scope.camera ||
        scope.camera.isOrthographicCamera
      )
        return;
      const center = scope.floorplan.getCenter();
      const size = scope.floorplan.getSize();
      const extent = Math.max(size.x || 0, size.z || 0, 100);
      const fov = ((scope.camera.fov || 45) * Math.PI) / 180;
      // camera.aspect can be stale (init'd to a placeholder) — read the live
      // canvas aspect so the fit is correct on wide and tall viewports alike.
      const el = scope.domElement;
      const aspect =
        el && el.clientWidth && el.clientHeight
          ? el.clientWidth / el.clientHeight
          : window.innerWidth / Math.max(1, window.innerHeight);
      // Distance so the larger of width/height fits the frustum, plus padding.
      const fitForHeight = extent / 2 / Math.tan(fov / 2);
      const fitForWidth = fitForHeight / Math.min(1, aspect);
      const dist = Math.max(fitForHeight, fitForWidth) * 1.45;
      // Dollhouse direction: pulled back, elevated, angled.
      const dir = new Vector3(0.55, 0.72, 0.55).normalize();
      const endPos = new Vector3(
        center.x + dir.x * dist,
        dir.y * dist,
        center.z + dir.z * dist
      );
      if (animate && scope.controls) {
        // Glide into the dollhouse overview instead of snapping (Coohom-style).
        scope.__animateCameraTo(endPos, center.clone(), 900);
      } else {
        // Reset zoom so a leftover projection zoom can't leave the fit zoomed in.
        scope.camera.zoom = 1;
        scope.camera.position.copy(endPos);
        if (scope.controls) {
          scope.controls.target.copy(center);
          scope.controls.update();
        }
        scope.camera.lookAt(center);
        scope.camera.updateProjectionMatrix();
      }
      scope.updateAdaptiveCeiling();
      scope.shouldRender = true;
      scope.needsUpdate = true;
    } catch (e) {
      /* never break the view */
    }
  }

  // Adaptive ceiling (Coohom-style): hidden when the camera is ABOVE the room
  // (overview → look down in, see the ceiling fan + furniture), shown when the
  // camera drops to eye level INSIDE the room. Called on every camera change.
  updateAdaptiveCeiling() {
    const scope = this;
    try {
      if (!scope.camera || scope.camera.isOrthographicCamera) return;
      let wallH = 280;
      try {
        wallH = Configuration.getNumericValue(configWallHeight) || 280;
      } catch (e) {}
      // Above the ceiling (with a little margin) → overview → hide it.
      const show = scope.camera.position.y < wallH * 1.05;
      scope.__ceilingShown = show;
      (scope.floors3d || []).forEach((floor) => {
        if (floor && floor.roofPlane && floor.roofPlane.visible !== show) {
          floor.roofPlane.visible = show;
          scope.shouldRender = true;
          scope.needsUpdate = true;
        }
      });
    } catch (e) {
      /* best-effort */
    }
  }

  // Wall opacity (Coohom "Wall %" slider). Stored on __wallOpacity so edge3d
  // re-applies it on every redraw; op=1 → solid.
  setWallOpacity(opacity) {
    const scope = this;
    try {
      const op = Math.max(0, Math.min(1, Number(opacity)));
      scope.__wallOpacity = op;
      (scope.edges3d || []).forEach((edge) => {
        (edge && edge.planes ? edge.planes : []).forEach((plane) => {
          if (plane && plane.material) {
            plane.material.transparent = op < 1;
            plane.material.opacity = op;
            plane.material.depthWrite = op >= 1;
            plane.material.needsUpdate = true;
          }
        });
      });
      scope.shouldRender = true;
      scope.needsUpdate = true;
    } catch (e) {
      /* best-effort */
    }
  }

  // Ceiling FINISH (Room Properties → Ceiling color, texture-picker format like
  // Floor). Maps the finishing's texture image onto the roof, stored on the room
  // so it survives redraws. Pass a falsy url to clear back to the flat colour.
  setCeilingTexture(fileUrl) {
    const scope = this;
    try {
      let tex = null;
      if (fileUrl) {
        tex = new TextureLoader().load(fileUrl);
        tex.wrapS = tex.wrapT = RepeatWrapping;
      }
      (scope.floors3d || []).forEach((floor) => {
        if (floor && floor.room) {
          floor.room.__ceilingTextureUrl = fileUrl || null;
          // Persist onto the floorplan so it serializes → survives reload.
          const fp = floor.room.floorplan;
          if (fp && typeof fp.setCeilingTexture === "function") {
            const uuid = floor.room.getUuid();
            const prev = fp.getCeilingTexture(uuid) || {};
            fp.setCeilingTexture(uuid, { ...prev, textureUrl: fileUrl || null });
          }
        }
        const m = floor && floor.roofPlane && floor.roofPlane.material;
        if (m) {
          m.map = tex;
          m.color.set(tex ? 0xffffff : 0xe5e5e5); // white lets the texture show true
          m.needsUpdate = true;
        }
      });
      scope.shouldRender = true;
      scope.needsUpdate = true;
    } catch (e) {
      /* best-effort */
    }
  }

  // Ceiling colour (kept for a flat-colour fallback). Stores it on each room so
  // it survives redraws, and updates the live roof material immediately.
  setCeilingColor(color) {
    const scope = this;
    try {
      (scope.floors3d || []).forEach((floor) => {
        if (floor && floor.room) floor.room.__ceilingColor = color;
        if (floor && floor.roofPlane && floor.roofPlane.material) {
          floor.roofPlane.material.color.set(color);
          floor.roofPlane.material.needsUpdate = true;
        }
      });
      scope.shouldRender = true;
      scope.needsUpdate = true;
    } catch (e) {
      /* best-effort */
    }
  }

  // Floor opacity (Coohom "Floor %" slider). Stored on __floorOpacity so floor3d
  // re-applies it on every redraw; op=1 → solid.
  setFloorOpacity(opacity) {
    const scope = this;
    try {
      const op = Math.max(0, Math.min(1, Number(opacity)));
      scope.__floorOpacity = op;
      (scope.floors3d || []).forEach((floor) => {
        const m = floor && floor.floorPlane && floor.floorPlane.material;
        if (m) {
          m.transparent = op < 1;
          m.opacity = op;
          m.depthWrite = op >= 1;
          m.needsUpdate = true;
        }
      });
      scope.shouldRender = true;
      scope.needsUpdate = true;
    } catch (e) {
      /* best-effort */
    }
  }

  // ===== Kitchen BACKSPLASH ==============================================
  // A thin textured panel on the wall directly behind a selected base cabinet
  // (Below Counter Storage), spanning the unit's width, from its worktop up by a
  // configurable height. Config lives on the item's metadata (persists + reloads)
  // and the built panel is tracked on the Physical3DItem so it can be updated /
  // removed and rebuilt after a load. Units are cm; UI height is mm (÷10 here).

  // Nearest wall to a world (x,z) point. Returns { px, pz, nx, nz } — the point
  // on the wall centreline and the interior normal (toward the item), else null.
  __nearestWallInfo(cx, cz) {
    const walls = (this.floorplan && this.floorplan.walls) || [];
    let best = null;
    let bestDist = Infinity;
    walls.forEach((wall) => {
      const s = wall.start;
      const e = wall.end;
      if (!s || !e) return;
      // floorplan y → world z.
      const ax = s.x, az = s.y, bx = e.x, bz = e.y;
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) return;
      let t = ((cx - ax) * dx + (cz - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, pz = az + t * dz;
      const ddx = cx - px, ddz = cz - pz;
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);
      if (dist < bestDist) {
        const len = Math.sqrt(len2);
        let nx = -dz / len, nz = dx / len;
        if (nx * ddx + nz * ddz < 0) { nx = -nx; nz = -nz; } // point toward item
        bestDist = dist;
        best = { px, pz, nx, nz, wall };
      }
    });
    return best;
  }

  // Like __nearestWallInfo, but casts a RAY from (cx,cz) in direction (dx,dz)
  // and returns the FIRST wall the ray hits. Used for the "Attach to →
  // Left / Right" options so the user can force a specific wall instead of the
  // auto-nearest one. Returns {px,pz,nx,nz,wall} or null.
  __wallInDirection(cx, cz, dx, dz) {
    const walls = (this.floorplan && this.floorplan.walls) || [];
    let best = null;
    let bestT = Infinity;
    walls.forEach((wall) => {
      const s = wall.start;
      const e = wall.end;
      if (!s || !e) return;
      const ax = s.x, az = s.y, bx = e.x, bz = e.y;
      const ex = bx - ax, ez = bz - az;
      const det = dx * -ez - -ex * dz; // -dx*ez + ex*dz
      if (Math.abs(det) < 1e-6) return; // ray parallel to wall
      const rx = ax - cx, rz = az - cz;
      const t = (rx * -ez - -ex * rz) / det; // distance along the ray
      const u = (dx * rz - dz * rx) / det; // position along the segment
      if (t > 0 && u >= 0 && u <= 1 && t < bestT) {
        const px = ax + u * ex, pz = az + u * ez;
        const len = Math.sqrt(ex * ex + ez * ez) || 1;
        let nx = -ez / len, nz = ex / len;
        // Interior normal must face back toward the item (opposite the ray).
        if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
        best = { px, pz, nx, nz, wall };
        bestT = t;
      }
    });
    return best;
  }

  // (Re)build the backsplash panel for a Physical3DItem from its stored config.
  // Removes any existing panel first; a no-op / removal if config.on is false.
  __buildBacksplashFor(item) {
    const scope = this;
    if (!item) return;
    if (item.__backsplashMesh) {
      const old = item.__backsplashMesh;
      if (old.parent) old.parent.remove(old); // may be a child of item now
      scope.remove(old);
      try {
        old.geometry && old.geometry.dispose();
        old.material && old.material.dispose();
      } catch (_) {}
      item.__backsplashMesh = null;
    }
    const model = item.itemModel;
    const cfg = model && model.metadata && model.metadata.backsplash;
    if (!cfg || !cfg.on) {
      scope.shouldRender = true;
      scope.needsUpdate = true;
      return;
    }
    // Measure the cabinet's ACTUAL world bounding box now. Don't trust
    // item.size / item.worldBox: GLB items are scaled via __scale on the mesh,
    // so item.__size can still be the (1,1,1) default — which made the panel a
    // 1cm invisible sliver. setFromObject reflects the real rendered size (cm).
    let box;
    try {
      // Make sure the item's world transform is current, or the measured box
      // (and therefore the "which side of the wall is the room" decision) can be
      // stale/at-origin — which pushes the panel to the wrong face of the wall.
      item.updateMatrixWorld && item.updateMatrixWorld(true);
      box = new Box3().setFromObject(item);
    } catch (e) {
      box = null;
    }
    if (!box || !isFinite(box.max.y) || box.max.y <= box.min.y) {
      console.warn("[backsplash] no usable bounding box for item", item);
      return;
    }
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const heightCm = Math.max(1, (Number(cfg.height) || 480) / 10); // mm → cm
    // Pick the wall. "auto"/"back" → the wall the cabinet backs onto (nearest).
    // "left"/"right" → rotate that back-direction ±90° and ray-cast to the wall
    // on that side (matches kitchenplanner's Back/Left/Right).
    const attach = cfg.attach || "auto";
    let info = scope.__nearestWallInfo(cx, cz);
    if (info && (attach === "left" || attach === "right")) {
      const bx = -info.nx, bz = -info.nz; // direction from item toward its wall
      const dx = attach === "left" ? -bz : bz;
      const dz = attach === "left" ? bx : -bx;
      info = scope.__wallInDirection(cx, cz, dx, dz) || info;
    }
    if (!info) {
      console.warn("[backsplash] no wall found near item", { cx, cz });
      return;
    }
    // Work in WORLD space (added to the scene) — reliable size + visibility.
    // A cabinet's back is ALWAYS along its DEPTH axis (D = local Z), never its
    // width axis. So for "auto" we only consider the two depth directions and
    // pick the sign whose wall is nearer (the wall it backs onto). This is why
    // choosing among all four sides mis-picked the back near a corner.
    const th = item.rotation ? item.rotation.y || 0 : 0; // world yaw (item is a scene child)
    const cosT = Math.cos(th), sinT = Math.sin(th);
    const depthAxis = [sinT, cosT]; // cabinet front–back axis (local Z = depth)
    // The back faces AWAY from the room centre (toward the wall); the front faces
    // INTO the room. So pick the depth-axis sign that points away from centre.
    // This is reliable regardless of how near any wall is (the old "nearest wall"
    // test put it on the front when a wall happened to be near the front).
    let rc = null;
    try {
      rc = scope.floorplan && scope.floorplan.getCenter && scope.floorplan.getCenter();
    } catch (_) {}
    const toCenterX = (rc ? rc.x : cx) - cx;
    const toCenterZ = (rc ? rc.z : cz) - cz;
    const dotToCentre = depthAxis[0] * toCenterX + depthAxis[1] * toCenterZ;
    // If +depthAxis points toward the centre it is the FRONT → back is the other.
    let back =
      dotToCentre > 0 ? [-depthAxis[0], -depthAxis[1]] : [depthAxis[0], depthAxis[1]];
    // Attach-to override: rotate the back ±90° to use a side wall instead. The
    // side walls are the SAME two regardless of the back's sign, so Left/Right
    // keep working; only their labels may swap.
    if (attach === "left") back = [-back[1], back[0]];
    else if (attach === "right") back = [back[1], -back[0]];
    // Sizes from the world AABB, projected onto the back / along-wall directions.
    const sizeX = box.max.x - box.min.x;
    const sizeZ = box.max.z - box.min.z;
    const projify = (d) => Math.abs(sizeX * d[0]) + Math.abs(sizeZ * d[1]);
    const widthDir = [-back[1], back[0]]; // perpendicular to back = along the wall
    const width = Math.max(20, projify(widthDir));
    const halfDepth = projify(back) / 2;
    const topY = box.max.y; // worktop = top of the cabinet
    // Anchor at the cabinet's back edge, pulled ~1.5cm toward the room.
    const anchorX = cx + back[0] * Math.max(0, halfDepth - 1.5);
    const anchorZ = cz + back[1] * Math.max(0, halfDepth - 1.5);
    const material = cfg.materialUrl
      ? (() => {
          const tex = new TextureLoader().load(cfg.materialUrl, () => {
            scope.shouldRender = true;
            scope.needsUpdate = true;
          });
          tex.wrapS = tex.wrapT = RepeatWrapping;
          // Tile roughly every 30cm so the texture reads at real-world scale.
          tex.repeat.set(Math.max(1, width / 30), Math.max(1, heightCm / 30));
          return new MeshPhongMaterial({ map: tex, side: 2, shininess: 8 });
        })()
      : new MeshPhongMaterial({ color: cfg.color || 0xe8e4dc, side: 2, shininess: 8 });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    const panel = new Mesh(new PlaneGeometry(width, heightCm), material);
    // Stand at the back edge, rising from the worktop up by heightCm.
    panel.position.set(anchorX, topY + heightCm / 2, anchorZ);
    // Face into the room (opposite the back direction).
    panel.rotation.set(0, Math.atan2(-back[0], -back[1]), 0);
    panel.name = "__backsplash";
    panel.__isBacksplash = true;
    panel.renderOrder = 2;
    // Add to the scene, then re-parent to the CABINET preserving the world
    // transform. As a child of the cabinet the panel now follows it on every
    // move / rotate — no separate panel left behind. attach() keeps the exact
    // world position/size we just computed (the cabinet's own scale is 1, so no
    // distortion).
    scope.add(panel);
    if (typeof item.attach === "function") item.attach(panel);
    else scope.add(panel);
    item.__backsplashMesh = panel;
    console.debug("[backsplash] built panel", {
      widthCm: width,
      heightCm,
      cabinetCenter: { cx, cz },
      roomCentre: rc ? { x: rc.x, z: rc.z } : null,
      topY,
      back,
      dotToCentre,
      anchor: { anchorX, anchorZ },
      attach,
      material: cfg.materialUrl || "default",
    });
    scope.shouldRender = true;
    scope.needsUpdate = true;
  }

  // Public — set / update the backsplash on the currently selected item. Called
  // from the Properties panel via BlueprintInterface.blueprint3d.roomplanner.
  setBacksplash(opts) {
    const scope = this;
    try {
      const item = scope.__currentItemSelected;
      if (!item || !item.itemModel) {
        console.warn("[backsplash] no item selected — cannot set backsplash");
        return;
      }
      const model = item.itemModel;
      if (!model.__metadata) model.__metadata = {};
      const prev = model.__metadata.backsplash || {};
      model.__metadata.backsplash = {
        on: opts.on != null ? !!opts.on : !!prev.on,
        height: opts.height != null ? Number(opts.height) : prev.height || 480,
        attach: opts.attach !== undefined ? opts.attach : prev.attach || "auto",
        materialUrl:
          opts.materialUrl !== undefined ? opts.materialUrl : prev.materialUrl || null,
        // The chosen finish's category id — the BOQ uses it to price the
        // EXTERIOR finish of the backsplash (finish rate × area).
        finishingCategoryId:
          opts.finishingCategoryId !== undefined
            ? opts.finishingCategoryId
            : prev.finishingCategoryId || null,
        color: opts.color !== undefined ? opts.color : prev.color || null,
      };
      scope.__buildBacksplashFor(item);
    } catch (e) {
      /* best-effort */
    }
  }

  removeBacksplash() {
    const scope = this;
    try {
      const item = scope.__currentItemSelected;
      if (!item || !item.itemModel) return;
      if (item.itemModel.__metadata && item.itemModel.__metadata.backsplash) {
        item.itemModel.__metadata.backsplash.on = false;
      }
      scope.__buildBacksplashFor(item);
    } catch (e) {
      /* best-effort */
    }
  }

  // Read the current selected item's backsplash config (for the UI to reflect).
  getBacksplash() {
    try {
      const item = this.__currentItemSelected;
      return (
        (item && item.itemModel && item.itemModel.metadata && item.itemModel.metadata.backsplash) ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  // Rebuild every item's backsplash from its metadata — call after a load so
  // saved backsplashes reappear.
  __rebuildAllBacksplashes() {
    try {
      (this.physicalRoomItems || []).forEach((item) => this.__buildBacksplashFor(item));
    } catch (e) {
      /* best-effort */
    }
  }

  init() {
    let scope = this;
    ImageUtils.crossOrigin = "";
    let camera1 = new PerspectiveCamera(
      45,
      10,
      scope.cameraNear,
      scope.cameraFar
    );
    let camera2 = new OrthographicCamera(
      -200,
      700,
      800,
      -1350,
      scope.cameraNear,
      scope.cameraFar
    );

    camera1.position.set(0, 0, 500);
    camera2.position.set(0, 1000, 0);
    camera2.setRotationFromAxisAngle(new Vector3(1, 0, 0), -(Math.PI / 2));

    scope.add(camera1);
    scope.add(camera2);

    let currentCamera = camera1;
    scope.camera = currentCamera;

    window.addEventListener("click", function (event) {
      event.stopPropagation();
      console.debug("DEBUG: click", event);
      if (event.button == 1) {
        scope.setCamera(scope, camera1);
        scope.__roomFocus(event);
      }

      if (event.button == 2) {
        console.debug("DEBUG: setting camera to topview", scope.controls);
        camera2.left = -window.innerWidth / 2.4;
        camera2.right = window.innerWidth / 1.2;
        camera2.top = window.innerHeight / 4;
        camera2.bottom = -window.innerHeight / 1.1;
        camera2.updateProjectionMatrix();
        scope.setCamera(scope, camera2);
      }
    });

    // Large, subtle grid (cell = 100). It's big AND follows the camera (see the
    // controls "change" handler) so the edge is never reached on zoom/pan —
    // i.e. it feels infinite.
    // A faint grey grid: enough to read the ground plane and scale, quiet
    // enough that it never competes with the design sitting on it.
    // A tinted ground plane under the grid. Without it the grid lines float on
    // the page background and the scene has no horizon; with it the plane ends
    // in a visible edge and the design reads as sitting on a floor.
    scope.groundPlane = new Mesh(
      new PlaneGeometry(40000, 40000),
      new MeshBasicMaterial({ color: 0xe9edf1, depthWrite: false })
    );
    scope.groundPlane.rotation.x = -Math.PI / 2;
    scope.groundPlane.position.set(0, -3, 0);
    // Never let the plane swallow a click meant for a wall or an item.
    scope.groundPlane.__isGround = true;
    scope.add(scope.groundPlane);

    // White lines ON that tinted plane — the inverse of grey-on-white, and what
    // makes the ground read as a soft tiled surface rather than graph paper.
    // 200 divisions over 40000 = 200-unit cells.
    scope.gridHelper = new GridHelper(40000, 200, 0xffffff, 0xffffff);
    scope.gridHelper.material.opacity = 0.9;
    scope.gridHelper.material.transparent = true;
    scope.gridHelper.position.set(0, -1, 0);
    scope.add(scope.gridHelper);

    let cubeRenderTarget = new WebGLCubeRenderTarget(16, {
      format: RGBFormat,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    scope.__environmentCamera = new CubeCamera(1, 100000, cubeRenderTarget);
    scope.__environmentCamera.renderTarget.texture.encoding = sRGBEncoding;
    scope.renderer = scope.getARenderer();
    console.debug("Viewer3d.js ~ init ~ scope.domElement", scope.domElement);
    scope.domElement.appendChild(scope.renderer.domElement);
    //scope.lights = new Lights3D(this, scope.floorplan);
    scope.progressbar = new LoadingManager();
    // scope.dragcontrols = new DragControls(this.physicalRoomItems, scope.camera, scope.renderer.domElement);
    // Dispose any existing drag controller before creating a new one. Without
    // this, if init() runs more than once (re-mount / re-init) a SECOND
    // DragRoomItemsControl3D is created while the first keeps its DOM
    // listeners — so a single mouse-up fires EVENT_ITEM_MOVE_FINISH from BOTH
    // controllers. The stale controller commits a stale position, snapping
    // wall items back after the first drag. (setCamera already disposes; init
    // did not.)
    if (scope.dragcontrols) {
      scope.dragcontrols.dispose();
    }
    scope.dragcontrols = new DragRoomItemsControl3D(
      this.floorplan.wallPlanesForIntersection,
      this.floorplan.floorPlanesForIntersection,
      this.physicalRoomItems,
      scope.camera,
      scope.renderer.domElement,
      scope.hud
    );
    scope.controls = new OrbitControls(scope.camera, scope.domElement);

    //scope.controls.autoRotate = this.__options['spin'];
    scope.controls.enableDamping = true;
    scope.controls.dampingFactor = 0.08;
    // Kept in step with the same limits set when the controls were created —
    // this runs later and would otherwise put the 0.45π ceiling back.
    scope.controls.minPolarAngle = POLAR_EPSILON;
    scope.controls.maxPolarAngle = Math.PI - POLAR_EPSILON;
    scope.controls.maxDistance = Configuration.getNumericValue(viewBounds); // 7500; //2500
    // 100 cm held the camera a metre back from its target, which is outside
    // the room looking in — close-ups of a fan, a handle or a skirting board
    // were impossible. 15 cm lets the camera sit inside the space.
    scope.controls.minDistance = MIN_ZOOM_DISTANCE;
    scope.controls.screenSpacePanning = true;
    scope.skybox = new Skybox(this, scope.renderer);
    // scope.camera.position.set(500, 600, 500);
    scope.controls.update();

    // ZOOM TO CENTER: OrbitControls' wheel "dolly" moves the camera toward its
    // orbit target, so zoom drifts toward a corner. Instead, drive the mouse
    // wheel through the camera's PROJECTION zoom (camera.zoom), which scales the
    // view about the SCREEN CENTRE — the model stays centred. This matches the
    // +/- zoom buttons (see __zoom), so wheel and buttons behave the same.
    scope.controls.enableZoom = false;
    scope.__wheelZoomToCenter = (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.25 : -0.25;
      scope.camera.zoom = Math.min(
        Math.max((scope.camera.zoom || 1) + step, 0.25),
        20
      );
      scope.camera.updateProjectionMatrix();
      scope.needsUpdate = true;
      scope.shouldRender = true;
    };
    scope.domElement.addEventListener("wheel", scope.__wheelZoomToCenter, {
      passive: false,
    });
    scope.axes = new AxesHelper(500);
    scope.transformControls = new TransformControls(
      scope.camera,
      scope.renderer.domElement
    );

    scope.transformControls.addEventListener("change", () => {
      scope.needsUpdate = true;
    });
    scope.transformControls.addEventListener("objectChange", (event) => {
      scope.rotateUpdateMetadata();
    });
    scope.transformControls.addEventListener("dragging-changed", (event) => {
      scope.controls.enabled = !event.value;
    });
    scope.dragcontrols.addEventListener("mousedown", (event) => {
      console.debug("mousedown");
    });

    // to handle snapshot
    var saveLink = document.createElement("div");
    saveLink.style.position = "absolute";
    saveLink.style.top = "10px";
    saveLink.style.width = "100%";
    saveLink.style.color = "white !important";
    saveLink.style.textAlign = "center";
    document.body.appendChild(saveLink);

    // handle window resizing
    scope.updateWindowSize();
    if (scope.__options.resize) {
      window.addEventListener("resize", () => {
        scope.updateWindowSize();
      });
      window.addEventListener("orientationchange", () => {
        scope.updateWindowSize();
      });
    }
    // Re-fit when the container itself resizes (a docked sidebar reflowing it),
    // not only on window changes.
    if (typeof ResizeObserver !== "undefined" && scope.domElement) {
      scope.__resizeObserver = new ResizeObserver(() => scope.updateWindowSize());
      scope.__resizeObserver.observe(scope.domElement);
    }
    scope.model.addEventListener(EVENT_NEW_ITEM, scope.__newItemEvent);
    scope.model.addEventListener(EVENT_ROTATE_ITEM, scope.__rotateItemEvent);
    scope.model.addEventListener(EVENT_ITEM_REMOVED, scope.__removeItemEvent);
    scope.model.addEventListener(EVENT_ITEM_UPDATE, scope.__itemUpdateEvent);
    scope.model.addEventListener(EVENT_MODE_RESET, scope.__resetDesignEvent);

    scope.model.addEventListener(EVENT_LOADED, scope.addRoomItems.bind(scope));

    scope.floorplan.addEventListener(
      EVENT_NEW_ROOMS_ADDED,
      scope.addRoomsAndWalls.bind(scope)
    );
    scope.floorplan.addEventListener(
      EVENT_EXTERNAL_FLOORPLAN_LOADED,
      scope.addExternalRoomsAndWalls.bind(scope)
    );

    this.controls.addEventListener("change", () => {
      scope.needsUpdate = true;
      // Adaptive ceiling: show/hide the roof as the camera rises above / drops
      // inside the room (Coohom-style), on every orbit / zoom.
      scope.updateAdaptiveCeiling();
      // Keep the grid centred under the view (snapped to the cell size so the
      // lines don't shimmer) — makes the grid feel infinite while zooming/panning.
      if (scope.gridHelper && scope.controls && scope.controls.target) {
        const cell = 100;
        scope.gridHelper.position.x =
          Math.round(scope.controls.target.x / cell) * cell;
        scope.gridHelper.position.z =
          Math.round(scope.controls.target.z / cell) * cell;
        // The tinted plane rides along, or the grid would slide off it.
        if (scope.groundPlane) {
          scope.groundPlane.position.x = scope.gridHelper.position.x;
          scope.groundPlane.position.z = scope.gridHelper.position.z;
        }
      }
    });

    scope.dragcontrols.addEventListener(
      EVENT_ITEM_SELECTED,
      this.__roomItemSelectedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_MOVE,
      this.__roomItemDraggedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_HOVERON,
      this.__roomItemHoverEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_HOVEROFF,
      this.__roomItemHoverEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ITEM_MOVE_FINISH,
      this.__roomItemDragFinishEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_NO_ITEM_SELECTED,
      this.__roomItemUnselectedEvent
    );

    scope.dragcontrols.addEventListener(
      EVENT_WALL_CLICKED,
      this.__wallSelectedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_MOVED_DRAG,
      this.__roomItemDraggedEvent
    );
    scope.dragcontrols.addEventListener(
      EVENT_ROOM_CLICKED,
      this.__roomSelectedEvent
    );

    scope.dragcontrols.addEventListener(EVENT_MOVED_DRAG, this.__dragSelected);

    // scope.dragcontrols.addEventListener(EVENT_WALL_SELECT, this.__wallSelectedEventClick);
    // scope.dragcontrols.addEventListener(EVENT_ROOM_SELECT, this.__roomSelectedEventClick);

    scope.dragcontrols.addEventListener(
      EVENT_ROTATE_ITEM_SELECTED,
      this.__rotateItemEvent
    );
    window.addEventListener(
      "mousemove",
      function (ev) {
        ev.preventDefault();
        scope.mouse3D.x = ev.screenX;
        scope.mouse3D.y = ev.screenY;
      },
      false
    );

    /*scope.renderer.domElement.addEventListener("wheel", event => {
            const delta = event.deltaY;
            const cameraPosition = scope.camera.position.clone();
            let zoomOld = scope.camera.zoom;
            // my camera.zoom starts with 0.2
            if (zoomOld !== 0.2) {
            const xNew = event.clientX + (((cameraPosition.x - event.clientX) * scope.camera.zoom) /zoomOld);
            const yNew = event.clientY + (((cameraPosition.y - event.clientY) * scope.camera.zoom) /zoomOld);
            console.log('xNew ::',xNew)
            console.log('yNew ::',yNew)
            const diffX = cameraPosition.x - xNew;
            const diffY = cameraPosition.y - yNew;
            scope.camera.position.x += diffX;
            scope.camera.position.y += diffY;
            scope.controls.target.x += diffX;
            scope.controls.target.y += diffY;
            }
            zoomOld = scope.camera.zoom;
            scope.camera.updateProjectionMatrix();
            scope.camera.updateMatrix();
          
        });*/

    //scope.controls.enabled = false; //To test the drag controls
    window.addEventListener("click", function (event) {
      //console.log('Click event')
    });
    window.addEventListener("keydown", function (event) {
      let key = event.keyCode;
      if (key !== 17 && key !== 67 && key !== 86 && scope.ctrlDown) {
        scope.ctrlDown = false;
      }

      switch (key) {
        case 81: // Q
          scope.transformControls.setSpace(
            scope.transformControls.space === "local" ? "world" : "local"
          );
          break;
        case 16: // Shift
          scope.transformControls.setTranslationSnap(100);
          scope.transformControls.setRotationSnap(MathUtils.degToRad(15));
          scope.transformControls.setScaleSnap(0.25);
          break;
        case 87: // W
          scope.transformControls.setMode("translate");
          break;
        case 69: // E
          scope.transformControls.setMode("rotate");
          break;
        case 32: // Spacebar
          scope.transformControls.enabled = !scope.transformControls.enabled;
          break;
        case 27: // Esc
          if (typeof scope.transformControls.reset == "function") {
            scope.transformControls.reset();
          }
          break;
        case 17: // Ctrl
          scope.ctrlDown = true;
          break;
        case 67: // C
          if (
            scope.ctrlDown &&
            BlueprintInterface?.selectedModels?.length === 1
          ) {
            scope.__copiedItem = BlueprintInterface.selectedModels[0];
            scope.dispatchEvent({
              type: EVENT_ITEM_COPIED,
            });
          }
          break;
        case 86: // V
          if (scope.__copiedItem) {
            scope.__pasteCopiedItemEvent();
          }
          break;
        case 46: // Delete — remove the currently-selected item.
          {
            // Ignore Delete while the user is typing in a field (dimensions,
            // position, name, etc.) so editing those inputs is unaffected.
            const target = event.target;
            const tag =
              target && target.tagName ? target.tagName.toUpperCase() : "";
            const isTyping =
              tag === "INPUT" ||
              tag === "TEXTAREA" ||
              tag === "SELECT" ||
              (target && target.isContentEditable);
            const selList = BlueprintInterface?.selectedModels;
            const sel = selList && selList.length ? selList[0] : null;
            const id = sel
              ? sel.itemModel?.__id || sel.__itemModel?.__id
              : null;
            if (!isTyping && id) {
              BlueprintInterface.ProjectManagerService.removeFurnishedModel(id);
            }
          }
          break;
      }
    });
    window.addEventListener("keyup", function (event) {
      switch (event.keyCode) {
        case 16: // Shift
          scope.transformControls.setTranslationSnap(null);
          scope.transformControls.setRotationSnap(null);
          scope.transformControls.setScaleSnap(null);
          break;
      }
    });

    //SEt the animation loop
    scope.renderer.setAnimationLoop(scope.render.bind(this));
    scope.renderer.render(scope, currentCamera);

    document.body.appendChild(VRButton.createButton(scope.renderer));
    scope.renderer.xr.enabled = true;
  }

  __zoom(evt) {
    let scope = this;
    if (evt.type === "zoom_in") {
      scope.camera.zoom += 0.25;
    } else if (evt.type === "zoom_out") {
      scope.camera.zoom -= 0.25;
    }
    // Keep zoom sane so the – button can't drive it to zero/negative.
    scope.camera.zoom = Math.min(Math.max(scope.camera.zoom, 0.25), 20);
    scope.camera.updateProjectionMatrix();
    scope.needsUpdate = true;
    scope.shouldRender = true;
  }

  // Current zoom as a percentage for the bottom zoom bar (100% = default zoom).
  getZoomPercent() {
    const z = (this.camera && this.camera.zoom) || 1;
    return Math.max(1, Math.round(z * 100));
  }

  // "Fit to view" for the zoom bar's ⛶ button — re-frame the whole plan.
  fitView(animate = true) {
    this.frameFloorplan(animate);
  }

  // Render the currently-selected item SIDE-ON (orthographic) to a PNG data URL,
  // for the AI part-splitter. Returns { dataUrl, axis, flip }; null on failure.
  captureSelectedItemImage() {
    try {
      const item =
        (this.dragcontrols && this.dragcontrols.__selected) ||
        (BlueprintInterface &&
          BlueprintInterface.selectedModels &&
          BlueprintInterface.selectedModels[0]);
      const loaded = item && item.__loadedItem;
      if (!loaded) return null;

      // Render a CLONE in a fresh scene, and measure it THERE — so the camera is
      // framed in the same space the clone actually renders in.
      const scene = new Scene();
      const clone = loaded.clone(true);
      scene.add(clone);
      scene.updateMatrixWorld(true);

      const box = new Box3().setFromObject(clone);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const ext = [size.x, size.y, size.z];
      if (!isFinite(ext[0]) || Math.max(ext[0], ext[1], ext[2]) <= 0) {
        return null;
      }

      // Horizontal (cut) axis = the LONGEST side.
      let hAxis = 0;
      if (ext[1] > ext[0] && ext[1] >= ext[2]) hAxis = 1;
      else if (ext[2] > ext[0] && ext[2] >= ext[1]) hAxis = 2;
      // Depth axis (camera looks along it) = the SHORTEST of the other two.
      const rest = [0, 1, 2].filter((a) => a !== hAxis);
      const depthAxis = ext[rest[0]] <= ext[rest[1]] ? rest[0] : rest[1];
      const vAxis = rest[0] === depthAxis ? rest[1] : rest[0];

      const unit = (a) => {
        const v = new Vector3();
        v.setComponent(a, 1);
        return v;
      };
      const maxExt = Math.max(ext[0], ext[1], ext[2]);
      const dist = maxExt * 2 + 10;
      const camPos = center.clone().add(unit(depthAxis).multiplyScalar(dist));

      const halfW = (ext[hAxis] / 2) * 1.12 + 2;
      const halfH = (ext[vAxis] / 2) * 1.12 + 2;
      const cam = new OrthographicCamera(
        -halfW,
        halfW,
        halfH,
        -halfH,
        0.1,
        dist * 4
      );
      cam.position.copy(camPos);
      cam.up.copy(unit(vAxis));
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      // Which way does +hAxis project on screen? If axis MIN lands to the RIGHT
      // of axis MAX, the image is mirrored vs axis min→max.
      const pMin = center.clone();
      pMin.setComponent(hAxis, box.min.getComponent(hAxis));
      const pMax = center.clone();
      pMax.setComponent(hAxis, box.max.getComponent(hAxis));
      const ndcMin = pMin.project(cam).x;
      const ndcMax = pMax.project(cam).x;
      const flip = ndcMin > ndcMax;

      scene.add(new AmbientLight(0xffffff, 0.95));
      const dl = new DirectionalLight(0xffffff, 0.55);
      dl.position.copy(camPos);
      scene.add(dl);

      const W = 800;
      const H = Math.max(300, Math.round((W * halfH) / Math.max(halfW, 1e-3)));
      const r = new WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
      r.setSize(W, H);
      r.setClearColor(0xf2f2f2, 1);
      r.render(scene, cam);
      const dataUrl = r.domElement.toDataURL("image/png");
      r.dispose();
      return { dataUrl, axis: hAxis, flip };
    } catch (e) {
      console.warn("captureSelectedItemImage failed", e);
      return null;
    }
  }

  __snapshot(evt) {
    console.debug("Viewer3d.js ~ __snapshot ~ event", evt);
    const snapshotDownloadMime = "image/octet-stream";
    const snapshotMime = "image/*";
    let scope = this;
    try {
      let imageData = scope.renderer.domElement.toDataURL(snapshotMime);
      this.__saveFile(
        imageData.replace(snapshotMime, snapshotDownloadMime),
        `pazl-${Date.now()}.png`
      );
    } catch (e) {
      console.error("Viewer3d.js ~ __snapshot ~ error: ", e);
      return;
    }
  }

  __saveFile(snapshotData, fileName) {
    console.debug("Viewer3d.js ~ __saveFile", { snapshotData, fileName });
    let link = document.createElement("a");
    if (typeof link.download === "string") {
      document.body.appendChild(link); //Firefox requires the link to be in the body
      link.download = fileName;
      link.href = snapshotData;
      link.click();
      document.body.removeChild(link); //remove the link when done
    }
  }

  __objectFocus(evt) {
    console.debug("Viewer3d.js ~ __objectFocus", evt);
    let scope = this;
    if (evt.item) {
      let directionVector = evt.item.itemModel.__currentWallNormal?.clone();
      let worldDirection = new Vector3();
      evt.item.getWorldDirection(worldDirection);
      console.debug(
        "Viewer3d.js ~ __objectFocus ~ direction",
        worldDirection,
        directionVector
      );

      let correction = evt.item.__itemModel.__isWallDependent
        ? directionVector
        : worldDirection;
      correction.multiply(evt.item.position);
      correction.addScalar(200);
      // Smoothly fly the camera to frame the item (instead of jumping).
      scope.__animateCameraTo(
        new Vector3(correction.x, 500, correction.z),
        evt.item.position.clone()
      );
    }
  }

  __roomFocus(evt) {
    console.debug("Viewer3d.js ~ __roomFocus", evt);
    let scope = this;
    let roomCenter = evt?.room?.center;
    let center = roomCenter
      ? roomCenter.clone()
      : scope.floorplan.getDimensions(true).clone();
    scope.__animateCameraTo(
      new Vector3(center.x, 1000, center.z),
      center.clone()
    );
  }

  // Ease the camera from its current position/target to a destination over
  // `duration` ms. The tween is advanced in render() each frame.
  __animateCameraTo(endPos, endTarget, duration = 450) {
    if (!this.camera || !this.controls) return;
    this.__camTween = {
      fromPos: this.camera.position.clone(),
      toPos: endPos.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: endTarget.clone(),
      start: performance.now(),
      duration,
    };
    this.needsUpdate = true;
  }

  // Register a tween advanced each frame by render(). `step(k)` receives k in
  // [0,1]; optional `done()` runs once at the end.
  __addAnim(duration, step, done) {
    if (!this.__anims) this.__anims = [];
    this.__anims.push({ start: performance.now(), duration, step, done });
    this.needsUpdate = true;
    this.shouldRender = true;
  }

  // Pop-in: scale a freshly-added item up from nothing to its real size with a
  // soft overshoot ("easeOutBack"), so placed furniture appears with a lively
  // little bounce instead of snapping in. Only for NEW items (not reloads).
  //
  // Animates the Physical3DItem's OWN scale — NOT its loaded GLB child, whose
  // scale is managed by __initializeChildItem. That keeps the pop-in fully
  // independent of the model-sizing logic (no fight over the same value), and
  // the item settles back to its exact resting scale at the end.
  popInItem(item) {
    if (!item || !item.scale || item.__poppedIn) return;
    item.__poppedIn = true;
    const target = item.scale.clone();
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const easeOutBack = (t) =>
      1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    this.__addAnim(
      340,
      (k) => {
        const e = Math.max(0.001, easeOutBack(k));
        item.scale.set(target.x * e, target.y * e, target.z * e);
      },
      () => item.scale.copy(target)
    );
  }

  __wallSelected(evt) {
    console.debug("Viewer3d.js ~ __wallSelected", evt);
    this.dispatchEvent(evt);
  }

  __dragSelected(evt) {
    this.dispatchEvent(evt);
  }

  __roomSelected(evt) {
    this.dispatchEvent(evt);
  }

  __ItemHoverEvent(evt) {
    this.needsUpdate = true;
  }

  degrees_to_radians(degrees) {
    var pi = Math.PI;
    return degrees * (pi / 180);
  }

  __pasteCopiedItem() {
    let scope = this;
    console.debug(
      "Viewer3d ~ __pasteCopiedItem ~ __copiedItem",
      scope.__copiedItem
    );
    if (scope.__copiedItem && scope.__copiedItem?.itemModel?.__id) {
      const furnishedModel =
        BlueprintInterface.ProjectManagerService.getFurnishedModelById(
          scope.__copiedItem.itemModel.__id
        );
      console.debug(
        "furnishedMenu.tsx ~ getSelectedModel ~ furnishedModel",
        furnishedModel
      );
      if (furnishedModel) {
        handleAddFurnishedModelToScene(furnishedModel);
      }
    }
  }

  __removeTransformControls3D() {
    this.transformControls.detach();
    this.remove(this.transformControls);
  }

  __roomItemSelected(evt) {
    this.__removeTransformControls3D();
    if (this.__currentItemSelected) {
      //this.__currentItemSelected = null;
      this.__currentItemSelected.selected = false;
    }
    if (evt.item) {
      this.__currentItemSelected = evt.item;
      this.__currentItemSelected.selected = true;
      /* Wall Model Rotate disable */
      if (
        parseInt(this.__currentItemSelected.__itemModel.__metadata.itemType) !=
        2
      ) {
        this.transformControls.attach(this.__currentItemSelected);
        this.transformControls.setMode("rotate");
        this.transformControls.showX = false;
        this.transformControls.showZ = false;
        this.transformControls.size = 1.5;
        this.transformControls.space = "local";
        // this.add(this.transformControls);
      }
      this.needsUpdate = true;
      this.controls.enabled = true;
      //this.controls.autoRotate = true;
      this.controls.needsUpdate = true;
      evt.itemModel = this.__currentItemSelected.itemModel;
      this.needsUpdate = true;
      this.dispatchEvent(evt);
    } else {
      this.dispatchEvent("test");
    }
  }

  __roomItemDragged(evt) {
    this.controls.enabled = false;
    this.needsUpdate = true;
  }

  __roomItemDragFinish(evt) {
    this.controls.enabled = true;
    // DRAG-DROP-AND-STAY (Coohom method): a 3D drag moves the item in the scene
    // but nothing was persisting the new position to the furnished_models
    // collection — and reload reads its position from THERE, so dragged items
    // snapped back to their add position. Save the item's real dropped position
    // here so it reloads exactly where it was left. Fire-and-forget + guarded so
    // it can never break the drag or the render loop.
    try {
      const item = evt && evt.item;
      const meta = item && item.__itemModel && item.__itemModel.__metadata;
      const pos = item && item.__itemModel && item.__itemModel.position;
      const dbid = meta && meta.dbid;
      const svc = BlueprintInterface && BlueprintInterface.ProjectManagerService;
      if (
        dbid &&
        pos &&
        svc &&
        typeof svc.onFurnishedModelPositionChange === "function" &&
        Number.isFinite(pos.x) &&
        Number.isFinite(pos.z)
      ) {
        svc
          .onFurnishedModelPositionChange(dbid, [
            Number(pos.x),
            Number.isFinite(pos.y) ? Number(pos.y) : 0,
            Number(pos.z),
          ])
          .catch(() => {
            // saving is best-effort; never surface to the drag
          });
      }
    } catch (e) {
      // cosmetic — never block the drag
    }

    // If a WALL item (window/door) was moved, the wall keeps a stale hole at the
    // OLD position until it redraws (previously it only refilled when the user
    // clicked the wall). Fire a redraw on its wall's edges now, so the old
    // opening closes and the new one is cut immediately.
    try {
      const im = evt && evt.item && evt.item.itemModel;
      const wall = im && im.currentWall;
      if (wall) {
        [wall.frontEdge, wall.backEdge, im.__currentWallEdge].forEach((edge) => {
          if (edge && typeof edge.dispatchEvent === "function") {
            edge.dispatchEvent({ type: EVENT_REDRAW });
          }
        });
        this.needsUpdate = true;
        // A window/door is a parametric WALL item — it persists through the
        // floorplan serialization, NOT the furnished-models save above. Save the
        // floorplan so the new wall position survives reload, and redraw the 2D
        // plan so the same move shows there too (shared data).
        try {
          BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(
            "Window/Door moved"
          );
          BlueprintInterface?.redrawDoors2D?.();
        } catch (e) {
          /* best-effort */
        }
      }
    } catch (e) {
      // best-effort — never block the drag
    }

    this.dispatchEvent(evt);
  }

  __roomItemUnselected(evt) {
    this.__removeTransformControls3D();
    this.controls.enabled = true;
    if (this.__currentItemSelected) {
      this.__currentItemSelected.selected = false;
      this.__currentItemSelected = null;
      this.needsUpdate = true;
    }

    this.dispatchEvent(evt);
  }

  __addNewItem(evt) {
    console.debug("Viewer3d.js ~ __addNewItem ~ event", evt);
    if (!evt.item) {
      return;
    }
    let physicalRoomItem = new Physical3DItem(evt.item, this.__options);
    this.add(physicalRoomItem);
    this.__physicalRoomItems.push(physicalRoomItem);
    // Pop-in: once this NEW item's model finishes loading, scale it up with a
    // soft bounce so it appears with life instead of snapping in.
    physicalRoomItem.addEventListener(EVENT_ITEM_LOADED, () => {
      this.popInItem(physicalRoomItem);
    });
    console.debug("Viewer3d.js ~ __addNewItem ~ added item", evt.item);
    if (physicalRoomItem.rotation.y !== evt.item.rotation.y) {
      physicalRoomItem.__itemUpdatedEvent({
        rotationY: evt.item.rotation.y,
        property: "combinedRotation",
      });
      physicalRoomItem.__itemUpdatedEvent({
        position: {
          x: physicalRoomItem.position.x,
          y: physicalRoomItem.position.y,
          z: physicalRoomItem.position.z,
        },
        property: "position",
      });
    }
    this.__roomItemSelected({
      type: EVENT_ITEM_SELECTED,
      item: physicalRoomItem,
    });
  }

  __removeItem(evt) {
    let scope = this;
    if (!evt.item) {
      return;
    }
    this.__removeTransformControls3D();
    let singleItem = this.__physicalRoomItems?.filter(function (obj) {
      return obj.itemModel === evt.item;
    });
    if (singleItem.length > 0) {
      this.__physicalRoomItems?.splice(
        this.__physicalRoomItems?.indexOf(singleItem[0]),
        1
      );
      this.remove(singleItem[0]);
    }
    scope.needsUpdate = true;
    this.controls.needsUpdate = true;
    this.dispatchEvent(evt);
  }

  __itemUpdate(evt) {
    console.debug("Viewer3d.js ~ __itemUpdate", evt);
    let scope = this;
    if (!evt.item) {
      return;
    }
    if (evt.field == "fixed") {
      evt.item.__itemModel.__fixed = evt.flags == "false" ? true : false;
      evt.item.__itemModel.__metadata.fixed =
        evt.flags == "false" ? true : false;
    } else if (evt.field == "color") {
      let colors = evt.color;
      let meshmap = evt.item.__itemModel.__meshmap;
      console.debug(
        "Viewer3d.js ~ __itemUpdate ~ meshmap before update",
        meshmap
      );
      meshmap = meshmap.map((obj) => {
        if (obj.name === colors.name) {
          if (colors.texture != "") {
            console.debug("Viewer3d.js ~ __itemUpdate ~ mesh object", obj);
            console.debug(
              "Viewer3d.js ~ __itemUpdate ~ retunring updated mesh object",
              {
                ...obj,
                texture: colors.texture,
                color: "",
                size: colors.size,
              }
            );
            return {
              ...obj,
              texture: colors.texture,
              color: "",
              size: colors.size,
            };
          } else {
            return { ...obj, color: colors.color, texture: "", size: [] };
          }
        }
        return obj;
      });
      console.debug(
        "Viewer3d.js ~ __itemUpdate ~ meshmap after update",
        meshmap
      );
      evt.item.__itemModel.meshmap = meshmap;
      console.debug("Viewer3d.js ~ __itemUpdate ~ texture", colors.texture);
      if (colors.texture != "") {
        let txt = new TextureLoader().load(colors.texture);
        console.debug("Viewer3d.js ~ __itemUpdate ~ txt", txt);
        let size = colors.size;
        console.debug("Viewer3d.js ~ __itemUpdate ~ size", size);
        txt.repeat.set(1, 1, 1);
        txt.encoding = sRGBEncoding;
        txt.wrapS = RepeatWrapping;
        txt.wrapT = RepeatWrapping;
        let INITIAL_MTL = new MeshPhongMaterial({
          map: txt,
          flatShading: true,
        });
        console.debug("Viewer3d.js ~ __itemUpdate ~ INITIAL_MTL", INITIAL_MTL);
        evt.item.traverse((o) => {
          if (o.isMesh && o.name != null) {
            if (o.name == colors.name) {
              o.material = INITIAL_MTL;
              o.material.encoding = sRGBEncoding;
            }
          }
        });
      } else {
        let new_mtl = new MeshPhongMaterial({
          color: parseInt("0x" + colors.color),
          shininess: colors.shininess,
          flatShading: true,
        });

        evt.item.traverse((o) => {
          if (o.isMesh && o.name != null) {
            if (o.name == colors.name) {
              o.material = new_mtl;
            }
          }
        });
      }
    } else if (evt.field == "repeat") {
      let colors = evt.color;
      let size = [evt.size, evt.size, evt.size];
      let meshmap = evt.item.__itemModel.__meshmap;
      meshmap = meshmap.map((obj) => {
        if (obj.name === evt.name) {
          if (colors.texture != "") {
            return { ...obj, size: size };
          } else {
            return { ...obj, size: [] };
          }
        }
        return obj;
      });

      evt.item.__itemModel.meshmap = meshmap;
      if (colors.texture != "") {
        let txt = new TextureLoader().load(colors.texture);
        txt.encoding = sRGBEncoding;
        txt.wrapS = RepeatWrapping;
        txt.wrapT = RepeatWrapping;
        txt.repeat.set(1, 1, 1);
        let INITIAL_MTL = new MeshPhongMaterial({
          map: txt,
          shininess: colors.shininess,
          flatShading: true,
        });
        evt.item.traverse((o) => {
          if (o.isMesh && o.name != null) {
            if (o.name == evt.name) {
              o.material = INITIAL_MTL;
            }
          }
        });
      }
    }
    console.debug("Viewer3d.js ~ __itemUpdate ~ updated item", evt.item);
    // De-dupe this item and move it to the end, but MUTATE THE ARRAY IN PLACE —
    // do NOT reassign `this.__physicalRoomItems` to a new array. The drag /
    // click-to-select controller (DragRoomItemsControl3D.__draggableItems) was
    // handed THIS array reference at init and raycasts against it. Replacing the
    // reference here left the controller pointing at the OLD array, so any item
    // added afterwards (e.g. a freshly-dropped model) was invisible to the
    // picker and could not be selected until a reload rebuilt the controller.
    // Splicing + pushing keeps the same reference, so new items stay selectable.
    for (let i = this.__physicalRoomItems.length - 1; i >= 0; i--) {
      if (this.__physicalRoomItems[i].uuid === evt.item.uuid) {
        this.__physicalRoomItems.splice(i, 1);
      }
    }
    this.__physicalRoomItems.push(evt.item);
    scope.needsUpdate = true;
    console.debug(
      "Viewer3d.js ~ __itemUpdate ~ this.__physicalRoomItems",
      this.__physicalRoomItems
    );
    this.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: evt.item });
  }

  rotateUpdateMetadata() {
    let scope = this;
    let item = this.__currentItemSelected;
    let rotate = this.__currentItemSelected.rotation;
    item.rotation.set(rotate._x, rotate._y, rotate._z);
    item.__itemModel.__rotation.set(rotate._x, rotate._y, rotate._z);
    this.__physicalRoomItems.push(item);
    this.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: evt.item });
    scope.needsUpdate = true;
  }

  __rotateItem(evt) {
    let scope = this;
    if (!evt.item) {
      return;
    }
    let rotate = null;
    rotate = { x: evt.x, y: evt.y, z: evt.z };

    evt.item.itemModel.innerRotation = evt.eulerAngle;
    scope.needsUpdate = true;
  }

  __resetDesign(evt) {
    this.addRoomItems();
    this.addRoomsAndWalls();
    this.addExternalRoomsAndWalls();
  }

  addRoomItems(evt) {
    for (var i = 0; i < this.__physicalRoomItems?.length; i++) {
      this.__physicalRoomItems[i]?.dispose();
      this.remove(this.__physicalRoomItems[i]);
    }
    for (var i = 0; i < this.lights?.length; i++) {
      this.lights[i]?.remove();
    }
    this.lights = [];
    this.__physicalRoomItems.length = 0;
    let roomItems = this.model.roomItems;
    let itemsToUpdateRotation = [];
    for (i = 0; i < roomItems.length; i++) {
      let physicalRoomItem = new Physical3DItem(roomItems[i], this.__options);
      // if (physicalRoomItem.scale.x != physicalRoomItem.__itemModel.scale.x) {
      //   physicalRoomItem.scale.set(
      //     physicalRoomItem.__itemModel.scale.x,
      //     physicalRoomItem.scale.y,
      //     physicalRoomItem.scale.z
      //   );
      // }
      this.add(physicalRoomItem);
      this.__physicalRoomItems.push(physicalRoomItem);
      // Rebuild a saved backsplash once this item's mesh (and bounding box) is
      // ready, so it reappears after a project reload.
      physicalRoomItem.addEventListener(EVENT_ITEM_LOADED, () => {
        this.__buildBacksplashFor(physicalRoomItem);
      });
      let furnishedModel =
        BlueprintInterface.ProjectManagerService.getFurnishedModelById(
          physicalRoomItem.__itemModel.__id
        );
      if (
        furnishedModel &&
        physicalRoomItem.rotation.y != furnishedModel?.rotation[1]
      ) {
        itemsToUpdateRotation.push({
          physicalRoomItem: physicalRoomItem,
          furnishedModel: furnishedModel,
        });
      }
    }
    itemsToUpdateRotation.map((item) => {
      item.physicalRoomItem.__itemUpdatedEvent({
        rotationY: item.furnishedModel.rotation[1],
        property: "combinedRotation",
      });
    });
  }

  __drawBoundary() {
    if (this.__boundaryRegion3D) {
      this.__boundaryRegion3D.removeFromScene();
    }

    if (this.floorplan.boundary) {
      if (this.floorplan.boundary.isValid) {
        this.__boundaryRegion3D = new BoundaryView3D(
          this,
          this.floorplan,
          this.__options,
          this.floorplan.boundary
        );
      }
    }
  }

  addRoomsAndWalls() {
    let scope = this;
    let i = 0;

    // clear scene
    scope.floors3d.forEach((floor) => {
      floor.destroy();
      floor = null;
    });

    scope.edges3d.forEach((edge3d) => {
      edge3d.remove();
      edge3d = null;
    });
    scope.lights.forEach((light) => {
      light.remove();
    });
    scope.lights = [];
    scope.edges3d = [];
    scope.floors3d = [];
    let wallEdges = scope.floorplan.wallEdges();
    let rooms = scope.floorplan.getRooms();
    this.__drawBoundary();
    // draw floors
    let scene = BlueprintInterface?.ProjectManagerService?.floorPlan?.scene;
    scene = scene ? JSON.parse(scene) : null;
    console.debug("addRoomsAndWalls ~ rooms", rooms);
    for (i = 0; i < rooms.length; i++) {
      var threeFloor = new Floor3D(
        scope,
        rooms[i],
        scope.controls,
        this.__options
      );
      scope.floors3d.push(threeFloor);
      if (!scope.lights.find((light) => light.room?.uuid === rooms[i].uuid)) {
        let roomLight = new Lights3D(scope, scope.floorplan, rooms[i]);
        scope.lights.push(roomLight);
      }
    }

    for (i = 0; i < wallEdges.length; i++) {
      let edge3d = new Edge3D(
        scope,
        wallEdges[i],
        scope.controls,
        this.__options
      );
      scope.edges3d.push(edge3d);
    }

    scope.shouldRender = true;

    /*let floorplanCenter = scope.floorplan.getCenter();
        let floorPlanSize = scope.floorplan.getDimensions();
        // floorPlanSize = floorPlanSize.add(floorPlanSize.multiplyScalar(0.25));

        scope.controls.target = floorplanCenter.clone();
        scope.camera.position.set(floorPlanSize.x, 1000, floorPlanSize.z);
        scope.controls.update();*/
    if (scope.loadlight) {
      let getsize = scope.floorplan.getSize();
      // scope.__sunPath = new SunPath(getsize);
      scope.lights.push(new Lights3D(scope, scope.floorplan));
      // scope.__Sidebar = new Sidebar(scope);
      //document.body.appendChild(this.__Sidebar.dom);
      scope.loadlight = false;

      // Auto-fit the whole plan in an angled dollhouse view (Coohom-style),
      // instead of a fixed top-down camera at a hardcoded height.
      scope.frameFloorplan();
      // On the FIRST load the plan may not be measured yet when the frame above
      // runs, so the camera ends up zoomed into a corner (a manual reload fixes
      // it). Re-frame over the next animation frames once the plan has a size,
      // so the initial view is correct WITHOUT a reload.
      scope.__frameFloorplanWhenReady();
    }
  }

  __frameFloorplanWhenReady(attempt = 0) {
    const scope = this;
    try {
      const size =
        scope.floorplan &&
        typeof scope.floorplan.getSize === "function" &&
        scope.floorplan.getSize();
      const valid = size && ((size.x || 0) > 50 || (size.z || 0) > 50);
      if (valid) {
        scope.frameFloorplan();
        return;
      }
      if (attempt < 30 && typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() =>
          scope.__frameFloorplanWhenReady(attempt + 1)
        );
      }
    } catch (e) {
      /* never break the view */
    }
  }

  addExternalRoomsAndWalls() {
    let scope = this;
    let i = 0;
    // clear scene
    scope.__externalFloors3d.forEach((floor) => {
      floor.destroy();
      floor = null;
    });

    scope.__externalEdges3d.forEach((edge3d) => {
      edge3d.remove();
      edge3d = null;
    });

    scope.__externalEdges3d = [];
    scope.__externalFloors3d = [];

    let wallEdges = scope.floorplan.externalWallEdges();

    let rooms = scope.floorplan.externalRooms;

    this.__drawBoundary();

    // draw floors
    for (i = 0; i < rooms.length; i++) {
      var threeFloor = new Floor3D(
        scope,
        rooms[i],
        scope.controls,
        this.__options
      );
      scope.__externalFloors3d.push(threeFloor);
    }

    for (i = 0; i < wallEdges.length; i++) {
      let edge3d = new Edge3D(
        scope,
        wallEdges[i],
        scope.controls,
        this.__options
      );
      scope.__externalEdges3d.push(edge3d);
    }

    scope.shouldRender = true;

    let floorplanCenter = scope.floorplan.getDimensions(true);
    scope.controls.target = floorplanCenter.clone();
    // scope.camera.position.set(floorplanCenter.x, 300, floorplanCenter.z * 5);
    // scope.controls.update();
  }

  getARenderer() {
    var renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });

    // scope.renderer.autoClear = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.needsUpdate = true;

    renderer.shadowMapSoft = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    // Warm soft backdrop (theme-aware) instead of stark white — gives the
    // canvas a premium, less "technical" feel.
    renderer.setClearColor(
      // Light mode: cool, clean light-grey backdrop (Coohom-style) instead of
      // the old warm beige. Dark mode unchanged. (Kept as a fallback under the
      // gradient background set below.)
      localStorage.getItem("isDarkMode") === "true" ? 0x191a1e : 0xf5f6f8,
      1
    );
    // COOHOM-STYLE SKY (LIGHT mode only; dark mode keeps its flat dark backdrop).
    // Three.js r118 does NOT reliably render a plain gradient texture as a
    // full-screen background, so instead we paint the gradient with CSS BEHIND a
    // transparent WebGL canvas — guaranteed to show, always full-screen. The 3D
    // content (walls, grid, items) draws opaquely on top. Additive + wrapped in
    // try/catch: on any failure it falls back to the flat clear colour.
    if (localStorage.getItem("isDarkMode") !== "true") {
      try {
        this.background = null; // don't paint over the CSS gradient
        renderer.setClearColor(0xffffff, 0); // transparent → CSS shows through
        if (renderer.domElement && renderer.domElement.style) {
          renderer.domElement.style.background =
            // A pale blue that washes out well before the horizon: enough to
            // read as sky and give the scene depth, light enough that it does
            // not tint the white surfaces underneath it.
            "linear-gradient(to bottom, #c9dded 0%, #e6eff6 45%, #ffffff 78%)";
        }
      } catch (e) {
        console.warn("gradient background failed — using flat colour", e);
        renderer.setClearColor(0xf5f6f8, 1);
      }
    }
    renderer.localClippingEnabled = false;
    // renderer.gammaOutput = false;
    // renderer.physicallyCorrectLights =
    renderer.outputEncoding = sRGBEncoding;
    renderer.setPixelRatio(window.devicePixelRatio);
    // renderer.sortObjects = false;
    return renderer;
  }

  setBackgroundColor(hex) {
    if (this.renderer) {
      this.renderer.setClearColor(hex, 1);
      this.needsUpdate = true;
    }
  }

  updateWindowSize() {
    // Size to the canvas CONTAINER (so a docked layout can reflow the 3D view);
    // fall back to the window only if the container has no size yet.
    let elementWidth = this.domElement.clientWidth;
    let elementHeight = this.domElement.clientHeight;
    if ((!elementWidth || !elementHeight) && this.__options.resize) {
      elementWidth = window.innerWidth - this.domElement.offsetLeft;
      elementHeight = window.innerHeight - this.domElement.offsetTop;
    }
    if (!elementWidth || !elementHeight) {
      return;
    }
    this.camera.aspect = elementWidth / elementHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(elementWidth, elementHeight);
    this.needsUpdate = true;
  }

  render() {
    if (!this.enabled) {
      // 3D view is OFF (e.g. user switched to the 2D FLOOR PLAN page). The
      // position boxes/lines are global HTML overlays, so hide them here or
      // they freeze on screen and bleed onto the 2D page.
      if (this.__dimLabels)
        this.__dimLabels.forEach((l) => {
          if (!l.__editing) l.style.display = "none";
        });
      if (this.__dimLines)
        this.__dimLines.forEach((ln) =>
          [ln.main, ln.t1, ln.t2].forEach((l) => (l.style.display = "none"))
        );
      return;
    }
    let scope = this;
    if (scope.__camTween) {
      // Animated camera fly-to (deliberate focus). Eases position + target.
      const tw = scope.__camTween;
      let k = (performance.now() - tw.start) / tw.duration;
      if (k > 1) k = 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOut
      scope.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      scope.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      scope.camera.lookAt(scope.controls.target);
      scope.camera.updateProjectionMatrix();
      scope.needsUpdate = true;
      if (k >= 1) scope.__camTween = null;
    } else if (scope.controls && scope.controls.enableDamping) {
      // Advance camera inertia (damping) so orbit/zoom/pan glide to a stop.
      scope.controls.update();
    }
    // Advance any active tweens (item pop-in, ghost pulse, …). Each `step(k)`
    // gets k in [0,1]; the anim is dropped once k reaches 1.
    if (scope.__anims && scope.__anims.length) {
      const now = performance.now();
      scope.__anims = scope.__anims.filter((a) => {
        let k = (now - a.start) / a.duration;
        if (k > 1) k = 1;
        try {
          a.step(k);
        } catch (e) {
          /* a broken anim must not kill the render loop */
        }
        if (k >= 1 && a.done) {
          try {
            a.done();
          } catch (e) {}
        }
        return k < 1;
      });
      scope.needsUpdate = true;
    }
    scope.updateDimensionLabels();
    if (!scope.needsUpdate) {
      return;
    }
    scope.renderer.render(scope, scope.camera);
    scope.lastRender = Date.now();
    this.needsUpdate = true;
  }

  // Coohom-style EDITABLE position labels for a selected door/window: the gap
  // to the left wall, the gap to the right wall, and the height off the floor.
  // Click a chip → type a new value → the door/window MOVES to that position.
  // Fully guarded: any missing data or error just hides the labels.
  updateDimensionLabels() {
    try {
      const scope = this;
      if (!scope.__dimLabels) {
        // Apply an edited value → move the item. kind: 0 left, 1 right, 2 height.
        const commitEdit = (label, val) => {
          try {
            if (!Number.isFinite(val)) return;
            // The chip is edited in the DISPLAY unit (mm/ft/…) — convert back to
            // cm (the internal working unit) before positioning the item.
            val = Dimensioning.cmFromMeasureRaw(val);
            const item = label.__item;
            const w = label.__wallCtx;
            if (!item || !w || !item.itemModel) return;
            let nx = item.position.x,
              ny = item.position.y,
              nz = item.position.z;
            if (label.__kind === 0) {
              const along = val + w.halfW; // centre = leftGap + halfWidth
              nx = w.sx + w.dx * along;
              nz = w.sy + w.dz * along;
            } else if (label.__kind === 1) {
              const along = w.wallLen - (val + w.halfW);
              nx = w.sx + w.dx * along;
              nz = w.sy + w.dz * along;
            } else if (label.__kind === 2) {
              // bottom gap: floor → window bottom
              ny = val + ((item.halfSize && item.halfSize.y) || 0);
            } else {
              // top gap: window top → ceiling. center = (ceiling - val) - halfY
              let wh = 280;
              try {
                wh = Configuration.getNumericValue(configWallHeight) || 280;
              } catch (e) {}
              ny = wh - val - ((item.halfSize && item.halfSize.y) || 0);
            }
            // Doors/windows move ALONG their wall via snapToWall (not the
            // free-position API). Feed it the new world point on the wall.
            const newPoint = new Vector3(nx, ny, nz);
            const wall = item.itemModel.currentWall;
            const wallEdge = item.itemModel.__currentWallEdge;
            if (typeof item.snapToWall === "function" && wall) {
              item.snapToWall(newPoint, wall, wallEdge);
            } else if (typeof item.snapToPoint === "function") {
              item.snapToPoint(
                newPoint,
                item.itemModel.__currentWallNormal || { x: 0, y: 0, z: 1 },
                { wall }
              );
            } else if (item.position && item.position.set) {
              item.position.set(nx, ny, nz);
            }
            try {
              BlueprintInterface.ProjectManagerService.updateFloorPlan(
                "Door/Window moved"
              );
            } catch (_) {}
            scope.needsUpdate = true;
          } catch (_) {}
        };
        // Hide the number-input spinner arrows so the box looks like Coohom's.
        const spinStyle = document.createElement("style");
        spinStyle.textContent =
          "input.pazl-dim-inp::-webkit-inner-spin-button," +
          "input.pazl-dim-inp::-webkit-outer-spin-button" +
          "{-webkit-appearance:none;margin:0;}";
        document.head.appendChild(spinStyle);
        scope.__dimLabels = [0, 1, 2, 3].map((kind) => {
          // Each chip is now an ALWAYS-VISIBLE input box sitting on the line
          // (like Coohom): a small bordered box with a typeable number + "cm".
          const d = document.createElement("div");
          d.style.cssText =
            "position:fixed;z-index:20;pointer-events:auto;cursor:text;" +
            "display:none;align-items:center;gap:2px;" +
            "background:#fff;border:1px solid #C2C1DB;border-radius:4px;" +
            "padding:1px 4px;font:500 11px sans-serif;color:#414063;" +
            "white-space:nowrap;transform:translate(-50%,-50%);" +
            "box-shadow:0 1px 3px rgba(0,0,0,0.25);";
          d.__kind = kind;
          d.title = "Type a new position, then press Enter";

          const inp = document.createElement("input");
          inp.type = "number";
          inp.className = "pazl-dim-inp";
          inp.style.cssText =
            "width:40px;border:none;outline:none;background:transparent;" +
            "text-align:center;font:500 11px sans-serif;color:#414063;" +
            "padding:0;margin:0;-moz-appearance:textfield;";
          const unit = document.createElement("span");
          unit.textContent = "cm"; // updated per-render to the global unit
          unit.style.cssText = "font:500 10px sans-serif;color:#8A88A8;";
          d.appendChild(inp);
          d.appendChild(unit);
          d.__input = inp;
          d.__unitEl = unit;

          // Clicks/drag on the box must not rotate or deselect the 3D scene.
          d.addEventListener("mousedown", (ev) => ev.stopPropagation());
          d.addEventListener("click", (ev) => ev.stopPropagation());
          inp.addEventListener("focus", () => {
            d.__editing = true;
            inp.select();
          });
          inp.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              inp.blur(); // blur commits
            } else if (e.key === "Escape") {
              d.__editing = false;
              inp.blur();
            }
          });
          inp.addEventListener("blur", () => {
            const wasEditing = d.__editing;
            d.__editing = false;
            if (wasEditing) commitEdit(d, Number(inp.value));
          });
          document.body.appendChild(d);
          return d;
        });
        // SVG overlay for the dimension LINES (main line + 2 end ticks each),
        // connecting every number to the wall/floor — matching Coohom's look.
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.style.cssText =
          "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
          "pointer-events:none;z-index:19;overflow:visible;";
        scope.__dimLines = [0, 1, 2, 3].map(() => {
          const mk = () => {
            const ln = document.createElementNS(NS, "line");
            ln.setAttribute("stroke", "#414063");
            ln.setAttribute("stroke-width", "1");
            ln.style.display = "none";
            svg.appendChild(ln);
            return ln;
          };
          return { main: mk(), t1: mk(), t2: mk() };
        });
        document.body.appendChild(svg);
        scope.__dimSvg = svg;
      }
      const labels = scope.__dimLabels;
      const hideLines = () => {
        if (scope.__dimLines)
          scope.__dimLines.forEach((ln) =>
            [ln.main, ln.t1, ln.t2].forEach((l) => (l.style.display = "none"))
          );
      };
      const hide = () => {
        labels.forEach((l) => {
          if (!l.__editing) l.style.display = "none";
        });
        hideLines();
      };

      // Only draw when the 3D canvas is actually on-screen. If it's hidden
      // (e.g. the 2D floor plan page is showing), keep the boxes hidden so
      // they never bleed onto the other page.
      const el = scope.domElement;
      if (!el || !el.isConnected || el.offsetParent === null) {
        hide();
        return;
      }

      const item =
        scope.__currentItemSelected ||
        (scope.dragcontrols && scope.dragcontrols.__selected);
      const im = item && item.itemModel;
      const wall = im && im.currentWall;
      if (
        !item ||
        !im ||
        !im.isParametric ||
        !wall ||
        !wall.start ||
        !wall.end ||
        !item.position
      ) {
        hide();
        return;
      }

      const s = wall.start.location;
      const e = wall.end.location;
      if (!s || !e) {
        hide();
        return;
      }
      const wx = e.x - s.x;
      const wz = e.y - s.y;
      const wallLen = Math.hypot(wx, wz);
      if (wallLen < 1e-3) {
        hide();
        return;
      }
      const dx = wx / wallLen;
      const dz = wz / wallLen;
      const t = (item.position.x - s.x) * dx + (item.position.z - s.y) * dz;
      const halfW = (item.halfSize && item.halfSize.x) || 0;
      const leftGap = Math.max(0, t - halfW);
      const rightGap = Math.max(0, wallLen - (t + halfW));
      const halfY = (item.halfSize && item.halfSize.y) || 0;
      const height = Math.max(0, item.position.y - halfY);
      const windowTop = item.position.y + halfY;
      // Ceiling / wall-top height, for the TOP gap (window top → ceiling).
      let wallTop = 280;
      try {
        wallTop = Configuration.getNumericValue(configWallHeight) || 280;
      } catch (e) {}
      const topGap = Math.max(0, wallTop - windowTop);
      const midY = item.position.y;
      const wallCtx = { sx: s.x, sy: s.y, dx, dz, wallLen, halfW };

      const leftAlong = t - halfW;
      const rightAlong = t + halfW;
      // Each measurement = a 3D line between two endpoints (a → b).
      const endpoints = [
        {
          a: { x: s.x, y: midY, z: s.y }, // left wall corner
          b: { x: s.x + dx * leftAlong, y: midY, z: s.y + dz * leftAlong }, // door left edge
        },
        {
          a: { x: s.x + dx * rightAlong, y: midY, z: s.y + dz * rightAlong }, // door right edge
          b: { x: s.x + dx * wallLen, y: midY, z: s.y + dz * wallLen }, // right wall corner
        },
        {
          a: { x: item.position.x, y: height, z: item.position.z }, // door bottom
          b: { x: item.position.x, y: 0, z: item.position.z }, // floor
        },
        {
          a: { x: item.position.x, y: windowTop, z: item.position.z }, // window top
          b: { x: item.position.x, y: wallTop, z: item.position.z }, // ceiling
        },
      ];
      const vals = [leftGap, rightGap, height, topGap];

      const rect = scope.domElement.getBoundingClientRect();
      const v = new Vector3();
      const proj = (p) => {
        v.set(p.x, p.y, p.z).project(scope.camera);
        if (v.z > 1) return null;
        return {
          x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
        };
      };
      // Current display unit → value converter + suffix (mm/ft/…), so the chips
      // track the global units toggle just like the floor plan.
      const dispSuffix =
        DIM_UNIT_SUFFIX[Configuration.getStringValue(configDimUnit)] || "cm";
      for (let i = 0; i < 4; i++) {
        const label = labels[i];
        label.__item = item;
        label.__wallCtx = wallCtx;
        const line = scope.__dimLines && scope.__dimLines[i];
        const A = proj(endpoints[i].a);
        const B = proj(endpoints[i].b);
        if (!A || !B) {
          if (!label.__editing) label.style.display = "none";
          if (line)
            [line.main, line.t1, line.t2].forEach(
              (l) => (l.style.display = "none")
            );
          continue;
        }
        if (line) {
          line.main.setAttribute("x1", A.x);
          line.main.setAttribute("y1", A.y);
          line.main.setAttribute("x2", B.x);
          line.main.setAttribute("y2", B.y);
          line.main.style.display = "block";
          const ddx = B.x - A.x;
          const ddy = B.y - A.y;
          const len = Math.hypot(ddx, ddy) || 1;
          const px = (-ddy / len) * 5;
          const py = (ddx / len) * 5;
          const setTick = (el, pt) => {
            el.setAttribute("x1", pt.x - px);
            el.setAttribute("y1", pt.y - py);
            el.setAttribute("x2", pt.x + px);
            el.setAttribute("y2", pt.y + py);
            el.style.display = "block";
          };
          setTick(line.t1, A);
          setTick(line.t2, B);
        }
        if (!label.__editing) {
          // Centre the box on the line, then nudge it OFF the line so the
          // number reads cleanly and horizontally (never overlapping the line):
          // the height line (i===2, vertical) → nudge right; the horizontal
          // gap lines → nudge up. The box itself is always screen-horizontal.
          let mx = (A.x + B.x) / 2;
          let my = (A.y + B.y) / 2;
          // vertical lines (bottom gap i===2, top gap i===3) → nudge right;
          // horizontal gap lines → nudge up.
          if (i === 2 || i === 3) mx += 20;
          else my -= 13;
          label.style.left = mx + "px";
          label.style.top = my + "px";
          if (label.__input)
            label.__input.value =
              Math.round(Dimensioning.cmToMeasureRaw(vals[i]) * 100) / 100;
          if (label.__unitEl) label.__unitEl.textContent = dispSuffix;
          label.style.display = "flex";
        }
      }
      scope.needsUpdate = true;
    } catch (_) {
      /* never break the render loop */
    }
  }

  prepareForExport() { }

  restoreAfterExport(tempParentItems) {
    for (let i = 0; i < this.__physicalRoomItems?.length; i++) {
      this.__physicalRoomItems[i].visible = true;
      let children = tempParentItems[i].children.slice(0);
      for (var j = 0; j < children.length; j++) {
        this.__physicalRoomItems[i].add(children[j]);
      }
    }
    this.__enabled = true;
    this.controls.enabled = true;
    this.dragcontrols.enabled = true;
    this.dragcontrols.activate();
    this.updateMatrixWorld();
  }

  exportSceneAsGTLF(binary = false, onResult = null, onError = null) {
    let scope = this;

    this.gridHelper.visible = false;
    // The tinted ground plane is view-only chrome. It must not reach the
    // exported GLB, or the render would bake in a 40000-unit grey slab.
    if (this.groundPlane) this.groundPlane.visible = false;
    let tempParentItems = [];
    for (let i = 0; i < this.__physicalRoomItems?.length; i++) {
      this.__physicalRoomItems[i].visible = false;
      let roomItem = this.__physicalRoomItems[i];
      let children = roomItem.children.slice(0); // Make a copy of the children array
      let tempParent = new Object3D();
      tempParent.position.copy(roomItem.position);
      tempParent.rotation.copy(roomItem.rotation);
      tempParent.scale.copy(roomItem.scale);
      for (var j = 0; j < children.length; j++) {
        tempParent.add(children[j]); // Add each child directly to the scene
      }
      this.add(tempParent);
      tempParentItems.push(tempParent);
    }

    this.edges3d.map((edge) => {
      edge.showAll();
    });

    // Three.js GLTFExporter throws "Cannot read 'width'" if any texture in the
    // scene has image: undefined (e.g. failed-to-load remote texture). Pre-walk
    // the scene, detach broken textures, restore them after export.
    const TEX_SLOTS = [
      "map",
      "normalMap",
      "roughnessMap",
      "metalnessMap",
      "aoMap",
      "emissiveMap",
      "bumpMap",
      "displacementMap",
      "alphaMap",
      "lightMap",
      "envMap",
      "specularMap",
    ];
    const detached = [];
    const isBrokenTexture = (tex) =>
      tex && (!tex.image || (tex.image.width === undefined && !(tex.image instanceof HTMLCanvasElement)));
    this.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        for (const slot of TEX_SLOTS) {
          if (isBrokenTexture(mat[slot])) {
            detached.push({ mat, slot, tex: mat[slot] });
            mat[slot] = null;
            mat.needsUpdate = true;
          }
        }
      }
    });
    if (detached.length) {
      console.warn(
        `GLTF export: temporarily detached ${detached.length} broken textures.`
      );
    }

    const restoreDetachedTextures = () => {
      for (const { mat, slot, tex } of detached) {
        mat[slot] = tex;
        mat.needsUpdate = true;
      }
    };

    // Phase 0 verification: count what we're exporting so we can confirm the
    // room leaves the app with geometry + materials + textures intact.
    let meshCount = 0;
    const matIds = new Set();
    const texIds = new Set();
    this.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      meshCount++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        matIds.add(m.uuid);
        for (const slot of TEX_SLOTS) {
          if (m[slot]) texIds.add(m[slot].uuid);
        }
      }
    });
    console.log(
      `[GLTF EXPORT] meshes=${meshCount} materials=${matIds.size} textures=${texIds.size} format=${
        binary ? "glb" : "gltf"
      }`
    );

    // Scale to METRES for export. glTF/Blender read 1 unit = 1 m, but the
    // engine works in centimetres, so exporting as-is makes the file 100x too
    // big. Wrap everything in a root scaled by 0.01 (cm -> m) so the exported
    // file is real-world size. The render camera (getCameraView) is scaled by
    // the SAME factor, so the Render feature stays consistent.
    const CM_TO_M = 0.01;
    const exportRoot = new Object3D();
    exportRoot.scale.setScalar(CM_TO_M);
    const wrappedChildren = scope.children.slice();
    wrappedChildren.forEach((c) => exportRoot.add(c));
    scope.add(exportRoot);
    scope.updateMatrixWorld(true);

    const finishExport = () => {
      // Unwrap the scaled export root FIRST so the scene graph is back to
      // normal before the item temp-parents are restored.
      wrappedChildren.forEach((c) => scope.add(c));
      scope.remove(exportRoot);
      scope.updateMatrixWorld(true);
      scope.gridHelper.visible = true;
      if (scope.groundPlane) scope.groundPlane.visible = true;
      scope.restoreAfterExport(tempParentItems);
      restoreDetachedTextures();
    };

    const downloadBlob = (blob, ext) => {
      const link = document.createElement("a");
      document.body.appendChild(link);
      link.href = URL.createObjectURL(blob);
      link.download = `pazl-${Date.now()}.${ext}`;
      link.click();
      document.body.removeChild(link);
    };

    let exporter = new GLTFExporter();
    try {
      exporter.parse(
        exportRoot,
        function (result) {
          try {
            if (onResult) {
              // Caller wants the raw export (e.g. upload to the render service)
              // instead of a download.
              onResult(result);
            } else if (binary) {
              // `result` is an ArrayBuffer: one self-contained .glb (geometry +
              // materials + embedded textures) ready for Blender import.
              downloadBlob(
                new Blob([result], { type: "model/gltf-binary" }),
                "glb"
              );
            } else {
              scope.dispatchEvent({
                type: EVENT_GLTF_READY,
                gltf: JSON.stringify(result),
              });
              downloadBlob(
                new Blob([JSON.stringify(result)], {
                  type: "application/json",
                }),
                "gltf"
              );
            }
          } finally {
            finishExport();
          }
        },
        { binary: binary, embedImages: true, onlyVisible: true }
      );
    } catch (e) {
      console.error("GLTF export failed:", e);
      finishExport();
      if (onError) onError(e);
    }
  }

  /**
   * Build a THROWAWAY container where every mesh of `item` is MERGED into one
   * mesh per combined group (Carcass, Door, …) — for the GLB export ONLY. The
   * app's live meshes are never touched (we clone geometry + reuse materials).
   * So the exported file opens in Blender as ONE object per group, while the app
   * keeps each panel separate for editing + BOQ. Returns null on any failure so
   * the caller can fall back to the raw (unmerged) export.
   *
   * Geometry is baked into `__loadedItem`'s local frame, and the container copies
   * __loadedItem's transform, so the merged result is geometrically identical to
   * the unmerged export — just fewer objects. Multi-material groups are kept via
   * geometry groups + a material array (Blender sees one object, many slots).
   */
  __buildMergedGroupsContainer(item) {
    try {
      const loaded = item && item.__loadedItem;
      if (!loaded) return null;
      item.updateMatrixWorld(true);
      loaded.updateMatrixWorld(true);
      // Version-safe inverse: three r118 has getInverse(), newer builds have
      // invert(). Using the wrong one threw and silently fell back to the raw
      // (unmerged, camera-carrying) export.
      const invLoaded = new Matrix4();
      if (typeof invLoaded.invert === "function") {
        invLoaded.copy(loaded.matrixWorld).invert();
      } else {
        invLoaded.getInverse(loaded.matrixWorld);
      }

      // component meshName ("Mesh_0") -> group name ("Carcass"), from the combine.
      const groupByMeshName = {};
      try {
        const comps =
          BlueprintInterface.ProjectManagerService.getFurnishedModelComponents(
            item.__itemModel.__id
          ) || [];
        comps.forEach((c) => {
          const key = c.meshName || c.name;
          if (key) groupByMeshName[key] = c.name || key;
        });
      } catch (e) {
        /* no components -> merge by mesh name instead */
      }

      // Collect meshes in traversal order and resolve each one's group using the
      // SAME key rule that created the components (measureAllComponents2D): the
      // clean "Mesh_N" name when present, else the traversal index. This keeps
      // the mesh<->component mapping correct even when the live mesh names don't
      // line up 1:1 with the stored meshNames.
      const meshList = [];
      loaded.traverse((o) => {
        if (o.isMesh && o.geometry) meshList.push(o);
      });
      const buckets = {};
      let matched = 0;
      meshList.forEach((o, i) => {
        const nm = String(o.name || "");
        // Map by TRAVERSAL INDEX first ("Mesh_<i>") — the source GLB often names
        // meshes non-sequentially (Mesh_11, Mesh_16, …) so the live name doesn't
        // match the stored component meshName (Mesh_0…N, catalog order). Index
        // order matches how the components were seeded, so it's the reliable key;
        // fall back to the live name.
        const mapped = groupByMeshName["Mesh_" + i] || groupByMeshName[nm];
        if (mapped) matched++;
        const gname = mapped || nm || "Mesh_" + i;
        let geom = o.geometry.index
          ? o.geometry.toNonIndexed()
          : o.geometry.clone();
        const rel = invLoaded.clone().multiply(o.matrixWorld);
        geom.applyMatrix4(rel);
        if (!geom.attributes.normal) geom.computeVertexNormals();
        const material = Array.isArray(o.material) ? o.material[0] : o.material;
        (buckets[gname] = buckets[gname] || []).push({ geom, material });
      });
      console.log(
        `[GLB merge] meshes=${meshList.length} matchedToComponents=${matched} groups=${
          Object.keys(buckets).length
        } ->`,
        Object.keys(buckets)
      );

      const groupNames = Object.keys(buckets);
      if (!groupNames.length) return null;

      const container = new Object3D();
      container.position.copy(loaded.position);
      container.quaternion.copy(loaded.quaternion);
      container.scale.copy(loaded.scale);

      for (const gname of groupNames) {
        const entries = buckets[gname];
        const matList = [];
        const matIndex = new Map();
        let totalVerts = 0;
        for (const e of entries) {
          totalVerts += e.geom.attributes.position.count;
          const uid = e.material ? e.material.uuid : "none";
          if (!matIndex.has(uid)) {
            matIndex.set(uid, matList.length);
            matList.push(e.material || new MeshStandardMaterial());
          }
        }
        const pos = new Float32Array(totalVerts * 3);
        const nor = new Float32Array(totalVerts * 3);
        const uv = new Float32Array(totalVerts * 2);
        const merged = new BufferGeometry();
        let vOff = 0;
        const groups = [];
        for (const e of entries) {
          const g = e.geom;
          const p = g.attributes.position;
          const n = g.attributes.normal;
          const u = g.attributes.uv;
          const count = p.count;
          // Read per-vertex via accessors (getX/Y/Z) — robust for both plain and
          // INTERLEAVED buffers (GLB commonly interleaves; a raw .array.subarray
          // would copy garbage from an interleaved buffer).
          for (let v = 0; v < count; v++) {
            const o3 = (vOff + v) * 3;
            pos[o3] = p.getX(v);
            pos[o3 + 1] = p.getY(v);
            pos[o3 + 2] = p.getZ(v);
            if (n) {
              nor[o3] = n.getX(v);
              nor[o3 + 1] = n.getY(v);
              nor[o3 + 2] = n.getZ(v);
            }
            if (u) {
              const o2 = (vOff + v) * 2;
              uv[o2] = u.getX(v);
              uv[o2 + 1] = u.getY(v);
            }
          }
          groups.push({
            start: vOff,
            count,
            mi: matIndex.get(e.material ? e.material.uuid : "none"),
          });
          vOff += count;
        }
        merged.setAttribute("position", new Float32BufferAttribute(pos, 3));
        merged.setAttribute("normal", new Float32BufferAttribute(nor, 3));
        merged.setAttribute("uv", new Float32BufferAttribute(uv, 2));
        if (matList.length > 1) {
          for (const gr of groups) merged.addGroup(gr.start, gr.count, gr.mi);
        }
        const mesh = new Mesh(merged, matList.length > 1 ? matList : matList[0]);
        mesh.name = String(gname).replaceAll(" ", "_");
        container.add(mesh);
      }
      return container;
    } catch (e) {
      console.warn(
        "__buildMergedGroupsContainer failed, exporting unmerged:",
        e && e.message
      );
      return null;
    }
  }

  // Clone a mesh flat (clone SHARES the geometry buffer — no rebuild, no
  // distortion) with its transform relative to `loaded` baked in. Used for loose
  // meshes and the folder fallback.
  __cloneMeshFlat(o, invLoaded) {
    const clone = o.clone(false);
    o.updateMatrixWorld(true);
    const rel = invLoaded.clone().multiply(o.matrixWorld);
    rel.decompose(clone.position, clone.quaternion, clone.scale);
    clone.name = String(o.name || "");
    return clone;
  }

  // Produce a CLEAN, non-indexed, non-interleaved geometry (position/normal/uv)
  // from any geometry — reading via getX/Y/Z, which correctly decodes INTERLEAVED
  // (packed) buffers. Three's toNonIndexed() reads interleaved data WRONG in this
  // old build (raw array index arithmetic), which scrambled the merge. This is the
  // fix: de-index AND de-interleave through the safe accessors, same as folders.
  __toCleanNonIndexed(geom) {
    const idx = geom.index;
    const pos = geom.attributes.position;
    const nor = geom.attributes.normal;
    const uv = geom.attributes.uv;
    const count = idx ? idx.count : pos.count;
    const outPos = new Float32Array(count * 3);
    const outNor = new Float32Array(count * 3);
    const outUv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(i) : i;
      outPos[i * 3] = pos.getX(v);
      outPos[i * 3 + 1] = pos.getY(v);
      outPos[i * 3 + 2] = pos.getZ(v);
      if (nor) {
        outNor[i * 3] = nor.getX(v);
        outNor[i * 3 + 1] = nor.getY(v);
        outNor[i * 3 + 2] = nor.getZ(v);
      }
      if (uv) {
        outUv[i * 2] = uv.getX(v);
        outUv[i * 2 + 1] = uv.getY(v);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(outPos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(outNor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(outUv, 2));
    if (!nor) g.computeVertexNormals();
    return g;
  }

  // Total triangle surface area of a NON-INDEXED geometry (every 3 verts = one
  // triangle). Used to validate a merge: a correct merge has the SAME area as the
  // sum of its parts; a scrambled one does not.
  __geomSurfaceArea(geom) {
    const pos = geom && geom.attributes && geom.attributes.position;
    if (!pos) return 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const cross = new Vector3();
    let area = 0;
    const n = pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      a.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      b.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      c.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      area += 0.5 * cross.length();
    }
    return area;
  }

  // Try to merge a group's meshes into ONE mesh with the OFFICIAL Three util,
  // then VALIDATE the result (count + bounding box + surface area). Returns the
  // merged Mesh on success, or null if the merge failed or looks wrong — so a bad
  // merge NEVER ships (the caller falls back to a folder).
  __tryMergeGroup(meshes, invLoaded, groupName) {
    try {
      const normalized = [];
      const materials = [];
      const union = new Box3();
      for (const o of meshes) {
        if (!o.geometry) continue;
        // CLEAN unpack (de-index + de-interleave the SAFE way) — this is the fix
        // for the sofa: the old toNonIndexed() misread its interleaved buffer.
        const keep = this.__toCleanNonIndexed(o.geometry);
        o.updateMatrixWorld(true);
        const rel = invLoaded.clone().multiply(o.matrixWorld);
        keep.applyMatrix4(rel);
        keep.computeBoundingBox();
        if (keep.boundingBox) union.union(keep.boundingBox);
        normalized.push(keep);
        materials.push(Array.isArray(o.material) ? o.material[0] : o.material);
      }
      if (!normalized.length) return null;

      const uniqueMats = Array.from(
        new Set(materials.map((m) => (m ? m.uuid : "none")))
      );
      const useGroups = uniqueMats.length > 1;
      const merged = BufferGeometryUtils.mergeBufferGeometries(
        normalized,
        useGroups
      );
      if (!merged || !merged.attributes || !merged.attributes.position)
        return null;

      // VALIDATE — a bad merge NEVER ships.
      const expected = normalized.reduce(
        (s, g) => s + g.attributes.position.count,
        0
      );
      const got = merged.attributes.position.count;
      if (got !== expected) return null;
      merged.computeBoundingBox();
      const ms = merged.boundingBox.getSize(new Vector3());
      const us = union.getSize(new Vector3());
      const finite = isFinite(ms.x) && isFinite(ms.y) && isFinite(ms.z);
      // merged size must match the parts' combined size (concatenation preserves
      // positions, so a correct merge matches closely; a broken one won't).
      const close = ["x", "y", "z"].every(
        (ax) => Math.abs(ms[ax] - us[ax]) <= Math.max(0.5, us[ax] * 0.02)
      );
      if (!finite || !close) {
        console.warn(
          `[GLB merge] group "${groupName}" FAILED size validation — using folder.`
        );
        return null;
      }

      // STRONGER check: surface area. A correct merge is just a concatenation, so
      // its total triangle area EXACTLY equals the sum of the parts' areas. A
      // scrambled merge (torn/fanned triangles) has a wildly different area — this
      // catches the internal scramble that size/count validation misses.
      const partsArea = normalized.reduce(
        (s, gg) => s + this.__geomSurfaceArea(gg),
        0
      );
      const mergedArea = this.__geomSurfaceArea(merged);
      const areaOk =
        partsArea > 0 &&
        Math.abs(mergedArea - partsArea) <= partsArea * 0.02;
      if (!areaOk) {
        console.warn(
          `[GLB merge] group "${groupName}" FAILED area validation (parts=${partsArea.toFixed(
            1
          )} merged=${mergedArea.toFixed(1)}) — using folder.`
        );
        return null;
      }

      const material = useGroups
        ? materials.map((m) => m || new MeshStandardMaterial())
        : materials[0] || new MeshStandardMaterial();
      const mesh = new Mesh(merged, material);
      mesh.name = String(groupName).replaceAll(" ", "_");
      console.log(
        `[GLB merge] group "${groupName}" merged OK (${meshes.length} -> 1 object)`
      );
      return mesh;
    } catch (e) {
      console.warn(
        `[GLB merge] group "${groupName}" merge error — using folder:`,
        e && e.message
      );
      return null;
    }
  }

  /**
   * SAFE, VALIDATED grouping for export. Each combined group (Footer, Carcass…):
   *   1. Tries to MERGE into ONE object (official Three util).
   *   2. VALIDATES it (vertex count + bounding box).
   *   3. If it passes → ONE object (client requirement met).
   *      If it fails  → a FOLDER of correct-shape parts (never crumpled).
   * Ungrouped meshes stay loose. The live scene is untouched (works on clones).
   */
  __buildGroupedFoldersContainer(item) {
    try {
      const loaded = item && item.__loadedItem;
      if (!loaded) return null;
      item.updateMatrixWorld(true);
      loaded.updateMatrixWorld(true);
      const invLoaded = new Matrix4();
      if (typeof invLoaded.invert === "function") {
        invLoaded.copy(loaded.matrixWorld).invert();
      } else {
        invLoaded.getInverse(loaded.matrixWorld);
      }

      // component meshName ("Mesh_0") -> group name ("Footer") from the combine.
      const groupByMeshName = {};
      try {
        const comps =
          BlueprintInterface.ProjectManagerService.getFurnishedModelComponents(
            item.__itemModel.__id
          ) || [];
        comps.forEach((c) => {
          const key = c.meshName || c.name;
          if (key) groupByMeshName[key] = c.name || key;
        });
      } catch (e) {
        /* no components -> everything stays loose */
      }

      const container = new Object3D();
      container.position.copy(loaded.position);
      container.quaternion.copy(loaded.quaternion);
      container.scale.copy(loaded.scale);

      const meshList = [];
      loaded.traverse((o) => {
        if (o.isMesh) meshList.push(o);
      });
      if (!meshList.length) return null;

      const isRawMeshName = (n) => /^mesh[\s_]*\d+$/i.test(String(n || ""));

      // Bucket meshes by their group name (keeping first-seen order).
      const buckets = {};
      const order = [];
      meshList.forEach((o, i) => {
        const nm = String(o.name || "");
        const gname =
          groupByMeshName["Mesh_" + i] ||
          groupByMeshName[nm] ||
          nm ||
          "Mesh_" + i;
        if (!buckets[gname]) {
          buckets[gname] = [];
          order.push(gname);
        }
        buckets[gname].push(o);
      });

      for (const gname of order) {
        const meshes = buckets[gname];
        if (isRawMeshName(gname)) {
          // ungrouped mesh -> loose
          meshes.forEach((o) =>
            container.add(this.__cloneMeshFlat(o, invLoaded))
          );
          continue;
        }
        // real group -> TRY validated merge into ONE object (with the fixed clean
        // unpacker). If it still fails validation, fall back to a correct-shape
        // folder (Ctrl+J in Blender). Client requirement: one object when safe.
        const merged = this.__tryMergeGroup(meshes, invLoaded, gname);
        if (merged) {
          container.add(merged);
        } else {
          const folder = new Object3D();
          folder.name = String(gname).replaceAll(" ", "_");
          meshes.forEach((o) =>
            folder.add(this.__cloneMeshFlat(o, invLoaded))
          );
          container.add(folder);
        }
      }

      return container;
    } catch (e) {
      console.warn(
        "__buildGroupedFoldersContainer failed, exporting flat:",
        e && e.message
      );
      return null;
    }
  }

  /**
   * Download ONLY the currently-selected item as its own self-contained binary
   * .glb (geometry + materials + embedded textures) — the single-model version
   * of exportSceneAsGTLF. Combined groups are MERGED into one object each in the
   * exported file (see __buildMergedGroupsContainer); the app's meshes stay
   * separate. Exports at origin, upright, preserving the resized SCALE (room
   * position/rotation are placement, dropped). Returns false if nothing selected.
   */
  exportSelectedItemAsGLB(onError = null) {
    const scope = this;
    const item =
      (BlueprintInterface &&
        BlueprintInterface.selectedModels &&
        BlueprintInterface.selectedModels[0]) ||
      (this.dragcontrols && this.dragcontrols.__selected);
    const loaded = item && item.__loadedItem;
    if (!item || !loaded) {
      if (onError) onError(new Error("No model selected"));
      return false;
    }

    // OPTION C (safe): organise meshes into FOLDERS named after each combined
    // group (Footer, Carcass…) WITHOUT rebuilding geometry — clones share the
    // geometry buffer, so the shape is never distorted. Blender then shows the
    // group names as folders. Falls back to the flat `loaded` export if it fails.
    const grouped = this.__buildGroupedFoldersContainer(item);
    const usedMerge = !!(grouped && grouped.children && grouped.children.length);
    const exportContent = usedMerge ? grouped : loaded;

    // Temporarily detach broken textures (image: undefined) — GLTFExporter
    // throws "Cannot read 'width'" on them. Restored after export.
    const TEX_SLOTS = [
      "map",
      "normalMap",
      "roughnessMap",
      "metalnessMap",
      "aoMap",
      "emissiveMap",
      "bumpMap",
      "displacementMap",
      "alphaMap",
      "lightMap",
      "envMap",
      "specularMap",
    ];
    const isBrokenTexture = (tex) =>
      tex &&
      (!tex.image ||
        (tex.image.width === undefined &&
          !(tex.image instanceof HTMLCanvasElement)));
    const detached = [];
    exportContent.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        for (const slot of TEX_SLOTS) {
          if (isBrokenTexture(mat[slot])) {
            detached.push({ mat, slot, tex: mat[slot] });
            mat[slot] = null;
            mat.needsUpdate = true;
          }
        }
      }
    });

    // Wrap the export content in a root at origin, scaled by the item's own
    // scale and cm -> m, so the file is real-world size and only contains this
    // model. In merge mode the live `loaded` mesh is NEVER moved (the container
    // holds cloned geometry); in fallback mode we move `loaded` and restore it.
    const CM_TO_M = 0.01;
    const originalParent = usedMerge ? null : loaded.parent;
    const exportRoot = new Object3D();
    exportRoot.scale.copy(item.scale).multiplyScalar(CM_TO_M);
    exportRoot.add(exportContent);
    scope.add(exportRoot);
    scope.updateMatrixWorld(true);

    const restore = () => {
      if (!usedMerge && originalParent) originalParent.add(loaded);
      scope.remove(exportRoot);
      scope.updateMatrixWorld(true);
      for (const { mat, slot, tex } of detached) {
        mat[slot] = tex;
        mat.needsUpdate = true;
      }
    };

    const safeName =
      String(
        (item.__itemModel &&
          item.__itemModel.__metadata &&
          item.__itemModel.__metadata.itemName) ||
          "model"
      )
        .trim()
        .replace(/[^\w\-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "model";

    try {
      const exporter = new GLTFExporter();
      exporter.parse(
        exportRoot,
        function (result) {
          try {
            const blob = new Blob([result], { type: "model/gltf-binary" });
            const link = document.createElement("a");
            document.body.appendChild(link);
            link.href = URL.createObjectURL(blob);
            link.download = `${safeName}.glb`;
            link.click();
            document.body.removeChild(link);
          } finally {
            restore();
          }
        },
        { binary: true, embedImages: true, onlyVisible: true }
      );
    } catch (e) {
      console.error("Single-model GLB export failed:", e);
      restore();
      if (onError) onError(e);
    }
    return true;
  }

  /**
   * Export the current room as a binary .glb and resolve the ArrayBuffer
   * (instead of downloading it) — used by the photorealistic Render feature to
   * upload the scene to the render service.
   * @returns {Promise<ArrayBuffer>}
   */
  /**
   * List every distinct material in the scene, for the render Materials panel.
   *
   * Materials are keyed by NAME because that is the only handle that survives
   * the glTF export into Blender — uuids are regenerated on import. Meshes that
   * share a material are therefore one entry, and editing it affects all of
   * them (the same rule Enscape's material list follows).
   *
   * The raw material names are whatever the model's author left behind, and are
   * often meaningless to a designer ("initialShadingGroup", "material"), so the
   * OWNING ITEM's name is reported alongside as the human label. Returns:
   *   [{ name, label, detail, color, hasTexture, itemNames, meshCount }]
   */
  listMaterials() {
    const byName = new Map();
    // A textured material keeps .color = white and gets its real look from the
    // picture, so reading .color shows white for every fabric/wood surface.
    // Instead, shrink the texture to a single pixel — the average colour — so
    // the swatch and colour picker show what the surface actually looks like.
    const avgColorOf = (image) => {
      try {
        if (!image || (!image.width && !image.naturalWidth)) return null;
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const ctx = c.getContext("2d");
        ctx.drawImage(image, 0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return (
          "#" +
          [d[0], d[1], d[2]]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("")
        );
      } catch (_) {
        // Cross-origin textures taint the canvas — fall back to .color.
        return null;
      }
    };
    try {
      this.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        // Walk up to the Physical3DItem that owns this mesh: it gives a name a
        // human recognises, and skips helper geometry (gizmos, grid, boxhelper).
        let owner = obj;
        while (owner && !owner.itemModel && owner.parent) owner = owner.parent;
        const itemName =
          (owner &&
            owner.itemModel &&
            owner.itemModel.__metadata &&
            owner.itemModel.__metadata.itemName) ||
          "Room";

        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          // The name is the KEY (Blender matches on it), even when it's junk.
          const name = m.name && m.name.trim() ? m.name : `${itemName} surface`;
          const entry = byName.get(name);
          if (entry) {
            entry.meshCount += 1;
            entry.itemNames.add(itemName);
            continue;
          }
          // A colour map means the surface's real look comes from a picture,
          // not from .color (which is usually left white underneath it).
          const hasTexture = !!(m.map && m.map.image);
          let color = "#cccccc";
          const sampled = hasTexture ? avgColorOf(m.map.image) : null;
          if (sampled) {
            color = sampled; // the texture's average — what the eye sees
          } else {
            try {
              if (m.color && m.color.getHexString) {
                color = `#${m.color.getHexString()}`;
              }
            } catch (_) {}
          }
          byName.set(name, {
            name,
            color,
            hasTexture,
            itemNames: new Set([itemName]),
            meshCount: 1,
          });
        }
      });
    } catch (e) {
      console.warn("listMaterials failed", e);
    }

    // Model authors rarely name their materials usefully — these are the
    // defaults exporters leave behind, and they say nothing about the part.
    const isJunkName = (n) =>
      /^(material|lambert\d*|phong\d*|blinn\d*|initialshadinggroup|standardsurface\d*|defaultmaterial|default|untitled)(\.\d+)?$/i.test(
        n.trim()
      );

    const entries = Array.from(byName.values()).map((e) => ({
      ...e,
      items: Array.from(e.itemNames),
    }));

    // How many materials does each item own? An item with several needs its
    // parts distinguished; an item with one is just "Sofa".
    const perItem = new Map();
    for (const e of entries) {
      const key = e.items[0];
      perItem.set(key, (perItem.get(key) || 0) + 1);
    }
    const seen = new Map();

    return entries
      .map((e) => {
        const items = e.items;
        const owner = items[0];
        let label = owner;

        if (perItem.get(owner) > 1) {
          // Several parts: name them by the material when the author gave it a
          // real name, otherwise number them ("Sofa - part 2"). Numbering is
          // honest — we genuinely don't know which part is the seat.
          const idx = (seen.get(owner) || 0) + 1;
          seen.set(owner, idx);
          label = isJunkName(e.name)
            ? `${owner} - part ${idx}`
            : `${owner} - ${e.name}`;
        }
        // A shared material changes every item using it — say so up front.
        if (items.length > 1) label += ` (+${items.length - 1} more)`;

        return {
          name: e.name,
          label,
          detail: isJunkName(e.name) ? "" : e.name,
          color: e.color,
          hasTexture: e.hasTexture,
          itemNames: items,
          meshCount: e.meshCount,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Fade the walls and floor so the whole plan reads at a glance instead of
   * being a closed white box — the "doll-house" overhead view.
   *
   * @param {Number} wall  1 = solid, 0 = invisible.
   * @param {Number} floor 1 = solid, 0 = invisible.
   *
   * Purely a VIEW setting: it is never saved with the design, and the render
   * exports its own copy of the scene, so a faded wall here can never end up
   * in a photorealistic render.
   */
  setSurfaceOpacity(wall = 1, floor = 1) {
    const clamp = (v) => Math.min(Math.max(Number(v), 0), 1);
    const wallOpacity = clamp(wall);
    const floorOpacity = clamp(floor);
    try {
      this.edges3d.forEach((edge) => {
        if (edge && typeof edge.setOpacity === "function") {
          edge.setOpacity(wallOpacity);
        }
      });
      this.floors3d.forEach((f) => {
        const mesh = f && f.floorPlane;
        if (!mesh || !mesh.material) return;
        const faded = floorOpacity < 1;
        mesh.material.transparent = faded;
        mesh.material.opacity = floorOpacity;
        mesh.material.depthWrite = !faded;
        mesh.material.needsUpdate = true;
      });
      this.needsUpdate = true;
    } catch (e) {
      console.warn("setSurfaceOpacity failed", e);
    }
  }

  exportSceneAsGLBBuffer() {
    return new Promise((resolve, reject) => {
      try {
        this.exportSceneAsGTLF(true, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Snapshot the current camera so the render matches the on-screen view.
   * Coordinates are in the same (Three.js, Y-up) space as the glTF export;
   * the Blender side converts them.
   */
  getCameraView() {
    const cam = this.camera;
    const target =
      this.controls && this.controls.target
        ? this.controls.target
        : { x: 0, y: 0, z: 0 };
    // The exported glb is scaled cm -> m (0.01). Scale the camera position the
    // SAME way so it sits correctly relative to the metre-scale geometry in the
    // render. (FOV/aspect are scale-independent.)
    const S = 0.01;
    return {
      position: [cam.position.x * S, cam.position.y * S, cam.position.z * S],
      target: [target.x * S, target.y * S, target.z * S],
      fov: cam.isPerspectiveCamera ? cam.fov : 50,
      aspect: cam.aspect || 16 / 9,
    };
  }

  /*saveString( text, filename ) {
        save( new Blob( [ text ], { type: 'text/plain' } ), filename );
    }


    saveArrayBuffer( buffer, filename ) {
        save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );
    }*/

  forceRender() {
    let scope = this;
    scope.renderer.render(scope, scope.camera);
    scope.lastRender = Date.now();
  }

  addRoomplanListener(type, listener) {
    this.addEventListener(type, listener);
  }

  removeRoomplanListener(type, listener) {
    this.removeEventListener(type, listener);
  }

  get environmentCamera() {
    return this.__environmentCamera;
  }

  get physicalRoomItems() {
    return this.__physicalRoomItems;
  }

  get enabled() {
    return this.__enabled;
  }

  set enabled(flag) {
    this.__enabled = flag;
    this.controls.enabled = flag;
    if (!flag) {
      this.dragcontrols.deactivate();
    } else {
      this.dragcontrols.activate();
    }
  }
}
