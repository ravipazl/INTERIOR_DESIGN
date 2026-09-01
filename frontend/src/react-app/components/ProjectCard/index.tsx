import React from "react";
import { Project } from "@pazl/entities/Project";
import "./index.css";
import { ProjectStatuses } from "@pazl/pages/ProjectDashboard";
import { AuthService } from "@pazl/services/authService";
import { UserPermission } from "@pazl/entities/User";

interface ProjectCardType {
  project: Project;
  projectNumber: number;
  onEdit: () => void;
  onShare: () => void;
  onOpen: () => void;
  isDarkMode: boolean;
}

const ProjectCard = ({
  project,
  projectNumber,
  onEdit,
  onShare,
  onOpen,
  isDarkMode,
}: ProjectCardType) => {
  const currentUser = AuthService.getCurrentUser();
  const isAccessibleToEditProject =
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN ||
    currentUser?._id === project?.ownerUserId;

  const getProjectCreator = () => {
    if (project?.ownerUser?.name) {
      return "Created by: " + project?.ownerUser?.name;
    }
    return null;
  };

  const getProjectDate = () => {
    if (project?.createdAt) {
      const days = Math.round(
        (new Date().getTime() - new Date(project.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      return days ? ` | ${days.toFixed(0)} days ago` : " | today";
    }
    return null;
  };

  const getProjectStatus = (status: string) => {
    const statusLabel = ProjectStatuses.find(
      (proStatus) => proStatus.value === status
    )?.label;
    return statusLabel;
  };

  const getColorForStatus = (status: string) => {
    switch (status) {
      case "open":
        return "#ffbe26";
      case "quotation_requested":
        return "#dc3545";
      case "closed":
        return "#888";
      case "quotation_sent":
        return "#198754";
      default:
        return "#888";
    }
  };

  const getProjectTitle = () => {
    if (project?.name) return project?.name;
    if (projectNumber < 10) return "Project 0" + projectNumber;

    return "Project " + projectNumber;
  };

  return (
    <div className={`project-card-container ${isDarkMode ? "dark" : "light"}`}>
      <div className="project-image-container">
        <img
          className="project-image"
          src={require("../../images/project_image.svg")}
        />
      </div>
      <p className="project-title dark:bg-[#333333] dark:text-[#FFFFFF]">
        {getProjectTitle()}
      </p>
      <p className="project-creator dark:bg-[#333333] dark:text-[#FFFFFF]">
        {getProjectCreator()}
        {getProjectDate()}
      </p>
      <div className="project-flex-container dark:bg-[#333333]">
        <p className="project-info dark:text-[#FFFFFF]">Client : </p>
        <p className="project-info-value dark:text-[#FFFFFF]">
          {project?.clientName}
        </p>
      </div>
      <div className="project-flex-container dark:bg-[#333333]">
        <p className="project-info dark:text-[#FFFFFF]">Address : </p>
        <p className="project-info-value dark:text-[#FFFFFF]">
          {project?.address}
        </p>
      </div>
      <div className="project-flex-container dark:bg-[#333333]">
        <p className="project-info dark:text-[#FFFFFF]">Status : </p>
        <p
          className="project-info-value"
          style={{ color: getColorForStatus(project?.status) }}
        >
          {getProjectStatus(project?.status)}
        </p>
      </div>
      <div className="project-card-divider" />
      <div className="project-card-actions dark:bg-[#333333]">
        <div className="project-edit">
          <img
            className="project-edit-icon"
            src={
              isDarkMode
                ? require("../../images/edit-dark.svg")
                : require("../../images/edit.svg")
            }
            onClick={() => {
              if (isAccessibleToEditProject) onEdit();
            }}
          />
        </div>
        <div className="project-share">
          <img
            className="project-share-icon"
            src={
              isDarkMode
                ? require("../../images/share-dark.svg")
                : require("../../images/share.svg")
            }
            onClick={onShare}
          />
        </div>
        <div className="project-view">
          <button onClick={onOpen} className="project-view-button bg-[#414063]">
            <p className="project-view-button-text">View</p>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
