import { Application, Graphics, Text, Sprite, Container } from "pixi.js";
import { dimUnitWallLabel } from "../../react-app/utils/unitsUtils.js";
import { Viewport } from "pixi-viewport";
import { Vector2, Vector3, EventDispatcher, CompressedPixelFormat, Color } from "three";
import {
  EVENT_NEW,
  EVENT_DELETED,
  EVENT_LOADED,
  EVENT_2D_SELECTED,
  EVENT_NEW_ROOMS_ADDED,
  EVENT_KEY_RELEASED,
  EVENT_KEY_PRESSED,
  EVENT_WALL_2D_CLICKED,
  EVENT_CORNER_2D_CLICKED,
  EVENT_ROOM_2D_CLICKED,
  EVENT_NOTHING_2D_SELECTED,
  EVENT_MOVED,
  EVENT_MODE_RESET,
  EVENT_EXTERNAL_FLOORPLAN_LOADED,
  ACTION_EVENT_2D,
} from "../core/events";
import { Grid2D } from "./Grid2d";
import { CornerView2D } from "./CornerView2D";
import { WallView2D } from "./WallView2D";
import { RoomView2D } from "./RoomView2D";
import { Dimensioning } from "../core/dimensioning";
import { KeyboardListener2D } from "./KeyboardManager2D";
import {
  Configuration,
  snapToGrid,
  snapTolerance,
  viewBounds,
} from "../core/configuration";
import { IS_TOUCH_DEVICE } from "../../DeviceInfo";
import { CornerGroupTransform2D } from "./CornerGroupTransform2D";
import Room from "../model/room";
import { BoundaryView2D } from "./BoundaryView2D";
import BlueprintInterface from "@pazl/blueprint-interface";

export const floorplannerModes = { MOVE: 0, DRAW: 1, EDIT_ISLANDS: 2 };

class TemporaryWall extends Graphics {
  constructor() {
    super();
    this.__textfield = new Text("Length: ", {
      fontFamily: "Arial",
      fontSize: 14,
      fill: "black",
      align: "center",
    });
    // this.__textfield.pivot.x = this.__textfield.pivot.y = 0.5;
    this.addChild(this.__textfield);
  }

  __toPixels(vector) {
    vector.x = Dimensioning.cmToPixel(vector.x);
    vector.y = Dimensioning.cmToPixel(vector.y);
    return vector;
  }

  update(corner, endPoint, startPoint) {
    this.clear();
    this.__textfield.visible = false;
    if (corner !== undefined && endPoint !== undefined) {
      let pxCornerCo = this.__toPixels(corner.location.clone());
      let pxEndPoint = this.__toPixels(endPoint.clone());
      let vect = endPoint.clone().sub(corner.location);
      let midPoint = pxEndPoint
        .clone()
        .sub(pxCornerCo)
        .multiplyScalar(0.5)
        .add(pxCornerCo);

      this.lineStyle(10, 0x008cba);
      this.moveTo(pxCornerCo.x, pxCornerCo.y);
      this.lineTo(pxEndPoint.x, pxEndPoint.y);

      this.beginFill(0x008cba, 0.5);
      this.drawCircle(pxEndPoint.x, pxEndPoint.y, 10);

      this.__textfield.position.x = midPoint.x;
      this.__textfield.position.y = midPoint.y;
      if (
        Configuration.getData().dimUnit === "mm" ||
        Configuration.getData().dimUnit === "m"
      ) {
        //showing the labels in terms of meters even though the unit is mm
        this.__textfield.text = Dimensioning.cmToMeasureUnit(
          vect.length(),
          1,
          "m"
        );
      }
      if (Configuration.getData().dimUnit === "feetAndInch") {
        this.__textfield.text = Dimensioning.cmToMeasureUnit(
          vect.length(),
          1,
          "feetAndInch"
        );
      }
      // console.log("textfield ", this.__textfield);
      this.__textfield.visible = true;
    }
    if (startPoint !== undefined) {
      let pxStartCo = this.__toPixels(startPoint);
      this.beginFill(0x008cba, 0.5);
      this.drawCircle(pxStartCo.x, pxStartCo.y, 10);
    }
  }
}

export class Viewer2D extends Application {
  constructor(canvasHolder, floorplan, options, models) {
    const { pixiAppOptions, pixiViewportOptions } = options;
    const pixiDefalultAppOpts = {
      width: 512,
      height: 512,
      resolution: window.devicePixelRatio || 2,
      antialias: true,
      transparent: false,
    };
    // super({width: 512, height: 512});
    super(Object.assign(pixiDefalultAppOpts, pixiAppOptions));
    this.__eventDispatcher = new EventDispatcher();

    let opts = {
      "corner-radius": 20,
      "boundary-point-radius": 5.0,
      "boundary-line-thickness": 1.0,
      "boundary-point-color": "#D3D3D3",
      "boundary-line-color": "#F3F3F3",
      pannable: true,
      zoomable: true,
      dimlinecolor: "#3EDEDE",
      dimarrowcolor: "#000000",
      dimtextcolor: "#000000",
      scale: true,
      rotate: true,
      translate: true,
      resize: true,
    };
    this.__gridOptions = options;

    for (var opt in opts) {
      if (opts.hasOwnProperty(opt) && options.hasOwnProperty(opt)) {
        opts[opt] = options[opt];
      }
    }

    // console.log('VIEWER 2D ::: ', opts);
    this.__mode = floorplannerModes.MOVE;
    this.__canvasHolder = document.getElementById(canvasHolder);
    this.__floorplan = floorplan;

    this.__options = opts;

    this.__models = models;

    this.__lastNode = null;
    this.__tempWall = new TemporaryWall();

    this.__corners2d = [];
    this.__walls2d = [];
    this.__rooms2d = [];
    this.__entities2D = [];

    this.__externalCorners2d = [];
    this.__externalWalls2d = [];
    this.__externalRooms2d = [];
    this.__externalEntities2d = [];

    this.__worldWidth = 3000;
    this.__worldHeight = 3000;
    this.__currentWidth = 500;
    this.__currentHeight = 500;
    this.__currentSelection = null;

    this.__zoomedEvent = this.__zoomed.bind(this);
    this.__pannedEvent = this.__panned.bind(this);
    this.__selectionMonitorEvent = this.__selectionMonitor.bind(this);
    this.__cornerMovedEvent = this.__cornerMoved.bind(this);
    this.__gridUnitChangedEvent = this.__gridUnitChanged.bind(this);
    this.__drawModeMouseDownEvent = this.__drawModeMouseDown.bind(this);
    this.__drawModeMouseUpEvent = this.__drawModeMouseUp.bind(this);
    this.__drawModeMouseMoveEvent = this.__drawModeMouseMove.bind(this);

    this.__redrawFloorplanEvent = this.__redrawFloorplan.bind(this);
    this.__drawExternalFloorplanEvent = this.__drawExternalFloorplan.bind(this);
    this.__windowResizeEvent = this._handleWindowResize.bind(this);
    this.__resetFloorplanEvent = this.__resetFloorplan.bind(this);

    this.__floorplanLoadedEvent = this.__center.bind(this);

    const pixiViewportDefaultOpts = {
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      worldWidth: this.__worldWidth,
      worldHeight: this.__worldHeight,
      interaction: this.renderer.plugins.interaction,
      passiveWheel: false,
    };

    this.__floorplanContainer = new Viewport(
      Object.assign(pixiViewportDefaultOpts, pixiViewportOptions)
    );
    this.__tempWallHolder = new Graphics();

    this.__snapToGrid = false;
    this.__keyboard = new KeyboardListener2D();
    this.__keyListenerEvent = this.__keyListener.bind(this);

    let origin = new Graphics();
    this.__floorplanElementsHolder = new Graphics();
    // Overall-dimensions overlay (read-only). Mode: "off" | "inner" | "outer".
    // Only ONE is ever shown at a time so the user is never shown two
    // conflicting totals. OFF by default.
    this.__dimMode = "off";
    this.__boundaryHolder = new Graphics();
    this.__grid2d = new Grid2D(this.view, options);
    this.__boundaryRegion2D = null;
    this.__groupTransformer = new CornerGroupTransform2D(
      this.__floorplan,
      this.__options
    );
    this.__groupTransformer.visible = false;
    this.__groupTransformer.selected = null;

    origin.beginFill(0xff0000);
    origin.drawCircle(0, 0, 5);

    this.__floorplanContainer.position.set(
      window.innerWidth * 0.5,
      window.innerHeight * 0.5
    );

    this.renderer.backgroundColor = this.__getBackgroundColor();
    /*let img = new Sprite.from("./icons/bg.jpg");
        img.width = window.innerWidth;
        img.height = window.innerHeight;
        this.stage.addChild(img);*/
    // this.renderer.backgroundImage = './icons/bg.jpg';
    this.renderer.autoResize = true;
    this.__tempWall.visible = false;
    this.__floorplanContainer.addChild(this.__grid2d);
    this.__floorplanContainer.addChild(this.__boundaryHolder);
    // this.__floorplanContainer.addChild(this.__tempWall);
    this.__floorplanContainer.addChild(origin);
    this.__floorplanContainer.addChild(this.__floorplanElementsHolder);
    this.__floorplanContainer.addChild(this.__groupTransformer);

    this.__tempWallHolder.addChild(this.__tempWall);

    this.stage.addChild(this.__floorplanContainer);
    this.stage.addChild(this.__tempWallHolder);

    this.__canvasHolder.appendChild(this.view);

    this.__floorplanContainer.drag().pinch().wheel();

    if (!this.__options.pannable) {
      this.__floorplanContainer.plugins.pause("drag");
    }

    if (!this.__options.zoomable) {
      this.__floorplanContainer.plugins.pause("wheel");
      this.__floorplanContainer.plugins.pause("pinch");
    }

    this.__keyboard.addEventListener(
      EVENT_KEY_RELEASED,
      this.__keyListenerEvent
    );
    this.__keyboard.addEventListener(
      EVENT_KEY_PRESSED,
      this.__keyListenerEvent
    );

    this.__floorplanContainer.on("zoomed", this.__zoomedEvent);
    this.__floorplanContainer.on("moved", this.__pannedEvent);
    this.__floorplanContainer.on("clicked", this.__selectionMonitorEvent);

    this.__floorplanContainer.on("mousedown", this.__drawModeMouseDownEvent);
    this.__floorplanContainer.on("mouseup", this.__drawModeMouseUpEvent);
    this.__floorplanContainer.on("mousemove", this.__drawModeMouseMoveEvent);

    //User touches the screen then emulate the Mouseup event creating a corner
    this.__floorplanContainer.on("touchstart", this.__drawModeMouseUpEvent);
    //User then touch moves and lifts the finger away from the screen. Now create the next corner
    this.__floorplanContainer.on("touchend", this.__drawModeMouseUpEvent);

    //Use touches and drags across the screen then emulate drawing the temporary wall
    this.__floorplanContainer.on("touchmove", this.__drawModeMouseMoveEvent);

    // this.__floorplan.addEventListener(EVENT_UPDATED, (evt) => scope.__redrawFloorplan(evt));

    this.__floorplan.addEventListener(
      EVENT_LOADED,
      this.__floorplanLoadedEvent
    );

    this.__floorplan.addEventListener(
      EVENT_MODE_RESET,
      this.__resetFloorplanEvent
    );
    this.__floorplan.addEventListener(EVENT_NEW, this.__redrawFloorplanEvent);
    this.__floorplan.addEventListener(
      EVENT_DELETED,
      this.__redrawFloorplanEvent
    );

    this.__floorplan.addEventListener(
      EVENT_NEW_ROOMS_ADDED,
      this.__redrawFloorplanEvent
    );

    this.__floorplan.addEventListener(
      EVENT_EXTERNAL_FLOORPLAN_LOADED,
      this.__drawExternalFloorplanEvent
    );
    window.addEventListener("resize", this.__windowResizeEvent);
    window.addEventListener("orientationchange", this.__windowResizeEvent);

    // Re-fit when the container resizes (a docked sidebar reflowing it).
    if (typeof ResizeObserver !== "undefined" && this.__canvasHolder) {
      this.__resizeObserver = new ResizeObserver(this.__windowResizeEvent);
      this.__resizeObserver.observe(this.__canvasHolder);
    }

    this._handleWindowResize();

    this.__center();
  }

