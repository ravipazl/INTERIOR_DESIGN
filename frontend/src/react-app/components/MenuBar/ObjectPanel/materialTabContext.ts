import { createContext, useContext } from "react";

// Lets the finish panel, which lives deep inside the Properties tab
// (objectProperties → objectComponents → ObjectFinishingsModal), render itself
// into the Material tab at the top of ObjectPanel instead of floating over the
// canvas. Only the container element and an "is it open" signal travel up; all
// of the finish panel's own state stays exactly where it was.
export interface MaterialTabContextValue {
  /** Element inside the Material tab to portal the finish panel into. */
  container: HTMLElement | null;
  /** Tell ObjectPanel whether a part's finish panel is currently open. */
  setMaterialOpen: (open: boolean) => void;
}

export const MaterialTabContext = createContext<MaterialTabContextValue | null>(
  null
);

export const useMaterialTab = () => useContext(MaterialTabContext);
