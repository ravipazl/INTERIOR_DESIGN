import React from "react";
import RoomFurnishPlanner from "./RoomFurnishPlanner";

/** Auto-furnish a bedroom — the shared room planner, set up for a bedroom. */
const BedroomPlanner: React.FC<{ mode: "2d" | "3d" }> = ({ mode }) => (
  <RoomFurnishPlanner kind="bedroom" mode={mode} />
);

export default BedroomPlanner;
