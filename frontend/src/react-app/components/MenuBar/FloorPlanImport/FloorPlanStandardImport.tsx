import React, { useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import "material-symbols";
import { IMPORT_ACCEPT } from "@pazl/main/import/fileCheck";
import { planImage } from "@pazl/main/import/placeImport";
import ImportPreview, { ImportResult } from "./ImportPreview";
import PlanBackgroundControls from "./PlanBackgroundControls";

/**
 * IMPORT PLAN — a floor plan file into the editor, with no AI: PDF, PNG, JPG,
 * WEBP, DXF, DWG or DWFx. The file is checked, read and shown in a preview
 * (ImportPreview) where its page, layers, scale and what to create are
 * chosen; then it is placed in the editor. AI Import stays as it is, beside
 * it.
 *
 * The preview opens on its own root under <body>, not inside this panel: the
 * side panel can be rebuilt by React at any moment (a section toggled, the
 * page's data reloaded), and an import in progress must not go with it. The
 * last import's message is kept here for the same reason.
 */

let lastMessage: string | null = null;
const listeners = new Set<() => void>();
const say = (text: string | null) => {
  lastMessage = text;
  listeners.forEach((fn) => fn());
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const closePreview = (result?: ImportResult) => {
  const r = root;
  root = null;
  // Unmounted after this event, not inside React's own handling of it.
  setTimeout(() => {
    r?.unmount();
    host?.remove();
    host = null;
  });
  if (result) {
    say(result.text);
    if (result.startScale) planImage()?.startScale();
  }
};

const openPreview = (file: File) => {
  if (root) return;
  say(null);
  host = document.createElement("div");
  host.className = document.documentElement.classList.contains("dark") ? "dark" : "";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ImportPreview file={file} onClose={closePreview} />);
};

const pickFile = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = IMPORT_ACCEPT;
  input.style.display = "none";
  const done = () => input.remove();
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    done();
    if (file) openPreview(file);
  });
  input.addEventListener("cancel", done);
  document.body.appendChild(input);
  input.click();
};

const FloorPlanStandardImport: React.FC = () => {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={pickFile}
        className="w-full flex items-center justify-center gap-1.5 rounded-md border border-[color:var(--pz-panel-border)] px-2.5 py-1.5 text-xs font-medium text-black dark:text-white hover:bg-[color:var(--pz-panel-hover)]"
        title="Import a floor plan file without AI: PDF, image, DXF, DWG or DWFx"
      >
        <span className="material-symbols-outlined text-[18px]">upload_file</span> Import plan
      </button>
      <p className="mt-2 text-[11px] leading-snug text-[color:var(--pz-text-2)]">
        PDF, DXF. Read exactly
      </p>
      {lastMessage ? <p className="mt-1 text-[11px] leading-snug text-green-600 dark:text-green-400">{lastMessage}</p> : null}
      <div className="mt-2">
        <PlanBackgroundControls />
      </div>
    </div>
  );
};

export default FloorPlanStandardImport;
