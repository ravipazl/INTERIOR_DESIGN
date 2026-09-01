import React, { useEffect, useState } from "react";
import CreateProjectModal from "@pazl/components/CreateProjectModal";
import { Project } from "@pazl/entities/Project";
import { ProjectsService } from "@pazl/services/projectsService";
import AppHeader from "@pazl/components/AppHeader";
import ProjectCard from "@pazl/components/ProjectCard";
import ShareProjectModal from "@pazl/components/ShareProjectModal";
import ProjectDashboardSkeleton from "./ProjectDashboardSkeleton";
import { AuthService } from "@pazl/services/authService";
import NotFound from "@pazl/components/NotFound";
import "./index.css";
import { useNavigate } from "react-router-dom";

export const ProjectStatuses = [
  { label: "Open", value: "open" },
  { label: "Quotation Requested", value: "quotation_requested" },
  { label: "Pending Approval", value: "quotation_pending_approval" },
  { label: "Quotation Sent", value: "quotation_sent" },
  { label: "Quotation Accepted", value: "quotation_accepted" },
  { label: "Quotation Rejected", value: "quotation_rejected" },
  { label: "Closed", value: "closed" },
  { label: "View All", value: "view_all" },
];

const ProjectDashboard = () => {
  const navigate = useNavigate();
  const [isDarkMode, setIsDarkMode] = useState(
    localStorage.getItem("isDarkMode") === "true" || false
  );
  const [projectToShare, setProjectToShare] = useState<Project | null>(null);
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([]);
  const [filterMode, setFilterMode] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterPosition, setFilterPosition] = useState<any>(null);
  const [searchString, setSearchString] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    getProjects();
  }, []);

  useEffect(() => {
    if (searchString && searchString != "") {
      handleSearch();
    } else if (filterMode) {
      const status = ProjectStatuses.find(
        (proStat) => proStat.label === filterMode
      )?.value;
      if (status) handleFilter(status);
    } else {
      setFilteredProjects([...allProjects]);
    }
  }, [searchString]);

  const handleSearch = () => {
    setIsLoading(true);
    const projects =
      filteredProjects?.length && filterMode ? filteredProjects : allProjects;
    const list = projects.filter(
      (proj?: Project) =>
        searchString.toLowerCase() === proj?.name?.toLowerCase() ||
        (proj?.name?.toLowerCase() &&
          searchString.toLowerCase().includes(proj?.name?.toLowerCase())) ||
        proj?.name?.toLowerCase().includes(searchString.toLowerCase()) ||
        searchString.toLowerCase() === proj?.status?.toLowerCase() ||
        (proj?.status?.toLowerCase() &&
          searchString.toLowerCase().includes(proj?.status?.toLowerCase())) ||
        proj?.status?.toLowerCase().includes(searchString.toLowerCase()) ||
        searchString.toLowerCase() === proj?.address?.toLowerCase() ||
        (proj?.address?.toLowerCase() &&
          searchString.toLowerCase().includes(proj?.address?.toLowerCase())) ||
        proj?.address?.toLowerCase().includes(searchString.toLowerCase()) ||
        searchString.toLowerCase() === proj?.clientName?.toLowerCase() ||
        (proj?.clientName?.toLowerCase() &&
          searchString
            .toLowerCase()
            .includes(proj?.clientName?.toLowerCase())) ||
        proj?.clientName?.toLowerCase().includes(searchString.toLowerCase()) ||
        searchString.toLowerCase() === proj?.defaultUnits?.toLowerCase() ||
        (proj?.defaultUnits?.toLowerCase() &&
          searchString
            .toLowerCase()
            .includes(proj?.defaultUnits?.toLowerCase())) ||
        proj?.defaultUnits?.toLowerCase().includes(searchString.toLowerCase())
    );
    setFilteredProjects([...list]);
    setIsLoading(false);
  };

  const toggleMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem("isDarkMode", newMode.toString());
  };

  const handleCreateProject = async () => {
    setShowCreateProjectModal(true);
  };

  const getProjects = async () => {
    const resp = await ProjectsService.getAllProjects();
    if (resp?.data?.length) {
      setAllProjects(resp.data);
      setFilteredProjects(resp.data);
    }
    setIsLoading(false);
  };

  const handleFilter = (status: string) => {
    setIsLoading(true);
    setIsFilterOpen(false);
    if (status === "view_all") {
      setFilteredProjects([...allProjects]);
      setFilterMode("");
      setIsLoading(false);
      return;
    }
    const filter = ProjectStatuses.find(
      (proStatus) => proStatus.value === status
    )?.label;
    if (filter) {
      setFilterMode(filter);
    }
    const res =
      searchString && searchString != ""
        ? filteredProjects.filter((project) => project.status === status)
        : allProjects.filter((project) => project.status === status);
    setFilteredProjects([...res]);
    setIsLoading(false);
  };

  const handleOpenProject = (project: Project) => {
    AuthService.setCurrentProjectId(`${project._id}`);
    navigateToProjectDetailScreen(project._id);
  };

  const navigateToProjectDetailScreen = (projectId: string) => {
    navigate(`/project-detail/${projectId}`);
  };

  const handleShareProject = (project: Project) => {
    setProjectToShare(project);
  };

  const handleCreateProjectComplete = (project: Project) => {
    setShowCreateProjectModal(false);
    setEditingProject(null);
    const list = [...filteredProjects, project];
    setFilteredProjects(list);
  };

  const handleEditProjectComplete = (project: Project) => {
    setShowCreateProjectModal(false);
    setEditingProject(null);
    const list = filteredProjects.map((pro) =>
      pro._id === project._id ? project : pro
    );
    setFilteredProjects(list);
  };

  const getProjectsCount = () => {
    if (!filteredProjects?.length) return null;
    if (filteredProjects?.length < 10) return "0" + filteredProjects?.length;

    return filteredProjects?.length;
  };

  const getTitle = () => {
    if (!filteredProjects?.length) return "No project found";

    return `${filterMode ? filterMode + " " : ""}Projects`;
  };

  const handleFilterClick = (e: any) => {
    const rect = e.target.getBoundingClientRect();
    const posX = Math.round(e.clientX - rect.right);
    const posY = Math.round(e.clientY - rect.height);
    setFilterPosition({
      x: Math.abs(posX + 50),
      y: Math.abs(posY + 50),
    });
    setIsFilterOpen(!isFilterOpen);
  };

  return (
    <div
      className={` ${isDarkMode ? "dark" : "light"}`}
      onClick={() => {
        isFilterOpen && setIsFilterOpen(false);
      }}
    >
      <div className="projects-dashboard-container dark:bg-[#333333]">
        <AppHeader
          isDarkMode={isDarkMode}
          toggleMode={toggleMode}
          isErrorSyncing={false}
        />
        {!isLoading ? (
          <div className="title-flex-container dark:bg-[#333333]">
            <h1 className="title dark:bg-[#333333] dark:text-[#FFFFFF]">
              {getTitle()} | {getProjectsCount()}
            </h1>
            <div className="create-project-flex-container">
              <div className="create-project-flex-container">
                <img
                  src={require("../../images/search.svg")}
                  className="search-icon"
                />
                <input
                  type="text"
                  className="search-bar"
                  onChange={(e) => setSearchString(e.target.value)}
                />
              </div>
              <img
                src={
                  isDarkMode
                    ? require("../../images/filter-dark.svg")
                    : require("../../images/filter.svg")
                }
                width={24}
                height={24}
                className="filter"
                onClick={handleFilterClick}
              />
              {/* The "Rate Card" button lived here. The Masters screen MOVED to
                  the Inspire web app (:3000 → "Rate Card" in the admin header).
                  The rates themselves are unchanged — they still live in the
                  design backend, and RatesService still feeds the 3D editor's
                  material/coating dropdowns and the BOQ. Only the admin editing
                  screen moved. */}
              <button
                onClick={handleCreateProject}
                className="create-project-button bg-[#414063]"
              >
                <p className="create-project-button-text">Create Project</p>
              </button>
            </div>
          </div>
        ) : null}
        {isFilterOpen ? (
          <ul
            className="filter-dropdown-options dark:bg-[#333333]"
            style={
              filterPosition
                ? { right: filterPosition?.x, top: filterPosition?.y }
                : { top: "15%", right: "11%" }
            }
          >
            {ProjectStatuses.map((item, index) => (
              <div
                className="filter-dropdown-container dark:bg-[#333333]"
                key={index}
              >
                <div
                  className="create-project-flex-container"
                  onClick={() => handleFilter(item.value)}
                >
                  <li className="filter-dropdown-option dark:bg-[#333333] dark:text-[#FFFFFF]">
                    {item.label}
                  </li>
                  <div
                    className={
                      !filterMode && item.value === "view_all"
                        ? "filter-dropdown-option-checked"
                        : filterMode === item.label
                        ? "filter-dropdown-option-checked"
                        : "filter-dropdown-option-unchecked"
                    }
                  />
                </div>
                {index < ProjectStatuses?.length - 1 ? (
                  <div className="filter-dropdown-divider" />
                ) : null}
              </div>
            ))}
          </ul>
        ) : null}
        {showCreateProjectModal || editingProject ? (
          <CreateProjectModal
            onClose={() => {
              setShowCreateProjectModal(false);
              setEditingProject(null);
            }}
            editingProject={editingProject}
            onCreateComplete={handleCreateProjectComplete}
            onEditComplete={handleEditProjectComplete}
            isDarkMode={isDarkMode}
          />
        ) : null}
        {projectToShare ? (
          <ShareProjectModal
            shareId={projectToShare.shareId}
            onClose={() => setProjectToShare(null)}
            isDarkMode={isDarkMode}
            project={projectToShare}
            refetchProject={getProjects}
          />
        ) : null}

        {isLoading ? (
          <ProjectDashboardSkeleton />
        ) : (
          <>
            {filteredProjects?.length ? (
              <div className="projects-flex-container overflow-y-auto max-h-[85vh] dark:bg-[#333333]">
                {filteredProjects.map((project, index) => (
                  <ProjectCard
                    key={project._id}
                    project={project}
                    projectNumber={index + 1}
                    onEdit={() => setEditingProject(project)}
                    onOpen={() => handleOpenProject(project)}
                    onShare={() => handleShareProject(project)}
                    isDarkMode={isDarkMode}
                  />
                ))}
              </div>
            ) : (
              <>
                {allProjects?.length ? (
                  <NotFound title={"No projects found."} />
                ) : (
                  <NotFound
                    title={"No projects found. Please create a new project."}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ProjectDashboard;
