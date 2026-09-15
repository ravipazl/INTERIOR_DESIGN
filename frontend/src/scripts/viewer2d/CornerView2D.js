import { BaseFloorplanViewElement2D } from "./BaseFloorplanViewElement2D.js";
import { Dimensioning } from "../core/dimensioning.js";
import { Vector2, EventDispatcher, CompressedPixelFormat } from "three";
import { EVENT_MOVED, EVENT_DELETED, ACTION_EVENT_2D } from "../core/events.js";
import { Point, Circle } from "pixi.js";
import {
  Configuration,
  snapTolerance,
  snapToGrid,
  dragOnlyX,
  dragOnlyY,
} from "../core/configuration.js";
import { isMobile } from "detect-touch-device";

// import {pointPolygon, pointBox} from 'intersects';

export class CornerView2D extends BaseFloorplanViewElement2D {
  constructor(floorplan, options, corner) {
    super(floorplan, options);
    this.__options["corner-radius"] = 12.5;
    for (var opt in options) {
      if (this.__options.hasOwnProperty(opt) && options.hasOwnProperty(opt)) {
        this.__options[opt] = options[opt];
      }
    }

    this.__corner = corner;
    this.pivot.x = this.pivot.y = 0.5;
    // A full-size hit area, so a curve joint drawn tiny (see
    // __drawHoveredOffState) is still as easy to hover and drag as any corner.
    this.hitArea = new Circle(
      0,
      0,
      (isMobile ? 2.5 : 1) * this.__options["corner-radius"]
    );

    this.__cornerUpdateEvent = this.__updateWithModel.bind(this);
    this.__cornerDeletedEvent = this.__cornerDeleted.bind(this);

    this.__floorplan = floorplan;
    this.interactive = corner.isLocked;
    this.buttonMode = corner.isLocked;

    if (corner.isLocked) {
      this.__deactivate();
    }

    this.__drawHoveredOffState();

    this.__corner.addEventListener(EVENT_MOVED, this.__cornerUpdateEvent);
    this.__corner.addEventListener(EVENT_DELETED, this.__cornerDeletedEvent);
    // this.__floorplan.addEventListener(
    //   ACTION_EVENT_2D,
    //   this.__mouseUpEvent
    // );
    this.__updateWithModel();
  }

  __drawCornerState(radius, borderColor, fillColor) {
    this.clear();
    let alpha = 0.5; //1.0;//
    let useRadius = isMobile ? radius * 2.5 : radius;
    let insideRadius = useRadius * 0.55;
    let xOut = 0; //useRadius * 0.5;//
    let yOut = 0; //useRadius * 0.5;//
    // if (isMobile) {
    //     useRadius = radius * 2.5;
    //     // this.beginFill(borderColor, alpha);
    //     // this.drawCircle(0, 0, useRadius);
    //     // this.endFill();
    // }
    this.beginFill(borderColor, alpha);
    this.drawCircle(xOut, yOut, useRadius);
    this.endFill();
    this.beginFill(fillColor, alpha);
    this.drawCircle(xOut, yOut, insideRadius);
    this.endFill();
  }

  __drawSelectedState() {
    super.__drawSelectedState();
    let radius = this.__options["corner-radius"];
    this.__drawCornerState(radius, 0x04a9f5, 0x049995);
  }
  __drawHoveredOnState() {
    super.__drawHoveredOnState();
    let radius = this.__options["corner-radius"] * 1.0;
    this.__drawCornerState(radius, 0x000000, 0x04a9f5);
  }
  __drawHoveredOffState() {
    super.__drawHoveredOffState();
    // A joint along a curve (Arc / Circle / Fillet build curves from short
    // straight walls) gets a tiny dot, so the curve reads as one smooth wall
    // instead of a string of beads. Real corners keep the full dot, and
    // hovering or selecting any joint still draws it full size.
    if (this.__isCurveJoint()) {
      // nothing is drawn: the curve reads as one wall. The full-size hitArea
      // still catches the mouse, and hover draws the normal dot.
      this.clear();
      return;
    }
    let radius = this.__options["corner-radius"];
    this.__drawCornerState(radius, 0xcccccc, 0x000000);
  }

  // A joint along a curve (Arc / Circle / Fillet build curves from short
  // straight walls):
  //   inner   — two pieces of the same length bending less than 42°
  //   tangent — where the curve runs smoothly into a straight wall: bends less
  //             than 25° and the shorter wall is a curve piece
  // Real corners — sharper bends, different lengths, 3+ walls — are neither.
  __isCurveJoint() {
    try {
      return !!CornerView2D.jointAt(this.__corner);
    } catch (e) {
      return false;
    }
  }

  static legsAt(c) {
    if (!c) return null;
    const walls = [...(c.wallStarts || []), ...(c.wallEnds || [])];
    if (walls.length !== 2) return null;
    const legs = walls.map((w) => {
      const o = w.start === c ? w.end : w.start;
      if (!o) return null;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const l = Math.hypot(dx, dy);
      return l > 1e-6 ? { w, o, ux: dx / l, uy: dy / l, l } : null;
    });
    return legs[0] && legs[1] ? legs : null;
  }

