import React, { useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { Dimensioning } from "@pazl/main/core/dimensioning.js";
import {
  Configuration,
  configDimUnit,
} from "@pazl/main/core/configuration.js";

/**
 * Door/window attribute fields, rendered INSIDE the unified PropertiesPanel (so
 * openings share the one docked panel with walls/corners/rooms). Controlled by
 * the `item` prop (a placed parametric opening). Edits apply to the item's
 * parametric class and refresh 2D + 3D.
 */

const OPEN_DIRS = [
  { value: "RIGHT", label: "Right" },
  { value: "LEFT", label: "Left" },
  { value: "BOTH_SIDES", label: "Double" },
  { value: "NO_DOORS", label: "None" },
];

const unitLabel = (): string => {
  const u = (Configuration as any).getStringValue?.(configDimUnit);
  if (u === "feetAndInch") return "ft";
  if (u === "mm") return "mm";
  if (u === "m") return "m";
  if (u === "inch") return "in";
  return "cm";
};
const toDisplay = (cm: number) => {
  const v = (Dimensioning as any).cmToMeasureRaw(cm);
  return typeof v === "number" ? Math.round(v * 100) / 100 : v;
};
const fromInput = (val: number) => (Dimensioning as any).cmFromMeasureRaw(val);

const OpeningFields: React.FC<{ item: any; onClose: () => void }> = ({
  item,
  onClose,
}) => {
  const dc = item?.parametricClass;
  const isWindow =
    !!(dc && (dc.__windowType !== undefined || dc.__name === "Window")) ||
    item?.__metadata?.baseParametricType === "WINDOW";

  const [w, setW] = useState<string>("");
  const [h, setH] = useState<string>("");
  const [dir, setDir] = useState<string>("RIGHT");
  // Swing side flip (straight vs inverse) — mirrors the arc to the other side.
  const [swing, setSwing] = useState<string>("straight");

  useEffect(() => {
    if (!dc) return;
    try {
      setW(String(toDisplay(dc.frameWidth)));
      setH(String(toDisplay(dc.frameHeight)));
      setDir(dc.openDirection || "RIGHT");
      const flipped = !!(item?.__metadata?.swingFlip || item?.__swingFlip);
      setSwing(flipped ? "inverse" : "straight");
    } catch (e) {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const redraw = () => {
    try {
      const rp = BlueprintInterface?.blueprint3d?.roomplanner;
      if (rp) rp.needsUpdate = true;
      BlueprintInterface?.redrawDoors2D?.();
      BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(
        "Opening edited"
      );
    } catch (e) {
      /* ignore */
    }
  };

  const applyWidth = (val: string) => {
    setW(val);
    const n = Number(val);
    if (!val || Number.isNaN(n) || !dc) return;
    try {
      dc.frameWidth = fromInput(n);
      redraw();
    } catch (e) {
      /* ignore */
    }
  };
  const applyHeight = (val: string) => {
    setH(val);
    const n = Number(val);
    if (!val || Number.isNaN(n) || !dc) return;
    try {
      dc.frameHeight = fromInput(n);
      redraw();
    } catch (e) {
      /* ignore */
    }
  };
  const applyDir = (val: string) => {
    setDir(val);
    if (!dc) return;
    try {
      dc.openDirection = val;
      redraw();
      BlueprintInterface?.snapshot2D?.();
    } catch (e) {
      /* ignore */
    }
  };
  const applySwing = (val: string) => {
    setSwing(val);
    if (!item) return;
    try {
      const flipped = val === "inverse";
      item.__swingFlip = flipped;
      item.__metadata = item.__metadata || {};
      item.__metadata.swingFlip = flipped;
      redraw();
      BlueprintInterface?.snapshot2D?.();
    } catch (e) {
      /* ignore */
    }
  };
  const del = () => {
    try {
      BlueprintInterface?.blueprint3d?.model?.removeItem?.(item);
      BlueprintInterface?.redrawDoors2D?.();
      BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(
        "Opening deleted"
      );
      BlueprintInterface?.snapshot2D?.();
    } catch (e) {
      /* ignore */
    }
    onClose();
  };

  if (!dc) return null;
  const ul = unitLabel();
  const inputCls =
    "w-full h-6 border rounded-sm border-[#dddddd] p-1 text-[#333333] dark:text-[#FFFFFF]";
  const unitCls =
    "px-4 py-[2px] bg-[#E9E5EC] font-semibold text-sm text-[#333333]";

  return (
    <div className="px-4 py-2 bg-white dark:bg-[#4E4E4E]">
      <div className="mb-2">
        <p className="font-bold text-xs text-[#333333] dark:text-[#FFFFFF] py-0.5">
          Width
        </p>
        <div className="flex items-center">
          <input
            type="number"
            className={inputCls}
            value={w}
            onChange={(e) => applyWidth(e.target.value)}
          />
          <label className={unitCls}>{ul}</label>
        </div>
      </div>
      <div className="mb-2">
        <p className="font-bold text-xs text-[#333333] dark:text-[#FFFFFF] py-0.5">
          Height
        </p>
        <div className="flex items-center">
          <input
            type="number"
            className={inputCls}
            value={h}
            onChange={(e) => applyHeight(e.target.value)}
          />
          <label className={unitCls}>{ul}</label>
        </div>
      </div>
      {!isWindow && (
        <div className="mb-2">
          <p className="font-bold text-xs text-[#333333] dark:text-[#FFFFFF] py-0.5">
            Open direction
          </p>
          <select
            className="w-full h-8 px-2 text-sm rounded border border-[#dddddd] bg-white dark:bg-[#4E4E4E] dark:text-white focus:outline-none"
            value={dir}
            onChange={(e) => applyDir(e.target.value)}
          >
            {OPEN_DIRS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {!isWindow && (
        <div className="mb-2">
          <p className="font-bold text-xs text-[#333333] dark:text-[#FFFFFF] py-0.5">
            Swing
          </p>
          <select
            className="w-full h-8 px-2 text-sm rounded border border-[#dddddd] bg-white dark:bg-[#4E4E4E] dark:text-white focus:outline-none"
            value={swing}
            onChange={(e) => applySwing(e.target.value)}
          >
            <option value="straight">Straight</option>
            <option value="inverse">Inverse</option>
          </select>
        </div>
      )}
      <button
        type="button"
        onClick={del}
        className="mt-1 flex items-center gap-1 text-red-400 hover:text-red-500"
      >
        <span className="material-symbols-outlined text-[18px]">delete</span>
        <span className="font-normal text-xs">
          Delete {isWindow ? "window" : "door"}
        </span>
      </button>
    </div>
  );
};

export default OpeningFields;