  __drawBoundary() {
    // return;
    if (this.__boundaryRegion2D) {
      this.__boundaryRegion2D.remove();
    }

    if (this.__floorplan.boundary) {
      if (this.__floorplan.boundary.isValid) {
        this.__boundaryRegion2D = new BoundaryView2D(
          this.__floorplan,
          this.__options,
          this.__floorplan.boundary
        );
        this.__boundaryHolder.addChild(this.__boundaryRegion2D);
      }
    }
  }

  __keyListener(evt) {
    if (evt.type === EVENT_KEY_PRESSED && evt.key === "Shift") {
      this.__snapToGrid = true;
    }
    if (evt.type === EVENT_KEY_RELEASED && evt.key === "Shift") {
      this.__snapToGrid = false;
    }
    if (evt.key === "Escape") {
      this.switchMode(floorplannerModes.MOVE);
    }
  }

  switchMode(mode) {
    if (
      this.__mode === floorplannerModes.EDIT_ISLANDS &&
      mode !== floorplannerModes.EDIT_ISLANDS
    ) {
      this.__floorplan.update();
    }
    switch (mode) {
      case floorplannerModes.DRAW:
        this.__mode = floorplannerModes.DRAW;
        this.__floorplanContainer.plugins.pause("drag");
        for (let i = 0; i < this.__entities2D.length; i++) {
          this.__entities2D[i].interactive = false;
        }
        this.__changeCursorMode();
        this.__tempWall.update();
        this.__tempWall.visible = true;
        this.__groupTransformer.visible = false;
        this.__groupTransformer.selected = null;
        break;
      case floorplannerModes.EDIT_ISLANDS:
        this.__mode = floorplannerModes.EDIT_ISLANDS;
        if (this.__currentSelection instanceof Room) {
          this.__groupTransformer.visible = true;
          this.__groupTransformer.selected = this.__currentSelection;
        } else {
          this.__groupTransformer.visible = false;
          this.__groupTransformer.selected = null;
        }

        this.__floorplanContainer.plugins.pause("drag");
        for (let i = 0; i < this.__corners2d.length; i++) {
          this.__corners2d[i].interactive = false;
        }
        for (let i = 0; i < this.__walls2d.length; i++) {
          this.__walls2d[i].interactive = false;
        }
        this.__changeCursorMode();
        break;
      case floorplannerModes.MOVE:
        this.__mode = floorplannerModes.MOVE;
        for (let i = 0; i < this.__entities2D.length; i++) {
          this.__entities2D[i].interactive = true;
        }
        this.__tempWall.visible = false;
        this.__groupTransformer.visible = false;
        this.__groupTransformer.selected = null;
        this.__lastNode = null;
        this.__floorplanContainer.plugins.resume("drag");
        this.__changeCursorMode();
        break;
      default:
        throw new Error("Unknown Viewer2D mode");
    }
  }

  __gridUnitChanged(evt) {
    console.debug("Viewer2D.js ~ __gridUnitChanged ~ event", evt);
    let scope = this;
    if (evt.unit === "M") {
      Configuration.setValue("snapTolerance", 100);
      Configuration.setValue("gridSpacing", 100);
      scope.__grid2d = new Grid2D(scope.view, scope.__gridOptions);
      scope.__floorplanContainer.addChildAt(scope.__grid2d, 1);
    } else if (evt.unit === "Ft") {
      Configuration.setValue("snapTolerance", 30.48);
      Configuration.setValue("gridSpacing", 30.48);
      scope.__grid2d = new Grid2D(scope.view, scope.__gridOptions);
      scope.__floorplanContainer.addChildAt(scope.__grid2d, 1);
    }
  }

  __changeCursorMode() {
    let cursor =
      this.__mode === floorplannerModes.DRAW ? "crosshair" : "pointer";
    this.renderer.plugins.interaction.cursorStyles.crosshair = cursor;
    this.renderer.plugins.interaction.cursorStyles.default = cursor;
    this.renderer.plugins.interaction.setCursorMode(cursor);
  }

  __drawModeMouseDown(evt) {
    if (IS_TOUCH_DEVICE) {
      this.__drawModeMouseUp(evt);
    }
  }

