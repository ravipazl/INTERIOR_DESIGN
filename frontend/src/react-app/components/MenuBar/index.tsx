import React, { useEffect, useState } from "react";
import { groupDataByClassification } from "../../helpers/menu-bar";
import FloorPlanMenu from "./floorPlanMenu";
import FurnishMenu from "./furnishMenu";
import ProductionMenu from "./productionMenu";
import { TETabsContent, TETabsPane } from "tw-elements-react";
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

/**
 * What the nav rail shows. Render and BOQ are the two halves of the Production
 * tab, promoted to first-class destinations.
 *
 * DELIBERATELY these are NOT new MENU_TABS values. `activeTab` must stay
 * "production" for both, because two things depend on that exact string:
 *   - BoqTable:723 and RenderHistory:196 compare `activeTab === "production"`
 *     to decide when to reload. New values would silently stop matching and
 *     you would read stale figures.
 *   - productionMenu wires BoqTable's PDF getter into RenderHistory's
 *     "Send to admin". Both must stay mounted or the email loses its BOQ.
 * So the tab stays one thing; only the visible half changes.
 */
export enum NAV_VIEWS {
  FLOOR_PLAN = "floor_plan",
  FURNISH = "furnish",
  RENDER = "render",
  BOQ = "boq",
}

export type ProductionView = "render" | "boq";

const navToTab = (v: string) =>
  v === NAV_VIEWS.RENDER || v === NAV_VIEWS.BOQ
    ? MENU_TABS.PRODUCTION
    : (v as MENU_TABS);

interface MenuBarProps {
  onTopView: (value: boolean) => void;
  handleFurnishTabSelected: (value: boolean) => void;
  onActiveTab?: (tab: string) => void;
  projectId: string | undefined;
  /** Nav-rail request: one of NAV_VIEWS. Cleared via onNavHandled. */
  requestedView?: string | null;
  onNavHandled?: () => void;
}

