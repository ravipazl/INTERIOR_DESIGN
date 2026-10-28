import React, { useEffect, useState } from "react";
import "material-symbols";
import { planImage } from "@pazl/main/import/placeImport";
import { LENGTH_UNITS, defaultLengthUnit, isFeet, lengthToCm } from "./lengths";

/**
 * THE STEP FOR SETTING A PICTURE'S SCALE, in the Import section: click both
 * ends of a wall whose length is known, type it, apply. It shows only while
 * that step is on. The background itself has no controls here — a plan built
 * from a drawing has none behind it, and a traced picture is scaled and then
 * left as it is.
 *
 * Everything shown is read from the background itself (PlanImage2D), so the
 * panel can close and reopen, or the page reload, without losing anything.
 */

const btn =
  "flex items-center justify-center gap-1.5 rounded-md border border-[color:var(--pz-panel-border)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--pz-text)] hover:bg-[color:var(--pz-panel-hover)]";
const label = "text-[11px] text-[color:var(--pz-text)]";
const hint = "text-[11px] leading-snug text-[color:var(--pz-text-2)]";

const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined text-[17px] ${className}`}>{name}</span>
);

/** Re-render when the background changes, from the canvas, undo or a reload. */
export const usePlanImage = () => {
  const [, rerender] = useState(0);
  useEffect(() => {
    let off: (() => void) | null = null;
    let timer: number | null = null;
    const attach = () => {
      const pi = planImage();
      if (!pi) return false;
      off = pi.subscribe(() => rerender((n) => n + 1));
      rerender((n) => n + 1);
      return true;
    };
    if (!attach()) {
      // The 2D view is built after the panel.
      timer = window.setInterval(() => {
        if (attach() && timer !== null) window.clearInterval(timer);
      }, 500);
    }
    return () => {
      if (timer !== null) window.clearInterval(timer);
      if (off) off();
    };
  }, []);
  return planImage();
};

const PlanBackgroundControls: React.FC = () => {
  const pi = usePlanImage();
  const [error, setError] = useState<string | null>(null);
  const [length, setLength] = useState("");
  const [unit, setUnit] = useState<string>(defaultLengthUnit);

  const sheet = pi?.sheet || null;
  if (!sheet) return null;
  const tool: string | null = pi.tool || null;

  // ── scale, on the plan ──
  if (tool === "scale") {
    const picked = pi.points.length;
    const realCm = lengthToCm(length, unit);
    const apply = () => {
      if (picked < 2) return;
      if (!realCm) {
        setError(isFeet(unit) ? `Type the wall's real length, for example 11' 6".` : "Type the wall's real length, for example 3504.");
        return;
      }
      setError(null);
      pi.applyScale(realCm);
      setLength("");
    };
    return (
      <div className="w-full rounded-lg border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-input-bg)] p-2">
        <div className="text-[12px] font-semibold text-[color:var(--pz-text)]">Set scale</div>
        <p className={`${hint} mt-0.5`}>
          {picked < 2 ? "Click both ends of a wall on the background whose length you know." : "Type that wall's real length."}
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {["First point", "Second point"].map((name, i) => (
            <div key={name} className={`flex items-center justify-between ${label}`}>
              <span>{name}</span>
              <Icon
                name={picked > i ? "check_circle" : "radio_button_unchecked"}
                className={picked > i ? "text-green-600 dark:text-green-400" : "text-[color:var(--pz-panel-muted)]"}
              />
            </div>
          ))}
        </div>
        {picked >= 2 ? (
          <div className="mt-2 flex gap-1.5">
            <input
              autoFocus
              inputMode="decimal"
              value={length}
              onChange={(e) => {
                setLength(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder={isFeet(unit) ? `11' 6"` : "3504"}
              aria-label="Real length"
              className="min-w-0 flex-1 rounded-md border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] text-[color:var(--pz-text)] text-[12px] px-2 py-1"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              aria-label="Unit"
              className="rounded-md border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] text-[color:var(--pz-text)] text-[12px] px-1 py-1"
            >
              {LENGTH_UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {error ? <p className="mt-1 text-[11px] leading-snug text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setError(null);
              pi.cancelTool();
            }}
            className={btn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-medium text-white bg-[color:var(--pz-accent)] hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>
    );
  }


  // Once the scale is set there is nothing more to show: the background is
  // not something to adjust, fade, lock or take away from here.
  return null;
};

export default PlanBackgroundControls;

