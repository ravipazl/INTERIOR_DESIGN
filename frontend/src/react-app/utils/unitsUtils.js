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

/**
 * A number typed into a properties field, in the DISPLAY unit, converted to the
 * centimetres the engine stores.
 *
 * KEEP THE FRACTION. This used to finish with Math.round(), to WHOLE
 * centimetres — so in millimetres every entry was snapped to the nearest 10:
 *
 *     118 mm -> 11.8 cm -> round -> 12 cm -> shown back as 120 mm
 *
 * 114 became 110, 115 became 120, 123 became 120. It only appeared to work when
 * the number typed happened to be a multiple of ten, and it was silent — the
 * field simply showed a value nobody had entered. It applied to wall LENGTHS
 * through this same function too, so 6096 would have landed on 6100.
 *
 * Nothing needed that rounding: thickness and length are floats in the model.
 * cmFromMeasureRaw already rounds to 3 decimal places of a centimetre — a
 * hundredth of a millimetre — which is finer than anything can be drawn or
 * built, and keeps float tails out of the stored value.
 */
function modalInputs(inputValue) {
  const cm = Dimensioning.cmFromMeasureRaw(inputValue);
  console.debug("INFO: input value ", inputValue, "-> cm", cm);
  return cm;
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
