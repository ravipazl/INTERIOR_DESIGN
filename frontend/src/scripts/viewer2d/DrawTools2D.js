// Drawing tools for the 2D floor plan — the Coohom-style set beyond Line:
//
//   Arc · Rectangle · Circle               (create walls)
//   Fillet · Merge · Split · Trim · Align  (edit existing walls)
//   Guides                                  (helper lines — never walls)
//   Orthogonal                              (option: lines only horizontal/vertical)
//
// Everything goes through the floorplan model's own calls — newCorner,
// newWall, Wall.remove, Corner.remove, Corner.move — exactly as the existing
// Line (Draw) tool does, so rooms, the 3D view, measurements and autosave all
// follow automatically.
//
// Curves (Arc, Circle, Fillet) are built from SHORT STRAIGHT WALLS (~25 cm
// each). The model can store Bezier walls, but the 2D view and the 3D wall
// builder only draw straight ones — a Bezier circle showed as a diamond. Short
// straight pieces look round everywhere and doors/windows, rooms and the BOQ
// already handle them.
// Each finished operation records ONE undo step (BlueprintInterface.snapshot2D).
//
// While a tool is active the viewer is in floorplannerModes.TOOL: walls and
// corners are not clickable (no accidental corner drags) and panning is paused,
// the same way the Line tool works. Esc leaves the tool.
//
// Nothing here runs unless a tool is chosen, so the existing Select / Line /
// Door / Window behaviour is untouched.

import { Graphics, Text } from "pixi.js";
import { Vector2 } from "three";
import { Dimensioning } from "../core/dimensioning";
import {
  Configuration,
  snapToGrid,
  snapTolerance,
} from "../core/configuration";
import { WallTypes } from "../core/constants";
import { EVENT_NEW, EVENT_UPDATED, EVENT_NEW_ROOMS_ADDED } from "../core/events";
import BlueprintInterface from "@pazl/blueprint-interface";
import { LineLengthBox2D } from "./LineLengthBox2D";

export const DRAW_TOOLS = [
  "arc",
  "rectangle",
  "circle",
  "fillet",
  "merge",
  "split",
  "trim",
  "align",
  "guides",
];

const HINTS = {
  rectangle:
    "Rectangle — click one corner, then the opposite corner. Or type the width, Tab for the height, Enter.",
  fillet:
    "Fillet — click two walls to round the corner between them (or click the corner dot). Type the radius, Enter.",
  merge: "Merge — click the joint between two walls in a straight line to join them.",
  split: "Split — click on a wall where you want to cut it in two.",
  trim: "Trim — point at a wall: the piece between two crossing points turns red. Click to remove it.",
  align: "Align — click a wall to straighten it (horizontal or vertical).",
  guides:
    "Guides — click two points to draw a helper line. Tools snap to it; it is not a wall.",
};

// Circle and Arc each have two ways to draw (the options under the button).
const MODE_HINTS = {
  circle: {
    corner:
      "Circle — click one corner, then the opposite corner. Or type the size and press Enter.",
    radius:
      "Circle — click the centre, then the edge. Or type the radius and press Enter.",
  },
  arc: {
    radius:
      "Arc — click the start and the end, move to the side it curves, then click — or type the radius and press Enter.",
    chord:
      "Arc — click the start and the end, then set how far it curves: click, or type the height and press Enter.",
  },
  // Fillet has four corner types (the list under the button).
  fillet: {
    fillet:
      "Fillet — click two walls (or a corner dot) to round the corner. Type the radius, Enter.",
    inner:
      "Inner fillet — click two walls (or a corner dot) to cut a curve into the corner. Type the radius, Enter.",
    rightangle:
      "Inner right angle — click two walls (or a corner dot) to cut a square notch. Type the size, Enter.",
    chamfer:
      "Chamfer — click two walls (or a corner dot) to cut the corner straight across. Type the length, Enter.",
  },
};

