import React from "react";
import { roomPanelModalCardProps } from "@pazl/helpers/Types";

const RoomPanelModalCard: React.FC<roomPanelModalCardProps> = ({
  childItem,
  onSelectedChildrenNode,
}) => {
  return (
    <div
      className="w-[184px] h-full m-3 rounded-lg bg-white shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] dark:bg-neutral-700"
      key={childItem.data.id}
      style={{ cursor: "pointer" }}
      onClick={onSelectedChildrenNode}
    >
      <div className="m-3">
        <img
          className="rounded-lg w-40 h-40 max-w-40 max-h-40"
          src={childItem?.data.url}
          alt={childItem?.data.id}
        />
        <h5 className="m-3 text-xs font-semibold cursor-pointer text-center leading-tight text-neutral-800 dark:text-neutral-50">
          {childItem?.data.name}
        </h5>
      </div>
    </div>
  );
};

export default RoomPanelModalCard;
