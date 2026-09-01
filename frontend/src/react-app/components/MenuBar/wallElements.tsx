import React, { useEffect, useState } from "react";
import "@pazl/components/MenuBar/index.css";
import MenuInput from "@pazl/components/MenuBar/menuInput";
import { getGroupedItems } from "@pazl/helpers/grouped-buttons";
import { MenuItem } from "@pazl/helpers/Types";

function WallElements({
  item,
  menuName,
  item2D,
  unitMetric,
  onClose,
}: {
  item: string;
  menuName: string;
  item2D: any;
  unitMetric: string;
  onClose: () => void;
}) {
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
    <div className="bg-white dark:bg-[#4E4E4E]">
      {Object.keys(groupedItems).map((classificationName: string) => (
        <div key={classificationName} className="px-4">
          {groupedItems[classificationName].map((itemData: MenuItem) => (
            <MenuInput
              key={itemData.id}
              itemData={itemData}
              item2D={item2D}
              unitMetric={unitMetric}
              onClose={onClose}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default WallElements;
