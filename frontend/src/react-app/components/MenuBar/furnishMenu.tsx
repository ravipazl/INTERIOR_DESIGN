import React, { useEffect, useRef, useState } from "react";
import "./index.css";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import { Model } from "@pazl/entities/Model";
import GroupedButtons from "./groupedButtons";
import ToolbarPortal from "./ToolbarPortal";
import { MenuItem } from "../../helpers/Types";
import RoomPanel from "./RoomPanel/roomPanel";
import {
  handleAddItem,
  handleDropModelAtScreen,
  showDropPreviewAtScreen,
  hideDropPreview,
  clearDropGhost,
} from "@pazl/viewer3d-state-interface";
import {
  getDraggedModel,
  clearDraggedModel,
} from "@pazl/helpers/dragDropModel";
import ObjectPanel from "./ObjectPanel/objectPanel";
import BlueprintInterface from "@pazl/blueprint-interface";
import {
  handleSelectedModel,
  handleNo3DItemSelected,
  handleWallClicked,
  handleItemCopied,
  handleRoomSelected,
} from "@pazl/events/event-interface";
import { Box3, Vector3 } from "three";
import { MENU_TABS } from ".";
import WallPropertiesModal from "../WallPropertiesModal";
import DoorPropertiesModal from "../DoorPropertiesModal";
import { Texture } from "@pazl/entities/Texture";
import Wall from "@pazl/main/model/wall";
import UndoPanel from "../UndoPanel";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import ObjectCopiedModal from "../ObjectCopiedModal";
import RoomPropertiesModal from "../RoomPropertiesModal";
import RenderViewModal from "../RenderViewModal";
import AiInspirationButton from "../AiInspirationButton";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import Loader from "../Loader";
import ShortcutsModal from "./Shorcuts";
import { Physical3DItem } from "@pazl/main/viewer3d/Physical3DItem";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";
import UploadModelModal from "@pazl/components/UploadModelModal";
import GenerateFromPhotoModal from "@pazl/components/GenerateFromPhotoModal";
import ModelSearchModal from "@pazl/components/ModelSearchModal";
import SnapControlPanel from "../SnapControlPanel";
import { EVENT_ITEM_SELECTED } from "@pazl/main/core/events";

interface FurnishMenuProps {
  furnishTabData: string[];
  /**
   * Is the 3D tab the one on screen? Used ONLY to gate the toolbar this menu
   * portals into the navbar. It duplicates what `activeTab` says, but it is
   * passed separately so MenuBar can derive it from the same const that shows
   * the pane — the two must never disagree.
   */
  active?: boolean;
  activeTab: string;
  onTopView: (value: boolean) => void;
  /** Bumped by the rail's Render step — opens the render panel. */
  renderSignal?: number;
  /** Bumped by the rail's 3D step — reopens the catalogue. */
  exploreSignal?: number;
  /** Which rail item is active: "furnish" (catalogue) or "render" (panel). */
  navView?: string;
}

export enum ACTION_MODES {
  NONE = "",
  MULTI_SELECT = "multiSelect",
  ADD_ITEM = "add_item",
  UPLOAD = "upload",
  GENERATE = "generate",
  SEARCH_MODELS = "search_models",
  EDIT = "edit",
  DELETE = "delete",
  UNDO = "undo",
  REDO = "redo",
  CAM_TOP_VIEW = "top_view",
  CAM_3D_VIEW = "3d_view",
  ZOOM_IN = "zoom_in",
  ZOOM_OUT = "zoom_out",
  SNAPSHOT = "snapshot",
  OBJECT_FOCUS = "object",
  ROOM_FOCUS = "room",
  GLTF = "gltf",
  GLTF_ITEM = "download_model",
  SHORTCUTS = "shortcuts",
}

