import React from "react";
import "./index.css";

const ProjectCardSkeleton = () => {
  return (
    <div className="project-card-container">
      <p className="animate-pulse">
        <span className="inline-block min-h-[163px] w-full flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="project-title animate-pulse">
        <span className="inline-block min-h-[28px] w-5/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="project-creator animate-pulse">
        <span className="inline-block mb-4 min-h-[12px] w-7/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="project-info animate-pulse">
        <span className="inline-block mb-2 min-h-[14px] w-full flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="project-info animate-pulse">
        <span className="inline-block min-h-[14px] w-full flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="project-info animate-pulse">
        <span className="inline-block mt-2 min-h-[14px] w-full flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <div className="project-card-divider" />
      <div>
        <p className="project-edit animate-pulse">
          <span className="inline-block mx-5 min-h-[24px] w-1/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
          <span className="inline-block mx-5 min-h-[24px] w-1/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
          <span className="inline-block mx-5 min-h-[40px] w-4/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
        </p>
      </div>
    </div>
  );
};

export default ProjectCardSkeleton;
