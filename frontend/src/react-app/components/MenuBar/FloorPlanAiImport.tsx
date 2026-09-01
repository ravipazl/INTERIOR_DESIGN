import React, { useRef, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { FloorPlanAiService } from "@pazl/services/FloorPlanAiService";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "done";
      walls: number;
      rooms: number;
      doors: number;
      windows: number;
    }
  | { kind: "error"; message: string };

/**
 * AI floor-plan import. Lets the user drop in a plan (PDF or image); the
 * backend vectorizes the walls with Claude, and we load the result into the
 * 2D editor as an editable DRAFT (same apply path as a template), so the user
 * can refine corners/dimensions afterward.
 */
const FloorPlanAiImport: React.FC<{ inline?: boolean }> = ({
  inline = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [open, setOpen] = useState(false);

  const pick = () => {
    if (status.kind === "loading") return;
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    setStatus({ kind: "loading" });
    try {
      const result = await FloorPlanAiService.fetchFloorplan(file);
      // Apply exactly like a template: load + register undo/persist history.
      BlueprintInterface.handleTemplateUpdate(
        JSON.stringify({ floorplan: result.floorplan, items: [] })
      );
      // AI plans are built by loadFloorplan, which (unlike manual drawing) does
      // NOT split walls at T-junctions/crossings — so partition walls meeting the
      // middle of a perimeter wall don't connect and rooms never close. Heal the
      // intersections in bulk (same as manual drawing) so rooms form correctly.
      try {
        BlueprintInterface.healFloorplanIntersections?.();
      } catch (healErr) {
        console.error("AI import: heal intersections failed", healErr);
      }
      // Plan is now loaded (walls + rooms exist): place detected doors on the
      // nearest wall and apply detected room names. Both are best-effort and
      // never block the import.
      let doors = 0;
      let windows = 0;
      try {
        doors = BlueprintInterface.placeAiDoors?.(result.openings) || 0;
        windows = BlueprintInterface.placeAiWindows?.(result.windows) || 0;
        BlueprintInterface.applyAiRoomNames?.(result.rooms);
      } catch (annotateErr) {
        console.error(
          "AI annotation (doors/windows/room names) failed",
          annotateErr
        );
      }
      // Snapshot AFTER doors + names so undo/persist captures the whole result.
      BlueprintInterface.ProjectManagerService?.updateFloorPlan(
        HISTORY_TITLES.FLOORPLAN_UPDATED
      );
      setStatus({
        kind: "done",
        walls: result.wallCount,
        rooms: result.roomCount,
        doors,
        windows,
      });
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Could not read this plan. Try a clearer PDF or image.";
      setStatus({ kind: "error", message });
    }
  };

  const loading = status.kind === "loading";

  // Hidden file input — kept available in every mode so pick() works.
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,image/png,image/jpeg,image/webp"
      className="hidden"
      onChange={onFile}
    />
  );

  // INLINE (sidebar) mode: the button opens the file picker DIRECTLY (one click)
  // and shows status right here — no separate floating box that pops up far from
  // the button (which made it look like nothing happened).
  if (inline) {
    return (
      <div className="w-full">
        {fileInput}
        <button
          type="button"
          onClick={pick}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-1.5 rounded-md border border-[color:var(--pz-panel-border)] px-2.5 py-1.5 text-xs font-medium ${
            loading
              ? "opacity-60 cursor-not-allowed"
              : "text-black dark:text-white hover:bg-[color:var(--pz-panel-hover)]"
          }`}
          title="Import a floor plan with AI (PDF or image)"
        >
          <span className="material-symbols-outlined text-[18px]">
            auto_awesome
          </span>{" "}
          {loading ? "Reading plan…" : "AI Import"}
        </button>
        {status.kind === "done" && (
          <p className="mt-1 text-[11px] text-green-600 dark:text-green-400 leading-snug">
            Imported {status.walls} wall{status.walls === 1 ? "" : "s"}
            {status.rooms
              ? ` · ${status.rooms} room${status.rooms === 1 ? "" : "s"}`
              : ""}
            {status.doors
              ? ` · ${status.doors} door${status.doors === 1 ? "" : "s"}`
              : ""}
            {status.windows
              ? ` · ${status.windows} window${status.windows === 1 ? "" : "s"}`
              : ""}
            .
          </p>
        )}
        {status.kind === "error" && (
          <p className="mt-1 text-[11px] text-red-600 dark:text-red-400 leading-snug">
            {status.message}
          </p>
        )}
      </div>
    );
  }

  // Collapsed launcher: a sidebar button when inline, else a floating chip.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          inline
            ? "w-full flex items-center justify-center gap-1.5 rounded-md border border-[color:var(--pz-panel-border)] px-2.5 py-1.5 text-xs font-medium text-black dark:text-white hover:bg-[color:var(--pz-panel-hover)]"
            : "fixed top-[200px] left-[260px] z-10 flex items-center gap-1 rounded-md bg-white dark:bg-[#4E4E4E] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] px-3 py-2 text-sm font-medium text-black dark:text-white"
        }
        title="Import a floor plan with AI"
      >
        <span className="material-symbols-outlined text-[18px]">
          auto_awesome
        </span>{" "}
        AI Import
      </button>
    );
  }

  return (
    <div className="fixed top-[200px] left-[260px] z-10 w-60 rounded-md bg-white dark:bg-[#4E4E4E] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] p-3 text-sm">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFile}
      />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">✨</span>
          <span className="font-semibold text-black dark:text-white">
            AI Floor-plan Import
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={loading}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none text-lg"
          title="Close"
        >
          ×
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-300 mb-2 leading-snug">
        Upload a floor-plan PDF or image. Claude traces the walls into an
        editable draft.
      </p>
      <button
        type="button"
        onClick={pick}
        disabled={loading}
        className={`w-full rounded px-3 py-2 font-medium text-white ${
          loading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-[#2F6FED] hover:bg-[#2559c4]"
        }`}
      >
        {loading ? "Reading plan…" : "Choose plan (PDF / image)"}
      </button>

      {status.kind === "done" && (
        <p className="mt-2 text-xs text-green-600 dark:text-green-400">
          Imported {status.walls} wall{status.walls === 1 ? "" : "s"}
          {status.rooms ? ` · ${status.rooms} room${status.rooms === 1 ? "" : "s"}` : ""}
          {status.doors ? ` · ${status.doors} door${status.doors === 1 ? "" : "s"}` : ""}
          {status.windows ? ` · ${status.windows} window${status.windows === 1 ? "" : "s"}` : ""}.
          Refine as needed.
        </p>
      )}
      {status.kind === "error" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {status.message}
        </p>
      )}
    </div>
  );
};

export default FloorPlanAiImport;
