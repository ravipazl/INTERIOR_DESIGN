import React, { useEffect, useState } from "react";
import "material-symbols";
import "./panels.css";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { handleDrawFreeShape } from "@pazl/viewer2d-state-interface";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import {
  dimFeetAndInch,
  dimMeter,
  dimMilliMeter,
} from "@pazl/main/core/constants.js";
import { useDisplayUnit } from "@pazl/utils/unitsUtils.js";
import FloorPlanAiImport from "./FloorPlanAiImport";
import FloorPlanStandardImport from "./FloorPlanImport/FloorPlanStandardImport";
import SaveTemplateButton from "./SaveTemplateButton";
import KitchenPlanner2D from "./KitchenPlanner2D";
import BedroomPlanner from "./BedroomPlanner";
import RoomFurnishPlanner from "./RoomFurnishPlanner";

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

const Card = ({
  icon,
  label,
  onClick,
  isActive,
  tone = "indigo",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  /** Its colour (MenuBar/panels.css), matching the toolbar's groups. */
  tone?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={isActive}
    data-tone={tone}
    className={`pz-pcard${isActive ? " is-on" : ""}`}
  >
    <span className="pz-pcard-tile">
      <span className="material-symbols-outlined pz-pcard-ic">{icon}</span>
    </span>
    <span className="pz-pcard-label">{label}</span>
  </button>
);

/** Collapsible section, chevron on the left like the reference design. */
const PanelSection = ({
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <div className={`pz-ps${open ? " is-open" : ""}`}>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="pz-ps-head"
    >
      <span className="material-symbols-outlined pz-ps-chev">chevron_right</span>
      <span className="pz-ps-title">{title}</span>
    </button>
    {open ? <div className="pz-ps-body">{children}</div> : null}
  </div>
);

// Which sections are expanded, kept across a remount of the panel (it is
// rebuilt when the page reloads its data), so an open section stays open.
// Import starts CLOSED — it is a one-off at the start of a project, whereas
// Draw room is used constantly.
let lastOpenSections: string[] = ["draw", "openings"];

const FloorPlanTools: React.FC = () => {
  const [active, setActive] = useState<string>("");
  const [openSections, setOpenSections] =
    useState<string[]>(lastOpenSections);
  // Overall-dimensions overlay mode. "outer" = footprint (W×H outside the plan),
  // "inner" = show ALL per-wall labels at once. Mutually exclusive; both sit on
  // top of the always-on individual show-on-select behaviour.
  const [dimMode, setDimMode] = useState<"off" | "inner" | "outer">("off");

  // An import turns the measurements on (a length on every wall, as a plan
  // from another tool shows them) and tells this panel, so its cards agree.
  useEffect(() => {
    const onMode = (e: Event) => {
      const m = (e as CustomEvent).detail;
      if (m === "inner" || m === "outer" || m === "off") setDimMode(m);
    };
    window.addEventListener("pazl-dim-mode", onMode);
    return () => window.removeEventListener("pazl-dim-mode", onMode);
  }, []);

  // The floor's INTERIOR AREA: the rooms' areas added together, in m². Read
  // from the plan while the panel is open, so it follows every edit.
  const [interiorArea, setInteriorArea] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const rooms = (BlueprintInterface as any)?.blueprint3d?.model?.floorplan?.getRooms?.() || [];
        let total = 0;
        rooms.forEach((r: any) => {
          const c = r?.interiorCorners || [];
          let a = 0;
          for (let i = 0; i < c.length; i++) {
            const p = c[i];
            const q = c[(i + 1) % c.length];
            a += p.x * q.y - q.x * p.y;
          }
          total += Math.abs(a / 2);
        });
        const m2 = Math.round(total / 100) / 100; // cm² → m², two places
        setInteriorArea((cur) => (cur === m2 ? cur : m2));
      } catch (e) {
        /* the readout is a convenience; leave it as it was */
      }
    };
    read();
    const t = window.setInterval(read, 1000);
    return () => window.clearInterval(t);
  }, []);

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
  // "mm" to match the engine's default (core/configuration.js). If this said
  // "ft" while the engine measured in mm, the dropdown would claim feet over a
  // plan labelled in millimetres until someone touched it.
  const unit = useDisplayUnit();
  const changeUnit = (v: string) => {
    try {
      BlueprintInterface.setUnit(v);
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

  // open/toggle for a PanelSection. PanelSection and Card are defined OUTSIDE
  // this component: a component defined inside is a NEW type on every render,
  // so React threw away and rebuilt everything in it — including AI Import's
  // file box while the file dialog was open, which lost the chosen file.
  const sectionProps = (id: string) => ({
    id,
    open: openSections.includes(id),
    onToggle: () =>
      setOpenSections((s) => {
        const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
        lastOpenSections = next;
        return next;
      }),
  });

  return (
    <div className="pz-fp-tools">
      <PanelSection title="Import floor plan" {...sectionProps("import")}>
        <FloorPlanAiImport inline />
        <p className="pz-ps-hint">
          PDF, PNG, JPG or WEBP. Walls and rooms are read from the drawing.
        </p>

        {/* The standard import, without AI: CAD files read exactly, PDFs and
            images as a background at real size. */}
        <div className="mt-3 pt-3 border-t border-[color:var(--pz-panel-border)]">
          <FloorPlanStandardImport />
        </div>

        <div className="mt-3 pt-3 border-t border-[color:var(--pz-panel-border)]">
          <SaveTemplateButton inline />
          {/* Spelled out because the button itself just says "Save", which sits
              a few centimetres from the project Save in the top bar. This one
              stores the plan as a reusable template — the Template card in
              "Draw room" is what loads them back. */}
          <p className="pz-ps-hint">
            Saves this plan as a reusable template, not as the project.
          </p>
        </div>
      </PanelSection>

      <PanelSection title="Draw room" {...sectionProps("draw")}>
        <div className="pz-pgrid">
          <Card
            icon="edit"
            label="Draw"
            tone="indigo"
            onClick={toggleDraw}
            isActive={active === "walls"}
          />
          {/* The "Select" card stood here. Removed: it was the mode you are
              already in - the 2D editor starts in MOVE - so it read as an
              action when it was really the resting state. Draw now toggles
              back to it, which is the only thing the card was used for. */}
          <Card icon="ink_eraser" label="Clear" tone="red" onClick={clearFloorplan} />
          <Card icon="space_dashboard" label="Template" tone="blue" onClick={openTemplates} />
        </div>

        {/* Units is a dropdown, not an action, so it reads as a labelled field
            rather than a card. */}
        <label className="pz-pfield">
          <span className="pz-pfield-label">Units</span>
          <select
            value={unit}
            onChange={(e) => changeUnit(e.target.value)}
            className="pz-pselect"
          >
            <option value={dimMilliMeter}>Millimetres (mm)</option>
            <option value={dimMeter}>Metres (m)</option>
            <option value={dimFeetAndInch}>Feet &amp; inches (ft)</option>
          </select>
        </label>
      </PanelSection>

      <PanelSection title="Place doors and windows" {...sectionProps("openings")}>
        <div className="pz-pgrid">
          <Card
            icon="door_front"
            label="Door"
            tone="amber"
            onClick={() => setPicker(picker === "door" ? null : "door")}
            isActive={picker === "door"}
          />
          <Card
            icon="window"
            label="Window"
            tone="cyan"
            onClick={() => setPicker(picker === "window" ? null : "window")}
            isActive={picker === "window"}
          />
        </div>

        {picker ? (
          <div className="pz-ppick">
            <div className="pz-ppick-title">
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
                  className="pz-ppick-item"
                  data-tone={picker === "door" ? "amber" : "cyan"}
                >
                  <span className="material-symbols-outlined pz-ppick-ic">
                    {o.icon}
                  </span>
                  {o.label}
                </button>
              )
            )}
          </div>
        ) : null}
      </PanelSection>

      {/* Auto-furnish a kitchen straight from the plan: pick a layout, click
          the walls, see the cabinets previewed, place them. */}
      <PanelSection title="Kitchen" {...sectionProps("kitchen")}>
        <KitchenPlanner2D />
      </PanelSection>

      {/* The same for a bedroom: click the bed wall, see it previewed, place. */}
      <PanelSection title="Bedroom" {...sectionProps("bedroom")}>
        <BedroomPlanner mode="2d" />
      </PanelSection>

      {/* And a living room: click the TV wall, see it previewed, place. */}
      <PanelSection title="Living Room" {...sectionProps("living")}>
        <RoomFurnishPlanner kind="living" mode="2d" />
      </PanelSection>

      <PanelSection title="Measurements" {...sectionProps("measure")}>
        <div className="pz-pgrid">
          <Card
            icon="crop_free"
            label="Outer"
            tone="teal"
            onClick={() => setDims("outer")}
            isActive={dimMode === "outer"}
          />
          <Card
            icon="straighten"
            label="Inner"
            tone="green"
            onClick={() => setDims("inner")}
            isActive={dimMode === "inner"}
          />
        </div>
        {interiorArea !== null && interiorArea > 0 ? (
          <div className="pz-pstat">
            <span>Interior area</span>
            <strong>{interiorArea.toFixed(2)} m²</strong>
          </div>
        ) : null}
      </PanelSection>
    </div>
  );
};

export default FloorPlanTools;
