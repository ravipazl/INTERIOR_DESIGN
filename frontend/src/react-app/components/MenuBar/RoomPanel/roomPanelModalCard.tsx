import React from "react";
import { roomPanelModalCardProps } from "@pazl/helpers/Types";

/**
 * A sub-category in the item panel — NAME ONLY, no picture.
 *
 * This used to be a picture card. The picture came from the CATEGORY's
 * `thumbnail` field, which almost no category has, so the card rendered an
 * <img> with nothing to load and the browser printed its alt text — the
 * category's id, "6aba34195a0bd3e98" — across the tile in broken-image style.
 *
 * The picture is gone rather than replaced: a column of identical placeholder
 * tiles carried no information either, and cost 160px of height each to say so.
 * What distinguishes these rows is their name, so the name is all the card
 * shows, and the card shrinks to fit it — a list of sub-categories now reads
 * like a menu instead of a gallery of empty frames.
 */
const RoomPanelModalCard: React.FC<roomPanelModalCardProps> = ({
  childItem,
  onSelectedChildrenNode,
}) => {
  return (
    <div
      className="w-[210px] m-1.5 px-3 py-2.5 flex items-center gap-2 rounded-lg bg-white dark:bg-neutral-700 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] hover:bg-[#F5F4FD] dark:hover:bg-neutral-600 transition-colors"
      key={childItem.data.id}
      style={{ cursor: "pointer" }}
      onClick={onSelectedChildrenNode}
      title={childItem?.data.name}
    >
      {/* Wraps rather than truncates: these names differ at the END
          ("… along basic handles" / "… along profile handles"), so cutting the
          tail would leave two cards looking identical. */}
      <h5 className="flex-1 min-w-0 text-xs font-semibold leading-snug text-neutral-800 dark:text-neutral-50">
        {childItem?.data.name}
      </h5>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-neutral-400 dark:text-neutral-300"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </div>
  );
};

export default RoomPanelModalCard;
