import { Sprite, Texture, Graphics, Container, BLEND_MODES, filters } from "pixi.js";
import { Dimensioning } from "../core/dimensioning.js";
import { EVENT_LOADED } from "../core/events";
import BlueprintInterface from "@pazl/blueprint-interface";
import { resolveFileUrl } from "../../react-app/services/ProjectWorkspaceService";

/**
 * THE PLAN BACKGROUND (the floor plan's "carbon sheet").
 *
 * An imported plan laid in the 2D view to trace over or check against: either
 * an IMAGE (a scan, photo, sketch, or a PDF page rendered to one) or a CAD
 * drawing's own LINES (DXF / DWG / DWFx), kept as vectors so they stay sharp
 * at any zoom and their layers can be shown or hidden.
 *
 * It lives in the floor plan itself, `floorplan.carbonSheet` — the slot the
 * saved plan has always had. So it is saved with the project, comes back in
 * undo/redo snapshots, and goes away when a plan without one is loaded. Every
 * value is in centimetres, whatever the display unit:
 *
 *   { kind: "image" | "vector", url, x, y (centre), width, height,
 *     rotation (degrees), transparency (0 = solid … 1 = invisible),
 *     locked, hidden, layersHidden: [layer names] (vector only) }
 *
 * An image's url is the uploaded picture. A vector's is an uploaded JSON of
 * its lines, centred on the sheet's centre, at its natural size w × h (cm):
 *
 *   { v: 1, w, h, layers: [{ name, role: "wall"|"door"|"window"|"other",
 *                            lines: [x1, y1, x2, y2, …] }] }
 *
 * It is drawn just above the plan's own layer so a closed room's fill never
 * hides it, and it never takes the pointer, so selecting and drawing work
 * exactly as without it. An image is blended so it does not cover the plan:
 * on a light canvas it multiplies (white paper drops out, only the drawing's
 * lines show); on a dark one each pixel becomes the theme's accent colour, as
 * opaque as it is dark. Lines are drawn one pixel wide in the theme's colours.
 *
 * Two tools take the mouse through the viewer's TOOL mode, the same way the
 * drawing tools do: "scale" (click two points, then applyScale with the real
 * length) and "move" (drag the background).
 */

const NAME = "pazl-plan-image";
// Only if the theme's tokens can't be read (they are defined in styles.css).
const FALLBACK = { accent: 0x5b3df5, text: 0x172033, muted: 0x7a8191 };
// How much of the visible view a newly added image spans, before it is scaled.
const FIRST_FIT = 0.8;
// How much of the view the background fills when the view is fitted to it.
const VIEW_FIT = 0.9;
const HISTORY_TITLE = "Plan image updated";

// A theme colour token (styles.css) as a number.
const themeColor = (token, fallback) => {
  const hex =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      : "";
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  return m ? parseInt(m[1], 16) : fallback;
};
const accentColor = () => themeColor("--pz-accent", FALLBACK.accent);

