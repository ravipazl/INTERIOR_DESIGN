import { BaseFloorplanViewElement2D } from "./BaseFloorplanViewElement2D.js";
import { Dimensioning } from "../core/dimensioning.js";

/** A column in the 2D plan: solid black, the box it is. */
const COLUMN_FILL = 0x0d0d0f;

/**
 * A STRUCTURAL COLUMN in the 2D plan, drawn as the rectangle the floorplan
 * gives it ({ x0, y0, x1, y1 }, cm) — over the walls it stands in or against,
 * never as a wall. Not interactive: it is neither picked nor dragged, and it
 * looks the same hovered or not.
 */
export class ColumnView2D extends BaseFloorplanViewElement2D {
  constructor(floorplan, options, column) {
    super(floorplan, options);
    this.__column = column;
    this.__deactivate();
    // The 2D view switches every entity's `interactive` on and off as the mode
    // changes; a column is never picked, and must not catch a click meant for
    // the wall under it.
    Object.defineProperty(this, "interactive", { get: () => false, set: () => {} });
    this.buttonMode = false;
    this.__draw();
  }

  __draw() {
    const c = this.__column;
    const a = Dimensioning.cmToPixelVector2D({ x: Math.min(c.x0, c.x1), y: Math.min(c.y0, c.y1) });
    const b = Dimensioning.cmToPixelVector2D({ x: Math.max(c.x0, c.x1), y: Math.max(c.y0, c.y1) });
    this.clear();
    this.lineStyle(0);
    this.beginFill(COLUMN_FILL, 1.0);
    this.drawRect(a.x, a.y, b.x - a.x, b.y - a.y);
    this.endFill();
  }

  __drawSelectedState() {
    this.__draw();
  }

  __drawHoveredOnState() {
    this.__draw();
  }

  __drawHoveredOffState() {
    this.__draw();
  }

  get column() {
    return this.__column;
  }
}
