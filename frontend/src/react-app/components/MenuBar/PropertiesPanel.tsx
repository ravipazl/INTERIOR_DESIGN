import React from "react";
import WallElements from "./wallElements";
import OpeningFields from "./OpeningFields";
import { MENU_TABS } from ".";
import BlueprintInterface from "@pazl/blueprint-interface";

export type SelKind = "wall" | "corner" | "room" | "opening" | null;

// Preset wall thicknesses (in cm) for the Wall-type quick selector.
const WALL_TYPE_CM = { structural: 20, partition: 10 };

// Pick which dropdown option matches the wall's current thickness (cm).
const wallTypeOf = (thicknessCm?: number): string => {
  if (typeof thicknessCm !== "number") return "custom";
  if (thicknessCm >= 16) return "structural";
  if (thicknessCm <= 12) return "partition";
  return "custom";
};

// Maps the current selection to the WallElements field-set key + a title.
const CONFIG: Record<string, { key: string; title: string }> = {
  wall: { key: "wall_properties", title: "Wall" },
  corner: { key: "wall_corner_properties", title: "Corner" },
  room: { key: "room_properties", title: "Room" },
};

/**
 * Unified properties panel — one docked panel that shows the properties of
 * whatever is selected (wall / corner / room), replacing the three separate
 * draggable boxes. Reuses the existing WallElements field renderer, so the
 * fields and behaviour are unchanged; only the container is unified.
 */
const PropertiesPanel = ({
  kind,
  item2D,
  unitMetric,
  onClose,
}: {
  kind: SelKind;
  item2D: any;
  unitMetric: string;
  onClose: () => void;
}) => {
  // No right-edge space is reserved any more: this panel is fixed to the right
  // edge and OVERLAYS the canvas. Reserving space made the 3D canvas shrink and
  // re-project its camera every time a panel opened or closed — see the comment
  // in pages/DrawingComponent/index.tsx. (`showing`, which existed only to feed
  // that reservation, went with it — the early returns below already gate
  // rendering.)
  if (!kind || !item2D) return null;
  const isOpening = kind === "opening";
  const cfg = CONFIG[kind];
  if (!isOpening && !cfg) return null;
  const title = isOpening
    ? item2D?.metadata?.itemName ||
      item2D?.__metadata?.itemName ||
      "Opening"
    : kind === "room"
    ? item2D?.name || "Room"
    : cfg.title;

  // Quick wall-type selector: sets a preset thickness (structural = thick,
  // partition = thin). Uses the existing setWallThickness path, so 2D + 3D
  // redraw exactly as a manual thickness edit would.
  const applyWallType = (type: string) => {
    const cm = (WALL_TYPE_CM as any)[type];
    if (cm == null) return; // "custom" → leave thickness as-is
    try {
      (BlueprintInterface as any).setWallThickness?.(cm);
    } catch (e) {
      console.error("apply wall type failed", e);
    }
  };

  return (
    <div className="pz-animate-in absolute top-36 right-3 z-10 w-64 max-h-[70vh] overflow-auto rounded-md bg-[color:var(--pz-panel-surface)] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between px-3 py-2 bg-[color:var(--pz-panel-header)] border-b border-[color:var(--pz-panel-border)]">
        <span className="font-semibold text-black dark:text-white text-sm truncate">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none text-lg ml-2"
          title="Close"
        >
          ×
        </button>
      </div>
      {isOpening ? (
        <OpeningFields item={item2D} onClose={onClose} />
      ) : (
        <WallElements
          item={cfg.key}
          menuName={MENU_TABS.FLOOR_PLAN}
          item2D={item2D}
          unitMetric={unitMetric}
          onClose={onClose}
        />
      )}
      {kind === "wall" && (
        <div className="px-3 py-2 border-t border-[color:var(--pz-panel-border)]">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
            Wall type
          </label>
          <select
            className="w-full h-8 px-2 text-sm rounded border border-[color:var(--pz-panel-border)] bg-white dark:bg-[#4E4E4E] dark:text-white focus:outline-none"
            defaultValue={wallTypeOf(item2D?.thickness)}
            onChange={(e) => applyWallType(e.target.value)}
          >
            <option value="custom">Custom</option>
            <option value="structural">Structural (thick)</option>
            <option value="partition">Partition (thin)</option>
          </select>
        </div>
      )}
    </div>
  );
};

export default PropertiesPanel;
