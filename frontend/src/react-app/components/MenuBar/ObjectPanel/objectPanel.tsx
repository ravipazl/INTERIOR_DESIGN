import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TETabs, TETabsContent, TETabsItem } from "tw-elements-react";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import ObjectProperties from "./objectProperties";
import { MaterialTabContext } from "./materialTabContext";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";

interface ObjectPanelProps {
  onHideObjectPanel: () => void;
  selectedModel: FurnishedModel;
  isMultiSelectMode: boolean;
}

enum ObjectPanelTabs {
  MATERIAL = "material",
  PROPERTIES = "properties",
}

function ObjectPanel({
  onHideObjectPanel,
  selectedModel,
  isMultiSelectMode,
}: ObjectPanelProps) {
  // Material is the first tab and the one an item click lands on. The finish
  // panel used to float over the canvas; it now renders into this tab through
  // MaterialTabContext.
  const [activeTab, setActiveTab] = useState(ObjectPanelTabs.MATERIAL);
  const [materialContainer, setMaterialContainer] =
    useState<HTMLDivElement | null>(null);
  const [isMaterialOpen, setIsMaterialOpen] = useState(false);
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;

  // A part was picked in 3D (or in the parts list) → show its finishes.
  // Only the moment it OPENS pulls you to the Material tab: switching on every
  // call would drag you back here while you were reading Properties.
  const wasMaterialOpen = useRef(false);
  const setMaterialOpen = useCallback((open: boolean) => {
    if (open && !wasMaterialOpen.current) setActiveTab(ObjectPanelTabs.MATERIAL);
    wasMaterialOpen.current = open;
    setIsMaterialOpen(open);
  }, []);

  // Stable value: a fresh object each render would re-run the consumer's effect
  // on every render.
  const materialTabValue = useMemo(
    () => ({ container: materialContainer, setMaterialOpen }),
    [materialContainer, setMaterialOpen]
  );

  // A different item was clicked: back to Material, with no part chosen yet.
  useEffect(() => {
    setActiveTab(ObjectPanelTabs.MATERIAL);
    setIsMaterialOpen(false);
  }, [selectedModel?._id]);

  // No right-edge space is reserved any more: this panel is fixed to the right
  // edge and OVERLAYS the canvas. Reserving space made the 3D canvas shrink and
  // re-project its camera every time a panel opened or closed — see the comment
  // in pages/DrawingComponent/index.tsx.

  const handleTabItemClick = (tabItem: ObjectPanelTabs) => {
    if (tabItem === activeTab) {
      return;
    }
    console.debug(
      "🚀 ~ file: objectPanel.tsx:71 ~ handleTabItemClick ~ tabItem:",
      tabItem
    );
    setActiveTab(tabItem);
  };

  return (
    <MaterialTabContext.Provider value={materialTabValue}>
    {/* data-pz-canvas-overlay: this panel sits ON TOP of the canvas, so the 3D
        item toolbar keeps itself to the left of it instead of hiding under. */}
    <div
      data-pz-canvas-overlay="right"
      className="pz-animate-in flex flex-col justify-between fixed top-[100px] bottom-0 right-0 z-10 w-full max-w-sm h-auto shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-[color:var(--pz-panel-surface)]"
    >
      {/* This wrapper is a flex COLUMN that claims the panel's remaining
          height (flex-1) and is allowed to shrink below its content
          (min-h-0). Both are needed.

          It used to be a plain `relative` div. The panel around it has a real
          height — `top-[100px]` plus `bottom-0` — but a flex item defaults to
          `min-height: auto`, meaning it refuses to shrink below its content.
          So with a long components list this wrapper simply grew past the
          bottom of the panel and off the screen. The `overflow-y-auto` on
          TETabsContent never fired, because an element that is never
          constrained never overflows: the scrollbar had nothing to scroll.

          The visible symptom was that the mesh list ended wherever the window
          ended, and zooming the browser out revealed more of it — people were
          compensating for a missing scrollbar with page zoom. */}
      <div className="relative flex flex-col flex-1 min-h-0">
        <TETabs className="mb-0 items-center shrink-0">
          {[ObjectPanelTabs.MATERIAL, ObjectPanelTabs.PROPERTIES].map(
            (item, index) => (
              <TETabsItem
                key={index}
                onClick={() => handleTabItemClick(item)}
                active={activeTab === item}
                tag="button"
                className={`p-3 mt-0 ${
                  activeTab === item
                    ? "bg-[color:var(--pz-panel-surface)] border-t border-r border-l border-b-0 border-inherit"
                    : ""
                }`}
              >
                <span className={`${activeTab === item ? "font-bold" : ""}`}>
                  {convertToTitleCase(item)}
                </span>
              </TETabsItem>
            )
          )}
          {/* auto keeps the X hard right whatever the tabs are named */}
          <img
            className="finishing-modal-close-icon"
            src={require("../../../images/close.svg")}
            onClick={onHideObjectPanel}
            style={{ marginLeft: "auto", marginRight: "12px" }}
          />
        </TETabs>
        {/* flex-1 + min-h-0 give this element a bounded height, which is what
            finally makes its overflow-y-auto produce a real scrollbar. */}
        <TETabsContent className="m-0 flex-1 min-h-0 overflow-y-auto border-t-2 bg-[color:var(--pz-panel-surface)]">
          {/* Material: the finish panel portals itself in here (see
              MaterialTabContext). Until a part is picked there is nothing to
              show, so the hint takes its place — the app deliberately does not
              pick a part for you (objectComponents.tsx, the auto-open effect). */}
          <div
            ref={setMaterialContainer}
            className="px-2 py-2"
            style={{
              display: activeTab === ObjectPanelTabs.MATERIAL ? "block" : "none",
            }}
          >
            {!isMaterialOpen ? (
              <p className="p-4 text-sm text-center text-neutral-500 dark:text-neutral-300">
                Click a part of this item in 3D to choose its finish.
              </p>
            ) : null}
          </div>
          {/* Properties stays MOUNTED and is only hidden, for two reasons: the
              finish panel it owns is portalled into the Material tab above, and
              unmounting would throw away the selected part, the loaded finishes
              and the scroll position every time you switch tabs. */}
          <div
            className="px-2 py-2"
            style={{
              display:
                activeTab === ObjectPanelTabs.PROPERTIES ? "block" : "none",
            }}
          >
            <ObjectProperties
              selectedModel={selectedModel}
              isDarkMode={isDarkMode}
              onHideObjectPanel={onHideObjectPanel}
              isMultiSelectMode={isMultiSelectMode}
            />
          </div>
        </TETabsContent>
      </div>
      {isMultiSelectMode ? (
        <div className="multimode-selection">
          <p className="multimode-text">Multi select enabled</p>
        </div>
      ) : null}
    </div>
    </MaterialTabContext.Provider>
  );
}

export default ObjectPanel;
