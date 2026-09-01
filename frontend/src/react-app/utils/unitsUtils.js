import BlueprintInterface from "@pazl/blueprint-interface";
import { Dimensioning } from "@pazl/main/core/dimensioning.js";

export const NINTY_DEGREE_ROTATION_UNIT = 1.57;

function dimUnitWallLabel(wallSize) {
  console.debug("INFO: input wallSize value in raw pixi scale ", wallSize);
  console.debug(
    "INFO: output wallSize label in terms of the choosen metric ",
    Dimensioning.cmFromMeasureRaw(wallSize) + ` ${BlueprintInterface.getUnit()}`
  );
  return Dimensioning.cmToMeasureUnit(
    wallSize,
    1,
    BlueprintInterface.getUnit()
  );
}

function dimUnitRoomLabel(area) {
  console.debug("INFO: input area value in raw pixi scale ", area);
  console.debug(
    "INFO: output area label in terms of the choosen metric ",
    Dimensioning.cmFromMeasureRaw(area) + ` ${BlueprintInterface.getUnit()}`
  );
  return Dimensioning.cmToMeasureUnit(area, 2, BlueprintInterface.getUnit());
}

function menuItemDisplayValue(item) {
  console.debug("INFO: input menu item name ", item.itemName);
  // The active selection can momentarily be null while the properties panel
  // mounts (selection state updates are not batched), so guard every read —
  // a display getter must never throw on an empty selection.
  const wall = BlueprintInterface.selectedWall2D;
  const corner = BlueprintInterface.selectedCorner2D;
  const room = BlueprintInterface.getSelectedRoom2D();
  switch (item.itemName) {
    case "dimension":
      return wall ? valueForDisplay(wall.wallSize) : "";
    case "wall_thickness":
      return wall ? valueForDisplay(wall.thickness) : "";
    case "corner_elevation":
      return corner ? valueForDisplay(corner.elevation) : "";
    case "room_name":
      return room ? room.name : "";
    default:
      break;
  }
}

function valueForDisplay(inputValue) {
  console.debug("INFO: input value ", inputValue);
  console.debug(
    "INFO: output rounded off value ",
    parseFloat(Dimensioning.cmToMeasureRaw(inputValue)).toFixed(2)
  );
  return parseFloat(Dimensioning.cmToMeasureRaw(inputValue)).toFixed(2);
}

function modalInputs(inputValue) {
  console.debug("INFO: input value ", inputValue);
  console.debug(
    "INFO: output rounded off value ",
    Math.round(Dimensioning.cmFromMeasureRaw(inputValue))
  );
  return Math.round(Dimensioning.cmFromMeasureRaw(inputValue));
}

/**
 *
 * @param {number} angle
 * @returns {Number}
 */
function convertAngleToEulersUnit(angle) {
  console.debug("unitsUtils.js ~ convertAngleToEulersUnit ~ angle", angle);
  if (angle === 0) return 0;

  return Number((Number(angle) / 90) * NINTY_DEGREE_ROTATION_UNIT);
}

/**
 *
 * @param {number} units
 * @returns {Number}
 */
function convertEulersUnitToAngle(units) {
  console.debug("unitsUtils.js ~ convertEulersUnitToAngle ~ units", units);
  if (units === 0) return 0;

  return Number((Number(units) / NINTY_DEGREE_ROTATION_UNIT) * 90);
}

export {
  dimUnitWallLabel,
  dimUnitRoomLabel,
  valueForDisplay,
  menuItemDisplayValue,
  modalInputs,
  convertAngleToEulersUnit,
  convertEulersUnitToAngle,
};
