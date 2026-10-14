import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BlueprintInterface from "@pazl/blueprint-interface";
import { TexturesService } from "@pazl/services/texturesService";
import { HISTORY_TITLES } from "@pazl/services/ProjectManager";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import {
  addRegion,
  archPoints,
  boundsOf,
  cleanRegions,
  curvePoints,
  faceOfEdge,
  frameParts,
  fullFaceRegion,
  makeRegion,
  newRegionId,
  offsetPolygon,
  ovalPoints,
  pointInPolygon,
  rectPoints,
  regionBounds,
  regionParts,
  regionsToSave,
  simplifyLine,
  splitRegion,
  splitRegionDouble,
  topRegionAt,
} from "@pazl/main/model/wallRegions";
import { Icon } from "./icons";
import { parseDxf } from "./dxf";
import Preview3D from "./Preview3D";
import "./index.css";

/**
 * THE WALL EDITOR — one wall face, drawn flat, divided into areas.
 *
 * A wall side has one material for the whole of it. Here areas are marked out
 * on it — rectangles, polygons, circles, curves, freehand shapes, or an area
 * cut in two by a line — and each is given a material of its own, optionally
 * standing out from the wall. Strips of light and moldings are areas too.
 *
 * Areas are a stack: a shape sits on top of whatever it was drawn over, and
 * one with no material is see-through. The wall itself is underneath them
 * all, and clicking where there is no area means "the whole wall".
 *
 * Everything is in real sizes. The wall is drawn to scale, and every figure
 * shown or typed is millimetres, the unit the rest of the designer uses.
 *
 * NOTHING ON THE WALL CHANGES UNTIL SAVE. The page works on its own copy of
 * the areas, so Undo, Redo, Clear and simply closing are all safe; Save is the
 * one moment the 3D wall and the floor plan are written.
 */

type Pt = [number, number];
type Region = {
  id: string;
  kind: string;
  points?: Pt[];
  parts?: Pt[][];
  texture: any | null;
  extrusion: number;
  light?: boolean;
  arcHeight?: number;
  arch?: Arch;
};
/** The numbers an arch is drawn from, in cm (see archPoints). */
type Arch = {
  cx: number;
  y: number;
  span: number;
  rise: number;
  leg: number;
  thickness: number;
};
type Tool =
  | "select"
  | "line"
  | "double"
  | "curve"
  | "rect"
  | "polygon"
  | "freepoly"
  | "circle"
  | "oval"
  | "free"
  | "offset"
  | "measure"
  | "guide"
  | "pave"
  | "molding"
  | "range"
  | "arch";

interface WallEditorModalProps {
  /** The wall side that was clicked in 3D (a HalfEdge). */
  edge: any;
  onClose: () => void;
  /** Open the editor on another side of the same wall instead. */
  onSwitchEdge?: (edge: any) => void;
}

/** A drag or click shorter than this (cm) is a slip, not a shape. */
const MIN_DRAW_CM = 2;
/** Two polygon corners closer than this (cm) are one corner clicked twice. */
const SAME_CORNER_CM = 0.6;
/** Width (px) of the strip the 3D preview and the Selected area card take. */
const RIGHT_PANEL_PX = 300;
/** How many points along a drawn line are looked at to find the areas it
 * passes through. Enough that a strip a few centimetres wide is not missed. */
const LINE_SAMPLES = 240;
/** A line this close to level or upright (degrees) is taken to be meant so. */
const NEARLY_STRAIGHT_DEG = 2.5;
/** Shapes the Light strip switch can turn into a strip of light. */
const LIGHTABLE = new Set([
  "rect",
  "polygon",
  "circle",
  "oval",
  "curve",
  "free",
]);
/** A regular polygon centred on c with one corner at v. */
const regularPoints = (c: Pt, v: Pt, n: number): Pt[] => {
  const radius = dist(c, v);
  const start = Math.atan2(v[1] - c[1], v[0] - c[0]);
  const count = Math.max(3, Math.round(n));
  const out: Pt[] = [];
  for (let k = 0; k < count; k++) {
    const t = start + (k / count) * Math.PI * 2;
    out.push([c[0] + Math.cos(t) * radius, c[1] + Math.sin(t) * radius]);
  }
  return out;
};
/** Swatches per page of the library. */
const PAGE_SIZE = 20;
/** Where saved layouts are kept, per browser. */
const TEMPLATES_KEY = "pazl-wall-templates";
/** Remembered between openings; a convenience, never relied on. */
const GRID_KEY = "pazl-wall-editor-grid";
/** How many materials a search by picture compares against. */
const PICTURE_SEARCH_LIMIT = 400;

const mm = (cm: number) => Math.round(cm * 10);
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const NO_DRAFT = { pts: [] as Pt[], cur: null as Pt | null, drag: false };

const readJson = (key: string, fallback: any) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};
const writeJson = (key: string, value: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage is full or blocked: the page carries on without it */
  }
};

/** The average colour of a picture — what a search by picture compares. */
const averageColour = (src: string): Promise<number[] | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 8;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
        }
        const n = d.length / 4;
        resolve([r / n, g / n, b / n]);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** The toolbar's drop-down tools, and what each is called. */
const LINE_TOOLS: [Tool, string, string][] = [
  ["line", "straight line", "L"],
  ["double", "Double line", "Shift+L"],
  ["curve", "Curve", ""],
  // The same tool as the Free line button further along the toolbar, listed
  // here too because this is where someone looking for a way to draw a line
  // by hand looks first.
  ["free", "Free hand", ""],
  // An arched band with exact sizes — what Curve and Free hand cannot give.
  ["arch", "Arch", "A"],
];
const RECT_TOOLS: [Tool, string, string][] = [
  ["rect", "Rectangle", "R"],
  // Polygon is a REGULAR polygon, as in the reference: every side the same.
  ["polygon", "Polygon", "G"],
  // Corner by corner — the only way to an uneven shape with straight sides,
  // so it stays, under its own name.
  ["freepoly", "Free polygon", ""],
];
const CIRCLE_TOOLS: [Tool, string, string][] = [
  ["circle", "Circle", "C"],
  ["oval", "Oval", "Ctrl+E"],
];
const BRUSH_TOOLS: [Tool, string, string][] = [
  ["pave", "Paving brush", "M"],
  ["molding", "Molding brush", "N"],
];
const SHOW_OPTIONS: [string, string][] = [
  ["lineLength", "Line length"],
  ["lineSpacing", "Line spacing"],
  ["arcHeight", "Arc Height"],
  ["extrusion", "Extrusion"],
  ["startingPoint", "Starting point"],
  ["modelDim", "Model dimension line"],
  ["wallModel", "Wall model"],
];
const HINTS: Record<Tool, string> = {
  select: "Click an area to select it. Drag it to move it.",
  line: "Click two points. The line cuts every area it passes through.",
  double: "Click two points. Two parallel lines cut a strip out of every area they pass through.",
  curve: "Click the two ends, then click again to set how far the arc rises.",
  rect: "Drag to draw a rectangle.",
  polygon: "Press at the centre and drag outwards. Set the number of sides above.",
  freepoly: "Click each corner. Double-click, or click the first corner, to close.",
  circle: "Drag from the centre outwards.",
  oval: "Drag to draw an oval.",
  free: "Hold and draw a shape freehand; it closes when you let go.",
  offset: "Click an area to add a copy of its outline moved in by the distance.",
  measure: "Click two points to measure between them.",
  guide: "Click to place a guide; hold Shift for the other direction. Drag a guide to move it, or off the wall to remove it.",
  pave: "Choose a material, then click each area to pave it.",
  molding: "Choose a material, then click an area to frame it with a molding.",
  range: "Drag round the areas to save as a template.",
  arch: "Click the left foot, then the right foot, then click again at the height of the top of the opening.",
};
const familyOf = (tool: Tool) =>
  LINE_TOOLS.some((t) => t[0] === tool)
    ? "line"
    : RECT_TOOLS.some((t) => t[0] === tool)
    ? "rect"
    : CIRCLE_TOOLS.some((t) => t[0] === tool)
    ? "circle"
    : BRUSH_TOOLS.some((t) => t[0] === tool)
    ? "brush"
    : "";

/**
 * A NUMBER BOX YOU CAN ACTUALLY TYPE IN.
 *
 * The boxes here showed the stored number directly, and an empty box was
 * read as that number's minimum — so deleting the "0" in Extrusion put the 0
 * straight back, and the only way to enter 120 was to type it after the 0.
 *
 * The box now keeps its own text. It can be emptied; the value changes only
 * when what is typed is a number, and when the box is left it goes back to
 * showing whatever the value really is.
 */
