import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import { describeRoom, selectedRoom3D } from "@pazl/react-app/roomTemplates/applyRoomTemplate";
import { planBedroomRoom, applyFurnishPlan } from "@pazl/react-app/roomTemplates/applyBedroomTemplate";
import { planLivingRoom } from "@pazl/react-app/roomTemplates/applyLivingTemplate";
import { rectCorners } from "@pazl/react-app/roomTemplates/furnishGeometry";

/**
 * Auto-furnish a bedroom or a living room from the floor plan.
 *
 * mode "2d" (Floor plan tab): click any wall of the room — that wall becomes
 * the room's main wall (the bed's head, or the TV), and the plan is previewed
 * on the floor plan as you go. "Let it choose" keeps the room and picks the
 * wall itself. mode "3d": the room selected in 3D, the wall chosen for you.
 *
 * The main items are always placed; the extras can be switched off. "Try
 * another design" steps through other layouts and models that still keep every
 * walkway and clearance; "Back" returns to exactly the one before. The preview
 * is drawn from the very plan that is placed.
 */

type Kind = "bedroom" | "living";

interface StyleChoice {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

const ROOMS: Record<
  Kind,
  {
    start: string;
    stop: string;
    pickHint: string;
    wallWord: string; // "bed" / "TV" — "bed on wall 2"
    wallChoiceKey: string; // the plan's choice key for the picked wall
    wallResultKey: string; // the plan's answer key for the wall it used
    extras: { key: string; label: string }[];
    styles: StyleChoice[];
    plan: (room: any, choice: any) => any;
  }
> = {
  bedroom: {
    start: "Furnish a bedroom",
    stop: "Stop furnishing a bedroom",
    pickHint: "Click the wall the bed's head should go against.",
    wallWord: "bed",
    wallChoiceKey: "bedWallIndex",
    wallResultKey: "bedWallIndex",
    extras: [
      { key: "sideTable", label: "Side tables" },
      { key: "tableLamp", label: "Table lamps" },
      { key: "mirror", label: "Mirror" },
      { key: "ac", label: "AC" },
      { key: "carpet", label: "Carpet" },
      { key: "light", label: "Ceiling light" },
    ],
    styles: [
      {
        key: "wardrobeStyle",
        label: "Wardrobe",
        options: [
          { value: "basic", label: "Basic handles" },
          { value: "fluted", label: "Fluted glass · profile handles" },
        ],
      },
    ],
    plan: planBedroomRoom,
  },
  living: {
    start: "Furnish a living room",
    stop: "Stop furnishing a living room",
    pickHint: "Click the wall the TV should go on.",
    wallWord: "TV",
    wallChoiceKey: "tvWallIndex",
    wallResultKey: "tvWallIndex",
    extras: [
      { key: "tv", label: "TV" },
      { key: "centerTable", label: "Center table" },
      { key: "armchair", label: "Armchair" },
      { key: "carpet", label: "Carpet" },
      { key: "sideTable", label: "Side table" },
      { key: "tableLamp", label: "Table lamp" },
      { key: "floorLamp", label: "Floor lamp" },
      { key: "plant", label: "Plant" },
      { key: "wallArt", label: "Wall art" },
      { key: "bookshelf", label: "Bookshelf" },
      { key: "ac", label: "AC" },
      { key: "light", label: "Ceiling light" },
    ],
    styles: [
      {
        key: "tvUnitStyle",
        label: "TV unit",
        options: [
          { value: "basic", label: "Basic handles" },
          { value: "groove", label: "Finger groove" },
        ],
      },
      {
        key: "panelStyle",
        label: "Back panel",
        options: [
          { value: "plain", label: "Plain" },
          { value: "groove", label: "Groove" },
        ],
      },
    ],
    plan: planLivingRoom,
  },
};

const COLOURS: Record<string, number> = {
  cot: 0xc9b8f0,
  wardrobe: 0x8fc1e3,
  mirror: 0x5ad1c4,
  tvPanel: 0xc9b8f0,
  tvUnit: 0x7f77dd,
  tv: 0x26215c,
  cladding: 0xb08850,
  sofa: 0x8fc1e3,
  centerTable: 0xf5d48a,
  armchair: 0x5ab0e0,
  sideTable: 0xf5d48a,
  tableLamp: 0xf08a5d,
  floorLamp: 0xf08a5d,
  plant: 0x3a9a4a,
  wallArt: 0xe0a0c0,
  bookshelf: 0xa0785a,
  ac: 0xe05a7a,
  carpet: 0x9cc98a,
};

const RoomFurnishPlanner: React.FC<{ kind: Kind; mode: "2d" | "3d" }> = ({ kind, mode }) => {
  const config = ROOMS[kind];
  const [active, setActive] = useState(false); // 2D: picking walls
  const [room2D, setRoom2D] = useState<any>(null);
  const [mainWall, setMainWall] = useState<number | null>(null);
  const [extras, setExtras] = useState<Record<string, boolean>>(
    Object.fromEntries(config.extras.map((e) => [e.key, true]))
  );
  // Design 1 is the plain best answer; each "Try another design" is the next
  // number, and the same number always gives the same design.
  const [design, setDesign] = useState(0);
  const [styles, setStyles] = useState<Record<string, string>>(
    Object.fromEntries(config.styles.map((s) => [s.key, s.options[0].value]))
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);

  const room: any = mode === "3d" ? selectedRoom3D() : room2D;
  const roomRef = useRef<any>(null);
  roomRef.current = room2D;

  // 2D: a wall click picks the room (first click) and its main wall.
  useEffect(() => {
    if (mode !== "2d" || !active) return;
    const BI = BlueprintInterface as any;
    // Wall clicks belong to the picker while it is on (Wall properties stays shut).
    BI.__kitchenPicking = true;
    const stop = BI.onWall2DClicked?.((wall: any) => {
      if (!wall) return;
      const attached = ((wall.attachedRooms as any[]) || []).filter(Boolean);
      const focusId = BI.__roomFocusId;
      const current = roomRef.current;
      const theRoom =
        (current && attached.includes(current) && current) ||
        (focusId && attached.find((r: any) => r && r.roomByCornersId === focusId)) ||
        attached[0] ||
        null;
      if (!theRoom) {
        setNote("This wall isn't part of a room yet.");
        return;
      }
      const desc: any = describeRoom(theRoom);
      const index = desc ? desc.walls.findIndex((w: any) => w.edge && w.edge.wall === wall) : -1;
      if (index < 0) {
        setNote("That wall isn't one of this room's walls.");
        return;
      }
      setNote("");
      setRoom2D(theRoom);
      setMainWall(index);
      setResult("");
    });
    return () => {
      BI.__kitchenPicking = false;
      if (stop) stop();
    };
  }, [mode, active]);

  const planned: any = useMemo(() => {
    if (!room) return null;
    return config.plan(room, {
      [config.wallChoiceKey]: mode === "2d" && mainWall !== null ? mainWall : undefined,
      extras,
      seed: design,
      ...styles,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, mainWall, extras, tick, mode, design, styles, kind]);
  const slots: any[] = planned?.plan?.slots || [];
  const skipped: any[] = planned?.plan?.skipped || [];
  const usedWall: number | undefined = planned?.plan?.[config.wallResultKey];

  // 2D: draw the plan on the floor plan.
  useEffect(() => {
    if (mode !== "2d") return;
    const BI = BlueprintInterface as any;
    const described = planned?.room;
    if (!active || !described) {
      BI.setPlanOverlay2D?.(null);
      return;
    }
    const shapes: any[] = [];
    const mw = described.walls[usedWall ?? -1];
    if (mw) {
      const n = { x: mw.normal.x * 6, y: mw.normal.y * 6 };
      shapes.push({
        points: [
          { x: mw.a.x, y: mw.a.y },
          { x: mw.b.x, y: mw.b.y },
          { x: mw.b.x + n.x, y: mw.b.y + n.y },
          { x: mw.a.x + n.x, y: mw.a.y + n.y },
        ],
        fill: 0x534ab7,
        alpha: 0.25,
        line: 0x534ab7,
      });
    }
    // The carpet first, so everything else is drawn over it.
    [...slots]
      .filter((s) => s.rect)
      .sort((a, b) => Number(b.kind === "carpet") - Number(a.kind === "carpet"))
      .forEach((s) =>
        shapes.push({
          points: rectCorners(s.rect),
          fill: COLOURS[s.kind] || 0xdddddd,
          alpha: s.kind === "carpet" ? 0.35 : s.level === "wall" ? 0.6 : 0.75,
          line: 0x534ab7,
        })
      );
    BI.setPlanOverlay2D?.(shapes);
    return () => BI.setPlanOverlay2D?.(null);
  }, [mode, active, planned, slots, usedWall]);

  const place = useCallback(async () => {
    if (!room || !planned?.plan?.slots?.length || busy) return;
    setBusy(true);
    setResult("");
    try {
      const out: any = await applyFurnishPlan(room, planned, (done: number, total: number, label: string) =>
        setResult(`Placing ${done} of ${total} — ${label}`)
      );
      const short = out.saved >= 0 && out.saved < out.placed;
      setResult(
        `${out.placed} placed${out.failed ? ` · ${out.failed} could not be placed` : ""}` +
          (short ? ` · only ${out.saved} saved to the plan` : "")
      );
      if (mode === "2d") {
        setActive(false);
        setRoom2D(null);
        setMainWall(null);
        (BlueprintInterface as any).setPlanOverlay2D?.(null);
      } else setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }, [room, planned, busy, mode]);

  // Counts for the summary line, by label.
  const counts: Record<string, number> = {};
  slots.forEach((s) => (counts[s.label] = (counts[s.label] || 0) + 1));
  const MAIN_LABELS: Record<string, string> = {
    wardrobe: "Wardrobe",
    sofa: "Sofa",
    tvUnit: "TV drawer unit",
    tvPanel: "TV back panel",
    cladding: "Wall cladding",
  };
  const labelOf = (key: string) =>
    config.extras.find((e) => e.key === key)?.label || MAIN_LABELS[key] || key;

  return (
    <div className="text-[color:var(--pz-text)]">
      {mode === "2d" ? (
        <button
          type="button"
          onClick={() => {
            setActive((a) => !a);
            setRoom2D(null);
            setMainWall(null);
            setDesign(0);
            setNote("");
            setResult("");
          }}
          className={`w-full rounded-md border px-2 py-1.5 text-[12px] mb-2 ${
            active
              ? "border-[color:var(--pz-accent)] bg-[color:var(--pz-accent-soft)] text-[color:var(--pz-accent)]"
              : "border-[color:var(--pz-panel-border)]"
          }`}
        >
          {active ? config.stop : config.start}
        </button>
      ) : null}

      {mode === "2d" && active && !room ? (
        <p className="text-[11px] text-[color:var(--pz-text-2)] leading-snug mb-2">{config.pickHint}</p>
      ) : null}
      {mode === "3d" && !room ? (
        <p className="text-[12px] text-[color:var(--pz-text-2)] leading-snug">
          Select the room first — click its floor in the 3D view.
        </p>
      ) : null}

      {room && (mode === "3d" || active) ? (
        <>
          <p className="text-[11px] text-[color:var(--pz-text-2)] mb-1">
            Room: <b>{room.name || "unnamed"}</b>
            {usedWall !== undefined ? ` · ${config.wallWord} on wall ${usedWall + 1}` : ""}
          </p>
          {mode === "2d" ? (
            <p className="text-[11px] text-[color:var(--pz-text-2)] leading-snug mb-2">
              Click another wall to move the {config.wallWord} there, or{" "}
              <button
                type="button"
                className="underline text-[color:var(--pz-accent)]"
                onClick={() => setMainWall(null)}
              >
                let it choose
              </button>
              .
            </p>
          ) : null}

          {config.styles.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-[12px] mb-2">
              <span className="w-[68px] shrink-0">{s.label}</span>
              <select
                value={styles[s.key]}
                onChange={(e) => setStyles((x) => ({ ...x, [s.key]: e.target.value }))}
                className="flex-1 rounded border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-input-bg)] px-1.5 py-1 text-[12px]"
              >
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <div className="flex items-center gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => setDesign((d) => Math.max(0, d - 1))}
              disabled={design === 0 || busy}
              className="rounded-md border border-[color:var(--pz-panel-border)] px-2 py-1 text-[12px] disabled:opacity-40"
              title="The previous design"
            >
              ← Back
            </button>
            <span className="text-[12px] font-medium px-1">Design {design + 1}</span>
            <button
              type="button"
              onClick={() => setDesign((d) => d + 1)}
              disabled={busy}
              className="flex-1 rounded-md border border-[color:var(--pz-accent)] text-[color:var(--pz-accent)] px-2 py-1 text-[12px] disabled:opacity-40"
              title="Another layout and other models — same walkways and clearances"
            >
              Try another design →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1 mb-2">
            {config.extras.map((e) => (
              <label key={e.key} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!extras[e.key]}
                  onChange={(ev) => setExtras((x) => ({ ...x, [e.key]: ev.target.checked }))}
                />
                {e.label}
              </label>
            ))}
          </div>

          {planned?.error || planned?.plan?.reason ? (
            <p className="text-[12px] text-red-600 leading-snug mb-2">
              {planned?.error || `Can't furnish: ${planned.plan.reason}.`}
            </p>
          ) : (
            <>
              <p className="text-[11px] text-[color:var(--pz-text-2)] mb-1 leading-snug">
                {Object.entries(counts)
                  .map(([label, n]) => (n > 1 ? `${n} × ${label}` : label))
                  .join(" · ")}
              </p>
              {skipped.length ? (
                <p className="text-[11px] text-amber-600 mb-2 leading-snug">
                  Left out: {skipped.map((s: any) => `${labelOf(s.kind)} (${s.reason})`).join("; ")}
                </p>
              ) : null}
              <button
                type="button"
                onClick={place}
                disabled={busy || !slots.length}
                className={`w-full rounded-md px-3 py-1.5 text-[13px] text-white ${
                  busy ? "bg-neutral-400 cursor-not-allowed" : "bg-[color:var(--pz-accent)] hover:opacity-90"
                }`}
              >
                {busy ? result || "Placing…" : `Place ${slots.length} items`}
              </button>
            </>
          )}
          {note ? <p className="text-[11px] text-amber-600 mt-2">{note}</p> : null}
        </>
      ) : note ? (
        <p className="text-[11px] text-amber-600">{note}</p>
      ) : null}

      {!busy && result ? (
        <p className="mt-2 text-[12px] text-green-600 dark:text-green-400">{result}</p>
      ) : null}
    </div>
  );
};

export default RoomFurnishPlanner;
