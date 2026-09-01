import React, { useEffect, useRef, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import {
  handleSelectedModel,
  handleNo3DItemSelected,
} from "@pazl/events/event-interface";
import { EVENT_LOADED } from "@pazl/main/core/events";

type RoomNode = { obj?: any; name?: string };
type ItemNode = { id?: any; name?: string };
type OutlineData = { rooms: RoomNode[]; walls: any[]; items: ItemNode[] };

// Best-effort icon per item, matched on keywords in the item's name.
// Falls back to a generic "category" glyph so every row still has an icon.
const iconForItem = (name?: string): string => {
  const n = (name || "").toLowerCase();
  const map: [RegExp, string][] = [
    [/sofa|couch|settee/, "weekend"],
    [/chair|stool|seat/, "chair"],
    [/bed|mattress/, "bed"],
    [/table|desk/, "table_restaurant"],
    [/tv|television|monitor|screen/, "tv"],
    [/lamp|light|chandelier/, "lightbulb"],
    [/door/, "door_front"],
    [/window/, "window"],
    [/plant|tree|flower/, "potted_plant"],
    [/rug|carpet|mat/, "crop_square"],
    [/cabinet|wardrobe|cupboard|shelf|drawer|storage/, "shelves"],
    [/sink|bath|toilet|shower/, "bathtub"],
    [/kitchen|stove|oven|fridge|refrigerator/, "kitchen"],
    [/fan/, "mode_fan"],
    [/art|picture|frame|paint/, "image"],
  ];
  for (const [re, icon] of map) if (re.test(n)) return icon;
  return "category";
};

/**
 * Furnish (3D) outliner — Pascal-style hierarchy for the 3D view.
 * Rooms: click → camera frames the room. Items: click → selects + highlights
 * the item, shows its transform gizmo, and flies the camera to it (node focus).
 * Selecting an item in the 3D canvas highlights its row here.
 */
const FurnishOutliner: React.FC<{
  docked?: boolean;
  onClose?: () => void;
}> = ({ docked = false, onClose }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OutlineData>({
    rooms: [],
    walls: [],
    items: [],
  });
  const [activeItemId, setActiveItemId] = useState<any>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const subscribed = useRef(false);

  const toggleVisible = (id: any) => {
    if (id == null) return;
    const next = !hidden[id]; // next = currently visible? -> hide
    setHidden((h) => ({ ...h, [id]: next }));
    (BlueprintInterface as any).setItem3DVisible?.(id, !next);
  };

  const refresh = () => {
    try {
      const d = (BlueprintInterface as any).getOutlineData?.();
      if (d) setData(d);
    } catch (e) {
      console.error("furnish outliner refresh failed", e);
    }
  };

  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;
    try {
      handleSelectedModel((evt: any) => {
        const id = evt?.itemModel?.__id || evt?.item?.itemModel?.__id;
        setActiveItemId(id ?? null);
      });
      handleNo3DItemSelected(() => setActiveItemId(null));
      BlueprintInterface.globalCustomEvents?.addEventListener(EVENT_LOADED, () =>
        setTimeout(refresh, 50)
      );
      // Live refresh when items are added/removed in the 3D scene so the
      // ITEMS count stays in sync with what's actually placed.
      (BlueprintInterface as any).onItemsChanged?.(() =>
        setTimeout(refresh, 50)
      );
    } catch (e) {
      console.error("furnish outliner subscribe failed", e);
    }
  }, []);

  useEffect(() => {
    if (open || docked) refresh();
  }, [open, docked]);

  // Clear any leftover canvas shift from the earlier docked attempt, so the 3D
  // view returns to full width.
  useEffect(() => {
    const v3d = document.getElementById("bp3djs-viewer3d");
    if (v3d && v3d.style.marginLeft) {
      v3d.style.marginLeft = "";
      window.dispatchEvent(new Event("resize"));
    }
  }, []);

  const selectItem = (it: ItemNode) => {
    if (it.id == null) return;
    setActiveItemId(it.id);
    (BlueprintInterface as any).selectItem3DById?.(it.id);
  };
  const focusRoom = (r: RoomNode) => {
    if (!r.obj) return;
    (BlueprintInterface as any).focusRoom3D?.(r.obj);
  };

  // Collapsed launcher chip — only in floating mode. When docked, the sidebar
  // is always shown (it lives in the layout, pushing the canvas).
  if (!docked && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-[120px] left-3 z-20 flex items-center gap-1 rounded-md bg-[color:var(--pz-panel-header)] border border-[color:var(--pz-panel-border)] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] px-3 py-2 text-sm font-medium text-black dark:text-white"
        title="Show the scene outline"
      >
        <span className="text-base">☰</span> Outline
      </button>
    );
  }

  const rowBase =
    "w-full text-left px-2 py-1 rounded text-xs cursor-pointer";

  // Expanded: a polished floating panel (top-left). Reliable + visible.
  const sectionLabel =
    "text-[10px] font-semibold uppercase tracking-wider text-[color:var(--pz-accent)] px-1 mb-1";
  const countChip =
    "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[color:var(--pz-accent-soft)] text-[color:var(--pz-accent)] text-[10px] font-semibold";

  return (
    <div
      className={
        docked
          ? "w-full h-full flex flex-col overflow-hidden bg-transparent text-sm"
          : "absolute top-[120px] left-3 z-20 w-60 max-h-[calc(100vh-260px)] flex flex-col overflow-hidden rounded-lg border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] shadow-[0_4px_12px_rgba(0,0,0,0.15)] text-sm"
      }
    >
      {/* Sticky header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[color:var(--pz-accent-tint)] border-b border-[color:var(--pz-panel-border)]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] leading-none text-[color:var(--pz-accent)]">
            account_tree
          </span>
          <span className="font-semibold text-black dark:text-white">
            Scene
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm"
            title="Refresh"
          >
            ⟳
          </button>
          {/* Close: when docked, ask the parent to hide the panel (via onClose);
              when floating, just collapse to the launcher chip. */}
          {(!docked || onClose) && (
            <button
              type="button"
              onClick={() => (docked && onClose ? onClose() : setOpen(false))}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 leading-none text-lg"
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto p-2.5">
        {/* Rooms — click flies the camera to the room */}
        <div className={`${sectionLabel} flex items-center justify-between`}>
          <span>Rooms</span>
          <span className={countChip}>{data.rooms.length}</span>
        </div>
        {data.rooms.length === 0 ? (
          <p className="text-xs text-gray-400 px-1 mb-3">No rooms yet.</p>
        ) : (
          <div className="mb-3 space-y-0.5">
            {data.rooms.map((r, i) => (
              <button
                key={`room-${i}`}
                type="button"
                onClick={() => focusRoom(r)}
                className={`${rowBase} flex items-center gap-2 min-w-0 text-black dark:text-gray-100 hover:bg-[color:var(--pz-panel-hover)]`}
                title="Focus camera on this room"
              >
                <span className="material-symbols-outlined text-[16px] leading-none text-[#1D9E75] shrink-0">
                  home
                </span>
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Items — click selects + focuses the item; eye toggles visibility */}
        <div className={`${sectionLabel} flex items-center justify-between`}>
          <span>Items</span>
          <span className={countChip}>{data.items.length}</span>
        </div>
        {data.items.length === 0 ? (
          <p className="text-xs text-gray-400 px-1">No items placed.</p>
        ) : (
          <div className="space-y-0.5">
            {data.items.map((it, i) => {
              const active = it.id != null && it.id === activeItemId;
              const isHidden = it.id != null && hidden[it.id];
              return (
                <div
                  key={`item-${i}`}
                  className={`group ${rowBase} flex items-center gap-2 pr-1 ${
                    active
                      ? "bg-[color:var(--pz-accent)] text-white"
                      : "text-black dark:text-gray-100 hover:bg-[color:var(--pz-panel-hover)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectItem(it)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    title="Select and focus this item"
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] leading-none shrink-0 ${
                        active ? "text-white" : "text-[color:var(--pz-accent)]"
                      }`}
                    >
                      {iconForItem(it.name)}
                    </span>
                    <span className={`truncate ${isHidden ? "opacity-40 line-through" : ""}`}>
                      {it.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleVisible(it.id)}
                    className={`shrink-0 flex items-center justify-center w-6 h-6 rounded transition-opacity ${
                      isHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    } ${active ? "text-white hover:bg-white/20" : "text-gray-400 hover:text-[color:var(--pz-accent)] hover:bg-[color:var(--pz-panel-hover)]"}`}
                    title={isHidden ? "Show in 3D" : "Hide in 3D"}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      {isHidden ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FurnishOutliner;
