import menuData from "../utils/menu.json";
import { removeDuplicateArrays } from "../utils/genericFunctions";

export const groupDataByClassification = () => {
  const groupedData: Record<string, any> = {};

  menuData.forEach((menuItem) => {
    const { name, items } = menuItem;

    if (!groupedData[name]) {
      groupedData[name] = [];
    }

    items.forEach((item: any) => {
      groupedData[name].push(item.classification);
    });
  });

  for (const name in groupedData) {
    groupedData[name] = removeDuplicateArrays(groupedData[name]);
  }
  return groupedData;
};

