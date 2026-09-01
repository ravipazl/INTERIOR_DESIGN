import {
  EVENT_ROTATE_ITEM,
  EVENT_ITEM_UPDATE,
  EVENT_UPDATED,
  EVENT_ITEM_LOADING,
  EVENT_LOADED,
  EVENT_LOADING,
  EVENT_ITEM_REMOVED,
  EVENT_NEW_PARAMETRIC_ITEM,
  EVENT_NEW_ITEM,
  EVENT_MODE_RESET,
  EVENT_EXTERNAL_FLOORPLAN_LOADED,
} from "../core/events.js";
import { EventDispatcher } from "three";
import { Floorplan } from "./floorplan.js";
import { Utils } from "../core/utils.js";
import { Factory } from "../items/factory.js";
import { Vector3 } from "three/build/three.module.js";
import BlueprintInterface from "@pazl/blueprint-interface";

/**
 * A Model is an abstract concept the has the data structuring a floorplan. It connects a {@link Floorplan} and a {@link Scene}
 */
export class Model extends EventDispatcher {
  /** Constructs a new model.
   * @param textureDir The directory containing the textures.
   */
  constructor() {
    super();
    this.__floorplan = new Floorplan();
    this.__roomItems = [];
  }

  switchWireframe(flag) {
    this.scene.switchWireframe(flag);
  }

  loadSerialized(json) {
    // TODO: better documentation on serialization format.
    // TODO: a much better serialization format.
    this.dispatchEvent({ type: EVENT_LOADING, item: this });
    //      this.roomLoadingCallbacks.fire();

    var data = JSON.parse(json);
    console.debug("model.js ~ loadSerialized ~ data", data);
    this.newDesign(data.floorplan, data.items);
    this.dispatchEvent({ type: EVENT_LOADED, item: this });
    BlueprintInterface.actionsHistory2DManager.rise2DLoadedEvent();
  }

  refreshItem(json) {
    // TODO: better documentation on serialization format.
    // TODO: a much better serialization format.
    this.dispatchEvent({ type: EVENT_LOADING, item: this });
    //      this.roomLoadingCallbacks.fire();

    var data = JSON.parse(json);
    this.oldDesign(data.floorplan, data.items);
    this.dispatchEvent({ type: EVENT_LOADED, item: this });
  }

  loadLockedSerialized(json) {
    var data = JSON.parse(json);
    this.floorplan.loadLockedFloorplan(data.floorplan);
    this.dispatchEvent({ type: EVENT_EXTERNAL_FLOORPLAN_LOADED, item: this });
  }

  exportSerialized() {
    console.debug("model.js ~ exportSerialized", {
      roomItems: this.__roomItems,
      floorplan: this.__floorplan,
    });
    let floorplanJSON = this.floorplan.saveFloorplan();
    console.debug("model.js ~ exportSerialized ~ floorplanJSON", floorplanJSON);
    let newFloorTextures = {};
    this.floorplan.rooms.map((room) => {
      const floorTexture =
        BlueprintInterface.blueprint3d.roomplanner.floors3d.find(
          (floor3d) => floor3d.room.uuid === room.uuid
        )?.__floorMaterial3D?.textureMapPack;
      if (floorTexture) {
        newFloorTextures[room.uuid] = floorTexture;
      }
    });
    floorplanJSON = { ...floorplanJSON, newFloorTextures };
    console.debug("model.js ~ exportSerialized ~ floorplanJSON", floorplanJSON);
    let roomItemsJSON = [];
    this.__roomItems.forEach((item) => {
      const physicalRoomItem =
        BlueprintInterface.blueprint3d.roomplanner.physicalRoomItems.find(
          (physicalRoomItem) => physicalRoomItem.__itemModel.__id === item.__id
        );
      // Guard: a freshly-added item may not have a physical counterpart yet.
      // Without this guard exportSerialized throws, which silently breaks the
      // undo/redo history (snapshots are never recorded).
      if (physicalRoomItem && physicalRoomItem.rotation) {
        item.metadata.rotation = [
          physicalRoomItem.rotation.x,
          physicalRoomItem.rotation.y,
          physicalRoomItem.rotation.z,
        ];
      }
      roomItemsJSON.push(item.metadata);
    });
    console.debug("model.js ~ exportSerialized ~ roomItemsJSON", roomItemsJSON);
    var room = { floorplan: floorplanJSON, items: roomItemsJSON };
    return JSON.stringify(room);
  }

  exportItems() {
    let roomItemsJSON = [];
    this.__roomItems.forEach((item) => {
      roomItemsJSON.push(item.metadata);
    });
    return roomItemsJSON;
  }

  updateRoomItemPosition(roomItem) {
    console.debug("model.js ~ updateRoomItemPosition ~ roomItem", roomItem);
    if (roomItem) {
      this.__roomItems = this.__roomItems.map((item) => {
        if (item?.__id === roomItem.__itemModel.__id) {
          item.position.set(
            roomItem.position.x,
            roomItem.position.y,
            roomItem.position.z
          );
          item.metadata.position = [
            roomItem.position.x,
            roomItem.position.y,
            roomItem.position.z,
          ];
          return item;
        }
        return item;
      });
    }
  }

  updateRoomItemWidth(roomItem) {
    console.debug("model.js ~ updateRoomItemWidth ~ roomItem", roomItem);
    if (roomItem) {
      this.__roomItems = this.__roomItems.map((item) => {
        if (item?.__id === roomItem.__itemModel.__id) {
          item.scale.set(roomItem.scale.x, roomItem.scale.y, roomItem.scale.z);
          item.metadata.scale = [
            roomItem.scale.x,
            roomItem.scale.y,
            roomItem.scale.z,
          ];
          return item;
        }
        return item;
      });
    }
  }

