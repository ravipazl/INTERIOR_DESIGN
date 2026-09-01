import {
  Mesh,
  Box3,
  Vector3,
  ArrowHelper,
  Matrix4,
  sRGBEncoding,
  PerspectiveCamera,
  MeshPhongMaterial,
  TextureLoader,
  RepeatWrapping,
  MeshBasicMaterial,
  Group,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import {
  EVENT_ITEM_LOADED,
  EVENT_ITEM_LOADING,
  EVENT_UPDATED,
  EVENT_PARAMETRIC_GEOMETRY_UPATED,
  EVENT_ITEM_SELECTED,
} from "../core/events";
import {
  BoxBufferGeometry,
  LineBasicMaterial,
  LineSegments,
  EdgesGeometry,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import gsap from "gsap";
import { Utils } from "../core/utils";
import { Vector2 } from "three/build/three.module";
import { InWallFloorItem } from "../items/in_wall_floor_item";
import { convertAngleToEulersUnit } from "@pazl/utils/unitsUtils";
import BlueprintInterface from "@pazl/blueprint-interface";
import { ModelsService } from "@pazl/services/ModelsService";
import { MODEL_TYPES } from "@pazl/entities/Model";

export class Physical3DItem extends Mesh {
  constructor(itemModel, opts) {
    super();
    this.__itemModel = itemModel;
    this.__box = null;
    this.__boxboundry = null;
    this.__arrowHelper = new ArrowHelper();
    this.__center = null;
    this.__corner = null;
    this.__size = null;
    this.__selected = false;
    this.perspectivecamera = null;
    this.camera = null;
    this.__currentPosition = new Vector3();
    this.__options = opts;
    this.__itemType = null;
    this.halfSize = new Vector3(0, 0, 0);

    this.__selectedMaterial = new LineBasicMaterial({
      color: 0x0000f0, // BLUE outline when the item is CLICKED/selected
      linewidth: 1,
    });
    // Bright, vivid CYAN outline shown automatically on HOVER (mouse over item).
    this.__hoverMaterial = new LineBasicMaterial({
      color: 0x00e5ff,
      linewidth: 1,
    });
    this.__hovered = false;

    this.__boxhelper = new LineSegments(
      new EdgesGeometry(new BoxBufferGeometry(1, 1, 1)),
      this.__selectedMaterial
    );

    this.camera = new PerspectiveCamera(45, 10, 10, 500);
    this.__customIntersectionPlanes = []; // Useful for intersecting only wall planes, only floorplanes, only ceiling planes etc

    this.__gltfLoader = new GLTFLoader();
    this.__gltfLoadingProgressEvent = this.__gltfLoadingProgress.bind(this);
    this.__gltfLoadedEvent = this.__gltfLoaded.bind(this);
    this.__itemUpdatedEvent = this.__itemUpdated.bind(this);
    this.__replaceHandleEvent = this.__replaceHandle.bind(this);
    this.__displayBoxHelperEvent = this.__displayBoxHelper.bind(this);
    this.__parametricGeometryUpdateEvent =
      this.__parametricGeometryUpdate.bind(this);

    let txt = new TextureLoader().load("assets/rooms/wood_.jpg");
    txt.repeat.set(Math.round(this.__itemModel.__scale.x), 1);

    /* Color Or Texture Mapping Model */
    this.__INITIAL_MTL = new MeshPhongMaterial({ map: txt, shininess: 10 });
    this.__INITIAL_MTL.map.repeat.set(
      Math.round(this.__itemModel.__scale.x),
      1
    );
    /* this.__INITIAL_MTL = new MeshPhongMaterial({
      color: 0xf1f1f1,
      shininess: 10,
    }); */

    this.__itemModel.addEventListener(EVENT_UPDATED, this.__itemUpdatedEvent);
    this.add(this.__boxhelper);
    this.add(this.__arrowHelper);
    //this.add(this.camera);
    this.__boxhelper.material.linewidth = 1;
    this.selected = false;
    this.position.copy(this.__itemModel.position);
    if (this.__itemModel.isParametric) {
      this.__createParametricItem();
    } else {
      this.__loadItemModel();
    }
  }

  __parametricGeometryUpdate(evt) {
    let mLocal = new Matrix4().getInverse(this.matrixWorld);
    this.__loadedItem.geometry = this.__itemModel.parametricClass.geometry;
    this.parent.needsUpdate = true;
    this.__box = this.__loadedItem.geometry.boundingBox.clone(); //new Box3().setFromObject(this.__loadedItem);
    this.__center = this.__box.getCenter(new Vector3());
    this.__size = this.__box.getSize(new Vector3());
    let localCenter = this.__center.clone().applyMatrix4(mLocal);
    let m = new Matrix4();
    m = m.makeTranslation(-localCenter.x, -localCenter.y, -localCenter.z);
    this.__boxhelper.geometry = new EdgesGeometry(
      new BoxBufferGeometry(this.__size.x, this.__size.y, this.__size.z)
    );
    this.__boxhelper.geometry.applyMatrix4(m);
    this.__boxhelper.rotation.x = this.__itemModel.combinedRotation.x;
    this.__boxhelper.rotation.y = this.__itemModel.combinedRotation.y;
    this.__boxhelper.rotation.z = this.__itemModel.combinedRotation.z;

    // For a DOOR, the box math above lands at the wrong spot (the box floats
    // away when a property like colour changes). Re-align it to the door's
    // CURRENT mesh with the same world-aligned rebuild used on click/hover.
    // Doors only — every other item keeps the box built above.
    try {
      const md = this.__itemModel && this.__itemModel.__metadata;
      const isDoor =
        md &&
        (md.itemType === 7 ||
          String(md.baseParametricType || "")
            .toUpperCase()
            .indexOf("DOOR") >= 0);
      if (isDoor && typeof this.refreshSelectionBox === "function") {
        this.refreshSelectionBox();
      }
    } catch (e) {
      /* best-effort — never break for a selection outline */
    }
  }

  __itemUpdated(evt) {
    /* PERF-REMOVED */ // console.debug("Physical3DItem.js ~ __itemUpdated ~ evt", evt);
    if (evt?.property === "uniformSize") {
      /* PERF-REMOVED console.log: console.log(
        "[resize v2] __itemUpdated received uniformSize ~ offlineUpdate:",
        this.__itemModel?.offlineUpdate
      ); */
    }
    let scope = this;
    let duration = 0.25;

    if (!scope.parent) {
      return;
    }

    if (evt.property === "depth") {
      if (Math.abs(scope.__itemModel.__currentWallNormal.z)) {
        scope.__size.set(scope.__size.x, scope.__size.y, evt.size.z);
        scope.__itemModel.__size.set(
          scope.__itemModel.__size.x,
          scope.__itemModel.__size.y,
          evt.size.z
        );
        scope.__itemModel.scale.set(
          scope.__itemModel.scale.x,
          scope.__itemModel.scale.y,
          evt.scale
        );
        //scope.scale.z = evt.scale;
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      } else {
        scope.__size.set(evt.size.z, scope.__size.y, scope.__size.z);
        scope.__itemModel.__size.set(
          evt.size.z,
          scope.__itemModel.__size.y,
          scope.__itemModel.__size.z
        );
        scope.__itemModel.scale.set(
          evt.scale,
          scope.__itemModel.scale.y,
          scope.__itemModel.scale.z
        );
        //scope.scale.x = evt.scale;
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      }
    }

    function __tinyUpdate() {
      if (scope.parent) {
        scope.parent.needsUpdate = true;
      }
    }

    // "uniformSize" — the W/H/D Properties edits resize the item
    // uniformly: one factor applied to all three axes. The model keeps
    // its shape and there is no cross-axis coupling possible.
    //
    // This handler MUST run regardless of `offlineUpdate`. A user-driven
    // resize is an explicit, immediate edit — not an animated property
    // movement — so it lives OUTSIDE the offlineUpdate gate. Floor items
    // keep offlineUpdate=true permanently, and a resize must still apply.
    if (evt.property === "uniformSize") {
      /* PERF-REMOVED */ // console.log("[resize v2] engine uniformSize handler ~ scale", evt.scale);
      scope.__itemModel.__scale.set(evt.scale, evt.scale, evt.scale);
      scope.__initializeChildItem();
      scope.parent.model.updateRoomItemHeight(scope);
      scope.parent.__roomItemSelected({
        type: EVENT_ITEM_SELECTED,
        item: scope,
      });
      if (scope.parent.model) {
        scope.parent.model.updateRoomItemPosition(scope);
      }
      return;
    }

    // "sizeAbsolute" — set ALL THREE axis scales at once from an absolute
    // [sx, sy, sz] vector the caller computed from target W/H/D + the constant
    // native box. Derived from the target dimensions (never from the current
    // mesh), so repeated edits do NOT drift (1200 → 600 → 1200 = original).
    //
    // Placed OUTSIDE the offlineUpdate gate ON PURPOSE — floor items keep
    // offlineUpdate=true permanently, and a user resize must still apply
    // (same reason as the uniformSize handler above).
    if (evt.property === "sizeAbsolute" && Array.isArray(evt.scaleVec)) {
      scope.__itemModel.__scale.set(
        evt.scaleVec[0],
        evt.scaleVec[1],
        evt.scaleVec[2]
      );
      scope.__initializeChildItem();
      scope.parent.model.updateRoomItemHeight(scope);
      scope.parent.__roomItemSelected({
        type: EVENT_ITEM_SELECTED,
        item: scope,
      });
      return;
    }

    if (!scope.__itemModel.offlineUpdate) {
      if (evt.property === "position") {
        if (evt.position) {
          const position = evt.position;
          scope.position.set(position.x, position.y, position.z);
        } else {
          scope.position.set(
            scope.__itemModel.position.x,
            scope.__itemModel.position.y,
            scope.__itemModel.position.z
          );
        }
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
        // gsap.to(this.position, { duration: duration, x: this.__itemModel.position.x, onUpdate: __tinyUpdate });
        // gsap.to(this.position, { duration: duration, y: this.__itemModel.position.y });
        // gsap.to(this.position, { duration: duration, z: this.__itemModel.position.z });
      }

      // "size" handles width (x), height (y) AND depth (z). "depth" is an
      // alias kept for older callers. Each axis updates only its own
      // component of __scale; the other two are preserved.
      //
      // CRITICAL: the two unchanged axes are read from __loadedItem.scale
      // (the REAL rendered scale ÷ 100), NOT from __itemModel.__scale.
      // __scale can desync from the rendered mesh — and if a width edit
      // wrote back a stale __scale.y, __initializeChildItem would re-apply
      // it and silently change the height. Reading the live loadedItem
      // scale guarantees a single-axis edit never disturbs the others.
      if (evt.property === "size" || evt.property === "depth") {
        const li = scope.__loadedItem;
        const realX = li ? li.scale.x / 100 : scope.__itemModel.scale.x;
        const realY = li ? li.scale.y / 100 : scope.__itemModel.scale.y;
        const realZ = li ? li.scale.z / 100 : scope.__itemModel.scale.z;
        if (evt?.size?.x) {
          scope.__itemModel.__scale.set(evt.scale, realY, realZ);
        } else if (evt?.size?.y) {
          scope.__itemModel.__scale.set(realX, evt.scale, realZ);
        } else if (evt?.size?.z) {
          scope.__itemModel.__scale.set(realX, realY, evt.scale);
        }
        scope.__initializeChildItem();
        scope.parent.model.updateRoomItemHeight(scope);
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      }

      if (evt.property === "combinedRotation") {
        if (evt.rotationY || evt.rotationY === 0) {
          let rotation = evt.rotationY
            ? convertAngleToEulersUnit(evt.rotationY)
            : 0;
          rotation = Math.abs(evt.rotationY) === 360 ? 0 : rotation;
          scope.rotation.set(0, rotation, 0);
        } else if (scope.__loadedItem) {
          scope.__loadedItem.rotation.set(
            scope.__itemModel.combinedRotation.x,
            scope.__itemModel.combinedRotation.y,
            scope.__itemModel.combinedRotation.z
          );
        }
        scope.__boxhelper.rotation.set(
          scope.__itemModel.combinedRotation.x,
          scope.__itemModel.combinedRotation.y,
          scope.__itemModel.combinedRotation.z
        );
        if (scope.__loadedItem) {
          gsap.to(scope.__loadedItem.rotation, {
            duration: duration,
            x: scope.__itemModel.combinedRotation.x,
            onUpdate: __tinyUpdate,
          });
          gsap.to(scope.__loadedItem.rotation, {
            duration: duration,
            y: scope.__itemModel.combinedRotation.y,
          });
          gsap.to(scope.__loadedItem.rotation, {
            duration: duration,
            z: scope.__itemModel.combinedRotation.z,
          });
        }
        gsap.to(scope.__boxhelper.rotation, {
          duration: duration,
          x: scope.__itemModel.combinedRotation.x,
        });
        gsap.to(scope.__boxhelper.rotation, {
          duration: duration,
          y: scope.__itemModel.combinedRotation.y,
        });
        gsap.to(scope.__boxhelper.rotation, {
          duration: duration,
          z: scope.__itemModel.combinedRotation.z,
        });
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      }
    } else {
      if (evt.property === "position") {
        if (evt.position) {
          const position = evt.position;
          scope.position.set(position.x, position.y, position.z);
        } else {
          scope.position.set(
            scope.__itemModel.position.x,
            scope.__itemModel.position.y,
            scope.__itemModel.position.z
          );
        }
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      }

      if (evt.property === "size") {
        /* PERF-REMOVED console.debug: console.debug(
          "Physical3DItem.js ~ __itemUpdated ~ size changed",
          evt.size,
          this.scale.x
        ); */
        if (evt?.size?.x) {
          scope.__itemModel.__scale.set(
            evt.scale,
            scope.__itemModel.scale.y,
            scope.__itemModel.scale.z
          );
        } else if (evt?.size?.y) {
          scope.__itemModel.__scale.set(
            scope.__itemModel.scale.x,
            evt.scale,
            scope.__itemModel.scale.z
          );
        }
        scope.__initializeChildItem();
        scope.parent.model.updateRoomItemHeight(scope);
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      }

      if (evt.property === "combinedRotation") {
        if (evt.rotationY || evt.rotationY === 0) {
          let rotation = evt.rotationY
            ? convertAngleToEulersUnit(evt.rotationY)
            : 0;
          rotation = Math.abs(evt.rotationY) === 360 ? 0 : rotation;
          scope.rotation.set(0, rotation, 0);
        } else if (scope.__loadedItem) {
          scope.__loadedItem.rotation.set(
            scope.__itemModel.combinedRotation.x,
            scope.__itemModel.combinedRotation.y,
            scope.__itemModel.combinedRotation.z
          );
        }
        scope.__boxhelper.rotation.set(
          scope.__itemModel.combinedRotation.x,
          scope.__itemModel.combinedRotation.y,
          scope.__itemModel.combinedRotation.z
        );
        scope.parent.__roomItemSelected({
          type: EVENT_ITEM_SELECTED,
          item: scope,
        });
      }
    }
    if (evt.property === "visible") {
      scope.visible = scope.__itemModel.visible;
    }
    if (scope.parent.model) {
      // Update the room item corresponding to the physical 3d item
      scope.parent.model.updateRoomItemPosition(scope);
    }
  }

  __replaceHandle(newHandle, furnishedModelComponents) {
    /* PERF-REMOVED console.debug: console.debug(
      "Physical3DItem.js ~ __replaceHandle",
      newHandle,
      furnishedModelComponents
    ); */
    BlueprintInterface.GLTFLoader.load(newHandle.modelFileUrl, async (gltf) => {
      var model = new Group();
      model.add(gltf.scene);
      for (let i = this.__loadedItem.children.length - 1; i >= 0; i--) {
        if (
          this.__loadedItem.children[i].name?.toLowerCase()?.includes("handle")
        ) {
          var oldModel = this.__loadedItem.children[i];
          var newModel = model.clone();
          newModel.name = `${newHandle.name}`.replaceAll(" ", "_");
          newModel.position.copy(oldModel.position);
          newModel.rotation.copy(oldModel.rotation);
          newModel.scale.copy(oldModel.scale);
          this.__loadedItem.remove(oldModel);
          this.__loadedItem.add(newModel);
        }
      }
    });
    for (let i = 0; i < furnishedModelComponents.length; i++) {
      // remove old handle components
      BlueprintInterface.ProjectManagerService.removeFurnishedModelComponent(
        furnishedModelComponents[i]?._id
      );
      BlueprintInterface.ProjectManagerService.createFurnishedModelComponents(
        newHandle._id,
        furnishedModelComponents[i].furnishedModelId
      );
    }
    BlueprintInterface.ProjectManagerService.onFurnishedModelHandleChanged(
      furnishedModelComponents[0].furnishedModelId
    );
  }

  /**
   * Repaint the given meshes back to the item's DEFAULT colour (strip any applied
   * finish texture). Used by "Ungroup" to also reset the combine colour. Matches
   * meshes by name OR traversal index, since a live mesh name may not line up 1:1
   * with the stored meshName (Mesh_0…N, component order).
   */
  resetMeshesToDefault(meshNames) {
    try {
      const wanted = new Set((meshNames || []).map((x) => String(x)));
      if (!wanted.size || !this.__loadedItem) return;
      const WOOD = 0xc9a063;
      const def = this.__defaultColorHex || WOOD;
      const meshes = [];
      this.__loadedItem.traverse((o) => {
        if (o.isMesh) meshes.push(o);
      });
      meshes.forEach((o, i) => {
        const nm = String(o.name || "");
        const key = /^Mesh_\d+$/.test(nm) ? nm : "Mesh_" + i;
        if (!wanted.has(nm) && !wanted.has(key) && !wanted.has("Mesh_" + i))
          return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m) return;
          if (m.map) m.map = null; // drop the finish texture
          if (m.color) m.color.setHex(def);
          m.needsUpdate = true;
        });
      });
    } catch (e) {
      /* cosmetic — never break ungroup */
    }
  }

  // Split ONE geometry into its LOOSE PARTS (connected islands) — the same thing
  // Blender's "Separate By Loose Parts" does, but in the browser. Triangles that
  // share a vertex POSITION belong to the same part (union-find). Returns an
  // array of BufferGeometry (one per part); [geom] if there's nothing to split.
  __splitGeometryLooseParts(geom) {
    const pos = geom.attributes.position;
    if (!pos) return [geom];
    const nor = geom.attributes.normal;
    const uv = geom.attributes.uv;
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const vertAt = (i) => (index ? index.getX(i) : i);

    // Weld vertices by (rounded) position so a seam split across duplicated
    // vertices still counts as connected.
    const keyOf = (v) =>
      Math.round(pos.getX(v) * 1000) +
      "_" +
      Math.round(pos.getY(v) * 1000) +
      "_" +
      Math.round(pos.getZ(v) * 1000);
    const canonMap = new Map();
    const vertCanon = new Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      const k = keyOf(v);
      let c = canonMap.get(k);
      if (c === undefined) {
        c = canonMap.size;
        canonMap.set(k, c);
      }
      vertCanon[v] = c;
    }

    const nCanon = canonMap.size;
    const parent = new Array(nCanon);
    for (let i = 0; i < nCanon; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let t = 0; t < triCount; t++) {
      const a = vertCanon[vertAt(t * 3)];
      const b = vertCanon[vertAt(t * 3 + 1)];
      const c = vertCanon[vertAt(t * 3 + 2)];
      union(a, b);
      union(b, c);
    }

    const groups = new Map();
    for (let t = 0; t < triCount; t++) {
      const root = find(vertCanon[vertAt(t * 3)]);
      let arr = groups.get(root);
      if (!arr) {
        arr = [];
        groups.set(root, arr);
      }
      arr.push(t);
    }
    if (groups.size <= 1) return [geom];

    const parts = [];
    for (const tris of groups.values()) {
      const count = tris.length * 3;
      const p = new Float32Array(count * 3);
      const n = nor ? new Float32Array(count * 3) : null;
      const u = uv ? new Float32Array(count * 2) : null;
      let w = 0;
      for (const t of tris) {
        for (let j = 0; j < 3; j++) {
          const v = vertAt(t * 3 + j);
          p[w * 3] = pos.getX(v);
          p[w * 3 + 1] = pos.getY(v);
          p[w * 3 + 2] = pos.getZ(v);
          if (n) {
            n[w * 3] = nor.getX(v);
            n[w * 3 + 1] = nor.getY(v);
            n[w * 3 + 2] = nor.getZ(v);
          }
          if (u) {
            u[w * 2] = uv.getX(v);
            u[w * 2 + 1] = uv.getY(v);
          }
          w++;
        }
      }
      const pg = new BufferGeometry();
      pg.setAttribute("position", new Float32BufferAttribute(p, 3));
      if (n) pg.setAttribute("normal", new Float32BufferAttribute(n, 3));
      else pg.computeVertexNormals();
      if (u) pg.setAttribute("uv", new Float32BufferAttribute(u, 2));
      parts.push(pg);
    }
    return parts;
  }

  // Slice ONE geometry into `n` pieces along its LONGEST axis with CLEAN, STRAIGHT
  // cuts. Triangles that straddle a cut plane are clipped along the plane (not
  // just binned), so even curved/dense meshes (a sofa) get a straight seam.
  // Returns an array of BufferGeometry (empty slabs dropped); [geom] if n<=1 or
  // the shape is degenerate.
  __sliceGeometryAlongLongestAxis(geom, n, opts) {
    const pos = geom.attributes.position;
    if (!pos) return [geom];
    const index = geom.index;
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const vertAt = (i) => (index ? index.getX(i) : i);

    // Bounding box → pick the longest axis to slice across.
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v),
        y = pos.getY(v),
        z = pos.getZ(v);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const dx = maxX - minX,
      dy = maxY - minY,
      dz = maxZ - minZ;
    // Cut axis: explicit (opts.axis) or the longest side.
    let axis, min, span;
    if (opts && (opts.axis === 0 || opts.axis === 1 || opts.axis === 2)) {
      axis = opts.axis;
      min = axis === 0 ? minX : axis === 1 ? minY : minZ;
      span = axis === 0 ? dx : axis === 1 ? dy : dz;
    } else {
      axis = 0;
      min = minX;
      span = dx;
      if (dy >= dx && dy >= dz) {
        axis = 1;
        min = minY;
        span = dy;
      } else if (dz >= dx && dz >= dy) {
        axis = 2;
        min = minZ;
        span = dz;
      }
    }
    if (span <= 1e-6) return [geom];
    const comp = (v) => (axis === 0 ? v.x : axis === 1 ? v.y : v.z);

    // Cut-plane positions: the AI's explicit fractions, or n equal divisions.
    let bounds;
    if (opts && Array.isArray(opts.fractions) && opts.fractions.length) {
      const fs = opts.fractions
        .filter((f) => f > 0.0001 && f < 0.9999)
        .sort((a, b) => a - b);
      bounds = [min, ...fs.map((f) => min + span * f), min + span];
      n = bounds.length - 1;
    } else {
      if (n <= 1) return [geom];
      bounds = [];
      for (let k = 0; k <= n; k++) bounds.push(min + (span * k) / n);
    }
    if (n <= 1) return [geom];

    // Clip a convex polygon (array of Vector3) against one axis-aligned plane.
    // keepGreater=true keeps the part with axis-coord >= d, else <= d.
    // Straddling edges are split at the plane (linear interpolation).
    const clip = (poly, d, keepGreater) => {
      const out = [];
      const L = poly.length;
      for (let i = 0; i < L; i++) {
        const cur = poly[i];
        const nxt = poly[(i + 1) % L];
        const cv = comp(cur);
        const nv = comp(nxt);
        const cin = keepGreater ? cv >= d : cv <= d;
        const nin = keepGreater ? nv >= d : nv <= d;
        if (cin) out.push(cur);
        if (cin !== nin) {
          const t = (d - cv) / (nv - cv);
          out.push(
            new Vector3(
              cur.x + (nxt.x - cur.x) * t,
              cur.y + (nxt.y - cur.y) * t,
              cur.z + (nxt.z - cur.z) * t
            )
          );
        }
      }
      return out;
    };

    const slabPos = Array.from({ length: n }, () => []);
    for (let t = 0; t < triCount; t++) {
      const a = vertAt(t * 3),
        b = vertAt(t * 3 + 1),
        c = vertAt(t * 3 + 2);
      const va = new Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
      const vb = new Vector3(pos.getX(b), pos.getY(b), pos.getZ(b));
      const vc = new Vector3(pos.getX(c), pos.getY(c), pos.getZ(c));
      const lo = Math.min(comp(va), comp(vb), comp(vc));
      const hi = Math.max(comp(va), comp(vb), comp(vc));
      let s0 = Math.floor(((lo - min) / span) * n);
      let s1 = Math.floor(((hi - min) / span) * n);
      if (s0 < 0) s0 = 0;
      if (s0 >= n) s0 = n - 1;
      if (s1 < 0) s1 = 0;
      if (s1 >= n) s1 = n - 1;
      for (let s = s0; s <= s1; s++) {
        let poly = [va, vb, vc];
        if (s > 0) poly = clip(poly, bounds[s], true);
        if (poly.length < 3) continue;
        if (s < n - 1) poly = clip(poly, bounds[s + 1], false);
        if (poly.length < 3) continue;
        // Triangulate the clipped convex polygon as a fan.
        const arr = slabPos[s];
        for (let k = 1; k < poly.length - 1; k++) {
          arr.push(poly[0].x, poly[0].y, poly[0].z);
          arr.push(poly[k].x, poly[k].y, poly[k].z);
          arr.push(poly[k + 1].x, poly[k + 1].y, poly[k + 1].z);
        }
      }
    }

    const parts = [];
    for (const arr of slabPos) {
      if (!arr.length) continue;
      const pg = new BufferGeometry();
      pg.setAttribute(
        "position",
        new Float32BufferAttribute(new Float32Array(arr), 3)
      );
      pg.computeVertexNormals();
      parts.push(pg);
    }
    return parts.length ? parts : [geom];
  }

  // Concatenate several BufferGeometries (position only) into one, recomputing
  // normals. Used to merge tiny fragments into a bigger part.
  __concatGeometries(geoms) {
    let total = 0;
    for (const g of geoms) total += g.attributes.position.count;
    const arr = new Float32Array(total * 3);
    let w = 0;
    for (const g of geoms) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        arr[w * 3] = p.getX(i);
        arr[w * 3 + 1] = p.getY(i);
        arr[w * 3 + 2] = p.getZ(i);
        w++;
      }
    }
    const out = new BufferGeometry();
    out.setAttribute("position", new Float32BufferAttribute(arr, 3));
    out.computeVertexNormals();
    return out;
  }

  // Split this item into its physically-separate pieces (loose parts), IN PLACE.
  // To control the fragment explosion (a dense sofa has 300+ tiny islands) this
  // runs A + B automatically:
  //   A  drop tiny fragments (smaller than MIN_FRAC of the model)
  //   B  merge every dropped fragment into its NEAREST big piece
  // so you end up with just the few real pieces, not hundreds. Returns the count.
  splitLooseParts() {
    try {
      const loaded = this.__loadedItem;
      if (!loaded) return 0;
      const meshes = [];
      loaded.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      if (!meshes.length) return 0;

      const oldMap = Array.isArray(this.__itemModel.meshmap)
        ? this.__itemModel.meshmap
        : [];
      const findEntry = (nm) => oldMap.find((e) => e && e.name === nm);

      // Process each source mesh IN PLACE — each part inherits its source mesh's
      // transform, so no geometry transform is needed (avoids the crash + the
      // disappearing geometry) and distinct pieces are never merged away.
      const newMap = [];
      let idx = 0;
      for (const mesh of meshes) {
        const srcEntry = findEntry(mesh.name) || {
          texture: "",
          color: "",
          shininess: 10,
          size: [],
        };
        const islands = this.__splitGeometryLooseParts(mesh.geometry);
        const reduced = this.__filterAndMergeParts(islands);
        const parent = mesh.parent || loaded;
        for (const geom of reduced) {
          if (!geom.attributes.position || !geom.attributes.position.count) {
            continue;
          }
          const m = new Mesh(geom, mesh.material);
          m.position.copy(mesh.position);
          m.quaternion.copy(mesh.quaternion);
          m.scale.copy(mesh.scale);
          m.castShadow = true;
          m.receiveShadow = true;
          const nm = "Mesh_" + idx++;
          m.name = nm;
          parent.add(m);
          newMap.push({ ...srcEntry, name: nm });
        }
        parent.remove(mesh);
      }
      if (!newMap.length) return 0;
      this.__itemModel.meshmap = newMap;
      return newMap.length;
    } catch (e) {
      console.warn("splitLooseParts failed", e);
      return 0;
    }
  }

  // A + B on a raw list of loose-part geometries: drop tiny fragments and merge
  // each into its nearest big piece. No-op on a 1-part list.
  __filterAndMergeParts(geoms) {
    const cand = geoms
      .map((geom) => {
        const pos = geom.attributes.position;
        geom.computeBoundingBox();
        const center = geom.boundingBox.getCenter(new Vector3());
        return { geom, tris: pos ? pos.count / 3 : 0, center };
      })
      .filter((c) => c.tris > 0);
    if (cand.length <= 1) return cand.map((c) => c.geom);
    const totalTris = cand.reduce((s, c) => s + c.tris, 0);
    const MIN_FRAC = 0.02;
    const MAX_PARTS = 24;
    let big = cand.filter((c) => c.tris >= totalTris * MIN_FRAC);
    if (!big.length) big = [cand.slice().sort((a, b) => b.tris - a.tris)[0]];
    big.sort((a, b) => b.tris - a.tris);
    if (big.length > MAX_PARTS) big = big.slice(0, MAX_PARTS);
    const groups = big.map((b) => ({ base: b, geoms: [b.geom] }));
    for (const c of cand) {
      if (big.includes(c)) continue;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < groups.length; i++) {
        const d = groups[i].base.center.distanceToSquared(c.center);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      groups[nearest].geoms.push(c.geom);
    }
    return groups.map((g) =>
      g.geoms.length === 1 ? g.geoms[0] : this.__concatGeometries(g.geoms)
    );
  }

  // Split ONE part (by mesh name) further, IN PLACE. First tries its separate
  // pieces (loose parts); if it's a SOLID piece, cuts it straight into `n`
  // (default 2). The original keeps its number; new pieces get the NEXT free
  // Mesh_<n> numbers (never 5a/5b). Returns { count, newNames } or null.
  splitSingleMesh(meshName, n) {
    try {
      const cutN = Math.max(2, Math.min(20, parseInt(n, 10) || 2));
      const loaded = this.__loadedItem;
      if (!loaded) return null;
      let target = null;
      const existing = [];
      loaded.traverse((o) => {
        if (o.isMesh) {
          existing.push(o.name);
          if (o.name === meshName) target = o;
        }
      });
      if (!target) return null;

      let maxIdx = -1;
      for (const nm of existing) {
        const m = /^Mesh_(\d+)$/.exec(nm);
        if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
      }

      // Prefer real separate pieces; fall back to a straight cut into `cutN`.
      let pieces = this.__filterAndMergeParts(
        this.__splitGeometryLooseParts(target.geometry)
      );
      if (pieces.length <= 1) {
        pieces = this.__sliceGeometryAlongLongestAxis(target.geometry, cutN);
      }
      if (pieces.length <= 1) return { count: 1, newNames: [] };

      const parent = target.parent || loaded;
      const oldMap = Array.isArray(this.__itemModel.meshmap)
        ? this.__itemModel.meshmap
        : [];
      const srcEntry = oldMap.find((e) => e && e.name === meshName) || {
        texture: "",
        color: "",
        shininess: 10,
        size: [],
      };

      const allNames = [];
      const newNames = [];
      let next = maxIdx + 1;
      pieces.forEach((geom, i) => {
        const nm = i === 0 ? meshName : "Mesh_" + next++;
        const m = new Mesh(geom, target.material);
        m.position.copy(target.position);
        m.quaternion.copy(target.quaternion);
        m.scale.copy(target.scale);
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = nm;
        parent.add(m);
        allNames.push(nm);
        if (i !== 0) newNames.push(nm);
      });
      parent.remove(target);

      const others = oldMap.filter((e) => e && e.name !== meshName);
      const added = allNames.map((nm) => ({ ...srcEntry, name: nm }));
      this.__itemModel.meshmap = others.concat(added);
      return { count: pieces.length, newNames };
    } catch (e) {
      console.warn("splitSingleMesh failed", e);
      return null;
    }
  }

  // Merge several meshes' geometry into ONE non-indexed BufferGeometry, in
  // `root`'s local space. Lets us cut the WHOLE item into a fixed number of
  // parts (slice the merged shape) instead of slicing each mesh separately.
  // Normals are recomputed on the result.
  __combineMeshGeometries(meshes, root) {
    root.updateMatrixWorld(true);
    const rootInv = new Matrix4().getInverse(root.matrixWorld);
    const positions = [];
    const tmp = new Vector3();
    for (const mesh of meshes) {
      const geom = mesh.geometry;
      const pos = geom && geom.attributes.position;
      if (!pos) continue;
      mesh.updateMatrixWorld(true);
      const rel = new Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
      const index = geom.index;
      const count = index ? index.count : pos.count;
      const vertAt = (i) => (index ? index.getX(i) : i);
      for (let i = 0; i < count; i++) {
        const v = vertAt(i);
        tmp.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(rel);
        positions.push(tmp.x, tmp.y, tmp.z);
      }
    }
    const combined = new BufferGeometry();
    combined.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(positions), 3)
    );
    combined.computeVertexNormals();
    return combined;
  }

  // Cut this WHOLE item into exactly `n` pieces along its longest axis, IN PLACE
  // (same item, no new model). Merges every source mesh into one shape first, so
  // n always yields n parts — regardless of how many meshes the model has.
  // Rebuilds the material map so each part is selectable and paintable.
  // Returns the new total mesh count.
  splitIntoParts(n) {
    try {
      const parts = Math.max(2, Math.min(20, parseInt(n, 10) || 2));
      const loaded = this.__loadedItem;
      if (!loaded) return 0;
      const meshes = [];
      loaded.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      if (!meshes.length) return 0;

      // Inherit appearance from the first source mesh (material + map entry).
      const oldMap = Array.isArray(this.__itemModel.meshmap)
        ? this.__itemModel.meshmap
        : [];
      const srcEntry = oldMap.find(
        (e) => e && e.name === meshes[0].name
      ) || { texture: "", color: "", shininess: 10, size: [] };
      const baseMaterial = meshes[0].material;

      // Merge the WHOLE item into one geometry, then slice it into exactly N.
      const combined = this.__combineMeshGeometries(meshes, loaded);
      const pieces = this.__sliceGeometryAlongLongestAxis(combined, parts);

      // Drop all source meshes.
      for (const mesh of meshes) {
        (mesh.parent || loaded).remove(mesh);
      }
      // Add one new mesh per slice (geometry already in `loaded` local space).
      const newMap = [];
      let idx = 0;
      for (const geom of pieces) {
        const m = new Mesh(geom, baseMaterial);
        m.castShadow = true;
        m.receiveShadow = true;
        const nm = "Mesh_" + idx++;
        m.name = nm;
        loaded.add(m);
        newMap.push({ ...srcEntry, name: nm });
      }
      this.__itemModel.meshmap = newMap;
      return newMap.length;
    } catch (e) {
      console.warn("splitIntoParts failed", e);
      return 0;
    }
  }

  // Cut this WHOLE item at explicit `cutFractions` (0..1) along `axis`, IN PLACE.
  // Used by the AI split: the LLM decides WHERE the real part-boundaries are, and
  // this does the actual clean cut. Same merge + rebuild as splitIntoParts.
  splitAtFractions(cutFractions, axis) {
    try {
      const loaded = this.__loadedItem;
      if (!loaded) return 0;
      const meshes = [];
      loaded.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      if (!meshes.length) return 0;

      const oldMap = Array.isArray(this.__itemModel.meshmap)
        ? this.__itemModel.meshmap
        : [];
      const srcEntry = oldMap.find(
        (e) => e && e.name === meshes[0].name
      ) || { texture: "", color: "", shininess: 10, size: [] };
      const baseMaterial = meshes[0].material;

      const combined = this.__combineMeshGeometries(meshes, loaded);
      const pieces = this.__sliceGeometryAlongLongestAxis(combined, 0, {
        axis: axis === 0 || axis === 1 || axis === 2 ? axis : undefined,
        fractions: Array.isArray(cutFractions) ? cutFractions : [],
      });

      for (const mesh of meshes) {
        (mesh.parent || loaded).remove(mesh);
      }
      const newMap = [];
      let idx = 0;
      for (const geom of pieces) {
        const m = new Mesh(geom, baseMaterial);
        m.castShadow = true;
        m.receiveShadow = true;
        const nm = "Mesh_" + idx++;
        m.name = nm;
        loaded.add(m);
        newMap.push({ ...srcEntry, name: nm });
      }
      this.__itemModel.meshmap = newMap;
      return newMap.length;
    } catch (e) {
      console.warn("splitAtFractions failed", e);
      return 0;
    }
  }

  async __initializeChildItem() {
    /* PERF-REMOVED console.debug: console.debug(
      "DEBUG: __initializeChildItem -> itemModel",
      this.__itemModel
    ); */
    const furnishedModel =
      BlueprintInterface.ProjectManagerService.getFurnishedModelById(
        this.__itemModel.__id
      );
    const handles =
      BlueprintInterface.ProjectManagerService.getFurnishedModelComponents(
        this.__itemModel.__id
      )?.filter((comp) => comp?.name?.toLowerCase()?.includes("handle"));
    if (
      furnishedModel?.isHandleChanged &&
      handles?.length &&
      handles[0]?.parentComponentId
    ) {
      const model = await ModelsService.getModelById(
        handles[0]?.parentComponentId
      );
      if (model) {
        BlueprintInterface.GLTFLoader.load(model.modelFileUrl, async (gltf) => {
          var model = new Group();
          model.add(gltf.scene);
          for (let i = this.__loadedItem.children.length - 1; i >= 0; i--) {
            if (
              this.__loadedItem.children[i].name
                ?.toLowerCase()
                ?.includes("handle")
            ) {
              var oldModel = this.__loadedItem.children[i];
              var newModel = model.clone();
              newModel.name = oldModel.name;
              newModel.position.copy(oldModel.position);
              newModel.rotation.copy(oldModel.rotation);
              newModel.scale.copy(oldModel.scale);
              this.__loadedItem.remove(oldModel);
              this.__loadedItem.add(newModel);
            }
          }
        });
      }
    }
    this.__loadedItem.scale.x = 100 * this.__itemModel.__scale.x;
    this.__loadedItem.scale.y = 100 * this.__itemModel.__scale.y;
    this.__loadedItem.scale.z = 100 * this.__itemModel.__scale.z;

    this.__loadedItem.children.map((child) => {
      child.receiveShadow = true;
      child.castShadow = true;
    });
    this.receiveShadow = true;
    this.castShadow = true;

    /* PERF-REMOVED console.debug: console.debug(
      "DEBUG: __initializeChildItem -> loaded item",
      this.__loadedItem
    ); */

    // Measure the mesh in ISOLATION. `Box3.setFromObject` returns
    // world-space coordinates. On the first init __loadedItem isn't
    // parented yet, so that's the mesh's local bbox — fine. But on a
    // re-init (after a W/H/D resize) __loadedItem is already a child of
    // this Physical3DItem, so setFromObject folds the item's world Y
    // (≈ halfSize.y) into the measurement. Combined with the old
    // cumulative `translateY`, every resize sank the mesh ~40 cm.
    //
    // Fix: detach + reset position before measuring, then centre with an
    // ABSOLUTE position set (idempotent — no cumulative drift).
    const wasChild = this.__loadedItem.parent === this;
    if (wasChild) this.remove(this.__loadedItem);
    this.__loadedItem.position.set(0, 0, 0);
    this.__loadedItem.updateMatrixWorld(true);

    // Honest full bounding box of the WHOLE loaded model — every mesh, nothing
    // dropped. An earlier version tried to drop "stray" / baked-ground-plane
    // meshes to stop Sketchfab imports sinking, but its size heuristic kept
    // mis-classifying part of a tall model (e.g. half a wardrobe) as droppable.
    // The box then measured ~half the true height, so halfSize.y came out too
    // small and the item grounded to that wrong half — sinking on drag/resize.
    // Sinking is already prevented by centring the mesh (just below) plus the
    // floor-grounding block further down; neither needs mesh dropping. Using the
    // true full box is stable across every GLB source (Sketchfab, Poly Haven,
    // uploads, built-ins). __loadedItem was just detached + reset to origin
    // above, so this measures the model's own local bbox (no world-Y folded in).
    this.__box = new Box3().setFromObject(this.__loadedItem);
    /* PERF-REMOVED */ // console.debug("DEBUG: __initializeChildItem -> box", this.__box);
    this.__center = this.__box.getCenter(new Vector3());
    /* PERF-REMOVED */ // console.debug("DEBUG: __initializeChildItem -> center", this.__center);
    this.__itemType = this.__itemModel.__metadata.itemType;

    // Centre the mesh on ALL THREE axes so its geometry centroid sits on
    // the Physical3DItem's local origin.
    //
    // Many imported GLBs — especially SketchUp / Sketchfab exports — bake
    // their vertices far from the model's local origin (the object was
    // modelled away from the SketchUp world origin and never re-centred).
    // Example: this AC's geometry centre is ~200 cm in X and ~60 cm in Z
    // away from origin. Previously only the Y axis was centred, so the
    // X/Z offset pushed the rendered triangles right out of the room even
    // though the item's transform (Physical3DItem.position) was correct —
    // the item reported as "inside the room" in data but drew "outside".
    //
    // Centring X and Z too makes the visible mesh land exactly where the
    // item is placed. For models already authored centred (e.g. the BC
    // floor unit) __center.x and __center.z are ~0, so this is a no-op for
    // them — safe across every existing item.
    //
    // Y behaviour is preserved: -__center.y === the old -meshCenterY, so
    // the mesh still runs from -halfSize.y to +halfSize.y and floor items
    // still sit on the floor (Physical3DItem.position.y = halfSize.y).
    this.__loadedItem.position.x = -this.__center.x;
    this.__loadedItem.position.y = -this.__center.y;
    this.__loadedItem.position.z = -this.__center.z;
    this.__loadedItem.updateMatrixWorld(true);
    this.__loadedItem.matrixAutoUpdate = true;
    this.__loadedItem.children
      ?.find((child) => child.name.toLowerCase().includes("handle"))
      ?.scale.set(1 / this.__itemModel.__scale.x, 1, 1);
    this.add(this.__loadedItem);

    let sizeVector = new Vector3();
    this.__box.getSize(sizeVector);
    /* PERF-REMOVED */ // console.debug("DEBUG: __initializeChildItem -> sizeVector", sizeVector);
    this.__boxhelper.geometry = new EdgesGeometry(
      new BoxBufferGeometry(sizeVector.x, sizeVector.y, sizeVector.z)
    );

    // The old code translated the box-helper geometry up by sizeVector.y/2
    // to align with a bottom-aligned mesh (local Y from 0 to H). After my
    // centering fix the mesh is centred at local Y=0 (from -H/2 to +H/2),
    // and BoxBufferGeometry is also centred by default — so no translate
    // is needed. Leaving the old +H/2 shift in place made the selection box
    // float above the actual mesh by half a height.

    this.__size = sizeVector;
    /* PERF-REMOVED */ // console.debug("DEBUG: __initializeChildItem -> size", this.__size);
    this.__itemModel.__size.set(sizeVector.x, sizeVector.y, sizeVector.z);
    // Keep the item MODEL's half-size in sync with the freshly measured mesh.
    // FloorItem.snapToPoint grounds a dragged item to `itemModel.halfSize.y`,
    // and getItemPolygon builds the footprint from halfSize too — but __size
    // was updated here without __halfSize, so both used the STALE pre-resize
    // value. For an auto-fit Sketchfab/Poly Haven import later resized larger,
    // that stale half-height was far too small, so dragging re-grounded the
    // item BELOW the floor (base sank ~½ the height). Recomputing it here fixes
    // grounding + footprint for every GLB source, no per-model work.
    this.__itemModel.__halfSize.set(
      sizeVector.x / 2,
      sizeVector.y / 2,
      sizeVector.z / 2
    );

    this.geometry = new BoxBufferGeometry(
      sizeVector.x,
      sizeVector.y,
      sizeVector.z
    );

    // The old code translated the picking geometry up by sizeVector.y/2 to
    // align with a bottom-aligned mesh. After centering the mesh at local
    // Y=0, BoxBufferGeometry (also centred by default) already matches —
    // no translate needed. Without this removal, clicks land H/2 above
    // the mesh and the ray passes through to the wall behind.
    this.geometry.computeBoundingBox();
    this.halfSize = this.objectHalfSize(this.geometry);

    console.warn(
      "PAZL-GROUND name=", this.__itemModel?.__metadata?.name,
      "itemType=", this.__itemType,
      "halfSize.y=", this.halfSize?.y,
      "position.y(before)=", this.position?.y,
      "groundedHalfSizeY=", this.__groundedHalfSizeY
    );

    // Re-ground floor items. The mesh is centred on the local origin, so
    // with Physical3DItem.position.y = halfSize.y the mesh bottom sits at
    // world Y = 0 (floor). After a resize, halfSize.y changes — if
    // position.y isn't updated to match, a height reduction leaves the
    // item floating above the floor (and an increase sinks it). Keeping
    // position.y = halfSize.y on every (re-)init means a height change
    // always shrinks/grows from the floor up. Wall / in-wall items keep
    // their own elevation (they aren't floor-grounded).
    // Both FLOOR_UNIT (cabinetry) AND ITEM (free-standing: chairs, tables,
    // sofas, imported Sketchfab/Poly Haven models) rest on the floor, so both
    // must be grounded. Previously only FLOOR_UNIT was — a free-standing item
    // (type 0) kept its saved Y, so a Sketchfab model whose Y sat below the
    // floor resting line stayed sunk (and a resize never re-grounded it). Wall
    // and in-wall items keep their own elevation and are untouched. The guards
    // below (only ground when Y is below the resting line; keep the base on its
    // surface across resizes) mean correctly-placed and stacked items don't move.
    if (
      this.__itemType === MODEL_TYPES.ITEM ||
      this.__itemType === MODEL_TYPES.FLOOR_UNIT ||
      this.__itemType === 0 ||
      this.__itemType === "0" ||
      this.__itemType === 1 ||
      this.__itemType === "1"
    ) {
      if (this.__groundedHalfSizeY == null) {
        // First init after (re)load. Trust the saved resting height: a normal
        // floor item's saved Y is halfSize.y (on the floor); a STACKED item
        // (e.g. a pot on a table) saved a RAISED Y — preserve it so a refresh
        // keeps it on the surface instead of dropping it to the floor. Only
        // ground a brand-new / ungrounded item whose Y sits below the floor
        // resting line.
        if (this.position.y < this.halfSize.y) {
          this.position.y = this.halfSize.y;
          // Lift the MODEL too, not just the 3D object. Otherwise the item is
          // re-synced from the model on the next update (and re-saved with the
          // sunk Y), so it snaps back below the floor on reload — the same
          // snap-back the door fix below documents. Only reached when the item
          // was actually sunk (Y < halfSize.y); stacked/normal items skip this.
          if (this.__itemModel && this.__itemModel.position) {
            this.__itemModel.position.y = this.halfSize.y;
          }
        }
      } else {
        // Re-init (e.g. a resize changed halfSize.y). Keep the item's BASE on
        // whatever surface it rests on (floor or table) and grow/shrink from
        // there, instead of forcing it back down to the floor.
        const baseY = this.position.y - this.__groundedHalfSizeY;
        this.position.y = Math.max(0, baseY) + this.halfSize.y;
      }
      this.__groundedHalfSizeY = this.halfSize.y;
    }

    // In-wall FLOOR items (doors) should rest on the floor too, but they aren't
    // FLOOR_UNIT so the block above skips them — leaving them centred on Y=0
    // (sunk half below the floor). The mesh is centred, so position.y =
    // halfSize.y puts the door's BASE on the floor. We also lift the door
    // MODEL's Y, because the 3D item is re-synced from the model on updates and
    // would otherwise snap back to its saved Y=0 and sink again. Only
    // __isBoundToFloor items (doors) are affected; everything else is untouched.
    if (this.__itemModel && this.__itemModel.__isBoundToFloor) {
      this.position.y = this.halfSize.y;
      if (this.__itemModel.position) {
        this.__itemModel.position.y = this.halfSize.y;
      }
    }

    this.material.visible = false;
    this.userData.currentPosition = this.__currentPosition;
    this.__loadedItem.rotation.x = this.__itemModel.combinedRotation.x;
    this.__loadedItem.rotation.y = this.__itemModel.combinedRotation.y;
    this.__loadedItem.rotation.z = this.__itemModel.combinedRotation.z;

    this.__boxhelper.rotation.x = this.__itemModel.combinedRotation.x;
    this.__boxhelper.rotation.y = this.__itemModel.combinedRotation.y;
    this.__boxhelper.rotation.z = this.__itemModel.combinedRotation.z;

    // KEEP FLOOR ITEMS INSIDE THE ROOM (final safety net). Some imported GLBs
    // bake their geometry far from the local origin (see the X/Z centring note
    // above); even after centring, a model can still render past a wall — the
    // item's POSITION is the room centre, but its drawn footprint pokes out.
    // Here we measure the item's real world footprint and, if it sticks OUT of
    // its room, nudge it straight back in. An item already fully inside never
    // moves (dx/dz stay 0), so drag-drop and every existing placement are
    // untouched. If the item is genuinely bigger than the room on an axis, we
    // centre it on that axis instead of jamming a corner.
    try {
      const t = this.__itemType;
      const isFloorItem =
        t === MODEL_TYPES.ITEM ||
        t === MODEL_TYPES.FLOOR_UNIT ||
        t === 0 || t === "0" || t === 1 || t === "1";
      if (isFloorItem) {
        const fp =
          (BlueprintInterface.blueprint3d &&
            BlueprintInterface.blueprint3d.model &&
            BlueprintInterface.blueprint3d.model.__floorplan) ||
          (this.__itemModel &&
            this.__itemModel.__model &&
            this.__itemModel.__model.__floorplan);
        const rooms = (fp && fp.rooms) || [];
        let room =
          this.__itemModel &&
          this.__itemModel.__currentFloor &&
          typeof this.__itemModel.__currentFloor.pointInRoom === "function"
            ? this.__itemModel.__currentFloor
            : null;
        if (!room && rooms.length) {
          const px = this.position.x;
          const pz = this.position.z;
          room =
            rooms.find(
              (r) =>
                r &&
                typeof r.pointInRoom === "function" &&
                r.pointInRoom(new Vector2(px, pz))
            ) || rooms[0];
        }
        const poly = room && room._polygonPoints;
        if (poly && poly.length) {
          let minX = Infinity,
            maxX = -Infinity,
            minZ = Infinity,
            maxZ = -Infinity;
          poly.forEach((p) => {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.y); // polygon.y == world z
            maxZ = Math.max(maxZ, p.y);
          });
          this.updateMatrixWorld(true);
          const wbox = new Box3().setFromObject(this.__loadedItem);
          if (isFinite(wbox.min.x) && isFinite(wbox.max.x)) {
            let dx = 0;
            let dz = 0;
            if (wbox.min.x < minX) dx = minX - wbox.min.x;
            else if (wbox.max.x > maxX) dx = maxX - wbox.max.x;
            if (wbox.min.z < minZ) dz = minZ - wbox.min.z;
            else if (wbox.max.z > maxZ) dz = maxZ - wbox.max.z;
            // Bigger than the room on an axis → centre on that axis.
            if (wbox.max.x - wbox.min.x > maxX - minX)
              dx = (minX + maxX) / 2 - (wbox.min.x + wbox.max.x) / 2;
            if (wbox.max.z - wbox.min.z > maxZ - minZ)
              dz = (minZ + maxZ) / 2 - (wbox.min.z + wbox.max.z) / 2;
            if (dx !== 0 || dz !== 0) {
              this.position.x += dx;
              this.position.z += dz;
              if (this.__itemModel && this.__itemModel.position) {
                this.__itemModel.position.x = this.position.x;
                this.__itemModel.position.z = this.position.z;
              }
              this.updateMatrixWorld(true);
            }
          }
        }
      }
    } catch (e) {
      /* best-effort — never block item load for a placement nudge */
    }
  }

  objectHalfSize(geometry) {
    //geometry.computeBoundingBox();
    let objectBox = geometry.boundingBox.clone();
    return objectBox.max.clone().sub(objectBox.min).divideScalar(2);
  }

  // Function - Add the textures to the models
  initColor(parent, type, mtl) {
    parent.traverse((o) => {
      if (o.isMesh) {
        let obj = mtl.find((m) => m.name === o.name);
        if (obj) {
          if (obj.texture != "") {
            let txt = new TextureLoader().load(obj.texture);
            let size = obj.size;
            txt.repeat.set(Math.round(this.__itemModel.__scale.x), 1);
            txt.encoding = sRGBEncoding;
            txt.wrapS = RepeatWrapping;
            txt.wrapT = RepeatWrapping;
            let INITIAL_MTL = new MeshPhongMaterial({
              map: txt,
              shininess: obj.shininess,
              flatShading: true,
            });
            o.material = INITIAL_MTL;
          } else {
            if (obj.color != "") {
              let INITIAL_MTL = new MeshPhongMaterial({
                color: parseInt("0x" + obj.color, 16),
                shininess: obj.shininess,
                flatShading: true,
              });
              o.material = INITIAL_MTL;
            }
          }
        }
      }
    });
  }

  __loadItemModel() {
    if (
      !this.__itemModel.modelURL ||
      this.__itemModel.modelURL === undefined ||
      this.__itemModel.modelURL === "undefined"
    ) {
      return;
    }
    if (this.__loadedItem) {
      this.remove(this.__loadedItem);
    }
    // Prefer the SHARED in-memory GLB cache (warmed by the drag/drop). On a
    // cache hit this clones an already-parsed model and renders instantly — no
    // second download/parse. Falls back to a direct load if the cache is
    // unavailable or errors, so rendering never breaks.
    const cachedLoad =
      BlueprintInterface && BlueprintInterface.loadGltfCached;
    if (typeof cachedLoad === "function") {
      cachedLoad(
        this.__itemModel.modelURL,
        this.__gltfLoadedEvent,
        (err) => {
          console.warn(
            "Physical3DItem ~ cached GLB load failed; falling back to direct load",
            err
          );
          this.__gltfLoader.load(
            this.__itemModel.modelURL,
            this.__gltfLoadedEvent,
            this.__gltfLoadingProgressEvent
          );
        }
      );
      return;
    }
    this.__gltfLoader.load(
      this.__itemModel.modelURL,
      this.__gltfLoadedEvent,
      this.__gltfLoadingProgressEvent
    );
  }

  __gltfLoaded(gltfModel) {
    this.__loadedItem = gltfModel.scene;
    // Rename every mesh to Mesh_<i> by depth-first traversal index so the
    // catalog's model_components.name (which uses the same scheme) reliably
    // matches at material-swap time, even for GLBs with empty or duplicated
    // mesh names. Must run BEFORE initColor.
    let __meshIndex = 0;
    this.__loadedItem.traverse((o) => {
      if (o.isMesh) {
        // Keep the GLB's ORIGINAL part name before overwriting it — the auto
        // default-colour step uses it to spot special parts (e.g. a TV screen).
        o.userData.__origName = o.name || "";
        o.name = `Mesh_${__meshIndex++}`;
      }
    });

    // Cache the GLB's NATIVE bounding box — measured now, at scale (1,1,1),
    // before __initializeChildItem applies any scaling. This is the fixed
    // reference the resize handlers use for ABSOLUTE scaling:
    //   __scale[axis] = targetDimCm / (nativeDim × 100)
    // Absolute math has zero dependence on current state, so there is no
    // drift, no compounding, and no cross-axis coupling.
    this.__nativeBox = new Box3().setFromObject(this.__loadedItem);
    const nativeSize = new Vector3();
    this.__nativeBox.getSize(nativeSize);

    // Reconstruct __scale so 100 × __scale × nativeSize == the target size, on
    // every load. Per-axis (not uniform) so a customised W/H/D survives reload.
    //
    // The target size is taken PREFERENTIALLY from the FurnishedModel's
    // `dimensions` [H,W,D] mm. That is the value the panel shows and the ONLY
    // one the resize handlers write. The FloorItem's own `metadata.size` is a
    // SECOND copy that is not updated on resize, so after a resize it goes
    // stale — the item then reloads at the old (smaller) size and sits sunk on
    // the floor. `dimensions` lives on the FurnishedModel entity, a different
    // object from this FloorItem, so it must be fetched. Verified against every
    // item in a real scene: where nothing was resized, dimensions and
    // metadata.size agree exactly (so this changes nothing); only a resized
    // item differs, and there dimensions is the correct value. metadata.size is
    // the fallback for anything without a usable FurnishedModel.
    const meta = this.__itemModel?.__metadata;
    let expectedSize = meta?.size;
    let fmDims = null;
    try {
      const fm = BlueprintInterface?.ProjectManagerService?.getFurnishedModelById?.(
        this.__itemModel.__id
      );
      fmDims = fm?.dimensions;
    } catch (_) {}
    if (
      Array.isArray(fmDims) &&
      fmDims.length >= 3 &&
      Number(fmDims[0]) > 0 &&
      Number(fmDims[1]) > 0 &&
      Number(fmDims[2]) > 0
    ) {
      // dimensions [H,W,D] mm → render size [x,y,z] cm = [W,H,D] / 10.
      // (x↔width, y↔height, z↔depth — the axis mapping the resize handlers use.)
      expectedSize = [
        Number(fmDims[1]) / 10,
        Number(fmDims[0]) / 10,
        Number(fmDims[2]) / 10,
      ];
    }
    if (
      Array.isArray(expectedSize) &&
      expectedSize.length >= 3 &&
      nativeSize.x > 0 &&
      nativeSize.y > 0 &&
      nativeSize.z > 0
    ) {
      const sx = (Number(expectedSize[0]) || 0) / (100 * nativeSize.x);
      const sy = (Number(expectedSize[1]) || 0) / (100 * nativeSize.y);
      const sz = (Number(expectedSize[2]) || 0) / (100 * nativeSize.z);
      this.__itemModel.__scale.set(sx, sy, sz);
      // Write the corrected scale AND size back into __metadata too. __metadata
      // is the stale second copy that __applyMetaData() reads scale/size BACK
      // from whenever the item is re-synced (e.g. on select) — if it is left
      // holding the old small values, selecting the item snaps it back to that
      // size. Overwriting them here leaves no stale copy to revert to, and the
      // next Save persists the corrected values so the heal is permanent.
      if (this.__itemModel.__metadata) {
        this.__itemModel.__metadata.scale = [sx, sy, sz];
        this.__itemModel.__metadata.size = [
          Number(expectedSize[0]) || 0,
          Number(expectedSize[1]) || 0,
          Number(expectedSize[2]) || 0,
        ];
      }
    }

    this.__initializeChildItem();
    this.initColor(this.__loadedItem, "", this.__itemModel.meshmap);

    // AUTO DEFAULT COLOUR: any mesh that came in with NO texture and a plain
    // light-grey/white ("clay") material — i.e. a model with no baseColor — gets
    // a warm wood tone so it never shows as grey. Meshes that already carry a
    // texture OR a real (non-neutral) colour are left untouched, so designed
    // furniture (sofas, chairs, tables) keeps its own look. Runs on every load,
    // so it stays consistent after a reload. Guarded — never breaks loading.
    try {
      // ITEM-WISE default colour: pick the colour from WHAT the item is (name /
      // type), so a grey model looks right for its kind — wood for cabinets /
      // tables / beds, grey fabric for sofas, beige for chairs, warm metal for
      // lights. Only grey/untextured meshes are painted, so items that already
      // carry their own colour/texture are left untouched.
      const WOOD = 0xc9a063; // brown wood
      const FABRIC_SOFA = 0xe6dbbf; // warm cream/beige (matches Solid 21054)
      const FABRIC_CHAIR = 0xe6dbbf; // warm cream/beige (matches Solid 21054)
      const METAL_LIGHT = 0xb08d57; // warm brass / metal
      const meta = (this.__itemModel && this.__itemModel.metadata) || {};
      const nameStr = `${meta.itemName || ""} ${meta.itemType || ""} ${
        meta.description || ""
      }`.toLowerCase();
      // Decide the item kind + its default colour. Order matters: check the
      // more specific fabric/metal kinds before falling back to wood.
      let kind = "wood";
      let defaultColor = WOOD;
      const isTv = /\btv\b|television|monitor/.test(nameStr);
      if (/\bsofa\b|couch|settee|loveseat/.test(nameStr)) {
        kind = "fabric";
        defaultColor = FABRIC_SOFA;
      } else if (/\bchair\b|stool|armchair|recliner|bench/.test(nameStr)) {
        kind = "fabric";
        defaultColor = FABRIC_CHAIR;
      } else if (
        /\blight\b|lamp|chandelier|pendant|sconce|lantern/.test(nameStr)
      ) {
        kind = "metal";
        defaultColor = METAL_LIGHT;
      } else {
        // cabinet, wardrobe, tall unit, storage, table, shelf, door, bed, cot…
        // (a TV falls here too: its STAND gets wood; the SCREEN is set black
        // per-mesh below.)
        kind = "wood";
        defaultColor = WOOD;
      }

      // TV SCREEN detection. Reliable path = the MATERIAL name (e.g. this model
      // names it "TV_sreen_material" even though the mesh names are empty). Also
      // check the original mesh name, and a SHAPE fallback (thin upright panel in
      // the upper half). The screen gets a dark GLASS colour; the stand/frame get
      // wood. Note "sreen" (a common misspelling) is matched too.
      const SCREEN_RE = /s(?:c)?reen|display|monitor|\blcd\b|\bled\b|glass/i;
      const GLASS = 0x1c242b; // dark reflective glass (TV screen, off)
      if (isTv) {
        try {
          this.__loadedItem.updateMatrixWorld(true);
          const itemBox = new Box3().setFromObject(this.__loadedItem);
          const itemCenter = itemBox.getCenter(new Vector3());
          const itemSize = itemBox.getSize(new Vector3());
          this.__loadedItem.traverse((o) => {
            if (!o || !o.isMesh) return;
            const s = new Box3().setFromObject(o).getSize(new Vector3());
            const cen = new Box3().setFromObject(o).getCenter(new Vector3());
            const dims = [s.x, s.y, s.z].sort((a, z) => a - z);
            const thin = dims[0] < dims[2] * 0.25; // flat one way = panel
            const big = dims[1] * dims[2] > itemSize.x * itemSize.y * 0.1;
            const upper = cen.y >= itemCenter.y; // upper half = the screen
            if (thin && big && upper) o.userData.__isScreenShape = true;
          });
        } catch (e) {
          /* shape fallback is best-effort */
        }
      }

      let __anyGreyPainted = false;
      this.__loadedItem.traverse((o) => {
        if (!o || !o.isMesh || !o.material) return;
        const origName = (o.userData && o.userData.__origName) || "";
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m || !m.color) return;
          const matName = (m.name || "").toLowerCase();
          const isScreen =
            isTv &&
            (SCREEN_RE.test(matName) ||
              SCREEN_RE.test(origName) ||
              (o.userData && o.userData.__isScreenShape));
          if (isScreen) {
            // Dark glass screen — glossy so it reads like real glass, not paint.
            m.color.setHex(GLASS);
            if ("roughness" in m) m.roughness = 0.08;
            if ("metalness" in m) m.metalness = 0.2;
            m.needsUpdate = true;
            __anyGreyPainted = true;
            return;
          }
          if (m.map) return; // textured non-screen part → already designed
          const c = m.color;
          // "Neutral" = a greyscale material (no real hue): light grey, white,
          // dark grey OR near-black — all "unfinished / placeholder" colours, so
          // they get the item-wise default. A material with a real COLOUR (a
          // hue) is NOT neutral, so it's left untouched. Option A: dark/black
          // placeholder models are recoloured too, not only light-grey ones.
          const neutral =
            Math.abs(c.r - c.g) < 0.07 && Math.abs(c.g - c.b) < 0.07;
          if (neutral) {
            m.color.setHex(defaultColor);
            m.needsUpdate = true;
            __anyGreyPainted = true;
          }
        });
      });
      // Remember what kind we defaulted to. The Components panel (React) reads
      // this to write the RIGHT default finish per item type — a Wood finish for
      // wood items, a fabric/solid finish for sofas & chairs, a contemporary /
      // metal finish for lights — so the Components swatch + BOQ match the item.
      this.__autoDefaultKind = __anyGreyPainted ? kind : null;
      // Remember the exact default colour so a later "reset finish" (used by
      // Ungroup) can repaint the mesh back to it.
      this.__defaultColorHex = defaultColor;
      // Flag every auto-coloured item so the Components panel applies its
      // item-appropriate default finish (kind above). Items that came in with
      // their own colour/texture leave this false and are left untouched.
      this.__autoDefaultColored = __anyGreyPainted;
    } catch (e) {
      /* cosmetic only — never break loading */
    }

    this.dispatchEvent({ type: EVENT_ITEM_LOADED });
  }

  __gltfLoadingProgress(xhr) {
    this.dispatchEvent({
      type: EVENT_ITEM_LOADING,
      loaded: xhr.loaded,
      total: xhr.total,
      percent: (xhr.loaded / xhr.total) * 100,
      jsraw: xhr,
    });
  }

  __createParametricItem() {
    let parametricData = this.__itemModel.parametricClass;

    // let parametricClass = ParametricFactory.getParametricClass(this.__itemModel.baseParametricType.description);
    // parametricData = new(parametricClass.getClass(this.__itemModel.subParametricData.type))(this.__itemModel.subParametricData);

    if (parametricData) {
      this.__loadedItem = new Mesh(
        parametricData.geometry,
        parametricData.material
      );

      // Parametric geometry is authored directly in CENTIMETRES (e.g. an
      // 80×200×20 cm door). __initializeChildItem multiplies the mesh by 100
      // (the metres→cm factor catalog GLBs need), so without compensation a
      // parametric item renders 100× too big (an 80 cm door becomes 80 m).
      // Derive __scale from the native cm bbox + metadata.size so
      // 100 × __scale × nativeSize == metadata.size (renders at true cm size).
      // Guarded on metadata.size, so any parametric item without a size is
      // unchanged.
      const nativeBox = new Box3().setFromObject(this.__loadedItem);
      const nativeSize = new Vector3();
      nativeBox.getSize(nativeSize);
      const expectedSize = this.__itemModel?.__metadata?.size;
      if (
        Array.isArray(expectedSize) &&
        expectedSize.length >= 3 &&
        nativeSize.x > 0 &&
        nativeSize.y > 0 &&
        nativeSize.z > 0
      ) {
        this.__itemModel.__scale.set(
          (Number(expectedSize[0]) || 0) / (100 * nativeSize.x),
          (Number(expectedSize[1]) || 0) / (100 * nativeSize.y),
          (Number(expectedSize[2]) || 0) / (100 * nativeSize.z)
        );
      }

      this.__itemModel.parametricClass.addEventListener(
        EVENT_PARAMETRIC_GEOMETRY_UPATED,
        this.__parametricGeometryUpdateEvent
      );
      this.__initializeChildItem();
      this.dispatchEvent({ type: EVENT_ITEM_LOADED });
    }
  }

  dispose() {
    this.__itemModel.dispose();
    this.__itemModel.removeEventListener(
      EVENT_UPDATED,
      this.__itemUpdatedEvent
    );
    this.parent.remove(this);
  }

  getCorners(position = null, midPoints = false) {
    let corners = [];
    let c1 = new Vector3(-this.halfSize.x, 0, -this.halfSize.z);
    let c2 = new Vector3(this.halfSize.x, 0, -this.halfSize.z);
    let c3 = new Vector3(this.halfSize.x, 0, this.halfSize.z);
    let c4 = new Vector3(-this.halfSize.x, 0, this.halfSize.z);
    let midC1C2 = null;
    let midC2C3 = null;
    let midC3C4 = null;
    let midC4C1 = null;

    let transform = new Matrix4();
    position = position || this.__itemModel.position;

    transform.makeRotationY(this.__itemModel.innerRotation.y);
    transform.setPosition(position);

    c1 = c1.applyMatrix4(transform);
    c2 = c2.applyMatrix4(transform);
    c3 = c3.applyMatrix4(transform);
    c4 = c4.applyMatrix4(transform);

    corners.push(new Vector2(c1.x, c1.z));
    corners.push(new Vector2(c2.x, c2.z));
    corners.push(new Vector2(c3.x, c3.z));
    corners.push(new Vector2(c4.x, c4.z));
    if (midPoints) {
      midC1C2 = c1.clone().add(c2.clone().sub(c1).multiplyScalar(0.5));
      midC2C3 = c2.clone().add(c3.clone().sub(c2).multiplyScalar(0.5));
      midC3C4 = c3.clone().add(c4.clone().sub(c3).multiplyScalar(0.5));
      midC4C1 = c4.clone().add(c1.clone().sub(c4).multiplyScalar(0.5));
      corners.push(new Vector2(midC1C2.x, midC1C2.z));
      corners.push(new Vector2(midC2C3.x, midC2C3.z));
      corners.push(new Vector2(midC3C4.x, midC3C4.z));
      corners.push(new Vector2(midC4C1.x, midC4C1.z));
    }

    return corners;
  }

  /**
   *
   * @param {Vector3} position
   * @param {Boolean} midPoints
   * @param {Boolean} forWallItem
   * @param {Boolean} noConversionTo2D
   * @description Returns the plane that make up this item based on its size. For a floor item it returns
   * the plane on (x, z) coordinates. For a wall item depending on its orientation it will return the plane.
   * Also if the noConversionTo3D is true, it returns the plane on the wall in 3D.
   * @returns {Array} of {Vector2} or {Vector3} depending on noConversionTo2D
   */
  getItemPolygon(
    position = null,
    midPoints = false,
    forWallItem = false,
    noConversionTo2D = false,
    scale = 1.0
  ) {
    /* PERF-REMOVED */ // console.debug("DEBUG: Physical3DItem -> getItemPolygon", this);
    let coords = [];
    let c1 = new Vector3(
      -this.halfSize.x,
      !forWallItem ? 0 : 0,
      forWallItem ? 0 : -this.halfSize.z
    );
    let c2 = new Vector3(
      this.halfSize.x,
      !forWallItem ? 0 : 0,
      forWallItem ? 0 : -this.halfSize.z
    );
    let c3 = new Vector3(
      this.halfSize.x,
      !forWallItem ? 0 : this.halfSize.y * 2,
      forWallItem ? 0 : this.halfSize.z
    );
    let c4 = new Vector3(
      -this.halfSize.x,
      !forWallItem ? 0 : this.halfSize.y * 2,
      forWallItem ? 0 : this.halfSize.z
    );
    let midC1C2 = null;
    let midC2C3 = null;
    let midC3C4 = null;
    let midC4C1 = null;

    let rotationTransform = new Matrix4();
    let scaleTransform = new Matrix4();
    let translateTransform = new Matrix4();

    position = position || this.__itemModel.position;
    scaleTransform.scale(new Vector3(scale, scale, scale));
    if (forWallItem) {
      rotationTransform.makeRotationY(this.__itemModel.rotation.y);
    } else {
      rotationTransform.makeRotationY(this.__itemModel.innerRotation.y);
    }
    rotationTransform.multiply(scaleTransform);

    c1 = c1.applyMatrix4(rotationTransform);
    c2 = c2.applyMatrix4(rotationTransform);
    c3 = c3.applyMatrix4(rotationTransform);
    c4 = c4.applyMatrix4(rotationTransform);

    translateTransform.setPosition(
      new Vector3(position.x, position.y, position.z)
    );

    c1 = c1.applyMatrix4(translateTransform);
    c2 = c2.applyMatrix4(translateTransform);
    c3 = c3.applyMatrix4(translateTransform);
    c4 = c4.applyMatrix4(translateTransform);

    if (forWallItem) {
      coords.push(c1);
      coords.push(c2);
      coords.push(c3);
      coords.push(c4);
    } else {
      coords.push(new Vector2(c1.x, c1.z));
      coords.push(new Vector2(c2.x, c2.z));
      coords.push(new Vector2(c3.x, c3.z));
      coords.push(new Vector2(c4.x, c4.z));
    }

    if (midPoints) {
      midC1C2 = c1.clone().add(c2.clone().sub(c1).multiplyScalar(0.5));
      midC2C3 = c2.clone().add(c3.clone().sub(c2).multiplyScalar(0.5));
      midC3C4 = c3.clone().add(c4.clone().sub(c3).multiplyScalar(0.5));
      midC4C1 = c4.clone().add(c1.clone().sub(c4).multiplyScalar(0.5));
      if (forWallItem) {
        coords.push(midC1C2);
        coords.push(midC2C3);
        coords.push(midC3C4);
        coords.push(midC4C1);
      } else {
        coords.push(new Vector2(midC1C2.x, midC1C2.z));
        coords.push(new Vector2(midC2C3.x, midC2C3.z));
        coords.push(new Vector2(midC3C4.x, midC3C4.z));
        coords.push(new Vector2(midC4C1.x, midC4C1.z));
      }
    }

    if (forWallItem && !noConversionTo2D) {
      return Utils.polygons2DFrom3D(coords);
    } else if (forWallItem && noConversionTo2D) {
      return coords;
    }
    return coords;
  }

  getAlignedPositionForFloor(toAlignWith) {
    function getCoordinate3D(selected, alignWith, position) {
      let vector = null;
      selected = new Vector3(selected.x, position.y, selected.y);
      alignWith = new Vector3(alignWith.x, position.y, alignWith.y);
      vector = selected.clone().sub(position);
      return alignWith.clone().sub(vector);
    }
    let myPosition = this.__itemModel.position;
    let myPolygon2D = this.getItemPolygon(myPosition, true);
    let otherPolygon2D = toAlignWith.getItemPolygon(null, true);
    let minimalDistance = 9999999.0; //Set a threshold of 10 cms to check closest points
    let finalCoordinate3d = null;
    myPolygon2D.forEach((coord) => {
      otherPolygon2D.forEach((otherCoord) => {
        let distance = coord.clone().sub(otherCoord).length();
        if (distance < minimalDistance) {
          finalCoordinate3d = getCoordinate3D(coord, otherCoord, myPosition);
          minimalDistance = distance;
        }
      });
    });

    return finalCoordinate3d;
  }

  getAlignedPositionForWall(toAlignWith) {
    /* PERF-REMOVED console.debug: console.debug(
      "DEBUG: Physical3DItem -> getAlignedPositionForWall -> toAlignWith",
      toAlignWith,
      this.__box,
      this.halfSize
    ); */
    function getCoordinate3D(selected, alignWith, position) {
      let vector = null;
      let newPosition = null;
      vector = selected.clone().sub(position);
      newPosition = alignWith.clone().sub(vector);
      return newPosition;
    }

    let myPosition = this.__itemModel.position;
    /* PERF-REMOVED console.debug: console.debug(
      "DEBUG: Physical3DItem -> getAlignedPositionForWall -> myPosition",
      myPosition
    ); */
    let myPolygon3D = this.getItemPolygon(null, true, true, true);
    /* PERF-REMOVED console.debug: console.debug(
      "DEBUG: Physical3DItem -> getAlignedPositionForWall -> myPolygon3D",
      myPolygon3D
    ); */
    let otherPolygon3D = toAlignWith.getItemPolygon(null, true, true, true);
    /* PERF-REMOVED console.debug: console.debug(
      "DEBUG: Physical3DItem -> getAlignedPositionForWall -> otherPolygon3D",
      otherPolygon3D
    ); */
    let minimalDistance = 9999999.0; //Set a threshold of 10 cms to check closest points
    let finalCoordinate3d = null;
    myPolygon3D.forEach((coord) => {
      otherPolygon3D.forEach((otherCoord) => {
        let distance = coord.clone().sub(otherCoord).length();
        if (distance < minimalDistance) {
          finalCoordinate3d = getCoordinate3D(coord, otherCoord, myPosition);
          minimalDistance = distance;
        }
      });
    });
    console.warn(
      "DEBUG: Physical3DItem -> getAlignedPositionForWall -> finalCoordinate3d",
      finalCoordinate3d,
      minimalDistance
    );
    return finalCoordinate3d;
  }

  getSnappedDirection(x, z, alignedCoordinate) {
    x = Math.round(x);
    z = Math.round(z);
    if (x === 1 && z === 0) {
      if (
        this.position.x > alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "back";
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "front";
      } else if (
        this.position.z > alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "right";
      } else if (
        this.position.z < alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "left";
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "back";
        } else if (res === z) {
          return "right";
        }
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "back";
        } else if (res === z) {
          return "left";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "front";
        } else if (res === z) {
          return "left";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "front";
        } else if (res === z) {
          return "right";
        }
      }
      return "";
    } else if (x === -1 && z === 0) {
      if (
        this.position.x > alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "front";
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "back";
      } else if (
        this.position.z > alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "right";
      } else if (
        this.position.z < alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "left";
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "front";
        } else if (res === z) {
          return "right";
        }
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "front";
        } else if (res === z) {
          return "left";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "back";
        } else if (res === z) {
          return "left";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "back";
        } else if (res === z) {
          return "right";
        }
      }
      return "";
    } else if (x === 0 && z === 1) {
      if (
        this.position.x > alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "left";
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "right";
      } else if (
        this.position.z > alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "back";
      } else if (
        this.position.z < alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "front";
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "left";
        } else if (res === z) {
          return "back";
        }
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "left";
        } else if (res === z) {
          return "front";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "right";
        } else if (res === z) {
          return "front";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "right";
        } else if (res === z) {
          return "back";
        }
      }
      return "";
    } else if (x === 0 && z === -1) {
      if (
        this.position.x > alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "left";
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z == alignedCoordinate.z
      ) {
        return "right";
      } else if (
        this.position.z > alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "front";
      } else if (
        this.position.z < alignedCoordinate.z &&
        this.position.x == alignedCoordinate.x
      ) {
        return "back";
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "left";
        } else if (res === z) {
          return "front";
        }
      } else if (
        this.position.x > alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = this.position.x - alignedCoordinate.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "left";
        } else if (res === z) {
          return "back";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z < alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = alignedCoordinate.z - this.position.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "right";
        } else if (res === z) {
          return "back";
        }
      } else if (
        this.position.x < alignedCoordinate.x &&
        this.position.z > alignedCoordinate.z
      ) {
        const x = alignedCoordinate.x - this.position.x;
        const z = this.position.z - alignedCoordinate.z;
        const res = Math.max(x, z);
        if (res === x) {
          return "right";
        } else if (res === z) {
          return "front";
        }
      }
      return "";
    }
  }

  /**
   * Push this item back out of any wall its footprint has entered, and return
   * the corrected position. Never rejects the move — it only corrects it.
   *
   * Blocking a move makes the item FREEZE while the cursor keeps going (that
   * was the old "lag near walls"); allowing it lets the item sink INTO the
   * wall. Correcting is the third option: the component of the drag going into
   * the wall is cancelled and the component running along it is kept, so the
   * item slides along the wall face instead of stopping or passing through.
   *
   * Walls have THICKNESS. The release-time cleanup measures to the wall
   * centreline and ignores `wall.thickness`, which is why items could come to
   * rest about half a wall buried. This measures to the inner FACE.
   */
  resolveWallPenetration(coordinate3d) {
    const out = coordinate3d.clone
      ? coordinate3d.clone()
      : new Vector3(coordinate3d.x, coordinate3d.y, coordinate3d.z);
    try {
      // Wall-hosted items belong INSIDE a wall — doors, windows, niche units.
      // Pushing them out would break them.
      if (
        this.itemModel instanceof InWallFloorItem ||
        this.itemModel?.isWallDependent
      ) {
        return out;
      }
      const walls =
        this.__itemModel?.__model?.__floorplan?.walls ||
        BlueprintInterface?.blueprint3d?.model?.__floorplan?.walls ||
        [];
      if (!walls.length || !this.halfSize) return out;

      const hx = Math.abs(this.halfSize.x);
      const hz = Math.abs(this.halfSize.z);
      if (!(hx > 0.01) || !(hz > 0.01)) return out;

      // The footprint is a ROTATED box. Its two local axes in world XZ —
      // matching getItemPolygon's makeRotationY convention.
      const angle = this.__itemModel.innerRotation.y;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const axX = { x: cos, z: -sin };
      const axZ = { x: sin, z: cos };

      const MARGIN = 0.5; // cm of daylight kept off the wall face
      const rooms = this.__itemModel?.__model?.__floorplan?.getRooms?.() || [];

      // Precompute each wall's geometry ONCE — none of it depends on where the
      // item currently is, so it must not be recomputed inside the pass loop.
      const prepared = [];
      for (const w of walls) {
        const s = w?.start;
        const e = w?.end;
        if (!s || !e) continue;
        // Floorplan y is the world z axis.
        const dx = e.x - s.x;
        const dz = e.y - s.y;
        const len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const nx = -dz / len; // unit normal, perpendicular to the wall
        const nz = dx / len;
        const ux = dx / len; // unit direction, along the wall
        const uz = dz / len;
        // FULL thickness, not half. The corner-to-corner line (wall.start →
        // wall.end) is the wall's EXTERIOR face, not its centreline — the
        // interior face sits a whole thickness inward. This is the same
        // calibration SnapEngine documents for `wallExtraOffset` (default 10 =
        // pazl's standard wall thickness). Clearing only half left the item
        // about 5 cm buried in the wall.
        const wallInset = Number(w.thickness) || 10;

        // WHICH SIDE IS THE ROOM? Probe just off each face and see which one
        // lands in a room. Pushing simply "to whichever side the centre is on"
        // is wrong: an item whose centre has already slipped past the wall gets
        // shoved FURTHER out, away from the room, instead of back inside.
        const midX = (s.x + e.x) / 2;
        const midZ = (s.y + e.y) / 2;
        // Probe INSIDE the interior face, so the room test is unambiguous.
        const probe = wallInset + 2;
        const inRoom = (px, pz) =>
          rooms.some((r) => r?.pointInRoom && r.pointInRoom(new Vector2(px, pz)));
        const plusInside = inRoom(midX + nx * probe, midZ + nz * probe);
        const minusInside = inRoom(midX - nx * probe, midZ - nz * probe);
        // An interior wall has a room on BOTH sides — there is no single
        // "inside", so keep the item on the side it is already on. `inward = 0`
        // means "decide from the item's own position".
        let inward = 0;
        if (plusInside && !minusInside) inward = 1;
        else if (minusInside && !plusInside) inward = -1;

        prepared.push({
          sx: s.x,
          sz: s.y,
          nx,
          nz,
          ux,
          uz,
          len,
          wallInset,
          inward,
          reachPerp:
            Math.abs(hx * (axX.x * nx + axX.z * nz)) +
            Math.abs(hz * (axZ.x * nx + axZ.z * nz)),
          reachAlong:
            Math.abs(hx * (axX.x * ux + axX.z * uz)) +
            Math.abs(hz * (axZ.x * ux + axZ.z * uz)),
        });
      }

      // A corner is two walls at once: pushing off one can push into the other,
      // so re-solve a few times until nothing moves.
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const p of prepared) {
          const relX = out.x - p.sx;
          const relZ = out.z - p.sz;
          const dist = relX * p.nx + relZ * p.nz; // signed, to the CENTRELINE

          // Where the item must end up, measured from the wall centreline.
          const needed = p.wallInset + p.reachPerp + MARGIN;
          // Toward the room for an exterior wall; otherwise keep it on its
          // current side.
          const sign = p.inward !== 0 ? p.inward : dist >= 0 ? 1 : -1;
          // Signed clearance ALONG that direction — negative when the item has
          // crossed to the far side, so the correction still brings it back.
          const clearance = dist * sign;
          const penetration = needed - clearance;
          if (penetration <= 0) continue; // already clear of this wall

          // A wall is a SEGMENT. Without this, a wall on the far side of the
          // plan would push an item that is nowhere near it.
          const along = relX * p.ux + relZ * p.uz; // 0 at start, len at end
          if (along < -p.reachAlong || along > p.len + p.reachAlong) continue;

          // Push along the NORMAL only — movement parallel to the wall is left
          // untouched, which is what makes the item slide rather than stick.
          out.x += sign * penetration * p.nx;
          out.z += sign * penetration * p.nz;
          moved = true;
        }
        if (!moved) break;
      }
    } catch (e) {
      // Placement must never fail because of this correction.
      console.warn("resolveWallPenetration skipped", e);
    }
    return out;
  }

  handleFloorItemsPositioning(coordinate3d, normal, intersectingPlane) {
    // Correct the candidate BEFORE anything downstream reads it, so the room
    // test, the collision pass and the final placement all see the same
    // already-legal position.
    coordinate3d = this.resolveWallPenetration(coordinate3d);

    // Is the item in a room? Tested on its CENTRE, not on all four corners.
    //
    // This gates the snapToPoint() call below — the only place a floor item
    // actually moves. It used to run Utils.polygonInsidePolygon, which demands
    // that EVERY corner of the footprint be inside the room. Dragging near a
    // wall puts one corner over the boundary, so the test failed, the move was
    // skipped, and the item froze while the cursor kept going — then jumped
    // when it came back inside. That stutter read as lag near walls.
    //
    // A corner over the boundary is not an error here: __resolveFloorItemOffWalls
    // states the intent plainly — "the item can be dragged anywhere during the
    // drag, and when dropped it settles flush beside any wall it was
    // straddling". The strict test was blocking mid-drag exactly what the
    // release handler exists to tidy up.
    //
    // Centre-testing also makes this agree with __moveListener, which already
    // confines the item by its CENTRE. Previously one check allowed what the
    // other refused. Cheaper too: one point-in-polygon test per room instead of
    // one per corner, on every drag frame.
    let withinRoomBounds = false;
    let rooms = this.__itemModel.__model.__floorplan.getRooms();
    const centre2D = new Vector2(coordinate3d.x, coordinate3d.z);
    let i = 0;
    for (i = 0; i < rooms.length; i++) {
      if (rooms[i]?.pointInRoom && rooms[i].pointInRoom(centre2D)) {
        withinRoomBounds = true;
        break;
      }
    }
    // Declared here now: the room test above no longer builds a polygon, so
    // this is the first and only use.
    let myPolygon2D = this.getItemPolygon(
      coordinate3d,
      false,
      false,
      false,
      1.25
    );
    for (i = 0; i < this.parent?.__physicalRoomItems?.length; i++) {
      let otherObject = this.parent?.__physicalRoomItems[i];
      let otherPolygon2D = null;
      let flag = false;
      // Skip the item we're resting ON TOP of (surface stacking) — the pot's
      // footprint overlaps the table's in 2D even though it sits above it, so
      // the collision push would otherwise shove it off the table.
      if (otherObject === this.__supportItem) continue;
      if (otherObject != this && otherObject.itemModel.isBoundToFloor) {
        otherPolygon2D = otherObject.polygon2D;
        flag = Utils.polygonPolygonIntersect(myPolygon2D, otherPolygon2D);
        const vector3 = new Vector3();
        const objectNormal = this.getWorldDirection(vector3);
        /* PERF-REMOVED console.debug: console.debug(
          "DEBUG: Physical3DItem -> handleFloorItemsPositioning ~ intersection",
          myPolygon2D,
          otherPolygon2D,
          flag
        ); */
        if (flag) {
          let alignedCoordinate = this.getAlignedPositionForFloor(otherObject);
          const snappedDirection = this.getSnappedDirection(
            objectNormal.x,
            objectNormal.z,
            alignedCoordinate
          );
          if (snappedDirection) {
            /* PERF-REMOVED console.debug: console.debug(
              "DEBUG: Physical3DItem -> handleFloorItemsPositioning ~ snappedDirection",
              snappedDirection
            ); */
            BlueprintInterface.ProjectManagerService.updateFurnisheModelExposureOnSnapped(
              this.itemModel.__id,
              snappedDirection
            );
          }
          /* PERF-REMOVED console.debug: console.debug(
            "DEBUG: Physical3DItem -> handleFloorItemsPositioning alignedCoordinate",
            alignedCoordinate
          ); */
          // When the SnapEngine produced an object snap, it already placed the
          // item flush on the correct face. The legacy corner-based alignment
          // above is one-sided, so don't let it override the snap — only use it
          // when there's no active object snap.
          if (alignedCoordinate && !this.__activeObjectSnap) {
            coordinate3d = alignedCoordinate;
          }
          break;
        }
      }
    }
    // A wall snap (flagged on the item by the drag controller) places the item
    // flush against a wall, so its polygon edge sits exactly on the room's
    // interior boundary and the strict polygonInsidePolygon test above can
    // reject it on some walls. Trust the wall snap in that case.
    if (
      withinRoomBounds ||
      this.__activeWallSnap ||
      this.itemModel instanceof InWallFloorItem
    ) {
      // Keep floor / free-standing items grounded while dragging. The pointer's
      // floor Y is ~0, so snapping the (centred) mesh there sinks its base half
      // a height below the floor. Force the drop Y to halfSize.y so the base
      // stays on the floor. Wall / in-wall items keep their own elevation.
      const isFloorGrounded =
        this.__itemType === MODEL_TYPES.ITEM ||
        this.__itemType === MODEL_TYPES.FLOOR_UNIT ||
        this.__itemType === 0 ||
        this.__itemType === "0" ||
        this.__itemType === 1 ||
        this.__itemType === "1";
      if (
        isFloorGrounded &&
        this.halfSize &&
        Number.isFinite(this.halfSize.y) &&
        !(this.itemModel instanceof InWallFloorItem)
      ) {
        coordinate3d = coordinate3d.clone
          ? coordinate3d.clone()
          : new Vector3(coordinate3d.x, coordinate3d.y, coordinate3d.z);
        coordinate3d.y = this.halfSize.y;
      }
      this.__itemModel.snapToPoint(
        coordinate3d,
        normal,
        intersectingPlane,
        this
      );
    }
  }

  handleWallItemsPositioning(coordinate3d, normal, intersectingPlane) {
    let myPolygon2D = this.getItemPolygon(coordinate3d, true, true, false, 1.5);
    /* PERF-REMOVED */ // console.debug("handleWallItemsPositioning -> myPolygon2D", myPolygon2D);
    let i = 0;
    let myWallUUID = this.itemModel.currentWall
      ? this.itemModel.currentWall.uuid
      : null;
    for (i = 0; i < this.parent?.__physicalRoomItems?.length; i++) {
      let otherObject = this.parent?.__physicalRoomItems[i];
      let otherWallUUID =
        otherObject.itemModel.isWallDependent &&
        otherObject.itemModel.currentWall
          ? otherObject.itemModel.currentWall.uuid
          : null;
      let otherPolygon2D = null;
      let flag = false;
      /*  if (!myWallUUID || !otherWallUUID || myWallUUID != otherWallUUID) {
        continue;
      } */

      if (otherObject != this) {
        const prevPosition = new Vector3(
          this.position.x,
          this.position.y,
          this.position.z
        );
        /* PERF-REMOVED console.debug: console.debug(
          "handleWallItemsPositioning -> prevPosition",
          prevPosition
        ); */
        this.position.set(coordinate3d.x, coordinate3d.y, coordinate3d.z);
        const box1 = new Box3().setFromObject(this);
        const box2 = new Box3().setFromObject(otherObject);
        /* PERF-REMOVED console.debug: console.debug(
          "handleWallItemsPositioning -> collision check",
          box1,
          box2
        ); */

        //otherPolygon2D = otherObject.polygon2D;
        //flag = Utils.polygonPolygonIntersect(myPolygon2D, otherPolygon2D);
        ///* PERF-REMOVED */ // console.debug('handleWallItemsPositioning -> comparing otherWallUUID', flag, otherObject);
        if (box1.intersectsBox(box2)) {
          this.position.set(prevPosition.x, prevPosition.y, prevPosition.z);
          let alignedCoordinate = this.getAlignedPositionForWall(otherObject);
          if (alignedCoordinate) {
            // Keep the cursor's dragged HEIGHT even when this wall item
            // horizontally overlaps a neighbour (e.g. a door). Previously this
            // forced alignedCoordinate.y = prevPosition.y, which locked the
            // height and snapped the item back to the neighbour's line on
            // release. We still pin the horizontal axis so the item doesn't
            // pass THROUGH the neighbour, but vertical drag stays free.
            alignedCoordinate.y = coordinate3d.y;
            if (this.itemModel.__currentWallNormal.x !== 0) {
              alignedCoordinate.x = prevPosition.x;
            } else if (this.itemModel.__currentWallNormal.z !== 0) {
              alignedCoordinate.z = prevPosition.z;
            }

            coordinate3d = alignedCoordinate;
          }
          break;
        }
      }
    }
    this.__itemModel.snapToPoint(coordinate3d, normal, intersectingPlane, this);
  }

  snapToPoint(coordinate3d, normal, intersectingPlane) {
    /* PERF-REMOVED */ // console.debug("DEBUG: Physical3DItem -> snapToPoint");
    if (this.itemModel.isWallDependent && !this.itemModel.isBoundToFloor) {
      this.handleWallItemsPositioning(coordinate3d, normal, intersectingPlane);
      return;
    }
    this.handleFloorItemsPositioning(coordinate3d, normal, intersectingPlane);
  }

  removeItem(item) {
    this.remove(item);
  }

  __displayBoxHelper(flag) {
    this.__boxhelper.visible = flag;
  }

  // Rebuild the selection outline so it wraps the mesh at its CURRENT position.
  // A door re-snaps / rebuilds its geometry (e.g. on a colour change), which
  // otherwise leaves the box floating at the old spot. Build it as a world-
  // aligned box around the live mesh, placed at the mesh centre in local space.
  refreshSelectionBox() {
    try {
      if (!this.__loadedItem || !this.__boxhelper) return;
      this.updateMatrixWorld(true);
      this.__loadedItem.updateMatrixWorld(true);
      const box = new Box3().setFromObject(this.__loadedItem);
      if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
      this.__box = box;
      const size = box.getSize(new Vector3());
      this.__boxhelper.geometry = new EdgesGeometry(
        new BoxBufferGeometry(size.x, size.y, size.z)
      );
      const worldCenter = box.getCenter(new Vector3());
      const localCenter = this.worldToLocal(worldCenter.clone());
      this.__boxhelper.position.copy(localCenter);
      this.__boxhelper.rotation.set(0, 0, 0);
    } catch (e) {
      /* best-effort — never break for a selection outline */
    }
  }

  snapToWall(coordinate3d, wall, wallEdge) {
    this.__itemModel.snapToWall(coordinate3d, wall, wallEdge);
  }

  get size() {
    return this.__size;
  }

  set size(sizeVector) {
    this.__size = new Vector3(sizeVector.x, sizeVector.y, sizeVector.z);
    this.__itemModel.__size.set(sizeVector.x, sizeVector.y, sizeVector.z);

    this.__box = new Box3().setFromObject(this);
    /* PERF-REMOVED */ // console.debug("DEBUG: setting size -> box", this.__box);
    this.__center = this.__box.getCenter(new Vector3());
    /* PERF-REMOVED */ // console.debug("DEBUG: setting size -> center", this.__center);

    let m = new Matrix4();
    m = m.makeTranslation(0, -this.__box.min.y, 0);
    let sizeX =
      this.__itemModel.__scale.x < 1
        ? Math.abs(1 - this.__itemModel.__scale.x) *
          this.geometry.parameters.width
        : this.__itemModel.__scale.x > 1
        ? Math.abs(this.__itemModel.__scale.x - 1) *
          -this.geometry.parameters.width
        : 0;
    this.geometry = new BoxBufferGeometry(
      this.geometry.parameters.width - sizeX,
      sizeVector.y,
      sizeVector.z
    );
    this.geometry.applyMatrix4(m);
    /* PERF-REMOVED */ // console.debug("DEBUG: setting size -> geometry", this.geometry);

    this.geometry.computeBoundingBox();
    this.halfSize = this.objectHalfSize(this.geometry);
  }

  get worldBox() {
    return this.box.clone().applyMatrix4(this.matrixWorld);
  }

  get box() {
    return this.__box;
  }

  get selected() {
    return this.__selected;
  }

  set selected(flag) {
    this.__selected = flag;
    this.__refreshHighlight();
  }

  set hovered(flag) {
    this.__hovered = flag;
    this.__refreshHighlight();
  }

  // Decide the outline: BLUE when selected, CYAN when only hovered, hidden
  // otherwise. Selection wins over hover, so a selected item stays blue.
  __refreshHighlight() {
    // A DOOR re-snaps / rebuilds its geometry (e.g. on a colour change), which
    // can leave its selection box floating at the old spot. Rebuild the box at
    // the door's CURRENT position whenever the outline is about to show — for
    // BOTH selection and hover (hover used to skip this, leaving the old box
    // floating). Doors only — other items keep their normal box.
    if (this.__selected || this.__hovered) {
      try {
        const md = this.__itemModel && this.__itemModel.__metadata;
        const isDoor =
          md &&
          (md.itemType === 7 ||
            String(md.baseParametricType || "")
              .toUpperCase()
              .indexOf("DOOR") >= 0);
        if (isDoor && typeof this.refreshSelectionBox === "function") {
          this.refreshSelectionBox();
        }
      } catch (e) {
        /* best-effort */
      }
    }
    if (this.__selected) {
      this.__boxhelper.material = this.__selectedMaterial;
      this.__boxhelper.visible = true;
    } else if (this.__hovered) {
      this.__boxhelper.material = this.__hoverMaterial;
      this.__boxhelper.visible = true;
    } else {
      this.__boxhelper.visible = false;
    }
  }

  set location(coordinate3d) {
    this.__itemModel.position = coordinate3d;
  }

  get location() {
    return this.__itemModel.position.clone();
  }

  get intersectionPlanes() {
    return this.__itemModel.intersectionPlanes;
  }

  get itemModel() {
    return this.__itemModel;
  }

  get corners() {
    return this.getCorners();
  }

  get polygon2D() {
    if (this.itemModel.isWallDependent && !this.itemModel.isBoundToFloor) {
      return this.getItemPolygon(null, false, true);
    }
    return this.getItemPolygon();
  }
}

/**
export class Physical3DItem {
    constructor(itemModel) {
        // console.log(this);
        return new Proxy(new Physical3DItemNonProxy(itemModel), {
            get(target, name, receiver) {
                // console.log('USING REFLECT.GET ', target);
                if (!Reflect.has(target, name) && !Reflect.has(target.itemModel, name)) {
                    return undefined;
                }
                if (Reflect.has(target, name)) {
                    return Reflect.get(target, name);
                }
                if (Reflect.has(target.itemModel, name)) {
                    return Reflect.get(target.itemModel, name);
                }
                return undefined;
            }
        });
    }
}
 */
