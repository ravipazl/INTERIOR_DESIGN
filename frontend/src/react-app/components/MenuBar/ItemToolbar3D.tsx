import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import {
  EVENT_ITEM_SELECTED,
  EVENT_NO_ITEM_SELECTED,
  EVENT_ITEM_REMOVED,
} from "@pazl/main/core/events";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import "./itemToolbar3D.css";

/**
 * The small toolbar that appears beside the item you click in the 3D view:
 * mirror, lock, duplicate, hide and delete.
 *
 * It follows the item on screen: the item's own position is projected through
 * the 3D camera every frame, the same way the dimension chips do it
 * (Viewer3d.updateDimensionLabels). Nothing about the 3D scene changes — the
 * toolbar is ordinary HTML on top of the canvas.
 */

// x is the item's LEFT edge on screen and x2 its right edge — the bar sits off
// the left side, and needs the right one to swap sides when the left is tight
// against the edge of the canvas. y is the item's vertical middle.
type Point = { x: number; y: number; x2: number } | null;

const roomplanner = () =>
  (BlueprintInterface as any)?.blueprint3d?.roomplanner || null;

const projectManager = () => (BlueprintInterface as any)?.ProjectManagerService || null;

/**
 * Mirror goes through the project, not just the 3D view: it changes the item's
 * saved size, so it comes back mirrored after a reload (the 3D view alone
 * forgets it).
 */
const mirrorItem = (id: string | null) => {
  if (!id) return;
  const pm = projectManager();
  // Falls back to mirroring in the 3D view only (no saving) when the project
  // has no record for this item — it still looks right on screen.
  Promise.resolve(pm?.onFurnishedModelMirror?.(id)).then((saved) => {
    if (!saved) (BlueprintInterface as any).mirrorItem3D?.(id);
  });
};

/**
 * Where to put the toolbar: the MIDDLE of the item's top edge.
 *
 * It used to be the top-right corner, and the bar was drawn 16px further right
 * again. For an item near the right of the screen that put the bar underneath
 * the object panel, which overlays the canvas — the buttons were unreachable.
 * The bar is now centred on this point and clamped to the free canvas area
 * (see placeToolbar below).
 */
const anchorFor = (item: any): Point => {
  const rp = roomplanner();
  if (!rp || !item || !rp.camera || !rp.domElement) return null;
  try {
    // The item's own box (kept up to date by Physical3DItem) rather than a
    // fresh Box3 here, so this doesn't depend on which copy of three is loaded.
    const box = item.worldBox;
    if (!box || !isFinite(box.max.x)) return null;
    const rect = rp.domElement.getBoundingClientRect();
    const project = (p: any) => {
      const v = p.clone().project(rp.camera);
      if (v.z > 1) return null;
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    };

    // WHERE THE ITEM ENDS ON SCREEN, NOT WHERE ITS CENTRE IS.
    //
    // The bar is placed off the item's left side, and which world corner that
    // is depends entirely on where the camera stands — turn the view and the
    // box's "min x" corner can end up on the right. So all eight corners of the
    // box are projected and the screen extents taken from the results. That
    // holds at any camera angle without caring which corner is which.
    const pts: Array<{ x: number; y: number }> = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const p = project(box.min.clone().set(x, y, z));
          if (p) pts.push(p);
        }
      }
    }
    if (!pts.length) {
      // Every corner is behind the camera — zoomed inside the item. Fall back
      // to its centre so the bar still has somewhere to be.
      const centre = box.min.clone().add(box.max).multiplyScalar(0.5);
      const c = project(centre);
      return c ? { x: c.x, y: c.y, x2: c.x } : null;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: Math.min(...xs),
      x2: Math.max(...xs),
      y: (minY + maxY) / 2,
    };
  } catch (e) {
    return null;
  }
};

/**
 * Put the bar beside the item — off its LEFT side — and keep it inside the free
 * part of the canvas.
 *
 * It used to sit centred above the item, which put it right over whatever was
 * behind it and, on a wide item, a long way from the thing it acts on. Beside
 * the item it stays clear of the item itself and of the view behind it.
 *
 * The bar is `position: fixed`, so these are viewport coordinates. Panels that
 * overlay the canvas mark themselves with data-pz-canvas-overlay="right"; their
 * left edge is the right-hand limit here, which is what stops the bar sliding
 * under the object panel.
 */
