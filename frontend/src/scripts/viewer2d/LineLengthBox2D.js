// The length box of the Line (Draw) tool — Coohom-style.
//
// While a wall is being drawn, a small box sits on the middle of the green
// line showing its length in the current unit, pre-selected. Start typing and
// the number is replaced; the preview wall follows the typed length in the
// direction of the mouse; Enter fixes the wall there. A mouse click still ends
// the wall as before (at the typed length when one has been typed, so what you
// see is what you get).
//
// Keys are read from the window (the canvas has no text field to focus) and
// only while a Line is being drawn, only digits . ' " space Backspace Enter,
// and never while the user is typing in any other input — so Ctrl+Z, Esc,
// Delete and every other shortcut keep working exactly as before.

import { Point } from "pixi.js";
import { Dimensioning } from "../core/dimensioning";
import { Configuration, configDimUnit } from "../core/configuration";
import {
  dimInch,
  dimFeetAndInch,
  dimMeter,
  dimCentiMeter,
  dimMilliMeter,
} from "../core/constants";

const INCH_CM = 2.54;

export class LineLengthBox2D {
  /**
   * @param viewer   the Viewer2D
   * @param hooks    { isDrawing(): bool, commit(endCm: Vector2): void, redraw(): void }
   */
  constructor(viewer, hooks) {
    this.viewer = viewer;
    this.hooks = hooks;
    this.text = "";
    this.dirty = false; // true once the user has typed
    this.from = null; // cm
    this.cursor = null; // cm
    this.el = null;
    this.__onKey = this.__onKey.bind(this);
    window.addEventListener("keydown", this.__onKey, true);
  }

  // ── units ─────────────────────────────────────────────────────────────────

  get unit() {
    return Configuration.getStringValue(configDimUnit);
  }

  unitLabel() {
    switch (this.unit) {
      case dimFeetAndInch:
        return "ft";
      case dimInch:
        return "in";
      case dimMilliMeter:
        return "mm";
      case dimCentiMeter:
        return "cm";
      case dimMeter:
      default:
        return "m";
    }
  }

  format(cm) {
    switch (this.unit) {
      case dimFeetAndInch: {
        const totalIn = Math.round(cm / INCH_CM);
        const ft = Math.floor(totalIn / 12);
        const inch = totalIn - ft * 12;
        return `${ft}' ${inch}"`;
      }
      case dimInch:
        return String(Math.round(cm / INCH_CM));
      case dimMilliMeter:
        return String(Math.round(cm * 10));
      case dimCentiMeter:
        return String(Math.round(cm * 10) / 10);
      case dimMeter:
      default:
        return (cm / 100).toFixed(2);
    }
  }