// Fillet corner types and the name of the size each one takes.
const FILLET_MODES = ["fillet", "inner", "rightangle", "chamfer"];
const FILLET_SIZE = { fillet: "radius", inner: "radius", rightangle: "size", chamfer: "length" };
const FILLET_DONE = {
  fillet: "Corner rounded.",
  inner: "Inner fillet added.",
  rightangle: "Corner notched.",
  chamfer: "Corner chamfered.",
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ACCENT = 0x008cba; // same blue as the Line tool's temporary wall
const SHAPE = 0x333333; // Circle / Arc preview line (Coohom-style thin dark line)
const HELP = 0x20c997; // green helper lines
const HOVER = 0xff8a00;
const GUIDE = 0xe0457b;
const TRIM = 0xe03131;
const PICKED = 0x4338ca; // walls chosen for Fillet
const SNAP_PX = 12; // screen pixels
const MIN_CM = 10; // smallest wall a tool will create
// Curves: aim for pieces this long. Pieces must stay longer than the model's
// corner tolerance (20 cm) or neighbouring corners weld together.
const PIECE_CM = 25;
const MIN_PIECE_CM = 22;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (p) => new Vector2(p.x, p.y);

// Where segment p1–p2 crosses segment p3–p4, or null.
const segCross = (p1, p2, p3, p4) => {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const qx = p4.x - p3.x;
  const qy = p4.y - p3.y;
  const d = rx * qy - ry * qx;
  if (Math.abs(d) < 1e-9) return null;
  const wx = p3.x - p1.x;
  const wy = p3.y - p1.y;
  const t = (wx * qy - wy * qx) / d;
  const s = (wx * ry - wy * rx) / d;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return new Vector2(p1.x + t * rx, p1.y + t * ry);
};

export class DrawTools2D {
  constructor(viewer) {
    this.viewer = viewer;
    this.tool = null;
    this.points = [];
    this.cursor = null;
    this.orthogonal = false;
    this.orthoArc = false; // Arc's own Orthogonal option
    this.__snapKind = null; // "corner" | "wall" | null — what __snap landed on
    this.__snapWall = null;
    this.filletRadiusCm = 50;
    this.filletMode = "fillet"; // "fillet" | "inner" | "rightangle" | "chamfer"
    // Fillet: the walls clicked so far [{ wall, p }] and where the 2nd click was.
    this.filletWalls = [];
    this.__filletClick2 = null;
    this.__filletReason = null;
    this.circleMode = "corner"; // "corner" (circumscribed corner) | "radius"
    this.arcMode = "radius"; // "radius" | "chord" (chord height)
    // Rectangle: which size the box is editing, and sizes typed so far (cm).
    this.rectField = "w";
    this.rectTyped = { w: null, h: null };
    // Alignment with an existing corner found by __snap: { ax, ay } (cm).
    this.__alignSnap = null;
    this.guides = [];
    this.__labels = [];
    this.__hintEl = null;
    this.__hintTimer = null;

    const c = viewer.__floorplanContainer;
    this.guideLayer = new Graphics();
    this.preview = new Graphics();
    c.addChild(this.guideLayer);
    c.addChild(this.preview);

    // Typed size for Circle / Arc — the Line tool's box, in value mode.
    this.box = new LineLengthBox2D(viewer, {
      isDrawing: () => this.__boxStage(),
      commit: () => this.__boxCommit(),
      commitClean: () => this.__boxCommitClean(),
      tab: () => this.__boxTab(),
      redraw: () => this.__redraw(),
    });

    this.__onMove = this.__onMove.bind(this);
    this.__onUp = this.__onUp.bind(this);
    this.__onKey = this.__onKey.bind(this);
    this.__onZoom = () => {
      this.__drawGuides();
      this.__redraw();
    };
    c.on("mousemove", this.__onMove);
    c.on("touchmove", this.__onMove);
    c.on("mouseup", this.__onUp);
    c.on("touchend", this.__onUp);
    c.on("zoomed", this.__onZoom);
  }

  get fp() {
    return this.viewer.__floorplan;
  }

  // ── public ────────────────────────────────────────────────────────────────

  activate(tool) {
    if (!DRAW_TOOLS.includes(tool)) return false;
    if (typeof this.viewer.__enterToolMode === "function") {
      this.viewer.__enterToolMode();
    }
    this.tool = tool;
    this.points = [];
    this.cursor = null;
    window.removeEventListener("keydown", this.__onKey);
    window.addEventListener("keydown", this.__onKey);
    this.box.reset();
    this.__resetRect();
    this.__resetFillet();
    this.__alignSnap = null;
    this.__hint(this.__hintFor(tool));
    this.__redraw();
    this.__emit();
    return true;
  }

  // Called by Viewer2D.switchMode whenever the viewer leaves TOOL mode (Esc,
  // Select, Line, …). Never calls switchMode itself, so no loop.
  deactivate() {
    if (!this.tool) return;
    this.tool = null;
    this.points = [];
    this.cursor = null;
    window.removeEventListener("keydown", this.__onKey);
    this.box.reset();
    this.box.hide();
    this.__resetRect();
    this.__resetFillet();
    this.__alignSnap = null;
    this.__hint(null);
    this.__redraw();
    this.__emit();
  }

  setCircleMode(mode) {
    if (mode !== "corner" && mode !== "radius") return;
    this.circleMode = mode;
    this.__restartShape("circle");
  }

  setArcMode(mode) {
    if (mode !== "radius" && mode !== "chord") return;
    this.arcMode = mode;
    this.__restartShape("arc");
  }

  // Fillet corner type. Walls already picked stay picked; the preview follows.
  setFilletMode(mode) {
    if (!FILLET_MODES.includes(mode)) return;
    this.filletMode = mode;
    if (this.tool !== "fillet") return;
    this.__filletReason = null;
    this.box.reset();
    this.__hint(this.filletWalls.length === 2 ? this.__filletStageHint() : this.__hintFor("fillet"));
    this.__redraw();
  }

  __filletStageHint() {
    return `Type the ${FILLET_SIZE[this.filletMode]} or move the mouse, then press Enter or click.`;
  }

  __restartShape(tool) {
    if (this.tool !== tool) return;
    this.points = [];
    this.box.reset();
    this.box.hide();
    this.__hint(this.__hintFor(tool));
    this.__redraw();
  }

  __hintFor(tool) {
    if (tool === "circle") return MODE_HINTS.circle[this.circleMode];
    if (tool === "arc") return MODE_HINTS.arc[this.arcMode];
    if (tool === "fillet") return MODE_HINTS.fillet[this.filletMode];
    return HINTS[tool];
  }

  setOrthogonal(on) {
    this.orthogonal = !!on;
    this.__redraw();
  }

  setFilletRadiusCm(cm) {
    const v = Number(cm);
    if (Number.isFinite(v) && v > 0) this.filletRadiusCm = v;
    this.__redraw();
  }

  clearGuides() {
    this.guides = [];
    this.__drawGuides();
  }

  // Line tool (existing Draw mode) asks for this when Orthogonal is on.
  orthoFrom(from, p) {
    if (!from) return p;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    return Math.abs(dx) >= Math.abs(dy)
      ? new Vector2(p.x, from.y)
      : new Vector2(from.x, p.y);
  }

  // ── input ─────────────────────────────────────────────────────────────────

  __cm(evt) {
    const co = evt.data.getLocalPosition(this.viewer.__floorplanContainer);
    return new Vector2(Dimensioning.pixelToCm(co.x), Dimensioning.pixelToCm(co.y));
  }

  __zoom() {
    return this.viewer.__floorplanContainer.scale.x || 1;
  }

  __tolCm(px = SNAP_PX) {
    return Dimensioning.pixelToCm(px / this.__zoom());
  }

  // Snap order: an existing corner, then a guide line, then the grid, then
  // Orthogonal (relative to the previous point) — Orthogonal wins last so a
  // line that must be straight stays straight.
  __snap(p, from) {
    let q = p.clone();
    const tol = this.__tolCm();
    const ortho = this.__orthoOn() && !!from;
    this.__alignSnap = null;
    // what the point landed on, for the Arc tool's wall highlight
    this.__snapKind = null;
    this.__snapWall = null;
    const corner = this.fp.overlappedCorner(q.x, q.y, tol);
    if (corner && !ortho) {
      this.__snapKind = "corner";
      return corner.location.clone();
    }
    // Onto a wall: a point anywhere on the drawn wall (its thickness counts, so
    // this works at any zoom) lands exactly on it, so an Arc drawn from wall to
    // wall really starts and ends on those walls (and joins them).
    if (!ortho) {
      const onWall = this.__pointOnWall(q, tol, true);
      if (onWall) {
        this.__snapKind = "wall";
        this.__snapWall = onWall.wall;
        return onWall.p;
      }
    }
    let best = null;
    let bestD = tol;
    for (const g of this.guides) {
      const d = g.b.clone().sub(g.a);
      const len2 = d.lengthSq();
      if (len2 < 1e-6) continue;
      const t = q.clone().sub(g.a).dot(d) / len2;
      const proj = g.a.clone().add(d.clone().multiplyScalar(t));
      const dist = proj.distanceTo(q);
      if (dist < bestD) {
        bestD = dist;
        best = proj;
      }
    }
    if (best) q = best;
    // Alignment (Coohom's green guide): line up level or plumb with an existing
    // corner. Not the rectangle's / circle's own first click: lining up with that
    // would collapse the shape to a line.
    this.__alignSnap = null;
    if (!best) {
      let ax = null;
      let ay = null;
      let bx = tol;
      let by = tol;
      for (const c of this.fp.corners.map((k) => k.location)) {
        const ddx = Math.abs(c.x - q.x);
        const ddy = Math.abs(c.y - q.y);
        if (ddx < bx) {
          bx = ddx;
          ax = c;
        }
        if (ddy < by) {
          by = ddy;
          ay = c;
        }
      }
      if (ax) q.x = ax.x;
      if (ay) q.y = ay.y;
      if (ax || ay) this.__alignSnap = { ax: ax && ax.clone(), ay: ay && ay.clone() };
    }
    if (Configuration.getBooleanValue(snapToGrid) || this.viewer.__snapToGrid) {
      const s = Configuration.getNumericValue(snapTolerance) || 1;
      q.x = Math.round(q.x / s) * s;
      q.y = Math.round(q.y / s) * s;
    }
    if (ortho) {
      q = this.orthoFrom(from, q);
      // Orthogonal over a wall: land where the straight line meets that wall
      const hit = this.__pointOnWall(q, tol, true);
      const x = hit && this.__lineCrossWall(from, q, hit.wall);
      if (x) {
        q = x;
        this.__snapKind = "wall";
        this.__snapWall = hit.wall;
        this.__alignSnap = null;
      }
    }
    return q;
  }

  // Orthogonal for the tool in use. Arc has its own setting (off by default),
  // so ticking it for Line / Guides doesn't silently lock the arc.
  __orthoOn() {
    return this.tool === "arc" ? this.orthoArc : this.orthogonal;
  }

  setArcOrthogonal(on) {
    this.orthoArc = !!on;
    this.__redraw();
  }

  // Where the endless line through a and b crosses the wall, or null.
  __lineCrossWall(a, b, wall) {
    const s = wall.start.location;
    const e = wall.end.location;
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const qx = e.x - s.x;
    const qy = e.y - s.y;
    const d = rx * qy - ry * qx;
    if (Math.abs(d) < 1e-9) return null;
    const wx = s.x - a.x;
    const wy = s.y - a.y;
    const u = (wx * ry - wy * rx) / d;
    if (u < 0 || u > 1) return null;
    return new Vector2(s.x + u * qx, s.y + u * qy);
  }

  __onMove(evt) {
    if (!this.tool) return;
    const raw = this.__cm(evt);
    const last = this.points[this.points.length - 1];
    const wantsSnap = ["arc", "rectangle", "circle", "guides"].includes(
      this.tool
    );
    this.cursor = wantsSnap ? this.__snap(raw, this.__orthoAnchor(last)) : raw;
    this.__redraw();
  }

  // Orthogonal is measured from the previous point, except the arc's third
  // click (the bulge), which is free.
  __orthoAnchor(last) {
    if (this.tool === "arc" && this.points.length >= 2) return null;
    if (this.tool === "rectangle" || this.tool === "circle") return null;
    return last || null;
  }

  __onUp(evt) {
    if (!this.tool) return;
    const btn = evt && evt.data && evt.data.button;
    if (btn === 2) {
      // right-click: drop the shape in progress, keep the tool
      this.points = [];
      this.box.reset();
      this.__resetRect();
      if (this.filletWalls.length) this.__hint(this.__hintFor(this.tool));
      this.__resetFillet();
      this.__redraw();
      return;
    }
    const raw = this.__cm(evt);
    const last = this.points[this.points.length - 1];
    const p = ["arc", "rectangle", "circle", "guides"].includes(this.tool)
      ? this.__snap(raw, this.__orthoAnchor(last))
      : raw;
    try {
      switch (this.tool) {
        case "rectangle":
          return this.__clickRectangle(p);
        case "circle":
          return this.__clickCircle(p);
        case "arc":
          return this.__clickArc(p);
        case "guides":
          return this.__clickGuide(p);
        case "split":
          return this.__split(raw);
        case "trim":
          return this.__trim(raw);
        case "merge":
          return this.__merge(raw);
        case "fillet":
          return this.__clickFillet(raw);
        case "align":
          return this.__align(raw);
        default:
          return undefined;
      }
    } catch (e) {
      console.error(`[DrawTools2D] ${this.tool} failed`, e);
      this.__hint("That didn't work — nothing was changed.", 3000);
      this.points = [];
      this.__redraw();
    }
  }

  __onKey(e) {
    if (!this.tool) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) {
      return;
    }
    if (e.key === "Backspace" && this.points.length) {
      e.preventDefault();
      this.points.pop();
      this.__redraw();
    }
  }

  // ── create: shapes ────────────────────────────────────────────────────────

  __clickRectangle(p) {
    if (!this.points.length) {
      this.points = [p];
      this.box.reset();
      this.__resetRect();
      return this.__redraw();
    }
    const v = this.box.typedCm();
    if (v) this.rectTyped[this.rectField] = v;
    this.__buildRect(this.__rectGeom(p));
  }

  // The rectangle from the first corner and the mouse. A typed width / height
  // replaces the mouse's; the mouse still decides which way it extends.
  __rectGeom(cursor) {
    const a = this.points[0];
    if (!a || !cursor) return null;
    const now = this.box.typedCm();
    const tw = this.rectField === "w" && now ? now : this.rectTyped.w;
    const th = this.rectField === "h" && now ? now : this.rectTyped.h;
    const dx = cursor.x - a.x;
    const dy = cursor.y - a.y;
    const w = tw || Math.abs(dx);
    const h = th || Math.abs(dy);
    const q = new Vector2(a.x + (dx < 0 ? -1 : 1) * w, a.y + (dy < 0 ? -1 : 1) * h);
    return { a, q, w, h };
  }

  __buildRect(g) {
    if (!g) return;
    if (g.w < MIN_CM || g.h < MIN_CM) {
      return this.__hint("Too small — make the width and height bigger.", 2500);
    }
    const { a, q } = g;
    this.__makeLoop([
      new Vector2(a.x, a.y),
      new Vector2(q.x, a.y),
      new Vector2(q.x, q.y),
      new Vector2(a.x, q.y),
    ]);
    this.points = [];
    this.box.reset();
    this.box.hide();
    this.__resetRect();
    this.__commit("Rectangle room added.");
  }

  __clickCircle(p) {
    if (!this.points.length) {
      this.points = [p];
      this.box.reset();
      return this.__redraw();
    }
    this.__buildCircle(this.__circleGeom(p));
  }

  // The circle the first click and the mouse describe — or the typed value.
  //   corner: first click = a corner of the square the circle sits in; the
  //           typed value is the SIZE (diameter).
  //   radius: first click = the centre; the typed value is the radius.
  __circleGeom(cursor) {
    const a = this.points[0];
    if (!a || !cursor) return null;
    const typed = this.box.typedCm();
    if (this.circleMode === "corner") {
      const dx = cursor.x - a.x;
      const dy = cursor.y - a.y;
      const sx = dx < 0 ? -1 : 1;
      const sy = dy < 0 ? -1 : 1;
      const size = typed || Math.max(Math.abs(dx), Math.abs(dy));
      const q = new Vector2(a.x + sx * size, a.y + sy * size);
      return { c: a.clone().add(q).multiplyScalar(0.5), r: size / 2, a, q, value: size };
    }
    const d = cursor.clone().sub(a);
    const len = d.length();
    const r = typed || len;
    const edge = len > 1e-6 ? a.clone().add(d.multiplyScalar(r / len)) : new Vector2(a.x + r, a.y);
    return { c: a.clone(), r, edge, value: r };
  }

  __buildCircle(g) {
    if (!g) return;
    const pts = this.__circlePoints(g.c, g.r);
    if (!pts) return this.__hint("Too small for a round room — make it bigger.", 2500);
    this.__batch(() => this.__makeChain(pts, true, false));
    this.points = [];
    this.box.reset();
    this.box.hide();
    this.__commit("Circular room added.");
  }

  // Points around a full circle, closed loop (first point not repeated).
  __circlePoints(c, r) {
    const n = this.__pieces(2 * Math.PI * r, (k) => 2 * r * Math.sin(Math.PI / k), 8, 64, 4);
    if (!n) return null;
    return this.__arcPoints(c, r, 0, 2 * Math.PI, n).slice(0, n);
  }

  // How many straight pieces for a curve: about PIECE_CM each, never shorter
  // than MIN_PIECE_CM (chord), between min and max, a multiple of `step`.
  // null when even `min` pieces would be too short.
  __pieces(arcLen, chordOf, min, max, step = 1) {
    let n = clamp(Math.ceil(arcLen / PIECE_CM), min, max);
    n = Math.ceil(n / step) * step;
    while (n > min && chordOf(n) < MIN_PIECE_CM) n -= step;
    return chordOf(n) >= MIN_PIECE_CM ? n : null;
  }

  // n+1 points on a circle from angle a0 through `sweep` (radians).
  __arcPoints(o, r, a0, sweep, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      out.push(new Vector2(o.x + r * Math.cos(t), o.y + r * Math.sin(t)));
    }
    return out;
  }

  __clickArc(p) {
    if (this.points.length < 2) {
      if (this.points.length === 1 && this.points[0].distanceTo(p) < MIN_CM) {
        return this.__hint("Too short — click the end further away.", 2500);
      }
      this.points.push(p);
      this.box.reset();
      return this.__redraw();
    }
    this.__buildArc(this.__arcGeom(p));
  }

  // The arc from the two clicked ends, shaped by the mouse — or the typed value.
  //   radius: the mouse picks the side and (untyped) the radius of the circle
  //           through both ends and the mouse; a typed radius gives the
  //           shallower arc on the mouse's side.
  //   chord:  the height of the bulge above the start–end line.
  __arcGeom(cursor) {
    const [s, e] = this.points;
    if (!s || !e || !cursor) return null;
    const chord = e.clone().sub(s);
    const L = chord.length();
    if (L < 1e-6) return null;
    const mid = s.clone().add(e).multiplyScalar(0.5);
    // Both ends on two walls that meet at a corner: a proper rounded corner —
    // smooth with both walls and replacing the corner, the same as Fillet.
    const cg = this.__cornerArcGeom(s, e);
    if (cg) {
      return {
        s,
        e,
        mid,
        corner: cg,
        value: cg.r || 0,
        invalid: !cg.ok,
        path: cg.ok ? cg.path : null,
        arc: cg.ok ? { o: cg.O, r: cg.r, a0: cg.a0, sweep: cg.sweep } : null,
      };
    }
    const n = new Vector2(-chord.y / L, chord.x / L);
    const side = cursor.clone().sub(mid).dot(n);
    if (side < 0) n.multiplyScalar(-1); // n points to the side it bulges
    const h = L / 2;
    const typed = this.box.typedCm();
    let m;
    let value;
    if (this.arcMode === "chord") {
      value = typed || Math.abs(side);
      m = mid.clone().add(n.clone().multiplyScalar(value));
    } else if (typed) {
      value = typed;
      if (typed < h - 1e-6) return { s, e, mid, n, value, invalid: true };
      const sag = typed - Math.sqrt(Math.max(0, typed * typed - h * h));
      m = mid.clone().add(n.clone().multiplyScalar(sag));
    } else {
      const a3 = this.__arcFrom3(s, e, cursor);
      value = a3 ? a3.r : 0;
      m = cursor.clone();
    }
    return { s, e, m, mid, n, value, arc: this.__arcFrom3(s, e, m), path: this.__arcPath(s, e, m) };
  }

  __buildArc(g) {
    if (!g) return;
    if (g.corner) {
      if (!g.corner.ok) return this.__hint(g.corner.reason, 3000);
      return this.__buildFilletWalls(g.corner, "Arc joined smoothly to both walls.");
    }
    if (g.invalid) {
      return this.__hint("The radius must be at least half the distance between the two ends.", 3000);
    }
    if (!g.path) return this.__hint("Too tight to curve — use a bigger radius.", 2500);
    const before = this.fp.walls.length;
    const corners = this.__batch(() => this.__makeChain(g.path, false, false));
    // An end placed on a wall joins it (the wall is cut there), so the arc and
    // the wall make one outline — ready for Trim to take off the old corner.
    const own = new Set(this.fp.walls.slice(before));
    this.__joinToWall(corners[0], own);
    this.__joinToWall(corners[corners.length - 1], own);
    this.points = [];
    this.box.reset();
    this.box.hide();
    this.__commit("Arc wall added.");
  }

  // The typed-size box is live for the circle's 2nd click and the arc's 3rd.
  __boxStage() {
    return (
      (this.tool === "circle" && this.points.length === 1) ||
      (this.tool === "arc" && this.points.length === 2) ||
      (this.tool === "rectangle" && this.points.length === 1) ||
      (this.tool === "fillet" && this.filletWalls.length === 2)
    );
  }

  // Enter in the box: build with the typed value, in the mouse's direction.
  __boxCommit() {
    const cur = this.cursor || this.points[this.points.length - 1];
    if (this.tool === "circle") this.__buildCircle(this.__circleGeom(cur));
    else if (this.tool === "arc") this.__buildArc(this.__arcGeom(cur));
    else if (this.tool === "fillet") this.__buildFilletWalls(this.__filletStageGeom(this.cursor));
    else if (this.tool === "rectangle") {
      const v = this.box.typedCm();
      if (v) this.rectTyped[this.rectField] = v;
      this.__buildRect(this.__rectGeom(cur));
    }
  }

  // Enter with nothing typed in the current field: a rectangle can still be
  // built from a size typed before Tab; a fillet uses the radius it shows.
  __boxCommitClean() {
    if (this.tool === "fillet" && this.filletWalls.length === 2) {
      this.__buildFilletWalls(this.__filletStageGeom(this.cursor));
      return true;
    }
    if (this.tool !== "rectangle" || (!this.rectTyped.w && !this.rectTyped.h)) return false;
    this.__buildRect(this.__rectGeom(this.cursor || this.points[0]));
    return true;
  }

  // Tab: keep what was typed for this size, edit the other one.
  __boxTab() {
    if (this.tool !== "rectangle") return;
    const v = this.box.typedCm();
    if (v) this.rectTyped[this.rectField] = v;
    this.rectField = this.rectField === "w" ? "h" : "w";
    this.box.reset();
    this.__redraw();
  }

  __resetRect() {
    this.rectField = "w";
    this.rectTyped = { w: null, h: null };
  }

  __resetFillet() {
    this.filletWalls = [];
    this.__filletClick2 = null;
    this.__filletReason = null;
  }

  // Points along the arc start → end passing through m. Three points in a
  // line give just [start, end] (a straight wall). null if too tight to build
  // from pieces of at least MIN_PIECE_CM.
  __arcPath(s, e, m) {
    const arc = this.__arcFrom3(s, e, m);
    if (!arc) return [s.clone(), e.clone()];
    const { o, r, a0, sweep } = arc;
    const n = this.__pieces(
      Math.abs(sweep) * r,
      (k) => 2 * r * Math.sin(Math.abs(sweep) / (2 * k)),
      2,
      64
    );
    if (!n) return null;
    const pts = this.__arcPoints(o, r, a0, sweep, n);
    pts[0] = s.clone();
    pts[pts.length - 1] = e.clone();
    return pts;
  }

  // Closed loop of straight walls, like drawing it with Line — including the
  // same intersection handling, so a shape drawn across existing walls splits
  // them the way Line does.
  __makeLoop(pts) {
    return this.__makeChain(pts, true);
  }

  // Straight walls through the points; `closed` joins the last back to the
  // first. `intersections` splits existing walls the chain crosses, as Line
  // does — on for Rectangle, off for the many short pieces of a curve
  // (it checks every wall against every piece). Returns the corners.
  __makeChain(pts, closed, intersections = true) {
    const corners = pts.map((q) => this.fp.newCorner(q.x, q.y));
    const count = closed ? corners.length : corners.length - 1;
    for (let i = 0; i < count; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      if (a === b) continue;
      this.__newWall(a, b);
      if (!intersections) continue;
      try {
        this.fp.newWallsForIntersections(a, b);
      } catch (e) {
        /* intersections are best-effort, as in Line */
      }
    }
    return corners;
  }

  __clickGuide(p) {
    if (!this.points.length) {
      this.points = [p];
      return this.__redraw();
    }
    const a = this.points[0];
    if (a.distanceTo(p) < MIN_CM) return;
    this.guides.push({ a: a.clone(), b: p.clone() });
    this.points = [];
    this.__drawGuides();
    this.__redraw();
    this.__hint("Guide added. Tools snap to it. Clear guides from the options.", 2500);
  }

  // The circle through three points: centre, radius, start angle and the
  // signed sweep that goes from s to e THROUGH m. null when they are in a line.
  __arcFrom3(s, e, m) {
    const d = 2 * (s.x * (e.y - m.y) + e.x * (m.y - s.y) + m.x * (s.y - e.y));
    if (Math.abs(d) < 1e-6) return null;
    const s2 = s.lengthSq();
    const e2 = e.lengthSq();
    const m2 = m.lengthSq();
    const ox = (s2 * (e.y - m.y) + e2 * (m.y - s.y) + m2 * (s.y - e.y)) / d;
    const oy = (s2 * (m.x - e.x) + e2 * (s.x - m.x) + m2 * (e.x - s.x)) / d;
    const r = Math.hypot(s.x - ox, s.y - oy);
    if (!Number.isFinite(r) || r > 1e6) return null;
    const TWO = Math.PI * 2;
    const norm = (a) => ((a % TWO) + TWO) % TWO;
    const a0 = Math.atan2(s.y - oy, s.x - ox);
    const a1 = Math.atan2(e.y - oy, e.x - ox);
    const am = Math.atan2(m.y - oy, m.x - ox);
    const ccw = norm(a1 - a0);
    const sweep = norm(am - a0) < ccw ? ccw : ccw - TWO;
    return { o: new Vector2(ox, oy), r, a0, sweep };
  }

  // ── edit: existing walls ──────────────────────────────────────────────────

  __wallAt(p) {
    return this.fp.overlappedWall(p.x, p.y, this.__tolCm());
  }

  __cornerAt(p) {
    return this.fp.overlappedCorner(p.x, p.y, this.__tolCm(14));
  }

  // Doors and windows hang on a specific wall object; replacing that wall would
  // orphan them, so edits that replace a wall refuse while it carries one.
  __hasOpenings(wall) {
    if (!wall) return false;
    const n = (wall.inWallItems ? wall.inWallItems.length : 0) + (wall.onWallItems ? wall.onWallItems.length : 0);
    if (n > 0) return true;
    try {
      const items = BlueprintInterface.blueprint3d.model.roomItems || [];
      return items.some((it) => it && it.currentWall === wall);
    } catch (e) {
      return false;
    }
  }

  __cornerWalls(c) {
    return [...(c.wallStarts || []), ...(c.wallEnds || [])];
  }

  __split(raw) {
    const wall = this.__wallAt(raw);
    if (!wall) return this.__hint("Click directly on a wall to split it.", 2500);
    if (this.__hasOpenings(wall)) {
      return this.__hint("This wall has a door or window. Move it to another wall first.", 3500);
    }
    const s = wall.start;
    const e = wall.end;
    const curved = wall.wallType === WallTypes.CURVED;
    let mid;
    let left;
    let right;
    if (curved) {
      const t = wall.bezier.project({ x: raw.x, y: raw.y }).t;
      if (!(t > 0.05 && t < 0.95)) return this.__hint("Too close to the end — click nearer the middle.", 2500);
      const parts = wall.bezier.split(t);
      left = parts.left.points;
      right = parts.right.points;
      mid = V(left[3]);
    } else {
      const d = e.location.clone().sub(s.location);
      const t = clamp(raw.clone().sub(s.location).dot(d) / d.lengthSq(), 0, 1);
      if (!(t > 0.05 && t < 0.95)) return this.__hint("Too close to the end — click nearer the middle.", 2500);
      mid = s.location.clone().add(d.multiplyScalar(t));
    }
    const th = wall.thickness;
    wall.remove();
    const m = this.fp.newCorner(mid.x, mid.y);
    const w1 = curved ? this.__newWall(s, m, V(left[1]), V(left[2])) : this.__newWall(s, m);
    const w2 = curved ? this.__newWall(m, e, V(right[1]), V(right[2])) : this.__newWall(m, e);
    [w1, w2].forEach((w) => {
      if (w && th) w.thickness = th;
    });
    this.__commit("Wall split in two.");
  }

  // The nearest straight wall within tol of p, and the point on its centre
  // line. `byThickness`: anywhere on the drawn wall counts too (half its
  // thickness from the centre line), whatever the zoom.
  __pointOnWall(p, tol, byThickness = false) {
    let best = null;
    let bestD = Infinity;
    for (const w of this.fp.walls) {
      if (w.wallType === WallTypes.CURVED) continue;
      const s = w.start.location;
      const d = w.end.location.clone().sub(s);
      const L2 = d.lengthSq();
      if (L2 < 1e-6) continue;
      const t = clamp(p.clone().sub(s).dot(d) / L2, 0, 1);
      const q = s.clone().add(d.multiplyScalar(t));
      const dist = q.distanceTo(p);
      const reach = byThickness ? Math.max(tol, (Number(w.thickness) || 0) / 2 + 2) : tol;
      if (dist < reach && dist < bestD) {
        bestD = dist;
        best = { wall: w, p: q };
      }
    }
    return best;
  }

  // A corner with one wall that sits on another wall's middle is joined to it
  // the way the engine joins a dragged corner (Corner.mergeWithIntersected):
  // that wall is cut in two at the corner. Walls with doors / windows are left
  // alone. `skip` = walls not to join (the piece's own walls).
  __joinToWall(corner, skip) {
    if (!corner || this.__cornerWalls(corner).length !== 1) return false;
    const p = corner.location;
    let best = null;
    let bestD = 2; // cm
    for (const w of this.fp.walls) {
      if ((skip && skip.has(w)) || w.wallType === WallTypes.CURVED) continue;
      if (w.start === corner || w.end === corner) continue;
      const s = w.start.location;
      const d = w.end.location.clone().sub(s);
      const L2 = d.lengthSq();
      if (L2 < 1e-6) continue;
      const t = p.clone().sub(s).dot(d) / L2;
      if (t <= 0 || t >= 1) continue;
      const dist = s.clone().add(d.multiplyScalar(t)).distanceTo(p);
      if (dist < bestD) {
        bestD = dist;
        best = w;
      }
    }
    if (!best || this.__hasOpenings(best)) return false;
    const th = best.thickness;
    const oldEnd = best.getEnd();
    const nw = this.fp.newWall(corner, oldEnd);
    best.setEnd(corner);
    // Wall.setEnd leaves the wall listening to its OLD end corner, so deleting
    // that corner later (e.g. trimming it away) would delete this wall too.
    try {
      best.addCornerMoveListener(oldEnd, true);
    } catch (e) {
      /* listener cleanup is best-effort */
    }
    if (nw && th) nw.thickness = th;
    try {
      nw.clearAttachedRooms();
      best.clearAttachedRooms();
    } catch (e) {
      /* rooms are recalculated on update anyway */
    }
    return true;
  }

  // The piece of a wall under p between the nearest cut points on either side:
  // the wall's own ends, corners sitting on it (e.g. an arc's end) and the
  // places other walls cross it.
  __trimGeom(p) {
    // the CLOSEST wall: near a curve several pieces are within reach, and the
    // engine's lookup returns the first one it finds
    const hit = p && this.__pointOnWall(p, this.__tolCm(), true);
    const wall = hit ? hit.wall : p && this.__wallAt(p);
    if (!wall) return { reason: "Click the piece of wall you want to remove." };
    if (wall.wallType === WallTypes.CURVED) return { wall, reason: "Trim works on straight walls only." };
    const S = wall.start.location;
    const E = wall.end.location;
    const L = S.distanceTo(E);
    if (L < 1e-6) return { wall, reason: "This wall can't be trimmed." };
    const ux = (E.x - S.x) / L;
    const uy = (E.y - S.y) / L;
    const along = (q) => (q.x - S.x) * ux + (q.y - S.y) * uy;
    const off = (q) => Math.abs((q.x - S.x) * uy - (q.y - S.y) * ux);
    const EPS = 1; // cm
    const cuts = [
      { t: 0, corner: wall.start },
      { t: L, corner: wall.end },
    ];
    this.fp.corners.forEach((c) => {
      if (c === wall.start || c === wall.end) return;
      const a = along(c.location);
      if (a > EPS && a < L - EPS && off(c.location) < 2) cuts.push({ t: a, corner: c });
    });
    this.fp.walls.forEach((w) => {
      if (w === wall || w.wallType === WallTypes.CURVED) return;
      const x = segCross(S, E, w.start.location, w.end.location);
      if (!x) return;
      const a = along(x);
      if (a > EPS && a < L - EPS) cuts.push({ t: a, corner: null });
    });
    cuts.sort((m, n) => m.t - n.t);
    const pts = [];
    cuts.forEach((c) => {
      const last = pts[pts.length - 1];
      if (last && c.t - last.t < EPS) {
        if (!last.corner && c.corner) last.corner = c.corner; // keep the real corner
        return;
      }
      pts.push({ ...c });
    });
    const a = clamp(along(p), 0, L);
    let i = 0;
    while (i < pts.length - 2 && a > pts[i + 1].t) i++;
    const from = pts[i];
    const to = pts[i + 1];
    const at = (t) => new Vector2(S.x + ux * t, S.y + uy * t);
    if (this.__hasOpenings(wall)) {
      return { wall, A: at(from.t), B: at(to.t), reason: "This wall has a door or window. Move it to another wall first." };
    }
    return {
      ok: true,
      wall,
      L,
      from,
      to,
      A: at(from.t),
      B: at(to.t),
      cuts: pts.slice(1, -1).map((c) => at(c.t)),
    };
  }

  __trim(raw) {
    const g = this.__trimGeom(raw);
    if (!g.ok) return this.__hint(g.reason, 3000);
    const { wall, from, to } = g;
    const s = wall.start;
    const e = wall.end;
    const th = wall.thickness;
    const made = [];
    // New walls first: removing the old wall drops any corner left with no wall.
    let cA = null;
    let cB = null;
    if (from.t > 0) {
      cA = from.corner || this.fp.newCorner(g.A.x, g.A.y);
      made.push(this.__newWall(s, cA));
    }
    if (to.t < g.L) {
      cB = to.corner || this.fp.newCorner(g.B.x, g.B.y);
      made.push(this.__newWall(cB, e));
    }
    wall.remove();
    made.forEach((w) => {
      if (w && th) w.thickness = th;
    });
    // a cut where another wall crossed: join that wall there too
    const mine = new Set(made.filter(Boolean));
    if (cA && !from.corner) this.__joinToWall(cA, mine);
    if (cB && !to.corner) this.__joinToWall(cB, mine);
    this.__commit("Wall trimmed.");
  }

  __mergeGeom(c) {
    if (!c) return { reason: "Click the joint (dot) between two walls." };
    const walls = this.__cornerWalls(c);
    if (walls.length !== 2) return { reason: "Merge needs a joint with exactly two walls." };
    const [w1, w2] = walls;
    if (w1.wallType === WallTypes.CURVED || w2.wallType === WallTypes.CURVED) {
      return { reason: "Merge works on straight walls only." };
    }
    const A = w1.oppositeCorner(c);
    const B = w2.oppositeCorner(c);
    if (!A || !B || A === B) return { reason: "These walls can't be merged." };
    const u = A.location.clone().sub(c.location).normalize();
    const v = B.location.clone().sub(c.location).normalize();
    if (u.dot(v) > -0.995) return { reason: "The two walls aren't in a straight line." };
    if (this.__hasOpenings(w1) || this.__hasOpenings(w2)) {
      return { reason: "One of these walls has a door or window. Move it first." };
    }
    return { ok: true, w1, w2, A, B };
  }

  __merge(raw) {
    const c = this.__cornerAt(raw);
    const g = this.__mergeGeom(c);
    if (!g.ok) return this.__hint(g.reason, 3000);
    const th = g.w1.thickness;
    g.w1.remove();
    g.w2.remove();
    c.remove();
    const w = this.__newWall(g.A, g.B);
    if (w && th) w.thickness = th;
    this.__commit("Walls merged.");
  }

  // ── Fillet between two walls ──────────────────────────────────────────────

  __filletCornerUnder(p) {
    const c = p && this.__cornerAt(p);
    return c && this.__cornerWalls(c).length === 2 ? c : null;
  }

  // 1st click: a wall. 2nd click: another wall → live preview with the radius
  // box. 3rd click (or Enter): build. A click on a corner dot first rounds that
  // corner straight away, as before.
  __clickFillet(raw) {
    if (this.filletWalls.length === 2) {
      return this.__buildFilletWalls(this.__filletStageGeom(this.cursor || raw));
    }
    const dot = !this.filletWalls.length && this.__filletCornerUnder(raw);
    if (dot) {
      if (this.filletMode === "fillet") return this.__fillet(raw); // as before
      return this.__buildFilletWalls(this.__filletCornerGeom(dot, this.filletRadiusCm));
    }
    const hit = this.__pointOnWall(raw, this.__tolCm(), true);
    if (!hit) return this.__hint("Click a wall — or a corner dot — to round a corner.", 2500);
    if (!this.filletWalls.length) {
      this.filletWalls = [{ wall: hit.wall, p: hit.p }];
      this.__hint("Now click the second wall.");
      return this.__redraw();
    }
    if (hit.wall === this.filletWalls[0].wall) return this.__hint("Click a different wall.", 2000);
    const first = this.filletWalls[0];
    const g = this.__filletWallsGeom(first.wall, hit.wall, first.p, hit.p, this.filletRadiusCm);
    if (!g.X) return this.__hint(g.reason, 3000); // parallel, curved …
    this.filletWalls.push({ wall: hit.wall, p: hit.p });
    this.__filletClick2 = raw.clone();
    this.__filletReason = null;
    this.box.reset();
    this.__hint(this.__filletStageHint());
    this.__redraw();
  }

  // A corner dot: its two walls, keeping their far ends.
  __filletCornerGeom(c, size) {
    const [w1, w2] = this.__cornerWalls(c);
    const o1 = w1.oppositeCorner(c);
    const o2 = w2.oppositeCorner(c);
    if (!o1 || !o2) return { ok: false, reason: "This corner can't be changed." };
    return this.__filletWallsGeom(w1, w2, o1.location, o2.location, size);
  }

  // Stage 2: typed size, else the mouse (the new corner shape passes where the
  // mouse is, once it has moved), else the size from the options.
  __filletStageGeom(cur) {
    const [a, b] = this.filletWalls;
    if (!a || !b) return null;
    const typed = this.box.typedCm();
    const moved = cur && this.__filletClick2 && cur.distanceTo(this.__filletClick2) > this.__tolCm(8);
    return this.__filletWallsGeom(a.wall, b.wall, a.p, b.p, (f) => {
      if (typed) return typed;
      if (moved) {
        const bis = f.u1.clone().add(f.u2).normalize();
        // how far the middle of the new shape sits from the corner, per type
        const m = cur.clone().sub(f.X).dot(bis);
        let s = null;
        if (m > 0) {
          if (f.mode === "fillet") {
            const k = 1 / Math.sin(f.h) - 1;
            if (k > 1e-6) s = m / k;
          } else if (f.mode === "chamfer") {
            s = m / Math.cos(f.h);
          } else if (f.mode === "rightangle") {
            s = m / (2 * Math.cos(f.h));
          } else {
            s = m;
          }
        }
        if (s) return f.maxR > 0 ? Math.min(s, f.maxR) : s;
      }
      return this.filletRadiusCm;
    });
  }

  // Arc tool: both ends on two different walls sharing a corner (not on the
  // corner itself) → the rounded corner through about those points.
  __cornerArcGeom(s, e) {
    const hs = this.__pointOnWall(s, 1.5);
    const he = this.__pointOnWall(e, 1.5);
    if (!hs || !he || hs.wall === he.wall) return null;
    const shared = [hs.wall.start, hs.wall.end].find((k) => k === he.wall.start || k === he.wall.end);
    if (!shared) return null;
    if (s.distanceTo(shared.location) < 1 || e.distanceTo(shared.location) < 1) return null;
    const typed = this.box.typedCm();
    return this.__filletWallsGeom(
      hs.wall,
      he.wall,
      s,
      e,
      (f) => typed || ((s.distanceTo(f.X) + e.distanceTo(f.X)) / 2) * Math.tan(f.h),
      "fillet"
    );
  }

  // The new corner between two straight walls (CAD fillet). p1 / p2 are
  // points on the part of each wall to keep. `radius` (the size) is cm or a
  // function of the frame { X, u1, u2, h, maxR, mode }. Walls that don't meet
  // are extended to where their lines cross. `mode`:
  //   fillet     — arc touching both walls (rounded corner)
  //   inner      — arc centred on the corner, cut into it
  //   rightangle — square notch: two walls parallel to the originals
  //   chamfer    — one straight wall across the corner
  // Returns { ok, … } or { ok: false, reason, … }.
  __filletWallsGeom(w1, w2, p1, p2, radius, mode = this.filletMode) {
    const bad = (reason, extra) => Object.assign({ ok: false, reason }, extra);
    if (!w1 || !w2 || w1 === w2) return bad("Click two different walls.");
    if (w1.wallType === WallTypes.CURVED || w2.wallType === WallTypes.CURVED) {
      return bad("Fillet works on straight walls only.");
    }
    const S1 = w1.start.location;
    const S2 = w2.start.location;
    const d1 = w1.end.location.clone().sub(S1);
    const d2 = w2.end.location.clone().sub(S2);
    const l1 = d1.length();
    const l2 = d2.length();
    if (l1 < 1e-6 || l2 < 1e-6) return bad("These walls can't be rounded.");
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) / (l1 * l2) < 0.02) return bad("These walls are parallel — they never meet.");
    const shared = [w1.start, w1.end].find((k) => k === w2.start || k === w2.end) || null;
    let X;
    if (shared) {
      X = shared.location.clone();
    } else {
      const t = ((S2.x - S1.x) * d2.y - (S2.y - S1.y) * d2.x) / cross;
      X = S1.clone().add(d1.clone().multiplyScalar(t));
    }
    // the end of each wall on the clicked side of X, and the way it runs from X
    const side = (w, d, len, p) => {
      const u = d.clone().divideScalar(len);
      const s = (q) => q.clone().sub(X).dot(u);
      const ss = s(w.start.location);
      const se = s(w.end.location);
      let sp = p ? s(p) : 0;
      if (Math.abs(sp) < 1) sp = Math.max(ss, se) >= -Math.min(ss, se) ? 1 : -1;
      if (sp > 0) return { K: ss >= se ? w.start : w.end, dist: Math.max(ss, se), u };
      return { K: ss <= se ? w.start : w.end, dist: -Math.min(ss, se), u: u.clone().negate() };
    };
    const A = side(w1, d1, l1, p1);
    const B = side(w2, d2, l2, p2);
    if (A.dist < 1 || B.dist < 1) return bad("Click the part of each wall you want to keep.", { X });
    const cos = clamp(A.u.dot(B.u), -1, 1);
    if (cos < -0.995) return bad("The walls are in a straight line — nothing to round.", { X });
    if (cos > 0.995) return bad("The walls fold back on each other.", { X });
    const h = Math.acos(cos) / 2;
    const kind = FILLET_MODES.includes(mode) ? mode : "fillet";
    const noun = FILLET_SIZE[kind];
    // each wall must keep a piece at least MIN_PIECE_CM long
    const reach = Math.min(A.dist, B.dist) - MIN_PIECE_CM;
    const maxR = kind === "fillet" ? reach * Math.tan(h) : reach;
    const frame = { X, u1: A.u, u2: B.u, h, maxR, mode: kind, K1: A.K, K2: B.K, w1, w2, shared };
    const r = typeof radius === "function" ? radius(frame) : radius;
    frame.r = r;
    if (!(r > 0)) return bad(`Type a ${noun} bigger than zero.`, frame);
    if (this.__hasOpenings(w1) || this.__hasOpenings(w2)) {
      return bad("One of these walls has a door or window. Move it first.", frame);
    }
    if (r > maxR + 1e-6) return bad(`${cap(noun)} too big for these walls — try a smaller ${noun}.`, frame);
    // how far from the corner each wall now ends
    const d = kind === "fillet" ? r / Math.tan(h) : r;
    if (shared && this.__cornerWalls(shared).length > 2 && d < MIN_PIECE_CM) {
      return bad(`${cap(noun)} too small at this corner — try a bigger ${noun}.`, frame);
    }
    const T1 = X.clone().add(A.u.clone().multiplyScalar(d));
    const T2 = X.clone().add(B.u.clone().multiplyScalar(d));
    let O = null;
    let a0 = 0;
    let sweep = 0;
    let path;
    let boxAt;
    if (kind === "chamfer") {
      if (T1.distanceTo(T2) < MIN_PIECE_CM) return bad("Length too small — try a bigger length.", frame);
      path = [T1.clone(), T2.clone()];
      boxAt = T1.clone().add(T2).multiplyScalar(0.5);
    } else if (kind === "rightangle") {
      if (d < MIN_PIECE_CM) return bad("Size too small — try a bigger size.", frame);
      // the notch's inner corner: each new wall runs parallel to the other wall
      const M = T1.clone().add(T2).sub(X);
      path = [T1.clone(), M, T2.clone()];
      boxAt = M.clone();
    } else {
      O =
        kind === "fillet"
          ? X.clone().add(A.u.clone().add(B.u).normalize().multiplyScalar(r / Math.sin(h)))
          : X.clone(); // inner fillet: centred on the corner
      a0 = Math.atan2(T1.y - O.y, T1.x - O.x);
      sweep = Math.atan2(T2.y - O.y, T2.x - O.x) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      const n = this.__pieces(
        Math.abs(sweep) * r,
        (k) => 2 * r * Math.sin(Math.abs(sweep) / (2 * k)),
        2,
        32
      );
      if (!n) return bad(`${cap(noun)} too small to curve smoothly — try a bigger ${noun}.`, frame);
      path = this.__arcPoints(O, r, a0, sweep, n);
      path[0] = T1.clone();
      path[path.length - 1] = T2.clone();
      boxAt = kind === "fillet" ? O.clone() : path[Math.floor(path.length / 2)].clone();
    }
    return Object.assign(frame, { ok: true, reason: null, T1, T2, O, a0, sweep, path, boxAt });
  }

  __buildFilletWalls(g, msg) {
    if (!g) return;
    if (!g.ok) return this.__hint(g.reason, 3000);
    const keep = (c) => ({ c, x: c.x, y: c.y });
    const k1 = keep(g.K1);
    const k2 = keep(g.K2);
    const fwd1 = g.w1.start === g.K1; // wall ran from the kept end to the corner
    const fwd2 = g.w2.start === g.K2;
    const th1 = g.w1.thickness;
    const th2 = g.w2.thickness;
    g.w1.remove();
    g.w2.remove();
    // a kept end with no other wall was dropped with its wall: put it back
    const alive = (k) => (k.c.__hasBeenRemoved ? this.fp.newCorner(k.x, k.y) : k.c);
    const K1 = alive(k1);
    const K2 = alive(k2);
    const t1 = this.fp.newCorner(g.T1.x, g.T1.y);
    const t2 = this.fp.newCorner(g.T2.x, g.T2.y);
    const wa = fwd1 ? this.__newWall(K1, t1) : this.__newWall(t1, K1);
    const wb = fwd2 ? this.__newWall(K2, t2) : this.__newWall(t2, K2);
    if (wa && th1) wa.thickness = th1;
    if (wb && th2) wb.thickness = th2;
    // the curve runs on in the first wall's direction
    const path = fwd1 ? g.path : g.path.slice().reverse();
    const before = this.fp.walls.length;
    this.__batch(() => this.__makeChain(path, false, false));
    this.fp.walls.slice(before).forEach((w) => {
      if (th1) w.thickness = th1;
    });
    this.points = [];
    this.box.reset();
    this.box.hide();
    this.__resetFillet();
    this.__commit(msg || FILLET_DONE[g.mode] || "Corner rounded.");
  }

  __drawFilletStage(g, z, cur) {
    const chosen = this.filletWalls;
    const hover = this.__pointOnWall(cur, this.__tolCm(), true);
    const pick = (w) => {
      g.lineStyle(10 / z, PICKED, 0.28);
      this.__drawWallShape(g, w);
      g.lineStyle(2.5 / z, PICKED, 0.95);
      this.__drawWallShape(g, w);
    };
    chosen.forEach((f) => pick(f.wall));
    let geom = null;
    if (chosen.length === 2) {
      geom = this.__filletStageGeom(cur);
    } else if (chosen.length === 1 && hover && hover.wall !== chosen[0].wall) {
      pick(hover.wall);
      geom = this.__filletWallsGeom(chosen[0].wall, hover.wall, chosen[0].p, hover.p, this.filletRadiusCm);
    } else if (!chosen.length && this.__filletCornerUnder(cur)) {
      // corner dot (Inner fillet / Inner right angle / Chamfer): its preview
      geom = this.__filletCornerGeom(this.__filletCornerUnder(cur), this.filletRadiusCm);
      const pc = this.__px(this.__filletCornerUnder(cur).location);
      g.lineStyle(2 / z, geom.ok ? HOVER : 0xb42318, 1);
      g.beginFill(geom.ok ? HOVER : 0xb42318, 0.25);
      g.drawCircle(pc.x, pc.y, 10 / z);
      g.endFill();
    } else if (!chosen.length && hover) {
      g.lineStyle(8 / z, PICKED, 0.2);
      this.__drawWallShape(g, hover.wall);
    }
    if (!geom) return;
    if (geom.ok) {
      // old walls dashed red; new straight parts and the arc solid
      g.lineStyle(2.5 / z, TRIM, 0.85);
      this.__dashed(g, geom.w1.start.location, geom.w1.end.location, 6);
      this.__dashed(g, geom.w2.start.location, geom.w2.end.location, 6);
      g.lineStyle(3 / z, SHAPE, 1);
      this.__line(g, geom.K1.location, geom.T1);
      this.__line(g, geom.K2.location, geom.T2);
      this.__polyline(g, geom.path);
      if (geom.O) {
        const mid = geom.path[Math.floor(geom.path.length / 2)];
        g.lineStyle(1.5 / z, HELP, 1);
        this.__dashed(g, geom.O, mid, 4);
      }
      g.lineStyle(2 / z, HELP, 1);
      [geom.T1, geom.T2].forEach((t) => {
        const pt = this.__px(t);
        g.drawCircle(pt.x, pt.y, 6 / z);
      });
    } else if (geom.X && chosen.length === 2) {
      g.lineStyle(2.5 / z, 0xb42318, 0.9);
      chosen.forEach((f) => this.__dashed(g, f.p, geom.X, 6));
    }
    if (chosen.length === 2) {
      this.box.showValue(geom.ok ? geom.boxAt : geom.X || cur, geom.r > 0 ? geom.r : 0);
      const reason = geom.ok ? null : geom.reason;
      if (reason !== this.__filletReason) {
        this.__filletReason = reason;
        this.__hint(reason || this.__filletStageHint());
      }
    }
  }

  __filletGeom(c) {
    if (!c) return { reason: "Click a corner where two walls meet." };
    const walls = this.__cornerWalls(c);
    if (walls.length !== 2) return { reason: "Fillet needs a corner with exactly two walls." };
    const [w1, w2] = walls;
    if (w1.wallType === WallTypes.CURVED || w2.wallType === WallTypes.CURVED) {
      return { reason: "Fillet works on straight walls only." };
    }
    const A = w1.oppositeCorner(c);
    const B = w2.oppositeCorner(c);
    if (!A || !B || A === B) return { reason: "This corner can't be rounded." };
    const C = c.location.clone();
    const lenA = A.location.distanceTo(C);
    const lenB = B.location.distanceTo(C);
    const u = A.location.clone().sub(C).normalize();
    const v = B.location.clone().sub(C).normalize();
    const cos = clamp(u.dot(v), -1, 1);
    if (cos < -0.995) return { reason: "The walls are in a straight line — nothing to round." };
    if (cos > 0.995) return { reason: "The walls fold back on each other." };
    const theta = Math.acos(cos);
    const r = this.filletRadiusCm;
    const d = r / Math.tan(theta / 2);
    // The rounded part must leave a piece of wall on each side, or its end
    // corners would weld onto the walls' far corners.
    if (d >= Math.min(lenA, lenB) - MIN_PIECE_CM) {
      return { reason: "Radius too big for these walls — try a smaller radius." };
    }
    if (this.__hasOpenings(w1) || this.__hasOpenings(w2)) {
      return { reason: "One of these walls has a door or window. Move it first." };
    }
    const T1 = C.clone().add(u.clone().multiplyScalar(d));
    const T2 = C.clone().add(v.clone().multiplyScalar(d));
    // Fillet circle: centre on the corner's bisector, touching both walls.
    const O = C.clone().add(
      u.clone().add(v).normalize().multiplyScalar(r / Math.sin(theta / 2))
    );
    const a1 = Math.atan2(T1.y - O.y, T1.x - O.x);
    const a2 = Math.atan2(T2.y - O.y, T2.x - O.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const n = this.__pieces(
      Math.abs(sweep) * r,
      (k) => 2 * r * Math.sin(Math.abs(sweep) / (2 * k)),
      2,
      32
    );
    if (!n) return { reason: "Radius too small to round smoothly — try a bigger radius." };
    const path = this.__arcPoints(O, r, a1, sweep, n);
    path[0] = T1.clone();
    path[path.length - 1] = T2.clone();
    return { ok: true, w1, w2, A, B, T1, T2, path };
  }

  __fillet(raw) {
    const c = this.__cornerAt(raw);
    const g = this.__filletGeom(c);
    if (!g.ok) return this.__hint(g.reason, 3000);
    const th1 = g.w1.thickness;
    const th2 = g.w2.thickness;
    g.w1.remove();
    g.w2.remove();
    c.remove();
    const t1 = this.fp.newCorner(g.T1.x, g.T1.y);
    const t2 = this.fp.newCorner(g.T2.x, g.T2.y);
    const wa = this.__newWall(g.A, t1);
    const wb = this.__newWall(t2, g.B);
    if (wa && th1) wa.thickness = th1;
    if (wb && th2) wb.thickness = th2;
    // the rounded part: short straight walls from T1 to T2
    const before = this.fp.walls.length;
    this.__batch(() => this.__makeChain(g.path, false, false));
    this.fp.walls.slice(before).forEach((w) => {
      if (th1) w.thickness = th1;
    });
    this.__commit("Corner rounded.");
  }

  __align(raw) {
    const wall = this.__wallAt(raw);
    if (!wall) return this.__hint("Click directly on a wall to straighten it.", 2500);
    if (wall.wallType === WallTypes.CURVED) return this.__hint("Align works on straight walls only.", 2500);
    const s = wall.start;
    const e = wall.end;
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (Math.abs(dy) < 0.5) return this.__hint("This wall is already straight.", 2000);
      const y = (s.y + e.y) / 2;
      s.move(s.x, y);
      e.move(e.x, y);
    } else {
      if (Math.abs(dx) < 0.5) return this.__hint("This wall is already straight.", 2000);
      const x = (s.x + e.x) / 2;
      s.move(x, s.y);
      e.move(x, e.y);
    }
    this.__commit("Wall straightened.");
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  // Build many pieces as ONE change. Every newCorner / newWall normally runs a
  // full floor-plan update — recalculating rooms, redrawing the whole 2D plan
  // and rebuilding every 3D wall — so a 60-piece circle meant hundreds of full
  // redraws and froze the page. Hold those while fn runs; the caller's
  // __commit then does the single update that redraws everything once.
  __batch(fn) {
    const fp = this.fp;
    const HELD = [EVENT_NEW, EVENT_UPDATED, EVENT_NEW_ROOMS_ADDED];
    const ownUpdate = Object.prototype.hasOwnProperty.call(fp, "update");
    const ownDispatch = Object.prototype.hasOwnProperty.call(fp, "dispatchEvent");
    const update = fp.update;
    const dispatch = fp.dispatchEvent;
    const restore = () => {
      if (ownUpdate) fp.update = update;
      else delete fp.update;
      if (ownDispatch) fp.dispatchEvent = dispatch;
      else delete fp.dispatchEvent;
    };
    fp.update = () => {};
    fp.dispatchEvent = function (evt) {
      if (evt && HELD.includes(evt.type)) return undefined;
      return dispatch.call(this, evt);
    };
    try {
      const out = fn();
      restore();
      return out;
    } catch (e) {
      restore();
      fp.update(); // keep the plan consistent after a failure
      throw e;
    }
  }

  __newWall(c1, c2, a, b) {
    if (!c1 || !c2 || c1 === c2) return null;
    return a && b ? this.fp.newWall(c1, c2, a.clone(), b.clone()) : this.fp.newWall(c1, c2);
  }

  __commit(msg) {
    this.fp.update();
    try {
      BlueprintInterface.snapshot2D && BlueprintInterface.snapshot2D();
    } catch (e) {
      /* undo history is best-effort */
    }
    if (msg) this.__hint(msg, 2200);
    this.__redraw();
  }

  __emit() {
    try {
      window.dispatchEvent(new CustomEvent("pazl:draw-tool", { detail: { tool: this.tool } }));
    } catch (e) {
      /* ignore */
    }
  }

  // Small hint over the canvas. A message with no timeout stays until the tool
  // changes; a timed one (results, refusals) then returns to the tool's hint.
  __hint(msg, ms) {
    if (typeof document === "undefined") return;
    if (!this.__hintEl) {
      const el = document.createElement("div");
      el.setAttribute("role", "status");
      Object.assign(el.style, {
        position: "fixed",
        zIndex: 1000,
        padding: "7px 12px",
        borderRadius: "8px",
        background: "rgba(20,24,51,0.88)",
        color: "#fff",
        font: "500 12.5px/1.35 system-ui, 'Segoe UI', sans-serif",
        maxWidth: "min(560px, 80vw)",
        textAlign: "center",
        pointerEvents: "none",
        transform: "translateX(-50%)",
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
      });
      document.body.appendChild(el);
      this.__hintEl = el;
    }
    clearTimeout(this.__hintTimer);
    if (!msg) {
      this.__hintEl.style.display = "none";
      return;
    }
    const r = this.viewer.view && this.viewer.view.getBoundingClientRect();
    if (r && r.width) {
      this.__hintEl.style.left = `${r.left + r.width / 2}px`;
      this.__hintEl.style.top = `${r.bottom - 64}px`;
    }
    this.__hintEl.textContent = msg;
    this.__hintEl.style.display = "block";
    if (ms) {
      this.__hintTimer = setTimeout(() => {
        if (this.tool) this.__hint(this.__hintFor(this.tool));
        else this.__hint(null);
      }, ms);
    }
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  __px(v) {
    return new Vector2(Dimensioning.cmToPixel(v.x), Dimensioning.cmToPixel(v.y));
  }

  __clearLabels() {
    this.__labels.forEach((t) => {
      if (t.parent) t.parent.removeChild(t);
      t.destroy();
    });
    this.__labels = [];
  }

  // Arc tool feedback: the wall under each clicked end stays lightly green; while
  // placing an end, the wall (or corner) the point will land on lights up with
  // a green ring and "On wall" — or "Not on a wall" when a wall is close but
  // the point would miss it.
  __drawArcTargets(g, z, cur) {
    const GREEN = 0x12b886;
    this.points.forEach((p) => {
      const hit = this.__pointOnWall(p, 0.5);
      if (!hit) return;
      g.lineStyle(8 / z, GREEN, 0.22);
      this.__drawWallShape(g, hit.wall);
    });
    if (!cur || this.points.length >= 2) return; // 3rd step only shapes the curve
    const tag = cur.clone().add(new Vector2(this.__tolCm(10), -this.__tolCm(20)));
    if (this.__snapKind === "wall" && this.__snapWall) {
      g.lineStyle(10 / z, GREEN, 0.3);
      this.__drawWallShape(g, this.__snapWall);
      g.lineStyle(2.5 / z, GREEN, 1);
      const pc = this.__px(cur);
      g.drawCircle(pc.x, pc.y, 8 / z);
      this.__label("On wall", tag, 0, 0x0b7a55);
    } else if (this.__snapKind === "corner") {
      g.lineStyle(2.5 / z, GREEN, 1);
      const pc = this.__px(cur);
      g.drawCircle(pc.x, pc.y, 10 / z);
      this.__label("On corner", tag, 0, 0x0b7a55);
    } else if (this.__pointOnWall(cur, this.__tolCm(36), true)) {
      this.__label("Not on a wall", tag, 0, 0x8a8f9c);
    }
  }

  __label(text, at, rotation = 0, fill = 0x1f2433) {
    const t = new Text(text, {
      fontFamily: "Arial",
      fontSize: 13,
      fill,
      stroke: 0xffffff,
      strokeThickness: 4,
    });
    t.resolution = 2;
    t.anchor && t.anchor.set(0.5);
    const z = this.__zoom();
    t.scale.set(1 / z);
    const p = this.__px(at);
    t.position.set(p.x, p.y);
    t.rotation = rotation;
    this.preview.addChild(t);
    this.__labels.push(t);
  }

  __len(cm) {
    try {
      return Dimensioning.cmToMeasure(cm);
    } catch (e) {
      return `${Math.round(cm)} cm`;
    }
  }

  __line(g, a, b) {
    const pa = this.__px(a);
    const pb = this.__px(b);
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
  }

  __dashed(g, a, b, dashPx) {
    const pa = this.__px(a);
    const pb = this.__px(b);
    const len = pa.distanceTo(pb);
    if (len < 1e-3) return;
    const z = this.__zoom();
    const dash = (dashPx || 8) / z;
    const dir = pb.clone().sub(pa).divideScalar(len);
    for (let s = 0; s < len; s += dash * 2) {
      const e = Math.min(len, s + dash);
      g.moveTo(pa.x + dir.x * s, pa.y + dir.y * s);
      g.lineTo(pa.x + dir.x * e, pa.y + dir.y * e);
    }
  }

  __polyline(g, pts) {
    if (!pts || pts.length < 2) return;
    const p0 = this.__px(pts[0]);
    g.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = this.__px(pts[i]);
      g.lineTo(p.x, p.y);
    }
  }

  __bezier(g, p0, c1, c2, p1) {
    const a = this.__px(p0);
    const b = this.__px(c1);
    const c = this.__px(c2);
    const d = this.__px(p1);
    g.moveTo(a.x, a.y);
    g.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
  }

  __drawWallShape(g, wall) {
    if (wall.wallType === WallTypes.CURVED && wall.bezier) {
      const pts = wall.bezier.points;
      this.__bezier(g, V(pts[0]), V(pts[1]), V(pts[2]), V(pts[3]));
    } else {
      this.__line(g, wall.start.location, wall.end.location);
    }
  }

  __drawGuides() {
    const g = this.guideLayer;
    g.clear();
    if (!this.guides.length) return;
    const z = this.__zoom();
    g.lineStyle(1.5 / z, GUIDE, 0.9);
    this.guides.forEach(({ a, b }) => {
      const dir = b.clone().sub(a).normalize();
      const far = 100000; // a guide is an endless line
      this.__dashed(g, a.clone().sub(dir.clone().multiplyScalar(far)), a.clone().add(dir.clone().multiplyScalar(far)), 10);
    });
  }

  __redraw() {
    const g = this.preview;
    g.clear();
    this.__clearLabels();
    if (this.box && !this.__boxStage()) this.box.hide();
    if (!this.tool) return;
    const z = this.__zoom();
    const lw = 2 / z;
    const pts = this.points;
    const cur = this.cursor;

    if (["split", "merge", "fillet", "align", "trim"].includes(this.tool) && cur) {
      if (this.tool === "trim") {
        const tg = this.__trimGeom(cur);
        if (tg.A && tg.B) {
          g.lineStyle(7 / z, tg.ok ? TRIM : 0xb42318, tg.ok ? 0.9 : 0.35);
          this.__line(g, tg.A, tg.B);
          // the cut points on this wall
          g.lineStyle(0);
          g.beginFill(0x1f2433, 1);
          (tg.cuts || []).forEach((c) => {
            const pc = this.__px(c);
            g.drawCircle(pc.x, pc.y, 3.5 / z);
          });
          g.endFill();
        } else if (tg.wall) {
          g.lineStyle(6 / z, 0xb42318, 0.35);
          this.__drawWallShape(g, tg.wall);
        }
      } else if (this.tool === "split" || this.tool === "align") {
        const wall = this.__wallAt(cur);
        if (wall) {
          g.lineStyle(6 / z, HOVER, 0.85);
          this.__drawWallShape(g, wall);
          if (this.tool === "split" && wall.wallType !== WallTypes.CURVED) {
            const s = wall.start.location;
            const d = wall.end.location.clone().sub(s);
            const t = clamp(cur.clone().sub(s).dot(d) / d.lengthSq(), 0, 1);
            const m = s.clone().add(d.multiplyScalar(t));
            g.lineStyle(0);
            g.beginFill(HOVER, 1);
            const pm = this.__px(m);
            g.drawCircle(pm.x, pm.y, 6 / z);
            g.endFill();
          }
        }
      } else if (
        this.tool === "fillet" &&
        (this.filletWalls.length || this.filletMode !== "fillet" || !this.__filletCornerUnder(cur))
      ) {
        this.__drawFilletStage(g, z, cur);
      } else {
        const c = this.__cornerAt(cur);
        if (c) {
          const geom = this.tool === "merge" ? this.__mergeGeom(c) : this.__filletGeom(c);
          const pc = this.__px(c.location);
          g.lineStyle(2 / z, geom.ok ? HOVER : 0xb42318, 1);
          g.beginFill(geom.ok ? HOVER : 0xb42318, 0.25);
          g.drawCircle(pc.x, pc.y, 10 / z);
          g.endFill();
          if (geom.ok && this.tool === "fillet") {
            g.lineStyle(3 / z, ACCENT, 0.95);
            this.__polyline(g, geom.path);
          }
        }
      }
      return;
    }

    g.lineStyle(lw, ACCENT, 1);
    switch (this.tool) {
      case "rectangle": {
        const rg = pts[0] && cur ? this.__rectGeom(cur) : null;
        if (!rg) break;
        const px = (n) => this.__tolCm(n); // screen px → cm
        const x1 = Math.min(rg.a.x, rg.q.x);
        const x2 = Math.max(rg.a.x, rg.q.x);
        const y1 = Math.min(rg.a.y, rg.q.y);
        const y2 = Math.max(rg.a.y, rg.q.y);
        const c4 = [new Vector2(x1, y1), new Vector2(x2, y1), new Vector2(x2, y2), new Vector2(x1, y2)];
        g.lineStyle(1.5 / z, SHAPE, 1);
        this.__polyline(g, [...c4, c4[0]]);
        // green ring on the corner being placed
        g.lineStyle(2 / z, HELP, 1);
        const pq = this.__px(rg.q);
        g.drawCircle(pq.x, pq.y, 6 / z);
        // width along the top edge, height up the left edge; the box sits on
        // whichever one is being typed (Tab switches)
        const top = new Vector2((x1 + x2) / 2, y1 + px(18));
        const left = new Vector2(x1 + px(16), (y1 + y2) / 2);
        if (this.rectField === "w") {
          this.box.showValue(top, rg.w);
          this.__label(this.box.format(rg.h), left, -Math.PI / 2);
        } else {
          this.box.showValue(new Vector2(x1 + px(52), (y1 + y2) / 2), rg.h);
          this.__label(this.box.format(rg.w), top);
        }
        break;
      }
      case "circle": {
        const cg = pts[0] && cur ? this.__circleGeom(cur) : null;
        if (!cg) break;
        const px = (p) => this.__tolCm(p); // screen px → cm
        const ring = cg.r > 0 ? this.__circlePoints(cg.c, cg.r) : null;
        if (this.circleMode === "corner") {
          // green diagonal from the first corner to the opposite one
          g.lineStyle(1.5 / z, HELP, 1);
          this.__line(g, cg.a, cg.q);
          // size line up the left side, with end ticks and a vertical label
          const x = Math.min(cg.a.x, cg.q.x) - px(14);
          const y1 = Math.min(cg.a.y, cg.q.y);
          const y2 = Math.max(cg.a.y, cg.q.y);
          g.lineStyle(1 / z, SHAPE, 0.9);
          this.__line(g, new Vector2(x, y1), new Vector2(x, y2));
          this.__line(g, new Vector2(x - px(4), y1), new Vector2(x + px(4), y1));
          this.__line(g, new Vector2(x - px(4), y2), new Vector2(x + px(4), y2));
          this.__label(this.box.format(cg.value), new Vector2(x - px(12), (y1 + y2) / 2), -Math.PI / 2);
          // green ring at the opposite corner
          g.lineStyle(2 / z, HELP, 1);
          const pq = this.__px(cg.q);
          g.drawCircle(pq.x, pq.y, 6 / z);
          this.box.showValue(new Vector2(cg.c.x, y2 + px(22)), cg.value);
        } else {
          g.lineStyle(1.5 / z, HELP, 1);
          this.__dashed(g, cg.c, cg.edge);
          const pe = this.__px(cg.edge);
          g.lineStyle(2 / z, HELP, 1);
          g.drawCircle(pe.x, pe.y, 6 / z);
          this.box.showValue(cg.c.clone().add(cg.edge).multiplyScalar(0.5), cg.value);
        }
        // the exact pieces that will be built
        g.lineStyle(1.5 / z, SHAPE, 1);
        if (ring) this.__polyline(g, [...ring, ring[0]]);
        break;
      }
      case "arc":
        if (pts.length === 1 && cur) {
          g.lineStyle(1.5 / z, SHAPE, 1);
          this.__line(g, pts[0], cur);
          this.__label(this.__len(pts[0].distanceTo(cur)), pts[0].clone().add(cur).multiplyScalar(0.5));
        } else if (pts.length === 2) {
          const ag = this.__arcGeom(cur || pts[1]);
          // dashed start–end line
          g.lineStyle(1.2 / z, SHAPE, 0.8);
          this.__dashed(g, pts[0], pts[1], 5);
          if (ag && !ag.invalid && ag.arc) {
            const { o, r, a0, sweep } = ag.arc;
            // lines from the circle's centre to both ends (the slice)
            g.lineStyle(1 / z, SHAPE, 0.7);
            this.__line(g, o, ag.s);
            this.__line(g, o, ag.e);
            // the angle, just outside the middle of the arc
            const am = a0 + sweep / 2;
            const out = new Vector2(Math.cos(am), Math.sin(am));
            const lp = o.clone().add(out.clone().multiplyScalar(r + this.__tolCm(24)));
            this.__label(`${((Math.abs(sweep) * 180) / Math.PI).toFixed(1)}°`, lp);
          }
          if (ag && this.arcMode === "chord" && ag.m) {
            g.lineStyle(1.5 / z, HELP, 1);
            this.__dashed(g, ag.mid, ag.m, 5);
          }
          // corner mode: the square corner that will be removed
          if (ag && ag.corner && ag.corner.X) {
            g.lineStyle(2.5 / z, TRIM, 0.9);
            this.__dashed(g, ag.corner.T1 || ag.s, ag.corner.X, 6);
            this.__dashed(g, ag.corner.X, ag.corner.T2 || ag.e, 6);
          }
          // the arc itself (the exact pieces that will be built)
          g.lineStyle(1.5 / z, SHAPE, 1);
          if (ag && ag.path && !ag.invalid) this.__polyline(g, ag.path);
          if (ag) this.box.showValue(ag.mid, ag.value);
        }
        break;
      case "guides":
        if (pts[0] && cur) {
          g.lineStyle(1.5 / z, GUIDE, 0.9);
          this.__dashed(g, pts[0], cur, 10);
        }
        break;
      default:
        break;
    }

    // Arc: which wall each point lands on
    if (this.tool === "arc") this.__drawArcTargets(g, z, cur);

    // green alignment guide to the corner the cursor lines up with
    if (this.__alignSnap && cur) {
      g.lineStyle(1.2 / z, HELP, 0.9);
      if (this.__alignSnap.ay) this.__line(g, cur, new Vector2(this.__alignSnap.ay.x, cur.y));
      if (this.__alignSnap.ax) this.__line(g, cur, new Vector2(cur.x, this.__alignSnap.ax.y));
    }

    // clicked points + cursor
    g.lineStyle(0);
    g.beginFill(ACCENT, 0.9);
    pts.forEach((p) => {
      const pp = this.__px(p);
      g.drawCircle(pp.x, pp.y, 5 / z);
    });
    g.endFill();
    if (cur) {
      const pc = this.__px(cur);
      g.beginFill(ACCENT, 0.35);
      g.drawCircle(pc.x, pc.y, 8 / z);
      g.endFill();
    }
  }
}
