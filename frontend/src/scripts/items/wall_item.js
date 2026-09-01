import { Vector2, Vector3, Quaternion, Euler, Plane } from "three";
import { Matrix4 } from "three/build/three.module.js";
import { Utils } from "../core/utils.js";
import { Item, UP_VECTOR } from "./item.js";
import BlueprintInterface from "@pazl/blueprint-interface.js";

/**
 * A Wall Item is an entity to be placed related to a wall.
 */
export class WallItem extends Item {
  constructor(model, metadata, id) {
    super(model, metadata, id);
    this.__isWallDependent = true;
    this.__boundToFloor = false;
    this.__allowRotate = false;
    this.__freePosition = false;
    this.__customIntersectionPlanes =
      this.__model.floorplan.wallPlanesForIntersection;
  }

  __fitToWallBounds(point, wallEdge) {
    console.debug("DEBUG: wall-item fitToWallBounds", point, wallEdge);
    let point2d = new Vector2(point.x, point.z);
    let wallEdgeVector = wallEdge
      .interiorEnd()
      .clone()
      .sub(wallEdge.interiorStart());
    let sizeX = this.__halfSize.x + 5;
    let sizeVector = wallEdgeVector.clone().normalize().multiplyScalar(sizeX);
    let positionMinusSize = point2d.clone().sub(sizeVector);
    let positionPlusSize = point2d.clone().add(sizeVector);

    let startToPlusSizeVector = positionPlusSize.sub(wallEdge.interiorStart());
    let endToMinusSizeVector = positionMinusSize.sub(wallEdge.interiorEnd());

    if (startToPlusSizeVector.length() > wallEdgeVector.length()) {
      let p = wallEdge.interiorEnd().clone().sub(sizeVector);
      return new Vector3(p.x, point.y, p.y);
    }
    if (endToMinusSizeVector.length() > wallEdgeVector.length()) {
      let p = wallEdge.interiorStart().clone().add(sizeVector);
      return new Vector3(p.x, point.y, p.y);
    }
    return point;
  }

  snapToPoint(point, normal, intersectingPlane, toWall, toFloor, toRoof) {
    if (!intersectingPlane) return;
    this.snapToWall(point, intersectingPlane.wall, intersectingPlane.edge);
    const furnishedModel =
      BlueprintInterface.ProjectManagerService.getFurnishedModelById(this.__id);
    const room = intersectingPlane.room;
    if (
      room &&
      furnishedModel &&
      furnishedModel.roomId !== room.uuid
    ) {
      BlueprintInterface.ProjectManagerService.onFurnishedModelRoomUpdated(
        this.__id,
        room.uuid,
        room.name
      );
    }
  }

  snapToWall(point, wall, wallEdge) {
    super.snapToWall(point, wall, wallEdge);

    // Defensive guards — if any required edge data is missing, fall through
    // to the original (pre-fix) behaviour so the item still gets added
    // somewhere rather than the whole add-flow throwing and leaving the
    // user with nothing on screen. The position may be wrong but the
    // furnishedModel record still gets created and can be moved manually.
    if (!wallEdge || !wallEdge.normal) {
      console.warn(
        "WallItem.snapToWall: wallEdge.normal missing — placing at origin, user can drag"
      );
      this.__addToAWall(wall, wallEdge);
      this.position = new Vector3(0, this.__halfSize?.y || 100, 0);
      return;
    }

    let normal = wallEdge.normal.clone();

    // Sanity check: the edge normal should point INTO the room. If the
    // chosen edge happens to face outward (orphan wall, adjacent room's
    // HalfEdge, reversed polygon winding), flip it so the item lands
    // inside the room rather than outside.
    const room = wallEdge.room;
    if (room && room.center && wallEdge.center) {
      const dot =
        normal.x * (room.center.x - wallEdge.center.x) +
        normal.z * (room.center.z - wallEdge.center.z);
      if (dot < 0) {
        normal.negate();
      }
    }

    let normal2d = new Vector2(normal.x, normal.z);
    let angle = Utils.angle(UP_VECTOR, normal2d);

    let plane = new Plane(normal);
    let tempPoint = new Vector3();
    let matrix = new Matrix4();
    matrix.setPosition(wallEdge.center);
    plane.applyMatrix4(matrix);
    plane.projectPoint(point, tempPoint);
    point = tempPoint.clone();
    point = this.__fitToWallBounds(point, wallEdge);
    // Shift the item centre half-its-depth along the wall normal so the
    // BACK face sits flush against the wall surface. The engine works in
    // cm (1 unit = 1 cm) and `__halfSize.z` is already in cm — no further
    // unit scaling is needed. (A previous version multiplied an extra
    // offset by `halfSize.z * 100` which pushed wall items 5–10 m outside
    // the room; that has been removed.)
    point = point.clone().add(normal.clone().multiplyScalar(this.__halfSize.z));

    this.__currentWallNormal = normal.clone();
    this.__currentWallSnapPoint = point.clone();
    this.__addToAWall(wall, wallEdge);
    this.position = point;
    this.rotation = new Vector3(0, angle, 0);
  }

  __parametricGeometryUpdate(evt, updateForWall = true) {
    super.__parametricGeometryUpdate(evt, false);
    if (this.__currentWall && updateForWall) {
      let point = this.__currentWallSnapPoint.clone();
      point = point
        .clone()
        .add(
          this.__currentWallNormal
            .clone()
            .multiplyScalar(
              this.halfSize.z + this.__currentWall.thickness * 0.25
            )
        );
      this.position = point;
      this.__currentWall.addItem(this);
    }
  }

  __combineRotations() {
    let normal = this.__currentWallNormal;
    if (!this.__currentWallEdge) {
      return new Vector3();
    }
    if (!this.__currentWallNormal) {
      normal = this.__currentWallEdge.normal.clone().normalize();
    }
    let realInnerRotation = new Quaternion().setFromAxisAngle(
      normal,
      this.innerRotation.z
    );
    let quatRotation = new Quaternion().setFromEuler(
      new Euler(this.rotation.x, this.rotation.y, this.rotation.z)
    );
    let combinedRotation = realInnerRotation.multiply(quatRotation);
    let finalEuler = new Euler().setFromQuaternion(combinedRotation);
    return new Vector3(finalEuler.x, finalEuler.y, finalEuler.z);
  }

  get currentWall() {
    return this.__currentWall;
  }
}
