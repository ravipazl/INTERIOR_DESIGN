import React, { useEffect, useState } from "react";
import AppHeader from "@pazl/components/AppHeader";
import NavRail from "@pazl/components/NavRail";
import MenuBar from "@pazl/components/MenuBar";
import FloorPlanTools from "@pazl/components/MenuBar/FloorPlanTools";
import EditorShortcuts2D from "@pazl/components/MenuBar/EditorShortcuts2D";
import BlueprintInterface from "@pazl/blueprint-interface";
import { AuthService } from "@pazl/services/authService";
import { CategoriesService } from "@pazl/services/categoriesService";
import { TexturesService } from "@pazl/services/texturesService";
import { ModelsService } from "@pazl/services/ModelsService";
import "./index.css";
import Loader from "@pazl/components/Loader";
import { UserPermission } from "@pazl/entities/User";
import { Project } from "@pazl/entities/Project";
import { ProjectsService } from "@pazl/services/projectsService";

interface DrawingComponenetProps {
  lastSavedTime: string;
  isErrorSyncing: boolean;
  handleSync: () => void;
}

const DrawingComponent = ({
  lastSavedTime,
  isErrorSyncing,
  handleSync,
}: DrawingComponenetProps) => {
  const params = new URLSearchParams(location.search);
  const projectId = params.has("projectId") ? params.get("projectId") : null;
  const [isDarkMode, setIsDarkMode] = useState(
    localStorage.getItem("isDarkMode") === "true" || false
  );
  const currentUser = AuthService.getCurrentUser();
  const [isLoading, setIsLoading] = useState(true);
  // WRITE-ONLY since the mouse-controls pill was removed — the pill was the only
  // reader (it swapped the left/right click icons in top view). The setter is
  // still MenuBar's required `onTopView` prop, so the state stays rather than
  // reaching into another component's interface to delete two lines. Anything
  // that needs to know about top view again can just read it.
  const [isTopView, setIsTopView] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(
    (params.has("tab") ? params.get("tab") : null) || "floor_plan"
  );
  // One-shot nav request from the rail. MenuBar consumes it and clears it, so
  // MenuBar keeps owning the switching logic and there is no second source of
  // truth for which view is open.
  const [navRequest, setNavRequest] = useState<string | null>(null);
  // Also write-only now, for the same reason: it gated the mouse-controls pill
  // to the 3D tab, and that pill is gone. Kept for the same reason as isTopView.
  const [isFurnishTabSelected, setIsFurnishTabSelected] = useState(false);
  // Whether the Floor plan tool panel is expanded. The chevron handle on the
  // panel edge toggles it; when collapsed a slim tab brings it back.
  const [showScene, setShowScene] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const isAccessibleToEdit3dDesign =
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN ||
    (currentUser?.permissions === UserPermission.ARCHITECT &&
      currentUser?._id === project?.architectUserId) ||
    (currentUser?.permissions === UserPermission.USER &&
      (currentUser?._id === project?.ownerUserId ||
        project?.sharedUserIDs?.some((id) => id === currentUser?._id)));

  useEffect(() => {
    getProject();
    if (projectId && AuthService.getCurrentProjectId() !== projectId) {
      AuthService.setCurrentProjectId(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    if (
      project &&
      isAccessibleToEdit3dDesign &&
      BlueprintInterface.blueprint3d == null
    ) {
      fetchRequiredData();
      handleBluePrintCreation();
    }
  }, [project]);

  // Release the 3D engine when leaving the editor, so RE-ENTERING it works.
  //
  // Why this is required: `BlueprintInterface.blueprint3d` is a MODULE-LEVEL
  // singleton (blueprint-interface.js:32) that nothing ever reset. The effect
  // above is gated on `blueprint3d == null`, so on a SECOND entry (SPA nav with
  // no page reload) that guard was false → fetchRequiredData() and
  // handleBluePrintCreation() never ran → the scene never loaded →
  // setIsLoading(false) (inside getFloorPlan) never fired → the loader span
  // forever. Only /projects and /sync appeared in the Network tab, then nothing.
  // Clearing the singleton here makes re-entry behave like a fresh page load.
  //
  // The renderer is disposed first because the canvas is re-created on remount,
  // so a new BlueprintJS is built each time. Browsers cap active WebGL contexts
  // (~16); without releasing the old one, repeatedly opening the editor would
  // eventually break the 3D view. Best-effort + guarded so cleanup can never throw.
  useEffect(() => {
    return () => {
      try {
        const bp: any = BlueprintInterface.blueprint3d;
        bp?.roomplanner?.renderer?.dispose?.();
        bp?.roomplanner?.renderer?.forceContextLoss?.();
      } catch (e) {
        console.warn("DrawingComponent cleanup: renderer dispose failed", e);
      }
      BlueprintInterface.blueprint3d = null;
    };
  }, []);

  const getProject = async () => {
    if (projectId) {
      const pro = await ProjectsService.getProjectById(projectId);
      if (pro) {
        setProject(pro);
      }
    }
  };

  const handleBluePrintCreation = async () => {
    const isBlueprintCreated = await BlueprintInterface.init();
    if (isBlueprintCreated) {
      await getFloorPlan();
    }
  };

  const fetchRequiredData = async () => {
    console.debug("DrawingComponenet ~ fetchRequiredData");
    const response1 = await CategoriesService.getAllCategories();
    if (response1?.data?.length) {
      CategoriesService.saveCategoriesToLocalStorage(response1.data);
    }
    const response2 = await ModelsService.getAllModels();
    if (response2?.data?.length) {
      ModelsService.saveModelsToLocalStorage(response2.data);
    }
    const response3 = await TexturesService.getAllFinishingCategories();
    if (response3?.data?.length) {
      TexturesService.saveFinishingCategoriesToLocalStorage(response3.data);
    }
    const response4 = await TexturesService.getAllFinishings();
    if (response4?.data?.length) {
      TexturesService.saveFinishingsToLocalStorage(response4.data);
    }
    const response5 = await TexturesService.getAllCoreMaterialBrands();
    if (response5?.data?.length) {
      TexturesService.saveCoreMaterialBrandsToLocalStorage(response5.data);
    }
  };

  const toggleMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem("isDarkMode", newMode.toString());
  };

  const getFloorPlan = async () => {
    const isFloorPlanLoaded =
      await BlueprintInterface.ProjectManagerService.loadSceneInitially();
    if (isFloorPlanLoaded) {
      setIsLoading(false);
      // Capture the initial state so the very first edit is undoable.
      setTimeout(() => (BlueprintInterface as any).snapshot2D?.(), 600);
    }
  };

  if (!isLoading && !isAccessibleToEdit3dDesign) {
    return (
      // Same shell as the loaded view, so the rail does not pop in when the
      // project finishes loading.
      <div
        className={`${isDarkMode ? "dark" : "light"}`}
        style={{ display: "flex", height: "100vh", overflow: "hidden" }}
      >
        <NavRail />
        <div style={{ flex: 1, minWidth: 0 }}>
          <AppHeader
            isDarkMode={isDarkMode}
            toggleMode={toggleMode}
            lastSavedTime={isLoading ? "" : lastSavedTime}
            isErrorSyncing={isErrorSyncing}
            handleSync={handleSync}
          />
          <Loader />
        </div>
      </div>
    );
  }

  return (
    // Outer row: navigation rail (fixed 64px) + everything else in a column.
    // The rail sits OUTSIDE the column so it spans full height like the mockup,
    // and because #bp3d-js-app is container-sized the canvas just reflows 64px
    // narrower — same mechanism as the Scene panel documented further down.
    <div
      className={`${isDarkMode ? "dark" : "light"}`}
      style={{ display: "flex", height: "100vh", overflow: "hidden" }}
    >
      <NavRail
        activeView={activeTab}
        onNavigate={setNavRequest}
        // Flush to the server before any link leaves the editor — autosave only
        // ticks every 5s, so without this a click on Dashboard can drop the
        // last few seconds of work.
        onBeforeLeave={handleSync}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
      <AppHeader
        isDarkMode={isDarkMode}
        toggleMode={toggleMode}
        lastSavedTime={isLoading ? "" : lastSavedTime}
        isErrorSyncing={isErrorSyncing}
        handleSync={handleSync}
      />
      {isLoading ? <Loader /> : null}
      {!isLoading ? (
        <MenuBar
          projectId={projectId ?? ""}
          onTopView={(val: boolean) => {
            setIsTopView(val);
          }}
          handleFurnishTabSelected={(val: boolean) => {
            setIsFurnishTabSelected(val);
          }}
          onActiveTab={(tab: string) => setActiveTab(tab)}
          // The rail drives navigation; MenuBar still owns the switching logic.
          requestedView={navRequest}
          onNavHandled={() => setNavRequest(null)}
        />
      ) : null}
      {/* Body row: docked Outline sidebar (left) + canvas (fills the rest). The
          canvas is container-sized, so the sidebar pushes it and it reflows. */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* The left panel now belongs to the Floor plan step ONLY.
            Both Scene outliners are gone: SceneOutliner (floor plan) listed
            rooms and walls the canvas already showed, and FurnishOutliner (3D)
            has been dropped too, so 3D runs full-width and you select a piece
            by clicking it in the scene. */}
        {!isLoading && activeTab === "floor_plan" && !showScene ? (
          // Panel collapsed → a slim tab on the canvas edge brings it back.
          // Deliberately NOT bound to Ctrl+0 the way the reference tool does:
          // that is the browser's "reset zoom", and stealing it from someone
          // who has zoomed the page is worse than having no shortcut.
          <button
            type="button"
            onClick={() => setShowScene(true)}
            title="Expand panel"
            aria-label="Expand panel"
            aria-expanded={false}
            className="pz-panel-tab"
          >
            <span className="material-symbols-outlined text-[20px] leading-none">
              chevron_right
            </span>
          </button>
        ) : !isLoading && activeTab === "floor_plan" ? (
          <div
            className="pz-animate-in"
            style={{
              width: 248,
              flexShrink: 0,
              borderRight: "1px solid var(--pz-panel-border)",
              background: "var(--pz-sidebar-bg, var(--pz-panel-surface))",
              boxShadow: "inset -8px 0 12px -12px rgba(16,42,31,0.25)",
              transition: "width .15s ease",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              position: "relative",
            }}
          >
            {/* Collapse handle, straddling the panel's right border. */}
            <button
              type="button"
              onClick={() => setShowScene(false)}
              title="Collapse panel"
              aria-label="Collapse panel"
              aria-expanded
              className="pz-panel-tab is-open"
            >
              <span className="material-symbols-outlined text-[20px] leading-none">
                chevron_left
              </span>
            </button>
            <div
              style={{
                padding: "10px 12px 8px",
                borderBottom: "1px solid var(--pz-panel-border)",
                background: "var(--pz-panel-header)",
              }}
            >
              <div
                style={{ fontSize: 15, fontWeight: 600, color: "var(--pz-text)" }}
              >
                Floor plan
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <FloorPlanTools />
            </div>
          </div>
        ) : null}
        <div
          id="bp3d-js-app"
          style={{ zIndex: 0, position: "relative", flex: 1, minHeight: 0 }}
        >
          <div id="bp3djs-viewer2d"></div>
          <div id="bp3djs-viewer3d"></div>
          {/* FloorPlanTools moved OUT of the canvas and into the left panel
              above — it is no longer a floating overlay. */}
          {!isLoading && activeTab === "floor_plan" ? (
            <EditorShortcuts2D />
          ) : null}
        </div>
        {/* The inspector OVERLAYS the canvas — it is position:fixed on the
            right edge and no space is reserved for it here.

            There used to be a spacer div sized by --pz-right-dock, which made
            #bp3d-js-app (flex: 1) shrink by 384px whenever a panel opened. With
            `transition: width .15s ease` that shrink was ANIMATED, so the
            ResizeObserver on the canvas fired every frame of the animation and
            each fire re-ran updateWindowSize() — recomputing camera.aspect and
            calling renderer.setSize(). One click therefore re-projected the
            whole 3D scene about ten times and the view visibly squeezed. A
            floor click was worse: it closes the panel on mouse-down and opens
            it on mouse-up, so the canvas animated out and back for a single
            click. Overlaying keeps the canvas one fixed size, so selecting
            something changes only the panel. */}
      </div>
      {/* The Rotating / Zooming / Panning pill stood here.

          It was never a control - three divs with images and no handler, a
          LEGEND for which mouse button does what. But it was drawn as a rounded
          pill with dividers, in the toolbar position at the bottom of the
          canvas, so it read as three buttons: people clicked it, nothing
          happened, and the app looked broken.

          The information was worth keeping - orbit/zoom/pan were documented
          nowhere else - so it moved into the Shortcuts modal, which the
          keyboard icon in the toolbar already opens and which had almost
          nothing in it. Help belongs somewhere you GO when stuck, not painted
          permanently over the work. */}
      </div>
    </div>
  );
};

export default DrawingComponent;