const NumBox: React.FC<{
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  onValue: (n: number) => void;
  onStart?: () => void;
  onDone?: () => void;
}> = ({ value, min = 0, max, disabled, placeholder, onValue, onStart, onDone }) => {
  const [text, setText] = useState(String(value));
  const [typing, setTyping] = useState(false);
  // Follows the real value whenever the box is not being typed in — a
  // different area selected, an undo, a value clamped elsewhere.
  useEffect(() => {
    if (!typing) setText(String(value));
  }, [value, typing]);
  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setTyping(true);
        e.target.select();
        onStart?.();
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() === "" || !isFinite(Number(next))) return;
        const n = Math.max(min, Number(next));
        onValue(max === undefined ? n : Math.min(max, n));
      }}
      onBlur={() => {
        setTyping(false);
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
};

const WallEditorModal: React.FC<WallEditorModalProps> = ({
  edge,
  onClose,
  onSwitchEdge,
}) => {
  // The face is measured once, when the page opens: its size and openings do
  // not change while the editor is in front of the 3D view.
  const face = useMemo(() => faceOfEdge(edge), [edge]);
  const W = face?.width || 0;
  const H = face?.height || 0;
  const mirrored = !!face?.mirrored;

  const initial = useMemo<Region[]>(
    () => (face ? (cleanRegions(edge.getRegions(), W, H) as Region[]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [face]
  );
  const [regions, setRegions] = useState<Region[]>(initial);
  const [past, setPast] = useState<Region[][]>([]);
  const [future, setFuture] = useState<Region[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setToolRaw] = useState<Tool>("select");
  const [lastOf, setLastOf] = useState<Record<string, Tool>>({
    line: "line",
    rect: "rect",
    circle: "circle",
    brush: "pave",
  });
  const [draft, setDraft] = useState(NO_DRAFT);
  const [menu, setMenu] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // What a tool is set to. Typed in millimetres.
  // Off to begin with: a line goes where it is drawn. On, it was the reason
  // a diagonal seemed impossible to draw.
  const [ortho, setOrtho] = useState(false);
  const [spacing, setSpacing] = useState(100);
  const [lightWidth, setLightWidth] = useState(20);
  // Polygon: how many sides. Light strip: draw a shape's outline as light
  // instead of filling it.
  const [polySides, setPolySides] = useState(6);
  const [lightStrip, setLightStrip] = useState(false);
  // What the pointer would snap to, shown while drawing ("End Point").
  const [hover, setHover] = useState<{ pt: Pt; kind: string } | null>(null);
  const [offsetBy, setOffsetBy] = useState(50);
  const [moldingWidth, setMoldingWidth] = useState(50);
  const [archThickness, setArchThickness] = useState(100);
  const [splitAt, setSplitAt] = useState("");
  const [splitAxis, setSplitAxis] = useState<"h" | "v">("h");

  const [show, setShow] = useState<Record<string, boolean>>({
    lineLength: true,
    lineSpacing: true,
    arcHeight: true,
    extrusion: true,
    startingPoint: false,
    modelDim: false,
    // On, unlike the reference: a wall drawn without its doors invites areas
    // set out straight across one.
    wallModel: true,
  });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({
    v: [],
    h: [],
  });
  const [guidesHidden, setGuidesHidden] = useState(false);
  // Which way the next guide runs, where the pointer would put it, and a
  // guide being dragged.
  const [guideAxis, setGuideAxis] = useState<"h" | "v">("h");
  const [guideAt, setGuideAt] = useState<{ axis: "h" | "v"; at: number } | null>(
    null
  );
  const [guideDrag, setGuideDrag] = useState<{
    axis: "h" | "v";
    index: number;
  } | null>(null);
  const [grid, setGridRaw] = useState<any>(() => ({
    show: false,
    w: 330,
    h: 330,
    ax: 0.5,
    ay: 0.5,
    align: "justified",
    ...readJson(GRID_KEY, {}),
  }));
  const setGrid = (patch: any) =>
    setGridRaw((g: any) => {
      const next = { ...g, ...patch };
      writeJson(GRID_KEY, next);
      return next;
    });
  const [measures, setMeasures] = useState<{ a: Pt; b: Pt }[]>([]);

  // The view: how far in, and which point of the wall is at the centre.
  const [view, setView] = useState({ scale: 1, cx: W / 2, cy: H / 2 });
  const [box, setBox] = useState({ w: 1000, h: 600 });
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [moving, setMoving] = useState<{
    id: string;
    from: Pt;
    before: Region[];
  } | null>(null);

  // The library.
  const [finishings, setFinishings] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [libraryTab, setLibraryTab] = useState<"public" | "mine">("public");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [brush, setBrush] = useState<any>(null);
  const [rank, setRank] = useState<Map<string, number> | null>(null);
  const [ranking, setRanking] = useState(false);
  const [templates, setTemplates] = useState<any[]>(() =>
    readJson(TEMPLATES_KEY, [])
  );
  const [previewOpen, setPreviewOpen] = useState(true);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cadRef = useRef<HTMLInputElement | null>(null);
  const pictureRef = useRef<HTMLInputElement | null>(null);
  /** The areas as they were when a number box was entered. */
  const typingFrom = useRef<Region[] | null>(null);

  // Something to save: a change in the history, or one being typed right now
  // (the Extrusion box only joins the history when it is left).
  const dirty = past.length > 0 || regions !== initial;
  const selected = regions.find((r) => r.id === selectedId) || null;

  const setTool = (next: Tool) => {
    setToolRaw(next);
    setDraft(NO_DRAFT);
    setMenu(null);
    if (next !== "measure") setMeasures([]);
    const family = familyOf(next);
    if (family) setLastOf((l) => ({ ...l, [family]: next }));
  };

  // The same wall materials the Wall Properties panel offers, from the lists
  // the editor already keeps — nothing is fetched and nothing is hardcoded.
  useEffect(() => {
    const cats = TexturesService.getFinishingCategoriesFromLocalStorage() || [];
    const all = TexturesService.getFinishingsFromLocalStorage() || [];
    const walls = all.filter(
      (f: any) => f && f.type === "wall" && f.texture?.fileUrl
    );
    const usedCats = new Set(walls.map((f: any) => String(f.categoryId)));
    setFinishings(walls);
    setCategories(cats.filter((c: any) => usedCats.has(String(c._id))));
  }, []);

  // The drawing area's size on screen, kept current as the window changes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () =>
      setBox({ w: el.clientWidth || 1000, h: el.clientHeight || 600 });
    measure();
    const RO = (window as any).ResizeObserver;
    if (!RO) {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [libraryOpen, tool]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = finishings.filter((f: any) => {
      if (categoryId && String(f.categoryId) !== categoryId) return false;
      if (!needle) return true;
      return `${f.name || ""} ${f.decorCode || ""}`
        .toLowerCase()
        .includes(needle);
    });
    if (!rank) return list;
    // Closest colour first; anything the search did not reach goes last.
    return list
      .slice()
      .sort(
        (a: any, b: any) =>
          (rank.get(String(a._id)) ?? 1e9) - (rank.get(String(b._id)) ?? 1e9)
      );
  }, [finishings, categoryId, query, rank]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageNow = clamp(page, 1, pages);
  useEffect(() => setPage(1), [categoryId, query, rank]);

  // ── history ─────────────────────────────────────────────────────────────

  /** Every change goes through here, so every change can be undone. */
  const commit = (next: Region[], before: Region[] = regions) => {
    setPast((p) => p.concat([before]));
    setFuture([]);
    setRegions(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [regions].concat(f));
    setRegions(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => p.concat([regions]));
    setRegions(future[0]);
    setFuture((f) => f.slice(1));
  };
  const clearAll = () => {
    if (!regions.length) return;
    if (!window.confirm("Remove every area and material from this wall face?"))
      return;
    setSelectedId(null);
    commit([]);
  };

  /**
   * The area a line or a material is meant for, and the list it sits in.
   *
   * When that is an area, it is simply the area. When it is bare wall, the
   * wall becomes an area first — one covering the whole face, put at the
   * BOTTOM of the stack so everything already drawn stays on top of it.
   */
  const targetAt = (id: string | null) => {
    const found = id ? regions.find((r) => r.id === id) : null;
    if (found) return { list: regions, target: found };
    const whole = fullFaceRegion(W, H) as Region;
    return { list: [whole].concat(regions), target: whole };
  };

  const packOf = (finishing: any) => ({
    color: "#FFFFFF",
    name: finishing.name,
    colormap: finishing.texture.fileUrl,
    finishingId: finishing._id,
  });

  const pave = (id: string | null, finishing: any) => {
    const { list, target } = targetAt(id);
    setSelectedId(target.id);
    commit(
      list.map((r) =>
        r.id === target.id
          ? { ...r, texture: packOf(finishing), light: false }
          : r
      )
    );
  };

  /** A swatch was clicked. */
  const chooseMaterial = (finishing: any) => {
    setBrush(finishing);
    // An area is selected — typically the shape just drawn — so this is the
    // material for it, whichever drawing tool is still in hand. Only the two
    // brushes differ: there a swatch is the brush's material, and it goes on
    // whatever is clicked next. With nothing selected the material is picked
    // up the same way, ready to be put on an area.
    const brushing = tool === "pave" || tool === "molding";
    if (selected && !brushing) pave(selected.id, finishing);
    else if (tool !== "molding") setTool("pave");
  };

  const patchSelected = (patch: Partial<Region>) => {
    if (!selected) return;
    commit(regions.map((r) => (r.id === selected.id ? { ...r, ...patch } : r)));
  };
  /**
   * Typing in a number box (Extrusion, an arch's sizes). The drawing and the
   * 3D preview follow every digit, but typing "120" is ONE change: the areas
   * as they were when the box was entered are what Undo goes back to.
   */
  const beginTyping = () => {
    typingFrom.current = regions;
  };
  const endTyping = () => {
    const before = typingFrom.current;
    typingFrom.current = null;
    if (!before || before === regions) return;
    if (JSON.stringify(before) === JSON.stringify(regions)) {
      setRegions(before);
      return;
    }
    setPast((p) => p.concat([before]));
    setFuture([]);
  };

  /**
   * The arch the pointer is describing: its feet where the first two clicks
   * were, its top at the pointer's height. Up to half the span that height is
   * all curve — a semicircle at most — and anything above that is straight
   * leg, which is how a tall arched opening is actually built.
   */
  const archFrom = (a: Pt, b: Pt, top: number): Arch => {
    const span = Math.abs(b[0] - a[0]);
    const height = Math.max(top - a[1], 0);
    const rise = Math.min(height, span / 2);
    return {
      cx: (a[0] + b[0]) / 2,
      y: a[1],
      span,
      rise,
      leg: height - rise,
      thickness: archThickness / 10,
    };
  };

  /** Change one of the selected arch's sizes; it is simply drawn again. */
  const setArch = (patch: Partial<Arch>) =>
    setRegions((list) =>
      list.map((r) => {
        if (r.id !== selectedId || !r.arch) return r;
        const arch = { ...r.arch, ...patch };
        // A head cannot rise more than a semicircle on its span.
        arch.rise = Math.min(arch.rise, arch.span / 2);
        const points = archPoints(arch) as Pt[];
        if (points.length < 3) return r;
        const cleaned = cleanRegions([{ ...r, arch, points }], W, H)[0];
        return (cleaned as Region) || r;
      })
    );

  const deleteArea = () => {
    if (!selected) return;
    commit(regions.filter((r) => r.id !== selected.id));
    setSelectedId(null);
  };

  /** Put a new shape on top of the stack and select it. */
  const place = (kind: string, points: Pt[], extra?: any) => {
    let region: any = makeRegion(kind, points, extra);
    // LIGHT STRIP: the same shape, but as a band of light along its outline
    // — a cove light round a panel, a ring of LED round a mirror — instead
    // of a filled area.
    if (lightStrip && LIGHTABLE.has(kind)) {
      const parts = frameParts(points, lightWidth / 10) as Pt[][];
      if (!parts.length) {
        alert("That shape is too small for a light strip of this width.");
        return false;
      }
      region = { ...region, parts, light: true, texture: null };
      delete region.points;
    }
    const made = addRegion(regions, region, W, H);
    if (!made.id) return false;
    commit(made.regions as Region[]);
    setSelectedId(made.id);
    return true;
  };

  /** Cut one area (or the bare wall) along the line a→b. */
  /**
   * DRAW A LINE FROM a TO b: every area it passes through is cut along it.
   *
   * It used to cut one area only — whichever lay under the middle of the
   * line. That is right for the first line on a wall and wrong for every one
   * after it: with the wall already divided into strips, a line drawn across
   * them cut a single strip and stopped at its edges, so a criss-cross
   * pattern could not be drawn at all.
   *
   * Which areas it passes through is found by walking along the line. Where
   * it crosses bare wall, the wall becomes an area first — one covering the
   * whole face, at the BOTTOM of the stack — so the wall is cut too. Strips
   * of light and moldings are left whole: a line through a lamp is not an
   * instruction to saw it in half.
   *
   * With `id`, only that one area is cut: the exact-distance Cut works on
   * the area that is selected.
   */
  const cutWithLine = (a: Pt, b: Pt, double: boolean, id?: string | null) => {
    let list = regions;
    let targets: string[];
    if (id) {
      targets = [id];
    } else {
      const along: Pt[] = [];
      for (let i = 0; i < LINE_SAMPLES; i++) {
        const t = (i + 0.5) / LINE_SAMPLES;
        const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H) along.push(q);
      }
      const holds = (r: Region, q: Pt) =>
        !!r.points && !r.light && pointInPolygon(r.points, q[0], q[1]);
      if (along.some((q) => !list.some((r) => holds(r, q)))) {
        list = [fullFaceRegion(W, H) as Region].concat(list);
      }
      targets = list
        .filter((r) => along.some((q) => holds(r, q)))
        .map((r) => r.id);
    }
    let cut = false;
    let strip: string | null = null;
    targets.forEach((target) => {
      const made: any = double
        ? splitRegionDouble(list, target, a, b, spacing / 10)
        : splitRegion(list, target, a, b);
      if (!made.cut) return;
      cut = true;
      list = made.regions as Region[];
      if (made.stripId) strip = made.stripId;
    });
    if (!cut) return false;
    commit(list);
    if (strip) setSelectedId(strip);
    return true;
  };

  const splitExact = () => {
    const typed = Number(splitAt) / 10;
    const limit = splitAxis === "h" ? H : W;
    if (!(typed > 0) || typed >= limit) {
      alert(
        `Enter a distance between 1 and ${mm(limit) - 1} mm (${
          splitAxis === "h" ? "from the floor" : "from the left"
        }).`
      );
      return;
    }
    // "From the left" is the viewer's left, which on a face seen from its
    // other side is the far end of the wall's own measure.
    const at = splitAxis === "v" && mirrored ? W - typed : typed;
    const a: Pt = splitAxis === "h" ? [0, at] : [at, 0];
    const b: Pt = splitAxis === "h" ? [W, at] : [at, H];
    if (!cutWithLine(a, b, false, selectedId)) {
      alert("That line does not pass through the selected area.");
      return;
    }
    setSplitAt("");
  };

  const addOffset = (id: string | null) => {
    const source = id ? regions.find((r) => r.id === id) : null;
    const outline = source ? source.points : (rectPoints(0, 0, W, H) as Pt[]);
    if (!outline) {
      alert("A molding cannot be offset. Offset the area it frames instead.");
      return;
    }
    const inner = offsetPolygon(outline, offsetBy / 10) as Pt[];
    if (inner.length < 3) {
      alert("That distance leaves nothing of the area. Try a smaller one.");
      return;
    }
    place(source?.kind || "polygon", inner);
  };

  const addMolding = (id: string | null) => {
    if (!brush) {
      alert("Choose a material for the molding first.");
      return;
    }
    const source = id ? regions.find((r) => r.id === id) : null;
    const outline = source ? source.points : (rectPoints(0, 0, W, H) as Pt[]);
    const parts = outline
      ? (frameParts(outline, moldingWidth / 10) as Pt[][])
      : [];
    if (!parts.length) {
      alert("That area is too small for a molding of this width.");
      return;
    }
    const cleaned = cleanRegions(
      [
        {
          id: newRegionId(),
          kind: "molding",
          parts,
          texture: packOf(brush),
          // A molding is a raised trim, so it starts a little proud of the
          // wall. Change it in the Extrusion box like any other area.
          extrusion: 1.5,
        },
      ],
      W,
      H
    )[0] as Region | undefined;
    if (!cleaned) return;
    commit(regions.concat([cleaned]));
    setSelectedId(cleaned.id);
  };

  // ── templates ───────────────────────────────────────────────────────────

  const saveTemplate = (list: Region[], label: string) => {
    if (!list.length) {
      alert("There is nothing there to save as a template.");
      return;
    }
    const name = window.prompt("Name this template:", label);
    if (!name || !name.trim()) return;
    const next = templates.concat([
      {
        id: newRegionId(),
        name: name.trim(),
        width: W,
        height: H,
        regions: list.map((r) => JSON.parse(JSON.stringify(r))),
      },
    ]);
    setTemplates(next);
    writeJson(TEMPLATES_KEY, next);
    setLibraryTab("mine");
    setLibraryOpen(true);
  };
  const applyTemplate = (template: any) => {
    const added = (cleanRegions(template.regions, W, H) as Region[]).map(
      (r) => ({ ...r, id: newRegionId() })
    );
    if (!added.length) {
      alert("None of that template fits on this wall.");
      return;
    }
    commit(regions.concat(added));
  };
  const deleteTemplate = (id: string) => {
    if (!window.confirm("Delete this template?")) return;
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    writeJson(TEMPLATES_KEY, next);
  };

  // ── import, search by picture ───────────────────────────────────────────

  const importCad = async (file: File | undefined) => {
    if (!file) return;
    if (/\.dwg$/i.test(file.name)) {
      alert(
        "A .dwg file cannot be read here. In your CAD program use Save As → DXF and import that file."
      );
      return;
    }
    const parsed = parseDxf(await file.text());
    const made = cleanRegions(
      (parsed.shapes as Pt[][]).map((points) => makeRegion("polygon", points)),
      W,
      H
    ) as Region[];
    if (!made.length) {
      alert(
        "No closed shapes were found on the wall. Only closed polylines and circles are imported, drawn in millimetres."
      );
      return;
    }
    commit(regions.concat(made));
    alert(
      `Imported ${made.length} shape${made.length === 1 ? "" : "s"}.` +
        (parsed.skipped
          ? ` ${parsed.skipped} other item${
              parsed.skipped === 1 ? " was" : "s were"
            } left out (open lines, text, dimensions).`
          : "")
    );
  };

  /**
   * SEARCH BY PICTURE: the materials closest in overall colour to a photo.
   * It compares average colour, nothing cleverer — enough to find "something
   * like this tile" in a catalogue, not to recognise a pattern.
   */
  const searchByPicture = async (file: File | undefined) => {
    if (!file) return;
    setRanking(true);
    const url = URL.createObjectURL(file);
    const target = await averageColour(url);
    URL.revokeObjectURL(url);
    if (!target) {
      setRanking(false);
      alert("That picture could not be read.");
      return;
    }
    const pool = finishings
      .filter((f: any) => !categoryId || String(f.categoryId) === categoryId)
      .slice(0, PICTURE_SEARCH_LIMIT);
    const next = new Map<string, number>();
    await Promise.all(
      pool.map(async (f: any) => {
        const c = await averageColour(f.texture.fileUrl);
        if (c)
          next.set(
            String(f._id),
            Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2])
          );
      })
    );
    setRank(next);
    setRanking(false);
  };

  // ── geometry of the page ────────────────────────────────────────────────

  // Pixels per centimetre. At 100% the wall takes about half the drawing
  // area, as in the reference, leaving room for sizes and for shapes that
  // start outside it.
  //
  // The right-hand strip is not drawing area while the 3D preview or the
  // Selected area card is there: the wall is fitted into, and centred in,
  // what is left, so a long wall is never half hidden behind them.
  const reserved = previewOpen || selectedId ? RIGHT_PANEL_PX : 0;
  const clearW = Math.max(box.w - reserved, 200);
  const fit = Math.min(
    (clearW * 0.66) / Math.max(W, 1),
    (box.h * 0.52) / Math.max(H, 1)
  );
  const ppc = Math.max(fit * view.scale, 1e-4);
  const u = 1 / ppc; // one screen pixel, in centimetres
  const vw = box.w / ppc;
  const vh = box.h / ppc;
  // Across the page a region's x may run right-to-left (see faceOfEdge).
  const X = (x: number) => (mirrored ? W - x : x);
  const Y = (y: number) => H - y;
  const vbx = X(view.cx) - clearW / 2 / ppc;
  const vby = Y(view.cy) - vh / 2;
  const pathOf = (points: Pt[]) =>
    points
      .map(
        (p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(2)} ${Y(p[1]).toFixed(2)}`
      )
      .join(" ") + " Z";

  /** Pointer position in wall centimetres. */
  const toWall = (e: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [mirrored ? W - p.x : p.x, H - p.y];
  };

  const gridStep = { w: Math.max(grid.w / 10, 1), h: Math.max(grid.h / 10, 1) };
  // Where the grid starts: a line through the chosen point of the wall, or —
  // "Center" — a cell centred on it.
  const gridOrigin = {
    x:
      (mirrored ? 1 - grid.ax : grid.ax) * W +
      (grid.align === "center" ? gridStep.w / 2 : 0),
    y: grid.ay * H + (grid.align === "center" ? gridStep.h / 2 : 0),
  };

  /**
   * Where a point really goes: onto a guide, a grid line, the wall's edge or
   * a corner of an area if it is within a few pixels of one — otherwise to
   * the nearest centimetre (10 mm).
   */
  /**
   * Snapping, and what the point snapped to.
   *
   * A CORNER first — of the wall or of an area — or the MIDDLE of a straight
   * edge: within a few pixels of one, the point goes exactly there, both
   * coordinates at once, and the page says so ("End Point", "Midpoint") the
   * way the reference does. That is what makes a new shape meet an old one
   * exactly instead of nearly.
   */
  const snapInfo = (p: Pt): { pt: Pt; kind: string | null } => {
    const tol = 8 * u;
    let best: Pt | null = null;
    let bestKind: string | null = null;
    let bestD = tol;
    const offer = (q: Pt, kind: string) => {
      const d = dist(q, p);
      if (d < bestD) {
        bestD = d;
        best = q;
        bestKind = kind;
      }
    };
    const outlines: Pt[][] = [
      [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
      ],
    ];
    regions.forEach((r) =>
      (regionParts(r) as Pt[][]).forEach((part) => {
        if (part.length <= 12) outlines.push(part);
      })
    );
    outlines.forEach((part) =>
      part.forEach((q, i) => {
        offer(q, "End Point");
        const n = part[(i + 1) % part.length];
        offer([(q[0] + n[0]) / 2, (q[1] + n[1]) / 2], "Midpoint");
      })
    );
    if (best) return { pt: best, kind: bestKind };
    return { pt: snapAxes(p), kind: null };
  };
  const snap = (p: Pt): Pt => snapInfo(p).pt;
  const guidePoint = (p: Pt): Pt => {
    // Onto a corner or an edge middle; else onto the wall's edges and the
    // lines of areas — but never onto another guide, or one being dragged
    // would stick to where it was.
    const info = snapInfo(p);
    return info.kind ? info.pt : snapAxes(p, false);
  };
  /** The guide within a few pixels of the pointer, if any. */
  const guideNear = (p: Pt) => {
    if (guidesHidden) return null;
    const tol = 5 * u;
    let found: { axis: "h" | "v"; index: number } | null = null;
    let best = tol;
    guides.h.forEach((y, index) => {
      if (Math.abs(y - p[1]) < best) {
        best = Math.abs(y - p[1]);
        found = { axis: "h", index };
      }
    });
    guides.v.forEach((x, index) => {
      if (Math.abs(x - p[0]) < best) {
        best = Math.abs(x - p[0]);
        found = { axis: "v", index };
      }
    });
    return found as { axis: "h" | "v"; index: number } | null;
  };

  const snapAxes = (p: Pt, withGuides = true): Pt => {
    const tol = 8 * u;
    const axis = (value: number, fixed: number[], step: number, origin: number) => {
      let best = Math.round(value);
      let bestD = tol;
      const consider = (c: number) => {
        const d = Math.abs(c - value);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      };
      fixed.forEach(consider);
      if (grid.show)
        consider(origin + Math.round((value - origin) / step) * step);
      return best;
    };
    const useGuides = withGuides && !guidesHidden;
    const xs = [0, W].concat(useGuides ? guides.v : []);
    const ys = [0, H].concat(useGuides ? guides.h : []);
    regions.forEach((r) =>
      (regionParts(r) as Pt[][]).forEach((part) => {
        if (part.length > 12) return; // a circle has no corners to snap to
        part.forEach((q) => {
          xs.push(q[0]);
          ys.push(q[1]);
        });
      })
    );
    return [
      axis(p[0], xs, gridStep.w, gridOrigin.x),
      axis(p[1], ys, gridStep.h, gridOrigin.y),
    ];
  };

  /**
   * Where a line's far end goes.
   *
   * A line follows the pointer at any angle — that is how a diagonal is
   * drawn. But a hand never gets a level line exactly level, so one within a
   * couple of degrees of horizontal or vertical is made exactly so. With
   * Orthogonal on (or Shift held) every line is horizontal or vertical,
   * whichever it is closer to.
   */
  const straighten = (from: Pt, to: Pt, shift: boolean): Pt => {
    const dx = Math.abs(to[0] - from[0]);
    const dy = Math.abs(to[1] - from[1]);
    if (!(ortho || shift)) {
      const lean = (Math.atan2(Math.min(dx, dy), Math.max(dx, dy)) * 180) / Math.PI;
      if (lean > NEARLY_STRAIGHT_DEG) return to;
    }
    return dx >= dy ? [to[0], from[1]] : [from[0], to[1]];
  };

  // ── pointer ─────────────────────────────────────────────────────────────

  const onDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      setPanning({ x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0) return;
    const raw = toWall(e);
    if (!raw) return;
    const p = snap(raw);
    const hit = topRegionAt(regions, raw[0], raw[1]) as Region | null;

    switch (tool) {
      case "select": {
        const near = guideNear(raw);
        if (near) {
          setGuideDrag(near);
          return;
        }
        setSelectedId(hit?.id || null);
        if (hit) setMoving({ id: hit.id, from: p, before: regions });
        return;
      }
      case "pave":
        if (!brush) alert("Choose a material first.");
        else pave(hit?.id || null, brush);
        return;
      case "molding":
        addMolding(hit?.id || null);
        return;
      case "offset":
        addOffset(hit?.id || null);
        return;
      case "guide": {
        // ONE guide per click, as in the reference — it used to place a
        // horizontal and a vertical one together, a cross nobody asked for.
        setGuidesHidden(false);
        const axis = e.shiftKey ? (guideAxis === "h" ? "v" : "h") : guideAxis;
        const at = guidePoint(raw);
        setGuides((g) =>
          axis === "h" ? { ...g, h: g.h.concat([at[1]]) } : { ...g, v: g.v.concat([at[0]]) }
        );
        return;
      }
      case "rect":
      case "polygon":
      case "circle":
      case "oval":
      case "range":
        setDraft({ pts: [p], cur: p, drag: true });
        return;
      case "free":
        setDraft({ pts: [raw], cur: raw, drag: true });
        return;
      case "line":
      case "double":
      case "measure": {
        if (!draft.pts.length) {
          setDraft({ pts: [p], cur: p, drag: false });
          return;
        }
        const a = draft.pts[0];
        const b = straighten(a, p, e.shiftKey);
        setDraft(NO_DRAFT);
        if (dist(a, b) < MIN_DRAW_CM) return;
        if (tool === "measure") setMeasures((m) => m.concat([{ a, b }]));
        else cutWithLine(a, b, tool === "double");
        return;
      }
      case "arch": {
        if (!draft.pts.length) {
          setDraft({ pts: [p], cur: p, drag: false });
          return;
        }
        if (draft.pts.length === 1) {
          // The feet stand on one level: the second is put at the first's.
          const foot: Pt = [p[0], draft.pts[0][1]];
          if (Math.abs(foot[0] - draft.pts[0][0]) < MIN_DRAW_CM) return;
          setDraft({ pts: [draft.pts[0], foot], cur: raw, drag: false });
          return;
        }
        const arch = archFrom(draft.pts[0], draft.pts[1], p[1]);
        const outline = archPoints(arch) as Pt[];
        setDraft(NO_DRAFT);
        if (outline.length >= 3) place("arch", outline, { arch });
        return;
      }
      case "curve": {
        if (draft.pts.length < 2) {
          setDraft({ pts: draft.pts.concat([p]), cur: p, drag: false });
          return;
        }
        const made = curvePoints(draft.pts[0], draft.pts[1], raw);
        setDraft(NO_DRAFT);
        if (made.points.length >= 3)
          place("curve", made.points as Pt[], { arcHeight: made.height });
        return;
      }
      case "freepoly": {
        const pts = draft.pts;
        // Back on the first corner: the outline is closed.
        if (pts.length >= 3 && dist(pts[0], p) < 10 * u) {
          setDraft(NO_DRAFT);
          place("polygon", pts);
          return;
        }
        const next = pts.length
          ? straighten(pts[pts.length - 1], p, e.shiftKey)
          : p;
        setDraft({ pts: pts.concat([next]), cur: next, drag: false });
        return;
      }
      default:
        return;
    }
  };

  const onMove = (e: React.MouseEvent) => {
    if (panning) {
      const dx = (e.clientX - panning.x) * u;
      const dy = (e.clientY - panning.y) * u;
      setPanning({ x: e.clientX, y: e.clientY });
      setView((v) => ({
        ...v,
        cx: v.cx + (mirrored ? dx : -dx),
        cy: v.cy + dy,
      }));
      return;
    }
    const raw = toWall(e);
    if (!raw) return;
    if (guideDrag) {
      const at = guidePoint(raw);
      setGuides((g) => {
        const list = (guideDrag.axis === "h" ? g.h : g.v).slice();
        list[guideDrag.index] = guideDrag.axis === "h" ? at[1] : at[0];
        return guideDrag.axis === "h" ? { ...g, h: list } : { ...g, v: list };
      });
      return;
    }
    if (tool === "guide") {
      const axis = e.shiftKey ? (guideAxis === "h" ? "v" : "h") : guideAxis;
      const at = guidePoint(raw);
      setGuideAt({ axis, at: axis === "h" ? at[1] : at[0] });
    }
    if (tool !== "select" && tool !== "free" && !moving) {
      const info = snapInfo(raw);
      setHover(info.kind ? { pt: info.pt, kind: info.kind } : null);
    } else if (hover) {
      setHover(null);
    }
    if (moving) {
      const p = snap(raw);
      const dx = p[0] - moving.from[0];
      const dy = p[1] - moving.from[1];
      const shift = (pts: Pt[]) =>
        pts.map((q) => [q[0] + dx, q[1] + dy] as Pt);
      setRegions(
        moving.before.map((r) =>
          r.id !== moving.id
            ? r
            : r.parts
            ? { ...r, parts: r.parts.map(shift) }
            : {
                ...r,
                points: shift(r.points || []),
                ...(r.arch
                  ? { arch: { ...r.arch, cx: r.arch.cx + dx, y: r.arch.y + dy } }
                  : {}),
              }
        )
      );
      return;
    }
    if (!draft.pts.length) return;
    if (tool === "free" && draft.drag) {
      setDraft((d) => ({ ...d, pts: d.pts.concat([raw]), cur: raw }));
      return;
    }
    const p = snap(raw);
    const from = draft.pts[draft.pts.length - 1];
    const lineLike =
      tool === "line" ||
      tool === "double" ||
      tool === "measure" ||
      tool === "freepoly";
    setDraft((d) => ({
      ...d,
      cur:
        tool === "arch"
          ? d.pts.length === 1
            ? ([p[0], d.pts[0][1]] as Pt)
            : p
          : tool === "curve" && d.pts.length === 2
          ? raw
          : lineLike
          ? straighten(from, p, e.shiftKey)
          : p,
    }));
  };

  const onUp = () => {
    if (panning) {
      setPanning(null);
      return;
    }
    if (guideDrag) {
      // Dragged right off the wall: that guide is not wanted.
      const { axis, index } = guideDrag;
      setGuideDrag(null);
      setGuides((g) => {
        const list = axis === "h" ? g.h : g.v;
        const value = list[index];
        const limit = axis === "h" ? H : W;
        const off = value < -20 * u || value > limit + 20 * u;
        if (!off) return g;
        const kept = list.filter((_, i) => i !== index);
        return axis === "h" ? { ...g, h: kept } : { ...g, v: kept };
      });
      return;
    }
    if (moving) {
      // One history step for the whole move, and only if it went anywhere.
      const before = moving.before;
      setMoving(null);
      const now = cleanRegions(regions, W, H) as Region[];
      if (JSON.stringify(now) !== JSON.stringify(before)) commit(now, before);
      else setRegions(before);
      return;
    }
    if (!draft.drag || !draft.pts.length || !draft.cur) return;
    const a = draft.pts[0];
    const b = draft.cur;
    const pts = draft.pts;
    setDraft(NO_DRAFT);
    const w = Math.abs(b[0] - a[0]);
    const h = Math.abs(b[1] - a[1]);
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    if (tool === "free") {
      const line = simplifyLine(pts, Math.max(1, 2 * u)) as Pt[];
      const lb = boundsOf(line);
      if (line.length >= 3 && lb.w > MIN_DRAW_CM && lb.h > MIN_DRAW_CM)
        place("free", line);
      return;
    }
    if (tool === "polygon") {
      if (dist(a, b) >= MIN_DRAW_CM)
        place("polygon", regularPoints(a, b, polySides));
      return;
    }
    if (tool === "circle") {
      const r = dist(a, b);
      if (r >= MIN_DRAW_CM)
        place("circle", ovalPoints(a[0], a[1], r, r) as Pt[]);
      return;
    }
    if (w < MIN_DRAW_CM || h < MIN_DRAW_CM) return;
    if (tool === "rect") place("rect", rectPoints(x, y, w, h) as Pt[]);
    else if (tool === "oval")
      place("oval", ovalPoints(x + w / 2, y + h / 2, w / 2, h / 2) as Pt[]);
    else if (tool === "range") {
      const inside = regions.filter((r) => {
        const rb = regionBounds(r);
        return (
          rb.x >= x - 0.5 &&
          rb.y >= y - 0.5 &&
          rb.x + rb.w <= x + w + 0.5 &&
          rb.y + rb.h <= y + h + 0.5
        );
      });
      saveTemplate(inside, "Template");
      setTool("select");
    }
  };

  const onDouble = () => {
    if (tool !== "freepoly" || draft.pts.length < 3) return;
    // The second click of the double-click put a point on top of the last
    // one; it is not a corner.
    const pts = draft.pts.filter(
      (p, i) => i === 0 || dist(p, draft.pts[i - 1]) > SAME_CORNER_CM
    );
    setDraft(NO_DRAFT);
    if (pts.length >= 3) place("polygon", pts);
  };

  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, scale: clamp(v.scale * factor, 0.3, 8) }));
  const fitView = () => setView({ scale: 1, cx: W / 2, cy: H / 2 });
  const onWheel = (e: React.WheelEvent) =>
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);

  const close = () => {
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      edge.setRegions(regionsToSave(regions));
      const planner = BlueprintInterface?.blueprint3d?.roomplanner;
      if (planner) planner.needsUpdate = true;
      await BlueprintInterface.ProjectManagerService.updateFloorPlan(
        HISTORY_TITLES.WALL_TEXTURE_CHANGED
      );
      onClose();
    } catch (e) {
      console.error("WallEditorModal ~ save", e);
      alert("The wall could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Shortcuts, the same keys the reference uses. Ignored while typing.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (key === " ") {
        setSpaceDown(true);
        e.preventDefault();
      } else if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (mod && key === "e") {
        e.preventDefault();
        setTool("oval");
      } else if (mod) return;
      else if (key === "l") setTool(e.shiftKey ? "double" : "line");
      else if (key === "r") setTool("rect");
      else if (key === "g") setTool("polygon");
      else if (key === "c") setTool("circle");
      else if (key === "a") setTool("arch");
      else if (key === "t") setTool("guide");
      else if (key === "m") setTool("pave");
      else if (key === "n") setTool("molding");
      else if (key === "v") setTool("select");
      else if (key === "delete" || key === "backspace") deleteArea();
      else if (key === "enter" && tool === "freepoly" && draft.pts.length >= 3) {
        const pts = draft.pts;
        setDraft(NO_DRAFT);
        place("polygon", pts);
      } else if (key === "escape") {
        if (draft.pts.length) setDraft(NO_DRAFT);
        else setTool("select");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // The two sides of this wall, for "Select room".
  const sides = useMemo(() => {
    const wall = edge?.wall;
    const list: { edge: any; label: string }[] = [];
    [wall?.frontEdge, wall?.backEdge].forEach((side: any, i: number) => {
      if (!side) return;
      list.push({
        edge: side,
        label: side.room?.name || (i === 0 ? "Front side" : "Back side"),
      });
    });
    return list;
  }, [edge]);

  // The drawing, as the preview sees it: left to right as on the page.
  const previewRegions = useMemo(() => {
    if (!mirrored) return regions;
    const flip = (pts: Pt[]) => pts.map((p) => [W - p[0], p[1]] as Pt);
    return regions.map((r) =>
      r.parts
        ? { ...r, parts: r.parts.map(flip) }
        : { ...r, points: flip(r.points || []) }
    );
  }, [regions, mirrored, W]);
  const previewOpenings = useMemo(
    () =>
      (face?.openings || []).map((o: any) =>
        mirrored ? { ...o, x: W - o.x - o.w } : o
      ),
    [face, mirrored, W]
  );

  if (!face) {
    return createPortal(
      <div className="we-overlay">
        <div className="we-empty">
          <p>This wall cannot be opened in the editor.</p>
          <button className="we-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // ── drawing helpers ─────────────────────────────────────────────────────

  /**
   * A figure on the drawing. `lift` moves it that many pixels up the page,
   * off the line or shape it describes.
   *
   * Over the wall, which is pale, it is dark with a light edge; over the
   * page, which is dark, the other way round. `strokeDasharray` is reset
   * because a label drawn inside a dashed line's group would otherwise have
   * its edge dashed too — which is what made the figures look smudged.
   */
  const label = (
    x: number,
    y: number,
    value: string,
    key: string,
    colour = "",
    lift = 0
  ) => {
    const onWall = x >= 0 && x <= W && y >= 0 && y <= H;
    return (
      <text
        key={key}
        x={X(x)}
        y={Y(y) - lift * u}
        fontSize={12 * u}
        fontWeight={600}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={onWall ? "#1c1c1e" : colour || "#ffffff"}
        stroke={onWall ? "#ffffff" : "#1c1c1e"}
        strokeWidth={3 * u}
        strokeDasharray="none"
        strokeLinejoin="round"
        paintOrder="stroke"
        pointerEvents="none"
      >
        {value}
      </text>
    );
  };

  /** A size line with end ticks, as round the wall in the reference. */
  const dimension = (a: Pt, b: Pt, value: string, key: string) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const tx = (-dy / len) * 7 * u;
    const ty = (dx / len) * 7 * u;
    return (
      <g key={key} pointerEvents="none" stroke="#ffffff" strokeWidth={1.2 * u}>
        <line x1={X(a[0])} y1={Y(a[1])} x2={X(b[0])} y2={Y(b[1])} />
        <line
          x1={X(a[0] - tx)}
          y1={Y(a[1] - ty)}
          x2={X(a[0] + tx)}
          y2={Y(a[1] + ty)}
        />
        <line
          x1={X(b[0] - tx)}
          y1={Y(b[1] - ty)}
          x2={X(b[0] + tx)}
          y2={Y(b[1] + ty)}
        />
        {label((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, value, key + "t")}
      </g>
    );
  };

  const gap = 26 * u;
  const sb = selected ? regionBounds(selected) : null;

  // What is being drawn, before it is finished.
  const draftShape = (() => {
    const { pts, cur } = draft;
    if (!pts.length || !cur) return null;
    const a = pts[0];
    const style = {
      stroke: "#4c9bff",
      strokeWidth: 1.5 * u,
      fill: "rgba(76,155,255,0.18)",
    };
    if (tool === "rect" || tool === "range")
      return (
        <path
          d={pathOf(
            rectPoints(
              Math.min(a[0], cur[0]),
              Math.min(a[1], cur[1]),
              Math.abs(cur[0] - a[0]),
              Math.abs(cur[1] - a[1])
            ) as Pt[]
          )}
          {...style}
          strokeDasharray={tool === "range" ? `${5 * u} ${4 * u}` : undefined}
        />
      );
    if (tool === "polygon")
      return <path d={pathOf(regularPoints(a, cur, polySides))} {...style} />;
    if (tool === "circle")
      return (
        <path
          d={pathOf(ovalPoints(a[0], a[1], dist(a, cur), dist(a, cur)) as Pt[])}
          {...style}
        />
      );
    if (tool === "oval")
      return (
        <path
          d={pathOf(
            ovalPoints(
              (a[0] + cur[0]) / 2,
              (a[1] + cur[1]) / 2,
              Math.abs(cur[0] - a[0]) / 2,
              Math.abs(cur[1] - a[1]) / 2
            ) as Pt[]
          )}
          {...style}
        />
      );
    if (tool === "arch" && pts.length === 2) {
      const outline = archPoints(archFrom(pts[0], pts[1], cur[1])) as Pt[];
      return outline.length >= 3 ? (
        <path d={pathOf(outline)} {...style} />
      ) : null;
    }
    if (tool === "curve" && pts.length === 2) {
      const made = curvePoints(pts[0], pts[1], cur);
      return made.points.length >= 3 ? (
        <path d={pathOf(made.points as Pt[])} {...style} />
      ) : null;
    }
    return (
      <polyline
        points={pts
          .concat([cur])
          .map((p) => `${X(p[0])},${Y(p[1])}`)
          .join(" ")}
        stroke="#4c9bff"
        strokeWidth={1.5 * u}
        fill={
          tool === "freepoly" || tool === "free"
            ? "rgba(76,155,255,0.18)"
            : "none"
        }
      />
    );
  })();

  const draftLabel = (() => {
    const { pts, cur } = draft;
    if (!pts.length || !cur) return "";
    const a = pts[0];
    if (tool === "rect" || tool === "oval" || tool === "range")
      return `${mm(Math.abs(cur[0] - a[0]))} × ${mm(Math.abs(cur[1] - a[1]))} mm`;
    if (tool === "circle") return `Radius ${mm(dist(a, cur))} mm`;
    if (tool === "polygon")
      return `${polySides} sides · radius ${mm(dist(a, cur))} mm`;
    if (tool === "arch") {
      if (pts.length < 2) return `Span ${mm(Math.abs(cur[0] - a[0]))} mm`;
      const arch = archFrom(pts[0], pts[1], cur[1]);
      return `Rise ${mm(arch.rise)} mm · Leg ${mm(arch.leg)} mm`;
    }
    if (tool === "curve" && pts.length === 2)
      return `Arc height ${mm(curvePoints(pts[0], pts[1], cur).height)} mm`;
    if (tool === "free") return "";
    return `${mm(dist(pts[pts.length - 1], cur))} mm`;
  })();

  // The Extrusion field sits in the WALL's bottom-right corner, as in the
  // reference — always there, whatever is selected. It was put on the
  // selected area's own corner at first, which laid it across the very shape
  // being worked on.
  const extrusionAt = {
    left: (W - vbx) * ppc,
    top: (H - vby) * ppc,
  };

  const toolButton = (
    id: string,
    icon: string,
    title: string,
    active: boolean,
    onMain: () => void,
    items?: React.ReactNode
  ) => (
    <div className="we-tb-item we-pop" key={id}>
      <button
        type="button"
        className={"we-tb-btn" + (active ? " is-on" : "")}
        title={title}
        onClick={onMain}
      >
        <Icon name={icon} />
      </button>
      {items ? (
        <button
          type="button"
          className={"we-tb-caret" + (menu === id ? " is-open" : "")}
          title={`${title} options`}
          onClick={() => setMenu(menu === id ? null : id)}
        >
          <Icon name="chevron" size={14} />
        </button>
      ) : null}
      {items && menu === id ? <div className="we-menu">{items}</div> : null}
    </div>
  );
  const toolMenu = (list: [Tool, string, string][]) =>
    list.map(([id, name, key]) => (
      <button
        key={id}
        type="button"
        className={"we-menu-item" + (tool === id ? " is-on" : "")}
        onClick={() => setTool(id)}
      >
        <span>{name}</span>
        {key ? <kbd>{key}</kbd> : null}
      </button>
    ));
  const numberField = (
    name: string,
    value: number,
    set: (n: number) => void
  ) => (
    <label className="we-opt-field">
      {name}
      <NumBox value={value} min={1} onValue={set} />
      mm
    </label>
  );
  const family = familyOf(tool);

  // RENDERED INTO <body>, not where the component sits. It is mounted inside
  // the furnish menu, whose container is its own stacking layer underneath
  // the left navigation rail — so however high the page's own z-index, the
  // rail was drawn over its first 80px and cut off the title and the
  // material list. From <body> it is a true full page, above everything.
  return createPortal(
    <div
      className="we-overlay"
      onMouseDown={(e) => {
        if (menu && !(e.target as HTMLElement).closest(".we-pop")) setMenu(null);
      }}
    >
      <div className="we-top">
        <div className="we-title">Wall Editor</div>
        <div className="we-top-actions">
          <button className="we-link" onClick={undo} disabled={!past.length}>
            <Icon name="undo" /> Undo
          </button>
          <button className="we-link" onClick={redo} disabled={!future.length}>
            <Icon name="redo" /> Redo
          </button>
          <button
            className="we-link"
            onClick={clearAll}
            disabled={!regions.length}
          >
            <Icon name="clear" /> Clear
          </button>
        </div>
        <div className="we-top-actions">
          <button
            className="we-link we-save"
            onClick={save}
            disabled={saving || !dirty}
          >
            <Icon name="save" /> {saving ? "Saving…" : "Save"}
          </button>
          <span className="we-top-rule" />
          <button
            className="we-link"
            onClick={close}
            disabled={saving}
            title="Close"
          >
            <Icon name="close" size={24} />
          </button>
        </div>
      </div>

      <div className="we-body">
        {libraryOpen ? (
          <aside className="we-library">
            <div className="we-rail">
              <button
                className={
                  "we-rail-top" + (libraryTab === "public" ? " is-on" : "")
                }
                title="Materials"
                onClick={() => setLibraryTab("public")}
              >
                <Icon name="library" size={24} />
              </button>
              <div className="we-rail-cats">
                {libraryTab === "public" ? (
                  <>
                    <button
                      className={"we-cat" + (categoryId === "" ? " is-on" : "")}
                      onClick={() => setCategoryId("")}
                    >
                      All
                    </button>
                    {categories.map((c: any) => (
                      <button
                        key={c._id}
                        className={
                          "we-cat" +
                          (categoryId === String(c._id) ? " is-on" : "")
                        }
                        onClick={() => setCategoryId(String(c._id))}
                        title={c.name}
                      >
                        {c.name}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
              <button
                className={
                  "we-rail-bottom" + (libraryTab === "mine" ? " is-on" : "")
                }
                title="My templates"
                onClick={() => setLibraryTab("mine")}
              >
                <Icon name="user" size={24} />
              </button>
            </div>

            <div className="we-lib-main">
              {libraryTab === "public" ? (
                <>
                  <div className="we-search">
                    <input
                      placeholder="Search category"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      title="Search by picture"
                      onClick={() => pictureRef.current?.click()}
                      disabled={ranking}
                    >
                      <Icon name="camera" />
                    </button>
                    <span className="we-search-go">
                      <Icon name="search" />
                    </span>
                  </div>
                  <div className="we-tabs">
                    <span className="we-tab is-on">Comprehensive</span>
                    {rank || ranking ? (
                      <button
                        className="we-tab"
                        onClick={() => setRank(null)}
                        disabled={ranking}
                      >
                        {ranking ? "Comparing…" : "Clear picture search"}
                      </button>
                    ) : null}
                  </div>
                  <div className="we-swatches">
                    {shown
                      .slice((pageNow - 1) * PAGE_SIZE, pageNow * PAGE_SIZE)
                      .map((f: any) => (
                        <button
                          key={f._id}
                          type="button"
                          className={
                            "we-swatch" + (brush?._id === f._id ? " is-on" : "")
                          }
                          title={capitalizeText(f.name)}
                          onClick={() => chooseMaterial(f)}
                        >
                          <img
                            src={f.texture.fileUrl}
                            alt={f.name}
                            loading="lazy"
                          />
                        </button>
                      ))}
                    {!shown.length ? (
                      <p className="we-muted">No material matches.</p>
                    ) : null}
                  </div>
                  <div className="we-pager">
                    <button
                      onClick={() => setPage(pageNow - 1)}
                      disabled={pageNow <= 1}
                      title="Previous page"
                    >
                      <Icon name="left" size={16} />
                    </button>
                    <NumBox
                      value={pageNow}
                      min={1}
                      max={pages}
                      onValue={(n) => setPage(Math.round(n))}
                    />
                    <span>/ {pages} Page</span>
                    <button
                      onClick={() => setPage(pageNow + 1)}
                      disabled={pageNow >= pages}
                      title="Next page"
                    >
                      <Icon name="right" size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="we-templates">
                  <div className="we-side-title">My templates</div>
                  {templates.length ? (
                    templates.map((t) => (
                      <div className="we-template" key={t.id}>
                        <div className="we-template-name" title={t.name}>
                          {t.name}
                        </div>
                        <div className="we-muted">
                          {t.regions.length} area
                          {t.regions.length === 1 ? "" : "s"} · {mm(t.width)} ×{" "}
                          {mm(t.height)}
                        </div>
                        <div className="we-row">
                          <button
                            className="we-btn"
                            onClick={() => applyTemplate(t)}
                          >
                            Use
                          </button>
                          <button
                            className="we-btn"
                            onClick={() => deleteTemplate(t.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="we-muted">
                      No templates yet. Save a layout from the last toolbar
                      button.
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        ) : null}

        <main className="we-stage">
          <button
            className="we-collapse"
            title={libraryOpen ? "Hide the library" : "Show the library"}
            onClick={() => setLibraryOpen(!libraryOpen)}
          >
            <Icon name={libraryOpen ? "collapse" : "right"} size={16} />
          </button>

          <div className="we-toolbar">
            <div className="we-tb-group">
              {toolButton("import", "import", "Import CAD", false, () =>
                cadRef.current?.click()
              )}
            </div>
            <div className="we-tb-group">
              {toolButton(
                "line",
                "line",
                "Line",
                family === "line",
                () => setTool(lastOf.line),
                toolMenu(LINE_TOOLS)
              )}
              {toolButton(
                "rect",
                "rect",
                "Rectangle",
                family === "rect",
                () => setTool(lastOf.rect),
                toolMenu(RECT_TOOLS)
              )}
              {toolButton(
                "circle",
                "circle",
                "Circle",
                family === "circle",
                () => setTool(lastOf.circle),
                toolMenu(CIRCLE_TOOLS)
              )}
              {/* The Linear light tool was here, and was taken out on
                  request. Strips of light already drawn on a wall are still
                  read, drawn and saved exactly as before. */}
              <span className="we-tb-rule" />
              {toolButton("free", "free", "Free line", tool === "free", () =>
                setTool("free")
              )}
            </div>
            <div className="we-tb-group">
              {toolButton("offset", "offset", "Offset", tool === "offset", () =>
                setTool("offset")
              )}
              {toolButton(
                "measure",
                "measure",
                "Measure",
                tool === "measure",
                () => setTool("measure")
              )}
              {toolButton(
                "show",
                "eye",
                "Show",
                false,
                () => setMenu(menu === "show" ? null : "show"),
                SHOW_OPTIONS.map(([id, name]) => {
                  // These two show doors and windows. On a wall with none
                  // they cannot change anything, and say so rather than
                  // looking broken.
                  const idle =
                    (id === "wallModel" || id === "modelDim") &&
                    !face.openings.length;
                  return (
                    <label
                      className={"we-menu-item we-check" + (idle ? " is-idle" : "")}
                      key={id}
                      title={idle ? "No doors or windows on this wall" : undefined}
                    >
                      <input
                        type="checkbox"
                        disabled={idle}
                        checked={!!show[id]}
                        onChange={(e) =>
                          setShow((s) => ({ ...s, [id]: e.target.checked }))
                        }
                      />
                      <span>
                        {name}
                        {idle ? (
                          <small className="we-menu-sub">
                            No doors or windows on this wall
                          </small>
                        ) : null}
                      </span>
                    </label>
                  );
                })
              )}
              {toolButton(
                "guides",
                "guides",
                "Guides",
                tool === "guide",
                () => setTool("guide"),
                <>
                  <button
                    className="we-menu-item"
                    onClick={() => setTool("guide")}
                  >
                    <span>Add guides</span>
                    <kbd>T</kbd>
                  </button>
                  <button
                    className="we-menu-item"
                    onClick={() => {
                      setGuides({ v: [], h: [] });
                      setMenu(null);
                    }}
                  >
                    <span>Clear guides</span>
                  </button>
                  <button
                    className="we-menu-item"
                    onClick={() => {
                      setGuidesHidden(!guidesHidden);
                      setMenu(null);
                    }}
                  >
                    <span>{guidesHidden ? "Show guides" : "Hide guides"}</span>
                  </button>
                </>
              )}
              <div className="we-tb-item we-pop">
                <button
                  type="button"
                  className={
                    "we-tb-btn" + (grid.show || menu === "grid" ? " is-on" : "")
                  }
                  title="Grid"
                  onClick={() => setMenu(menu === "grid" ? null : "grid")}
                >
                  <Icon name="grid" />
                </button>
                {menu === "grid" ? (
                  <div className="we-menu we-grid-panel">
                    <label className="we-check">
                      <input
                        type="checkbox"
                        checked={grid.show}
                        onChange={(e) => setGrid({ show: e.target.checked })}
                      />
                      <span>Show grid</span>
                    </label>
                    <div className="we-grid-sizes">
                      <label>
                        W
                        <NumBox
                          value={grid.w}
                          min={10}
                          disabled={!grid.show}
                          onValue={(n) => setGrid({ w: n })}
                        />
                        mm
                      </label>
                      <label>
                        H
                        <NumBox
                          value={grid.h}
                          min={10}
                          disabled={!grid.show}
                          onValue={(n) => setGrid({ h: n })}
                        />
                        mm
                      </label>
                    </div>
                    <div className="we-grid-control">
                      <span>Control</span>
                      <div className="we-anchor">
                        {[1, 0.5, 0].map((ay) =>
                          [0, 0.5, 1].map((ax) => {
                            const centre = ax === 0.5 && ay === 0.5;
                            // Each arrow points at the part of the wall the
                            // grid starts from.
                            const turn =
                              (Math.atan2(-(ay - 0.5), ax - 0.5) * 180) /
                              Math.PI;
                            return (
                              <button
                                key={`${ax}-${ay}`}
                                type="button"
                                disabled={!grid.show}
                                className={
                                  grid.ax === ax && grid.ay === ay ? "is-on" : ""
                                }
                                title={
                                  centre
                                    ? "Center"
                                    : `${
                                        ay === 1 ? "Top" : ay === 0 ? "Bottom" : ""
                                      } ${
                                        ax === 0 ? "left" : ax === 1 ? "right" : ""
                                      }`.trim()
                                }
                                onClick={() => setGrid({ ax, ay })}
                              >
                                {centre ? (
                                  "●"
                                ) : (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      transform: `rotate(${turn}deg)`,
                                    }}
                                  >
                                    ➜
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                    {(["justified", "center"] as const).map((mode) => (
                      <label className="we-check" key={mode}>
                        <input
                          type="radio"
                          name="we-grid-align"
                          disabled={!grid.show}
                          checked={grid.align === mode}
                          onChange={() => setGrid({ align: mode })}
                        />
                        <span>
                          {mode === "justified"
                            ? "Justified Alignment"
                            : "Center"}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              {toolButton(
                "brush",
                "brush",
                "Brush",
                family === "brush",
                () => setTool(lastOf.brush),
                toolMenu(BRUSH_TOOLS)
              )}
            </div>
            <div className="we-tb-group">
              {toolButton(
                "templates",
                "templates",
                "Templates",
                tool === "range",
                () => setMenu(menu === "templates" ? null : "templates"),
                <>
                  <button
                    className="we-menu-item"
                    onClick={() => {
                      setMenu(null);
                      saveTemplate(regions, "Wall layout");
                    }}
                  >
                    <span>Save all as templates</span>
                  </button>
                  <button
                    className="we-menu-item"
                    onClick={() => setTool("range")}
                  >
                    <span>Select template range</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {tool !== "select" ? (
            <div className="we-options">
              <span className="we-hint">{HINTS[tool]}</span>
              {tool === "line" ||
              tool === "double" ||
              tool === "measure" ||
              tool === "freepoly" ? (
                <label
                  className="we-toggle"
                  title="Keep lines horizontal or vertical"
                >
                  <input
                    type="checkbox"
                    checked={ortho}
                    onChange={(e) => setOrtho(e.target.checked)}
                  />
                  <span className="we-toggle-track" />
                  Orthogonal
                </label>
              ) : null}
              {tool === "double"
                ? numberField("Spacing", spacing, setSpacing)
                : null}
              {tool === "guide" ? (
                <label
                  className="we-toggle"
                  title="Which way the next guide runs (Shift flips it for one)"
                >
                  Horizontal
                  <input
                    type="checkbox"
                    checked={guideAxis === "v"}
                    onChange={(e) => setGuideAxis(e.target.checked ? "v" : "h")}
                  />
                  <span className="we-toggle-track" />
                  Vertical
                </label>
              ) : null}
              {tool === "polygon" ? (
                <label className="we-opt-field">
                  Sides
                  <NumBox value={polySides} min={3} max={24} onValue={(n) => setPolySides(Math.round(n))} />
                </label>
              ) : null}
              {LIGHTABLE.has(tool) ? (
                <label
                  className="we-toggle"
                  title="Draw the shape's outline as a strip of light"
                >
                  <input
                    type="checkbox"
                    checked={lightStrip}
                    onChange={(e) => setLightStrip(e.target.checked)}
                  />
                  <span className="we-toggle-track" />
                  Light strip
                </label>
              ) : null}
              {LIGHTABLE.has(tool) && lightStrip
                ? numberField("Width", lightWidth, setLightWidth)
                : null}
              {tool === "offset"
                ? numberField("Distance", offsetBy, setOffsetBy)
                : null}
              {tool === "molding"
                ? numberField("Width", moldingWidth, setMoldingWidth)
                : null}
              {tool === "arch"
                ? numberField("Thickness", archThickness, setArchThickness)
                : null}
              {tool === "pave" || tool === "molding" ? (
                <span className="we-brush">
                  {brush ? (
                    <>
                      <img src={brush.texture.fileUrl} alt="" />
                      {capitalizeText(brush.name)}
                    </>
                  ) : (
                    "No material chosen"
                  )}
                </span>
              ) : null}
              <span className="we-top-rule" />
              <button className="we-btn" onClick={() => setTool("select")}>
                Exit
              </button>
            </div>
          ) : null}

          <div
            ref={canvasRef}
            className={
              "we-canvas" +
              (spaceDown || panning
                ? " is-pan"
                : tool === "select"
                ? ""
                : " is-draw")
            }
          >
            <svg
              ref={svgRef}
              className="we-svg"
              width={box.w}
              height={box.h}
              viewBox={`${vbx} ${vby} ${vw} ${vh}`}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onDoubleClick={onDouble}
              onWheel={onWheel}
            >
              <defs>
                <pattern
                  id="we-dots"
                  width={8 * u}
                  height={8 * u}
                  patternUnits="userSpaceOnUse"
                >
                  <rect width={8 * u} height={8 * u} fill="#e6e6e6" />
                  <circle cx={4 * u} cy={4 * u} r={0.7 * u} fill="#b9b9b9" />
                </pattern>
                <pattern
                  id="we-hatch"
                  width={8 * u}
                  height={8 * u}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width={8 * u} height={8 * u} fill="#3a3d44" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2={8 * u}
                    stroke="#6b7280"
                    strokeWidth={2 * u}
                  />
                </pattern>
                {regions.map((r) =>
                  r.texture?.colormap ? (
                    <clipPath id={`we-clip-${r.id}`} key={r.id}>
                      {(regionParts(r) as Pt[][]).map((part, i) => (
                        <path key={i} d={pathOf(part)} />
                      ))}
                    </clipPath>
                  ) : null
                )}
              </defs>

              {/* The wall. */}
              <rect x={0} y={0} width={W} height={H} fill="url(#we-dots)" />

              {grid.show ? (
                <g
                  pointerEvents="none"
                  stroke="#8a8f99"
                  strokeWidth={0.6 * u}
                  opacity={0.7}
                >
                  {(() => {
                    const lines: React.ReactNode[] = [];
                    const x0 =
                      gridOrigin.x -
                      Math.ceil(gridOrigin.x / gridStep.w) * gridStep.w;
                    for (
                      let x = x0;
                      x <= W + 0.01 && lines.length < 600;
                      x += gridStep.w
                    )
                      if (x >= -0.01)
                        lines.push(
                          <line
                            key={"gx" + x}
                            x1={X(x)}
                            y1={0}
                            x2={X(x)}
                            y2={H}
                          />
                        );
                    const y0 =
                      gridOrigin.y -
                      Math.ceil(gridOrigin.y / gridStep.h) * gridStep.h;
                    for (
                      let y = y0;
                      y <= H + 0.01 && lines.length < 1200;
                      y += gridStep.h
                    )
                      if (y >= -0.01)
                        lines.push(
                          <line
                            key={"gy" + y}
                            x1={0}
                            y1={Y(y)}
                            x2={W}
                            y2={Y(y)}
                          />
                        );
                    return lines;
                  })()}
                </g>
              ) : null}

              {regions.map((r) => {
                const parts = regionParts(r) as Pt[][];
                const b = regionBounds(r);
                return (
                  <g key={r.id}>
                    {r.texture?.colormap ? (
                      <image
                        href={r.texture.colormap}
                        x={Math.min(X(b.x), X(b.x + b.w))}
                        y={Y(b.y + b.h)}
                        width={b.w}
                        height={b.h}
                        preserveAspectRatio="none"
                        clipPath={`url(#we-clip-${r.id})`}
                      />
                    ) : null}
                    {parts.map((part, i) => (
                      <path
                        key={i}
                        d={pathOf(part)}
                        fill={r.light ? "#fff1cf" : "transparent"}
                        stroke={r.light ? "#ffd98a" : "#5a6070"}
                        strokeWidth={(r.parts ? 0.6 : 1.2) * u}
                        strokeDasharray={
                          r.texture || r.light ? undefined : `${5 * u} ${3 * u}`
                        }
                      />
                    ))}
                  </g>
                );
              })}

              {/* Doors and windows: a material is cut away here in 3D. */}
              {show.wallModel || show.modelDim
                ? face.openings.map((o: any, i: number) => (
                    <g key={i} pointerEvents="none">
                      {show.wallModel ? (
                        <rect
                          x={Math.min(X(o.x), X(o.x + o.w))}
                          y={Y(o.y + o.h)}
                          width={o.w}
                          height={o.h}
                          fill="url(#we-hatch)"
                          stroke="#9aa1ad"
                          strokeWidth={1.2 * u}
                        />
                      ) : null}
                      {show.modelDim
                        ? label(
                            o.x + o.w / 2,
                            o.y + o.h / 2,
                            `${mm(o.w)} × ${mm(o.h)}`,
                            "od" + i
                          )
                        : null}
                    </g>
                  ))
                : null}

              {!guidesHidden ? (
                <g
                  pointerEvents="none"
                  stroke="#35d0c0"
                  strokeWidth={1 * u}
                  strokeDasharray={`${6 * u} ${4 * u}`}
                >
                  {guides.v.map((x, i) => (
                    <line
                      key={"gv" + i}
                      x1={X(x)}
                      y1={vby}
                      x2={X(x)}
                      y2={vby + vh}
                    />
                  ))}
                  {guides.h.map((y, i) => (
                    <line
                      key={"gh" + i}
                      x1={vbx}
                      y1={Y(y)}
                      x2={vbx + vw}
                      y2={Y(y)}
                    />
                  ))}
                </g>
              ) : null}

              {tool === "guide" && guideAt ? (
                <g pointerEvents="none">
                  {guideAt.axis === "h" ? (
                    <line
                      x1={vbx}
                      y1={Y(guideAt.at)}
                      x2={vbx + vw}
                      y2={Y(guideAt.at)}
                      stroke="#35d0c0"
                      strokeWidth={1.5 * u}
                      opacity={0.8}
                    />
                  ) : (
                    <line
                      x1={X(guideAt.at)}
                      y1={vby}
                      x2={X(guideAt.at)}
                      y2={vby + vh}
                      stroke="#35d0c0"
                      strokeWidth={1.5 * u}
                      opacity={0.8}
                    />
                  )}
                  {guideAt.axis === "h"
                    ? label(
                        -gap * 2.2,
                        guideAt.at,
                        `${mm(guideAt.at)} mm from floor`,
                        "gat",
                        "#9ff3e8",
                        10
                      )
                    : label(
                        guideAt.at,
                        H + gap * 1.8,
                        `${mm(mirrored ? W - guideAt.at : guideAt.at)} mm from left`,
                        "gat",
                        "#9ff3e8"
                      )}
                </g>
              ) : null}

              {/* The wall's outline and its size on all four sides. */}
              <rect
                x={0}
                y={0}
                width={W}
                height={H}
                fill="none"
                stroke="#f2f2f2"
                strokeWidth={2 * u}
                strokeDasharray={`${8 * u} ${5 * u}`}
                pointerEvents="none"
              />
              {/* The wall's own sizes are line lengths like any other, so
                  "Line length" hides them too — they were drawn whatever it
                  said, and unticking it seemed to do nothing. */}
              {show.lineLength ? (
                <>
                  {dimension([0, H + gap], [W, H + gap], String(mm(W)), "dt")}
                  {dimension([0, -gap], [W, -gap], String(mm(W)), "db")}
                  {dimension([-gap, 0], [-gap, H], String(mm(H)), "dl")}
                  {dimension([W + gap, 0], [W + gap, H], String(mm(H)), "dr")}
                </>
              ) : null}

              {selected ? (
                <g pointerEvents="none">
                  {(regionParts(selected) as Pt[][]).map((part, i) => (
                    <path
                      key={i}
                      d={pathOf(part)}
                      fill="rgba(76,155,255,0.16)"
                      stroke="#4c9bff"
                      strokeWidth={2 * u}
                    />
                  ))}
                  {show.lineSpacing && sb ? (
                    <g
                      stroke="#ffb454"
                      strokeWidth={1 * u}
                      strokeDasharray={`${3 * u} ${3 * u}`}
                    >
                      {(
                        [
                          [
                            [0, sb.y + sb.h / 2],
                            [sb.x, sb.y + sb.h / 2],
                          ],
                          [
                            [sb.x + sb.w, sb.y + sb.h / 2],
                            [W, sb.y + sb.h / 2],
                          ],
                          [
                            [sb.x + sb.w / 2, 0],
                            [sb.x + sb.w / 2, sb.y],
                          ],
                          [
                            [sb.x + sb.w / 2, sb.y + sb.h],
                            [sb.x + sb.w / 2, H],
                          ],
                        ] as [Pt, Pt][]
                      ).map(([a, b], i) =>
                        dist(a, b) * ppc > 40 ? (
                          <g key={i}>
                            <line
                              x1={X(a[0])}
                              y1={Y(a[1])}
                              x2={X(b[0])}
                              y2={Y(b[1])}
                            />
                            {label(
                              (a[0] + b[0]) / 2,
                              (a[1] + b[1]) / 2,
                              String(mm(dist(a, b))),
                              "ls" + i,
                              "#ffd9a3",
                              10
                            )}
                          </g>
                        ) : null
                      )}
                    </g>
                  ) : null}
                </g>
              ) : null}

              {/* WHAT THE SHOW MENU ADDS, for the selected area — or, with
                  nothing selected, for every area on the wall. It used to
                  be for the selected area only, so with nothing selected
                  every tick in the menu seemed to do nothing at all. A
                  region covering the whole wall is left out: its edges are
                  the wall's own, already measured round the outside. */}
              {(() => {
                const wholeWall = (r: Region) => {
                  const b = regionBounds(r);
                  return b.x < 0.5 && b.y < 0.5 && b.w > W - 1 && b.h > H - 1;
                };
                const targets = selected
                  ? [selected]
                  : regions.filter((r) => !wholeWall(r));
                const marks: React.ReactNode[] = [];
                targets.forEach((r, ri) => {
                  const b = regionBounds(r);
                  if (show.lineLength && r.points && r.points.length <= 12) {
                    r.points.forEach((pt, i) => {
                      const q = r.points![(i + 1) % r.points!.length];
                      const len = dist(pt, q);
                      // Only where there is room to read it.
                      if (len * ppc > 46)
                        marks.push(
                          label(
                            (pt[0] + q[0]) / 2,
                            (pt[1] + q[1]) / 2,
                            String(mm(len)),
                            `ll${ri}-${i}`,
                            "#bfe0ff"
                          )
                        );
                    });
                  }
                  if (show.arcHeight && r.kind === "curve" && r.arcHeight) {
                    marks.push(
                      label(
                        b.x + b.w / 2,
                        b.y + b.h,
                        `Arc height ${mm(r.arcHeight)}`,
                        `ah${ri}`,
                        "#c8ffd9",
                        12
                      )
                    );
                  }
                  if (show.startingPoint) {
                    // Where the picture starts: the area's bottom-left corner
                    // as it is seen.
                    const px = Math.min(X(b.x), X(b.x + b.w));
                    const py = Y(b.y);
                    marks.push(
                      <g
                        key={`sp${ri}`}
                        stroke="#ff5d6c"
                        strokeWidth={1.6 * u}
                        fill="none"
                      >
                        <circle cx={px} cy={py} r={5 * u} />
                        <line x1={px - 9 * u} y1={py} x2={px + 9 * u} y2={py} />
                        <line x1={px} y1={py - 9 * u} x2={px} y2={py + 9 * u} />
                      </g>
                    );
                  }
                });
                return <g pointerEvents="none">{marks}</g>;
              })()}

              {measures.map((m, i) =>
                dimension(m.a, m.b, `${mm(dist(m.a, m.b))} mm`, "m" + i)
              )}

              <g pointerEvents="none">{draftShape}</g>
              {/* What the next click will land on. */}
              {hover && tool !== "select" ? (
                <g pointerEvents="none">
                  <rect
                    x={X(hover.pt[0]) - 6 * u}
                    y={Y(hover.pt[1]) - 6 * u}
                    width={12 * u}
                    height={12 * u}
                    fill="rgba(53,208,192,0.35)"
                    stroke="#35d0c0"
                    strokeWidth={1.5 * u}
                  />
                  <rect
                    x={X(hover.pt[0]) + 12 * u}
                    y={Y(hover.pt[1]) + 10 * u}
                    width={hover.kind.length * 7.4 * u + 12 * u}
                    height={20 * u}
                    fill="#3a3a3d"
                    stroke="#55555a"
                    strokeWidth={1 * u}
                  />
                  <text
                    x={X(hover.pt[0]) + 18 * u}
                    y={Y(hover.pt[1]) + 20 * u}
                    fontSize={12 * u}
                    dominantBaseline="middle"
                    fill="#ffffff"
                  >
                    {hover.kind}
                  </text>
                </g>
              ) : null}
              {draft.pts.length && tool === "freepoly" ? (
                <circle
                  cx={X(draft.pts[0][0])}
                  cy={Y(draft.pts[0][1])}
                  r={5 * u}
                  fill="#4c9bff"
                  pointerEvents="none"
                />
              ) : null}
              {draftLabel && draft.cur
                ? label(
                    draft.cur[0],
                    draft.cur[1] + 18 * u,
                    draftLabel,
                    "draft",
                    "#bfe0ff"
                  )
                : null}
            </svg>

            {/* Only while an area is selected: with nothing selected there is
                nothing for it to set, and a locked box showing 0 only gets in
                the way. A strip of light has no depth, so not for that. */}
            {show.extrusion && selected && !selected.light ? (
              <label
                className="we-extrusion"
                style={{ left: extrusionAt.left, top: extrusionAt.top }}
                title={
                  selected
                    ? "How far this area stands out from the wall, in mm"
                    : "Select an area to set how far it stands out"
                }
              >
                Extrusion
                <NumBox
                  // A new box per area, so one area's half-typed figure is
                  // never carried over to the next one selected.
                  key={selectedId || "wall"}
                  min={0}
                  disabled={!selected || !!selected.light}
                  value={selected ? mm(selected.extrusion || 0) : 0}
                  onStart={beginTyping}
                  onValue={(n) =>
                    setRegions((list) =>
                      list.map((r) =>
                        r.id === selectedId ? { ...r, extrusion: n / 10 } : r
                      )
                    )
                  }
                  onDone={endTyping}
                />
              </label>
            ) : null}

            <button
              className={"we-cube" + (previewOpen ? " is-on" : "")}
              title={previewOpen ? "Hide the 3D preview" : "Show the 3D preview"}
              onClick={() => setPreviewOpen(!previewOpen)}
            >
              <Icon name="cube" size={24} />
            </button>

            <div className="we-zoom">
              <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
                <Icon name="zoomOut" />
              </button>
              <input
                type="range"
                min={30}
                max={800}
                value={Math.round(view.scale * 100)}
                onChange={(e) =>
                  setView((v) => ({
                    ...v,
                    scale: clamp(Number(e.target.value) / 100, 0.3, 8),
                  }))
                }
                title={`${Math.round(view.scale * 100)}%`}
              />
              <button onClick={() => zoomBy(1.25)} title="Zoom in">
                <Icon name="zoomIn" />
              </button>
              <button onClick={fitView} title="Fit the wall">
                <Icon name="fit" />
              </button>
            </div>

            <div className="we-right">
              {previewOpen ? (
                <div className="we-preview">
                  <Preview3D
                    width={W}
                    height={H}
                    regions={previewRegions}
                    openings={previewOpenings}
                    size={286}
                  />
                  <div className="we-pop we-room">
                    <button
                      className="we-room-btn"
                      onClick={() => setMenu(menu === "room" ? null : "room")}
                    >
                      Select room
                    </button>
                    {menu === "room" ? (
                      <div className="we-menu we-menu-right">
                        {sides.map((s, i) => (
                          <button
                            key={i}
                            className={
                              "we-menu-item" + (s.edge === edge ? " is-on" : "")
                            }
                            onClick={() => {
                              setMenu(null);
                              if (s.edge === edge || !onSwitchEdge) return;
                              if (
                                dirty &&
                                !window.confirm(
                                  "Switch sides without saving your changes?"
                                )
                              )
                                return;
                              onSwitchEdge(s.edge);
                            }}
                          >
                            <span>{capitalizeText(s.label)}</span>
                          </button>
                        ))}
                        {sides.length < 2 ? (
                          <div className="we-menu-note">
                            This wall has one side.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {selected && sb ? (
                <div className="we-card">
                  <div className="we-side-title">Selected area</div>
                  <dl className="we-facts">
                    <dt>Size</dt>
                    <dd>
                      {mm(sb.w)} × {mm(sb.h)} mm
                    </dd>
                    <dt>From left</dt>
                    <dd>{mm(mirrored ? W - sb.x - sb.w : sb.x)} mm</dd>
                    <dt>From floor</dt>
                    <dd>{mm(sb.y)} mm</dd>
                    <dt>Material</dt>
                    <dd>
                      {selected.light
                        ? "Light"
                        : selected.texture
                        ? capitalizeText(selected.texture.name || "Material")
                        : "None"}
                    </dd>
                  </dl>
                  {selected.kind === "arch" && selected.arch ? (
                    <div className="we-arch" key={selected.id}>
                      <div className="we-side-title">Arch sizes (mm)</div>
                      {(
                        [
                          ["span", "Span", 10],
                          ["rise", "Rise", 0],
                          ["leg", "Leg height", 0],
                          ["thickness", "Thickness", 10],
                        ] as [keyof Arch, string, number][]
                      ).map(([field, name, least]) => (
                        <label key={field}>
                          {name}
                          <NumBox
                            value={mm(selected.arch![field])}
                            min={least}
                            onStart={beginTyping}
                            onValue={(n) => setArch({ [field]: n / 10 })}
                            onDone={endTyping}
                          />
                        </label>
                      ))}
                      <p className="we-muted">
                        Rise is the curved part and cannot be more than half
                        the span. Leg height is the straight part below it.
                      </p>
                    </div>
                  ) : null}
                  <div className="we-row">
                    <select
                      value={splitAxis}
                      onChange={(e) =>
                        setSplitAxis(e.target.value as "h" | "v")
                      }
                    >
                      <option value="h">Line from floor</option>
                      <option value="v">Line from left</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      placeholder="mm"
                      value={splitAt}
                      onChange={(e) => setSplitAt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") splitExact();
                      }}
                    />
                    <button className="we-btn" onClick={splitExact}>
                      Cut
                    </button>
                  </div>
                  <div className="we-row">
                    {selected.texture ? (
                      <button
                        className="we-btn"
                        onClick={() => patchSelected({ texture: null })}
                      >
                        Remove material
                      </button>
                    ) : null}
                    <button className="we-btn" onClick={deleteArea}>
                      Delete area
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </main>
      </div>

      <input
        ref={cadRef}
        type="file"
        accept=".dxf,.dwg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void importCad(file);
        }}
      />
      <input
        ref={pictureRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void searchByPicture(file);
        }}
      />
    </div>,
    document.body
  );
};

export default WallEditorModal;