  static isInnerJoint(c) {
    const legs = CornerView2D.legsAt(c);
    if (!legs) return false;
    const [a, b] = legs;
    if (Math.abs(a.l - b.l) > Math.max(1.5, 0.05 * Math.max(a.l, b.l))) return false;
    return a.ux * b.ux + a.uy * b.uy < -0.743;
  }

  static jointAt(c) {
    const legs = CornerView2D.legsAt(c);
    if (!legs) return null;
    if (CornerView2D.isInnerJoint(c)) return "inner";
    const [a, b] = legs;
    if (a.ux * b.ux + a.uy * b.uy >= -0.906) return null;
    const short = a.l < b.l ? a : b;
    return CornerView2D.isInnerJoint(short.o) ? "tangent" : null;
  }

  __updateWithModel() {
    let xx = Dimensioning.cmToPixel(this.__corner.location.x);
    let yy = Dimensioning.cmToPixel(this.__corner.location.y);
    this.position.x = xx;
    this.position.y = yy;
  }

  __dragStart(evt) {
    super.__dragStart(evt);
  }

  __dragMove(evt) {
    super.__dragMove(evt);
    if (this.__isDragging) {
      let co = evt.data.getLocalPosition(this.parent);
      let cmCo = new Point(co.x, co.y);

      cmCo.x = Dimensioning.pixelToCm(cmCo.x);
      cmCo.y = Dimensioning.pixelToCm(cmCo.y);

      if (Configuration.getBooleanValue(snapToGrid) || this.__snapToGrid) {
        cmCo.x =
          Math.floor(cmCo.x / Configuration.getNumericValue(snapTolerance)) *
          Configuration.getNumericValue(snapTolerance);
        cmCo.y =
          Math.floor(cmCo.y / Configuration.getNumericValue(snapTolerance)) *
          Configuration.getNumericValue(snapTolerance);
      }

      if (
        Configuration.getBooleanValue(dragOnlyX) &&
        !Configuration.getBooleanValue(dragOnlyY)
      ) {
        cmCo.y = this.__corner.location.y;
      }

      if (
        !Configuration.getBooleanValue(dragOnlyX) &&
        Configuration.getBooleanValue(dragOnlyY)
      ) {
        cmCo.x = this.__corner.location.x;
      }
      if (this.__floorplan.boundary) {
        if (!this.__floorplan.boundary.containsPoint(cmCo.x, cmCo.y)) {
          return;
        }
        if (
          this.__floorplan.boundary.intersectsExternalDesign(cmCo.x, cmCo.y)
        ) {
          return;
        }
      }
      this.__corner.move(990, -50);
      // console.log(cmCo, "cmCo");
    }
  }

  __dragEnd(evt) {
    super.__dragEnd(evt);
    this.__floorplan.update();
    console.debug(scope, "drag event in corner view ");
  }

  __cornerDeleted(evt) {
    this.remove();
    this.__corner = null;
  }

  __removeFromFloorplan() {
    this.__corner.remove();
  }

  __dragMove(evt) {
    super.__dragMove(evt);
    if (this.__isDragging) {
      let co = evt.data.getLocalPosition(this.parent);
      let cmCo = new Point(co.x, co.y);
      cmCo.x = Dimensioning.pixelToCm(cmCo.x);
      cmCo.y = Dimensioning.pixelToCm(cmCo.y);

      if (Configuration.getBooleanValue(snapToGrid) || this.__snapToGrid) {
        cmCo.x =
          Math.floor(cmCo.x / Configuration.getNumericValue(snapTolerance)) *
          Configuration.getNumericValue(snapTolerance);
        cmCo.y =
          Math.floor(cmCo.y / Configuration.getNumericValue(snapTolerance)) *
          Configuration.getNumericValue(snapTolerance);
      }

      if (
        Configuration.getBooleanValue(dragOnlyX) &&
        !Configuration.getBooleanValue(dragOnlyY)
      ) {
        cmCo.y = this.__corner.location.y;
      }

      if (
        !Configuration.getBooleanValue(dragOnlyX) &&
        Configuration.getBooleanValue(dragOnlyY)
      ) {
        cmCo.x = this.__corner.location.x;
      }
      if (this.__floorplan.boundary) {
        if (!this.__floorplan.boundary.containsPoint(cmCo.x, cmCo.y)) {
          return;
        }
        if (
          this.__floorplan.boundary.intersectsExternalDesign(cmCo.x, cmCo.y)
        ) {
          return;
        }
      }
      this.__corner.move(cmCo.x, cmCo.y);
    }
  }

  __dragEnd(evt) {
    super.__dragEnd(evt);
    this.__floorplan.update();
  }

  __cornerDeleted(evt) {
    this.remove();
    this.__corner = null;
  }

  __removeFromFloorplan() {
    this.__corner.remove();
  }

  remove() {
    this.__corner.removeEventListener(EVENT_DELETED, this.__cornerDeletedEvent);
    this.__corner.removeEventListener(EVENT_MOVED, this.__cornerUpdateEvent);
    super.remove();
  }

  get corner() {
    return this.__corner;
  }
}
