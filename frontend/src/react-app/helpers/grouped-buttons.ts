import menuData from "../utils/menu.json";
import { MenuItem } from "../helpers/Types";

export const getGroupedItems = ({ item, menuName }: { item: string, menuName: string }):  Record<string, MenuItem[]> | undefined => {

    const filterMenuData = menuData.find((menu) => menu.name === menuName);

    if (filterMenuData && filterMenuData.items) {
        const filteredItems = (filterMenuData.items as MenuItem[]).filter(
            (itemData) => itemData.classification === item);
        const groupedItems = filteredItems.reduce((acc, itemData) => {
            const classificationName = itemData.classification;

            if (classificationName !== undefined) {
                const itemArray = acc[classificationName];
                if (!itemArray) {
                    acc[classificationName] = [];
                }
                acc[classificationName].push(itemData);
            }      
            return acc;
        }, {} as Record<string, MenuItem[]>);

        return groupedItems;
    }
};