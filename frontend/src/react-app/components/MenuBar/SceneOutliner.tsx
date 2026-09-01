import React, { useEffect, useRef, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import {
  handleWallClicked2D,
  handleRoomClicked2D,
  handleNo2DItemSelected,
} from "@pazl/events/event-interface";
import { EVENT_LOADED } from "@pazl/main/core/events";

type Node = { obj?: any; name?: string; label?: string; id?: any };
type OutlineData = { rooms: Node[]; walls: Node[]; items: Node[] };

/**
 * Scene outliner — a side panel listing the floor plan's rooms, walls and
 * placed items. Clicking a room/wall selects + highlights it in the 2D view
 * (and opens its properties panel) via the same path a canvas click uses;
 * selecting something in the canvas highlights the matching row here.
 */
const SceneOutliner: React.FC<{ docked?: boolean }> = ({ docked = false }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OutlineData>({
    rooms: [],
    walls: [],
    items: [],
  });
  const [activeObj, setActiveObj] = useState<any>(null);
  // Highlighted opening (door/window) row, keyed by its item __id.
  const [activeItemId, setActiveItemId] = useState<any>(null);
  const subscribed = useRef(false);

  const refresh = () => {
    try {
      const d = (BlueprintInterface as any).getOutlineData?.();
      if (d) setData(d);
    } catch (e) {
      console.error("outliner refresh failed", e);
    }
  };

  // Subscribe once: keep the tree highlight in sync with canvas selection,
  // and refresh whenever a new floor plan loads.
  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;
    try {
      // Selecting a wall/room highlights its row and clears any opening highlight.
      handleWallClicked2D((evt: any) => {
        setActiveObj(evt?.item);
        setActiveItemId(null);
      });
      handleRoomClicked2D((evt: any) => {
        setActiveObj(evt?.item);
        setActiveItemId(null);
      });
      handleNo2DItemSelected(() => {
        setActiveObj(null);
        setActiveItemId(null);
      });
      // Selecting a door/window highlights ITS row (and clears the wall row).
      window.addEventListener("pazl-opening-2d-selected", (e: any) => {
        const it = e?.detail?.item;
        setActiveItemId(it && it.__id != null ? it.__id : null);
        setActiveObj(null);
      });
      window.addEventListener("pazl-opening-2d-deselected", () =>
        setActiveItemId(null)
      );
      BlueprintInterface.globalCustomEvents?.addEventListener(EVENT_LOADED, () =>
        setTimeout(refresh, 50)
      );
      // Live refresh when items are added/removed so the ITEMS count
      // stays in sync with the canvas.
      (BlueprintInterface as any).onItemsChanged?.(() =>
        setTimeout(refresh, 50)
      );
    } catch (e) {
      console.error("outliner subscribe failed", e);
    }
  }, []);

  // Refresh contents when opened (or on mount when docked).
  useEffect(() => {
    if (open || docked) refresh();
  }, [open, docked]);

  const selectNode = (node: Node, kind: "room" | "wall") => {
    if (!node.obj) return;
    setActiveObj(node.obj);
    (BlueprintInterface as any).selectFromOutliner?.(node.obj, kind);
  };

  // Clicking an item row opens its 2D properties panel (doors/windows). If it's
  // not a parametric opening, fall back to selecting the wall it sits on.
  const selectItem = (it: Node, index: number) => {
    const opened = (BlueprintInterface as any).selectOpeningById?.(it?.id);
    if (!opened) {
      (BlueprintInterface as any).selectItemHostWall2D?.(
        it?.id != null ? it.id : index
      );
    }
  };

  if (!docked && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-md bg-[color:var(--pz-panel-surface)] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] px-3 py-2 text-sm font-medium text-black dark:text-white"
        title="Show the scene outline"
      >
        <span className="material-symbols-outlined text-[18px] leading-none text-[color:var(--pz-accent)]">
          account_tree
        </span>{" "}
        Scene
      </button>
    );
  }

  const rowBase =
    "w-full text-left px-2 py-1 rounded text-xs truncate cursor-pointer";
  const sectionLabel =
    "flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[color:var(--pz-accent)] mb-1";
  const countChip =
    "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[color:var(--pz-accent-soft)] text-[color:var(--pz-accent)] text-[10px] font-semibold";
  const isActive = (o: any) => o && o === activeObj;

  return (
    <div
      className={
        docked
          ? "w-full h-full overflow-auto bg-transparent p-3 text-sm"
          : "absolute top-3 left-3 z-10 w-56 max-h-[70vh] overflow-auto rounded-md bg-[color:var(--pz-panel-surface)] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] p-3 text-sm"
      }
    >
      <div
        className={`flex items-center justify-between mb-3 ${
          docked
            ? "-mx-3 -mt-3 px-3 py-2.5 bg-[color:var(--pz-accent-tint)] border-b border-[color:var(--pz-panel-border)]"
            : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] leading-none text-[color:var(--pz-accent)]">
            account_tree
          </span>
          <span className="font-semibold text-black dark:text-white">
            Scene
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
            title="Refresh"
          >
            ⟳
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none text-lg"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Rooms */}
      <div className={`${sectionLabel} mt-1`}>
        <span>Rooms</span>
        <span className={countChip}>{data.rooms.length}</span>
      </div>
      {data.rooms.length === 0 && (
        <p className="text-xs text-gray-400 mb-2">No rooms yet.</p>
      )}
      {data.rooms.map((r, i) => (
        <button
          key={`room-${i}`}
          type="button"
          onClick={() => selectNode(r, "room")}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          className={`px-2 py-1 rounded text-xs cursor-pointer ${
            isActive(r.obj)
              ? "bg-[color:var(--pz-accent)] text-white"
              : "text-black dark:text-white hover:bg-gray-100 dark:hover:bg-[color:var(--pz-panel-hover)]"
          }`}
        >
          <span
            style={{ flex: "none" }}
            className={`w-2 h-2 rounded-full ${
              isActive(r.obj) ? "bg-white" : "bg-[#1D9E75]"
            }`}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.name}
          </span>
        </button>
      ))}

      {/* Walls */}
      <div className={`${sectionLabel} mt-3`}>
        <span>Walls</span>
        <span className={countChip}>{data.walls.length}</span>
      </div>
      {data.walls.map((w, i) => (
        <button
          key={`wall-${i}`}
          type="button"
          onClick={() => selectNode(w, "wall")}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          className={`px-2 py-1 rounded text-xs cursor-pointer ${
            isActive(w.obj)
              ? "bg-[color:var(--pz-accent)] text-white"
              : "text-black dark:text-white hover:bg-gray-100 dark:hover:bg-[color:var(--pz-panel-hover)]"
          }`}
        >
          <span
            style={{ flex: "none" }}
            className={`w-2 h-2 rounded-[2px] ${
              isActive(w.obj) ? "bg-white" : "bg-gray-400"
            }`}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {w.label}
          </span>
        </button>
      ))}

      {/* Items — click selects the wall the item (door) sits on. */}
      <div className={`${sectionLabel} mt-3`}>
        <span>Items</span>
        <span className={countChip}>{data.items.length}</span>
      </div>
      {data.items.length === 0 && (
        <p className="text-xs text-gray-400">No items placed.</p>
      )}
      {data.items.map((it, i) => {
        const itemActive = it.id != null && it.id === activeItemId;
        return (
          <button
            key={`item-${i}`}
            type="button"
            onClick={() => selectItem(it, i)}
            title="Select this door / window"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
            className={`px-2 py-1 rounded text-xs cursor-pointer ${
              itemActive
                ? "bg-[color:var(--pz-accent)] text-white"
                : "text-black dark:text-white hover:bg-gray-100 dark:hover:bg-[color:var(--pz-panel-hover)]"
            }`}
          >
            <span
              style={{ flex: "none" }}
              className={`w-2 h-2 rounded-[2px] ${
                itemActive ? "bg-white" : "bg-gray-400"
              }`}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {it.name}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default SceneOutliner;
