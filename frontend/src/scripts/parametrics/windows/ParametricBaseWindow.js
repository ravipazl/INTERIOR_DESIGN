import {
  BoxBufferGeometry,
  MeshStandardMaterial,
  EventDispatcher,
  Color,
  DoubleSide,
  TextureLoader,
  RepeatWrapping,
} from "three";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EVENT_PARAMETRIC_GEOMETRY_UPATED } from "../../core/events";

/**
 * Parametric window built to look like a real window (Coohom-style): a solid
 * FRAME (top/bottom/left/right bars + a centre mullion) around a semi-transparent
 * GLASS pane. It is a single merged geometry with two material GROUPS
 * (0 = frame, 1 = glass) and an ARRAY material [frameMaterial, glassMaterial],
 * so Physical3DItem renders it through the existing generic parametric path
 * (`new Mesh(geometry, material)`) with no special-casing.
 *
 * The overall bounding box stays exactly frameWidth × frameHeight ×
 * frameThickness, so the existing size self-correction / placement keeps working.
 */
export class ParametricBaseWindow extends EventDispatcher {
  constructor(parameters = {}) {
    super();
    this.__name = "Window";
    this.__windowType = 1;
    this.__frameWidth = parameters.frameWidth || 120;
    this.__frameHeight = parameters.frameHeight || 120;
    this.__frameThickness = parameters.frameThickness || 8;

    // Normalise a saved colour (string or Color) to a lowercase "#rrggbb" hex
    // so we can migrate OLD default colours to the Coohom look.
    const __hex = (c) => {
      if (!c) return "";
      if (typeof c === "string") return c.toLowerCase();
      if (c.getHexString) return `#${c.getHexString().toLowerCase()}`;
      return "";
    };
    // Old blue-ish glass (#bcd4e6) → Coohom clear glass (#dce6ec). Custom
    // colours are left as-is.
    const __glassColor =
      __hex(parameters.glassColor) === "#bcd4e6"
        ? "#dce6ec"
        : parameters.glassColor || "#dce6ec";
    // BLACK window frame. Old default frames (#d9d9d9 / #9a9a9a / #3a3a3a) →
    // black (#1a1a1a). Custom frame colours are left as-is.
    const __fsrc = __hex(parameters.frameColor);
    const __frameColor =
      __fsrc === "" ||
      __fsrc === "#d9d9d9" ||
      __fsrc === "#9a9a9a" ||
      __fsrc === "#3a3a3a"
        ? "#1a1a1a"
        : parameters.frameColor;

    // Two materials: a solid frame and a see-through glass.
    this.__frameMaterial = new MeshStandardMaterial({
      color: new Color(__frameColor),
      roughness: 0.6,
      metalness: 0.1,
      side: DoubleSide,
    });
    // The frame DEFAULTS to black (via __frameColor above), but stays fully
    // changeable from the Window Properties panel — no forced override here, so
    // picking a frame finish/colour applies normally.
    this.__glassMaterial = new MeshStandardMaterial({
      color: new Color(__glassColor),
      transparent: true,
      opacity: 0.15, // clearer, see-through glass (Coohom-style)
      roughness: 0.05,
      metalness: 0.0,
      side: DoubleSide,
    });
    // Material ARRAY: index matches the geometry groups built in __proceedure().
    this.__material = [this.__frameMaterial, this.__glassMaterial];
    this.__geometry = this.__proceedure();

    // Remember any chosen finish textures so they can be SAVED (via metadata)
    // and re-applied on reload — otherwise a picked finish is lost on refresh.
    this.__surfaceMaps = {};
    if (parameters.frameMap) this.setSurfaceMap("frame", parameters.frameMap);
    if (parameters.glassMap) this.setSurfaceMap("glass", parameters.glassMap);
  }

