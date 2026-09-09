import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a tab's toolbar into the slot inside AppHeader, so the tools sit in
 * the top navigation bar instead of a second row beneath it.
 *
 * A portal rather than moving the markup: the toolbars belong to
 * floorPlanMenu / furnishMenu, which own the click handlers, the active mode,
 * the loader and every modal those buttons open. Hoisting that state up to
 * AppHeader just to relocate a <div> would be a large refactor for a purely
 * visual change. The portal moves only where the DOM lands.
 *
 * Falls back to rendering in place if the slot is missing, so the toolbar can
 * never disappear — a missing slot degrades to the old two-row layout rather
 * than to no tools at all.
 */
export const TOOLBAR_SLOT_ID = "pz-toolbar-slot";

const ToolbarPortal: React.FC<{
  children: React.ReactNode;
  /**
   * Whether this tab is the one on screen.
   *
   * This has to be passed in, and it is the whole reason the prop exists: a
   * portal renders into the slot in AppHeader, which is OUTSIDE the pane that
   * MenuBar hides. MenuBar hides inactive panes rather than unmounting them, so
   * every menu stays mounted and every portal keeps firing — hiding the pane
   * does nothing to the toolbar that escaped it. Without this flag the Floor
   * plan and 3D toolbars both sit in the navbar at once, which is how undo,
   * redo and select ended up duplicated up there.
   */
  active?: boolean;
}> = ({ children, active = true }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Runs after AppHeader has committed, so the slot exists by now.
    setSlot(document.getElementById(TOOLBAR_SLOT_ID));
  }, []);

  // Hidden, not unmounted — the same choice MenuBar makes for the panes. The
  // buttons carry open-dropdown state and a shared buttonRef; remounting them
  // on every tab switch would discard that for no gain, since display:none
  // already takes them out of both the layout and the tab order.
  const body = active ? children : <div style={{ display: "none" }}>{children}</div>;

  if (!slot) return <>{body}</>;
  return createPortal(body, slot);
};

export default ToolbarPortal;
