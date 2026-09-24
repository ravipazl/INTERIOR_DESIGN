import React, { useMemo, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface";
import {
  planKitchen,
  applyPlan,
  selectedRoom3D,
  kitchenTemplate,
} from "@pazl/react-app/roomTemplates/applyRoomTemplate";

/**
 * Auto-furnish — pick a preset, see what it will do, place it.
 *
 * The preview is drawn from the SAME plan the placing uses, so it can't
 * disagree with the result. Phase 1: Kitchen, straight run.
 */

const LABELS: Record<string, string> = {
  tall: "Tall unit",
  sink: "Sink unit",
  drawer: "Drawers",
  shutter: "Shutter unit",
  pullout: "Oil pull-out",
  wallUnit: "Wall unit",
};

const COLOURS: Record<string, string> = {
  tall: "#AFA9EC",
  sink: "#CECBF6",
  drawer: "#EEEDFE",
  shutter: "#F3F2FD",
  pullout: "#F5C4B3",
  wallUnit: "#B5D4F4",
};

const RoomTemplatePanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [presetId, setPresetId] = useState("straight");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState("");
  // Re-read the room each time the panel re-renders: the user may select
  // another room while this is open.
  const [tick, setTick] = useState(0);

  const room: any = selectedRoom3D();
  const planned: any = useMemo(
    () => (room ? planKitchen(room, presetId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, presetId, tick]
  );

  const slots = planned && planned.plan ? planned.plan.slots : [];
  const floorSlots = slots.filter((s: any) => s.level === "floor");
  const wallSlots = slots.filter((s: any) => s.level === "wall");
  const runFrom = planned?.plan?.runFromCm ?? 0;
  const runTo = planned?.plan?.runToCm ?? 0;
  const runLen = Math.max(1, runTo - runFrom);

  const place = async () => {
    if (!room || !planned || busy) return;
    setBusy(true);
    setResult("");
    try {
      const out: any = await applyPlan(room, planned, (done: number, total: number, kind: string) =>
        setProgress(`Placing ${done} of ${total} — ${LABELS[kind] || kind}`)
      );
      setResult(
        `${out.placed} placed` + (out.failed ? ` · ${out.failed} could not be placed` : "")
      );
      // The plan is against the empty room; after placing, re-read it.
      setTick((t) => t + 1);
      try {
        (BlueprintInterface as any).ProjectManagerService?.updateFloorPlan?.(
          "Floor item added"
        );
      } catch (e) {
        /* saving is best-effort here; each item already saved itself */
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const bar = (s: any, top: number, height: number) => {
    const x = ((s.startCm - runFrom) / runLen) * 100;
    const w = ((s.endCm - s.startCm) / runLen) * 100;
    return (
      <div
        key={`${s.level}-${s.startCm}`}
        title={`${LABELS[s.kind] || s.kind} ${s.widthMm} mm`}
        style={{
          position: "absolute",
          left: `${x}%`,
          width: `${w}%`,
          top,
          height,
          background: COLOURS[s.kind] || "#eee",
          border: "1px solid var(--pz-panel-border)",
          borderRadius: 3,
          fontSize: 9,
          color: "#26215C",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {w > 12 ? s.widthMm : ""}
      </div>
    );
  };

  return (
    <div className="p-3 text-sm text-[color:var(--pz-text)]">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">Auto-furnish</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[color:var(--pz-text-2)] hover:text-[color:var(--pz-text)]"
          title="Close"
        >
          ×
        </button>
      </div>

      {!room ? (
        <p className="text-[12px] text-[color:var(--pz-text-2)] leading-snug">
          Select the room first — click its floor in the 3D view.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-[color:var(--pz-text-2)] mb-2">
            Room: <b>{room.name || "unnamed"}</b>
          </p>

          {kitchenTemplate.presets.map((p: any) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPresetId(p.id)}
              className={`w-full text-left mb-2 rounded-lg border px-2.5 py-2 ${
                presetId === p.id
                  ? "border-[color:var(--pz-accent)] bg-[color:var(--pz-accent-soft)]"
                  : "border-[color:var(--pz-panel-border)]"
              }`}
            >
              <div className="text-[13px] font-medium">{p.name}</div>
              <div className="text-[11px] text-[color:var(--pz-text-2)] leading-snug">
                {p.summary}
              </div>
            </button>
          ))}

          {planned?.error || !slots.length ? (
            <p className="text-[12px] text-red-600 leading-snug">
              {planned?.error ||
                (planned?.plan?.reason === "no wall long enough"
                  ? "No wall in this room is long enough for a kitchen run (1.5 m minimum)."
                  : "Nothing to place — check the kitchen categories exist.")}
            </p>
          ) : (
            <>
              {/* The preview, drawn from the plan itself. */}
              <div
                style={{ position: "relative", height: 64 }}
                className="rounded-md bg-[color:var(--pz-input-bg)] border border-[color:var(--pz-panel-border)] mb-1"
              >
                {wallSlots.map((s: any) => bar(s, 4, 20))}
                {floorSlots.map((s: any) => bar(s, 32, 28))}
              </div>
              <p className="text-[11px] text-[color:var(--pz-text-2)] mb-2">
                {Math.round(runLen)} cm run · {floorSlots.length} base ·{" "}
                {wallSlots.length} wall units
              </p>

              {planned.missing?.length ? (
                <p className="text-[11px] text-amber-600 mb-2 leading-snug">
                  No models found for: {planned.missing.map((m: string) => LABELS[m] || m).join(", ")}
                </p>
              ) : null}

              <button
                type="button"
                onClick={place}
                disabled={busy}
                className={`w-full rounded-md px-3 py-1.5 text-[13px] text-white ${
                  busy
                    ? "bg-neutral-400 cursor-not-allowed"
                    : "bg-[color:var(--pz-accent)] hover:opacity-90"
                }`}
              >
                {busy ? progress || "Placing…" : `Place ${slots.length} modules`}
              </button>
            </>
          )}

          {result ? (
            <p className="mt-2 text-[12px] text-green-600 dark:text-green-400">{result}</p>
          ) : null}
        </>
      )}
    </div>
  );
};

export default RoomTemplatePanel;
