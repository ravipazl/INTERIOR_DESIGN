import React, { useCallback, useEffect, useRef, useState } from "react";
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

type Point = { x: number; y: number } | null;

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

/** Where to put the toolbar: just right of the item's top-right corner. */
const anchorFor = (item: any): Point => {
  const rp = roomplanner();
  if (!rp || !item || !rp.camera || !rp.domElement) return null;
  try {
    // The item's own box (kept up to date by Physical3DItem) rather than a
    // fresh Box3 here, so this doesn't depend on which copy of three is loaded.
    const box = item.worldBox;
    if (!box || !isFinite(box.max.x)) return null;
    const rect = rp.domElement.getBoundingClientRect();
    const corner = box.max.clone();
    const centre = box.min.clone().add(box.max).multiplyScalar(0.5);
    // Project the top corner AND the centre: if the corner is behind the
    // camera (zoomed inside the item) fall back to the centre.
    const project = (p: any) => {
      const v = p.clone().project(rp.camera);
      if (v.z > 1) return null;
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    };
    return project(corner) || project(centre);
  } catch (e) {
    return null;
  }
};

const ItemToolbar3D: React.FC = () => {
  const [item, setItem] = useState<any>(null);
  const [point, setPoint] = useState<Point>(null);
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

  if (!item || !point) return null;

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
      className="pz-it3d"
      style={{ left: point.x + 16, top: point.y }}
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
