import React, { Component, useEffect, useState } from "react";
import "@pazl/components/MenuBar/index.css";
import MenuButton from "@pazl/components/MenuBar/menuButton";
import { getGroupedItems } from "@pazl/helpers/grouped-buttons";
import { MenuItem, MenuGroupedButtonProps } from "@pazl/helpers/Types";

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
      setGroupedItems(items);
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