  __drawModeMouseUp(evt) {
    if (this.__mode === floorplannerModes.DRAW) {
      let co = evt.data.getLocalPosition(this.__floorplanContainer);
      let cmCo = new Vector2(co.x, co.y);
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

      if (this.__floorplan.boundary) {
        if (!this.__floorplan.boundary.containsPoint(cmCo.x, cmCo.y)) {
          //return;
        }
      }

      // This creates the corner already
      let corner = this.__floorplan.newCorner(cmCo.x, cmCo.y);

      // further create a newWall based on the newly inserted corners
      // (one in the above line and the other in the previous mouse action
      // of start drawing a new wall)
      if (this.__lastNode != null) {
        this.__floorplan.newWall(this.__lastNode, corner);
        this.__floorplan.newWallsForIntersections(this.__lastNode, corner);
        console.debug(this, "wall created");

        BlueprintInterface.actionsHistory2DManager.rise2DActionEvent(
          ACTION_EVENT_2D,
          corner
        );
        // this.__tempWall.visible = false;
        // this.switchMode(floorplannerModes.MOVE);
      }
      if (corner.mergeWithIntersected() && this.__lastNode != null) {
        this.__tempWall.visible = false;
        this.__lastNode = null;
        this.switchMode(floorplannerModes.MOVE);
      }

      if (this.__lastNode === null && this.__mode === floorplannerModes.DRAW) {
        this.__tempWall.visible = true;
      }

      if (IS_TOUCH_DEVICE && corner && this.__lastNode !== null) {
        this.__tempWall.visible = false;
        this.__lastNode = null;
      } else {
        this.__lastNode = corner;
      }
    }
  }

  __drawModeMouseMove(evt) {
    if (this.__mode === floorplannerModes.DRAW) {
      let co = evt.data.getLocalPosition(this.__floorplanContainer);
      let cmCo = new Vector2(co.x, co.y);
      let lastNode = undefined;
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
      if (this.__lastNode !== null) {
        this.__tempWall.update(this.__lastNode, cmCo);
      } else {
        this.__tempWall.update(lastNode, undefined, cmCo);
      }
    }
  }

  __cornerMoved(evt) {
    if (this.__mode === floorplannerModes.EDIT_ISLANDS) {
      return;
    }
    this.__groupTransformer.visible = false;
    this.__groupTransformer.selected = null;
  }

  __selectionMonitor(evt) {
    this.__currentSelection = null;
    this.__groupTransformer.visible = false;
    this.__groupTransformer.selected = null;
    // Selecting a wall/corner/room (or empty) clears any highlighted opening
    // and closes its panel.
    if (this.__selectedOpening) {
      this.__selectedOpening = null;
      this.__drawDoors();
      try {
        if (typeof window !== "undefined")
          window.dispatchEvent(new CustomEvent("pazl-opening-2d-deselected"));
      } catch (e) {
        /* ignore */
      }
    }
    this.__eventDispatcher.dispatchEvent({ type: EVENT_NOTHING_2D_SELECTED });
    for (let i = 0; i < this.__entities2D.length; i++) {
      let entity = this.__entities2D[i];
      if (evt.item !== undefined) {
        if (evt.item === entity) {
          continue;
        }
      }
      entity.selected = false;
    }
    if (evt.item) {
      let item = null;
      if (evt.item instanceof WallView2D) {
        item = evt.item.wall;
        // console.log("evt.item.wall ", evt.item.wall);
        this.__eventDispatcher.dispatchEvent({
          type: EVENT_WALL_2D_CLICKED,
          item: evt.item.wall,
          entity: evt.item,
        });
      } else if (evt.item instanceof CornerView2D) {
        item = evt.item.corner;
        this.__eventDispatcher.dispatchEvent({
          type: EVENT_CORNER_2D_CLICKED,
          item: evt.item.corner,
          entity: evt.item,
        });
      } else if (evt.item instanceof RoomView2D) {
        item = evt.item.room;
        this.__eventDispatcher.dispatchEvent({
          type: EVENT_ROOM_2D_CLICKED,
          item: evt.item.room,
          entity: evt.item,
        });
      }
      if (this.__mode === floorplannerModes.EDIT_ISLANDS) {
        this.__groupTransformer.visible = true;
        this.__groupTransformer.selected = item;
      }
      this.__currentSelection = item;
    }
    // Selection doesn't trigger a redraw on its own, so repaint here. This is
    // what makes the selected wall show BOTH its built-in full-width label and
    // its inner-face value, and what clears them off the previous selection.
    try {
      this.__applyWallDimVisibility(); // built-in label → selected wall
      this.__drawDimensionChains(); // overlay → selected wall's inner value
      this.renderer.render(this.stage);
    } catch (e) {
      /* ignore */
    }
  }

  __center() {
    let floorplanCenter = this.__floorplan.getCenter();
    let zoom = this.__floorplanContainer.scale.x;
    let windowSize = new Vector2(this.__currentWidth, this.__currentHeight);
    let bounds =
      Dimensioning.cmToPixel(Configuration.getNumericValue(viewBounds)) * zoom;

    let x = windowSize.x * 0.5 - floorplanCenter.x * 0.5; // - (bounds*0.5);
    let y = windowSize.y * 0.5 - floorplanCenter.z * 0.5; // - (bounds*0.5);
    this.__floorplanContainer.x = x;
    this.__floorplanContainer.y = y;
    this.__tempWallHolder.x = x;
    this.__tempWallHolder.y = y;
  }

  __zoomed() {
    let zoom = this.__floorplanContainer.scale.x;
    let bounds = Dimensioning.cmToPixel(
      Configuration.getNumericValue(viewBounds)
    ); // * zoom;
    let maxZoomOut = Math.max(window.innerWidth, window.innerHeight) / bounds;
    zoom = zoom < maxZoomOut ? maxZoomOut : zoom > 60 ? 60 : zoom;

    this.__floorplanContainer.scale.x = this.__floorplanContainer.scale.y =
      zoom;
    this.__tempWallHolder.scale.x = this.__tempWallHolder.scale.y = zoom;

    this.__grid2d.gridScale = this.__floorplanContainer.scale.x;
  }

  __panned() {
    let zoom = this.__floorplanContainer.scale.x;
    let bounds =
      Dimensioning.cmToPixel(Configuration.getNumericValue(viewBounds)) * zoom;

    let xy = new Vector2(
      this.__floorplanContainer.x,
      this.__floorplanContainer.y
    );
    let topleft = new Vector2(-(bounds * 0.5), -(bounds * 0.5));
    let bottomright = new Vector2(bounds * 0.5, bounds * 0.5);

    // let windowSize = new Vector2(window.innerWidth, window.innerHeight);
    let windowSize = new Vector2(this.__currentWidth, this.__currentHeight);

    let xValue = Math.min(-topleft.x, xy.x);
    let yValue = Math.min(-topleft.y, xy.y);

    xValue = Math.max(windowSize.x - bottomright.x, xValue);
    yValue = Math.max(windowSize.y - bottomright.y, yValue);

    this.__floorplanContainer.x = this.__tempWallHolder.x = xValue;
    this.__floorplanContainer.y = this.__tempWallHolder.y = yValue;
    // console.log('---------------------------------------------');
    // console.log('CURRENT ZOOM :: ', zoom);
    // console.log('TOP LEFT :: ', topleft);
    // console.log('BOTTOM RIGHT :: ', bottomright);
    // console.log('WINDOW SIZE :: ', windowSize);
    // console.log(`X=${xValue}, Y=${yValue}`);
  }

  __resetFloorplan(evt) {
    this.__mode = floorplannerModes.MOVE;
    this.__groupTransformer.visible = false;
    this.__groupTransformer.selected = null;
    this.__drawExternalFloorplan();
    // Clearing the canvas removes the walls/corners, but the door/window symbols
    // live in their own holders (__doorHolder / __itemLabelsHolder /
    // __doorHitHolder) which this reset path never touched — so they lingered as
    // orphan symbols until a later redraw. Re-run __drawDoors() here: with no
    // walls left it clears those holders and draws nothing, removing the orphans.
    this.__drawDoors();
  }

