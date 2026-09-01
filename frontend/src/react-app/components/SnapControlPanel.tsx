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
  // Snap starts OFF so dragging is smooth/free by default (matches SnapEngine).
  const [active, setActive] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [wallOffset, setWallOffset] = useState(10);

  // Poll for the SnapManager — it is created after the scene loads.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tryLoad = (): boolean => {
      const mgr = BlueprintInterface.getSnapManager?.();
      if (!mgr) return false;
      setActive(mgr.active !== false);
      setEnabled({ ...(mgr.config?.enabled || {}) });
      setWallOffset(mgr.config?.wallExtraOffset ?? 10);
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

  const toggleKind = useCallback((kind: string) => {
    setEnabled((prev) => {
      const next = !prev[kind];
      BlueprintInterface.setSnapEnabled?.(kind, next);
      return { ...prev, [kind]: next };
    });
  }, []);

  const changeWallOffset = useCallback((value: number) => {
    setWallOffset(value);
    BlueprintInterface.setSnapWallOffset?.(value);
  }, []);

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
          left: 16,
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
        left: 16,
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
          borderBottom: "1px solid #e5e7eb",
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

      {/* per-source toggles */}
      <div style={{ padding: "6px 12px 8px" }}>
        {SNAP_KINDS.map((k) => (
          <div
            key={k.key}
            title={k.hint}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 0",
              opacity: active ? 1 : 0.45,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: k.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12.5 }}>{k.label}</span>
            </div>
            <Switch
              on={!!enabled[k.key]}
              disabled={!active}
              onChange={() => toggleKind(k.key)}
            />
          </div>
        ))}
      </div>

      {/* wall gap calibration */}
      <div
        style={{
          padding: "8px 12px 10px",
          borderTop: "1px solid #e5e7eb",
          opacity: active && enabled.wall ? 1 : 0.45,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            marginBottom: 4,
          }}
        >
          <span>Wall gap</span>
          <span style={{ fontWeight: 600 }}>{wallOffset} cm</span>
        </div>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={wallOffset}
          disabled={!active || !enabled.wall}
          onChange={(e) => changeWallOffset(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* footer hint */}
      <div
        style={{
          padding: "7px 12px",
          background: "#f3f4f6",
          borderTop: "1px solid #e5e7eb",
          fontSize: 11,
          color: "#666",
        }}
      >
        Hold <b>Shift</b> while dragging to bypass snapping.
      </div>
    </div>
  );
};

export default SnapControlPanel;
