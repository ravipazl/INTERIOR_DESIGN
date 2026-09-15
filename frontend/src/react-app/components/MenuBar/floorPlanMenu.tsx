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
import ToolbarPortal from "./ToolbarPortal";
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
import { createPortal } from "react-dom";

// Coohom-style 2D drawing tools (scripts/viewer2d/DrawTools2D.js).
const DRAW_TOOL_ITEMS = [
  "arc",
  "rectangle",
  "circle",
  "fillet",
  "merge",
  "split",
  "trim",
  "align",
  "guides",
];
// Fillet corner types: value, label, name of the size, icon path (20×20).
type FilletMode = "fillet" | "inner" | "rightangle" | "chamfer";
const FILLET_TYPES: [FilletMode, string, string, string][] = [
  ["fillet", "Fillet", "Radius", "M4 17V10A6 6 0 0 1 10 4H17"],
  ["inner", "Inner fillet", "Radius", "M4 17V10A6 6 0 0 0 10 4H17"],
  ["rightangle", "Inner right angle", "Size", "M4 17V10H10V4H17"],
  ["chamfer", "Chamfer", "Length", "M4 17V10L10 4H17"],
];
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
  active = true,
}: {
  floorplanTabData: string[];
  /**
   * Is Floor plan the tab on screen? Used ONLY to gate the toolbar this menu
   * portals into the navbar — the portal escapes the pane MenuBar hides, so it
   * would otherwise stay up there while you are on another tab.
   */
  active?: boolean;
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
  // Tool options popover (Orthogonal / fillet radius / clear guides), shown
  // under the active tool's button like Coohom's.
  const [ortho, setOrtho] = useState(false);
  const [filletMm, setFilletMm] = useState(500);
  // Circle / Arc drawing method (the two options under their buttons).
  const [circleMode, setCircleMode] = useState<"corner" | "radius">("corner");
  const [arcMode, setArcMode] = useState<"radius" | "chord">("radius");
  const [arcOrtho, setArcOrtho] = useState(false);
  // Fillet corner type (the list under the Fillet button).
  const [filletMode, setFilletMode] = useState<FilletMode>("fillet");
  const [toolAnchor, setToolAnchor] = useState<DOMRect | null>(null);

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
        setToolAnchor(
          document.getElementById(itemData.id)?.getBoundingClientRect() || null
        );
        handleDrawFreeShape();
        break;
      case "arc":
      case "rectangle":
      case "circle":
      case "fillet":
      case "merge":
      case "split":
      case "trim":
      case "align":
      case "guides":
        setToolAnchor(
          document.getElementById(itemData.id)?.getBoundingClientRect() || null
        );
        if (mode === itemData.itemName) {
          // a second click on the active tool turns it off
          (BlueprintInterface as any).exitDrawTool2D?.();
        } else if ((BlueprintInterface as any).setDrawTool2D?.(itemData.itemName)) {
          setMode(itemData.itemName);
        }
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

  // Keep the toolbar's lit button in step with the 2D tool: Esc (or anything
  // else that ends a tool) turns the highlight off.
  useEffect(() => {
    const onTool = (e: any) => {
      const tool = e?.detail?.tool || null;
      setMode((m) => (tool ? tool : DRAW_TOOL_ITEMS.includes(m) ? "" : m));
    };
    window.addEventListener("pazl:draw-tool", onTool);
    return () => window.removeEventListener("pazl:draw-tool", onTool);
  }, []);

  // Leaving the floor-plan tab ends any drawing tool.
  useEffect(() => {
    if (!active) (BlueprintInterface as any).exitDrawTool2D?.();
  }, [active]);

  // Clear and Template moved to the Floor plan panel's "Draw room" section,
  // but their modals and state stay here. The panel is a sibling in the tree,
  // so it asks via a window event rather than duplicating the modals.
  useEffect(() => {
    const onClear = () => onOpenClearConfirmModal();
    const onTemplates = () => {
      loadSavedTemplates();
      setShowTemplateMenu(true);
    };
    window.addEventListener("pazl-floorplan-clear", onClear);
    window.addEventListener("pazl-floorplan-templates", onTemplates);
    return () => {
      window.removeEventListener("pazl-floorplan-clear", onClear);
      window.removeEventListener("pazl-floorplan-templates", onTemplates);
    };
  }, []);

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
    // Now the 3D side. The dimension chips a door or window shows there are
    // HTML nodes on document.body plus an SVG overlay, NOT scene objects, so
    // emptying the geometry never touched them - they stayed frozen over an
    // empty canvas until a reload rebuilt the viewer. This drops the viewer
    // selection so its own guard hides them straight away.
    BlueprintInterface.clearSelection3D?.();
    // And the React side: every selection made in the 3D step lives in
    // furnishMenu state, which would otherwise keep the Window / Door
    // Properties panel open for something that no longer exists.
    try {
      window.dispatchEvent(new CustomEvent("pazl-floorplan-cleared"));
    } catch (e) {
      /* the clear above already happened; this is cleanup only */
    }
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
      <ToolbarPortal active={active}>
      <div className="flex items-center">
        {floorplanTabData.map((item: string) => {
          if (
            item === "edit" ||
            item === "draw_tools" ||
            item === "modify_tools" ||
            item === "settings"
          ) {
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
      </ToolbarPortal>
      {active &&
      toolAnchor &&
      ["draw", "guides", "fillet", "circle", "arc"].includes(mode)
        ? createPortal(
            <div
              role="group"
              aria-label="Tool options"
              style={{
                position: "fixed",
                top: toolAnchor.bottom + 6,
                left: Math.max(8, toolAnchor.left - 8),
                zIndex: 1050,
                background: "#fff",
                borderRadius: 8,
                boxShadow:
                  "0 6px 20px rgba(20,24,51,0.14), 0 0 0 1px rgba(20,24,51,0.06)",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 13,
                color: "#333",
              }}
            >
              {mode === "circle" || mode === "arc" ? (
                <>
                <div style={{ display: "flex", gap: 4 }}>
                  {(mode === "circle"
                    ? [
                        ["corner", "circumscribed corner", "crop_square"],
                        ["radius", "radius", "adjust"],
                      ]
                    : [
                        ["radius", "Radius", "track_changes"],
                        ["chord", "Chord height", "height"],
                      ]
                  ).map(([value, label, icon]) => {
                    const on =
                      (mode === "circle" ? circleMode : arcMode) === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          if (mode === "circle") {
                            setCircleMode(value as "corner" | "radius");
                            (BlueprintInterface as any).setCircleMode2D?.(value);
                          } else {
                            setArcMode(value as "radius" | "chord");
                            (BlueprintInterface as any).setArcMode2D?.(value);
                          }
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "none",
                          background: on ? "rgba(30,136,229,0.10)" : "transparent",
                          color: on ? "#1e88e5" : "#555",
                          cursor: "pointer",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 20, lineHeight: "20px" }}
                        >
                          {icon}
                        </span>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {mode === "arc" ? (
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    <input
                      type="checkbox"
                      checked={arcOrtho}
                      onChange={(e) => {
                        setArcOrtho(e.target.checked);
                        (BlueprintInterface as any).setArcOrthogonal2D?.(e.target.checked);
                      }}
                    />
                    Orthogonal
                  </label>
                ) : null}
                </>
              ) : mode === "fillet" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div role="radiogroup" aria-label="Corner type" style={{ display: "flex", flexDirection: "column" }}>
                  {FILLET_TYPES.map(([value, label, , icon]) => {
                    const on = filletMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setFilletMode(value);
                          (BlueprintInterface as any).setFilletMode2D?.(value);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 8px",
                          borderRadius: 6,
                          border: "none",
                          background: on ? "rgba(30,136,229,0.10)" : "transparent",
                          color: on ? "#1e88e5" : "#333",
                          cursor: "pointer",
                          fontSize: 13,
                          whiteSpace: "nowrap",
                          textAlign: "left",
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            d={icon}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8 }}>
                  {FILLET_TYPES.find((t) => t[0] === filletMode)?.[2] || "Radius"}
                  <input
                    type="number"
                    min={10}
                    step={10}
                    value={filletMm}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFilletMm(v);
                      if (v > 0) (BlueprintInterface as any).setFilletRadius2D?.(v / 10);
                    }}
                    style={{
                      width: 76,
                      border: "1px solid #d1d5db",
                      borderRadius: 4,
                      padding: "2px 6px",
                    }}
                  />
                  mm
                </label>
                </div>
              ) : (
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={ortho}
                    onChange={(e) => {
                      setOrtho(e.target.checked);
                      (BlueprintInterface as any).setOrthogonal2D?.(e.target.checked);
                    }}
                  />
                  Orthogonal
                </label>
              )}
              {mode === "guides" ? (
                <button
                  type="button"
                  onClick={() => (BlueprintInterface as any).clearGuides2D?.()}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    borderRadius: 4,
                    padding: "2px 8px",
                    cursor: "pointer",
                  }}
                >
                  Clear guides
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
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