  // Optional read-only overlay, OFF by default, switched via
  // setDimensionsMode2D(). Reads geometry ONLY — never mutates, never
  // serialized. Fully guarded.
  //
  // HOW THIS ENGINE MEASURES A WALL (verified by building a real Floorplan and
  // measuring it, not assumed):
  //   A corner sits on the wall's OUTER face — NOT its centreline. The wall
  //   thickness grows INWARD from the corner line. Hence, per wall:
  //     wall.wallSize (corner-to-corner) === edge.exteriorDistance()  → OUTER
  //     edge.interiorDistance() === wallSize - 2 x thickness          → INNER
  //   There are only TWO values, not three. Outer > inner by 2 x thickness.
  //   (e.g. a 15.00 wall with 15cm thickness reads 14.02 inner.)
  //
  // Both modes draw into OUR OWN holder. The shared WallDimensions2D label is
  // never modified — it keeps printing wall.wallSize on wall-select, which is
  // already the OUTER / "full width" number (e.g. 15.00).
  //   "inner" → every wall's INNER-face length via interiorDistance() (14.02)
  //   "outer" → footprint totals + per-room OUTER-face spans (15.00)
  __drawDimensionChains() {
    try {
      if (!this.__dimChainHolder) {
        this.__dimChainHolder = new Container();
      }
      // Keep it above walls/rooms (re-add moves it to the top, like the doors).
      this.__floorplanElementsHolder.addChild(this.__dimChainHolder);
      this.__dimChainHolder.removeChildren();
      // Always full brightness — no dull state.
      this.__dimChainHolder.alpha = 1.0;
      if (this.__dimMode === "inner") {
        this.__drawInnerFaceLabels(); // every wall
        return;
      }
      // In every other mode the SELECTED wall still gets its inner value, so
      // clicking a wall shows BOTH numbers for it — the built-in 15.00 (full
      // width, drawn outside the wall) and 14.02 (inner face, drawn inside it).
      // Passing a corner/room selection is a harmless no-op (no wall matches).
      if (this.__currentSelection) {
        this.__drawInnerFaceLabels(this.__currentSelection);
      }
      if (this.__dimMode !== "outer") return;

      const corners = (this.__floorplan && this.__floorplan.corners) || [];
      const xs = [];
      const ys = [];
      corners.forEach((c) => {
        if (!c || typeof c.x !== "number" || typeof c.y !== "number") return;
        xs.push(c.x);
        ys.push(c.y);
      });
      if (xs.length < 2) return;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      // The corner box IS the OUTER footprint. Verified against the engine:
      // a corner sits on the wall's OUTER face, not its centreline — the wall
      // thickness grows INWARD from the corner line. Measured on a real
      // 500x400 plan, edge.exteriorStart/End() land exactly on the corners
      // ((0,0)->(500,0), length 500 === wall.wallSize) for every thickness,
      // while the interior face is inset by the FULL thickness
      // (interiorDistance === wallSize - 2 x thickness).
      // So we add NOTHING here — adding half a thickness would overstate the
      // footprint by one wall thickness on each axis.
      const bx0 = minX;
      const bx1 = maxX;
      const by0 = minY;
      const by1 = maxY;
      if (bx1 - bx0 < 1 || by1 - by0 < 1) return;

      const walls =
        (this.__floorplan &&
          this.__floorplan.getWalls &&
          this.__floorplan.getWalls()) ||
        [];

      // Per-segment lengths already appear as the built-in per-wall labels
      // (WallDimensions2D), so we draw ONLY the overall total here — no
      // duplicate segment chain.
      const OFF = 70; // cm — how far outside the plan the overall line sits
      const STUB = 10; // cm — extension stub near the plan edge
      // Use the EXACT same styling as the per-wall dimensions (WallDimensions2D):
      // identical defaults + the same robust three.js colour parsing (not a
      // naive parseInt), so the outer footprint and the inner labels match.
      const dimStyle = {
        dimlinecolor: "#3EDEDE",
        dimarrowcolor: "#000000",
        dimtextcolor: "#000000",
      };
      const src = this.__options || {};
      for (const k in dimStyle) {
        if (
          dimStyle.hasOwnProperty(k) &&
          Object.prototype.hasOwnProperty.call(src, k)
        ) {
          dimStyle[k] = src[k];
        }
      }
      const lineColor = new Color(dimStyle.dimlinecolor).getHex();
      const arrowColor = new Color(dimStyle.dimarrowcolor).getHex();
      const textColor = new Color(dimStyle.dimtextcolor).getHex();
      const px = (x, y) =>
        new Vector2(Dimensioning.cmToPixel(x), Dimensioning.cmToPixel(y));

      const g = new Graphics();
      this.__dimChainHolder.addChild(g); // add first so labels render on top
      const line = (x1, y1, x2, y2) => {
        g.lineStyle(2, lineColor, 1);
        const a = px(x1, y1);
        const b = px(x2, y2);
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      };
      const allStyle = {
        fontFamily: "Arial",
        fontSize: 14,
        fill: textColor,
      };
      const label = (text, cx, cy, rot) => {
        const t = new Text(text, allStyle);
        t.anchor.set(0.5, 0.5);
        const p = px(cx, cy);
        t.position.set(p.x, p.y);
        if (rot) t.rotation = rot;
        this.__dimChainHolder.addChild(t);
      };
      // Diamond end-markers (radius 5) — identical to the per-wall dimension
      // arrows, which are FILLED with the arrow colour while the dim-line stroke
      // is still active (they never reset lineStyle to 0). So keep the border.
      const diamond = (cx, cy) => {
        const c = px(cx, cy);
        const r = 5;
        g.lineStyle(2, lineColor, 1);
        g.beginFill(arrowColor, 1);
        g.drawPolygon([c.x, c.y - r, c.x + r, c.y, c.x, c.y + r, c.x - r, c.y]);
        g.endFill();
      };

      // TOP — overall width (to the offset faces)
      const topY = by0 - OFF;
      line(bx0, topY, bx1, topY);
      line(bx0, by0 - STUB, bx0, topY);
      line(bx1, by0 - STUB, bx1, topY);
      label(dimUnitWallLabel(bx1 - bx0), (bx0 + bx1) / 2, topY - 10);
      diamond(bx0, topY);
      diamond(bx1, topY);

      // LEFT — overall height (to the offset faces)
      const leftX = bx0 - OFF;
      line(leftX, by0, leftX, by1);
      line(bx0 - STUB, by0, leftX, by0);
      line(bx0 - STUB, by1, leftX, by1);
      label(
        dimUnitWallLabel(by1 - by0),
        leftX - 10,
        (by0 + by1) / 2,
        -Math.PI / 2
      );
      diamond(leftX, by0);
      diamond(leftX, by1);

      // BOTTOM — overall width (mirrors the top total on the far side)
      const botY = by1 + OFF;
      line(bx0, botY, bx1, botY);
      line(bx0, by1 + STUB, bx0, botY);
      line(bx1, by1 + STUB, bx1, botY);
      label(dimUnitWallLabel(bx1 - bx0), (bx0 + bx1) / 2, botY + 10);
      diamond(bx0, botY);
      diamond(bx1, botY);

      // RIGHT — overall height (mirrors the left total on the far side)
      const rightX = bx1 + OFF;
      line(rightX, by0, rightX, by1);
      line(bx1 + STUB, by0, rightX, by0);
      line(bx1 + STUB, by1, rightX, by1);
      label(
        dimUnitWallLabel(by1 - by0),
        rightX + 10,
        (by0 + by1) / 2,
        -Math.PI / 2
      );
      diamond(rightX, by0);
      diamond(rightX, by1);

      // ── Tier 2: ROOM-CLEAR chain (edge-aware, all four sides) ──────────────
      // Each side is divided ONLY by the walls that actually TOUCH that side —
      // not every wall projected onto the axis. So an interior partition deep in
      // the plan no longer chops up an outer wall it doesn't reach. For the
      // top/bottom chains only VERTICAL walls that reach that edge divide it; for
      // the left/right chains only HORIZONTAL walls that reach that edge. Then we
      // keep only the clear-span (room) gaps; wall-thickness gaps are skipped.
      const segStyle = {
        fontFamily: "Arial",
        fontSize: 10,
        fill: textColor,
      };
      const SEG_OFF = 38; // cm — chain sits inside the overall tier (OFF=70)
      // Per PERIMETER wall facing each side. A wall is on the top/bottom/left/
      // right boundary when its exterior points that way — read from the room's
      // outward normal (room.getWallOutDirection). This is the OUTER overlay, so
      // we take the EXTERIOR-face endpoints (mitred to the neighbouring walls) —
      // an OUTER span, which must read LARGER than the centerline. Because
      // each boundary wall is handled at its OWN position, stepped/irregular
      // edges (a set-back top or right wall) are caught correctly, and interior
      // partitions never project onto an outer wall they don't touch.
      const perimSegs = (which) => {
        const horizontal = which === "top" || which === "bottom";
        const segs = [];
        walls.forEach((w) => {
          if (!w || !w.attachedRooms || w.attachedRooms.length !== 1) return;
          const room = w.attachedRooms[0];
          let out;
          try {
            out = room.getWallOutDirection(w);
          } catch (e) {
            return;
          }
          if (!out) return;
          const ox = out.x;
          const oy = out.y;
          const faces =
            which === "top"
              ? oy < 0 && Math.abs(oy) >= Math.abs(ox)
              : which === "bottom"
              ? oy > 0 && Math.abs(oy) >= Math.abs(ox)
              : which === "left"
              ? ox < 0 && Math.abs(ox) >= Math.abs(oy)
              : ox > 0 && Math.abs(ox) >= Math.abs(oy);
          if (!faces) return;
          const edge = w.frontEdge || w.backEdge;
          const p1 = edge ? edge.exteriorStart() : w.start.location;
          const p2 = edge ? edge.exteriorEnd() : w.end.location;
          if (!p1 || !p2) return;
          const a = horizontal ? p1.x : p1.y;
          const b = horizontal ? p2.x : p2.y;
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          if (hi - lo >= 5) segs.push([lo, hi]); // skip degenerate spans
        });
        return segs;
      };
      // Draw one dimension per room clear span. `segs` = [[lo,hi], …] on the
      // chain axis. horizontal: chain runs along X at y=fixed; vertical: along Y
      // at x=fixed. outSign: which side the labels sit (−1 = above/left, +1 =
      // below/right).
      const drawChain = (segs, horizontal, fixed, planEdge, outSign) => {
        if (!segs || !segs.length) return;
        const pt = (t) => (horizontal ? px(t, fixed) : px(fixed, t));
        const TICK = 6;
        segs.forEach(([lo, hi]) => {
          const a = pt(lo);
          const b = pt(hi);
          // room-clear dimension line + end ticks
          g.lineStyle(2, lineColor, 1);
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.lineStyle(1.5, lineColor, 1);
          [a, b].forEach((p) => {
            if (horizontal) {
              g.moveTo(p.x, p.y - TICK);
              g.lineTo(p.x, p.y + TICK);
            } else {
              g.moveTo(p.x - TICK, p.y);
              g.lineTo(p.x + TICK, p.y);
            }
          });
          // faint extension lines back to the plan edge
          const ea = horizontal ? px(lo, planEdge) : px(planEdge, lo);
          const eb = horizontal ? px(hi, planEdge) : px(planEdge, hi);
          g.lineStyle(1, lineColor, 0.25);
          g.moveTo(a.x, a.y);
          g.lineTo(ea.x, ea.y);
          g.moveTo(b.x, b.y);
          g.lineTo(eb.x, eb.y);
          // room clear-span label
          const mp = pt((lo + hi) / 2);
          const tl = new Text(dimUnitWallLabel(hi - lo), segStyle);
          tl.anchor.set(0.5, 0.5);
          if (horizontal) {
            tl.position.set(mp.x, mp.y + outSign * 11);
          } else {
            tl.position.set(mp.x + outSign * 11, mp.y);
            tl.rotation = -Math.PI / 2;
          }
          this.__dimChainHolder.addChild(tl);
        });
      };
      drawChain(perimSegs("top"), true, by0 - SEG_OFF, by0, -1);
      drawChain(perimSegs("bottom"), true, by1 + SEG_OFF, by1, 1);
      drawChain(perimSegs("left"), false, bx0 - SEG_OFF, bx0, -1);
      drawChain(perimSegs("right"), false, bx1 + SEG_OFF, bx1, 1);
    } catch (e) {
      console.error("__drawDimensionChains failed", e);
    }
  }

