import { InWallItem } from "./in_wall_item.js";
import { Vector2, Vector3, Matrix4 } from "three";
import { UP_VECTOR } from "./item.js";
import { Utils } from "../core/utils.js";
import { Plane } from "three/build/three.module.js";
import BlueprintInterface from "@pazl/blueprint-interface.js";

/** */
export class InWallFloorItem extends InWallItem {
  constructor(model, metadata, id) {
    super(model, metadata, id);
    this.__isBoundToFloor = true;
    this.__customIntersectionPlanes =
      this.__model.floorplan.wallPlanesForIntersection;
  }

  snapToPoint(point, normal, intersectingPlane, toWall, toFloor, toRoof) {
    if (!intersectingPlane) return;
    this.snapToWall(point, intersectingPlane.wall, intersectingPlane.edge);
    const furnishedModel =
      BlueprintInterface.ProjectManagerService.getFurnishedModelById(this.__id);
    // `intersectingPlane` is a WALL plane — it only carries `.wall` and
    // `.edge`, NOT `.room`. Guard `room` before reading `.uuid`/`.name`;
    // the old code only guarded the comparison (`room?.uuid`) but then
    // dereferenced `room.uuid` unconditionally, crashing when the dragged
    // plane had no room (e.g. for an in-wall-floor item on a bare wall).
    const room = intersectingPlane.room;
    if (room && furnishedModel && furnishedModel.roomId !== room.uuid) {
      BlueprintInterface.ProjectManagerService.onFurnishedModelRoomUpdated(
        this.__id,
        room.uuid,
        room.name
      );
    }
  }

  snapToWall(point, wall, wallEdge) {
    // During Wall.resetFrontBack the wall's front/back HalfEdge is destroyed and
    // rebuilt; the edgeDeleted event can fire while frontEdge/backEdge is still
    // null (item.js __edgeDeleted already guards wallEdge?.vertices for the same
    // reason). Bail out safely instead of dereferencing a null edge — the item
    // re-snaps cleanly once the wall finishes rebuilding its edges.
    if (!wall || !wallEdge || !wallEdge.normal) return;
    let normal = wallEdge.normal;
    let plane = new Plane(normal);
    let normal2d = new Vector2(normal.x, normal.z);
    let angle = Utils.angle(UP_VECTOR, normal2d);

    let tempPoint = new Vector3();
    let matrix = new Matrix4();

    matrix.setPosition(wallEdge.center);
    plane.applyMatrix4(matrix);
    plane.projectPoint(point, tempPoint);
    point = tempPoint.clone();
    // Seat the door across the wall's THICKNESS. The projected point sits on the
    // room-facing wall FACE (the edge). The built-in PARAMETRIC door is thin and
    // is nudged just off that face (× 0.1). A SWAPPED catalog door GLB is a full
    // 3D model with real depth, so leaving it on the face makes it stick out into
    // the room; push it back to the wall CENTRELINE (× 0.5) so it embeds in the
    // opening instead of protruding. Parametric doors keep their original nudge.
    const isParametric = !!this.parametricClass;
    const embedFactor = isParametric ? 0.1 : 0.5;
    point = point
      .clone()
      .sub(normal.clone().multiplyScalar(wall.thickness * embedFactor));
    point = this.__fitToWallBounds(point, wallEdge);
    // Seat the door's BASE on the floor. The mesh is centred, so y = halfSize.y
    // puts the bottom at floor level. (Was y = 0, which centred the door on the
    // floor line and sank its lower half underground.) Matches the floor-seating
    // in Physical3DItem.__initializeChildItem, so snapping/dragging keeps it put.
    point.y = this.halfSize.y;
    this.rotation = new Vector3(0, angle, 0);
    //this.innerRotation=new Vector3(0, angle, 0);

    this.position = point;
    this.__currentWallSnapPoint = point.clone();
    this.__currentWallNormal = normal.clone();
    this.__backVisible = true;
    this.__addToAWall(wall, wallEdge);
  }

  __parametricGeometryUpdate(evt, updateForWall = true) {
    super.__parametricGeometryUpdate(evt, false);
    if (this.__currentWall && updateForWall) {
      let currentPosition = this.position.clone();
      currentPosition.y = this.halfSize.y + 5;
      this.position = currentPosition;
      this.__currentWall.addItem(this);
    }
  }
}
