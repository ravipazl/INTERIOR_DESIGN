import { Item, UP_VECTOR } from "./item.js";
import { Vector2, Vector3 } from "three";
import { Utils } from "../core/utils.js";
import BlueprintInterface from "@pazl/blueprint-interface.js";

/**
 * A Floor Item is an entity to be placed related to a floor.
 */
export class FloorItem extends Item {
  constructor(model, metadata, id) {
    super(model, metadata, id);
    this.__freePosition = false;
    this.__boundToFloor = true;
    this.__customIntersectionPlanes =
      this.__model.floorplan.floorPlanesForIntersection;
  }

  snapToPoint(
    point,
    normal,
    intersectingPlane,
    model,
    toWall,
    toFloor,
    toRoof
  ) {
    let normal2d = new Vector2(normal.x, normal.z);
    let angle = Utils.angle(UP_VECTOR, normal2d);
    this.rotation = new Vector3(0, angle, 0);
    // Resting height: normally the item's base sits on the floor (Y=0), so the
    // centre is at half-height. If the drag controller found a support surface
    // beneath it (a table/shelf), use the pre-computed rest height that lands
    // the item's visible bottom flush on that surface (flower pot on a table).
    // `model` is the Physical3DItem carrying the flag.
    const restPivotY = model?.__restPivotY;
    // Ground to the Physical3DItem's freshly-measured half-height when it's
    // available. `this.halfSize` (the item MODEL's) can lag behind after a
    // resize; the 3D object's halfSize is rebuilt on every re-init, so it's the
    // trustworthy value. Falls back to the model's own halfSize if absent.
    const groundY =
      model && model.halfSize && Number.isFinite(model.halfSize.y)
        ? model.halfSize.y
        : this.halfSize.y;
    point.y = typeof restPivotY === "number" ? restPivotY : groundY;
    this.position = point;
    this.__currentFloor = intersectingPlane;
    const furnishedModel =
      BlueprintInterface.ProjectManagerService.getFurnishedModelById(this.__id);
    if (
      intersectingPlane &&
      furnishedModel &&
      furnishedModel.roomId != intersectingPlane.room?.uuid
    ) {
      BlueprintInterface.ProjectManagerService.onFurnishedModelRoomUpdated(
        this.__id,
        intersectingPlane.room.uuid,
        intersectingPlane.room.name
      );
    }
  }

  get currentFloor() {
    return this.__currentFloor;
  }

  // /** */
  // placeInRoom() {
  //     if (!this.position_set) {
  //         var center = this.__model.floorplan.getCenter();
  //         this.position.x = center.x;
  //         this.position.z = center.z;
  //         this.position.y = 0.5 * (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y);
  //     }
  // }
}
