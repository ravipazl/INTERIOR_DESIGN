import React from "react";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import { MenuItem } from "@pazl/helpers/Types";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { Dimensioning } from "@pazl/main/core/dimensioning.js";
import { Point } from "pixi.js";
import { menuItemDisplayValue, modalInputs } from "@pazl/utils/unitsUtils.js";
import { ACTION_EVENT_2D } from "@pazl/main/core/events.js";
import { MENU_TABS } from ".";

interface MenuInputPropsType {
  itemData: MenuItem;
  item2D: any;
  unitMetric: string;
  onClose: () => void;
}

function MenuInput({
  itemData,
  item2D,
  unitMetric,
  onClose,
}: MenuInputPropsType) {
  const [itemProps, setItemProps] = React.useState("");
  React.useEffect(() => {
    setItemProps(menuItemDisplayValue(itemData));
  }, [item2D, unitMetric]);

  function handleWallThicknessInput(inputValue: any) {
    let wall_thickness = modalInputs(inputValue);
    console.log("DEBUG: wall thickness input value => ", inputValue);
    console.log(
      "DEBUG: wall thickness after metric conversions => ",
      wall_thickness
    );
    BlueprintInterface.setWallThickness(wall_thickness);
    setItemProps(inputValue);
  }

  function handleWallDimensionInput(inputValue: any) {
    let res =
      2 * Dimensioning.cmToPixel(Dimensioning.cmFromMeasureRaw(inputValue));
    console.debug(
      "DEBUG: wallSize ",
      BlueprintInterface.selectedWall2D.wallSize
    );
    console.debug("DEBUG: input translated to pixi ", res);
    let A = BlueprintInterface.selectedWall2D.start.location;
    let B = BlueprintInterface.selectedWall2D.end.location;
    console.debug("DEBUG: logging previous start corner ", A);
    console.debug("DEBUG: logging previous end corner ", B);
    let C = new Point(0, 0);
    let lenAB = Math.sqrt(Math.pow(A.x - B.x, 2.0) + Math.pow(A.y - B.y, 2.0));
    let length = res - BlueprintInterface.selectedWall2D.wallSize;
    C.x = B.x + ((B.x - A.x) / lenAB) * length;
    C.y = B.y + ((B.y - A.y) / lenAB) * length;
    BlueprintInterface.selectedWall2D.end.move(C.x, C.y);
    console.debug(
      "DEBUG: logging final start corner ",
      BlueprintInterface.selectedWall2D.start.location
    );
    console.debug(
      "DEBUG: logging final end corner ",
      BlueprintInterface.selectedWall2D.end.location
    );
    setItemProps(inputValue);
  }

  function handleCornerElevationInput(inputValue: any) {
    let elevation = modalInputs(inputValue);
    console.debug("DEBUG: elevation input value => ", inputValue);
    console.debug(
      "DEBUG: elevation value after metric conversions => ",
      elevation
    );
    BlueprintInterface.setCornerElevation(elevation);
    setItemProps(inputValue);
  }

  function handleRoomNameInput(inputValue: any) {
    console.debug("DEBUG: updated Room Name ", inputValue, BlueprintInterface);
    BlueprintInterface.setRoomName(inputValue, null, MENU_TABS.FLOOR_PLAN);
    setItemProps(inputValue);
  }

  function handleModalInput(e: any) {
    const val = e.target.value;
    switch (itemData.itemName) {
      case "wall_thickness":
        if (val && !`${val}`.includes("+") && !`${val}`.includes("-"))
          handleWallThicknessInput(val);
        break;
      case "dimension":
        if (val && !`${val}`.includes("+") && !`${val}`.includes("-"))
          handleWallDimensionInput(val);
        break;
      case "corner_elevation":
        if (val && !`${val}`.includes("+") && !`${val}`.includes("-"))
          handleCornerElevationInput(val);
        break;
      case "room_name":
        if (val) handleRoomNameInput(val);
        break;
      default:
        break;
    }
  }

  function handleDeleteEvent() {
    if (itemData.itemName === "delete_wall") {
      BlueprintInterface.actionsHistory2DManager.rise2DActionEvent(
        ACTION_EVENT_2D,
        BlueprintInterface.selectedWall2D
      );
      BlueprintInterface.removeWall();
      onClose();
    } else {
      BlueprintInterface.actionsHistory2DManager.rise2DActionEvent(
        ACTION_EVENT_2D,
        BlueprintInterface.selectedCorner2D
      );
      BlueprintInterface.removeCorner();
      onClose();
    }
  }

  return (
    <>
      <div className="py-1 grid justify-items-stretch">
        {itemData.itemType === "input" ? (
          <div className="mb-2">
            <p className="font-bold text-xs text-[#333333] dark:text-[#FFFFFF] py-0.5">
              {convertToTitleCase(itemData.itemName)}
            </p>
            <div className="flex items-center">
              <input
                type={itemData.itemName === "room_name" ? "text" : "number"}
                id="exampleFormControlInputNumber"
                className="w-full h-6 border rounded-sm border-[#dddddd] p-1 text-[#333333] dark:text-[#FFFFFF]"
                value={itemProps}
                onChange={handleModalInput}
              />
              {itemData.itemName === "wall_thickness" ||
              itemData.itemName === "dimension" ||
              itemData.itemName === "corner_elevation" ? (
                <label className="px-4 py-[2px] bg-[#E9E5EC] font-semibold text-sm text-[#333333]">
                  {unitMetric === "feetAndInch" ? " ft" : " mt"}
                </label>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            className="flex items-center justify-self-center text-red-400"
            onClick={() => handleDeleteEvent()}
          >
            <span className="material-symbols-outlined">
              {itemData.iconName ? itemData.iconName : itemData.itemName}
            </span>
            <span className="font-normal text-xs">
              {convertToTitleCase(itemData.itemName)}
            </span>
          </button>
        )}
      </div>
    </>
  );
}

export default MenuInput;
