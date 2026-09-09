import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthService } from "../../services/authService";
import { ProjectsService } from "@pazl/services/projectsService";
import { Project } from "@pazl/entities/Project";
import { TOOLBAR_SLOT_ID } from "@pazl/components/MenuBar/ToolbarPortal";
import "./index.css";

interface AppHeaderProps {
  isDarkMode: boolean;
  toggleMode: () => void;
  lastSavedTime?: string;
  isErrorSyncing: boolean;
  handleSync?: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  isDarkMode,
  toggleMode,
  lastSavedTime,
  isErrorSyncing,
  handleSync,
}) => {
  const navigate = useNavigate();
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    getCurrentProject();
  }, [window.location.pathname]);

  useEffect(() => {
    if (lastSavedTime || isErrorSyncing) {
      setIsLoading(false);
    }
  }, [lastSavedTime, isErrorSyncing]);

  const getCurrentProject = async () => {
    const projectId = AuthService.getCurrentProjectId();
    if (projectId && window.location.pathname != "/") {
      const project = await ProjectsService.getProjectById(projectId);
      console.debug("AppHeader ~ project", project);
      if (project) {
        setCurrentProject(project);
      }
    }
  };

  const handleGoToDashboard = () => {
    if (handleSync) {
      handleSync();
    }
    const projectId = AuthService.getCurrentProjectId();
    if (projectId) {
      navigate(`/project-detail/${projectId}`);
    } else {
      navigate("/");
    }
  };

  // w-full, NOT w-screen: this header sits inside the workarea, which is
  // narrower than the viewport by the width of the nav rail. 100vw overflowed
  // to the right and pushed the Save button off screen.
  return (
    <div className="shadow-lg px-2 py-6 bg-[color:var(--pz-panel-header)] h-[40px] flex flex-row items-center w-full justify-between">
      <div className="flex flex-row items-center">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-[color:var(--pz-accent-tint)] mr-1">
          <img
            alt="logo"
            src="/assets/icons/pazl_logo.svg"
            width={"30px"}
            height={"30px"}
          />
        </span>
        {currentProject ? (
          <div className="app-header-flex-container">
            <img
              className="back-button"
              alt="back"
              src={require("../../images/back2.svg")}
              onClick={handleGoToDashboard}
            />
            <h5 className="text-primary text-[#333333] dark:text-[#ffffff] font-bold">
              {currentProject.name}
            </h5>
          </div>
        ) : (
          <h5 className="text-primary text-[#333333] dark:text-[#ffffff] font-bold">
            PAZL
          </h5>
        )}
      </div>
      {/* The per-tab toolbar portals in here (see ToolbarPortal), so the tools
          share this bar instead of occupying a second row below it. */}
      <div
        id={TOOLBAR_SLOT_ID}
        className="flex items-center flex-1 min-w-0 overflow-x-auto px-3"
      />
      <div className="flex align-center justify-items-center">
        {isErrorSyncing ? (
          <div className="text-primary text-[#fff] bg-[#ff3939] dark:text-[#ffffff] text-sm px-2 py-1 mr-2 rounded">
            Failed to save
          </div>
        ) : null}
        {lastSavedTime ? (
          <>
            <div className="flex items-center gap-1 text-[color:var(--pz-text-2)] text-sm pr-4 py-1">
              <span className="material-symbols-outlined text-[16px] leading-none text-[#1D9E75]">
                cloud_done
              </span>
              Saved · {lastSavedTime}
            </div>
            <button
              className="save-button rounded dark:bg-[#ffffff] text-[#ffffff] dark:text-[#333333]"
              onClick={() => {
                setIsLoading(true);
                handleSync && handleSync();
              }}
            >
              {isLoading ? (
                <span>
                  <span className="animate-spin spinner" />
                  Saving...
                </span>
              ) : (
                <span>Save</span>
              )}
            </button>
          </>
        ) : null}
      </div>
      {/* The account chip and its Logout dropdown used to sit here. Both moved
          to the foot of the nav rail (NavRail), which shows the same avatar and
          signs out the same way — and additionally flushes the design first,
          which this dropdown never did. Two logouts in one screen was one too
          many. */}
    </div>
  );
};

export default AppHeader;
