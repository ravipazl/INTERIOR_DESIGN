import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * THE IMPORT PREVIEW'S DRAWING SURFACE.
 *
 * Shows what is being imported — a picture (an image, a PDF page) and/or a
 * drawing's lines, layer by layer — with the walls built from it on top, the
 * crop, and the two points of a measurement. Drag to pan, wheel to zoom about
 * the pointer; the preview fits itself to what it shows.
 *
 * Positions are in the source's own units, y UP (a CAD drawing's way); a
 * picture is placed by where its top-left corner falls and how many units a
 * pixel is.
 */

export type Pt = [number, number];
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };
export type PreviewLayer = { name: string; color: string; lines: Float64Array; shown: boolean };
export type PreviewRaster = {
  image: CanvasImageSource;
  w: number;
  h: number;
  /** Where the picture's top-left corner lies, and units per pixel. */
  x0: number;
  y0: number;
  upp: number;
};
export type PreviewWall = { a: Pt; b: Pt; t: number };
export type PreviewTool = "pan" | "measure" | "crop";
/** One drawing of several in a file: where it lies, its number, and whether it is the chosen one. */
export type PreviewRegion = { rect: Rect; label: string; selected: boolean };

type Props = {
  fit: Rect;
  fitKey: string;
  raster?: PreviewRaster | null;
  layers?: PreviewLayer[];
  walls?: PreviewWall[] | null;
  crop?: Rect | null;
  /** A bar shown across the plan, whose length is asked for. */
  ruler?: { a: Pt; b: Pt } | null;
  /** The drawings of a file that holds several: numbered, the chosen one clear, the rest faded. */
  regions?: PreviewRegion[];
  /** A click on a drawing (its index in `regions`) chooses it. */
  onRegionClick?: (index: number) => void;
  points?: Pt[];
  tool: PreviewTool;
  onPoint?: (p: Pt) => void;
  onCrop?: (r: Rect) => void;
  accent: string;
  /** Pixels within which a measuring click snaps to a line's end. */
  snapPx?: number;
};

// A click that moves less than this (CSS px) is a click, not a drag.
const CLICK_SLOP = 4;
const ZOOM_STEP = 1.2;

// Built once per array of lines, not on every frame.
const paths = new WeakMap<Float64Array, Path2D>();
const pathOf = (lines: Float64Array) => {
  let p = paths.get(lines);
  if (!p) {
    p = new Path2D();
    for (let i = 0; i + 3 < lines.length; i += 4) {
      p.moveTo(lines[i], lines[i + 1]);
      p.lineTo(lines[i + 2], lines[i + 3]);
    }
    paths.set(lines, p);
  }
  return p;
};

const cssVar = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