  // "Inner" mode: show ONLY the VALUE on every wall — no dimension line, no
  // extension lines, no diamond heads. Drawing a full dimension set per wall is
  // what made this unreadable; the number alone stays clean at any density.
  //
  // The value is the wall's true INNER-face length, edge.interiorDistance()
  // (e.g. 14.02 where the centerline label reads 15.00), placed just inside the
  // inner face. It uses the SAME text style as the existing wall dimensions
  // (Arial 14 + dimtextcolor, parsed the same way) — no new style invented, the
  // shared WallDimensions2D is not modified, and the real per-wall labels are
  // untouched. Read-only + fully guarded.
  //
  // `onlyWall` limits it to a single wall (used for the selected wall when the
  // Inner button is OFF). If it isn't one of our walls, nothing is drawn.
  __drawInnerFaceLabels(onlyWall = null) {
    try {
      const walls =
        (this.__floorplan &&
          this.__floorplan.getWalls &&
          this.__floorplan.getWalls()) ||
        [];
      if (!walls.length) return;
      // Same text style + colour source/parse as WallDimensions2D's textfield.
      let textHex = "#000000";
      const src = this.__options || {};
      if (Object.prototype.hasOwnProperty.call(src, "dimtextcolor")) {
        textHex = src.dimtextcolor;
      }
      const style = {
        fontFamily: "Arial",
        fontSize: 14,
        fill: new Color(textHex).getHex(),
        align: "center",
      };
      const OFFSET = 20; // cm — sit the value just inside the wall's inner face
      walls.forEach((w) => {
        if (onlyWall && w !== onlyWall) return;
        const edge = w && (w.frontEdge || w.backEdge);
        if (!edge) return;
        let d;
        let ic;
        let ec;
        try {
          d = edge.interiorDistance();
          ic = edge.interiorCenter();
          ec = edge.exteriorCenter();
        } catch (err) {
          return; // wall with no computed faces (borders no room) — skip
        }
        if (!(typeof d === "number" && isFinite(d) && d > 0)) return;
        if (!ic || !ec) return;
        // Nudge the value off the face, into the room (exterior → interior).
        const inward = new Vector2(ic.x - ec.x, ic.y - ec.y);
        if (inward.length() < 0.001) return;
        inward.normalize().multiplyScalar(OFFSET);
        const t = new Text(dimUnitWallLabel(d), style);
        t.anchor.set(0.5, 0.5);
        t.position.set(
          Dimensioning.cmToPixel(ic.x + inward.x),
          Dimensioning.cmToPixel(ic.y + inward.y)
        );
        this.__dimChainHolder.addChild(t);
      });
    } catch (e) {
      console.error("__drawInnerFaceLabels failed", e);
    }
  }

  // Set the dimensions display mode ("off" | "inner" | "outer"). Only one is
  // ever active at a time:
  //   "outer" → draw the OUTER footprint overlay (new); wall dims stay normal.
  //   "inner" → show ALL existing wall-mounted per-wall dimensions; no overlay
  //             (we reuse what already exists rather than draw a new total).
  //   "off"   → no overlay; only the selected wall's dimension is shown.
  setDimensionsMode2D(mode) {
    this.__dimMode =
      mode === "inner" || mode === "outer" ? mode : "off";
    try {
      this.__drawDimensionChains(); // draws only in "outer" mode
      this.__applyWallDimVisibility(); // "inner" shows all, else selected-only
      this.renderer.render(this.stage);
    } catch (e) {
      console.error("setDimensionsMode2D failed", e);
    }
    return this.__dimMode;
  }

  // Visibility of the SHARED per-wall label (WallDimensions2D). It prints the
  // CENTERLINE / "full width" (e.g. 15.00) and we never change that.
  //
  // Shown for the SELECTED wall in EVERY mode — deliberately. With Inner on,
  // clicking a wall therefore gives BOTH numbers for it: the built-in 15.00
  // (full width, drawn OUTSIDE the wall) and our 14.02 (inner face, drawn just
  // INSIDE it). They sit on opposite sides of the wall, so they read as two
  // distinct values rather than overlapping.
  // A shown label is drawn at FULL brightness (no dull tone).
  __applyWallDimVisibility() {
    try {
      const sel = this.__currentSelection; // wall/corner/room model or null
      const list = this.__walls2d || [];
      for (let i = 0; i < list.length; i++) {
        const wv = list[i];
        if (!wv) continue;
        const on = wv.wall === sel;
        wv.dimensionsVisible = on;
        if (on) wv.viewDimensions = true;
      }
    } catch (e) {
      console.error("__applyWallDimVisibility failed", e);
    }
  }

  __redrawFloorplan() {
    let scope = this;
    let i = 0;

    // clear scene
    scope.__entities2D.forEach((entity) => {
      entity.removeFloorplanListener(
        EVENT_2D_SELECTED,
        this.__selectionMonitorEvent
      );
      entity.remove();
    });

    this.__drawBoundary();

    this.__corners2d = [];
    this.__walls2d = [];
    this.__rooms2d = [];
    this.__entities2D = [];

    let rooms = this.__floorplan.getRooms();

    for (i = 0; i < rooms.length; i++) {
      let modelRoom = rooms[i];
      let roomView = new RoomView2D(
        this.__floorplan,
        this.__options,
        modelRoom,
        this.__models
      );
      this.__floorplanElementsHolder.addChild(roomView);
      this.__rooms2d.push(roomView);
      this.__entities2D.push(roomView);
      roomView.interactive = this.__mode === floorplannerModes.MOVE;
      roomView.addFloorplanListener(
        EVENT_2D_SELECTED,
        this.__selectionMonitorEvent
      );
    }
    for (i = 0; i < this.__floorplan.walls.length; i++) {
      let modelWall = this.__floorplan.walls[i];
      let wallView = new WallView2D(
        this.__floorplan,
        this.__options,
        modelWall
      );
      this.__floorplanElementsHolder.addChild(wallView);
      this.__walls2d.push(wallView);
      this.__entities2D.push(wallView);
      wallView.interactive = this.__mode === floorplannerModes.MOVE;
      wallView.addFloorplanListener(
        EVENT_2D_SELECTED,
        this.__selectionMonitorEvent
      );
    }
    for (i = 0; i < this.__floorplan.corners.length; i++) {
      let modelCorner = this.__floorplan.corners[i];
      let cornerView = new CornerView2D(
        this.__floorplan,
        this.__options,
        modelCorner
      );
      this.__floorplanElementsHolder.addChild(cornerView);
      this.__corners2d.push(cornerView);
      this.__entities2D.push(cornerView);
      cornerView.interactive = this.__mode === floorplannerModes.MOVE;
      cornerView.addFloorplanListener(
        EVENT_2D_SELECTED,
        this.__selectionMonitorEvent
      );
      modelCorner.removeEventListener(EVENT_MOVED, this.__cornerMovedEvent);
      modelCorner.addEventListener(EVENT_MOVED, this.__cornerMovedEvent);
    }
    this.__drawDoors();
    this.__drawDimensionChains();
    // Reconcile label visibility after the rebuild: all (if Inner is on) or
    // only the selected wall (individual show-on-select).
    this.__applyWallDimVisibility();
    this._handleWindowResize();
  }

