import BlueprintInterface from "@pazl/blueprint-interface";
import {
  LocalDBManager,
  LocalDBObjectStores,
} from "../services/LocalDBManager";
import { Model } from "@pazl/entities/Model";

export interface FurnishedModelType {
  _id: string;
  projectId: string;
  modelId: string;
  model: Model;
  position: number[];
  scale: number[];
  rotation: number[];
  dimensions: number[];
  roomId: string;
  roomName: string;
  floorPlanId: string;
  isActive: boolean;
  isHandleChanged: boolean;
}

export enum ROTATION_MODES {
  ROTATE_LEFT = "rotate_left",
  ROTATE_RIGHT = "rotate_right",
  RESET = "reset",
}

export class FurnishedModel extends LocalDBManager {
  _id: string;
  projectId: string;
  modelId: string;
  model: Model;
  position: number[];
  scale: number[];
  rotation: number[];
  dimensions: number[];
  roomId: string;
  roomName: string;
  floorPlanId: string;
  isActive: boolean;
  isHandleChanged: boolean;

  constructor(props: FurnishedModelType) {
    super();
    this._id = props._id;
    this.projectId = props.projectId;
    this.modelId = props.modelId;
    this.model = props.model;
    this.position = props.position;
    this.scale = props.scale;
    this.rotation = props.rotation;
    this.dimensions = props.dimensions;
    this.roomId = props.roomId;
    this.roomName = props.roomName;
    this.floorPlanId = props.floorPlanId;
    this.isActive = props.isActive;
    this.isHandleChanged = props.isHandleChanged;
  }

  async save() {
    const data = {
      _id: this._id,
      projectId: this.projectId,
      modelId: this.modelId,
      position: this.position,
      scale: this.scale,
      rotation: this.rotation,
      dimensions: this.dimensions,
      roomId: this.roomId,
      roomName: this.roomName,
      floorPlanId: this.floorPlanId,
      isActive: true,
      isHandleChanged: this.isHandleChanged ?? false,
    };
    if (!this._id) {
      delete data._id;
    }
    const savedEntityId = await this.saveToLocalDB(
      data,
      LocalDBObjectStores.FURNINSHED_MODEL
    );
    return savedEntityId;
  }

  async remove() {
    const data = {
      _id: this._id,
      projectId: this.projectId,
      modelId: this.modelId,
      position: this.position,
      scale: this.scale,
      rotation: this.rotation,
      dimensions: this.dimensions,
      roomId: this.roomId,
      roomName: this.roomName,
      floorPlanId: this.floorPlanId,
      isActive: false,
      // Mark the record as deleted so the backend /sync service actually
      // REMOVES it (sync.class.js handles `isDeleted`). Previously remove()
      // only set isActive:false, which the sync treats as an UPDATE, so the
      // record was never removed — leaving an orphan on every remove/re-dock
      // (placement-type change). Over time this accumulated many duplicate
      // furnished_models for one item (some stuck at the same height), which
      // fought the drag. Matches FurnishedModelComponent.remove()'s pattern.
      isDeleted: true,
      isHandleChanged: this.isHandleChanged ?? false,
    };
    const savedEntityId = await this.updateToLocalDB(
      data,
      LocalDBObjectStores.FURNINSHED_MODEL
    );
    return savedEntityId;
  }

  async update() {
    const data = {
      _id: this._id,
      projectId: this.projectId,
      modelId: this.modelId,
      position: this.position,
      scale: this.scale,
      rotation: this.rotation,
      dimensions: this.dimensions,
      roomId: this.roomId,
      roomName: this.roomName,
      floorPlanId: this.floorPlanId,
      isActive: true,
      isHandleChanged: this.isHandleChanged ?? false,
    };
    const savedEntityId = await this.updateToLocalDB(
      data,
      LocalDBObjectStores.FURNINSHED_MODEL
    );
    return savedEntityId;
  }

  async handlePositionChange(position: number[]) {
    console.debug(
      "FurnishedModel.ts ~ handlePositionChange new:",
      position,
      " old:",
      this.position
    );
    if (this.position?.length) {
      const positionX = parseFloat(`${position[0]}`);
      const positionY = parseFloat(`${position[1]}`);
      const positionZ = parseFloat(`${position[2]}`);
      this.position = [positionX, positionY, positionZ];
      await this.update();
      await BlueprintInterface?.selectedModels
        ?.find((item) => item.itemModel.id === this._id)
        ?.__itemUpdatedEvent({
          position: {
            x: positionX,
            y: positionY,
            z: positionZ,
          },
          property: "position",
        });
    }
  }

  async handleRotationChange(mode: ROTATION_MODES, angle?: number) {
    console.debug("FurnishedModel.ts ~ handleRotationChange", this.rotation, {
      mode,
      angle,
    });
    if (mode === ROTATION_MODES.RESET) {
      this.rotation = [this.rotation[0], 0, this.rotation[2]];
      await this.update();
      await BlueprintInterface?.selectedModels
        ?.find((item) => item.itemModel.id === this._id)
        ?.__itemUpdatedEvent({
          rotationY: 0,
          property: "combinedRotation",
        });
    } else if (this.rotation?.length && mode === ROTATION_MODES.ROTATE_LEFT) {
      let rotationY = angle
        ? angle
        : (this.rotation[1] ? this.rotation[1] : 0) + 90;
      rotationY = Math.abs(rotationY) === 360 ? 0 : rotationY;
      this.rotation = [this.rotation[0], rotationY, this.rotation[2]];
      await this.update();
      await BlueprintInterface?.selectedModels
        ?.find((item) => item.itemModel.id === this._id)
        ?.__itemUpdatedEvent({
          rotationY: rotationY,
          property: "combinedRotation",
        });
    } else if (this.rotation?.length && mode === ROTATION_MODES.ROTATE_RIGHT) {
      let rotationY = angle
        ? angle
        : (this.rotation[1] ? this.rotation[1] : 0) - 90;
      rotationY = Math.abs(rotationY) === 360 ? 0 : rotationY;
      this.rotation = [this.rotation[0], rotationY, this.rotation[2]];
      await this.update();
      await BlueprintInterface?.selectedModels
        ?.find((item) => item.itemModel.id === this._id)
        ?.__itemUpdatedEvent({
          rotationY: rotationY,
          property: "combinedRotation",
        });
    }
  }

