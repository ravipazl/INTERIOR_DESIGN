import React, { Component, useEffect, useState } from "react";
import "@pazl/components/MenuBar/index.css";
import MenuButton from "@pazl/components/MenuBar/menuButton";
import { getGroupedItems } from "@pazl/helpers/grouped-buttons";
import { MenuItem, MenuGroupedButtonProps } from "@pazl/helpers/Types";

/**
 * Toolbar items that now live in the Floor plan panel's "Draw room" section
 * instead. They are filtered OUT of the top toolbar rather than deleted from
 * menu.json, because menu.json also drives the tab grouping and the wall /
 * corner / room property menus — removing rows there would reach further than
 * intended. Filtering here keeps the change to the toolbar alone.
 *
 * "draw" is NOT in this list: the panel's Walls card already calls the same
 * handleDrawFreeShape(), so the toolbar keeps its own draw button and nothing
 * is duplicated in the panel.
 */
const MOVED_TO_PANEL = [
  // Floor plan panel -> "Draw room"
  "clear",
  "templates",
  "units",
  // 3D model panel -> "Add model"
  "upload",
  "generate",
  "search_models",
];

/**
 * Toolbar items that are gone rather than relocated — the thing they did is now
 * done for you.
 *
 * "add_item" is the button labelled "Explore". All it ever did was toggle the
 * catalogue panel, and that panel now opens on its own whenever you arrive at
 * the 3D step, and reopens when you click 3D in the rail again. A button whose
 * only job is to re-do what just happened automatically is a button that reads
 * as broken, because most of the time pressing it changes nothing.
 */
const SUPERSEDED = ["add_item"];

const HIDDEN_FROM_TOOLBAR = [...MOVED_TO_PANEL, ...SUPERSEDED];

const hideMovedItems = (groups: Record<string, MenuItem[]>) => {
  const out: Record<string, MenuItem[]> = {};
  Object.keys(groups).forEach((k) => {
    const kept = groups[k].filter(
      (i) => !HIDDEN_FROM_TOOLBAR.includes(String(i.itemName))
    );
    // Drop a group that is now empty, so no stray divider is left behind.
    if (kept.length) out[k] = kept;
  });
  return out;
};

const GroupedButtons: React.FC<MenuGroupedButtonProps> = ({
  item,
  menuName,
  handleMenuItemClick,
  mode,
  buttonRef,
  handleUnitChange,
}) => {
  const [groupedItems, setGroupedItems] = useState<Record<string, MenuItem[]>>(
    {}
  );

  useEffect(() => {
    const items = getGroupedItems({ item, menuName });
    if (items !== undefined) {
      setGroupedItems(hideMovedItems(items));
    }
  }, [item]);

  return (
    <div className="bg-[color:var(--pz-panel-header)]">
      {Object.keys(groupedItems).map((classificationName: string) => (
        <div
          key={classificationName}
          className="flex p-1 border-r border-solid border-[color:var(--pz-panel-border)]"
        >
          {groupedItems[classificationName].map((itemData: MenuItem) => (
            <MenuButton
              key={itemData.id}
              itemData={itemData}
              handleMenuItemClick={handleMenuItemClick}
              mode={mode}
              buttonRef={buttonRef}
              handleUnitChange={handleUnitChange}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default GroupedButtons;