  // Draw a 2D symbol (door leaf + swing arc) for every in-wall item (door) on
  // the plan, so doors are visible in the 2D view like in pro tools. Reads each
  // wall's snapped items; skips any without a snap point. Wrapped so a drawing
  // error can never break the floor-plan redraw.
  __drawDoors() {
    try {
      if (!this.__doorHolder) {
        this.__doorHolder = new Graphics();
      }
      // Text labels (measurements) get their own container so they can be wiped
      // and rebuilt each redraw without touching the vector symbols.
      if (!this.__itemLabelsHolder) {
        this.__itemLabelsHolder = new Container();
      }
      if (!this.__doorHitHolder) {
        this.__doorHitHolder = new Container();
      }
      // CRITICAL: __redrawFloorplan re-adds rooms/walls/corners to this holder on
      // every redraw, which would cover the openings. Re-adding an existing child
      // moves it to the top — so the door/window symbols, labels and click
      // targets always sit ABOVE the walls (the white gap can then "cut" it).
      this.__floorplanElementsHolder.addChild(this.__doorHolder);
      this.__floorplanElementsHolder.addChild(this.__itemLabelsHolder);
      this.__floorplanElementsHolder.addChild(this.__doorHitHolder);
      const g = this.__doorHolder;
      g.clear();
      const labels = this.__itemLabelsHolder;
      labels.removeChildren();
      const hit = this.__doorHitHolder;
      hit.removeChildren();
      const scope = this;
      // Attach the drag move/end handlers to the viewport ONCE. Drag state lives
      // on the Viewer2D (not the hotspot) so it survives the per-redraw rebuild
      // of the hotspots below.
      if (!this.__openingDragAttached) {
        this.__openingDragAttached = true;
        this.__floorplanContainer.on("pointermove", (e) =>
          scope.__onOpeningDragMove(e)
        );
        this.__floorplanContainer.on("pointerup", (e) =>
          scope.__onOpeningDragEnd(e)
        );
        this.__floorplanContainer.on("pointerupoutside", (e) =>
          scope.__onOpeningDragEnd(e)
        );
        // Highlight the selected opening (from canvas OR the ITEMS list) and
        // clear it on deselect. Keeps the canvas in sync with the panel.
        if (typeof window !== "undefined") {
          window.addEventListener("pazl-opening-2d-selected", (e) => {
            const it = e && e.detail && e.detail.item;
            if (it) {
              scope.__selectedOpening = it;
              scope.__drawDoors();
            }
          });
          window.addEventListener("pazl-opening-2d-deselected", () => {
            scope.__selectedOpening = null;
            scope.__drawDoors();
          });
        }
      }
      // Clickable / draggable hotspot over an opening: drag to slide it along the
      // wall; a click (no drag) on a DOOR opens the open-direction popup.
      const registerDoorHotspot = (xPx, yPx, hitItem, isDoor) => {
        const dot = new Graphics();
        dot.beginFill(0xffffff, 0.002); // essentially invisible, still hittable
        dot.drawCircle(xPx, yPx, 16);
        dot.endFill();
        dot.interactive = true;
        dot.cursor = "pointer";
        dot.on("pointerdown", (evt) => {
          scope.__openingDrag = {
            item: hitItem,
            isDoor: !!isDoor,
            moved: false,
            start: evt.data.getLocalPosition(scope.__floorplanContainer),
          };
          try {
            scope.__floorplanContainer.plugins.pause("drag");
          } catch (e) {
            /* ignore */
          }
          if (evt && typeof evt.stopPropagation === "function")
            evt.stopPropagation();
        });
        hit.addChild(dot);
      };
      const addLabel = (text, xPx, yPx) => {
        if (!text) return;
        const t = new Text(text, {
          fontFamily: "Arial",
          fontSize: 11,
          fill: 0x000000,
          align: "center",
        });
        t.anchor.set(0.5, 0.5);
        t.position.set(xPx, yPx);
        labels.addChild(t);
      };
      const walls = (this.__floorplan && this.__floorplan.walls) || [];

      // Draw one door/window symbol on `wall`, centred at (cxCm, czCm) [floorplan
      // cm, where z = floorplan-y]. Walls render in PIXELS (cmToPixel), so we
      // convert the same way and the symbol lands exactly on the wall line.
      const drawSymbol = (cxCm, czCm, width, isWindow, wall, item) => {
        // Snap the opening centre onto the wall centerline so it sits IN the
        // wall, not offset into the room (the raw item position can be off-line).
        {
          const ax = wall.start.location.x;
          const ay = wall.start.location.y;
          const bx = wall.end.location.x;
          const by = wall.end.location.y;
          const wex = bx - ax;
          const wey = by - ay;
          const wl2 = wex * wex + wey * wey || 1;
          let wt = ((cxCm - ax) * wex + (czCm - ay) * wey) / wl2;
          wt = Math.max(0, Math.min(1, wt));
          cxCm = ax + wt * wex;
          czCm = ay + wt * wey;
        }
        const sx = Dimensioning.cmToPixel(wall.start.location.x);
        const sy = Dimensioning.cmToPixel(wall.start.location.y);
        const ex = Dimensioning.cmToPixel(wall.end.location.x);
        const ey = Dimensioning.cmToPixel(wall.end.location.y);
        let dx = ex - sx;
        let dy = ey - sy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const nx = -dy;
        const ny = dx;

        const cx = Dimensioning.cmToPixel(cxCm);
        const cy = Dimensioning.cmToPixel(czCm);
        const wpx = Dimensioning.cmToPixel(width);
        const half = wpx / 2;
        const hingeX = cx - dx * half;
        const hingeY = cy - dy * half;
        const farX = cx + dx * half;
        const farY = cy + dy * half;
        const leafX = hingeX + nx * wpx;
        const leafY = hingeY + ny * wpx;

        // Architectural opening: cut a light "gap" into the black wall along the
        // opening span, then draw the black symbol — a door leaf + swing arc, or
        // a 3-line window (two wall faces + centre glass).
        const wallThickPx = Math.max(
          Dimensioning.cmToPixel(wall.thickness || 10),
          6
        );
        const halfT = wallThickPx / 2;
        // 1) gap — erase the wall under the opening
        g.lineStyle({
          width: wallThickPx,
          color: 0xffffff, // opening gap — erase the wall under the opening
          alpha: 1.0,
          cap: "butt",
        });
        g.moveTo(hingeX, hingeY);
        g.lineTo(farX, farY);

        // Selected opening → draw its symbol in the selection colour (like a
        // selected wall), else the normal black.
        const selected = item && scope.__selectedOpening === item;
        const lineColor = selected
          ? 0x2f80ed // opening selected (blue)
          : 0x1a1a1a; // opening line (near-black symbol)
        if (selected) {
          // A soft highlight fill over the opening span so it clearly reads as
          // selected even before the symbol lines.
          g.lineStyle({
            width: wallThickPx,
            color: 0x2f80ed, // opening selected (blue)
            alpha: 0.18,
            cap: "butt",
          });
          g.moveTo(hingeX, hingeY);
          g.lineTo(farX, farY);
        }

        if (isWindow) {
          // Window: 3 parallel lines across the opening (both faces + centre),
          // capped by a jamb tick at each end.
          g.lineStyle(selected ? 2 : 1.5, lineColor, 1.0);
          [-halfT, 0, halfT].forEach((o) => {
            g.moveTo(hingeX + nx * o, hingeY + ny * o);
            g.lineTo(farX + nx * o, farY + ny * o);
          });
          g.moveTo(hingeX - nx * halfT, hingeY - ny * halfT);
          g.lineTo(hingeX + nx * halfT, hingeY + ny * halfT);
          g.moveTo(farX - nx * halfT, farY - ny * halfT);
          g.lineTo(farX + nx * halfT, farY + ny * halfT);
        } else {
          // Door: leaf + swing arc reflecting the parametric openDirection
          // (RIGHT / LEFT / BOTH_SIDES / NO_DOORS), swinging into the room.
          const dc = item && item.parametricClass;
          const sd =
            (item && item.__metadata && item.__metadata.subParametricData) || {};
          const openDir = (dc && dc.openDirection) || sd.openDirection || "RIGHT";

          // Swing side: into the room interior when we can tell (arc opposite the
          // wall's outward normal); default otherwise.
          let sign = 1;
          try {
            if (wall.attachedRooms && wall.attachedRooms.length) {
              const outv = wall.attachedRooms[0].getWallOutDirection(wall);
              if (outv) sign = nx * outv.x + ny * outv.y > 0 ? -1 : 1;
            }
          } catch (e) {
            /* no room / no normal — keep default */
          }
          // Manual swing flip (Straight ↔ Inverse) mirrors the arc to the other
          // side of the wall.
          if (
            item &&
            ((item.__metadata && item.__metadata.swingFlip) || item.__swingFlip)
          ) {
            sign = -sign;
          }

          // One leaf (hinge→tip) + its quarter-circle swing arc (tip→far jamb).
          const drawLeafArc = (hx, hy, fx, fy, radius) => {
            const lx = hx + nx * sign * radius;
            const ly = hy + ny * sign * radius;
            g.lineStyle(2, lineColor, 1.0);
            g.moveTo(hx, hy);
            g.lineTo(lx, ly);
            const a0 = Math.atan2(ly - hy, lx - hx);
            const a1 = Math.atan2(fy - hy, fx - hx);
            let delta = a1 - a0;
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta < -Math.PI) delta += 2 * Math.PI;
            const segs = 16;
            g.lineStyle(1.25, lineColor, 0.9);
            g.moveTo(lx, ly);
            for (let s = 1; s <= segs; s++) {
              const ang = a0 + delta * (s / segs);
              g.lineTo(hx + Math.cos(ang) * radius, hy + Math.sin(ang) * radius);
            }
          };

          if (openDir === "NO_DOORS") {
            // open passage — just the gap, no leaf/arc
          } else if (openDir === "BOTH_SIDES") {
            // double door: a leaf hinged at each jamb, meeting in the middle
            drawLeafArc(hingeX, hingeY, cx, cy, half);
            drawLeafArc(farX, farY, cx, cy, half);
          } else if (openDir === "LEFT") {
            drawLeafArc(farX, farY, hingeX, hingeY, wpx); // hinge at far jamb
          } else {
            drawLeafArc(hingeX, hingeY, farX, farY, wpx); // RIGHT (default)
          }
        }

        // Opening width label, offset off the wall.
        addLabel(dimUnitWallLabel(width), cx + nx * 22, cy + ny * 22);

        // Every opening gets a drag/click target; only doors open the popup.
        if (item) registerDoorHotspot(cx, cy, item, !isWindow);
      };

      const widthOf = (item) => {
        // Prefer the live parametric width so panel edits reflect immediately.
        const dc = item && item.parametricClass;
        if (dc && typeof dc.frameWidth === "number" && dc.frameWidth > 0)
          return dc.frameWidth;
        const sz = item && item.__metadata && item.__metadata.size;
        return Array.isArray(sz) && sz[0] ? Number(sz[0]) || 90 : 90;
      };
      // Door/window IDENTITY — SEMANTIC, independent of PLACEMENT.
      // IMPORTANT: itemType (MODEL_TYPES.IN_WALL_UNIT=3 / IN_WALL_FLOOR_UNIT=7) is
      // a PLACEMENT descriptor, NOT a door/window flag — an in-wall FURNITURE item
      // (e.g. a Bookshelf placed "in-wall") carries the SAME itemType as a
      // window/door. So we classify only by the parametric base type (DOOR /
      // WINDOW — the only two parametric OPENINGS; CABINET / SHELVES are not),
      // the saved metadata, or the name. Never by itemType.
      const baseTypeOf = (item) => {
        if (!item) return null;
        // Live parametric object is authoritative. Guard on isParametric: a
        // NON-parametric item defaults __baseParametricType to DOOR, which must
        // not count as an opening.
        if (
          item.isParametric &&
          item.baseParametricType &&
          item.baseParametricType.description
        ) {
          const d = item.baseParametricType.description;
          return d === "DOOR" || d === "WINDOW" ? d : null;
        }
        const md = (item && item.__metadata) || {};
        if (md.baseParametricType === "DOOR" || md.baseParametricType === "WINDOW")
          return md.baseParametricType;

        // NAME fallback — the last resort, and the loosest test by far. It must
        // never run for FLOOR-STANDING furniture: a unit called "Tall Unit Left
        // DOOR Opening Handles" is describing its style, not claiming to be an
        // architectural opening, yet /door/ matched and the plan drew it with a
        // swing arc AND snapped it onto the nearest wall (see PASS 3 below).
        // "Wardrobe with door", "Sliding door cabinet" and "Window seat" all
        // broke the same way.
        //
        // An opening is always attached to a wall, so a piece that is NOT wall
        // dependent cannot be one, whatever it is called. This is not the
        // itemType test warned about above — that one tried to IDENTIFY an
        // opening from a placement descriptor. This only RULES OUT a guess for
        // an item the app already knows is free-standing floor furniture.
        const wallDependent =
          typeof item.isWallDependent === "boolean"
            ? item.isWallDependent
            : // No live flag (metadata-only record): treat an item that is
              // currently on a wall as wall dependent, else assume floor.
              !!(item.__currentWall || md.isWallDependent);
        if (!wallDependent) return null;

        const nm = (md.itemName || md.name || item.name || "").toLowerCase();
        if (/window/.test(nm)) return "WINDOW";
        if (/door/.test(nm)) return "DOOR";
        return null;
      };
      // Only genuine openings get a 2D door/window symbol (and a wall cut). This
      // is the gate that keeps in-wall furniture from drawing as an opening.
      const isOpening = (item) => baseTypeOf(item) != null;
      // The item's centre on the plan (floorplan cm x, z). Prefer the live snap
      // point; fall back to the item's position (already fit to the wall on load).
      const centreOf = (item) => {
        const sp = item && item.__currentWallSnapPoint;
        if (sp && typeof sp.x === "number") return { x: sp.x, z: sp.z };
        const p = item && item.position;
        if (p && typeof p.x === "number") return { x: p.x, z: p.z };
        return null;
      };

      // Free-item classifier for PASS 3 (merge into nearest wall). Returns
      // "door" / "window" / null — delegates to baseTypeOf so a non-opening
      // (e.g. an in-wall bookshelf) is never auto-merged as an opening.
      const openingKindOf = (item) => {
        const b = baseTypeOf(item);
        return b ? b.toLowerCase() : null;
      };

      // Door-vs-window for a KNOWN opening. Windows must NOT draw an arc.
      const isWindowFlag = (item) => baseTypeOf(item) === "WINDOW";

      // Nearest wall to a plan point (cm) + the projected point on its centerline.
      // Wall coords use .x and .y, where .y is the plan-z axis.
      const nearestWallProjection = (px, pz) => {
        let best = null;
        walls.forEach((w) => {
          if (!w || !w.start || !w.end) return;
          const ax = w.start.location.x;
          const ay = w.start.location.y;
          const bx = w.end.location.x;
          const by = w.end.location.y;
          const dx = bx - ax;
          const dy = by - ay;
          const l2 = dx * dx + dy * dy || 1;
          let t = ((px - ax) * dx + (pz - ay) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          const qx = ax + t * dx;
          const qy = ay + t * dy;
          const d2 = (px - qx) * (px - qx) + (pz - qy) * (pz - qy);
          if (!best || d2 < best.d2) best = { wall: w, x: qx, z: qy, d2 };
        });
        return best;
      };

      // PASS 1 — items attached to a wall (__inWallItems). On live placement they
      // carry a snap point; on reload they carry a position — both handled by
      // centreOf(). Since we're iterating THIS wall's items, the host wall is
      // already known, so no nearest-wall guessing is needed.
      const drawn = new Set();
      walls.forEach((wall) => {
        const items = []
          .concat(wall.__inWallItems || [])
          .concat(wall.__onWallItems || []);
        items.forEach((door) => {
          if (!isOpening(door)) return; // in-wall FURNITURE is not an opening
          const c = centreOf(door);
          if (!c) return;
          drawn.add(door);
          drawSymbol(c.x, c.z, widthOf(door), isWindowFlag(door), wall, door);
        });
      });

      // PASS 2 — LOADED doors/windows. On reload the metadata's itemType is not
      // reliably readable, but every in-wall item carries a live __currentWall
      // reference (its actual host wall) — floor furniture does NOT. So iterate
      // the scene items, take the ones attached to a wall, and draw the symbol on
      // THAT wall at the item's position. Read-only: only draws, never mutates.
      const roomItems =
        (BlueprintInterface &&
          BlueprintInterface.blueprint3d &&
          BlueprintInterface.blueprint3d.model &&
          BlueprintInterface.blueprint3d.model.__roomItems) ||
        [];
      roomItems.forEach((item) => {
        if (!item || drawn.has(item)) return;
        const wall = item.__currentWall;
        if (!wall || !wall.start || !wall.start.location) return; // wall items only
        if (!isOpening(item)) return; // in-wall FURNITURE is not an opening
        const c = centreOf(item);
        if (!c) return;
        drawn.add(item);
        drawSymbol(c.x, c.z, widthOf(item), isWindowFlag(item), wall, item);
      });

      // PASS 3 — doors/windows dropped in the room (no wall attachment yet):
      // merge each into the NEAREST wall as an architectural opening (swing arc
      // / 3-line) so it reads correctly in the plan instead of floating free.
      roomItems.forEach((item) => {
        if (!item || drawn.has(item)) return;
        if (item.__currentWall) return; // wall items handled above
        const p = item.position;
        if (!p || typeof p.x !== "number") return;
        const kind = openingKindOf(item);
        if (!kind) return; // only doors/windows are auto-placed on a wall
        const near = nearestWallProjection(p.x, p.z);
        if (!near || !near.wall) return;
        // Clamp to a sensible opening width so a tiny footprint size still draws
        // a readable symbol.
        drawSymbol(
          near.x,
          near.z,
          Math.max(widthOf(item), 75),
          kind === "window",
          near.wall,
          item
        );
        drawn.add(item);
      });
    } catch (e) {
      console.error("Viewer2D.__drawDoors failed", e);
    }
  }

