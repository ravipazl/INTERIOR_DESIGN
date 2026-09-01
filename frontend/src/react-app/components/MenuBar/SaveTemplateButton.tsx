import React, { useState } from "react";
import { createPortal } from "react-dom";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { FloorPlanTemplateService } from "@pazl/services/FloorPlanTemplateService";

type Phase =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Snapshot the current 2D floor-plan view as a small PNG data-URL, so each
 * saved template shows a real preview. Uses Pixi's Extract plugin (reliable
 * even without preserveDrawingBuffer); returns undefined on any failure so a
 * save never blocks on the thumbnail.
 */
function capture2DThumbnail(maxW = 360): string | undefined {
  try {
    const app: any = (BlueprintInterface as any).blueprint3d?.floorplanner;
    const renderer = app?.renderer;
    if (!renderer?.plugins?.extract || !app?.stage) return undefined;
    renderer.render(app.stage); // force a fresh frame before extracting
    const src: HTMLCanvasElement = renderer.plugins.extract.canvas();
    if (!src?.width || !src?.height) return undefined;

    const scale = Math.min(1, maxW / src.width);
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(src, 0, 0, w, h);
    return out.toDataURL("image/png");
  } catch (e) {
    console.error("template thumbnail capture failed", e);
    return undefined;
  }
}

/**
 * Save the current floor plan as a permanent, reusable template (stored in the
 * backend `floorplan-templates` collection). It then shows up in the Templates
 * gallery for everyone — no re-import needed.
 */
const SaveTemplateButton: React.FC<{ inline?: boolean }> = ({
  inline = false,
}) => {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [name, setName] = useState("");

  const open = () => {
    setName("");
    setPhase({ kind: "naming" });
  };

  const close = () => {
    if (phase.kind !== "saving") setPhase({ kind: "idle" });
  };

  const save = async () => {
    const title = name.trim();
    if (!title) return;
    setPhase({ kind: "saving" });
    try {
      const sceneJson =
        BlueprintInterface.blueprint3d.model.exportSerialized();
      const parsed = JSON.parse(sceneJson);
      if (!parsed?.floorplan?.walls?.length) {
        setPhase({
          kind: "error",
          message: "Draw or import a floor plan first.",
        });
        return;
      }
      const coverImageUrl = capture2DThumbnail();
      await FloorPlanTemplateService.save(title, sceneJson, { coverImageUrl });
      setPhase({ kind: "done" });
      setTimeout(() => setPhase({ kind: "idle" }), 2500);
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Could not save template.";
      setPhase({ kind: "error", message });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={
          inline
            ? "w-full flex items-center justify-center gap-1.5 rounded-md border border-[color:var(--pz-panel-border)] px-2.5 py-1.5 text-xs font-medium text-black dark:text-white hover:bg-[color:var(--pz-panel-hover)]"
            : "fixed bottom-3 left-[260px] z-10 flex items-center gap-1 rounded-md bg-white dark:bg-[#4E4E4E] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] px-3 py-2 text-sm font-medium text-black dark:text-white"
        }
        title="Save the current floor plan as a reusable template"
      >
        <span className="material-symbols-outlined text-[18px]">save</span> Save
      </button>

      {phase.kind !== "idle" &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
            onClick={close}
          >
          <div
            className="w-80 rounded-md bg-white dark:bg-[#333333] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 font-semibold text-black dark:text-white">
              Save as template
            </h3>

            {phase.kind === "done" ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Saved. It's now in the Templates gallery.
              </p>
            ) : (
              <>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                  placeholder="Template name"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-black dark:bg-[#4E4E4E] dark:text-white dark:border-gray-600"
                />
                {phase.kind === "error" && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {phase.message}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPhase({ kind: "idle" })}
                    disabled={phase.kind === "saving"}
                    className="rounded px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={phase.kind === "saving" || !name.trim()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      phase.kind === "saving" || !name.trim()
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-[#2F6FED] hover:bg-[#2559c4]"
                    }`}
                  >
                    {phase.kind === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
          document.body
        )}
    </>
  );
};

export default SaveTemplateButton;
