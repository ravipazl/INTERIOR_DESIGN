export interface TemplateCard {
  title: string;
  id: string;
  size: string;
  url?: any;
  coverImageUrl: any;
}
export interface TemplateCardProps {
  title: string;
  id: string | number;
  size: string;
  url?: any;
  coverImageUrl: any;
  // Only user-saved (custom) templates are deletable; built-in ones are not.
  isCustom?: boolean;
  onTemplateSelect?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}
export interface TemplateMenuProps {
  templateList: TemplateCardProps[];
  onTemplateSelect: (e: React.MouseEvent<HTMLButtonElement>) => void;
  isModalVisible: boolean;
  onHide: (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => void;
  isFloorPlanCleared: boolean;
  // Optional: delete a custom template by id.
  onTemplateDelete?: (id: string) => void;
}

export interface ChildTemplateCardProps {
  template: TemplateCardProps;
  onTemplateSelect: (
    e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>
  ) => void;
  // Ask the menu to show its styled confirm popup for this template.
  onRequestDelete?: (template: TemplateCardProps) => void;
}
