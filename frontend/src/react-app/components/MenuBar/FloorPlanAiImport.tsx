import React, { useEffect, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { FloorPlanAiService } from "@pazl/services/FloorPlanAiService";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import Toast, { ToastState } from "../Toast";

// Step-by-step lines in the browser console (F12), so a failed import shows
// where it stopped: [AI import] …
const aiLog = (...parts: any[]) => console.info("[AI import]", ...parts);
// The drawing page has a ~64px toolbar across the top (Save, saved time…);
// the toast sits just below it instead of covering those buttons.
const TOAST_TOP = 76;
/** Walls currently on the 2D canvas (to confirm the plan really got drawn). */
const wallsOnCanvas = (): number => {
  try {
    return (
      BlueprintInterface.blueprint3d?.model?.floorplan?.getWalls?.()?.length ?? -1
    );
  } catch {
    return -1;
  }
};

/** A plain reason the import failed, for the toast and the note under the button. */
const importErrorMessage = (err: any): string => {
  // The backend explains its own failures (too large, can't read, sign in…).
  const serverMsg = err?.response?.data?.message;
  if (serverMsg) return serverMsg;
  if (err?.isAxiosError && !err?.response) {
    return err?.code === "ECONNABORTED" || /timeout/i.test(err?.message || "")
      ? "Reading the plan took too long. Try a smaller or clearer file."
      : "Couldn't reach the server. Check your connection and try again.";
  }
  if (err?.phase === "draw") {
    return "The plan was read, but it couldn't be drawn. Please try again.";
  }
  return err?.message || "Couldn't read this plan. Try a clearer PDF or image.";
};

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

/*
 * The import's state lives HERE, outside the component. The side panel that
 * holds the button can be rebuilt by React at any moment (e.g. while the OS
 * file dialog is open); state kept inside the component — and a file box
 * rendered by it — was thrown away with it, so the chosen file went nowhere
 * and nothing was imported. Every mounted button just shows this shared state.
 */
let importStatus: Status = { kind: "idle" };
let importToast: ToastState = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

const setStatus = (s: Status) => {
  importStatus = s;
  notify();
};
const showToast = (
  text: string,
  type: "success" | "error" | "info",
  ms = 6000
) => {
  importToast = { type, text };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = ms
    ? setTimeout(() => {
        importToast = null;
        notify();
      }, ms)
    : null;
  notify();
};

/**
 * Opens the file dialog with a file box made just for this pick and attached
 * to <body>, so it cannot be removed by a re-render while the dialog is open.
 */
const pickPlanFile = () => {
  if (importStatus.kind === "loading") {
    aiLog("button clicked while an import is running — ignored");
    return;
  }
  aiLog("button clicked — opening the file picker");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,image/png,image/jpeg,image/webp";
  input.style.display = "none";
  const done = () => input.remove();
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    done();
    if (!file) {
      aiLog("no file chosen");
      return;
    }
    runImport(file);
  });
  input.addEventListener("cancel", () => {
    aiLog("no file chosen");
    done();
  });
  document.body.appendChild(input);
  input.click();
};

const runImport = async (file: File) => {
    aiLog(
      `file chosen: "${file.name}" ${file.type || "?"} ${(file.size / 1048576).toFixed(1)} MB — uploading`
    );

    setStatus({ kind: "loading" });
    showToast("Reading the plan… this can take up to a minute.", "info", 0);
    try {
      const result = await FloorPlanAiService.fetchFloorplan(file);
      aiLog(
        `backend answered: ${result.wallCount} walls, ${result.roomCount} rooms, ${result.openings.length} doors, ${result.windows.length} windows`
      );
      // Apply exactly like a template: load + register undo/persist history.
      try {
        BlueprintInterface.handleTemplateUpdate(
          JSON.stringify({ floorplan: result.floorplan, items: [] })
        );
        aiLog(`drawn: ${wallsOnCanvas()} walls on the canvas`);
      } catch (drawErr: any) {
        console.error("AI import: drawing the plan failed", drawErr);
        throw Object.assign(new Error(drawErr?.message || "draw failed"), {
          phase: "draw",
        });
      }
      // AI plans are built by loadFloorplan, which (unlike manual drawing) does
      // NOT split walls at T-junctions/crossings — so partition walls meeting the
      // middle of a perimeter wall don't connect and rooms never close. Heal the
      // intersections in bulk (same as manual drawing) so rooms form correctly.
      try {
        BlueprintInterface.healFloorplanIntersections?.();
        aiLog(`walls joined: ${wallsOnCanvas()} walls on the canvas`);
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
      aiLog(
        `saved: ${wallsOnCanvas()} walls, ${doors} doors, ${windows} windows placed`
      );
      setStatus({
        kind: "done",
        walls: result.wallCount,
        rooms: result.roomCount,
        doors,
        windows,
      });
      const plural = (n: number, word: string) =>
        `${n} ${word}${n === 1 ? "" : "s"}`;
      showToast(
        `Floor plan imported: ${[
          plural(result.wallCount, "wall"),
          result.roomCount ? plural(result.roomCount, "room") : "",
          doors ? plural(doors, "door") : "",
          windows ? plural(windows, "window") : "",
        ]
          .filter(Boolean)
          .join(" · ")}. Refine as needed.`,
        "success"
      );
    } catch (err: any) {
      console.error("AI import failed", err);
      const message = importErrorMessage(err);
      setStatus({ kind: "error", message });
      showToast(message, "error", 8000);
    }
};

/**
 * AI floor-plan import. Lets the user drop in a plan (PDF or image); the
 * backend vectorizes the walls with Claude, and we load the result into the
 * 2D editor as an editable DRAFT (same apply path as a template), so the user
 * can refine corners/dimensions afterward.
 */
const FloorPlanAiImport: React.FC<{ inline?: boolean }> = ({
  inline = false,
}) => {
  const [open, setOpen] = useState(false);
  // Re-render whenever the shared import state changes.
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const status = importStatus;
  const toast = importToast;
  const pick = pickPlanFile;

  const loading = status.kind === "loading";

  // INLINE (sidebar) mode: the button opens the file picker DIRECTLY (one click)
  // and shows status right here — no separate floating box that pops up far from
  // the button (which made it look like nothing happened).
  if (inline) {
    return (
      <div className="w-full">
        <Toast toast={toast} top={TOAST_TOP} />
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
            : "fixed top-[200px] left-[calc(var(--pz-nav-w,0px)+260px)] z-10 flex items-center gap-1 rounded-md bg-white dark:bg-[#4E4E4E] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] px-3 py-2 text-sm font-medium text-black dark:text-white"
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
    <div className="fixed top-[200px] left-[calc(var(--pz-nav-w,0px)+260px)] z-10 w-60 rounded-md bg-white dark:bg-[#4E4E4E] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] p-3 text-sm">
      <Toast toast={toast} top={TOAST_TOP} />
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