const MenuBar = ({
  onTopView,
  handleFurnishTabSelected,
  onActiveTab,
  projectId,
  requestedView,
  onNavHandled,
}: MenuBarProps) => {
  const params = new URLSearchParams(location.search);
  const tab = params.has("tab") ? params.get("tab") : null;
  const [activeTab, setActiveTab] = useState(MENU_TABS.FLOOR_PLAN);
  // Which half of Production is on screen. Both stay mounted; this only
  // decides which is visible — see the NAV_VIEWS note above.
  // Bumped when the rail asks for Render; FurnishMenu opens the panel on change.
  const [renderSignal, setRenderSignal] = useState(0);
  // The same idea for 3D. It exists because the toolbar's "Explore" button was
  // removed: that button was the only way to bring the catalogue back after you
  // closed it while already on 3D. A counter rather than a boolean, so clicking
  // 3D when you are ALREADY on 3D still registers as a fresh request.
  const [exploreSignal, setExploreSignal] = useState(0);
  // Which rail item is lit. NOT derivable from activeTab: 3D and Render are
  // both the FURNISH tab, they differ only in which left panel is showing.
  const [navView, setNavView] = useState<string>(NAV_VIEWS.FLOOR_PLAN);
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
    // Report the NAV view, not the raw tab, so the rail can light up Render vs
    // BOQ separately even though both are the Production tab underneath.
    onActiveTab?.(navView);
  }, [activeTab, navView]);

  // Nav rail asked for a view.
  useEffect(() => {
    if (!requestedView) return;
    handleTabItemClick(requestedView);
    onNavHandled?.();
  }, [requestedView]);

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
    // Render and BOQ share the Production tab, so "same tab" is not enough to
    // bail out — switching between those two is a real change of view.
    const nextTab = navToTab(tabItem);
    // RENDER is not a page of its own. RenderService.startRender() exports the
    // live scene and captures the CURRENT camera ("uses your current view"), so
    // the 3D viewer has to stay on screen. Render therefore keeps the FURNISH
    // tab and just swaps the left panel over to the render settings.
    if (tabItem === NAV_VIEWS.RENDER) {
      setNavView(NAV_VIEWS.RENDER);
      setActiveTab(MENU_TABS.FURNISH);
      handleSwitchViewer("3");
      setRenderSignal((n) => n + 1);
      params.set("tab", NAV_VIEWS.RENDER);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
      return;
    }
    if (tabItem === NAV_VIEWS.BOQ) {
      // BOQ shows the quote AND the render history together — "Send to admin"
      // submits both as one package, and RenderHistory pulls the BOQ PDF from
      // BoqTable, so splitting them is what made that wiring fragile.
      setNavView(NAV_VIEWS.BOQ);
      setActiveTab(MENU_TABS.PRODUCTION);
      params.set("tab", NAV_VIEWS.BOQ);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
      return;
    }
    // 3D, like Render above, is handled BEFORE the same-view guard. Clicking it
    // while already on 3D is not a no-op: it re-opens the catalogue. That used
    // to be the toolbar's "Explore" button, and with that gone the rail is the
    // only way back once you close the panel.
    if (tabItem === NAV_VIEWS.FURNISH) {
      setNavView(NAV_VIEWS.FURNISH);
      setActiveTab(MENU_TABS.FURNISH);
      handleSwitchViewer("3");
      setExploreSignal((n) => n + 1);
      params.set("tab", MENU_TABS.FURNISH);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
      return;
    }
    // Compare the NAV VIEW, not the tab. 3D and Render are both FURNISH, so
    // comparing tabs swallowed the click that switches between them.
    if (tabItem === navView) {
      return;
    }
    if (tabItem === MENU_TABS.FLOOR_PLAN) {
      setNavView(NAV_VIEWS.FLOOR_PLAN);
      setActiveTab(MENU_TABS.FLOOR_PLAN);
      handleSwitchViewer("2");
      params.set("tab", MENU_TABS.FLOOR_PLAN);
      const path = `${window.location.origin}${
        window.location.pathname
      }?${params.toString()}`;
      window.history.pushState({ path }, "", path);
      // The FURNISH branch that used to sit here is now handled above, ahead of
      // the same-view guard, so that clicking 3D again reopens the catalogue.
    } else if (tabItem === MENU_TABS.PRODUCTION) {
      // Legacy ?tab=production links (and menu.json) still work. The old
      // Production page listed the BOQ first, so land there.
      setNavView(NAV_VIEWS.BOQ);
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

  // Derived once and used TWICE below — for the pane and for that pane's
  // toolbar. They must agree, so they read the same const rather than repeating
  // the comparison; see the comment at the panes for why the toolbar needs
  // telling at all.
  const showFloorPlan = activeTab === MENU_TABS.FLOOR_PLAN;
  const showFurnish = activeTab === MENU_TABS.FURNISH;

  return (
    <div
      className="bg-[color:var(--pz-panel-header)] relative h-auto"
      style={{ zIndex: 99 }}
    >
      {/* The horizontal FLOOR PLAN / FURNISH / PRODUCTION strip used to live
          here. The nav rail now owns this navigation — two controls driving one
          piece of state was confusing, and the rail also splits Production into
          Render and BOQ, which the strip could not express. handleTabItemClick
          is still the single entry point; the rail calls it through
          `requestedView`. */}
      <TETabsContent className="m-0 p-1 bg-[color:var(--pz-panel-surface)]">
        {/* `show` and `active` are deliberately the same flag. Each menu portals
            its toolbar up into the navbar, and a portal lands OUTSIDE the pane
            this hides — so hiding the pane leaves its toolbar sitting in the
            navbar beside the live one. `active` is what actually takes it out. */}
        <TETabsPane show={showFloorPlan}>
          <ErrorBoundary>
            <FloorPlanMenu
              floorplanTabData={floorplanTabData}
              active={showFloorPlan}
            />
          </ErrorBoundary>
        </TETabsPane>
        <TETabsPane show={showFurnish}>
          <ErrorBoundary>
            <FurnishMenu
              furnishTabData={furnishTabData}
              active={showFurnish}
              exploreSignal={exploreSignal}
              activeTab={activeTab}
              onTopView={onTopView}
              renderSignal={renderSignal}
              navView={navView}
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
