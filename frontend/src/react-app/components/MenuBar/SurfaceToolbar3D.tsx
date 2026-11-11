import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import {
  EVENT_ITEM_SELECTED,
  EVENT_WALL_CLICKED,
  EVENT_ROOM_CLICKED,
} from "@pazl/main/core/events";
import "./surfaceToolbar3D.css";

/**
 * The dark "… Editor >" tab that appears where you click a FLOOR, a WALL or a
 * CEILING in the 3D view — the counterpart of ItemToolbar3D for the room
 * itself. Clicking the tab opens that element's editor:
 *
 *   Wall Editor >     → the Wall Editor, on the wall side that was clicked
 *   Ceiling Editor >  → the Ceiling Editor, on that room's ceiling
 *   Floor Editor >    → the Floor Editor, on that room's floor
 *
 * The click itself only brings up the tab; the side panels no longer open on
 * their own. The tab is anchored to the point that was clicked: that point is
 * projected through the 3D camera every frame, the way ItemToolbar3D follows
 * an item.
 */

type Kind = "floor" | "wall" | "ceiling";
type Selection = { kind: Kind; room?: any; edge?: any; point: any } | null;
type Point = { x: number; y: number } | null;

const roomplanner = () => (BlueprintInterface as any)?.blueprint3d?.roomplanner || null;

const project = (p: any): Point => {
  const rp = roomplanner();
  if (!rp?.camera || !rp?.domElement || !p?.clone) return null;
  const v = p.clone().project(rp.camera);
  if (v.z > 1) return null;
  const rect = rp.domElement.getBoundingClientRect();
  return {
    x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
  };
};

/** Up and to the right of the clicked point, kept inside the free canvas. */
const place = (pt: NonNullable<Point>, size: { w: number; h: number }) => {
  const GAP = 14;
  const PAD = 8;
  const rect = roomplanner()?.domElement?.getBoundingClientRect();
  const minLeft = rect ? rect.left + PAD : PAD;
  let maxRight = rect ? rect.right - PAD : window.innerWidth - PAD;
  const minTop = rect ? rect.top + PAD : PAD;
  const maxBottom = rect ? rect.bottom - PAD : window.innerHeight - PAD;
  document.querySelectorAll('[data-pz-canvas-overlay="right"]').forEach((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.left < maxRight) maxRight = r.left - PAD;
  });
  let left = pt.x + GAP;
  let top = pt.y - GAP - size.h;
  if (left + size.w > maxRight) left = pt.x - GAP - size.w;
  left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxRight - size.w));
  if (top < minTop) top = pt.y + GAP;
  top = Math.min(Math.max(top, minTop), Math.max(minTop, maxBottom - size.h));
  return { left, top };
};

const TITLES: Record<Kind, string> = {
  floor: "Floor Editor",
  wall: "Wall Editor",
  ceiling: "Ceiling Editor",
};

interface SurfaceToolbar3DProps {
  /** Open the Wall Editor on this wall side. */
  onOpenWallEditor: (edge: any) => void;
  /** Open the Ceiling Editor on this room. */
  onOpenCeilingEditor: (room: any) => void;
  /** Open the Floor Editor on this room. */
  onOpenFloorEditor: (room: any) => void;
}

const SurfaceToolbar3D: React.FC<SurfaceToolbar3DProps> = ({
  onOpenWallEditor,
  onOpenCeilingEditor,
  onOpenFloorEditor,
}) => {
  const [sel, setSel] = useState<Selection>(null);
  const selRef = useRef<Selection>(null);
  selRef.current = sel;
  const [point, setPoint] = useState<Point>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const tabRef = useRef<HTMLButtonElement>(null);
  const frame = useRef<number | null>(null);

  // --- what is selected -------------------------------------------------------
  useEffect(() => {
    const rp = roomplanner();
    if (!rp?.addRoomplanListener) return;
    const onWall = (evt: any) => {
      if (!evt?.item?.wall || !evt.point) return;
      setSel({ kind: "wall", edge: evt.item, point: evt.point.clone() });
    };
    const onRoom = (evt: any) => {
      // A null room is a click on nothing — the tab goes.
      if (!evt?.item || !evt.point) return setSel(null);
      setSel({ kind: evt.ceiling ? "ceiling" : "floor", room: evt.item, point: evt.point.clone() });
    };
    const onItem = () => setSel(null);
    rp.addRoomplanListener(EVENT_WALL_CLICKED, onWall);
    rp.addRoomplanListener(EVENT_ROOM_CLICKED, onRoom);
    rp.addRoomplanListener(EVENT_ITEM_SELECTED, onItem);
    return () => {
      rp.removeRoomplanListener?.(EVENT_WALL_CLICKED, onWall);
      rp.removeRoomplanListener?.(EVENT_ROOM_CLICKED, onRoom);
      rp.removeRoomplanListener?.(EVENT_ITEM_SELECTED, onItem);
    };
  }, []);

  // --- out of the way while the view is being turned --------------------------
  useEffect(() => {
    const SLOP = 4;
    let from: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (tabRef.current?.contains(e.target as Node)) return;
      from = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (from && (Math.abs(e.clientX - from.x) > SLOP || Math.abs(e.clientY - from.y) > SLOP)) {
        setDragging(true);
      }
    };
    const up = () => {
      from = null;
      setDragging(false);
    };
    const el = roomplanner()?.domElement || window;
    el.addEventListener("pointerdown", down as any);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down as any);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // --- follow the clicked point on screen -------------------------------------
  useEffect(() => {
    if (!sel) {
      setPoint(null);
      return;
    }
    setPoint(project(sel.point));
    const tickFrame = () => {
      setPoint((prev) => {
        const next = project(selRef.current?.point);
        if (!next || !prev) return next;
        return Math.abs(next.x - prev.x) < 0.5 && Math.abs(next.y - prev.y) < 0.5 ? prev : next;
      });
      frame.current = requestAnimationFrame(tickFrame);
    };
    frame.current = requestAnimationFrame(tickFrame);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [sel]);

  useLayoutEffect(() => {
    const el = tabRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) {
      setSize({ w: r.width, h: r.height });
    }
  });

  if (!sel || !point || dragging) return null;

  const openEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    const s = selRef.current;
    if (!s) return;
    if (s.kind === "wall") onOpenWallEditor(s.edge);
    else if (s.kind === "ceiling") onOpenCeilingEditor(s.room);
    else onOpenFloorEditor(s.room);
    // The tab has done its job; the editor takes over.
    setSel(null);
  };

  const pos = place(point, size);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="pz-st3d"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={stop}
      onPointerDown={stop}
      onWheel={stop}
    >
      <button ref={tabRef} type="button" className="pz-st3d-tab" onClick={openEditor}>
        {TITLES[sel.kind]}
        <span className="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
  );
};

export default SurfaceToolbar3D;