  // Drag a placed opening (door/window) along its host wall. Projects the cursor
  // onto the wall centerline and re-snaps the item there, then redraws. A small
  // threshold keeps a click (open popup) distinct from a drag (reposition).
  __onOpeningDragMove(evt) {
    if (!this.__openingDrag) return;
    const item = this.__openingDrag.item;
    const wall = item && item.__currentWall;
    if (!wall || !wall.start || !wall.end) return;
    const local = evt.data.getLocalPosition(this.__floorplanContainer);
    const px = Dimensioning.pixelToCm(local.x);
    const pz = Dimensioning.pixelToCm(local.y);
    // Ignore tiny moves so a click isn't treated as a drag.
    if (!this.__openingDrag.moved && this.__openingDrag.start) {
      const sx = Dimensioning.pixelToCm(this.__openingDrag.start.x);
      const sz = Dimensioning.pixelToCm(this.__openingDrag.start.y);
      if (Math.hypot(px - sx, pz - sz) < 4) return; // < 4 cm — still a click
    }
    const ax = wall.start.location.x;
    const ay = wall.start.location.y;
    const bx = wall.end.location.x;
    const by = wall.end.location.y;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (pz - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const edge = wall.frontEdge || wall.backEdge;
    const y =
      item.position && typeof item.position.y === "number"
        ? item.position.y
        : 0;
    try {
      item.snapToWall(new Vector3(qx, y, qy), wall, edge);
    } catch (e) {
      /* ignore */
    }
    this.__openingDrag.moved = true;
    this.__drawDoors();
  }

  __onOpeningDragEnd(evt) {
    if (!this.__openingDrag) return;
    const drag = this.__openingDrag;
    this.__openingDrag = null;
    try {
      this.__floorplanContainer.plugins.resume("drag");
    } catch (e) {
      /* ignore */
    }
    if (!drag.moved) {
      // A click (no drag) on an opening → highlight it + open its panel (the
      // "selected" listener sets the highlight and redraws).
      try {
        window.dispatchEvent(
          new CustomEvent("pazl-opening-2d-selected", {
            detail: { item: drag.item },
          })
        );
      } catch (e) {
        /* ignore */
      }
    } else if (drag.moved) {
      try {
        BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(
          "Opening moved"
        );
        BlueprintInterface?.snapshot2D?.();
      } catch (e) {
        /* ignore */
      }
    }
  }

  __drawExternalFloorplan() {
    let scope = this;
    let i = 0;
    // clear scene
    scope.__externalEntities2d.forEach((entity) => {
      entity.remove();
    });

    this.__drawBoundary();

    this.__externalCorners2d = [];
    this.__externalWalls2d = [];
    this.__externalRooms2d = [];

    let rooms = this.__floorplan.externalRooms;

    for (i = 0; i < rooms.length; i++) {
      let modelRoom = rooms[i];
      let roomView = new RoomView2D(
        this.__floorplan,
        this.__options,
        modelRoom
      );
      this.__floorplanElementsHolder.addChild(roomView);
      this.__externalRooms2d.push(roomView);
      this.__externalEntities2d.push(roomView);
    }
    for (i = 0; i < this.__floorplan.externalWalls.length; i++) {
      let modelWall = this.__floorplan.externalWalls[i];
      let wallView = new WallView2D(
        this.__floorplan,
        this.__options,
        modelWall
      );
      this.__floorplanElementsHolder.addChild(wallView);
      this.__externalWalls2d.push(wallView);
      this.__externalEntities2d.push(wallView);
    }
    for (i = 0; i < this.__floorplan.externalCorners.length; i++) {
      let modelCorner = this.__floorplan.externalCorners[i];
      let cornerView = new CornerView2D(
        this.__floorplan,
        this.__options,
        modelCorner
      );
      this.__floorplanElementsHolder.addChild(cornerView);
      this.__externalCorners2d.push(cornerView);
      this.__externalEntities2d.push(cornerView);
    }
    this._handleWindowResize();
  }

  /** */
  _handleWindowResize() {
    // Container-based sizing (so a docked sidebar reflows the 2D view); fall
    // back to the window only if the container has no size yet.
    let w = this.__canvasHolder.clientWidth;
    let h = this.__canvasHolder.clientHeight;
    if ((!w || !h) && this.__options.resize) {
      w = window.innerWidth - this.__canvasHolder.offsetLeft;
      h = window.innerHeight - this.__canvasHolder.offsetTop;
    }
    if (!w || !h) {
      return;
    }

    this.__currentWidth = w;
    this.__currentHeight = h;

    this.renderer.resize(w, h);
    this.renderer.view.style.width = w + "px";
    this.renderer.view.style.height = h + "px";
    this.renderer.view.style.display = "block";
    this.__floorplanContainer.resize(
      w,
      h,
      this.__worldWidth,
      this.__worldHeight
    );

    this.renderer.render(this.stage);
    this.__zoomed();
    this.__panned();
  }

  addFloorplanListener(type, listener) {
    this.__eventDispatcher.addEventListener(type, listener);
  }

  removeFloorplanListener(type, listener) {
    this.__eventDispatcher.removeEventListener(type, listener);
  }

  dispose() {
    this.__floorplanContainer.off("zoomed", this.__zoomedEvent);
    this.__floorplanContainer.off("moved", this.__pannedEvent);
    this.__floorplanContainer.off("clicked", this.__selectionMonitorEvent);

    // this.__floorplan.addEventListener(EVENT_UPDATED, (evt) => scope.__redrawFloorplan(evt));
    this.__floorplan.removeEventListener(
      EVENT_NEW,
      this.__redrawFloorplanEvent
    );
    this.__floorplan.removeEventListener(
      EVENT_DELETED,
      this.__redrawFloorplanEvent
    );
    this.__floorplan.removeEventListener(
      EVENT_LOADED,
      this.__redrawFloorplanEvent
    );
    window.removeEventListener("resize", this.__windowResizeEvent);
    window.removeEventListener("orientationchange", this.__windowResizeEvent);
  }

  __getBackgroundColor() {
    // Cool clean light-grey backdrop (light) / deep neutral (dark) — matches the
    // 3D canvas (Coohom-style).
    return this.getIsDarkModeValue() ? 0x191a1e : 0xf5f6f8;
  }
  setBackgroundColor(color) {
    this.renderer.backgroundColor = color;
  }

  getIsDarkModeValue() {
    const isDarkMode = localStorage.getItem("isDarkMode");
    return isDarkMode && JSON.parse(isDarkMode);
  }
}
