import React, { useEffect, useState } from "react";
import AppHeader from "@pazl/components/AppHeader";
import MenuBar from "@pazl/components/MenuBar";
import FurnishOutliner from "@pazl/components/MenuBar/FurnishOutliner";
import SceneOutliner from "@pazl/components/MenuBar/SceneOutliner";
import FloorPlanAiImport from "@pazl/components/MenuBar/FloorPlanAiImport";
import FloorPlanTools from "@pazl/components/MenuBar/FloorPlanTools";
import EditorShortcuts2D from "@pazl/components/MenuBar/EditorShortcuts2D";
import SaveTemplateButton from "@pazl/components/MenuBar/SaveTemplateButton";
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
  const [isTopView, setIsTopView] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(
    (params.has("tab") ? params.get("tab") : null) || "floor_plan"
  );
  const [isFurnishTabSelected, setIsFurnishTabSelected] = useState(false);
  // Whether the docked "Scene" panel (FurnishOutliner) is shown. The panel's
  // × hides it; a small "Scene" button brings it back.
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
      <div className={`${isDarkMode ? "dark" : "light"}`}>
        <AppHeader
          isDarkMode={isDarkMode}
          toggleMode={toggleMode}
          lastSavedTime={isLoading ? "" : lastSavedTime}
          isErrorSyncing={isErrorSyncing}
          handleSync={handleSync}
        />
        <Loader />
      </div>
    );
  }

  return (
    <div
      className={`${isDarkMode ? "dark" : "light"}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
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
        />
      ) : null}
      {/* Body row: docked Outline sidebar (left) + canvas (fills the rest). The
          canvas is container-sized, so the sidebar pushes it and it reflows. */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {!isLoading && activeTab === "furnish" && !showScene ? (
          // Scene panel closed → a compact button to reopen it (frees the space).
          <div style={{ flexShrink: 0, padding: 8 }}>
            <button
              type="button"
              onClick={() => setShowScene(true)}
              title="Show scene panel"
              className="flex items-center gap-1 rounded-md bg-[color:var(--pz-panel-surface)] border border-[color:var(--pz-panel-border)] shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] px-3 py-2 text-sm font-medium text-black dark:text-white"
            >
              <span className="material-symbols-outlined text-[18px] leading-none text-[color:var(--pz-accent)]">
                account_tree
              </span>
              Scene
            </button>
          </div>
        ) : !isLoading &&
          (activeTab === "furnish" || activeTab === "floor_plan") ? (
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
            }}
          >
            {activeTab === "furnish" ? (
              <FurnishOutliner docked onClose={() => setShowScene(false)} />
            ) : (
              <>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  <SceneOutliner docked />
                </div>
                {/* Floor-plan actions, docked as a footer at the bottom of the
                    sidebar (matches the redesign). */}
                <div
                  style={{
                    padding: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    borderTop: "1px solid var(--pz-panel-border)",
                    background: "var(--pz-panel-header)",
                  }}
                >
                  <FloorPlanAiImport inline />
                  <SaveTemplateButton inline />
                </div>
              </>
            )}
          </div>
        ) : null}
        <div
          id="bp3d-js-app"
          style={{ zIndex: 0, position: "relative", flex: 1, minHeight: 0 }}
        >
          <div id="bp3djs-viewer2d"></div>
          <div id="bp3djs-viewer3d"></div>
          {!isLoading && activeTab === "floor_plan" ? <FloorPlanTools /> : null}
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
      {!isLoading && isFurnishTabSelected ? (
        <div className="mouse-functionality">
          <div className="mouse-functionality-text flex flex-col items-center align-center text-neutral-700 dark:text-neutral-200 py-1">
            <img
              className="mouse-func-icon"
              src={
                isTopView
                  ? require("../../images/right-click.png")
                  : require("../../images/left-click.png")
              }
            />
            Rotating
          </div>
          <span className="text-neutral-700 dark:text-neutral-200">|</span>
          <div className="mouse-functionality-text flex flex-col items-center align-center text-neutral-700 dark:text-neutral-200 py-1">
            <img
              className="mouse-func-icon"
              src={require("../../images/scroll.png")}
            />
            Zooming
          </div>
          <span className="text-neutral-700 dark:text-neutral-200">|</span>
          <div className="mouse-functionality-text flex flex-col items-center align-center text-neutral-700 dark:text-neutral-200 py-1">
            <img
              className="mouse-func-icon"
              src={
                isTopView
                  ? require("../../images/left-click.png")
                  : require("../../images/right-click.png")
              }
            />
            Panning
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DrawingComponent;
