import React, { useState, useEffect } from "react";
import "@pazl/components/MenuBar/index.css";
import "material-symbols";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import { MenuTabProps, UnitOption, MenuItem } from "@pazl/helpers/Types";
import BlueprintInterface from "@pazl/blueprint-interface";
import { TERipple } from "tw-elements-react";
import { ACTION_MODES } from "./furnishMenu";

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

  // handling ctrl z and cmd z undo
  useEffect(() => {
    const onKeyDown = (e: any) => {
      if (e.code === "KeyZ" && e.key === "z") {
        handleUndo2D();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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
            className={`w-11 h-11 rounded flex items-center justify-center transition-colors ${
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
              className={`material-symbols-outlined ${
                itemData.iconName
                  ? "font-extralight dark:text-[#ffffff]"
                  : "h-6 font-semibold text-xs font-['Source_Sans_Pro'] dark:text-[#ffffff]"
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
              {itemData.iconName
                ? itemData.iconName
                : convertToTitleCase(itemData.itemName)}
            </span>
            <p
              className={`hidden menu-button-text dark:text-[#ffffff] ${
                isDisabled
                  ? "text-[#cccccc]"
                  : handleTabItemActive(mode, itemData)
                  ? "font-semibold text-xs text-[color:var(--pz-accent)] dark:text-[color:var(--pz-accent)]"
                  : ""
              } `}
            >
              {handleTabItemName(itemData)
                ? handleTabItemName(itemData)
                : convertToTitleCase(itemData.itemName)}
            </p>
          </button>
        </TERipple>
      )}
    </div>
  );
};

export default MenuButton;