const FurnishMenu = ({
  furnishTabData,
  active = true,
  activeTab,
  onTopView,
  renderSignal,
  exploreSignal,
  navView,
}: FurnishMenuProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<ACTION_MODES>(ACTION_MODES.CAM_3D_VIEW);
  // Open by default: the catalogue is the reason you come to the 3D step, so
  // requiring a click on Explore first was a toll on every visit.
  const [showRoomPanel, setShowRoomPanel] = useState(true);
  const [showObjectPanel, setShowObjectPanel] = useState(false);
  const [showWallPropertiesModal, setShowWallPropertiesModal] = useState(false);
  const [showDoorPropertiesModal, setShowDoorPropertiesModal] = useState(false);
  const [selectedDoorClass, setSelectedDoorClass] = useState<any>(null);
  const [showUndoPanel, setShowUndoPanel] = useState(false);
  const [showObjectCopiedPanel, setShowObjectCopiedPanel] = useState(false);
  const [selectedModel, setSelectedModel] = useState<FurnishedModel>();
  const [isOnlyWallItems, setIsOnlyWallItems] = useState(false);
  const [isOnlyFloorItems, setIsOnlyFloorItems] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [showRoomPropertiesModal, setShowRoomPropertiesModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showToolbarUploadModal, setShowToolbarUploadModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showSearchModelsModal, setShowSearchModelsModal] = useState(false);

  // Drag-to-place (Coohom-style): let the user drag a catalog card onto the 3D
  // canvas and drop it where they want. Additive — attaches native drag/drop
  // listeners to the document and only acts when (a) a model is being dragged
  // and (b) the drop lands over the 3D canvas. The "+ Add" flow is untouched.
  useEffect(() => {
    const CANVAS_ID = "bp3djs-viewer3d";
    const overCanvas = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!(el && el.closest && el.closest(`#${CANVAS_ID}`));
    };
    const onDragOver = (e: DragEvent) => {
      const model = getDraggedModel();
      if (model && overCanvas(e.target)) {
        e.preventDefault(); // required so the browser allows a drop here
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        // Ghost preview: show the real translucent furniture (snapped to walls)
        // where the item would land.
        try {
          showDropPreviewAtScreen(model, e.clientX, e.clientY);
        } catch (err) {
          /* cosmetic only */
        }
      } else {
        // Left the canvas (or nothing dragged) — clear any stale preview.
        hideDropPreview();
      }
    };
    const onDrop = (e: DragEvent) => {
      const model = getDraggedModel();
      if (!model || !overCanvas(e.target)) {
        clearDropGhost(); // dropped outside — remove the ghost
        return;
      }
      e.preventDefault();
      try {
        handleDropModelAtScreen(model, e.clientX, e.clientY);
      } catch (err) {
        console.error("furnishMenu ~ drag-to-place drop failed", err);
      }
      clearDropGhost(); // remove the ghost (real item is now placed)
      clearDraggedModel();
    };
    // If the drag ends anywhere (cancelled, dropped outside), tear down the ghost.
    const onDragEnd = () => clearDropGhost();
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onDragEnd);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  // Frame the whole floor plan in the pulled-back dollhouse overview EVERY time
  // you enter the 3D step.
  //
  // This used to have an empty dep array despite a comment claiming "on
  // entering FURNISH": MenuBar keeps every pane mounted, so it ran exactly once
  // when the editor loaded — while you were still on Floor plan, before the
  // plan existed. Draw a new plan, switch to 3D, and the camera was never
  // re-framed; it sat wherever it had been left, often inside the geometry.
  //
  // Keyed on navView, NOT activeTab: Render is also the FURNISH tab, and Render
  // renders "your current view" — re-framing on the way into it would throw
  // away the shot the user had just lined up.
  //
  // __frameFloorplanWhenReady replaces the old fixed 300ms guess: it waits for
  // the floorplan to actually have a size, retrying per frame, so a plan that
  // loads slowly still gets framed instead of missing the window.
  useEffect(() => {
    if (navView !== "furnish") return;
    try {
      const rp = (BlueprintInterface as any)?.blueprint3d?.roomplanner;
      rp?.__frameFloorplanWhenReady?.(0, true);
      // Walls solid (100%); floor semi-transparent (50%).
      rp?.setWallOpacity?.(1);
      rp?.setFloorOpacity?.(0.5);
      // Arrive with NOTHING selected, so the dimension chips only appear once
      // you click something here.
      //
      // The selection is shared between the two steps: place a door on the
      // Floor plan and it stays selected, so switching to 3D showed its width
      // and offsets before you had touched anything - the numbers looked like
      // a permanent fixture of the door rather than a response to selecting
      // it. Clearing on entry makes "click to measure" the real behaviour.
      BlueprintInterface.clearSelection3D?.();
      setSelectedModel(undefined);
      setSelectedDoorClass(null);
      setSelectedRoom(null);
      setShowObjectPanel(false);
      setShowWallPropertiesModal(false);
      setShowDoorPropertiesModal(false);
      setShowRoomPropertiesModal(false);
    } catch (e) {
      /* framing / opacity are best-effort */
    }
  }, [navView]);

  /**
   * Clearing the floor plan empties the geometry, but every selection made in
   * the 3D step lives HERE, in this component state. Without this the panels
   * survive the clear: switch to 3D afterwards and Window / Door Properties is
   * still open - frame colour, glass colour, width, height - for an opening
   * that no longer exists.
   *
   * The catalogue (showRoomPanel) is deliberately NOT reset: it lists the model
   * library, not the scene, so it stays valid and is what you need next.
   */
  useEffect(() => {
    const onCleared = () => {
      setSelectedModel(undefined);
      setSelectedDoorClass(null);
      setSelectedRoom(null);
      setShowObjectPanel(false);
      setShowWallPropertiesModal(false);
      setShowDoorPropertiesModal(false);
      setShowRoomPropertiesModal(false);
      setShowObjectCopiedPanel(false);
      setShowUndoPanel(false);
      setIsOnlyWallItems(false);
      setIsOnlyFloorItems(false);
      setMode(ACTION_MODES.CAM_3D_VIEW);
    };
    window.addEventListener("pazl-floorplan-cleared", onCleared);
    return () =>
      window.removeEventListener("pazl-floorplan-cleared", onCleared);
  }, []);

  // Reopen the catalogue every time you ARRIVE at the 3D step. The initial
  // useState(true) is not enough on its own: MenuBar keeps this component
  // mounted and merely hides the pane, so leaving for Floor plan and coming
  // back would otherwise restore whatever state you left behind.
  //
  // Keyed on activeTab, so it fires only on entry — closing the panel while
  // you are already on 3D is respected and not undone on the next render.
  useEffect(() => {
    if (activeTab === MENU_TABS.FURNISH) {
      setShowRoomPanel(true);
    }
  }, [activeTab]);

  // Clicking 3D in the rail reopens the catalogue even when you are already on
  // 3D — the replacement for the toolbar's removed "Explore" button. A counter
  // rather than a boolean so a repeat click still fires; skipped at 0 so the
  // first render does not fight the effects above.
  useEffect(() => {
    if (exploreSignal) {
      setShowRoomPanel(true);
    }
  }, [exploreSignal]);

  // The catalogue and the render panel occupy the SAME left slot, so exactly
  // one is shown at a time. Driven by navView because both are the FURNISH tab
  // and cannot be told apart from activeTab alone.
  const [renderCloseSignal, setRenderCloseSignal] = useState(0);
  useEffect(() => {
    if (navView === "render") {
      setShowRoomPanel(false);
    } else if (navView === "furnish") {
      setRenderCloseSignal((n) => n + 1);
      setShowRoomPanel(true);
    }
  }, [navView]);


  useEffect(() => {
    if (BlueprintInterface && BlueprintInterface.blueprint3d) {
      handleWallClicked((evt: any) => {
        /* PERF-REMOVED */ // console.debug("furnishedMenu.tsx ~ handleWallClicked ~ event", evt);
        setShowWallPropertiesModal(true);
        setShowObjectPanel(false);
        setShowRoomPanel(false);
        setShowDoorPropertiesModal(false);
        setSelectedDoorClass(null);
        //setMode(ACTION_MODES.NONE);
      });
      handleSelectedModel((evt: any) => {
        /* PERF-REMOVED */ // console.debug("furnishedMenu.tsx ~ handleSelectedModel ~ event", evt);
        if (evt?.itemModel?.__id) {
          const itemModel = evt.itemModel;
          const isParametricDoor =
            itemModel.isParametric && itemModel.parametricClass;
          if (isParametricDoor) {
            // Parametric doors use the docked "Door Properties" panel (which
            // replaces the old floating popup) — not the object materials panel.
            setSelectedDoorClass(itemModel.parametricClass);
            setShowDoorPropertiesModal(true);
            setShowObjectPanel(false);
            setShowRoomPropertiesModal(false);
            setShowWallPropertiesModal(false);
          } else {
            getSelectedModel(
              itemModel.__id,
              evt.item.position,
              evt.item.scale,
              evt.item.rotation
            );
            setShowObjectPanel(true);
            setShowDoorPropertiesModal(false);
            setSelectedDoorClass(null);
            setShowRoomPropertiesModal(false);
            setShowWallPropertiesModal(false);
          }
        }
        //setMode(ACTION_MODES.NONE);
      });

      handleNo3DItemSelected((evt: any) => {
        /* PERF-REMOVED console.debug: console.debug(
          "furnishedMenu.tsx ~ handleNo3DItemSelected ~ event",
          evt
        ); */
        // NOTE: intentionally do NOT close the room/catalog panel here. Clicking
        // empty space in the scene should only deselect items + close the
        // item/wall/door panels — the furniture catalog stays open so the user
        // can keep browsing while interacting with the scene (close it with ×).
        setShowObjectPanel(false);
        setShowWallPropertiesModal(false);
        setShowDoorPropertiesModal(false);
        setSelectedDoorClass(null);
        setIsOnlyWallItems(false);
        setIsOnlyFloorItems(false);
        //setMode(ACTION_MODES.NONE);
        setShowUndoPanel(false);
        // Room state is deliberately NOT cleared here.
        //
        // A click on the floor fires TWO engine events: NO_ITEM_SELECTED on
        // mouse-DOWN (this handler) and ROOM_CLICKED on mouse-UP. Clearing the
        // room here closed the Room Properties panel on the way down, and the
        // mouse-up handler below immediately reopened it — two renders, and the
        // panel visibly blinked for one click.
        //
        // Those are separate browser events, so React batches them separately;
        // nothing collapses them. Leaving the state alone lets the mouse-up
        // handler be the single decider: it sets the room when one was clicked
        // and clears it when `evt.item` is empty, so a click on genuinely empty
        // space still closes the panel — just once, on the way up.
      });

      handleItemCopied((evt: any) => {
        /* PERF-REMOVED */ // console.debug("furnishedMenu.tsx ~ handleItemCopied ~ event", evt);
        setShowObjectCopiedPanel(true);
        setTimeout(() => {
          setShowObjectCopiedPanel(false);
        }, 4000);
      });

      handleRoomSelected((evt: any) => {
        /* PERF-REMOVED */ // console.debug("furnishedMenu.tsx ~ handleRoomSelected ~ event", evt);
        if (evt.item) {
          setSelectedRoom(evt.item);
          setShowRoomPropertiesModal(true);
        } else {
          // Empty space — close and clear. This is the ONLY place room state is
          // cleared now (see the NO_ITEM_SELECTED handler above), so it must
          // clear `selectedRoom` too or a stale room would linger.
          setShowRoomPropertiesModal(false);
          setSelectedRoom(null);
        }
      });
    }
  }, [BlueprintInterface, BlueprintInterface.blueprint3d]);

  const getSelectedModel = async (
    furnishedModelId: string,
    position?: Vector3,
    scale?: Vector3,
    rotation?: Vector3
  ) => {
    /* PERF-REMOVED console.debug: console.debug(
      "furnishedMenu.tsx ~ getSelectedModel ~ furnishedModelId",
      furnishedModelId
    ); */
    // Measure EVERY mesh of the loaded model and save its size to the matching
    // component, so the BOQ can compute area. We traverse the FULL object graph
    // (not just the scene's direct children): Sketchfab imports nest their meshes
    // many levels deep under a single "Sketchfab_model" wrapper, so a one-level
    // scan finds only the wrapper (not a mesh) and its name matches no component —
    // which is why those items were never measured. Match components by mesh
    // INDEX ("Mesh_N") — how the catalog seeds component names — because the raw
    // mesh node names ("Sketchfab_model", "mesh_0", "Mesh_0.002") are unreliable.
    for (const model of BlueprintInterface?.selectedModels || []) {
      const meshes: any[] = [];
      try {
        model?.traverse?.((o: any) => {
          if (o?.isMesh) meshes.push(o);
        });
      } catch (e) {
        console.error("furnishMenu ~ getSelectedModel ~ traverse failed", e);
      }
      for (let i = 0; i < meshes.length; i++) {
        const box3 = new Box3().setFromObject(meshes[i]);
        const size = box3.getSize(new Vector3());
        const height = size.y;
        const width = Math.max(size.x, size.z);
        if (!height || !width) continue; // skip degenerate/empty meshes
        // Match by the mesh's own clean "Mesh_N" name when present; fall back to
        // the traversal index only for Sketchfab meshes with empty/suffixed names.
        const nm = String((meshes[i] as any)?.name || "");
        const compName = /^Mesh_\d+$/.test(nm) ? nm : "Mesh_" + i;
        const furnishedModelComponent =
          await BlueprintInterface.ProjectManagerService.getFurnishedModelCompByNameAndFurnishedModelId(
            compName,
            furnishedModelId
          );
        if (furnishedModelComponent) {
          await new FurnishedModelComponent({
            ...furnishedModelComponent,
          }).updateDimensions(height, width);
        }
      }
    }
    const furnishedModel =
      await BlueprintInterface.ProjectManagerService.getFurnishedModelById(
        furnishedModelId
      );
    /* PERF-REMOVED console.debug: console.debug(
      "furnishedMenu.tsx ~ getSelectedModel ~ furnishedModel",
      furnishedModel
    ); */
    if (furnishedModel && position && scale && rotation) {
      setSelectedModel({
        ...furnishedModel,
        position: [position.x, position.y, position.z],
        scale: [scale.x, scale.y, scale.z],
      });
    } else if (furnishedModel) {
      setSelectedModel(furnishedModel);
    }
  };

  const handleSelect = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleSelect ~ itemData", itemData);
    BlueprintInterface.setIsMultiSelectEnabled(
      mode === ACTION_MODES.MULTI_SELECT ? false : true
    );
    setMode(
      mode === ACTION_MODES.MULTI_SELECT
        ? ACTION_MODES.CAM_3D_VIEW
        : ACTION_MODES.MULTI_SELECT
    );
    setShowRoomPanel(false);
    // if (buttonRef.current) {
    //   buttonRef.current.dispatchEvent(handleKeyPressEvent());
    // }
  };

  const handleAdd = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleAdd ~ itemData", itemData);
    setMode(ACTION_MODES.ADD_ITEM);
    setShowRoomPanel(true);
    setShowObjectPanel(false);
    handleAddItem();
  };

  const handleUndo = async (itemData?: any) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleUndo ~ itemData", itemData);
    setIsLoading(true);
    setMode(ACTION_MODES.UNDO);
    if (itemData?.floorplan) {
      await BlueprintInterface.ProjectManagerService.undo(itemData);
    } else {
      await BlueprintInterface.ProjectManagerService.undo();
    }
    setIsLoading(false);
  };

  const handleRedo = async (itemData: any) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleRedo ~ itemData", itemData);
    setIsLoading(true);
    setMode(ACTION_MODES.REDO);
    if (itemData?.floorplan) {
      await BlueprintInterface.ProjectManagerService.redo(itemData);
    } else {
      await BlueprintInterface.ProjectManagerService.redo();
    }
    setIsLoading(false);
  };

  const handleCamera3dView = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleCamera3dView ~ itemData", itemData);
    setMode(ACTION_MODES.CAM_3D_VIEW);
    onTopView(false);
    window.dispatchEvent(new MouseEvent("click", { button: 1 }));
  };

  const handleCameraTopView = async (itemData: MenuItem) => {
    /* PERF-REMOVED console.debug: console.debug(
      "furnisheMenu.tsx ~ handleCameraTopView ~ itemData",
      itemData
    ); */
    setMode(ACTION_MODES.CAM_TOP_VIEW);
    onTopView(true);
    window.dispatchEvent(new MouseEvent("click", { button: 2 }));
  };

  const handleZoomIn = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleZoomIn ~ itemData", itemData);
    //setMode(ACTION_MODES.ZOOM_IN);
    BlueprintInterface.blueprint3d.roomplanner.__zoomEvent({
      type: ACTION_MODES.ZOOM_IN,
    });
  };

  const handleZoomOut = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleZoomOut ~ itemData", itemData);
    //setMode(ACTION_MODES.ZOOM_OUT);
    BlueprintInterface.blueprint3d.roomplanner.__zoomEvent({
      type: ACTION_MODES.ZOOM_OUT,
    });
  };

  const handleSnapshot = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleSnapshot ~ itemData", itemData);
    setMode(ACTION_MODES.SNAPSHOT);
    BlueprintInterface.blueprint3d.roomplanner.__snapshotEvent();
  };

  const handleObjectFocus = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleObjectFocus ~ itemData", itemData);
    if (mode != ACTION_MODES.CAM_TOP_VIEW) {
      setMode(ACTION_MODES.OBJECT_FOCUS);
      BlueprintInterface.blueprint3d.roomplanner.__objectFocusEvent({
        item: BlueprintInterface.selectedModels[
          BlueprintInterface.selectedModels.length - 1
        ],
      });
    }
  };

  const handleRoomFocus = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleRoomFocus ~ itemData", itemData);
    if (mode != ACTION_MODES.CAM_TOP_VIEW) {
      setMode(ACTION_MODES.ROOM_FOCUS);
      BlueprintInterface.blueprint3d.roomplanner.__roomFocusEvent({
        room: selectedRoom,
      });
    }
  };

  const handleExportGltf = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleExportGltf ~ itemData", itemData);
    // Export a self-contained binary .glb (geometry + materials + embedded
    // textures) — the render-ready format for the Blender pipeline.
    BlueprintInterface.blueprint3d.roomplanner.exportSceneAsGTLF(true);
  };

  // Download ONLY the selected model as its own .glb (single-model version of
  // the Gltf export). If nothing is selected, tell the user to pick one first.
  const handleExportGltfItem = async (itemData: MenuItem) => {
    /* PERF-REMOVED */ // console.debug("furnisheMenu.tsx ~ handleExportGltfItem ~ itemData", itemData);
    const ok =
      BlueprintInterface.blueprint3d.roomplanner.exportSelectedItemAsGLB(
        (err: any) => console.warn("single-model export:", err?.message)
      );
    if (!ok) {
      window.alert("Select a model first, then click Download model.");
    }
  };

  const handleShowShortcuts = async (itemData: MenuItem) => {
    /* PERF-REMOVED console.debug: console.debug(
      "furnisheMenu.tsx ~ handleShowShortcuts ~ itemData",
      itemData
    ); */
    setShowShortcutsModal(true);
  };

  const handleSelectAllRoomItems = async () => {
    setMode(ACTION_MODES.MULTI_SELECT);
    BlueprintInterface.setIsMultiSelectEnabled(true);
    if (
      BlueprintInterface.blueprint3d.roomplanner.__physicalRoomItems.length &&
      BlueprintInterface.roomplanningHelper.__selectedRoom
    ) {
      const roomItems =
        await BlueprintInterface.blueprint3d.roomplanner.__physicalRoomItems.filter(
          (item: any) =>
            BlueprintInterface.ProjectManagerService.getFurnishedModelById(
              item.itemModel.__id
            )?.roomId ===
            BlueprintInterface.roomplanningHelper.__selectedRoom.uuid
        );
      await Promise.all(
        roomItems.map((item: any) => BlueprintInterface.setSelectedModels(item))
      );
      await BlueprintInterface.blueprint3d.roomplanner.__roomItemSelected({
        type: EVENT_ITEM_SELECTED,
        item: BlueprintInterface.selectedModels[
          BlueprintInterface.selectedModels.length - 1
        ],
      });
    }
  };

  const handleMenuItemClick = async (itemData: MenuItem) => {
    /* PERF-REMOVED console.debug: console.debug("furnisheMenu.tsx ~ handleMenuItemClick ~ itemData", {
      itemData,
      selectedModels: BlueprintInterface?.selectedModels,
      selectedModel,
    }); */
    switch (itemData.itemName) {
      case ACTION_MODES.MULTI_SELECT:
        handleSelect(itemData);
        break;
      case ACTION_MODES.ADD_ITEM:
        handleAdd(itemData);
        break;
      case ACTION_MODES.UPLOAD:
        setShowToolbarUploadModal(true);
        break;
      case ACTION_MODES.GENERATE:
        setShowGenerateModal(true);
        break;
      case ACTION_MODES.SEARCH_MODELS:
        setShowSearchModelsModal(true);
        break;
      case ACTION_MODES.UNDO:
        handleUndo(itemData);
        break;
      case ACTION_MODES.REDO:
        handleRedo(itemData);
        break;
      case ACTION_MODES.CAM_TOP_VIEW:
        handleCameraTopView(itemData);
        break;
      case ACTION_MODES.CAM_3D_VIEW:
        handleCamera3dView(itemData);
        break;
      case ACTION_MODES.ZOOM_IN:
        handleZoomIn(itemData);
        break;
      case ACTION_MODES.ZOOM_OUT:
        handleZoomOut(itemData);
        break;
      case ACTION_MODES.SNAPSHOT:
        handleSnapshot(itemData);
        break;
      case ACTION_MODES.SHORTCUTS:
        handleShowShortcuts(itemData);
        break;
      case ACTION_MODES.OBJECT_FOCUS:
        handleObjectFocus(itemData);
        break;
      case ACTION_MODES.ROOM_FOCUS:
        handleRoomFocus(itemData);
        break;
      case ACTION_MODES.GLTF:
        handleExportGltf(itemData);
        break;
      case ACTION_MODES.GLTF_ITEM:
        handleExportGltfItem(itemData);
        break;
      default:
        setMode(ACTION_MODES.NONE);
        break;
    }
  };

  const handleWallFrontTextureSelection = async (selectedTexture: Texture) => {
    // Update the EXACT selected wall object, not by id. Wall ids are derived
    // from corner ids ([start.id,end.id]) and can collide or go stale, so
    // matching by id made the colour land on the wrong walls (e.g. the base
    // wall coloured the others instead of itself).
    const selectedWall =
      BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall;
    /* PERF-REMOVED console.log: console.log(
      "[WALLCOLOR] front -> selectedWall id=",
      selectedWall?.id,
      " inWalls=",
      BlueprintInterface.blueprint3d.roomplanner.floorplan.walls.includes(
        selectedWall
      )
    ); */
    if (selectedWall) {
      selectedWall.frontTexture = {
        ...selectedWall.frontTexture,
        colormap: selectedTexture.fileUrl,
      };
    }
    // New array ref to keep any reactivity that relied on the old reassignment.
    BlueprintInterface.blueprint3d.roomplanner.floorplan.walls = [
      ...BlueprintInterface.blueprint3d.roomplanner.floorplan.walls,
    ];
    await BlueprintInterface.blueprint3d.roomplanner.floorplan.update();
    await BlueprintInterface.ProjectManagerService.updateFloorPlan(
      HISTORY_TITLES.WALL_TEXTURE_CHANGED
    );
  };

  const handleWallBackTextureSelection = async (selectedTexture: Texture) => {
    // Update the EXACT selected wall object, not by id (see front handler).
    const selectedWall =
      BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall;
    /* PERF-REMOVED console.log: console.log(
      "[WALLCOLOR] back -> selectedWall id=",
      selectedWall?.id,
      " inWalls=",
      BlueprintInterface.blueprint3d.roomplanner.floorplan.walls.includes(
        selectedWall
      )
    ); */
    if (selectedWall) {
      selectedWall.backTexture = {
        ...selectedWall.backTexture,
        colormap: selectedTexture.fileUrl,
      };
    }
    BlueprintInterface.blueprint3d.roomplanner.floorplan.walls = [
      ...BlueprintInterface.blueprint3d.roomplanner.floorplan.walls,
    ];
    await BlueprintInterface.blueprint3d.roomplanner.floorplan.update();
    await BlueprintInterface.ProjectManagerService.updateFloorPlan(
      HISTORY_TITLES.WALL_TEXTURE_CHANGED
    );
  };

  const handleFloorTextureSelection = async (selectedTexture: Texture) => {
    const floor3d = BlueprintInterface.blueprint3d.roomplanner.floors3d.find(
      (floor3d: any) => floor3d.room.uuid === selectedRoom.uuid
    );
    BlueprintInterface.blueprint3d.roomplanner.floorplan.__updateRoomFloorTextureEvent(
      { selectedRoom, selectedTexture: selectedTexture.fileUrl }
    );
    floor3d.__floorMaterial3D.textureMapPack = {
      color: "#FFFFFF",
      name: "Solid",
      colormap: selectedTexture.fileUrl,
    };
    await BlueprintInterface.ProjectManagerService.updateFloorPlan(
      HISTORY_TITLES.FLOOR_TEXTURE_CHANGED
    );
  };

  const handleWallTextureSelectionForSelectedRoom = async (
    selectedTexture: Texture
  ) => {
    /* PERF-REMOVED */ // console.debug("handleWallTextureSelectionForSelectedRoom -> selectedRoom", selectedRoom);
    const allWallsOfRoom =
      BlueprintInterface.blueprint3d.roomplanner.floorplan.rooms.find(
        (room: any) => room.uuid === selectedRoom.uuid
      )?.__walls ?? [];

    const colormap = selectedTexture.fileUrl;
    // Null-safe: edge.room can be undefined (exterior side). The old code did
    // `halfEdge.room.uuid` directly, which threw and/or left the wall out.
    const isRoomEdge = (halfEdge: any) =>
      !!halfEdge && !!halfEdge.room && halfEdge.room.uuid === selectedRoom.uuid;

    allWallsOfRoom.forEach((wall: any) => {
      const frontInRoom = isRoomEdge(wall.frontEdge);
      const backInRoom = isRoomEdge(wall.backEdge);
      /* PERF-REMOVED console.log: console.log(
        "[ROOMWALLCOLOR] wall id=",
        wall?.id,
        " frontInRoom=",
        frontInRoom,
        " backInRoom=",
        backInRoom
      ); */
      if (backInRoom) {
        wall.backTexture = { ...wall.backTexture, colormap };
      }
      if (frontInRoom) {
        wall.frontTexture = { ...wall.frontTexture, colormap };
      }
      // Fallback: this wall is in the room's wall list but neither edge reports
      // the room (stale/missing edge.room — this is the "base wall" that was
      // being skipped). Colour its interior side anyway so no wall is left out.
      if (!frontInRoom && !backInRoom) {
        if (wall.frontEdge) {
          wall.frontTexture = { ...wall.frontTexture, colormap };
        } else if (wall.backEdge) {
          wall.backTexture = { ...wall.backTexture, colormap };
        } else {
          wall.frontTexture = { ...wall.frontTexture, colormap };
          wall.backTexture = { ...wall.backTexture, colormap };
        }
      }
    });

    await BlueprintInterface.blueprint3d.roomplanner.floorplan.update();
    await BlueprintInterface.ProjectManagerService.updateFloorPlan(
      HISTORY_TITLES.WALL_TEXTURE_CHANGED
    );
  };

  const handleRoomNameChange = (e: any) => {
    const name = e.target.value;
    if (name && selectedRoom) {
      BlueprintInterface.setRoomName(name, selectedRoom, MENU_TABS.FURNISH);
    }
  };

  return (
    <>
      {isLoading ? <Loader /> : null}
      {/* Snap engine toolbar — floating widget, Furnish mode only. */}
      <SnapControlPanel />
      {/* Photorealistic render — floating button, opens the Render view. */}
      <RenderViewModal
        openSignal={renderSignal}
        closeSignal={renderCloseSignal}
      />
      {/* AI Inspiration — captures the 3D design & opens the AI styling app.
          Hidden on request. The component is untouched and still imported, so
          restoring it is a matter of removing this comment wrapper; nothing
          else in the 3D view depended on it being mounted.
      <AiInspirationButton /> */}
      {showRoomPanel && (
        <RoomPanel
          onHideRoomPanel={() => {
            setShowRoomPanel(false);
            setIsOnlyWallItems(false);
            setIsOnlyFloorItems(false);
          }}
          onHideObjectPanel={() => {
            setShowObjectPanel(true);
          }}
          isOnlyWallItems={isOnlyWallItems}
          isOnlyFloorItems={isOnlyFloorItems}
          // Moved out of the toolbar into the panel's "Add model" section.
          // The modals stay here; only the trigger moved.
          onUpload={() => setShowToolbarUploadModal(true)}
          onGenerate={() => setShowGenerateModal(true)}
          onSearchModels={() => setShowSearchModelsModal(true)}
        />
      )}
      {showObjectPanel && selectedModel && (
        <ObjectPanel
          onHideObjectPanel={() => {
            setShowObjectPanel(false);
          }}
          selectedModel={selectedModel}
          isMultiSelectMode={mode === ACTION_MODES.MULTI_SELECT}
        />
      )}
      {showWallPropertiesModal && (
        <WallPropertiesModal
          onOpenRoomPanel={() => {
            setShowRoomPanel(true);
            setIsOnlyWallItems(true);
          }}
          onSelectedWallFrontTexture={handleWallFrontTextureSelection}
          onSelectedWallBackTexture={handleWallBackTextureSelection}
          onHideWallPropertiesPanel={() => setShowWallPropertiesModal(false)}
        />
      )}
      {showDoorPropertiesModal && selectedDoorClass && (
        <DoorPropertiesModal
          doorClass={selectedDoorClass}
          onClose={() => {
            setShowDoorPropertiesModal(false);
            setSelectedDoorClass(null);
          }}
        />
      )}
      {showRoomPropertiesModal && selectedRoom && (
        <RoomPropertiesModal
          handleRoomNameChange={handleRoomNameChange}
          onOpenRoomPanel={() => {
            setShowRoomPanel(true);
            setIsOnlyFloorItems(true);
          }}
          onSelectedFloorTexture={handleFloorTextureSelection}
          onSelectedWallTexture={handleWallTextureSelectionForSelectedRoom}
          selectedRoom={selectedRoom}
          onHideRoomPropertiesPanel={() => setShowRoomPropertiesModal(false)}
          handleSelectAllRoomItems={handleSelectAllRoomItems}
        />
      )}
      {/* Currently unreachable: the only two things that set showUndoPanel true
          were the chevrons under undo/redo, removed from the toolbar above.
          Left in place because it is inert while the flag stays false, so
          restoring version history later means adding one trigger rather than
          rebuilding the panel. */}
      {showUndoPanel && (
        <UndoPanel
          title={mode === ACTION_MODES.REDO ? "Redo History" : "Undo History"}
          onSelectedUndoVersion={
            mode === ACTION_MODES.UNDO ? handleUndo : handleRedo
          }
          onUndo={mode === ACTION_MODES.UNDO ? handleUndo : handleRedo}
        />
      )}
      {showObjectCopiedPanel && selectedModel && (
        <ObjectCopiedModal selectedModel={selectedModel} />
      )}
      <ShortcutsModal
        showShortcutsModal={showShortcutsModal}
        setShowShortcutsModal={setShowShortcutsModal}
      />
      <UploadModelModal
        show={showToolbarUploadModal}
        onClose={() => setShowToolbarUploadModal(false)}
        onSuccess={async () => {
          // Refresh the models cache so the new upload appears immediately.
          try {
            const resp = await (await import("@pazl/services/ModelsService"))
              .ModelsService.getAllModels();
            const data: any = (resp as any)?.data ?? resp;
            if (Array.isArray(data) && data.length) {
              (await import("@pazl/services/ModelsService"))
                .ModelsService.saveModelsToLocalStorage(data);
            }
          } catch (e) {
            console.warn("Failed to refresh models cache after toolbar upload", e);
          }
        }}
        defaultType={1}
      />
      <GenerateFromPhotoModal
        show={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onSuccess={async () => {
          // Same cache refresh as upload — AI-generated models land in the same
          // `models` collection so the catalog picks them up.
          try {
            const resp = await (await import("@pazl/services/ModelsService"))
              .ModelsService.getAllModels();
            const data: any = (resp as any)?.data ?? resp;
            if (Array.isArray(data) && data.length) {
              (await import("@pazl/services/ModelsService"))
                .ModelsService.saveModelsToLocalStorage(data);
            }
          } catch (e) {
            console.warn("Failed to refresh models cache after AI generation", e);
          }
        }}
      />
      <ModelSearchModal
        show={showSearchModelsModal}
        onClose={() => setShowSearchModelsModal(false)}
        onSuccess={async () => {
          // Imported Sketchfab models land in the same `models` collection,
          // so refresh the cache so they appear in the catalog immediately.
          try {
            const resp = await (await import("@pazl/services/ModelsService"))
              .ModelsService.getAllModels();
            const data: any = (resp as any)?.data ?? resp;
            if (Array.isArray(data) && data.length) {
              (await import("@pazl/services/ModelsService"))
                .ModelsService.saveModelsToLocalStorage(data);
            }
          } catch (e) {
            console.warn(
              "Failed to refresh models cache after Sketchfab import",
              e
            );
          }
        }}
      />
      <ToolbarPortal active={active}>
      <div className="flex items-center">
        {furnishTabData.map((item: string) => (
          <div key={item} className="rounded last bg-white dark:bg-[#4E4E4E]">
            <GroupedButtons
              item={item}
              menuName={MENU_TABS.FURNISH}
              handleMenuItemClick={handleMenuItemClick}
              mode={mode}
              buttonRef={buttonRef}
              activeTab={activeTab}
            />
            {/* Two chevrons used to hang BELOW the undo and redo buttons here,
                opening a floor-plan version-history list. They were removed: the
                toolbar now sits in the navbar, so anything stacked under a button
                overflowed past the navbar edge and read as clipped stray glyphs.
                Undo and redo themselves are unaffected - those are the toolbar
                buttons above, which run handleUndo/handleRedo directly. */}
          </div>
        ))}
      </div>
      </ToolbarPortal>
    </>
  );
};

export default FurnishMenu;
