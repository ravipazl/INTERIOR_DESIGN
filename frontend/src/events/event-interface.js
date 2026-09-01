import BlueprintInterface from "@pazl/blueprint-interface";
import {
  EVENT_WALL_CLICKED,
  EVENT_MOVED,
  EVENT_ITEM_SELECTED,
  EVENT_WALL_2D_CLICKED,
  EVENT_CORNER_2D_CLICKED,
  EVENT_ROOM_2D_CLICKED,
  EVENT_NOTHING_2D_SELECTED,
  ACTION_EVENT_2D,
  EVENT_NO_ITEM_SELECTED,
  EVENT_ITEM_MOVE_FINISH,
  EVENT_ITEM_COPIED,
  EVENT_ROOM_CLICKED,
} from "@pazl/main/core/events.js";
import * as menuData from "@pazl/utils/menu.json";

function handleWallClicked(callBack) {
  // event model will be WallClickedEvent
  BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
    EVENT_WALL_CLICKED,
    (evt) => callBack(evt)
  );
}

function handleSelectedModel(callBack) {
  // event model will be handleSelectedModel
  BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
    EVENT_ITEM_SELECTED,
    (evt) => callBack(evt)
  );
}

function handleWallClicked2D(callBack) {
  BlueprintInterface.blueprint3d.floorplanner.addFloorplanListener(
    EVENT_WALL_2D_CLICKED,
    (evt) => {
      callBack(evt);
    }
  );
}

function handleCornerClicked2D(callBack) {
  BlueprintInterface.blueprint3d.floorplanner.addFloorplanListener(
    EVENT_CORNER_2D_CLICKED,
    (evt) => {
      callBack(evt);
    }
  );
}

function handleRoomClicked2D(callBack) {
  BlueprintInterface.blueprint3d.floorplanner.addFloorplanListener(
    EVENT_ROOM_2D_CLICKED,
    (evt) => {
      callBack(evt);
    }
  );
}

function handleNo2DItemSelected(callBack) {
  BlueprintInterface.blueprint3d.floorplanner.addFloorplanListener(
    EVENT_NOTHING_2D_SELECTED,
    (evt) => callBack(evt)
  );
}

function handleNo3DItemSelected(callBack) {
  BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
    EVENT_NO_ITEM_SELECTED,
    (evt) => callBack(evt)
  );
}

function handleItemPositionChanged(callBack) {
  BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
    EVENT_ITEM_MOVE_FINISH,
    (evt) => callBack(evt)
  );
}

function handleItemCopied(callBack) {
  BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
    EVENT_ITEM_COPIED,
    (evt) => callBack(evt)
  );
}

function handleRoomSelected(callBack) {
  BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
    EVENT_ROOM_CLICKED,
    (evt) => callBack(evt)
  );
}
// // this is custom event rasied for testing
// function handleEventKeyPressed(calBack){
// 	BlueprintInterface.blueprint3d.roomplanner.addRoomplanListener(
//         EVENT_MOVED_DRAG,
//         (evt)=>calBack(evt)
//       );
// }

export {
  handleWallClicked,
  handleSelectedModel,
  handleItemPositionChanged,
  handleWallClicked2D,
  handleCornerClicked2D,
  handleRoomClicked2D,
  handleNo2DItemSelected,
  handleNo3DItemSelected,
  handleItemCopied,
  handleRoomSelected,
};