const PreviewCanvas: React.FC<Props> = ({
  fit,
  fitKey,
  raster,
  layers = [],
  walls,
  crop,
  ruler,
  regions,
  onRegionClick,
  points = [],
  tool,
  onPoint,
  onCrop,
  accent,
  snapPx = 10,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The view: world point at the canvas centre, and CSS pixels per unit.
  const view = useRef({ cx: 0, cy: 0, s: 1 });
  const drag = useRef<null | { x: number; y: number; cx: number; cy: number; button: number; moved: boolean; start: Pt }>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  // The drawing under the pointer, to show it can be chosen by a click.
  const [hoverRegion, setHoverRegion] = useState<number | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [, redraw] = useState(0);
  const frame = useRef(0);

  const request = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      redraw((n) => n + 1);
    });
  }, []);

  // Size with the box.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: box.clientWidth, h: box.clientHeight }));
    ro.observe(box);
    setSize({ w: box.clientWidth, h: box.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const w = Math.max(1e-9, fit.maxX - fit.minX);
    const h = Math.max(1e-9, fit.maxY - fit.minY);
    if (!size.w || !size.h) return;
    view.current = {
      cx: (fit.minX + fit.maxX) / 2,
      cy: (fit.minY + fit.maxY) / 2,
      s: Math.min(size.w / w, size.h / h) * 0.92,
    };
    request();
  }, [fit, size, request]);

  useEffect(fitView, [fitKey, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (x: number, y: number): Pt => {
    const v = view.current;
    return [v.cx + (x - size.w / 2) / v.s, v.cy - (y - size.h / 2) / v.s];
  };
  const toScreen = (p: Pt): Pt => {
    const v = view.current;
    return [(p[0] - v.cx) * v.s + size.w / 2, (v.cy - p[1]) * v.s + size.h / 2];
  };

  // The drawing a point lies in — the smallest, when drawings lie inside one another.
  const regionAt = (p: Pt): number | null => {
    let best: number | null = null;
    let bestArea = Infinity;
    (regions || []).forEach((g, i) => {
      const { rect } = g;
      if (p[0] < rect.minX || p[0] > rect.maxX || p[1] < rect.minY || p[1] > rect.maxY) return;
      const area = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    });
    return best;
  };

  // A measuring point snaps to the nearest line end close by.
  const snap = (p: Pt): Pt => {
    const tol = snapPx / view.current.s;
    let best: Pt = p;
    let bestD = tol;
    layers.forEach((l) => {
      if (!l.shown) return;
      const a = l.lines;
      for (let i = 0; i + 1 < a.length; i += 2) {
        const d = Math.abs(a[i] - p[0]) + Math.abs(a[i + 1] - p[1]);
        if (d < bestD) {
          bestD = d;
          best = [a[i], a[i + 1]];
        }
      }
    });
    return best;
  };

  // ── drawing ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const v = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssVar("--pz-input-bg", "#f6f7fb");
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // World (y up) → device pixels.
    const world = () =>
      ctx.setTransform(dpr * v.s, 0, 0, -dpr * v.s, dpr * (size.w / 2 - v.cx * v.s), dpr * (size.h / 2 + v.cy * v.s));

    if (raster) {
      const k = dpr * v.s * raster.upp;
      ctx.setTransform(k, 0, 0, k, dpr * ((raster.x0 - v.cx) * v.s + size.w / 2), dpr * ((v.cy - raster.y0) * v.s + size.h / 2));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(raster.image, 0, 0);
    }

    world();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    layers.forEach((l) => {
      if (!l.shown || !l.lines.length) return;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1 / v.s;
      ctx.stroke(pathOf(l.lines));
    });

    if (walls && walls.length) {
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.45;
      ctx.lineCap = "butt";
      walls.forEach((w) => {
        ctx.lineWidth = Math.max(w.t, 2 / v.s);
        ctx.beginPath();
        ctx.moveTo(w.a[0], w.a[1]);
        ctx.lineTo(w.b[0], w.b[1]);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // Outside the crop dimmed, the crop's edge dashed.
    const r = cropDraft || crop;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Several drawings in one file: the chosen one clear, the others faded,
    // each outlined and numbered like the list.
    if (regions && regions.length > 1) {
      const bg = cssVar("--pz-input-bg", "#f6f7fb");
      // Faded first, then outlines and numbers on top so they stay readable.
      regions.forEach((g) => {
        if (g.selected) return;
        const a = toScreen([g.rect.minX, g.rect.maxY]);
        const b = toScreen([g.rect.maxX, g.rect.minY]);
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = bg;
        ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      });
      ctx.globalAlpha = 1;
      regions.forEach((g, i) => {
        const a = toScreen([g.rect.minX, g.rect.maxY]);
        const b = toScreen([g.rect.maxX, g.rect.minY]);
        const w = b[0] - a[0];
        const h = b[1] - a[1];
        if (w < 2 || h < 2) return;
        ctx.lineWidth = g.selected ? 2.5 : 1;
        ctx.strokeStyle = g.selected ? accent : "rgba(100, 108, 125, 0.7)";
        ctx.setLineDash(g.selected ? [] : [5, 4]);
        ctx.strokeRect(a[0], a[1], w, h);
        ctx.setLineDash([]);
        // The number, in a circle at the drawing's top-left corner.
        const r = g.selected ? 14 : 12;
        const cx = Math.min(a[0] + r + 6, a[0] + w / 2);
        const cy = Math.min(a[1] + r + 6, a[1] + h / 2);
        ctx.fillStyle = g.selected ? accent : "rgba(100, 108, 125, 0.95)";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (hoverRegion === i && !g.selected) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = accent;
          ctx.stroke();
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${g.selected ? 13 : 12}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(g.label, cx, cy + 0.5);
      });
    }

    // The ruler: a bar the width of the plan, with an end mark each side.
    if (ruler) {
      const p = toScreen(ruler.a);
      const q = toScreen(ruler.b);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = accent;
      ctx.lineCap = "butt";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      [p, q].forEach((e) => {
        ctx.beginPath();
        ctx.moveTo(e[0], e[1] - 14);
        ctx.lineTo(e[0], e[1] + 14);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    if (r) {
      const p1 = toScreen([r.minX, r.maxY]);
      const p2 = toScreen([r.maxX, r.minY]);
      ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
      ctx.beginPath();
      ctx.rect(0, 0, size.w, size.h);
      ctx.rect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1]);
      ctx.fill("evenodd");
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1]);
      ctx.setLineDash([]);
    }

    // The measurement.
    const shown: Pt[] = points.slice();
    if (tool === "measure" && shown.length === 1 && hover) shown.push(hover);
    if (shown.length) {
      const q = shown.map(toScreen);
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 2;
      if (q.length === 2) {
        ctx.beginPath();
        ctx.moveTo(q[0][0], q[0][1]);
        ctx.lineTo(q[1][0], q[1][1]);
        ctx.stroke();
      }
      points.map(toScreen).forEach((p) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  // ── pointer ──
  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as Pt;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const [x, y] = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x, y, cx: view.current.cx, cy: view.current.cy, button: e.button, moved: false, start: toWorld(x, y) };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = local(e);
    const d = drag.current;
    if (tool === "measure") {
      setHover(snap(toWorld(x, y)));
    }
    if (tool === "pan" && regions && regions.length > 1 && !(d && d.moved)) {
      const at = regionAt(toWorld(x, y));
      if (at !== hoverRegion) setHoverRegion(at);
    }
    if (!d) return;
    if (Math.abs(x - d.x) + Math.abs(y - d.y) > CLICK_SLOP) d.moved = true;
    if (tool === "crop" && d.button === 0) {
      const p = toWorld(x, y);
      setCropDraft({
        minX: Math.min(d.start[0], p[0]),
        minY: Math.min(d.start[1], p[1]),
        maxX: Math.max(d.start[0], p[0]),
        maxY: Math.max(d.start[1], p[1]),
      });
      return;
    }
    if (d.moved) {
      view.current = { ...view.current, cx: d.cx - (x - d.x) / view.current.s, cy: d.cy + (y - d.y) / view.current.s };
      request();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const [x, y] = local(e);
    if (tool === "crop" && d.button === 0 && cropDraft) {
      const r = cropDraft;
      setCropDraft(null);
      // A box too small to hold a plan is a slip, not a crop.
      if ((r.maxX - r.minX) * view.current.s > 20 && (r.maxY - r.minY) * view.current.s > 20) onCrop?.(r);
      return;
    }
    if (tool === "measure" && d.button === 0 && !d.moved) onPoint?.(snap(toWorld(x, y)));
    // A click (not a drag) on a drawing chooses it.
    if (tool === "pan" && d.button === 0 && !d.moved && regions && regions.length > 1 && onRegionClick) {
      const at = regionAt(toWorld(x, y));
      if (at !== null && !regions[at].selected) onRegionClick(at);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const [x, y] = local(e);
    const before = toWorld(x, y);
    const f = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const s = view.current.s * f;
    view.current = { s, cx: before[0] - (x - size.w / 2) / s, cy: before[1] + (y - size.h / 2) / s };
    request();
  };

  const zoomBy = (f: number) => {
    view.current = { ...view.current, s: view.current.s * f };
    request();
  };

  const choosable = tool === "pan" && hoverRegion !== null && !!regions && !regions[hoverRegion]?.selected;
  const cursor = choosable ? "pointer" : tool === "pan" ? "grab" : "crosshair";
  return (
    <div ref={boxRef} className="relative w-full h-full overflow-hidden" onWheel={onWheel}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(null);
          setHoverRegion(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] shadow-sm">
        {[
          { icon: "add", label: "Zoom in", run: () => zoomBy(ZOOM_STEP) },
          { icon: "remove", label: "Zoom out", run: () => zoomBy(1 / ZOOM_STEP) },
          { icon: "fit_screen", label: "Fit to view", run: fitView },
        ].map((b) => (
          <button
            key={b.icon}
            type="button"
            title={b.label}
            aria-label={b.label}
            onClick={b.run}
            className="flex h-8 w-8 items-center justify-center text-[color:var(--pz-text)] hover:bg-[color:var(--pz-panel-hover)] border-b last:border-b-0 border-[color:var(--pz-panel-border)]"
          >
            <span className="material-symbols-outlined text-[18px]">{b.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PreviewCanvas;
