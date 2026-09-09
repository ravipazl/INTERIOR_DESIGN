import React, { useCallback, useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";

/**
 * SnapControlPanel — Snap Engine, Phase 3 (toolbar UI)
 *
 * A self-contained floating widget for controlling the snap engine without
 * the DevTools console. It proxies to the SnapManager via BlueprintInterface:
 *   - master "Snapping" on/off          → setSnapActive
 *   - per-source toggles                → setSnapEnabled(kind, bool)
 *   - wall gap calibration              → setSnapWallOffset(cm)
 *
 * The SnapManager is created asynchronously (after the 3D scene loads), so
 * the panel polls for it on mount, reads its live state, and renders only
 * once it is available. All styling is inline so the widget is robust
 * regardless of Tailwind's purge configuration.
 */

interface SnapKindDef {
  key: string;
  label: string;
  color: string;
  hint: string;
}

// Colours mirror SnapIndicator.KIND_COLOR so the toolbar swatch matches the
// guide line the user sees in the 3D scene.
const SNAP_KINDS: SnapKindDef[] = [
  { key: "wall", label: "Wall", color: "#21b35a", hint: "Flush against a wall" },
  {
    key: "corner",
    label: "Corner",
    color: "#ff9800",
    hint: "Into the inside corner of two walls",
  },
  {
    key: "objectEdge",
    label: "Object edge",
    color: "#1e88e5",
    hint: "Edge-to-edge with other furniture",
  },
  {
    key: "objectCenter",
    label: "Object centre",
    color: "#8e24aa",
    hint: "Centre-aligned with other furniture",
  },
  {
    key: "surface",
    label: "Surface (stack)",
    color: "#00897b",
    hint: "Rest an item on top of another (pot on a table)",
  },
  {
    key: "grid",
    label: "Grid",
    color: "#9e9e9e",
    hint: "Round position to a fixed grid",
  },
];

// --- small inline toggle switch -------------------------------------------
const Switch: React.FC<{
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
}> = ({ on, disabled, onChange }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onChange}
    style={{
      width: 34,
      height: 18,
      borderRadius: 9,
      border: "none",
      padding: 0,
      cursor: disabled ? "not-allowed" : "pointer",
      background: on ? "#2563eb" : "#9ca3af",
      opacity: disabled ? 0.4 : 1,
      position: "relative",
      transition: "background 0.15s",
      flexShrink: 0,
    }}
    aria-pressed={on}
  >
    <span
      style={{
        position: "absolute",
        top: 2,
        left: on ? 18 : 2,
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: "#fff",
        transition: "left 0.15s",
      }}
    />
  </button>
);

const SnapControlPanel: React.FC = () => {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  // Snap starts ON, matching SnapManager's default. This is only the value
  // shown before the manager is found; the poll below replaces it with the
  // manager's real state, and the panel does not render until then.
  const [active, setActive] = useState(true);
  // The per-source `enabled` map and the wall-gap value are both gone from
  // this panel: one switch is the whole control surface now. The engine still
  // owns both (config.enabled, config.wallExtraOffset).

  // Poll for the SnapManager — it is created after the scene loads.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tryLoad = (): boolean => {
      const mgr = BlueprintInterface.getSnapManager?.();
      if (!mgr) return false;
      setActive(mgr.active !== false);
      setReady(true);
      return true;
    };
    if (!tryLoad()) {
      timer = setInterval(() => {
        if (tryLoad() && timer) clearInterval(timer);
      }, 600);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  const toggleActive = useCallback(() => {
    setActive((prev) => {
      const next = !prev;
      BlueprintInterface.setSnapActive?.(next);
      return next;
    });
  }, []);

  // toggleKind and changeWallOffset lived here. Their only callers were the
  // per-source toggles and the wall-gap slider; the engine still exposes
  // setSnapEnabled(kind, bool) and setSnapWallOffset(cm) if either is needed.

  if (!ready) return null;

  // --- collapsed pill ------------------------------------------------------
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Snap settings"
        style={{
          position: "fixed",
          // offset past the nav rail; fixed elements ignore it otherwise
          left: "calc(var(--pz-nav-w, 0px) + 16px)",
          bottom: 16,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 20,
          border: "none",
          background: "#ffffff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "#222",
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: active ? "#21b35a" : "#9ca3af",
          }}
        />
        Snap
      </button>
    );
  }

  // --- expanded panel ------------------------------------------------------
  return (
    <div
      style={{
        position: "fixed",
        // offset past the nav rail; fixed elements ignore it otherwise
        left: "calc(var(--pz-nav-w, 0px) + 16px)",
        bottom: 16,
        zIndex: 50,
        width: 246,
        background: "#ffffff",
        borderRadius: 10,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        fontFamily: "inherit",
        color: "#222",
        overflow: "hidden",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "#f3f4f6",
          // No borderBottom: with the toggles, wall gap and footer all gone,
          // the header IS the panel, and a divider under the last row drew a
          // line along the bottom edge with nothing beneath it.
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>Snapping</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Switch on={active} onChange={toggleActive} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Collapse"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              color: "#666",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Two blocks stood here and both are gone, leaving the master switch as
          the entire control surface.

          The six per-source toggles asked the architect to reason about snap
          SOURCES, which is engine vocabulary, not design vocabulary. The Wall
          gap slider set how far an item rests from a wall — one correct value
          for a given wall thickness, so a calibration rather than a choice.

          Nothing was removed from the engine: SNAP_KINDS is still declared
          above, and setSnapEnabled(kind, bool) / setSnapWallOffset(cm) still
          work from the console or from an "Advanced" disclosure if one is ever
          wanted back. */}

      {/* The footer hint stood here — it described what snapping does and
          mentioned the Shift bypass. Removed: the panel is one labelled switch
          now, and a paragraph of explanation under it was more panel than the
          control needed. Shift-to-bypass is still live (DragRoomItemsControl3D
          tracks __shiftHeld and SnapManager.query returns null for it) but is
          no longer surfaced anywhere in the UI — it is not in the keyboard
          shortcuts panel either. Worth adding there if it should stay
          discoverable. */}
    </div>
  );
};

export default SnapControlPanel;
