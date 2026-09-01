import React, { useEffect, useState } from "react";
import menuData from "../../utils/menu.json";
import { convertToTitleCase } from "../../utils/genericFunctions";
import { groupDataByClassification } from "../../helpers/menu-bar";
import FloorPlanMenu from "./floorPlanMenu";
import FurnishMenu from "./furnishMenu";
import ProductionMenu from "./productionMenu";
import {
  TETabs,
  TETabsContent,
  TETabsItem,
  TETabsPane,
} from "tw-elements-react";
import BlueprintInterface from "../../../blueprint-interface";
import { handleModelSelect } from "../../../viewer3d-state-interface";
import { handleSelectedModel } from "../../../events/event-interface";
import "./index.css";
import ErrorBoundary from "@pazl/react-app/errorBoundary";

export enum MENU_TABS {
  FLOOR_PLAN = "floor_plan",
  FURNISH = "furnish",
  PRODUCTION = "production",
}

interface MenuBarProps {
  onTopView: (value: boolean) => void;
  handleFurnishTabSelected: (value: boolean) => void;
  onActiveTab?: (tab: string) => void;
  projectId: string | undefined;
}

const MenuBar = ({
  onTopView,
  handleFurnishTabSelected,
  onActiveTab,
  projectId,
}: MenuBarProps) => {
  const params = new URLSearchParams(location.search);
  const tab = params.has("tab") ? params.get("tab") : null;
  const [activeTab, setActiveTab] = useState(MENU_TABS.FLOOR_PLAN);
  const [floorplanTabData, setFloorplanTabData] = useState([]);
  const [furnishTabData, setFurnishTabData] = useState([]);
  const [productionTabData, setProductionTabData] = useState([]);

  useEffect(() => {
    const groupedData = groupDataByClassification();
    setFloorplanTabData(groupedData[MENU_TABS.FLOOR_PLAN]);
    setFurnishTabData(groupedData[MENU_TABS.FURNISH]);
    setProductionTabData(groupedData[MENU_TABS.PRODUCTION]);
  }, []);

  useEffect(() => {
    if (activeTab === MENU_TABS.FURNISH) {
      handleFurnishTabSelected(true);
    } else {
      handleFurnishTabSelected(false);
    }
    onActiveTab?.(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (BlueprintInterface?.blueprint3d) {
      handleSelectedModel((evt: any) => {
        handleModelSelect(evt);
      });
      if (tab) {
        handleTabItemClick(tab);
      } else {
        handleSwitchViewer("2");
      }
    }
  }, [BlueprintInterface, BlueprintInterface.blueprint3d]);

  const handleTabItemClick = (tabItem: string) => {
    if (tabItem === activeTab) {
      return;
    }
    if (tabItem === MENU_TABS.FLOOR_PLAN) {
      setActiveTab(MENU_TABS.FLOOR_PLAN);
      handleSwitchViewer("2");
      params.set("tab", MENU_TABS.FLOOR_PLAN);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
    } else if (tabItem === MENU_TABS.FURNISH) {
      setActiveTab(MENU_TABS.FURNISH);
      handleSwitchViewer("3");
      params.set("tab", MENU_TABS.FURNISH);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
    } else if (tabItem === MENU_TABS.PRODUCTION) {
      setActiveTab(MENU_TABS.PRODUCTION);
      params.set("tab", MENU_TABS.PRODUCTION);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
    }
  };

  const handleSwitchViewer = (mode: any) => {
    BlueprintInterface.switchViewer(mode);
  };

  return (
    <div
      className="bg-[color:var(--pz-panel-header)] relative h-auto"
      style={{ zIndex: 99 }}
    >
      <TETabs className="mb-0">
        {menuData.map((item) => (
          <TETabsItem
            key={item?.id}
            onClick={() => handleTabItemClick(item?.name?.toLowerCase())}
            active={activeTab === item?.name?.toLowerCase()}
            tag="button"
            className={`menu-tab-item pt-0 mt-0 ${
              activeTab === item?.name?.toLowerCase()
                ? "bg-[color:var(--pz-accent-soft)] rounded-md "
                : ""
            }`}
            id="menu-tab-item-0"
          >
            <span
              className={`${
                activeTab === item?.name?.toLowerCase()
                  ? "font-bold text-[color:var(--pz-accent)] dark:text-[color:var(--pz-accent)]"
                  : ""
              }`}
            >
              {convertToTitleCase(item?.name)}
            </span>
          </TETabsItem>
        ))}
      </TETabs>
      <TETabsContent className="m-0 p-1 bg-[color:var(--pz-panel-surface)]">
        <TETabsPane show={activeTab === MENU_TABS.FLOOR_PLAN}>
          <ErrorBoundary>
            <FloorPlanMenu floorplanTabData={floorplanTabData} />
          </ErrorBoundary>
        </TETabsPane>
        <TETabsPane show={activeTab === MENU_TABS.FURNISH}>
          <ErrorBoundary>
            <FurnishMenu
              furnishTabData={furnishTabData}
              activeTab={activeTab}
              onTopView={onTopView}
            />
          </ErrorBoundary>
        </TETabsPane>
        <TETabsPane show={activeTab === MENU_TABS.PRODUCTION}>
          <ErrorBoundary>
            <ProductionMenu activeTab={activeTab} projectId={projectId} />
          </ErrorBoundary>
        </TETabsPane>
      </TETabsContent>
    </div>
  );
};

export default MenuBar;