const placeToolbar = (
  point: { x: number; y: number; x2: number },
  size: { w: number; h: number }
) => {
  const GAP = 12;
  const PAD = 8;
  // Right edge of the bar sits a gap clear of the item's left edge, and the bar
  // is centred on the item's height.
  let left = point.x - GAP - size.w;
  let top = point.y - size.h / 2;

  const rect = roomplanner()?.domElement?.getBoundingClientRect();
  let minLeft = PAD;
  let maxRight = window.innerWidth - PAD;
  let minTop = PAD;
  if (rect) {
    minLeft = rect.left + PAD;
    maxRight = rect.right - PAD;
    minTop = rect.top + PAD;
  }
  document
    .querySelectorAll('[data-pz-canvas-overlay="right"]')
    .forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left < maxRight) {
        maxRight = r.left - PAD;
      }
    });

  if (size.w > 0) {
    // An item against the left edge of the canvas leaves no room on that side,
    // so the bar swaps to the item's right rather than being squeezed on top
    // of it. Only when neither side fits is it clamped into view.
    if (left < minLeft && point.x2 + GAP + size.w <= maxRight) {
      left = point.x2 + GAP;
    }
    left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxRight - size.w));
  }
  // Keep it on screen vertically too — a tall item reaching past the top of the
  // canvas would otherwise take the bar with it.
  if (top < minTop) top = minTop;

  return { left, top };
};

