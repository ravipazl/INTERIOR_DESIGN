import { type } from "os";

export type Root = Menu[];

export interface Menu {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface MenuItem {
  id: string;
  itemName: string;
  itemType: string;
  iconName: string | null;
  value?: number | null | undefined; // Allow for undefined
  classification?: string;
  actionType: string;
  unitOptions?: UnitOption[];
}

export interface UnitOption {
  id: string;
  name: string;
  value: string;
}
export interface MenuTab {
  item: string;
  menuName: string;
  handleMenuItemClick: (itemData: MenuItem) => void;
  mode: string;
  showTemplateMenu: boolean;
}
export interface MenuTabProps {
  itemData: MenuItem;
  handleMenuItemClick: (itemData: MenuItem) => void;
  mode: string;
  buttonRef: React.RefObject<HTMLButtonElement>;
  handleUnitChange: (value: string) => void;
}

export interface MenuGroupedButtonProps {
  item: string;
  menuName: string;
  handleMenuItemClick: (itemData: MenuItem) => void;
  mode: string;
  buttonRef: React.RefObject<HTMLButtonElement>;
  handleUnitChange: (value: string) => void;
  activeTab?: string;
}

export interface TreeNode {
  id: string;
  name: string;
  children: TreeNode[];
  parent?: TreeNode[];
  parentCategoryId?: string;
  url?: string;
  data: {
    id: string;
    name: string;
    url: string;
  };
}

export interface roomPanelProps {
  _id: string;
  name: string;
  thumbnail: string;
  modelFileUrl: string;
  description: string;
  hardware: string;
  createdAt: string;
  categoryId: string;
  maxWidth: number;
  standardWidth: number[];
  price: number;
  measuredUnits: string;
}

export interface roomPanelModalProps {
  modalData: roomPanelProps;
  onAddItemToSceneClick: () => void;
  isDarkMode?: boolean;
  /** Shown only when the model is user-created (upload / Sketchfab / AI). */
  canDelete?: boolean;
  /** Triggered when the user confirms deletion in the card. */
  onDelete?: () => void;
  /** Disables the card buttons while a delete request is in flight. */
  isDeleting?: boolean;
}

export interface roomPanelModalCardProps {
  childItem: {
    data: {
      id: string;
      url: string;
      name: string;
    };
  };
  onSelectedChildrenNode: () => void;
}
