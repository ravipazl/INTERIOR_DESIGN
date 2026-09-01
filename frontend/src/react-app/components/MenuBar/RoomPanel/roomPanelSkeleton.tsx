import React from "react";
import "../index.css";

const RoomPanelSkeleton = () => {
  return (
    <div>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-5/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-9/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-6/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-9/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-7/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-5/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-9/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
      <p className="animate-pulse">
        <span className="inline-block mx-2 mb-2 min-h-[14px] w-7/12 flex-auto cursor-wait bg-current align-middle opacity-50"></span>
      </p>
    </div>
  );
};

export default RoomPanelSkeleton;
