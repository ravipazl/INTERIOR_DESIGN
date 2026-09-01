/**
 * Tiny shared holder for the catalog model currently being dragged onto the 3D
 * canvas (Coohom-style drag-to-place). The catalog card sets it on dragstart;
 * the canvas drop handler reads it on drop. Kept module-local (not on window) so
 * it's private to the app and can't clash with anything else.
 *
 * This is purely ADDITIVE — the existing "+ Add" button flow does not use it.
 */
let draggedModel: any = null;

export const setDraggedModel = (model: any): void => {
  draggedModel = model;
};

export const getDraggedModel = (): any => draggedModel;

export const clearDraggedModel = (): void => {
  draggedModel = null;
};