  updateRoomItemHeight(roomItem) {
    console.debug("model.js ~ updateRoomItemHeight ~ roomItem", roomItem);
    if (roomItem) {
      this.__roomItems = this.__roomItems.map((item) => {
        if (item?.__id === roomItem.__itemModel.__id) {
          item.scale.set(roomItem.scale.x, roomItem.scale.y, roomItem.scale.z);
          item.metadata.scale = [
            roomItem.scale.x,
            roomItem.scale.y,
            roomItem.scale.z,
          ];
          return item;
        }
        return item;
      });
    }
  }

  newDesign(floorplan, items) {
    this.__roomItems = [];
    this.floorplan.loadFloorplan(floorplan);
    for (let i = 0; i < items?.length; i++) {
      let itemMetaData = items[i];
      let itemType = itemMetaData.itemType;
      let item = new (Factory.getClass(itemType))(
        itemMetaData,
        this,
        itemMetaData.id ?? itemMetaData.dbid
      );
      this.__roomItems.push(item);
    }

    // console.log(this.__roomItems)
  }

  oldDesign(floorplan, items) {
    this.__roomItems = [];
    this.floorplan.loadFloorplan(floorplan);
    for (let i = 0; i < items.length; i++) {
      let itemMetaData = items[i];
      let itemType = itemMetaData.itemType;
      //let item = new(Factory.getClass(itemType))(itemMetaData, this, itemMetaData.id);
      this.__roomItems.push(itemMetaData);
    }
  }

  reset() {
    this.floorplan.reset();
    this.__roomItems.length = 0;
    this.dispatchEvent({ type: EVENT_MODE_RESET });
  }

  /** Gets the items.
   * @returns The items.
   */
  getItems() {
    return this.__roomItems;
  }

  /** Gets the count of items.
   * @returns The count.
   */
  itemCount() {
    return this.__roomItems.length;
  }

  /** Removes all items. */
  clearItems() {
    let scope = this;
    this.__roomItems.forEach((item) => {
      scope.removeItem(item, false);
    });
    this.__roomItems = [];
  }

  /**
   * Removes an item.
   * @param item The item to be removed.
   * @param dontRemove If not set, also remove the item from the items list.
   */
  removeItem(item, keepInList) {
    // use this for item meshes
    this.remove(item, false);
    this.dispatchEvent({ type: EVENT_ITEM_REMOVED, item: item });
  }

  /** Removes a non-item, basically a mesh, from the scene.
   * @param mesh The mesh to be removed.
   */
  remove(roomItem, keepInList) {
    keepInList = keepInList || false;
    if (!keepInList) {
      roomItem.dispose();

      Utils.removeValue(this.__roomItems, roomItem);
    }
  }

  /**
   * Creates an item and adds it to the scene.
   * @param itemType The type of the item given by an enumerator.
   * @param fileName The name of the file to load.
   * @param metadata TODO
   * @param position The initial position.
   * @param rotation The initial rotation around the y axis.
   * @param scale The initial scaling.
   * @param fixed True if fixed.
   * @param newItemDefinitions - Object with position and 'edge' attribute if it is a wall item
   */
  addItemByMetaData(metadata) {
    let itemType = metadata.itemType;
    let item = new (Factory.getClass(itemType))(metadata, this, metadata.id);
    this.__roomItems.push(item);
    this.dispatchEvent({ type: EVENT_NEW_ITEM, item: item });
  }
  addItem(item) {
    this.__roomItems.push(item);
    this.dispatchEvent({ type: EVENT_NEW_ITEM, item: item });
  }

  removeItemByMetaData(item) {
    let deleteitem = item.__itemModel;
    this.removeItem(deleteitem);
  }

  itemFixed(item, flags) {
    this.dispatchEvent({
      type: EVENT_ITEM_UPDATE,
      item: item,
      field: "fixed",
      flags,
    });
  }

  itemTextureColor(item, color) {
    this.dispatchEvent({
      type: EVENT_ITEM_UPDATE,
      item: item,
      field: "color",
      color,
    });
    this.__roomItems = this.__roomItems.map((roomItem) => {
      if (item && roomItem.__id === item.__itemModel.__id) {
        roomItem.meshmap.map((mesh, index) => {
          if (mesh.name === color.name && color.texture) {
            console.debug(
              "Updating Texture for item",
              item.__itemModel,
              mesh.name,
              " from ",
              roomItem.meshmap[index].texture,
              " to ",
              color.texture
            );
            roomItem.meshmap[index].texture = color.texture;
          }
        });
        roomItem.metadata.meshmap.map((mesh, index) => {
          if (mesh.name === color.name && color.texture) {
            console.debug(
              "Updating Texture for item",
              item.__itemModel,
              mesh.name,
              " from ",
              roomItem.meshmap[index].texture,
              " to ",
              color.texture
            );
            roomItem.metadata.meshmap[index].texture = color.texture;
          }
        });
      }
      return roomItem;
    });
  }

  itemTextureRepeat(item, color, size, name) {
    // console.log(size)
    this.dispatchEvent({
      type: EVENT_ITEM_UPDATE,
      item: item,
      field: "repeat",
      color,
      size: parseFloat(size),
      name,
    });
  }

  rotateItem(item, x, y, z) {
    /**
     * Add to current innerRotation so the rotation is additive instead of being absolute
     */
    let eulerAngle = item.innerRotation.clone().add(new Vector3(x, y, z));
    item.innerRotation = eulerAngle;
  }

  set roomItems(items) {
    this.__roomItems = [];
    this.__roomItems.push(items);
  }

  get roomItems() {
    // console.log(this.__roomItems)
    return this.__roomItems;
  }

  get floorplan() {
    return this.__floorplan;
  }
}