  /**
   * Read the GLB's cached native bounding-box extents.
   *
   * UNIFORM resize: changing any one dimension scales the whole item by a
   * single factor, so all three dimensions change proportionally and the
   * model keeps its shape. With one scalar driving all axes there is no
   * cross-axis coupling, no drift, no compounding — the entire class of
   * resize bugs is structurally impossible.
   *
   * `__nativeBox` is measured once at GLB load (at scale 1) and never
   * changes, so it is a stable reference for absolute scaling.
   */
  private __nativeExtents(placed: any) {
    const nativeBox = placed?.__nativeBox;
    if (!nativeBox) return null;
    return {
      x: nativeBox.max.x - nativeBox.min.x,
      y: nativeBox.max.y - nativeBox.min.y,
      z: nativeBox.max.z - nativeBox.min.z,
    };
  }

  async handleWidthChange(width: number) {
    if (!width) return;
    const placed = BlueprintInterface?.selectedModels?.find(
      (item: any) => item.itemModel.id === this._id
    );
    const nb = this.__nativeExtents(placed);
    if (!nb || nb.x <= 0 || nb.y <= 0 || nb.z <= 0) return;
    // dimensions = [Height, Width, Depth] (mm). Keep H & D; change only W.
    const h = this.dimensions?.[0] || width;
    const d = this.dimensions?.[2] || width;
    this.dimensions = [h, width, d];
    // ABSOLUTE per-axis scale from the target dims + constant native box. Every
    // axis is derived from a dimension (never from the current mesh), so repeated
    // edits never drift — 1200 → 600 → 1200 lands exactly on the original.
    const sx = parseFloat((width / 10 / (nb.x * 100)).toFixed(6));
    const sy = parseFloat((h / 10 / (nb.y * 100)).toFixed(6));
    const sz = parseFloat((d / 10 / (nb.z * 100)).toFixed(6));
    this.scale = [sx, sy, sz];
    await this.update();
    await placed.__itemUpdatedEvent({
      property: "sizeAbsolute",
      scaleVec: [sx, sy, sz],
    });
  }

  async onHandleChanged() {
    console.debug("FurnishedModel.ts ~ onHandleChanged");
    this.isHandleChanged = true;
    await this.update();
  }

  async handleRoomChange(roomId: string, roomName: string) {
    console.debug("FurnishedModel.ts ~ handleRoomChange", roomId, roomName);
    this.roomId = roomId;
    this.roomName = roomName;
    await this.update();
  }

  async onRoomNameChanged(newRoomName: string) {
    console.debug("FurnishedModel.ts ~ onRoomNameChanged", newRoomName);
    this.roomName = newRoomName;
    await this.update();
  }

  async handleHeightChange(height: number) {
    if (!height) return;
    const placed = BlueprintInterface?.selectedModels?.find(
      (item: any) => item.itemModel.id === this._id
    );
    const nb = this.__nativeExtents(placed);
    if (!nb || nb.x <= 0 || nb.y <= 0 || nb.z <= 0) return;
    // dimensions = [Height, Width, Depth] (mm). Keep W & D; change only H.
    const w = this.dimensions?.[1] || height;
    const d = this.dimensions?.[2] || height;
    this.dimensions = [height, w, d];
    // ABSOLUTE per-axis scale (drift-free — see handleWidthChange).
    const sx = parseFloat((w / 10 / (nb.x * 100)).toFixed(6));
    const sy = parseFloat((height / 10 / (nb.y * 100)).toFixed(6));
    const sz = parseFloat((d / 10 / (nb.z * 100)).toFixed(6));
    this.scale = [sx, sy, sz];
    await this.update();
    await placed.__itemUpdatedEvent({
      property: "sizeAbsolute",
      scaleVec: [sx, sy, sz],
    });
  }

  async handleDepthChange(depth: number) {
    if (!depth) return;
    const placed = BlueprintInterface?.selectedModels?.find(
      (item: any) => item.itemModel.id === this._id
    );
    const nb = this.__nativeExtents(placed);
    if (!nb || nb.x <= 0 || nb.y <= 0 || nb.z <= 0) return;
    // dimensions = [Height, Width, Depth] (mm). Keep H & W; change only D.
    const h = this.dimensions?.[0] || depth;
    const w = this.dimensions?.[1] || depth;
    this.dimensions = [h, w, depth];
    // ABSOLUTE per-axis scale (drift-free — see handleWidthChange).
    const sx = parseFloat((w / 10 / (nb.x * 100)).toFixed(6));
    const sy = parseFloat((h / 10 / (nb.y * 100)).toFixed(6));
    const sz = parseFloat((depth / 10 / (nb.z * 100)).toFixed(6));
    this.scale = [sx, sy, sz];
    await this.update();
    await placed.__itemUpdatedEvent({
      property: "sizeAbsolute",
      scaleVec: [sx, sy, sz],
    });
  }
}
