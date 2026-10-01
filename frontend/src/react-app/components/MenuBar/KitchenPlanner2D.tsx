import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import {
  planKitchenLayout,
  applyPlan,
  describeRoom,
  pickProblem,
  LAYOUTS,
  freeSpans,
} from "@pazl/react-app/roomTemplates/applyRoomTemplate";

/**
 * Auto-furnish a kitchen from the 2D plan.
 *
 * Choose a layout (straight / L / U / parallel), then CLICK THE WALLS in the
 * plan in the order the run should follow. The cabinets are previewed on the
 * plan as you pick, drawn from the very plan that will be placed, so the
 * preview can't disagree with the result.
 */

const COLOURS: Record<string, number> = {
  tall: 0xafa9ec,
  sink: 0xcecbf6,
  drawer: 0xeeedfe,
  shutter: 0xf3f2fd,
  pullout: 0xf5c4b3,
  corner: 0x7f77dd,
  wallUnit: 0xb5d4f4,
};

const LABELS: Record<string, string> = {
  tall: "Tall unit",
  sink: "Sink unit",
  drawer: "Drawers",
  shutter: "Shutter unit",
  pullout: "Oil pull-out",
  corner: "Corner unit",
  wallUnit: "Wall unit",
};

const KitchenPlanner2D: React.FC = () => {
  // NOTHING SELECTED UNTIL YOU CHOOSE. This used to start on "straight", so
  // opening the Floor plan tab put you into wall-picking mode — "Click 1 more
  // wall in the plan…" — for a layout you had never asked for, and your next
  // click on a wall was taken by the kitchen picker instead of opening Wall
  // properties. An empty string means no layout; see `spec` below.
  const [layout, setLayout] = useState<string>("");
  const [picked, setPicked] = useState<number[]>([]);
  const [room, setRoom] = useState<any>(null);
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const described = useMemo(() => (room ? describeRoom(room) : null), [room]);

  // The wall-click listener is registered once per layout, so it closes over
  // the `room` of that render. A ref keeps it reading the CURRENT room without
  // tearing the listener down and rebuilding it on every pick.
  const roomRef = useRef<any>(null);
  roomRef.current = room;

  // Nothing picked means no room is locked in. Unpicking back to zero has to
  // release it as surely as "Clear picked walls" does, or the kitchen stays
  // tied to a room the user has visibly deselected.
  useEffect(() => {
    if (!picked.length && room) setRoom(null);
  }, [picked, room]);

  /** Clicking a wall in the plan picks it (or unpicks it). */
  useEffect(() => {
    const BI = BlueprintInterface as any;
    // NO LAYOUT CHOSEN → the picker takes nothing over. Turning a layout off
    // has to give wall clicks back to the rest of the app, or cancelling would
    // leave Wall properties silently unopenable for the rest of the session.
    if (!layout) return;
    // Tell the rest of the app that wall clicks belong to the picker now, so
    // Wall properties doesn't open over the plan while you choose walls.
    BI.__kitchenPicking = true;
    const stop = BI.onWall2DClicked?.((wall: any) => {
      if (!wall) return;
      // WHICH ROOM IS THIS KITCHEN BEING BUILT IN?
      //
      // A wall BETWEEN two rooms is attached to both, so `attachedRooms[0]`
      // picked an arbitrary one of them. That matters more than it looks: the
      // numbers collected below are positions in one particular room's wall
      // list, so two clicks that resolved to different rooms produced a mix of
      // indices with no single meaning — and the run was then laid out along
      // whichever walls those numbers happened to hit in the last room picked,
      // which is how a kitchen ended up strung across a room at angles nobody
      // chose.
      //
      // So the room is decided ONCE, by the first wall picked, and every later
      // pick must be a wall of that same room. Before anything is picked, a
      // room focused in 3D wins, so choosing a shared wall builds the kitchen
      // in the room you are actually designing rather than its neighbour.
      const attached = ((wall.attachedRooms as any[]) || []).filter(Boolean);
      const focusId = BI.__roomFocusId;
      const theRoom =
        roomRef.current ||
        (focusId &&
          attached.find((r: any) => r && r.roomByCornersId === focusId)) ||
        attached[0] ||
        BI.blueprint3d?.model?.floorplan?.getRooms?.()[0] ||
        null;
      if (!theRoom) {
        setNote("This wall isn't part of a room yet.");
        return;
      }
      const desc: any = describeRoom(theRoom);
      if (!desc) return;
      const index = desc.walls.findIndex((w: any) => w.edge && w.edge.wall === wall);
      if (index < 0) {
        setNote(
          roomRef.current
            ? "Pick walls from the same room — use Clear picked walls to start on another one."
            : "That wall isn't one of this room's walls."
        );
        return;
      }
      setRoom(theRoom);
      setPicked((prev) => {
        if (prev.includes(index)) return prev.filter((i) => i !== index);
        const problem = pickProblem(desc, layout, prev, index);
        if (problem) {
          setNote(problem);
          return prev;
        }
        setNote("");
        return [...prev, index];
      });
    });
    return () => {
      BI.__kitchenPicking = false;
      if (stop) stop();
    };
  }, [layout]);

  const planned: any = useMemo(() => {
    if (!layout || !room || !picked.length) return null;
    return planKitchenLayout(room, layout, picked);
  }, [room, layout, picked]);

  const slots = planned?.plan?.slots || [];

  /** Draw the picked walls and the cabinets on the plan. */
  useEffect(() => {
    const BI = BlueprintInterface as any;
    if (!described) {
      BI.setPlanOverlay2D?.(null);
      return;
    }
    const shapes: any[] = [];
    // The picked walls, as a thick line so the order is obvious.
    picked.forEach((index) => {
      const w = described.walls[index];
      if (!w) return;
      const n = { x: w.normal.x * 6, y: w.normal.y * 6 };
      shapes.push({
        points: [
          { x: w.a.x, y: w.a.y },
          { x: w.b.x, y: w.b.y },
          { x: w.b.x + n.x, y: w.b.y + n.y },
          { x: w.a.x + n.x, y: w.a.y + n.y },
        ],
        fill: 0x534ab7,
        alpha: 0.25,
        line: 0x534ab7,
      });
    });
    // Every module, as the rectangle it will occupy on the floor.
    slots.forEach((s: any) => {
      const w = described.walls[s.wallIndex];
      if (!w) return;
      const ux = (w.b.x - w.a.x) / w.lengthCm;
      const uy = (w.b.y - w.a.y) / w.lengthCm;
      const depth = s.level === "wall" ? 32.5 : 58.2; // cm, catalogue depths
      const p = (along: number, out: number) => ({
        x: w.a.x + ux * along + w.normal.x * out,
        y: w.a.y + uy * along + w.normal.y * out,
      });
      shapes.push({
        points: [
          p(s.startCm, 0),
          p(s.endCm, 0),
          p(s.endCm, depth),
          p(s.startCm, depth),
        ],
        fill: COLOURS[s.kind] || 0xdddddd,
        alpha: s.level === "wall" ? 0.35 : 0.75,
        line: 0x534ab7,
      });
    });
    BI.setPlanOverlay2D?.(shapes);
    return () => BI.setPlanOverlay2D?.(null);
  }, [described, picked, slots]);

  // null while no layout is chosen — every reader below must cope with that.
  const spec = layout ? (LAYOUTS as any)[layout] : null;
  const wallLine = (index: number, order: number) => {
    const w = described?.walls[index];
    if (!w) return null;
    const spans = freeSpans(w);
    const clear = spans.length ? Math.max(...spans.map(([a, b]: number[]) => b - a)) : 0;
    return (
      <div
        key={index}
        className="flex items-center gap-2 text-[12px] px-2 py-1 rounded border border-[color:var(--pz-panel-border)] mb-1"
      >
        <span className="w-[17px] h-[17px] rounded-full bg-[color:var(--pz-accent)] text-white text-[11px] flex items-center justify-center">
          {order + 1}
        </span>
        Wall {index + 1}
        <span className="ml-auto text-[color:var(--pz-text-2)]">
          {Math.round(clear * 10)} mm
        </span>
      </div>
    );
  };

  const place = useCallback(async () => {
    if (!room || !planned || busy) return;
    setBusy(true);
    setResult("");
    try {
      const out: any = await applyPlan(room, planned, (done: number, total: number) =>
        setResult(`Placing ${done} of ${total}…`)
      );
      // `saved` is how many items the floor plan's scene ended up holding. If
      // it is short of what was placed, the next reload would delete the rest,
      // so say so here rather than letting the kitchen vanish silently.
      const short = out.saved >= 0 && out.saved < out.placed;
      setResult(
        `${out.placed} placed${out.failed ? ` · ${out.failed} failed` : ""}` +
          (short ? ` · only ${out.saved} saved to the plan` : "")
      );
      setPicked([]);
      (BlueprintInterface as any).setPlanOverlay2D?.(null);
    } finally {
      setBusy(false);
    }
  }, [room, planned, busy]);

  return (
    <div className="text-[color:var(--pz-text)]">
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {Object.values(LAYOUTS).map((l: any) => (
          <button
            key={l.id}
            type="button"
            /* TOGGLE, not a radio group. Clicking the chosen layout again
               turns it off, which is the only way to leave the wall-picking
               mode: before this, once a shape was on there was no way to say
               "never mind" — you could switch shapes but not stop. Either way
               the picked walls are cleared, because they were chosen to suit
               the shape you are leaving. */
            onClick={() => {
              setLayout((cur) => (cur === l.id ? "" : l.id));
              setPicked([]);
              setNote("");
            }}
            className={`rounded-md border px-2 py-1.5 text-[12px] ${
              layout === l.id
                ? "border-[color:var(--pz-accent)] bg-[color:var(--pz-accent-soft)] text-[color:var(--pz-accent)]"
                : "border-[color:var(--pz-panel-border)]"
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>

      {/* No layout chosen → no instruction. The whole paragraph goes, rather
          than showing an empty one, so the section ends at the buttons instead
          of leaving a gap where a line of text used to be. */}
      {spec && (
        <p className="text-[11px] text-[color:var(--pz-text-2)] leading-snug mb-2">
          {picked.length < spec.walls
            ? `Click ${spec.walls - picked.length} more wall${
                spec.walls - picked.length === 1 ? "" : "s"
              } in the plan. Any order — they just have to join up.`
            : "Walls picked. Check the preview, then place."}
        </p>
      )}

      {picked.map((index, order) => wallLine(index, order))}

      {note ? <p className="text-[11px] text-amber-600 mb-2">{note}</p> : null}

      {slots.length ? (
        <>
          <p className="text-[11px] text-[color:var(--pz-text-2)] mb-2">
            {slots.filter((s: any) => s.level === "floor").length} base ·{" "}
            {slots.filter((s: any) => s.level === "wall").length} wall units
            {slots.some((s: any) => s.kind === "corner") ? " · corner unit" : ""}
          </p>
          <button
            type="button"
            onClick={place}
            disabled={busy}
            className={`w-full rounded-md px-3 py-1.5 text-[13px] text-white ${
              busy ? "bg-neutral-400" : "bg-[color:var(--pz-accent)] hover:opacity-90"
            }`}
          >
            {busy ? result || "Placing…" : `Place ${slots.length} modules`}
          </button>
        </>
      ) : planned?.plan?.reason ? (
        <p className="text-[11px] text-[color:var(--pz-text-2)]">{planned.plan.reason}</p>
      ) : null}

      {!busy && result ? (
        <p className="mt-2 text-[12px] text-green-600 dark:text-green-400">{result}</p>
      ) : null}

      {picked.length ? (
        <button
          type="button"
          onClick={() => {
            setPicked([]);
            // Release the room as well. The first pick LOCKS the kitchen to one
            // room; without clearing it here, "Clear picked walls" would free
            // the walls but keep the room, and there would be no way to start a
            // kitchen in a different one without reloading the page.
            setRoom(null);
            setNote("");
            (BlueprintInterface as any).setPlanOverlay2D?.(null);
          }}
          className="mt-2 w-full rounded-md border border-[color:var(--pz-panel-border)] px-3 py-1 text-[12px]"
        >
          Clear picked walls
        </button>
      ) : null}
    </div>
  );
};

export default KitchenPlanner2D;
export { LABELS };