// The accent, 0–1 per channel.
const accentRgb = () => {
  const n = accentColor();
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const isLight = (color) => {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 127;
};

export class PlanImage2D {
  constructor(viewer) {
    this.viewer = viewer;
    this.sprite = null; // the drawn background: a Sprite (image) or Container (lines)
    this.vector = null; // a vector background's lines, once loaded
    this.vectorError = null;
    this.tool = null; // "scale" | "move" | null
    this.points = []; // scale tool: clicked points, cm
    this.cursor = null; // scale tool: mouse, cm
    this.__drag = null; // move tool: { from, x, y } while the button is down
    this.__url = null;
    this.__kind = null;
    this.__light = null;
    this.__listeners = new Set();

    const c = viewer.__floorplanContainer;
    this.overlay = new Graphics();
    this.overlay.name = `${NAME}-scale`;
    this.overlay.interactive = false;
    c.addChild(this.overlay);

    this.__onDown = this.__onDown.bind(this);
    this.__onMove = this.__onMove.bind(this);
    this.__onUp = this.__onUp.bind(this);
    this.__onKey = this.__onKey.bind(this);
    this.__onLoaded = () => {
      this.cancelTool();
      this.sync();
    };
    this.__onZoom = () => this.__drawScale();
    c.on("mousedown", this.__onDown);
    c.on("touchstart", this.__onDown);
    c.on("mousemove", this.__onMove);
    c.on("touchmove", this.__onMove);
    c.on("mouseup", this.__onUp);
    c.on("mouseupoutside", this.__onUp);
    c.on("touchend", this.__onUp);
    c.on("zoomed", this.__onZoom);
    viewer.__floorplan.addEventListener(EVENT_LOADED, this.__onLoaded);
    this.sync();
  }

  // ── state ───────────────────────────────────────────────────────────────

  get fp() {
    return this.viewer.__floorplan;
  }

  /** The background settings, or null when the plan has none. */
  get sheet() {
    const s = this.fp && this.fp.carbonSheet;
    return s && s.url ? s : null;
  }

  /** A vector background's layers, for the panel: [{ name, role, lines, hidden }]. */
  get layers() {
    const s = this.sheet;
    if (!s || s.kind !== "vector" || !this.vector) return [];
    const off = new Set(s.layersHidden || []);
    return this.vector.layers.map((l) => ({
      name: l.name,
      role: l.role,
      lines: Math.floor(l.lines.length / 4),
      hidden: off.has(l.name),
    }));
  }

  /** The scale tool's measured distance between its two points, cm. */
  get measuredCm() {
    if (this.points.length < 2) return null;
    const [a, b] = this.points;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** Called with no arguments whenever anything shown in the panel changes. */
  subscribe(fn) {
    this.__listeners.add(fn);
    return () => this.__listeners.delete(fn);
  }

  __emit() {
    this.__listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error("PlanImage2D listener failed", e);
      }
    });
  }

  /**
   * Put a newly uploaded image of unknown scale on the plan: centred in the
   * view and spanning most of it, so it can be seen whole before it is scaled.
   */
  add(url, pixelWidth, pixelHeight) {
    const c = this.viewer.__floorplanContainer;
    const centre = c.center;
    const viewW = Dimensioning.pixelToCm(c.worldScreenWidth);
    const viewH = Dimensioning.pixelToCm(c.worldScreenHeight);
    const aspect = pixelHeight / pixelWidth;
    let width = viewW * FIRST_FIT;
    if (width * aspect > viewH * FIRST_FIT) width = (viewH * FIRST_FIT) / aspect;
    this.place({
      kind: "image",
      url,
      x: Dimensioning.pixelToCm(centre.x),
      y: Dimensioning.pixelToCm(centre.y),
      width,
      height: width * aspect,
      locked: false,
    });
  }

  /** The point in the middle of the view, cm. */
  get viewCentre() {
    const centre = this.viewer.__floorplanContainer.center;
    return { x: Dimensioning.pixelToCm(centre.x), y: Dimensioning.pixelToCm(centre.y) };
  }

  /**
   * Put a background on the plan with every setting given (an import that
   * knows its size and place). Saved unless `save` is false — when it arrives
   * with a plan loaded alongside it, which is saved as one.
   */
  place(sheet, save = true) {
    this.cancelTool();
    this.fp.carbonSheet = {
      rotation: 0,
      transparency: 0.5,
      locked: true,
      hidden: false,
      anchorX: 0.5,
      anchorY: 0.5,
      ...sheet,
    };
    this.sync();
    if (save) this.commit();
  }

  /** Change some settings. Saved only when `save` is true (end of a change). */
  set(patch, save = true) {
    const s = this.sheet;
    if (!s) return;
    this.fp.carbonSheet = { ...s, ...patch };
    this.sync();
    if (save) this.commit();
  }

  /** Show or hide one layer of a vector background. */
  setLayerHidden(name, hidden) {
    const s = this.sheet;
    if (!s) return;
    const off = new Set(s.layersHidden || []);
    if (hidden) off.add(name);
    else off.delete(name);
    this.set({ layersHidden: [...off] });
  }

  remove() {
    if (!this.sheet) return;
    this.cancelTool();
    this.fp.carbonSheet = null;
    this.sync();
    this.commit();
  }

  /** The largest image side the 2D view can draw, in pixels. */
  get maxTextureSize() {
    const gl = this.viewer.renderer && this.viewer.renderer.gl;
    return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null;
  }

  /** Save to the project and record an undo step. */
  commit() {
    try {
      BlueprintInterface?.snapshot2D?.();
      BlueprintInterface?.ProjectManagerService?.updateFloorPlan?.(HISTORY_TITLE);
    } catch (e) {
      console.error("PlanImage2D: save failed", e);
    }
    this.__emit();
  }

  /** Zoom and pan the 2D view so the whole background is in sight. */
  fitView() {
    const s = this.sheet;
    if (!s) return;
    const c = this.viewer.__floorplanContainer;
    const r = ((s.rotation || 0) * Math.PI) / 180;
    const w = Math.abs(s.width * Math.cos(r)) + Math.abs(s.height * Math.sin(r));
    const h = Math.abs(s.width * Math.sin(r)) + Math.abs(s.height * Math.cos(r));
    const wPx = Dimensioning.cmToPixel(w);
    const hPx = Dimensioning.cmToPixel(h);
    if (!(wPx > 0 && hPx > 0)) return;
    c.setZoom(Math.min(c.screenWidth / wPx, c.screenHeight / hPx) * VIEW_FIT, true);
    c.moveCenter(Dimensioning.cmToPixel(s.x), Dimensioning.cmToPixel(s.y));
    if (typeof this.viewer.__zoomed === "function") this.viewer.__zoomed();
    if (typeof this.viewer.__panned === "function") this.viewer.__panned();
  }

  // ── drawing ─────────────────────────────────────────────────────────────

  /** Make the 2D view match the floor plan's background settings. */
  sync() {
    const s = this.sheet;
    if (!s) {
      this.__dropSprite();
      this.__emit();
      return;
    }
    const kind = s.kind === "vector" ? "vector" : "image";
    if (!this.sprite || this.__url !== s.url || this.__kind !== kind) {
      this.__dropSprite();
      const shown = kind === "vector" ? this.__makeVector(s.url) : this.__makeImage(s.url);
      shown.name = NAME;
      shown.interactive = false;
      shown.interactiveChildren = false;
      // Laid out on every frame: the image's size is only known once it has
      // loaded, and the centimetre-to-pixel scale can change while shown.
      const base = shown.updateTransform.bind(shown);
      shown.updateTransform = () => {
        this.__layout();
        base();
      };
      this.sprite = shown;
      this.__url = s.url;
      this.__kind = kind;
      this.__light = null;
      this.__insert();
    }
    this.__layout();
    this.__emit();
  }

  __makeImage(url) {
    // Saved as the upload's own path; the file is served by the backend.
    const sprite = new Sprite(Texture.from(resolveFileUrl(url)));
    sprite.anchor.set(0.5, 0.5);
    return sprite;
  }

  __makeVector(url) {
    const box = new Container();
    this.vector = null;
    this.vectorError = null;
    fetch(resolveFileUrl(url))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (this.__url !== url || this.sprite !== box) return;
        if (!data || !Array.isArray(data.layers) || !(data.w > 0) || !(data.h > 0)) {
          throw new Error("not a plan background");
        }
        this.vector = data;
        this.__light = null;
        this.__layout();
        this.__emit();
      })
      .catch((e) => {
        if (this.__url !== url) return;
        console.error("PlanImage2D: the drawing's lines couldn't be loaded", e);
        this.vectorError = "The drawing's lines couldn't be loaded. Import the file again.";
        this.__emit();
      });
    return box;
  }

  /** A vector background's lines, one Graphics per layer, in the theme's colours. */
  __drawVector(light) {
    const box = this.sprite;
    box.removeChildren().forEach((g) => g.destroy());
    const colours = {
      wall: themeColor("--pz-text", FALLBACK.text),
      door: accentColor(),
      window: accentColor(),
      other: themeColor("--pz-panel-muted", FALLBACK.muted),
    };
    // The text colour of a theme that does not match the canvas (a light page
    // over a dark 2D view) would vanish into it: the canvas's own opposite.
    if (isLight(colours.wall) === light) {
      colours.wall = 0xffffff ^ this.viewer.renderer.backgroundColor;
    }
    this.vector.layers.forEach((layer) => {
      const g = new Graphics();
      g.name = layer.name;
      g.interactive = false;
      g.lineStyle({
        width: 1,
        color: colours[layer.role] ?? colours.other,
        alpha: layer.role === "other" ? 0.7 : 1,
        native: true,
      });
      const a = layer.lines;
      for (let i = 0; i + 3 < a.length; i += 4) {
        g.moveTo(a[i], a[i + 1]);
        g.lineTo(a[i + 2], a[i + 3]);
      }
      box.addChild(g);
    });
  }

  __insert() {
    const c = this.viewer.__floorplanContainer;
    const holder = this.viewer.__floorplanElementsHolder;
    const at =
      holder && holder.parent === c ? c.getChildIndex(holder) + 1 : c.children.length;
    c.addChildAt(this.sprite, at);
  }

  __dropSprite() {
    if (!this.sprite) return;
    try {
      if (this.sprite.parent) this.sprite.parent.removeChild(this.sprite);
      this.sprite.destroy({ children: true });
    } catch (e) {
      /* already gone with the view */
    }
    this.sprite = null;
    this.vector = null;
    this.vectorError = null;
    this.__url = null;
    this.__kind = null;
  }

  __layout() {
    const s = this.sheet;
    const shown = this.sprite;
    if (!s || !shown) return;
    shown.position.set(Dimensioning.cmToPixel(s.x), Dimensioning.cmToPixel(s.y));
    shown.rotation = ((s.rotation || 0) * Math.PI) / 180;
    shown.visible = !s.hidden;
    const opacity = 1 - Math.min(1, Math.max(0, s.transparency ?? 0.5));
    const light = isLight(this.viewer.renderer.backgroundColor);
    if (this.__kind === "vector") this.__layoutVector(s, light, opacity);
    else this.__layoutImage(s, light, opacity);
  }

  __layoutVector(s, light, opacity) {
    const box = this.sprite;
    const v = this.vector;
    if (!v) return;
    if (light !== this.__light) {
      this.__light = light;
      this.__drawVector(light);
    }
    // Drawn in centimetres; the sheet's size over the drawing's own is the
    // scale it has been given since (1 unless it was scaled again).
    const px = Dimensioning.cmToPixel(1);
    box.scale.set((px * s.width) / v.w, (px * s.height) / v.h);
    box.alpha = opacity;
    const off = new Set(s.layersHidden || []);
    box.children.forEach((g) => {
      g.visible = !off.has(g.name);
    });
  }

  __layoutImage(s, light, opacity) {
    const sprite = this.sprite;
    const tex = sprite.texture;
    if (tex && tex.orig && tex.orig.width > 1) {
      sprite.scale.set(
        Dimensioning.cmToPixel(s.width) / tex.orig.width,
        Dimensioning.cmToPixel(s.height) / tex.orig.height
      );
    }
    if (light !== this.__light) {
      this.__light = light;
      if (light) {
        sprite.filters = null;
        sprite.blendMode = BLEND_MODES.MULTIPLY;
      } else {
        sprite.blendMode = BLEND_MODES.NORMAL;
        sprite.filters = [new filters.ColorMatrixFilter()];
      }
      this.__opacity = null;
    }
    if (opacity === this.__opacity) return;
    this.__opacity = opacity;
    if (light) {
      sprite.alpha = opacity;
    } else {
      // On a dark canvas the paper must vanish and the lines stay readable
      // on the canvas and on a room's fill alike: each pixel becomes the
      // theme's accent colour, as opaque as it is dark.
      sprite.alpha = 1;
      const [r, g, b] = accentRgb();
      const k = opacity;
      sprite.filters[0].matrix = [
        0, 0, 0, 0, r,
        0, 0, 0, 0, g,
        0, 0, 0, 0, b,
        -k * 0.299, -k * 0.587, -k * 0.114, k, 0,
      ];
    }
  }

  // ── tools ───────────────────────────────────────────────────────────────

  /** Pick two points on the background; applyScale then sets the real length. */
  startScale() {
    if (!this.sheet) return;
    this.__takeMouse("scale");
  }

  /** Drag the background to a new place. */
  startMove() {
    if (!this.sheet) return;
    this.__takeMouse("move");
  }

  /**
   * Resize the background so the two picked points are `realCm` apart. The
   * first point stays where it is, so the part of the plan already lined up
   * there does not jump. Locks it afterwards, ready for tracing.
   */
  applyScale(realCm) {
    const s = this.sheet;
    const measured = this.measuredCm;
    const real = Number(realCm);
    if (!s || !measured || !(real > 0)) return false;
    const f = real / measured;
    const a = this.points[0];
    const patch = {
      x: a.x + (s.x - a.x) * f,
      y: a.y + (s.y - a.y) * f,
      width: s.width * f,
      height: s.height * f,
      locked: true,
    };
    this.cancelTool();
    this.set(patch);
    return true;
  }

  /**
   * Leave the scale or move tool without changing anything further, and give
   * the mouse back to Select (unless `release` is false: something else has
   * already taken it).
   */
  cancelTool(release = true) {
    if (!this.tool) return;
    this.tool = null;
    this.points = [];
    this.cursor = null;
    this.__drag = null;
    window.removeEventListener("keydown", this.__onKey);
    this.__drawScale();
    if (release && typeof this.viewer.__exitToolMode === "function") {
      this.viewer.__exitToolMode();
    }
    this.__emit();
  }

  __takeMouse(tool) {
    if (this.tool) this.cancelTool(false);
    if (typeof this.viewer.__enterToolMode === "function") this.viewer.__enterToolMode();
    this.__toolMode = this.viewer.__mode;
    this.tool = tool;
    this.points = [];
    this.cursor = null;
    this.__drag = null;
    window.addEventListener("keydown", this.__onKey);
    this.__drawScale();
    this.__emit();
  }

  // The viewer leaves TOOL mode on Esc, Select or Line, and a drawing tool
  // takes it over when chosen; either way this tool has ended — without
  // switching the viewer's mode again, which would end the other tool too.
  __stillMine() {
    if (!this.tool) return false;
    const v = this.viewer;
    if (v.__mode !== this.__toolMode || (v.__drawTools && v.__drawTools.tool)) {
      this.cancelTool(false);
      return false;
    }
    return true;
  }

  __cm(evt) {
    const co = evt.data.getLocalPosition(this.viewer.__floorplanContainer);
    return { x: Dimensioning.pixelToCm(co.x), y: Dimensioning.pixelToCm(co.y) };
  }

  __onDown(evt) {
    if (!this.__stillMine() || this.tool !== "move") return;
    const s = this.sheet;
    if (!s) return;
    this.__drag = { from: this.__cm(evt), x: s.x, y: s.y };
  }

  __onMove(evt) {
    if (!this.__stillMine()) return;
    const p = this.__cm(evt);
    if (this.tool === "move" && this.__drag) {
      const d = this.__drag;
      this.set({ x: d.x + p.x - d.from.x, y: d.y + p.y - d.from.y }, false);
    } else if (this.tool === "scale" && this.points.length < 2) {
      this.cursor = p;
      this.__drawScale();
    }
  }

  __onUp(evt) {
    if (!this.__stillMine()) return;
    if (evt && evt.data && evt.data.button === 2) return;
    if (this.tool === "move") {
      if (this.__drag) {
        this.__drag = null;
        this.commit();
      }
      return;
    }
    if (this.tool === "scale" && this.points.length < 2) {
      this.points.push(this.__cm(evt));
      this.cursor = null;
      this.__drawScale();
      this.__emit();
    }
  }

  __onKey(e) {
    if (e.key === "Escape") this.cancelTool();
  }

  /** The scale tool's line and end points, a constant size on screen. */
  __drawScale() {
    const g = this.overlay;
    g.clear();
    if (this.tool !== "scale") return;
    const pts = this.points.slice();
    if (pts.length === 1 && this.cursor) pts.push(this.cursor);
    if (!pts.length) return;
    const zoom = this.viewer.__floorplanContainer.scale.x || 1;
    const px = (p) => ({ x: Dimensioning.cmToPixel(p.x), y: Dimensioning.cmToPixel(p.y) });
    const q = pts.map(px);
    const color = accentColor();
    if (q.length === 2) {
      g.lineStyle({ width: 2 / zoom, color, alpha: 1 });
      g.moveTo(q[0].x, q[0].y);
      g.lineTo(q[1].x, q[1].y);
    }
    g.lineStyle(0);
    this.points.forEach((p) => {
      const o = px(p);
      g.beginFill(color, 1);
      g.drawCircle(o.x, o.y, 5 / zoom);
      g.endFill();
    });
  }

  destroy() {
    this.cancelTool();
    const c = this.viewer.__floorplanContainer;
    c.off("mousedown", this.__onDown);
    c.off("touchstart", this.__onDown);
    c.off("mousemove", this.__onMove);
    c.off("touchmove", this.__onMove);
    c.off("mouseup", this.__onUp);
    c.off("mouseupoutside", this.__onUp);
    c.off("touchend", this.__onUp);
    c.off("zoomed", this.__onZoom);
    this.fp.removeEventListener(EVENT_LOADED, this.__onLoaded);
    this.__dropSprite();
    this.overlay.destroy();
    this.__listeners.clear();
  }
}
