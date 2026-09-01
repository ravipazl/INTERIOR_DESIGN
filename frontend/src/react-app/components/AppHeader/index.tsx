import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthService } from "../../services/authService";
import { ProjectsService } from "@pazl/services/projectsService";
import { Project } from "@pazl/entities/Project";
import { User } from "@pazl/entities/User";
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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const user = AuthService.getCurrentUser();
    console.debug("AppHeader ~ user", user);
    if (user) {
      setCurrentUser(user);
    }
  }, []);

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

  const handleLogout = () => {
    AuthService.signOut();
    // Redirect to signin DIRECTLY instead of navigate("/") and hoping
    // ProtectedRoute catches the missing token. When you log out from the
    // dashboard you are already on "/", so navigate("/") is a no-op:
    // ProtectedRoute's auth check only runs on mount / when the login/email
    // query params change, so it never re-fires and you stay stuck on the
    // dashboard until a manual reload. A full-page redirect always leaves the
    // page. This mirrors ProtectedRoute.checkLoginStatus's own redirect, and
    // replace() keeps the logged-in page out of history (Back won't return).
    window.location.replace(`${process.env.REACT_APP_PAZL_INSPIRE_URL}/signin`);
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

  return (
    <div
      className="shadow-lg px-2 py-6 bg-[color:var(--pz-panel-header)] h-[40px] flex flex-row items-center w-screen justify-between"
      onClick={() => isUserMenuOpen && setIsUserMenuOpen(false)}
    >
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
      <div className="app-header-flex-container">
        {currentUser ? (
          <div className="toggle-container">
            <span
              className="flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-semibold uppercase select-none shrink-0 shadow-sm"
              style={{ background: "var(--pz-accent-grad)" }}
              title={currentUser.email}
            >
              {(currentUser.email || "?").trim().charAt(0) || "?"}
            </span>
            <div
              className="custom-dropdown z-[9999]"
              onClick={(e) => {
                e.stopPropagation();
                setIsUserMenuOpen(!isUserMenuOpen);
              }}
            >
              <div className="app-header-flex-container">
                <span className="text-primary dark:text-[#ffffff] text-[#333333] text-sm">
                  {currentUser.email}
                </span>
                <span>
                  <img
                    className={`d-none d-lg-block ${
                      isDarkMode ? "dark-icon-img" : "icon-img"
                    }`}
                    src={require("../../images/dropdown_arrow_down.svg")}
                    alt="menu"
                  />
                </span>
              </div>
              {isUserMenuOpen ? (
                <ul className="dropdown-options">
                  <li
                    className="dropdown-option text-[#333333] text-sm"
                    onClick={handleLogout}
                  >
                    Logout
                  </li>
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AppHeader;