  __proceedure() {
    const W = this.__frameWidth;
    const H = this.__frameHeight;
    const T = this.__frameThickness;
    // Frame bar width: proportional but clamped so small/large windows both look right.
    const b = Math.max(4, Math.min(W, H) * 0.08);
    // Glass sits slightly recessed (thinner than the frame) so the frame reads.
    const glassT = Math.max(1, T * 0.35);

    // --- Frame pieces (all share the frame material) ---
    const pieces = [];
    const bar = (w, h, d, x, y, z) => {
      const g = new BoxBufferGeometry(w, h, d);
      g.translate(x, y, z);
      pieces.push(g);
    };
    // top / bottom (full width)
    bar(W, b, T, 0, H / 2 - b / 2, 0);
    bar(W, b, T, 0, -(H / 2 - b / 2), 0);
    // left / right (between the top & bottom bars)
    const innerH = Math.max(0.001, H - 2 * b);
    bar(b, innerH, T, -(W / 2 - b / 2), 0, 0);
    bar(b, innerH, T, W / 2 - b / 2, 0, 0);
    // centre mullion (the vertical divider that gives the 2-pane look)
    bar(b * 0.7, innerH, T * 0.85, 0, 0, 0);

    // Merge all frame pieces into ONE geometry (no groups yet).
    const frameGeo = BufferGeometryUtils.mergeBufferGeometries(pieces, false);
    pieces.forEach((p) => p.dispose());

    // --- Glass pane (its own material) ---
    const glassGeo = new BoxBufferGeometry(
      Math.max(0.001, W - 2 * b),
      Math.max(0.001, H - 2 * b),
      glassT
    );

    // Merge frame + glass WITH groups → group 0 = frame, group 1 = glass.
    const merged = BufferGeometryUtils.mergeBufferGeometries(
      [frameGeo, glassGeo],
      true
    );
    frameGeo.dispose();
    glassGeo.dispose();

    merged.computeBoundingBox();
    return merged;
  }

  __updateGeometry() {
    const updated = this.__proceedure();
    if (this.__geometry) this.__geometry.dispose();
    this.__geometry = updated;
    this.dispatchEvent({ type: EVENT_PARAMETRIC_GEOMETRY_UPATED, target: this });
  }

  get geometry() {
    return this.__geometry;
  }
  get material() {
    return this.__material;
  }

  get frameWidth() {
    return this.__frameWidth;
  }
  set frameWidth(v) {
    this.__frameWidth = v || 120;
    this.__updateGeometry();
  }
  get frameHeight() {
    return this.__frameHeight;
  }
  set frameHeight(v) {
    this.__frameHeight = v || 120;
    this.__updateGeometry();
  }
  get frameThickness() {
    return this.__frameThickness;
  }
  set frameThickness(v) {
    this.__frameThickness = v || 8;
    this.__updateGeometry();
  }
  /**
   * Paint a laminate/texture onto a window surface. Mirrors the door's
   * setSurfaceMap so the shared Door Properties panel (which calls
   * setSurfaceMap(channel, url)) works for windows too.
   *   channel "frame" -> frame bars, channel "glass" -> glass pane.
   */
  setSurfaceMap(channel, url) {
    if (!url) return;
    let material = null;
    switch (channel) {
      case "frame":
        material = this.__frameMaterial;
        break;
      case "glass":
        material = this.__glassMaterial;
        break;
      default:
        return;
    }
    if (!material) return;
    // Remember the chosen finish URL so it persists (see metadata getter).
    this.__surfaceMaps = this.__surfaceMaps || {};
    this.__surfaceMaps[channel] = url;
    new TextureLoader().load(url, (texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      material.map = texture;
      // A finish was chosen from the panel → show its true colours by using a
      // white base under the texture (matches the door panel behaviour).
      material.color = new Color("#ffffff");
      material.needsUpdate = true;
      // Nudge the viewer to re-render (handler sets parent.needsUpdate).
      this.dispatchEvent({
        type: EVENT_PARAMETRIC_GEOMETRY_UPATED,
        target: this,
      });
    });
  }

  get frameColor() {
    return `#${this.__frameMaterial.color.getHexString()}`;
  }
  set frameColor(c) {
    this.__frameMaterial.color = new Color(c);
    this.__frameMaterial.needsUpdate = true;
  }
  get glassColor() {
    return `#${this.__glassMaterial.color.getHexString()}`;
  }
  set glassColor(c) {
    this.__glassMaterial.color = new Color(c);
    this.__glassMaterial.needsUpdate = true;
  }

  get parameters() {
    return {
      frameColor: { type: "color" },
      glassColor: { type: "color" },
      frameWidth: { type: "number" },
      frameHeight: { type: "number" },
      frameThickness: { type: "number" },
    };
  }

  get metadata() {
    return {
      type: this.__windowType,
      frameColor: this.frameColor,
      glassColor: this.glassColor,
      frameWidth: this.__frameWidth,
      frameHeight: this.__frameHeight,
      frameThickness: this.__frameThickness,
      // Persist chosen finish textures so they survive reload.
      frameMap: (this.__surfaceMaps && this.__surfaceMaps.frame) || null,
      glassMap: (this.__surfaceMaps && this.__surfaceMaps.glass) || null,
    };
  }

  get name() {
    return this.__name;
  }
  set name(v) {
    this.__name = v;
  }
}
