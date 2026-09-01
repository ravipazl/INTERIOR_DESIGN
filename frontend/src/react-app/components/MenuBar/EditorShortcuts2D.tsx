import { useEffect } from "react";
import BlueprintInterface from "@pazl/blueprint-interface.js";

/**
 * Basic 2D editor keyboard shortcuts (floor-plan tab):
 *   Ctrl/Cmd+Z         undo          Ctrl/Cmd+Shift+Z / Ctrl+Y   redo
 *   Ctrl/Cmd+C         copy opening  Ctrl/Cmd+V                  paste opening
 *   Ctrl/Cmd+D         duplicate     Delete / Backspace          delete opening
 * Ignored while typing in an input/select so the property panel keeps working.
 */
const EditorShortcuts2D: React.FC = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t && t.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t && t.isContentEditable)
      ) {
        return;
      }
      const B = BlueprintInterface as any;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (ctrl && k === "z") {
        e.preventDefault();
        if (e.shiftKey) B?.actionsHistory2DManager?.redo?.();
        else B?.actionsHistory2DManager?.undo?.();
      } else if (ctrl && k === "y") {
        e.preventDefault();
        B?.actionsHistory2DManager?.redo?.();
      } else if (ctrl && k === "c") {
        B?.copyOpening2D?.();
      } else if (ctrl && k === "v") {
        e.preventDefault();
        B?.pasteOpening2D?.();
      } else if (ctrl && k === "d") {
        e.preventDefault();
        B?.duplicateOpening2D?.();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (B?.getSelectedOpening2D?.()) {
          e.preventDefault();
          B?.deleteSelectedOpening2D?.();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
};

export default EditorShortcuts2D;
