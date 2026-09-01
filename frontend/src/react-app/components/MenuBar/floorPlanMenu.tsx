import React, { useContext, useEffect, useRef, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import {
  handleCornerClicked2D,
  handleWallClicked2D,
  handleRoomClicked2D,
  handleNo2DItemSelected,
} from "@pazl/events/event-interface";
import {
  handleDrawFreeShape,
  handleImport2DDesign,
  handleResetCanvas,
  handleSaveBlueprint2DDesign,
} from "@pazl/viewer2d-state-interface";
import { MenuItem } from "@pazl/helpers/Types";
import { handleKeyPressEvent } from "@pazl/utils/genericFunctions";
import GroupedButtons from "@pazl/components/MenuBar/groupedButtons";
import LoaderContext from "@pazl/context/loaderContext";
import "@pazl/components/MenuBar/index.css";
import {
  dimFeetAndInch,
  dimMeter,
  dimMilliMeter,
} from "@pazl/main/core/constants.js";
import { EVENT_LOADED, EVENT_LOADING } from "@pazl/main/core/events";
import { MENU_TABS } from ".";
import templateList from "@pazl/utils/floorPlanTemplateList";
import TemplateMenu from "./TemplateMenu/templateMenu";
import Loader from "../Loader";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import ConfirmClearFloorplanModal from "./ConfirmClearFloorplanModal";
import PropertiesPanel, { SelKind } from "./PropertiesPanel";
import {
  FloorPlanTemplateService,
  SavedTemplate,
} from "@pazl/services/FloorPlanTemplateService";

const defaultTemplateCover = require("../../../../public/assets/icons/Standardshape.svg");

const FloorPlanMenu = ({
  floorplanTabData,
}: {
  floorplanTabData: string[];
}) => {
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<string>("select");
  const [item2D, setItem2D] = useState<any>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState<boolean>(false);
  const [isWallClicked, setIsWallClicked] = useState<boolean>(false);
  const [isCornerClicked, setIsCornerClicked] = useState<boolean>(false);
  const [isRoomClicked, setIsRoomClicked] = useState<boolean>(false);
  // A selected door/window shown in the SAME unified panel as walls/corners.
  const [openingItem, setOpeningItem] = useState<any>(null);
  const [unitMetric, setUnitMetric] = useState(dimFeetAndInch);
  const { setLoading } = useContext(LoaderContext);
  const [showLoader, setShowLoader] = useState(false);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);
  const [isFloorPlanCleared, setIsFloorPlanCleared] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);

  const handleUnitChange = async (value: string) => {
    console.debug("DEBUG: selected value for units", value);
    // The dropdown sends the option's `value` — "mm" / "ft" (see menu.json).
    // Match case-insensitively (and keep the old "M"/"Mm" tokens working), so
    // picking "millimeters" actually sets mm instead of falling through to feet.
    const v = String(value || "").toLowerCase();
    if (v === "m" || v === "meter" || v === "meters") {
      BlueprintInterface.setUnit(dimMeter);
      setUnitMetric(dimMeter);
    } else if (v === "mm" || v === "millimeter" || v === "millimeters") {
      BlueprintInterface.setUnit(dimMilliMeter);
      setUnitMetric(dimMilliMeter);
    } else {
      BlueprintInterface.setUnit(dimFeetAndInch);
      setUnitMetric(dimFeetAndInch);
    }
    await BlueprintInterface.blueprint3d.floorplanner.__gridUnitChangedEvent({
      unit: value,
    });
    BlueprintInterface.floorplanningHelper.__floorplan.update();
    setMode("");
  };

  // handling loader
  useEffect(() => {
    BlueprintInterface.globalCustomEvents.addEventListener(EVENT_LOADED, () =>
      setLoaderForAction(false)
    );
    BlueprintInterface.globalCustomEvents.addEventListener(EVENT_LOADING, () =>
      setLoaderForAction(true)
    );
  }, [BlueprintInterface, BlueprintInterface.blueprint3d]);

  const setLoaderForAction = (mode: boolean) => {
    setTimeout(() => {
      setLoading(mode);
    }, 10);
  };

  const handleUndo = async () => {
    setShowLoader(true);
    await BlueprintInterface.actionsHistory2DManager.undo();
    setShowLoader(false);
    BlueprintInterface.ProjectManagerService?.updateFloorPlan(
      HISTORY_TITLES.FLOORPLAN_UPDATED
    );
  };

  const handleRedo = async () => {
    setShowLoader(true);
    await BlueprintInterface.actionsHistory2DManager.redo();
    setShowLoader(false);
    BlueprintInterface.ProjectManagerService?.updateFloorPlan(
      HISTORY_TITLES.FLOORPLAN_UPDATED
    );
  };

  const handleMenuItemClick = (itemData: MenuItem) => {
    setMode("");
    switch (itemData.itemName) {
      case "select":
        setMode("select");
        setIsWallClicked(false);
        setIsCornerClicked(false);
        setIsRoomClicked(false);
        if (buttonRef.current) {
          buttonRef.current.dispatchEvent(handleKeyPressEvent());
        }
        break;
      case "draw":
        setMode("draw");
        handleDrawFreeShape();
        break;
      case "clear":
        onOpenClearConfirmModal();
        break;
      case "templates":
        loadSavedTemplates();
        setShowTemplateMenu(true);
        break;
      case "export":
        handleSaveBlueprint2DDesign();
        break;
      case "import":
        handleImport2DDesign();
        break;
      case "snap":
        if (itemData.iconName === "toggle_off") {
          itemData.iconName = "toggle_on";
          BlueprintInterface.setSnapToGrid(true);
          setMode("toggle_on");
        } else {
          itemData.iconName = "toggle_off";
          BlueprintInterface.setSnapToGrid(false);
          setMode("toggle_off");
        }
        break;
      case "undo":
        handleUndo();
        break;
      case "redo":
        handleRedo();
        break;
    }
  };

  useEffect(() => {
    if (BlueprintInterface && BlueprintInterface.blueprint3d) {
      handleWallClicked2D((evt: any) => {
        BlueprintInterface.setSelectedWall2D(evt.item);
        setItem2D(evt.item);
        setIsWallClicked(true);
        setIsCornerClicked(false);
        setIsRoomClicked(false);
        setOpeningItem(null);
        setMode("");
      });

      handleCornerClicked2D((evt: any) => {
        BlueprintInterface.setSelectedCorner2D(evt.item);
        setItem2D(evt.item);
        setIsCornerClicked(true);
        setIsWallClicked(false);
        setIsRoomClicked(false);
        setOpeningItem(null);
        setMode("");
      });

      handleRoomClicked2D((evt: any) => {
        BlueprintInterface.setSelectedRoom2D(evt.item);
        setItem2D(evt.item);
        setIsRoomClicked(true);
        setIsWallClicked(false);
        setIsCornerClicked(false);
        setOpeningItem(null);
        setMode("");
      });

      handleNo2DItemSelected((evt: any) => {
        resetSelections();
        setItem2D(null);
        setIsWallClicked(false);
        setIsCornerClicked(false);
        setIsRoomClicked(false);
        setOpeningItem(null);
        setMode("");
      });
    }
  }, [BlueprintInterface, BlueprintInterface.blueprint3d]);

  // Door/window selection (from the canvas or the ITEMS list) shows in the SAME
  // unified panel. Selecting an opening clears any wall/corner/room selection.
  useEffect(() => {
    const onSel = (e: any) => {
      const it = e?.detail?.item;
      if (!it || !it.parametricClass) return;
      setOpeningItem(it);
      setIsWallClicked(false);
      setIsCornerClicked(false);
      setIsRoomClicked(false);
    };
    const onDesel = () => setOpeningItem(null);
    window.addEventListener("pazl-opening-2d-selected", onSel as any);
    window.addEventListener("pazl-opening-2d-deselected", onDesel as any);
    return () => {
      window.removeEventListener("pazl-opening-2d-selected", onSel as any);
      window.removeEventListener("pazl-opening-2d-deselected", onDesel as any);
    };
  }, []);

  const resetSelections = () => {
    BlueprintInterface.resetSelections();
  };

  // Pull the saved (permanent) templates so the gallery shows them alongside
  // the bundled ones. Mapped into the card shape the gallery expects.
  const loadSavedTemplates = async () => {
    try {
      const list: SavedTemplate[] = await FloorPlanTemplateService.list();
      setSavedTemplates(
        list.map((t) => ({
          id: t._id,
          title: t.title,
          size: t.size || "Custom",
          url: t.scene,
          coverImageUrl: t.coverImageUrl || defaultTemplateCover,
          isCustom: true, // user-saved → deletable
        }))
      );
    } catch (err) {
      console.error("Could not load saved templates", err);
      setSavedTemplates([]);
    }
  };

  const handleTemplateSelect = (templateUrl: any) => {
    BlueprintInterface.handleTemplateUpdate(JSON.stringify(templateUrl));
    BlueprintInterface.ProjectManagerService?.updateFloorPlan(
      HISTORY_TITLES.FLOORPLAN_UPDATED
    );
    setShowTemplateMenu(false);
  };

  // Delete a user-saved template (built-in ones aren't deletable). Optimistically
  // remove it from the list, then call the backend; reload on failure.
  const handleTemplateDelete = async (id: string) => {
    setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
    try {
      await FloorPlanTemplateService.remove(id);
    } catch (err) {
      console.error("Could not delete template", err);
      loadSavedTemplates(); // restore if the delete failed
    }
  };

  const handleClear = async () => {
    setShowClearConfirmModal(false);
    setIsFloorPlanCleared(true);
    handleResetCanvas();
    await BlueprintInterface.ProjectManagerService.removeAllFurnishedModels();
    // handleResetCanvas() empties the walls, but the door/window 2D symbols are
    // drawn from the scene items (__roomItems), which are only removed by
    // removeAllFurnishedModels() above. Redraw the openings AFTER that removal so
    // __drawDoors runs with no items left and clears the orphan door/window
    // symbols — otherwise they linger until the next canvas action.
    BlueprintInterface.redrawDoors2D?.();
  };

  const onCloseClearConfirmModal = () => {
    setShowClearConfirmModal(false);
  };

  const onOpenClearConfirmModal = () => {
    setShowClearConfirmModal(true);
  };

  const onCloseWallElements = () => {
    setIsCornerClicked(false);
    setIsWallClicked(false);
    setIsRoomClicked(false);
    if (openingItem) {
      setOpeningItem(null);
      // Clear the canvas highlight too.
      try {
        window.dispatchEvent(new CustomEvent("pazl-opening-2d-deselected"));
      } catch (e) {
        /* ignore */
      }
    }
  };

  return (
    <>
      {showLoader ? <Loader /> : null}
      <div className="bg-white dark:bg-[#4E4E4E] flex">
        {floorplanTabData.map((item: string) => {
          if (item === "edit" || item === "settings") {
            return (
              <div
                key={item}
                className="rounded last bg-[#F9F9FA] dark:bg-[#4E4E4E]"
              >
                <GroupedButtons
                  item={item}
                  menuName={MENU_TABS.FLOOR_PLAN}
                  handleMenuItemClick={handleMenuItemClick}
                  mode={mode}
                  buttonRef={buttonRef}
                  handleUnitChange={handleUnitChange}
                />
              </div>
            );
          }
        })}
      </div>
      {/* Unified properties panel — one docked panel for whatever is selected. */}
      <PropertiesPanel
        kind={
          (openingItem
            ? "opening"
            : isWallClicked
            ? "wall"
            : isCornerClicked
            ? "corner"
            : isRoomClicked
            ? "room"
            : null) as SelKind
        }
        item2D={openingItem || item2D}
        unitMetric={unitMetric}
        onClose={onCloseWallElements}
      />
      <TemplateMenu
        isModalVisible={showTemplateMenu}
        onHide={() => setShowTemplateMenu(false)}
        templateList={[...templateList, ...savedTemplates]}
        isFloorPlanCleared={isFloorPlanCleared}
        onTemplateSelect={(templateUrl: any) =>
          handleTemplateSelect(templateUrl)
        }
        onTemplateDelete={handleTemplateDelete}
      />
      <ConfirmClearFloorplanModal
        showClearConfirmModal={showClearConfirmModal}
        onCloseClearConfirmModal={onCloseClearConfirmModal}
        handleClear={handleClear}
        isDarkMode={isDarkMode}
      />
    </>
  );
};

export default FloorPlanMenu;
