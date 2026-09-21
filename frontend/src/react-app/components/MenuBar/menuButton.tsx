import React, { useState, useEffect } from "react";
import "@pazl/components/MenuBar/index.css";
import "material-symbols";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import { MenuTabProps, UnitOption, MenuItem } from "@pazl/helpers/Types";
import BlueprintInterface from "@pazl/blueprint-interface";
import { TERipple } from "tw-elements-react";
import { ACTION_MODES } from "./furnishMenu";

// The name shown UNDER every toolbar icon (Coohom-style), on the 2D and the
// 3D toolbar alike. Anything not listed falls back to the item name.
const TOOLBAR_LABELS: Record<string, string> = {
  select: "Select",
  draw: "Line",
  undo: "Undo",
  redo: "Redo",
  clear: "Clear",
  arc: "Arc",
  rectangle: "Rectangle",
  circle: "Circle",
  fillet: "Fillet",
  merge: "Merge",
  split: "Split",
  trim: "Trim",
  align: "Align",
  guides: "Guides",
  import: "Import",
  export: "Export",
  snap: "Snap",
  multiSelect: "Select",
  top_view: "Top",
  "3d_view": "3D",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  snapshot: "Snapshot",
  shortcuts: "Shortcuts",
  object: "Object",
  room: "Room",
  gltf: "Export",
};

// Buttons that had words instead of an icon get one, now that the word is
// shown underneath anyway.
const FALLBACK_ICONS: Record<string, string> = {
  object: "filter_center_focus",
  room: "fit_screen",
};

// 2D drawing tools (scripts/viewer2d/DrawTools2D.js): lit while active.
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

const MenuButton: React.FC<MenuTabProps> = ({
  itemData,
  handleMenuItemClick,
  mode,
  buttonRef,
  handleUnitChange,
}) => {
  const isDisabled =
    (itemData?.itemName === ACTION_MODES.OBJECT_FOCUS ||
      itemData?.itemName === ACTION_MODES.ROOM_FOCUS) &&
    mode === ACTION_MODES.CAM_TOP_VIEW;

  // (Removed) A keydown listener here called the FLOOR-PLAN undo on every
  // "z" — plain Z too (it never checked Ctrl), inside text fields too, on the
  // 3D tab too, and once per toolbar button, since every button added its own
  // copy: one press undid about ten floor-plan steps. Ctrl/Cmd+Z is now handled
  // once per tab — EditorShortcuts2D on the floor plan, furnishMenu on 3D.

  const handleUndo2D = () => {
    BlueprintInterface.actionsHistory2DManager.undo();
  };

  const handleRedo2D = () => {
    BlueprintInterface.actionsHistory2DManager.redo();
  };

  const handleTabItemActive = (mode: string, itemData: MenuItem) => {
    if (mode === "multiSelect" && itemData.itemName === "multiSelect") {
      return true;
    }
    if (mode === "draw" && itemData.itemName === "draw") {
      return true;
    }
    if (DRAW_TOOL_ITEMS.includes(itemData.itemName) && mode === itemData.itemName) {
      return true;
    }
    if (itemData.iconName === "toggle_on") {
      return true;
    } else {
      return false;
    }
  };

  const handleTabItemName = (itemData: MenuItem) => {
    if (itemData.itemName === "add_item") {
      return "Explore";
    }
    if (itemData.itemName === "upload") {
      return "Upload";
    }
    if (itemData.itemName === "generate") {
      return "Generate";
    }
    if (itemData.itemName === "object" || itemData.itemName === "room") {
      return "Focus";
    } else {
      return null;
    }
  };

  return (
    <div className="pr-px">
      {itemData.itemName === "units" ? (
        <div className="flex items-center flex-col w-14 h-14 rounded p-1.5 hover:bg-[color:var(--pz-panel-hover)]">
          <select
            className="w-12 h-8 pb-1 pl-2 rounded font-semibold text-base focus:outline-none dark:text-white hover:bg-[color:var(--pz-panel-hover)] dark:bg-[#4E4E4E]"
            onChange={(e) => handleUnitChange(e.target.value)}
          >
            {itemData.unitOptions?.map((option: UnitOption) => (
              <option key={option.id}>
                {convertToTitleCase(option.value)}
              </option>
            ))}
          </select>
          <span className="self-center menu-button-text dark:text-[#ffffff]">
            {convertToTitleCase(itemData.itemName)}
          </span>
        </div>
      ) : itemData.itemName === "free_view" ||
        itemData.itemName === "history" ? null : (
        <TERipple rippleColor="Secondary">
          <button
            id={itemData.id}
            ref={buttonRef}
            title={
              handleTabItemName(itemData)
                ? handleTabItemName(itemData)
                : convertToTitleCase(itemData.itemName)
            }
            style={
              (mode === ACTION_MODES.CAM_TOP_VIEW &&
                itemData.itemName === ACTION_MODES.CAM_TOP_VIEW) ||
              (itemData.itemName === ACTION_MODES.CAM_3D_VIEW &&
                mode !== ACTION_MODES.CAM_TOP_VIEW)
                ? { backgroundColor: "var(--pz-accent-soft)" }
                : { backgroundColor: "transparent" }
            }
            className={`min-w-[44px] h-[46px] px-1 rounded flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isDisabled ? "" : "hover:bg-[color:var(--pz-panel-hover)]"
            } ${
              handleTabItemActive(mode, itemData)
                ? isDisabled
                  ? ""
                  : "bg-[color:var(--pz-accent-soft)]"
                : ""
            } ${itemData.iconName === "toggle_on" ? "snap-icon" : ""}`}
            onClick={() => handleMenuItemClick(itemData)}
            disabled={isDisabled}
          >
            <span
              style={{ fontSize: 22, lineHeight: "22px" }}
              className={`material-symbols-outlined ${
                itemData.iconName || FALLBACK_ICONS[itemData.itemName]
                  ? "font-extralight dark:text-[#ffffff]"
                  : "h-6 font-semibold text-xs font-['Inter'] dark:text-[#ffffff]"
              }
                  ${
                    isDisabled
                      ? "text-[#cccccc]"
                      : handleTabItemActive(mode, itemData)
                      ? "text-[color:var(--pz-accent)] dark:text-[color:var(--pz-accent)]"
                      : ""
                  } 
                  `}
            >
              {itemData.iconName ||
                FALLBACK_ICONS[itemData.itemName] ||
                convertToTitleCase(itemData.itemName)}
            </span>
            <p
              style={{ fontSize: 10.5, lineHeight: "12px", margin: 0, whiteSpace: "nowrap" }}
              className={`menu-button-text dark:text-[#ffffff] ${
                isDisabled
                  ? "text-[#cccccc]"
                  : handleTabItemActive(mode, itemData)
                  ? "font-semibold text-xs text-[color:var(--pz-accent)] dark:text-[color:var(--pz-accent)]"
                  : ""
              } `}
            >
              {TOOLBAR_LABELS[itemData.itemName] ||
                handleTabItemName(itemData) ||
                convertToTitleCase(itemData.itemName)}
            </p>
          </button>
        </TERipple>
      )}
    </div>
  );
};

export default MenuButton;