  // Typed text → cm, or null. Feet accept 12 · 12.5 · 10'6 · 10' 6" · 10 6 · 6".
  parse(text) {
    const s = String(text || "").trim().toLowerCase();
    if (!s) return null;
    let cm = null;
    if (this.unit === dimFeetAndInch) {
      const inchOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)$/);
      if (inchOnly) {
        cm = parseFloat(inchOnly[1]) * INCH_CM;
      } else {
        const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
        if (m) cm = (parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * INCH_CM;
      }
    } else {
      const m = s.match(/^(\d+(?:\.\d+)?)$/);
      if (m) {
        const n = parseFloat(m[1]);
        switch (this.unit) {
          case dimInch:
            cm = n * INCH_CM;
            break;
          case dimMilliMeter:
            cm = n / 10;
            break;
          case dimCentiMeter:
            cm = n;
            break;
          case dimMeter:
          default:
            cm = n * 100;
        }
      }
    }
    return Number.isFinite(cm) && cm > 0 ? cm : null;
  }

  // ── geometry ──────────────────────────────────────────────────────────────

  // Where the wall ends: the mouse, or — once a length is typed — that length
  // along the mouse's direction.
  effectiveEnd(from, cursor) {
    if (!from || !cursor) return cursor;
    if (this.dirty) {
      const cm = this.parse(this.text);
      const d = cursor.clone().sub(from);
      if (cm && d.lengthSq() > 1e-6) {
        return from.clone().add(d.normalize().multiplyScalar(cm));
      }
    }
    return cursor;
  }

  // ── DOM box ───────────────────────────────────────────────────────────────

  __ensureEl() {
    if (this.el || typeof document === "undefined") return this.el;
    const el = document.createElement("div");
    el.setAttribute("aria-live", "polite");
    Object.assign(el.style, {
      position: "fixed",
      zIndex: 900,
      transform: "translate(-50%, -50%)",
      display: "none",
      alignItems: "center",
      gap: "6px",
      background: "#fff",
      border: "1.5px solid #1e88e5",
      borderRadius: "3px",
      padding: "2px 6px",
      font: "13px Arial, sans-serif",
      color: "#111",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
    });
    const val = document.createElement("span");
    const caret = document.createElement("span");
    Object.assign(caret.style, {
      display: "inline-block",
      width: "1px",
      height: "14px",
      background: "#111",
      marginLeft: "1px",
      verticalAlign: "middle",
    });
    const unit = document.createElement("span");
    unit.style.color = "#888";
    unit.style.fontSize = "12px";
    el.appendChild(val);
    el.appendChild(caret);
    el.appendChild(unit);
    document.body.appendChild(el);
    this.el = el;
    this.__val = val;
    this.__caret = caret;
    this.__unit = unit;
    return el;
  }

  // Line tool: show the box on the middle of the wall from→end (both cm).
  show(from, end, cursor) {
    this.valueMode = false;
    this.from = from ? from.clone() : null;
    this.cursor = cursor ? cursor.clone() : null;
    const el = this.__ensureEl();
    if (!el || !from || !end) return this.hide();
    const len = end.distanceTo(from);
    if (len < 1) return this.hide();
    this.__place(from.clone().add(end).multiplyScalar(0.5));
    this.__paint(len);
  }

  // Circle / Arc: show the box at `atCm` holding a size (diameter, radius or
  // chord height). Enter then hands the typed value itself to hooks.commit.
  showValue(atCm, valueCm) {
    this.valueMode = true;
    this.from = atCm ? atCm.clone() : null;
    this.cursor = null;
    const el = this.__ensureEl();
    if (!el || !atCm || !(valueCm >= 0)) return this.hide();
    this.__place(atCm);
    this.__paint(valueCm);
  }

  // The typed value in cm, or null when nothing (valid) has been typed.
  typedCm() {
    return this.dirty ? this.parse(this.text) : null;
  }

  __place(atCm) {
    const v = this.viewer;
    const g = v.__floorplanContainer.toGlobal(
      new Point(Dimensioning.cmToPixel(atCm.x), Dimensioning.cmToPixel(atCm.y))
    );
    const view = v.view;
    const rect = view.getBoundingClientRect();
    const res = (v.renderer && v.renderer.resolution) || 1;
    // inverse of pixi's client → renderer mapping
    const sx = view.width ? (rect.width / view.width) * res : 1;
    const sy = view.height ? (rect.height / view.height) * res : 1;
    this.el.style.left = `${rect.left + g.x * sx}px`;
    this.el.style.top = `${rect.top + g.y * sy}px`;
  }

  __paint(cm) {
    if (this.dirty) {
      this.__val.textContent = this.text;
      Object.assign(this.__val.style, { background: "transparent", color: "#111", padding: "0" });
      this.__caret.style.display = "inline-block";
    } else {
      this.__val.textContent = this.format(cm);
      // looks selected: typing replaces it
      Object.assign(this.__val.style, { background: "#1e88e5", color: "#fff", padding: "0 2px" });
      this.__caret.style.display = "none";
    }
    this.__unit.textContent = this.unitLabel();
    this.el.style.display = "flex";
  }

  hide() {
    if (this.el) this.el.style.display = "none";
  }

  reset() {
    this.text = "";
    this.dirty = false;
  }

  destroy() {
    window.removeEventListener("keydown", this.__onKey, true);
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }

  // ── keys ──────────────────────────────────────────────────────────────────

  __onKey(e) {
    if (!this.hooks.isDrawing() || !this.from || (!this.valueMode && !this.cursor)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) {
      return;
    }
    const k = e.key;
    if (k === "Enter") {
      if (this.valueMode) {
        if (this.dirty) {
          const cm = this.parse(this.text);
          if (!cm) return;
          e.preventDefault();
          e.stopPropagation();
          this.hooks.commit(cm);
        } else if (this.hooks.commitClean && this.hooks.commitClean()) {
          // nothing typed in THIS field, but values typed before (e.g. the
          // rectangle's width, then Tab) are enough to build
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (!this.dirty) return;
      const end = this.effectiveEnd(this.from, this.cursor);
      if (!this.parse(this.text) || !end) return;
      e.preventDefault();
      e.stopPropagation();
      this.hooks.commit(end);
      return;
    }
    // Tab: move to the other value (the rectangle's width ↔ height).
    if (k === "Tab" && this.valueMode && this.hooks.tab) {
      e.preventDefault();
      e.stopPropagation();
      this.hooks.tab();
      return;
    }
    if (k === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (!this.dirty) {
        this.text = "";
        this.dirty = true;
      } else {
        this.text = this.text.slice(0, -1);
        if (!this.text) this.dirty = false;
      }
      this.hooks.redraw();
      return;
    }
    if (/^[0-9.'" ]$/.test(k)) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.dirty) {
        this.text = "";
        this.dirty = true;
      }
      if (this.text.length < 16) this.text += k;
      this.hooks.redraw();
    }
  }
}
