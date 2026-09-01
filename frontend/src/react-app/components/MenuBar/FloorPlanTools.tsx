import React, { useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { handleDrawFreeShape } from "@pazl/viewer2d-state-interface";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";

/**
 * Floating 2D tool palette (Superbolter-style) docked at the top-right of the
 * floor-plan canvas. Wires each card to an existing engine action:
 *   - Draw walls  → handleDrawFreeShape() (enters DRAW mode)
 *   - Select      → 2D MOVE mode
 *   - Door/Window → adds the DEFAULT parametric door/window (RoomplannerHelper)
 *                   onto a wall, not a static catalog model.
 */

const FloorPlanTools: React.FC = () => {
  const [active, setActive] = useState<string>("");
  // Overall-dimensions overlay mode. "outer" = footprint (W×H outside the plan),
  // "inner" = show ALL per-wall labels at once. Mutually exclusive; both sit on
  // top of the always-on individual show-on-select behaviour.
  const [dimMode, setDimMode] = useState<"off" | "inner" | "outer">("off");

  const drawWalls = () => {
    setActive("walls");
    try {
      handleDrawFreeShape();
    } catch (e) {
      console.error("FloorPlanTools: draw walls failed", e);
    }
  };

  const selectMode = () => {
    setActive("select");
    try {
      BlueprintInterface?.blueprint3d?.setViewer2DModeToMove?.();
    } catch (e) {
      console.error("FloorPlanTools: select mode failed", e);
    }
  };

  // Which type-list is open ("door" | "window" | null).
  const [picker, setPicker] = useState<"door" | "window" | null>(null);

  // The three door types with standard Indian-home default sizes (cm — engine is
  // cm-native; FT/MM toggle only changes display). Height × width:
  //   Room     7 ft × 3 ft   (84" × 36")  = 213 × 91 cm
  //   Main     7 ft × 4 ft   (84" × 48")  = 213 × 122 cm, double leaf
  //   Bathroom 7 ft × 2.5 ft (84" × 30")  = 213 × 76 cm
  const DOOR_OPTIONS: {
    label: string;
    icon: string;
    type: number;
    open: string;
    w: number;
    h: number;
  }[] = [
    { label: "Room Door", icon: "door_front", type: 1, open: "RIGHT", w: 91, h: 213 },
    { label: "Main Door", icon: "meeting_room", type: 1, open: "BOTH_SIDES", w: 122, h: 213 },
    { label: "Bathroom Door", icon: "bathroom", type: 1, open: "RIGHT", w: 76, h: 213 },
  ];
  const WINDOW_OPTIONS: { label: string; icon: string; type: number }[] = [
    { label: "Window", icon: "window", type: 1 },
  ];

  // Resolve the target wall (selected → else null), returning its midpoint.
  const selectedWallMid = () => {
    const helper = BlueprintInterface?.blueprint3d?.roomplanningHelper;
    const wall =
      BlueprintInterface.selectedWall2D || helper?.__selectedWall || null;
    if (!wall || !wall.start || !wall.end) return null;
    return {
      helper,
      cx: (wall.start.location.x + wall.end.location.x) / 2,
      cy: (wall.start.location.y + wall.end.location.y) / 2,
    };
  };

  const placeDoor = (opt: {
    label: string;
    type: number;
    open: string;
    w: number;
    h: number;
  }) => {
    const t = selectedWallMid();
    if (!t) {
      alert("Select a wall first (Select tool → click a wall), then pick a door.");
      return;
    }
    try {
      t.helper.addParametricDoorAtPoint(
        t.cx,
        t.cy,
        opt.w,
        opt.type,
        opt.open,
        opt.h,
        opt.label
      );
      setTimeout(() => BlueprintInterface?.redrawDoors2D?.(), 300);
      BlueprintInterface?.snapshot2D?.();
      // Persist to the project (like the AI-import + opening-edit paths do).
      // Placement previously only recorded an in-memory undo snapshot, so a
      // manually placed door was lost on refresh.
      BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(
        HISTORY_TITLES.FLOORPLAN_UPDATED
      );
    } catch (e) {
      console.error("FloorPlanTools: place door failed", e);
    }
    setPicker(null);
  };

  const placeWindow = (opt: { label: string; type: number }) => {
    const t = selectedWallMid();
    if (!t) {
      alert("Select a wall first (Select tool → click a wall), then pick a window.");
      return;
    }
    try {
      t.helper.addParametricWindowAtPoint(t.cx, t.cy, 120, opt.type, opt.label);
      setTimeout(() => BlueprintInterface?.redrawDoors2D?.(), 300);
      BlueprintInterface?.snapshot2D?.();
      // Persist to the project so the window survives a refresh (was undo-only).
      BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(
        HISTORY_TITLES.FLOORPLAN_UPDATED
      );
    } catch (e) {
      console.error("FloorPlanTools: place window failed", e);
    }
    setPicker(null);
  };

  // Toggle the overall-dimensions overlay. Clicking the active mode again turns
  // it off, so Inner and Outer are mutually exclusive.
  const setDims = (mode: "inner" | "outer") => {
    const next = dimMode === mode ? "off" : mode;
    try {
      const activeMode = (BlueprintInterface as any)?.setDimensionsMode2D?.(next);
      setDimMode((activeMode as "off" | "inner" | "outer") ?? next);
    } catch (e) {
      console.error("FloorPlanTools: set dimensions mode failed", e);
      setDimMode(next);
    }
  };

  const Card = ({
    icon,
    label,
    onClick,
    isActive,
  }: {
    icon: string;
    label: string;
    onClick: () => void;
    isActive?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-2 w-[74px] h-[70px] transition ${
        isActive
          ? "border-[color:var(--pz-accent)] bg-[color:var(--pz-accent)]/10"
          : "border-[color:var(--pz-panel-border)] bg-white dark:bg-[#3a3a3a] hover:border-[color:var(--pz-accent)]"
      }`}
    >
      <span className="material-symbols-outlined text-[22px] text-[color:var(--pz-accent)]">
        {icon}
      </span>
      <span className="text-[11px] leading-tight text-neutral-600 dark:text-neutral-200 text-center">
        {label}
      </span>
    </button>
  );

  return (
    <div className="absolute top-4 right-4 z-20 w-[184px] rounded-xl border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] shadow-[0_4px_16px_rgba(0,0,0,0.12)] p-3">
      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-100 mb-2">
        Structures
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Card
          icon="square_foot"
          label="Walls"
          onClick={drawWalls}
          isActive={active === "walls"}
        />
        <Card
          icon="pan_tool"
          label="Select"
          onClick={selectMode}
          isActive={active === "select"}
        />
      </div>

      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-100 mt-3 mb-2">
        Doors &amp; windows
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Card
          icon="door_front"
          label="Door"
          onClick={() => setPicker(picker === "door" ? null : "door")}
          isActive={picker === "door"}
        />
        <Card
          icon="window"
          label="Window"
          onClick={() => setPicker(picker === "window" ? null : "window")}
          isActive={picker === "window"}
        />
      </div>

      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-100 mt-3 mb-2">
        Measurements
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Card
          icon="crop_free"
          label="Outer"
          onClick={() => setDims("outer")}
          isActive={dimMode === "outer"}
        />
        <Card
          icon="straighten"
          label="Inner"
          onClick={() => setDims("inner")}
          isActive={dimMode === "inner"}
        />
      </div>

      {/* Type list — opens when Door/Window is clicked; pick one to place it on
          the selected wall. */}
      {picker ? (
        <div className="mt-2 rounded-lg border border-[color:var(--pz-panel-border)] bg-white dark:bg-[#333] p-1">
          <div className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-300 px-1 py-1">
            {picker === "door" ? "Choose a door" : "Choose a window"}
          </div>
          {(picker === "door" ? DOOR_OPTIONS : WINDOW_OPTIONS).map((o: any) => (
            <button
              key={o.label}
              type="button"
              onClick={() =>
                picker === "door" ? placeDoor(o) : placeWindow(o)
              }
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-neutral-700 dark:text-neutral-200 hover:bg-[color:var(--pz-accent)]/10"
            >
              <span className="material-symbols-outlined text-[18px] text-[color:var(--pz-accent)]">
                {o.icon}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default FloorPlanTools;
