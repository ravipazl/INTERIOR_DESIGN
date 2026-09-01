import React, { useState } from "react";
import {
  TETabs,
  TETabsContent,
  TETabsItem,
  TETabsPane,
} from "tw-elements-react";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import ObjectProperties from "./objectProperties";
import ObjectVisibilityAndBilling from "./objectVisibilityAndBilling";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";

interface ObjectPanelProps {
  onHideObjectPanel: () => void;
  selectedModel: FurnishedModel;
  isMultiSelectMode: boolean;
}

enum ObjectPanelTabs {
  PROPERTIES = "properties",
  BILLING = "billing",
}

function ObjectPanel({
  onHideObjectPanel,
  selectedModel,
  isMultiSelectMode,
}: ObjectPanelProps) {
  const [activeTab, setActiveTab] = useState(ObjectPanelTabs.PROPERTIES);
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;

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
    <div className="pz-animate-in flex flex-col justify-between fixed top-[100px] bottom-0 right-0 z-10 w-full max-w-sm h-auto shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-[color:var(--pz-panel-surface)]">
      <div className="relative">
        <TETabs className="mb-0 items-center">
          {[ObjectPanelTabs.PROPERTIES, ObjectPanelTabs.BILLING].map(
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
          <img
            className="finishing-modal-close-icon"
            src={require("../../../images/close.svg")}
            onClick={onHideObjectPanel}
            style={{ marginLeft: "12em" }}
          />
        </TETabs>
        <TETabsContent className="m-0 overflow-y-auto border-t-2 bg-[color:var(--pz-panel-surface)]">
          <TETabsPane
            show={activeTab === ObjectPanelTabs.PROPERTIES}
            className=""
          >
            <ObjectProperties
              selectedModel={selectedModel}
              isDarkMode={isDarkMode}
              onHideObjectPanel={onHideObjectPanel}
              isMultiSelectMode={isMultiSelectMode}
            />
          </TETabsPane>
          <TETabsPane show={activeTab === ObjectPanelTabs.BILLING}>
            <ObjectVisibilityAndBilling
              selectedModel={selectedModel}
              isDarkMode={isDarkMode}
            />
          </TETabsPane>
        </TETabsContent>
      </div>
      {isMultiSelectMode ? (
        <div className="multimode-selection">
          <p className="multimode-text">Multi select enabled</p>
        </div>
      ) : null}
    </div>
  );
}

export default ObjectPanel;
