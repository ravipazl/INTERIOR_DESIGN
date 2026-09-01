import React from "react";
import ProjectCardSkeleton from "../../components/ProjectCard/ProjectCardSkeleton";
import "./index.css";

const projects = [1, 2, 3];

const ProjectDashboardSkeleton = () => {
  return (
    <div className="projects-dashboard-container mt-8">
      <div className="projects-flex-container overflow-y-auto max-h-[85vh]">
        {projects.map((projectNumber) => (
          <ProjectCardSkeleton key={projectNumber} />
        ))}
      </div>
    </div>
  );
};

export default ProjectDashboardSkeleton;
