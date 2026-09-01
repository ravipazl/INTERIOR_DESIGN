import { FloorItem } from "./floor_item.js";
import { Vector2, Vector3 } from "three";
import { Utils } from "../core/utils.js";
import { UP_VECTOR } from "./item.js";
import BlueprintInterface from "@pazl/blueprint-interface.js";

/** */
export class InFloorItem extends FloorItem {
  constructor(model, metadata, id) {
    super(model, metadata, id);
    this.receiveShadow = true;
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
    point.y = -this.halfSize.y;
    this.position = point;
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
}