const ItemToolbar3D: React.FC = () => {
  const [item, setItem] = useState<any>(null);
  const [point, setPoint] = useState<Point>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hidden, setHidden] = useState(false);
  const [locked, setLocked] = useState(false);
  const itemRef = useRef<any>(null);
  const frame = useRef<number | null>(null);

  const modelId = item?.itemModel?.__id || item?.__itemModel?.__id || null;

  // --- selection ----------------------------------------------------------
  useEffect(() => {
    const rp = roomplanner();
    if (!rp?.addRoomplanListener) return;
    const onSelected = (evt: any) => {
      const next = evt?.item || null;
      itemRef.current = next;
      setItem(next);
      setHidden(next ? next.visible === false : false);
      const id = next?.itemModel?.__id || next?.__itemModel?.__id;
      setLocked(!!(id && (BlueprintInterface as any).isItem3DLocked?.(id)));
    };
    const onCleared = () => {
      itemRef.current = null;
      setItem(null);
    };
    rp.addRoomplanListener(EVENT_ITEM_SELECTED, onSelected);
    rp.addRoomplanListener(EVENT_NO_ITEM_SELECTED, onCleared);
    rp.addRoomplanListener(EVENT_ITEM_REMOVED, onCleared);
    return () => {
      rp.removeRoomplanListener?.(EVENT_ITEM_SELECTED, onSelected);
      rp.removeRoomplanListener?.(EVENT_NO_ITEM_SELECTED, onCleared);
      rp.removeRoomplanListener?.(EVENT_ITEM_REMOVED, onCleared);
    };
  }, []);

  // --- OUT OF THE WAY WHILE YOU ARE DRAGGING ------------------------------
  //
  // The bar is anchored to the item, so dragging one across the room drags the
  // bar along with it, right under the cursor and over whatever you are trying
  // to aim at. It is only ever wanted once the item has come to rest.
  //
  // A press alone is not a drag — selecting an item by clicking it must still
  // bring the bar up — so the bar is only dropped once the pointer has actually
  // travelled a few pixels while held. That threshold is what separates a click
  // from a drag; a steady hand clicking still counts as a click.
  //
  // Done on the pointer rather than on the engine's move events so that it also
  // covers a drag which never moves an item — a refused move, or a locked one —
  // and so the bar comes back on release whatever the engine decided.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const DRAG_SLOP = 4; // px of travel before a press counts as a drag
    let from: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      // Ignore presses on the bar itself — its own buttons must keep working.
      if (barRef.current && barRef.current.contains(e.target as Node)) return;
      from = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!from) return;
      if (
        Math.abs(e.clientX - from.x) > DRAG_SLOP ||
        Math.abs(e.clientY - from.y) > DRAG_SLOP
      ) {
        setDragging(true);
      }
    };
    const up = () => {
      from = null;
      setDragging(false);
    };
    const el = roomplanner()?.domElement || window;
    el.addEventListener("pointerdown", down as any);
    // Move and release go on the window: a drag regularly leaves the canvas,
    // and a release outside it must still bring the bar back.
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

  // --- follow the item on screen -----------------------------------------
  useEffect(() => {
    if (!item) {
      setPoint(null);
      return;
    }
    // Place it at once, then keep up with the camera frame by frame.
    setPoint(anchorFor(item));
    const tick = () => {
      setPoint((prev) => {
        const next = anchorFor(itemRef.current);
        if (!next || !prev) return next;
        // Skip re-renders for sub-pixel camera drift.
        return Math.abs(next.x - prev.x) < 0.5 && Math.abs(next.y - prev.y) < 0.5
          ? prev
          : next;
      });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    // A browser pauses frames for a hidden tab; the camera can still be moved
    // by a button (zoom, straight-on view), so re-place it on those too.
    const controls = roomplanner()?.controls;
    const onCameraChange = () => setPoint(anchorFor(itemRef.current));
    controls?.addEventListener?.("change", onCameraChange);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      controls?.removeEventListener?.("change", onCameraChange);
    };
  }, [item]);

  // Shortcuts (only while an item is selected, never while typing in a field).
  // Delete and Ctrl+C / Ctrl+V stay with the 3D view, which already has them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable)
        return;
      const id = itemRef.current?.itemModel?.__id || itemRef.current?.__itemModel?.__id;
      if (!id) return;
      const BI = BlueprintInterface as any;
      const key = e.key.toLowerCase();
      if (key === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        mirrorItem(id);
      } else if (key === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        BI.duplicateItem3D?.(id);
      } else if (key === "l" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const next = !BI.isItem3DLocked?.(id);
        if (BI.setItem3DLocked?.(id, next)) {
          setLocked(next);
          saveRef.current(HISTORY_TITLES.FLOOR_ITEM_UPDATED);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = useCallback((title: HISTORY_TITLES) => {
    try {
      (BlueprintInterface as any).ProjectManagerService?.updateFloorPlan(title);
    } catch (e) {
      console.error("ItemToolbar3D: saving failed", e);
    }
  }, []);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Its own size, needed to centre it. Measured after paint, and only stored
  // when it actually changes, so this can't loop.
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) {
      setSize({ w: r.width, h: r.height });
    }
  });

  if (!item || !point || dragging) return null;

  const BI = BlueprintInterface as any;
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const onMirror = () => mirrorItem(modelId);
  const onDuplicate = () => {
    BI.duplicateItem3D?.(modelId);
  };
  const onHide = () => {
    const next = !hidden;
    if (BI.setItem3DVisible?.(modelId, !next)) setHidden(next);
  };
  const onDelete = () => {
    try {
      BI.ProjectManagerService?.removeFurnishedModel(modelId);
    } catch (e) {
      console.error("ItemToolbar3D: delete failed", e);
    }
    itemRef.current = null;
    setItem(null);
  };
  const onLock = () => {
    const next = !locked;
    if (BI.setItem3DLocked?.(modelId, next)) {
      setLocked(next);
      save(HISTORY_TITLES.FLOOR_ITEM_UPDATED);
    }
  };

  const Icon = ({
    icon,
    title,
    onClick,
    danger,
    active,
  }: {
    icon: string;
    title: string;
    onClick: () => void;
    danger?: boolean;
    active?: boolean;
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={act(onClick)}
      className={`pz-it3d-btn${danger ? " pz-it3d-danger" : ""}${
        active ? " pz-it3d-active" : ""
      }`}
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );

  return (
    <div
      ref={barRef}
      className="pz-it3d"
      style={placeToolbar(point, size)}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="pz-it3d-bar">
        <span className="pz-it3d-grip material-symbols-outlined">drag_indicator</span>
        <Icon icon="flip" title="Mirror (G)" onClick={onMirror} />
        <Icon
          icon={locked ? "lock_open" : "lock"}
          title={locked ? "Unlock (Ctrl+L)" : "Lock (Ctrl+L)"}
          onClick={onLock}
          active={locked}
        />
        <Icon icon="content_copy" title="Duplicate (Ctrl+D)" onClick={onDuplicate} />
        <Icon
          icon={hidden ? "visibility" : "visibility_off"}
          title={hidden ? "Show" : "Hide"}
          onClick={onHide}
          active={hidden}
        />
        <Icon icon="delete" title="Delete (Del)" onClick={onDelete} danger />
      </div>
    </div>
  );
};

export default ItemToolbar3D;
