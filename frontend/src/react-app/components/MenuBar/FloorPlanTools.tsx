import React, { useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { handleDrawFreeShape } from "@pazl/viewer2d-state-interface";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import {
  dimFeetAndInch,
  dimMeter,
  dimMilliMeter,
} from "@pazl/main/core/constants.js";
import FloorPlanAiImport from "./FloorPlanAiImport";
import SaveTemplateButton from "./SaveTemplateButton";

/**
 * The Floor plan step's tool panel, docked in the left sidebar.
 *
 * Was a small floating palette pinned to the top-right of the canvas; it now
 * lives in the left panel as collapsible sections, so every floor-plan action
 * is in one place instead of split between a floating box and the Scene panel:
 *
 *   Import floor plan        → FloorPlanAiImport (PDF/PNG/JPG/WEBP)
 *   Draw room                → handleDrawFreeShape() / 2D MOVE mode
 *   Place doors and windows  → parametric door/window on the SELECTED wall
 *   Measurements             → the overall-dimensions overlay
 *
 * Door/Window add the DEFAULT parametric opening via RoomplannerHelper, not a
 * static catalog model.
 */

const FloorPlanTools: React.FC = () => {
  const [active, setActive] = useState<string>("");
  // Which sections are expanded. Import starts CLOSED — it is a one-off at the
  // start of a project, whereas Draw room is used constantly.
  const [openSections, setOpenSections] = useState<string[]>([
    "draw",
    "openings",
  ]);
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

  // Draw is a TOGGLE: click once to draw, click again to go back to select.
  //
  // The separate "Select" card used to be the way out of draw mode. With that
  // card hidden, the only remaining exit is the Escape key (Viewer2D
  // __keyListener), which nothing in the UI mentions - and drawing is sticky by
  // design, since the auto-return-to-MOVE after each wall is commented out in
  // Viewer2D. Toggling keeps the exit without putting the button back.
  const toggleDraw = () => {
    if (active === "walls") selectMode();
    else drawWalls();
  };

  const selectMode = () => {
    setActive("select");
    try {
      BlueprintInterface?.blueprint3d?.setViewer2DModeToMove?.();
    } catch (e) {
      console.error("FloorPlanTools: select mode failed", e);
    }
  };

  /**
   * Clear and Template moved here from the top toolbar, but their modals
   * (ConfirmClearFloorplanModal, TemplateMenu) and the state driving them still
   * live in floorPlanMenu — which is a SIBLING in the tree, not an ancestor, so
   * props cannot reach it. A window event keeps ownership where it is instead
   * of duplicating the modals or hoisting their state.
   */
  const clearFloorplan = () =>
    window.dispatchEvent(new CustomEvent("pazl-floorplan-clear"));
  const openTemplates = () =>
    window.dispatchEvent(new CustomEvent("pazl-floorplan-templates"));

  // Units calls the engine directly — the same call floorPlanMenu made. Safe to
  // hold the display value here because the toolbar's copy is now hidden, so
  // there is only one units control on screen.
  const [unit, setUnit] = useState<string>("ft");
  const changeUnit = (v: string) => {
    setUnit(v);
    try {
      BlueprintInterface.setUnit(
        v === "mm" ? dimMilliMeter : v === "m" ? dimMeter : dimFeetAndInch
      );
    } catch (e) {
      console.error("FloorPlanTools: set unit failed", e);
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

  /** Collapsible section, chevron on the left like the reference design. */
  const Section = ({
    id,
    title,
    children,
  }: {
    id: string;
    title: string;
    children: React.ReactNode;
  }) => {
    const open = openSections.includes(id);
    return (
      <div className="border-b border-[color:var(--pz-panel-border)] last:border-b-0">
        <button
          type="button"
          onClick={() =>
            setOpenSections((s) =>
              s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
            )
          }
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        >
          <span
            className={`material-symbols-outlined text-[18px] text-[color:var(--pz-panel-muted)] transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            chevron_right
          </span>
          <span className="text-[13px] font-semibold text-[color:var(--pz-text)]">
            {title}
          </span>
        </button>
        {open ? <div className="px-3 pb-3">{children}</div> : null}
      </div>
    );
  };

  return (
    <div className="pz-fp-tools">
      <Section id="import" title="Import floor plan">
        <FloorPlanAiImport inline />
        <p className="mt-2 text-[11px] leading-snug text-[color:var(--pz-text-2)]">
          PDF, PNG, JPG or WEBP. Walls and rooms are read from the drawing.
        </p>

        <div className="mt-3 pt-3 border-t border-[color:var(--pz-panel-border)]">
          <SaveTemplateButton inline />
          {/* Spelled out because the button itself just says "Save", which sits
              a few centimetres from the project Save in the top bar. This one
              stores the plan as a reusable template — the Template card in
              "Draw room" is what loads them back. */}
          <p className="mt-2 text-[11px] leading-snug text-[color:var(--pz-text-2)]">
            Saves this plan as a reusable template, not as the project.
          </p>
        </div>
      </Section>

      <Section id="draw" title="Draw room">
        <div className="grid grid-cols-2 gap-2">
          <Card
            icon="edit"
            label="Draw"
            onClick={toggleDraw}
            isActive={active === "walls"}
          />
          {/* The "Select" card stood here. Removed: it was the mode you are
              already in - the 2D editor starts in MOVE - so it read as an
              action when it was really the resting state. Draw now toggles
              back to it, which is the only thing the card was used for. */}
          <Card icon="ink_eraser" label="Clear" onClick={clearFloorplan} />
          <Card icon="space_dashboard" label="Template" onClick={openTemplates} />
        </div>

        {/* Units is a dropdown, not an action, so it reads as a labelled field
            rather than a card. */}
        <label className="mt-3 block">
          <span className="block text-[11px] font-semibold text-[color:var(--pz-panel-muted)] mb-1">
            Units
          </span>
          <select
            value={unit}
            onChange={(e) => changeUnit(e.target.value)}
            className="w-full rounded-lg border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] text-[color:var(--pz-text)] text-[12px] px-2 py-1.5"
          >
            <option value="ft">Feet &amp; inches (ft)</option>
            <option value="mm">Millimetres (mm)</option>
            <option value="m">Metres (m)</option>
          </select>
        </label>
      </Section>

      <Section id="openings" title="Place doors and windows">
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

        {picker ? (
          <div className="mt-2 rounded-lg border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-input-bg)] p-1">
            <div className="text-[11px] font-semibold text-[color:var(--pz-panel-muted)] px-1 py-1">
              {picker === "door" ? "Choose a door" : "Choose a window"}
            </div>
            {(picker === "door" ? DOOR_OPTIONS : WINDOW_OPTIONS).map(
              (o: any) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() =>
                    picker === "door" ? placeDoor(o) : placeWindow(o)
                  }
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-[color:var(--pz-text)] hover:bg-[color:var(--pz-accent)]/10"
                >
                  <span className="material-symbols-outlined text-[18px] text-[color:var(--pz-accent)]">
                    {o.icon}
                  </span>
                  {o.label}
                </button>
              )
            )}
          </div>
        ) : null}
      </Section>

      <Section id="measure" title="Measurements">
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
      </Section>
    </div>
  );
};

export default FloorPlanTools;
