import BlueprintInterface from "@pazl/blueprint-interface";
import {
  ACTION_EVENT_2D,
  EVENT_LOADED,
  RESET_EVENT_2D,
  EVENT_LOADING,
} from "@pazl/main/core/events";
import { getRandomNumber } from "@pazl/utils/genericFunctions";
export default class ActionsHistory2DManager {
  constructor() {
    this.history = [];
    this.currentIndex = -1;

    BlueprintInterface.globalCustomEvents.addEventListener(
      ACTION_EVENT_2D,
      this.handleAction2D
    );

    BlueprintInterface.globalCustomEvents.addEventListener(
      RESET_EVENT_2D,
      this.resetActionManager
    );
  }

  handleAction2D(data) {
    console.debug(data, "2d action handling data");
    try {
      const uniqueId = getRandomNumber(1, 1000);
      const floorJson =
        BlueprintInterface.blueprint3d.model.exportSerialized();
      BlueprintInterface.actionsHistory2DManager.addToHistory({
        id: uniqueId,
        floorJson,
      });
    } catch (e) {
      // A serialization error must never silently kill the undo history.
      console.error("handleAction2D: failed to record 2D snapshot", e);
    }
  }

  resetActionManager() {
    this.history = [];
    this.currentIndex = -1;
  }

  addToHistory(state) {
    console.debug(state, "adding to the history");
    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push(state);
    this.currentIndex = this.history.length - 1;
    console.debug("added to the 2d action history", this.history);
  }

  undo() {
    if (this.currentIndex > 0) {
      this.rise2DLoadingEvent();
      this.currentIndex = this.currentIndex - 1;
      const undoElement = this.history[this.currentIndex];
      if (undoElement) {
        BlueprintInterface.handleTemplateUpdate(undoElement.floorJson);
      }
      console.debug("undo element with index", undoElement, this.currentIndex);
      return true;
    }
    return null;
  }

  redo() {
    if (this.currentIndex < this.history.length - 1) {
      this.rise2DLoadingEvent();
      this.currentIndex++;
      const redoElement = this.history[this.currentIndex];
      if (redoElement) {
        BlueprintInterface.handleTemplateUpdate(redoElement.floorJson);
      }
      console.debug("redo element with index", redoElement, this.currentIndex);
      return true;
    }
    return null;
  }

  rise2DActionEvent(actionType, data) {
    BlueprintInterface.globalCustomEvents.dispatchEvent(actionType, data);
  }

  rise2DLoadingEvent() {
    BlueprintInterface.globalCustomEvents.dispatchEvent(EVENT_LOADING, null);
  }

  riseResetEvent() {
    BlueprintInterface.globalCustomEvents.dispatchEvent(RESET_EVENT_2D, "");
  }
  rise2DLoadedEvent() {
    BlueprintInterface.globalCustomEvents.dispatchEvent(EVENT_LOADED, "");
  }
}
