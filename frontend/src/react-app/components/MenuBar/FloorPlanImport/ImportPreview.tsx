import React, { useEffect, useMemo, useRef, useState } from "react";
import "material-symbols";
import { DXF_UNITS } from "@pazl/main/model/dxfImport";
import { ImportSession } from "@pazl/main/import/importSession";
import { PT_CM } from "@pazl/main/import/pdfSource";
import { XPS_UNIT_CM } from "@pazl/main/import/xpsLines";
import {
  applyImport,
  imageFile,
  planImage,
  toPlanOf,
  uploadBackground,
  vectorBackground,
} from "@pazl/main/import/placeImport";
import PreviewCanvas, { Pt, PreviewLayer, PreviewRaster, PreviewRegion, PreviewTool, Rect } from "./PreviewCanvas";
import { LENGTH_UNITS, defaultLengthUnit, isFeet, lengthToCm } from "./lengths";

/**
 * THE IMPORT PREVIEW — review a floor plan file before it goes into the
 * editor: choose the page, sheet or drawing; which layers to keep and what
 * each one holds; the scale; crop and turn a picture; and whether to build
 * walls from the drawing or keep it as a background to trace. What the
 * preview shows is what is imported.
 *
 * Every choice starts from what the file itself says (its layers' names, its
 * unit, which drawing in a set is the floor plan), so most imports need only
 * "Import".
 */

type Phase =
  | { kind: "reading"; step: string }
  | { kind: "ready" }
  | { kind: "importing"; step: string }
  | { kind: "error"; message: string };

type LayerState = { name: string; role: string; shown: boolean; lines: number; texts: number };

export type ImportResult = { text: string; startScale?: boolean };

const ROLES = [
  { id: "wall", label: "Walls" },
  { id: "door", label: "Doors" },
  { id: "window", label: "Windows" },
  { id: "name", label: "Room names" },
  { id: "ignore", label: "Other" },
];
// Common architectural print scales (1:n), for a PDF or DWFx printed to scale.
const PRINT_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500];
/** The finest a background picture is kept (the 2D view's own limit applies). */
const BACKGROUND_MAX_PX = 6144;
const THUMB_PX = 132;
const ANALYZE_DELAY_MS = 250;

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const metres = (cm: number) => (cm / 100).toFixed(cm >= 1000 ? 1 : 2);

/** A turned copy of a picture (quarter turns), no larger than `max` pixels. */
const turned = (src: CanvasImageSource & { width: number; height: number }, turn: number, max: number) => {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  const c = document.createElement("canvas");
  const side = turn % 180 !== 0;
  c.width = side ? h : w;
  c.height = side ? w : h;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
};

/** Part of a canvas, given in its pixels. */
const cropCanvas = (src: HTMLCanvasElement, x: number, y: number, w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
};

const ImportPreview: React.FC<{ file: File; onClose: (result?: ImportResult) => void }> = ({ file, onClose }) => {
  const session = useMemo(() => new ImportSession(file), [file]);
  const [phase, setPhase] = useState<Phase>({ kind: "reading", step: "Checking the file…" });
  const [source, setSource] = useState<any>(null);

  // PDF
  const [page, setPage] = useState(1);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [pdfHidden, setPdfHidden] = useState<string[]>([]);
  const [render, setRender] = useState<{ canvas: HTMLCanvasElement; scale: number; w: number; h: number } | null>(null);
  // An image, turned
  const [picture, setPicture] = useState<HTMLCanvasElement | null>(null);
  const [turn, setTurn] = useState(0);
  // A drawing's lines: CAD, a DWFx sheet, or a PDF printed from CAD
  const [summary, setSummary] = useState<any>(null);
  const [sheet, setSheet] = useState(0);
  const [drawing, setDrawing] = useState(0);
  const [unit, setUnit] = useState<string>("mm");
  const [layers, setLayers] = useState<LayerState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Scale (pictures, PDFs, DWFx): cm per unit
  const [cmPerUnit, setCmPerUnit] = useState<number | null>(null);
  const [printScale, setPrintScale] = useState<string>("");
  const [points, setPoints] = useState<Pt[]>([]);
  const [length, setLength] = useState("");
  const [lengthUnit, setLengthUnit] = useState<string>(defaultLengthUnit);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [tool, setTool] = useState<PreviewTool>("pan");
  // What the user chose to create. Until they choose, walls are built from a
  // drawing's lines whenever it has any.
  const [userMode, setUserMode] = useState<"walls" | "background" | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overallWidth, setOverallWidth] = useState("");
  // The plan's area typed instead of a length (m² or ft²) — for a drawing that
  // states no dimension anywhere but whose size is known.
  const [areaText, setAreaText] = useState("");
  const [areaUnit, setAreaUnit] = useState<"m2" | "ft2">("m2");
  const [extending, setExtending] = useState(false);
  // The plan's wall lines' extent in the drawing's own units, once known.
  const [planSize, setPlanSize] = useState<{
    w: number;
    h: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  // A drawing with no layer named for walls: which one was taken for them, and
  // for which drawing that was settled (so it is done once, not undone).
  const [wallsNote, setWallsNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [wallsFor, setWallsFor] = useState<any>(null);
  // The plan's overall width as typed (cm). The scale follows it: it is the
  // width of the plan's walls, so it is measured again when the walls are
  // found, or the crop moves.
  const [widthTyped, setWidthTyped] = useState<number | null>(null);
  // Where the scale came from, when the drawing gave it ("12600 mm").
  const [scaleNote, setScaleNote] = useState<string | null>(null);
  // The user took the drawing's own scale away: it is not put back.
  const guessDeclined = useRef(false);
  // The scale box is pointed out for a moment after Import is pressed without one.
  const [attention, setAttention] = useState(false);
  const overallRef = useRef<HTMLInputElement>(null);
  const autoMeasure = useRef(false);

  const kind: string | null = source?.kind || null;
  const isCad = kind === "cad";
  const isPdf = kind === "pdf";
  const isDwfx = kind === "dwfx";
  const isImage = kind === "image";
  const maxPx = Math.min(BACKGROUND_MAX_PX, planImage()?.maxTextureSize || BACKGROUND_MAX_PX);
  const accent = cssVar("--pz-accent", "#5b3df5");

  // ── open ──
  useEffect(() => {
    let live = true;
    session
      .open((step: string) => {
        if (live) setPhase({ kind: "reading", step });
      })
      .then((src) => {
        if (!live) return;
        setSource(src);
        if (src.kind === "cad") takeSummary(src.summary, true);
        setPhase({ kind: "ready" });
      })
      .catch((e) => live && setPhase({ kind: "error", message: e?.userFacing ? e.message : "This file couldn't be read. Save it again and retry." }));
    return () => {
      live = false;
      session.close();
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A drawing's lines arrived: its layers, unit and default choices. */
  const takeSummary = (s: any, cad: boolean) => {
    setSummary(s);
    const architectural = (r: string) => r === "wall" || r === "door" || r === "window";
    const anyRole = s.layers.some((l: any) => architectural(l.role));
    setLayers(
      s.layers.map((l: any) => ({
        name: l.name,
        role: l.role,
        // Only the plan's own layers are kept by default; furniture, hatching,
        // dimensions and title blocks are left out. With no layer recognised,
        // everything is kept.
        shown: anyRole ? architectural(l.role) : true,
        lines: l.lines + l.arcs,
        texts: l.texts,
      }))
    );
    if (cad) {
      setUnit(s.unit || "mm");
      setDrawing(0);
      // No walls found in the best drawing: the drawing is only a background.
      setUserMode(s.drawings[0]?.counts?.walls > 0 ? null : "background");
    }
  };

  // ── an image: turned ──
  useEffect(() => {
    if (!isImage) return;
    setPicture(turned(source.bitmap, turn, maxPx));
  }, [isImage, source, turn, maxPx]);

  // ── a PDF page: rendered, and its lines read ──
  useEffect(() => {
    if (!isPdf) return undefined;
    let live = true;
    setBusy("Rendering page…");
    (async () => {
      try {
        const r = await session.pdfRender(page, { maxPx, hidden: pdfHidden, turn });
        if (!live) return;
        setRender({ canvas: r.canvas, scale: r.scale, w: r.canvas.width / r.scale, h: r.canvas.height / r.scale });
        setBusy("Reading the page's lines…");
        const lines = await session.pdfLines(page, { hidden: pdfHidden, turn });
        if (!live) return;
        if (lines.summary) takeSummary(lines.summary, false);
        else {
          setSummary(null);
          setLayers([]);
        }
      } catch (e: any) {
        if (live) setError(e?.userFacing ? e.message : "This page couldn't be shown.");
      } finally {
        if (live) setBusy(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [isPdf, session, page, pdfHidden, turn, maxPx]); // eslint-disable-line react-hooks/exhaustive-deps

  // PDF page pictures to choose by, a few at a time.
  useEffect(() => {
    if (!isPdf || source.pages < 2) return undefined;
    let live = true;
    (async () => {
      for (let n = 1; n <= source.pages && live; n++) {
        if (thumbs[n]) continue;
        try {
          const url = await session.pdfThumbnail(n, THUMB_PX);
          if (live) setThumbs((t) => ({ ...t, [n]: url }));
        } catch (e) {
          /* a page that can't be drawn small is still listed */
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [isPdf, source, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── a DWFx sheet ──
  useEffect(() => {
    if (!isDwfx) return undefined;
    let live = true;
    setBusy("Reading sheet…");
    session
      .dwfxSheet(sheet)
      .then(({ summary: s }) => live && takeSummary(s, false))
      .catch((e: any) => live && setError(e?.userFacing ? e.message : "This sheet couldn't be read."))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [isDwfx, session, sheet]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different page, sheet or turn starts the scale and crop again.
  useEffect(() => {
    setPoints([]);
    setCrop(null);
    setAnalysis(null);
  }, [page, sheet, turn, drawing]);

  // ── the world the preview shows (source units, y up) ──
  const pageBox: Rect | null = useMemo(() => {
    if (isImage && picture) return { minX: 0, minY: 0, maxX: picture.width, maxY: picture.height };
    if (isPdf && render) return { minX: 0, minY: 0, maxX: render.w, maxY: render.h };
    if (isDwfx && summary?.page) return { minX: 0, minY: 0, maxX: summary.page.w, maxY: summary.page.h };
    return null;
  }, [isImage, picture, isPdf, render, isDwfx, summary]);

  const region: Rect | null = isCad ? summary?.drawings?.[drawing]?.region || null : crop;

  // What the view shows for a CAD file: the chosen drawing, and the drawings
  // lying beside it of about its size — the other versions of the same plan —
  // so the choice can be seen and clicked, and the view does not jump when
  // one of them is chosen instead. A drawing far off, or a small detail, is
  // not brought in: choosing one of those moves the view to it.
  const cadView: Rect | null = useMemo(() => {
    if (!isCad || !summary?.drawings?.length) return null;
    const sel: Rect | undefined = summary.drawings[drawing]?.region;
    if (!sel) return null;
    const side = (r: Rect) => Math.max(r.maxX - r.minX, r.maxY - r.minY);
    const span = side(sel);
    const cx = (sel.minX + sel.maxX) / 2;
    const cy = (sel.minY + sel.maxY) / 2;
    const view = { ...sel };
    summary.drawings.forEach((d: any, i: number) => {
      const r: Rect | undefined = d.region;
      if (!r || i === drawing) return;
      const ratio = side(r) / span;
      const near = Math.hypot((r.minX + r.maxX) / 2 - cx, (r.minY + r.maxY) / 2 - cy) <= span * 1.2;
      if (!near || ratio < 0.6 || ratio > 1.7) return;
      view.minX = Math.min(view.minX, r.minX);
      view.minY = Math.min(view.minY, r.minY);
      view.maxX = Math.max(view.maxX, r.maxX);
      view.maxY = Math.max(view.maxY, r.maxY);
    });
    return view;
  }, [isCad, summary, drawing]);

  const fit: Rect = (isCad ? cadView || region || summary?.bounds : crop || pageBox) || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  // The view is fitted again when what it shows changes — for a CAD file, the
  // area, not which drawing is chosen.
  const fitArea = isCad ? [fit.minX, fit.minY, fit.maxX, fit.maxY].join(",") : drawing;

  const raster: PreviewRaster | null = useMemo(() => {
    if (isImage && picture) return { image: picture, w: picture.width, h: picture.height, x0: 0, y0: picture.height, upp: 1 };
    if (isPdf && render) return { image: render.canvas, w: render.canvas.width, h: render.canvas.height, x0: 0, y0: render.h, upp: 1 / render.scale };
    return null;
  }, [isImage, picture, isPdf, render]);

  const roleColor = (role: string) =>
    role === "wall"
      ? cssVar("--pz-text", "#172033")
      : role === "door" || role === "window"
      ? accent
      : cssVar("--pz-panel-muted", "#7a8191");

  const previewLayers: PreviewLayer[] = useMemo(() => {
    if (!summary || isPdf) return [];
    return layers.map((l) => ({
      name: l.name,
      color: roleColor(l.role),
      lines: summary.lines[l.name] || new Float64Array(),
      shown: l.shown,
    }));
  }, [summary, layers, isPdf]); // eslint-disable-line react-hooks/exhaustive-deps

  // A PDF's lines are not drawn over its own page, but measuring snaps to them.
  const snapLayers: PreviewLayer[] = useMemo(() => {
    if (!isPdf || !summary) return previewLayers;
    return Object.keys(summary.lines).map((name) => ({ name, color: "transparent", lines: summary.lines[name], shown: true }));
  }, [isPdf, summary, previewLayers]);

  // ── scale ──
  const k: number | null = isCad
    ? (DXF_UNITS.find((u) => u.id === unit) || DXF_UNITS[0]).cm
    : printScale
    ? (isDwfx ? XPS_UNIT_CM : PT_CM) * Number(printScale)
    : cmPerUnit;

  const measured = points.length === 2 ? Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) : null;
  const applyLength = () => {
    const realCm = lengthToCm(length, lengthUnit);
    if (!measured || !realCm) {
      setError(
        isFeet(lengthUnit)
          ? `Type the real length of the line you measured, for example 11' 6".`
          : "Type the real length of the line you measured, for example 3504."
      );
      return;
    }
    setError(null);
    setPrintScale("");
    setScaleNote(null);
    setWidthTyped(null);
    setCmPerUnit(realCm / measured);
    setTool("pan");
  };

  const sizeBox = isCad ? region : crop || pageBox;
  // A drawing's plan size — its wall lines, not the sheet — so a scale that
  // is wrong shows up as an impossible size.
  const sizeText =
    k && planSize
      ? `${metres(planSize.w * k)} × ${metres(planSize.h * k)} m`
      : k && sizeBox
      ? `${metres((sizeBox.maxX - sizeBox.minX) * k)} × ${metres((sizeBox.maxY - sizeBox.minY) * k)} m`
      : null;

  // ── walls ──
  const hasLines = !!summary && (isCad || isDwfx || (isPdf && summary.lineCount > 0));
  // A drawing's walls are built unless the user chose a background only; with
  // no scale they can't be, and Import waits — a drawing imported at no scale
  // would be a picture, which is not what it was given for.
  const wantWalls = hasLines && userMode !== "background";
  const needsScale = wantWalls && !k;
  const effectiveMode: "walls" | "background" = wantWalls ? "walls" : "background";
  const wallsReason = !hasLines
    ? isImage || isPdf
      ? "This is a picture, not a drawing: draw the walls over it, or use AI Import."
      : "No lines to build walls from."
    : needsScale
    ? "Set the scale first."
    : null;

  // A drawing that states its own scale — a dimension printed beside its line —
  // is set to it, with nothing to measure: the scale found is shown, and can
  // be changed.
  useEffect(() => {
    const guess = summary?.scaleGuess;
    if (!guess || isCad || k || guessDeclined.current || userMode === "background") return;
    setPrintScale("");
    setCmPerUnit(guess.cmPerUnit);
    setScaleNote(
      guess.note
        ? `from ${guess.note}`
        : `${guess.valueMm} mm, from the dimension printed on the drawing`
    );
    setTool("pan");
  }, [summary, isCad, k, userMode]);

  // A drawing with no scale at all starts by asking for one: the measure tool
  // is on, so clicking two ends of a wall of known length is the first thing
  // to do — or typing the length of the ruler shown over the plan.
  useEffect(() => {
    if (hasLines && !isCad && !k && userMode === null && !summary?.scaleGuess && !autoMeasure.current) {
      autoMeasure.current = true;
      setPoints([]);
      setTool("measure");
    }
  }, [hasLines, isCad, k, userMode, summary]);

  // A CAD file of several drawings: each is numbered in the preview as in the
  // list, the chosen one clear and the others faded, and clicking one chooses it.
  const regions: PreviewRegion[] | undefined =
    isCad && summary?.drawings?.length > 1
      ? summary.drawings.map((d: any, i: number) => ({ rect: d.region, label: String(i + 1), selected: i === drawing }))
      : undefined;

  // The ruler asked about while there is no scale: the plan's width, above it
  // if the view has room there, else below, else just inside its top edge — so
  // it is always in sight (a plan can fill its sheet to the top).
  const ruler: { a: Pt; b: Pt } | null =
    needsScale && planSize && planSize.w > 0
      ? (() => {
          const gap = planSize.h * 0.04;
          let y = planSize.maxY - gap * 0.5;
          if (fit.maxY - planSize.maxY >= gap * 1.6) y = planSize.maxY + gap;
          else if (planSize.minY - fit.minY >= gap * 1.6) y = planSize.minY - gap;
          return { a: [planSize.minX, y] as Pt, b: [planSize.maxX, y] as Pt };
        })()
      : null;

  // Walls depend on what each layer holds, not on which are kept as the
  // background: ticking a layer does not build them again.
  const rolesKey = layers.map((l) => `${l.name}\u0000${l.role}`).join("\u0001");
  const roles = useMemo(() => Object.fromEntries(layers.map((l) => [l.name, l.role])), [rolesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The plan's own size, to show beside the scale (not for a CAD file, whose
  // unit is known and which shows the drawing's size already).
  useEffect(() => {
    if (!hasLines || isCad || !summary) {
      setPlanSize(null);
      return undefined;
    }
    let live = true;
    session
      .planExtent(roles, crop)
      .then((e: NonNullable<typeof planSize>) => live && setPlanSize(e))
      .catch(() => live && setPlanSize(null));
    return () => {
      live = false;
    };
  }, [hasLines, isCad, summary, rolesKey, crop, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // The scale follows a typed width: the width of the plan as now measured
  // (the walls found, the crop drawn) is that many centimetres.
  useEffect(() => {
    if (widthTyped && planSize && planSize.w > 0) setCmPerUnit(widthTyped / planSize.w);
  }, [widthTyped, planSize]);

  /**
   * Set the scale from the plan's AREA, typed: the area of the box the plan
   * fills (its overall width × its overall depth, outside of the walls). The
   * scale that makes that box this big is the one taken.
   */
  const applyArea = async () => {
    const v = Number(String(areaText).trim().replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) {
      setError("Type the plan's area, for example 120 for 120 m².");
      return;
    }
    const realCm2 = areaUnit === "ft2" ? v * 929.0304 : v * 10000;
    setError(null);
    setExtending(true);
    try {
      const extent = await session.planExtent(roles, crop);
      if (!(extent.w > 0 && extent.h > 0)) throw Object.assign(new Error("The plan's size couldn't be measured."), { userFacing: true });
      setPrintScale("");
      setScaleNote(null);
      setWidthTyped(null);
      setCmPerUnit(Math.sqrt(realCm2 / (extent.w * extent.h)));
      setTool("pan");
    } catch (e: any) {
      setError(e?.userFacing ? e.message : "The plan's size couldn't be measured. Measure a known length instead.");
    } finally {
      setExtending(false);
    }
  };

  /** Set the scale from the plan's overall width, typed. */
  const applyOverallWidth = async () => {
    const realCm = lengthToCm(overallWidth, lengthUnit);
    if (!realCm) {
      setError(
        isFeet(lengthUnit)
          ? `Type the plan's overall width, for example 42' 5".`
          : "Type the plan's overall width, for example 12930."
      );
      return;
    }
    setError(null);
    setExtending(true);
    try {
      const extent = await session.planExtent(roles, crop);
      if (!(extent.w > 0)) throw Object.assign(new Error("The plan's width couldn't be measured."), { userFacing: true });
      setPrintScale("");
      setScaleNote(null);
      setWidthTyped(realCm);
      setCmPerUnit(realCm / extent.w);
      setTool("pan");
    } catch (e: any) {
      setError(e?.userFacing ? e.message : "The plan's width couldn't be measured. Measure a known length instead.");
    } finally {
      setExtending(false);
    }
  };

  // A drawing with no layer named for walls: once the scale is known, each layer
  // is tried as the walls and the one that makes the cleanest is taken — until
  // the user says what a layer is themselves. Walls are built after, not
  // before, so the wrong layer is never shown.
  const needsPick = !isCad && !!summary?.autoWalls && !!k && effectiveMode === "walls" && wallsFor !== summary;
  useEffect(() => {
    if (!needsPick) return undefined;
    let live = true;
    setPicking(true);
    session
      .pickWalls(k as number, crop)
      .then((picked: { layer: string; walls: number } | null) => {
        if (!live) return;
        if (picked) {
          // Walls known: only the plan's own layers stay as the background, as
          // for a drawing with layers — a sheet's furniture and fittings are
          // not what the original is kept for. Ticking a layer brings it back.
          setLayers((ls) =>
            ls.map((l) => {
              const role = l.name === picked.layer ? "wall" : l.role === "wall" ? "ignore" : l.role;
              return { ...l, role, shown: role === "wall" || role === "door" || role === "window" };
            })
          );
          setWallsNote(picked.layer);
        } else setWallsNote(null);
        setWallsFor(summary);
      })
      .catch(() => live && setWallsFor(summary))
      .finally(() => live && setPicking(false));
    return () => {
      live = false;
    };
  }, [needsPick, summary, k]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (effectiveMode !== "walls" || !summary || !k || needsPick || picking) {
      setAnalysis(null);
      return undefined;
    }
    let live = true;
    setAnalysing(true);
    const t = window.setTimeout(() => {
      session
        .analyze({ roles, unit: isCad ? unit : (k as number), region })
        .then((a) => live && setAnalysis(a))
        .catch((e: any) => live && setError(e?.userFacing ? e.message : "Walls couldn't be built from this drawing."))
        .finally(() => live && setAnalysing(false));
    }, ANALYZE_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [effectiveMode, summary, roles, unit, k, region, session, isCad, needsPick, picking]);

  const wallsPreview = useMemo(() => {
    if (!analysis) return null;
    const { minX, maxY, k: f } = analysis.frame;
    const C = analysis.floorplan.corners;
    const w = (p: { x: number; y: number }): Pt => [p.x / f + minX, maxY - p.y / f];
    return analysis.floorplan.walls.map((wall: any) => ({
      a: w(C[wall.corner1]),
      b: w(C[wall.corner2]),
      t: (wall.thickness || 10) / f,
    }));
  }, [analysis]);

  // Walls were taken from a layer picked by what it makes, and no layer is a door or a window.
  const noOpenings = !isCad && !!summary?.autoWalls && !layers.some((l) => l.role === "door" || l.role === "window");

  const resultText =
    needsScale
      ? "Set the scale to build the walls: type the length of the purple bar over the plan, or measure a wall you know."
      : effectiveMode === "walls"
      ? needsPick || picking
        ? "Finding the walls…"
        : analysing
        ? "Building walls…"
        : analysis
        ? [
            plural(analysis.counts.walls, "wall"),
            analysis.counts.doors ? plural(analysis.counts.doors, "door") : "",
            analysis.counts.windows ? plural(analysis.counts.windows, "window") : "",
            analysis.counts.columns ? plural(analysis.counts.columns, "column") : "",
            // A drawing with no layers says nothing of its doors and windows: any
            // there are come from the gaps in its walls, and are worth a look.
            noOpenings
              ? analysis.counts.doors || analysis.counts.windows
                ? "openings taken from the gaps in the walls — check them"
                : "walls only: this PDF has no door or window layers"
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : ""
      : "Shown behind the plan. Draw the walls over it.";

  // ── import ──
  const doImport = async () => {
    setError(null);
    if (needsScale) {
      // Not a dead button: point at the box that is missing.
      setError("Type the length of the purple bar over the plan (the plan's overall width) and press Set — or measure a wall you know.");
      setAttention(true);
      window.setTimeout(() => setAttention(false), 2200);
      overallRef.current?.focus();
      overallRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (effectiveMode === "walls" && (!analysis || !analysis.counts.walls)) {
      setError("No walls could be built from these layers. Choose the layer that holds the walls, or import it as a background.");
      return;
    }
    setPhase({ kind: "importing", step: "Saving the background…" });
    try {
      const pi = planImage();
      if (!pi) throw Object.assign(new Error("The 2D plan isn't ready yet. Wait a moment and try again."), { userFacing: true });
      // Walls built: the plan is the walls, doors and windows. The original is
      // not kept behind it — nothing is saved or uploaded for it, and so no
      // background controls appear. (Only a picture imported to be traced keeps
      // its background, below.)
      if (effectiveMode === "walls") {
        setPhase({ kind: "importing", step: "Building the plan…" });
        const made = applyImport({ analysis, sheet: null });
        onClose({
          text: `Imported ${[
            plural(made.walls, "wall"),
            made.doors ? plural(made.doors, "door") : "",
            made.windows ? plural(made.windows, "window") : "",
            made.columns ? plural(made.columns, "column") : "",
            made.named ? `${plural(made.named, "room")} named` : "",
          ]
            .filter(Boolean)
            .join(" · ")}.`,
        });
        return;
      }

      // From here, a background only: a picture or a drawing's lines to trace.
      let bg: any;
      let sheetSize: { w: number; h: number } | null = null;
      let pixels: { w: number; h: number } | null = null;

      if (isImage || isPdf) {
        // The picture, cropped: what was shown.
        const src = isImage ? picture! : render!.canvas;
        const upp = isImage ? 1 : 1 / render!.scale;
        const H = isImage ? picture!.height : render!.h;
        const box = crop || pageBox!;
        const px = { x: box.minX / upp, y: (H - box.maxY) / upp, w: (box.maxX - box.minX) / upp, h: (box.maxY - box.minY) / upp };
        const canvas = crop ? cropCanvas(src as HTMLCanvasElement, px.x, px.y, px.w, px.h) : (src as HTMLCanvasElement);
        const img = await imageFile(canvas);
        bg = { kind: "image", ...img };
        pixels = { w: canvas.width, h: canvas.height };
        if (k) sheetSize = { w: (box.maxX - box.minX) * k, h: (box.maxY - box.minY) * k };
      } else {
        // A drawing's chosen layers, as lines.
        const frame = { minX: fit.minX, maxY: fit.maxY, k: k as number };
        const vec = vectorBackground(summary.lines, layers, toPlanOf(frame), region);
        if (!vec) throw Object.assign(new Error("No layer is chosen to keep. Tick at least one layer."), { userFacing: true });
        bg = { kind: "vector", blob: vec.blob };
        sheetSize = { w: vec.w, h: vec.h };
      }

      const uploaded = await uploadBackground(bg, file.name);
      setPhase({ kind: "importing", step: "Placing the background…" });

      if (!sheetSize) {
        // A picture of unknown scale: shown whole, then scaled on the plan.
        pi.add(uploaded.url, pixels!.w, pixels!.h);
        pi.fitView();
        onClose({ text: "Background added. Click both ends of a known wall to set its scale.", startScale: true });
        return;
      }
      const centre = pi.viewCentre;
      const sheetSettings = { ...uploaded, x: centre.x, y: centre.y, width: sheetSize.w, height: sheetSize.h, locked: true };
      applyImport({ analysis: null, sheet: sheetSettings });
      onClose({ text: `Background added at real size${sizeText ? ` (${sizeText})` : ""}. Draw the walls over it.` });
    } catch (e: any) {
      console.error("Floor plan import failed", e);
      setPhase({ kind: "ready" });
      setError(e?.userFacing ? e.message : "The import couldn't be finished. Please try again.");
    }
  };

  // Esc closes (unless a tool is on: then it ends the tool).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tool !== "pan") setTool("pan");
      else if (phase.kind !== "importing") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, phase.kind, onClose]);

  // ── UI ──
  const section = "border-b border-[color:var(--pz-panel-border)] px-4 py-3";
  const heading = "text-[12px] font-semibold text-[color:var(--pz-text)] mb-2";
  const small = "text-[11px] leading-snug text-[color:var(--pz-text-2)]";
  const fieldBase =
    "rounded-md border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] text-[color:var(--pz-text)] text-[12px] px-2 py-1.5";
  const field = `w-full ${fieldBase}`;
  // A unit dropdown beside a number box: its own width, not the box's.
  const unitField = `w-[64px] shrink-0 ${fieldBase}`;
  const btn =
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-[color:var(--pz-panel-border)] px-2.5 py-1.5 text-[12px] font-medium text-[color:var(--pz-text)] hover:bg-[color:var(--pz-panel-hover)] disabled:opacity-50 disabled:cursor-not-allowed";
  const on = "border-[color:var(--pz-accent)] text-[color:var(--pz-accent)] bg-[color:var(--pz-accent-tint)]";
  const Icon = ({ name }: { name: string }) => <span className="material-symbols-outlined text-[17px]">{name}</span>;

  const ready = phase.kind === "ready";
  const toolHint =
    tool === "measure"
      ? points.length < 2
        ? "Click both ends of a wall or dimension whose length you know."
        : "Type the real length on the left."
      : tool === "crop"
      ? "Drag a box around the floor plan. Everything outside is left out."
      : null;

  const layerList = (forPdf: boolean) => (
    <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto pr-1">
      {layers.map((l, i) => (
        <div key={l.name} className="flex items-center gap-2">
          {!forPdf ? (
            <input
              type="checkbox"
              checked={l.shown}
              aria-label={`Keep layer ${l.name}`}
              onChange={(e) => setLayers((ls) => ls.map((x, j) => (j === i ? { ...x, shown: e.target.checked } : x)))}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--pz-text)]" title={`${l.name} · ${plural(l.lines, "line")}`}>
            {l.name}
            <span className="ml-1 text-[11px] text-[color:var(--pz-text-2)] tabular-nums">{l.lines}</span>
          </span>
          <select
            value={l.role}
            aria-label={`What layer ${l.name} holds`}
            onChange={(e) => {
              // The user has said what a layer is: the walls are not picked for them again.
              setWallsFor(summary);
              setLayers((ls) => ls.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)));
            }}
            className="w-[104px] rounded-md border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] text-[color:var(--pz-text)] text-[11px] px-1 py-1"
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import floor plan"
    >
      <div className="flex h-[min(820px,100%)] w-[min(1240px,100%)] flex-col overflow-hidden rounded-xl border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-[color:var(--pz-panel-border)] px-4 py-3">
          <span className="material-symbols-outlined text-[22px] text-[color:var(--pz-accent)]">upload_file</span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[color:var(--pz-text)]">Import floor plan</div>
            <div className={`${small} truncate`}>
              {file.name}
              {session.label ? ` · ${session.label}` : ""}
            </div>
          </div>
          <button type="button" className={btn} onClick={() => onClose()} disabled={phase.kind === "importing"} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {phase.kind === "reading" || phase.kind === "error" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            {phase.kind === "reading" ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[28px] text-[color:var(--pz-accent)]">progress_activity</span>
                <div className="text-[13px] text-[color:var(--pz-text)]">{phase.step}</div>
                <button type="button" className={btn} onClick={() => onClose()}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[30px] text-red-600 dark:text-red-400">error</span>
                <div className="max-w-[460px] text-[13px] leading-relaxed text-[color:var(--pz-text)]">{phase.message}</div>
                <button type="button" className={btn} onClick={() => onClose()}>
                  Close
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
            {/* options */}
            <div className="min-h-0 overflow-y-auto border-r border-[color:var(--pz-panel-border)]">
              {isPdf && source.pages > 1 ? (
                <div className={section}>
                  <div className={heading}>Page</div>
                  <div className="grid grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1">
                    {Array.from({ length: source.pages }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        className={`flex flex-col items-center gap-1 rounded-md border p-1 ${n === page ? on : "border-[color:var(--pz-panel-border)]"}`}
                        aria-pressed={n === page}
                      >
                        <div className="flex h-[70px] w-full items-center justify-center overflow-hidden bg-white">
                          {thumbs[n] ? <img src={thumbs[n]} alt={`Page ${n}`} className="max-h-full max-w-full" /> : null}
                        </div>
                        <span className="text-[11px] tabular-nums">{n}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {isDwfx && source.sheets.length > 1 ? (
                <div className={section}>
                  <div className={heading}>Sheet</div>
                  <select className={field} value={sheet} onChange={(e) => setSheet(Number(e.target.value))}>
                    {source.sheets.map((s: any, i: number) => (
                      <option key={s.name} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {!isCad && pageBox ? (
                <div
                  className={`${section} ${needsScale ? "bg-[color:var(--pz-accent-tint)]" : ""} ${
                    attention ? "ring-2 ring-inset ring-[color:var(--pz-accent)] animate-pulse" : ""
                  }`}
                >
                  <div className={`${heading} flex items-center justify-between`}>
                    <span>Scale</span>
                    {needsScale ? (
                      <span className="rounded bg-[color:var(--pz-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">Needed for walls</span>
                    ) : k ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span> Set
                      </span>
                    ) : null}
                  </div>

                  {scaleNote ? (
                    <div className="mb-2 rounded-md border border-green-600/40 bg-green-50 p-2 dark:bg-green-900/20">
                      <p className="text-[12px] font-medium leading-snug text-green-800 dark:text-green-300">Scale found: {scaleNote}.</p>
                      <button
                        type="button"
                        className="mt-1 text-[11px] underline text-[color:var(--pz-text-2)] hover:text-[color:var(--pz-text)]"
                        onClick={() => {
                          guessDeclined.current = true;
                          setScaleNote(null);
                          setWidthTyped(null);
                          setCmPerUnit(null);
                          setPoints([]);
                          setTool("measure");
                        }}
                      >
                        Change
                      </button>
                    </div>
                  ) : null}

                  {needsScale ? (
                    <p className={`${small} mb-2`}>
                      A PDF doesn't say how big the plan really is. The purple bar over the plan is its overall width: type its real length. Don't know it? Press
                      "Or measure a wall you know" and click both ends of a room whose size is written on the plan, such as 12'-4".
                    </p>
                  ) : null}

                  {hasLines && !scaleNote ? (
                    <div>
                      <span className="text-[11px] font-medium text-[color:var(--pz-text)]">Length of the plan, outside of the walls, left to right</span>
                      <div className="mt-1 flex gap-1.5">
                        <input
                          ref={overallRef}
                          inputMode="decimal"
                          className={`${field} min-w-0 flex-1`}
                          placeholder="Length"
                          value={overallWidth}
                          aria-label="Overall width"
                          onChange={(e) => setOverallWidth(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && applyOverallWidth()}
                        />
                        <select className={unitField} value={lengthUnit} onChange={(e) => setLengthUnit(e.target.value)} aria-label="Unit of the overall width">
                          {LENGTH_UNITS.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.label}
                            </option>
                          ))}
                        </select>
                        <button type="button" className={btn} onClick={applyOverallWidth} disabled={extending}>
                          {extending ? "…" : "Set"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {hasLines && !scaleNote ? (
                    <div className="mt-2">
                      <span className="text-[11px] font-medium text-[color:var(--pz-text)]">Or the plan's area (the box it fills, outside of the walls)</span>
                      <div className="mt-1 flex gap-1.5">
                        <input
                          inputMode="decimal"
                          className={`${field} min-w-0 flex-1`}
                          placeholder="Area"
                          value={areaText}
                          aria-label="Plan area"
                          onChange={(e) => setAreaText(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && applyArea()}
                        />
                        <select className={unitField} value={areaUnit} onChange={(e) => setAreaUnit(e.target.value as "m2" | "ft2")} aria-label="Unit of the area">
                          <option value="m2">m²</option>
                          <option value="ft2">ft²</option>
                        </select>
                        <button type="button" className={btn} onClick={applyArea} disabled={extending}>
                          {extending ? "…" : "Set"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className={`flex gap-2 ${hasLines && !scaleNote ? "mt-2" : ""}`}>
                    <button
                      type="button"
                      className={`${btn} flex-1 ${tool === "measure" ? on : ""}`}
                      onClick={() => {
                        setPoints([]);
                        setTool(tool === "measure" ? "pan" : "measure");
                      }}
                    >
                      <Icon name="straighten" /> {hasLines ? "Or measure a wall you know" : "Measure a known length"}
                    </button>
                  </div>
                  {points.length === 2 ? (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        autoFocus
                        inputMode="decimal"
                        className={`${field} min-w-0 flex-1`}
                        placeholder="Length"
                        value={length}
                        aria-label="Real length"
                        onChange={(e) => setLength(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && applyLength()}
                      />
                      <select className={unitField} value={lengthUnit} onChange={(e) => setLengthUnit(e.target.value)} aria-label="Unit">
                        {LENGTH_UNITS.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={btn} onClick={applyLength}>
                        Set
                      </button>
                    </div>
                  ) : null}
                  {isPdf || isDwfx ? (
                    <label className="mt-2 block">
                      <span className={small}>Or, printed to scale at</span>
                      <select
                        className={`${field} mt-1`}
                        value={printScale}
                        onChange={(e) => {
                          setPrintScale(e.target.value);
                          setScaleNote(null);
                          setWidthTyped(null);
                          if (e.target.value) setCmPerUnit(null);
                        }}
                      >
                        <option value="">Not known</option>
                        {PRINT_SCALES.map((n) => (
                          <option key={n} value={n}>{`1:${n}`}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <p className={`${small} mt-1.5`}>
                    {k
                      ? `Scale set. ${planSize ? "The plan" : crop ? "The cropped plan" : "The page"} is ${sizeText}.`
                      : hasLines
                      ? "Not set yet."
                      : "Not set yet. Without a scale the background is added at any size, and can be scaled on the plan."}
                  </p>
                </div>
              ) : null}

              {isCad && summary?.drawings?.length > 1 ? (
                <div className={section}>
                  <div className={heading}>Drawing</div>
                  <select className={field} value={drawing} onChange={(e) => setDrawing(Number(e.target.value))}>
                    {summary.drawings.map((d: any, i: number) => (
                      <option key={i} value={i}>
                        {`Drawing ${i + 1} · ${d.size.w.toFixed(1)} × ${d.size.h.toFixed(1)} m${
                          d.counts
                            ? ` · ${d.counts.walls} walls · ${d.counts.doors} doors · ${d.counts.windows} windows`
                            : ""
                        }${i === 0 ? " · suggested" : ""}`}
                      </option>
                    ))}
                  </select>
                  <p className={`${small} mt-1`}>
                    {`This file holds ${summary.drawings.length} drawings, numbered in the preview. The one most like a floor plan is chosen first. Click a numbered drawing in the preview, or pick it here: only the chosen one is imported.`}
                  </p>
                </div>
              ) : null}

              {isPdf && source.layers.length ? (
                <div className={section}>
                  <div className={heading}>PDF layers</div>
                  <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto pr-1">
                    {source.layers.map((l: any) => (
                      <label key={l.id} className="flex items-center gap-2 text-[12px] text-[color:var(--pz-text)]">
                        <input
                          type="checkbox"
                          checked={!pdfHidden.includes(l.id)}
                          onChange={(e) =>
                            setPdfHidden((h) => (e.target.checked ? h.filter((x) => x !== l.id) : [...h, l.id]))
                          }
                        />
                        <span className="truncate">{l.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className={`${small} mt-1`}>Untick layers such as furniture, dimensions or the title block.</p>
                </div>
              ) : null}

              {(isCad || isDwfx) && layers.length ? (
                <div className={section}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[color:var(--pz-text)]">Layers</span>
                    <span className="flex gap-2 text-[11px]">
                      <button type="button" className="underline text-[color:var(--pz-text-2)]" onClick={() => setLayers((ls) => ls.map((l) => ({ ...l, shown: true })))}>
                        All
                      </button>
                      <button
                        type="button"
                        className="underline text-[color:var(--pz-text-2)]"
                        onClick={() => setLayers((ls) => ls.map((l) => ({ ...l, shown: ["wall", "door", "window"].includes(l.role) })))}
                      >
                        Plan only
                      </button>
                    </span>
                  </div>
                  {layerList(false)}
                  <p className={`${small} mt-1.5`}>Ticked layers are kept as the background. The role says what each holds, for building walls.</p>
                </div>
              ) : null}

              {isPdf && summary && effectiveMode === "walls" ? (
                <div className={section}>
                  <div className={heading}>What the lines are</div>
                  {wallsNote ? (
                    <p className={`${small} mb-2`}>
                      Walls are taken from <span className="font-medium text-[color:var(--pz-text)]">{wallsNote}</span> — the lines that make the cleanest
                      walls. This PDF has no layers of its own, so lines are told apart by how they're drawn. Change it here if it's wrong.
                    </p>
                  ) : null}
                  {layerList(true)}
                </div>
              ) : null}

              {effectiveMode === "walls" && analysis?.checks?.length ? (
                <div className={section}>
                  <div className={heading}>Check these</div>
                  <p className={`${small} mb-1.5`}>
                    Not everything is drawn on this plan. Where a size or a swing was taken for a typical value, it is listed here instead of being passed off
                    as measured. Each can be changed in the 2D plan after importing.
                  </p>
                  <ul className={`${small} list-disc pl-4 space-y-1`}>
                    {analysis.checks.map((c: string) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {isCad ? (
                <div className={section}>
                  <div className={heading}>Units</div>
                  <select className={field} value={unit} onChange={(e) => setUnit(e.target.value)}>
                    {DXF_UNITS.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                        {summary?.unitFromFile === u.id ? " (from the file)" : ""}
                      </option>
                    ))}
                  </select>
                  {sizeText ? <p className={`${small} mt-1`}>{`The plan is ${sizeText}. If that's wrong, the unit is.`}</p> : null}
                </div>
              ) : null}

              {(isImage || isPdf || isDwfx) && pageBox ? (
                <div className={section}>
                  <div className={heading}>Adjust</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={`${btn} ${tool === "crop" ? on : ""}`} onClick={() => setTool(tool === "crop" ? "pan" : "crop")}>
                      <Icon name="crop" /> Crop to plan
                    </button>
                    {crop ? (
                      <button type="button" className={btn} onClick={() => setCrop(null)}>
                        Clear crop
                      </button>
                    ) : null}
                    {!isDwfx ? (
                      <>
                        <button type="button" className={btn} title="Turn left 90°" aria-label="Turn left 90°" onClick={() => setTurn((t) => (t + 270) % 360)}>
                          <Icon name="rotate_left" />
                        </button>
                        <button type="button" className={btn} title="Turn right 90°" aria-label="Turn right 90°" onClick={() => setTurn((t) => (t + 90) % 360)}>
                          <Icon name="rotate_right" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className={section}>
                <div className={heading}>Create</div>
                {[
                  {
                    id: "walls",
                    icon: "foundation",
                    title: "Walls, doors and windows",
                    text: "Built from the drawing's lines, to scale.",
                    disabled: !hasLines,
                  },
                  {
                    id: "background",
                    icon: "layers",
                    title: "Background to trace",
                    text: "Shown behind the plan at real size. Draw the walls over it.",
                    disabled: false,
                  },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => setUserMode(o.id as "walls" | "background")}
                    aria-pressed={effectiveMode === o.id}
                    className={`mb-2 flex w-full items-start gap-2 rounded-lg border p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                      effectiveMode === o.id ? on : "border-[color:var(--pz-panel-border)] hover:bg-[color:var(--pz-panel-hover)]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px] text-[color:var(--pz-accent)]">{o.icon}</span>
                    <span>
                      <span className="block text-[12px] font-semibold text-[color:var(--pz-text)]">{o.title}</span>
                      <span className={small}>{o.id === "walls" && wallsReason ? wallsReason : o.text}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* preview */}
            <div className="relative min-h-0">
              <PreviewCanvas
                fit={fit}
                fitKey={`${kind}-${page}-${sheet}-${fitArea}-${turn}-${crop ? "c" : ""}-${!!pageBox}-${!!summary}`}
                raster={raster}
                layers={isPdf ? (tool === "measure" ? snapLayers : []) : previewLayers}
                walls={effectiveMode === "walls" ? wallsPreview : null}
                ruler={ruler}
                regions={regions}
                onRegionClick={setDrawing}
                crop={crop}
                points={points}
                tool={tool}
                accent={accent}
                onPoint={(p) => setPoints((ps) => (ps.length >= 2 ? [p] : [...ps, p]))}
                onCrop={(r) => {
                  setCrop(r);
                  setTool("pan");
                }}
              />
              {toolHint || busy ? (
                <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-panel-surface)] px-2.5 py-1.5 text-[12px] text-[color:var(--pz-text)] shadow-sm">
                  {busy || toolHint}
                </div>
              ) : null}
              {summary?.truncated ? (
                <div className="pointer-events-none absolute left-3 bottom-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 border border-amber-200">
                  Very detailed drawing: only part of it is shown. Crop or untick layers to see the rest.
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* footer */}
        {ready || phase.kind === "importing" ? (
          <div className="flex items-center gap-3 border-t border-[color:var(--pz-panel-border)] px-4 py-3">
            <div className="min-w-0 flex-1">
              {error ? (
                <p className="text-[12px] leading-snug text-red-600 dark:text-red-400">{error}</p>
              ) : (
                <p className={`${small} ${needsScale ? "font-medium text-[color:var(--pz-text)]" : ""}`}>
                  {phase.kind === "importing" ? phase.step : resultText}
                </p>
              )}
            </div>
            <button type="button" className={btn} onClick={() => onClose()} disabled={phase.kind === "importing"}>
              Cancel
            </button>
            <button
              type="button"
              onClick={doImport}
              disabled={phase.kind === "importing" || !!busy || (effectiveMode === "walls" && !needsScale && analysing)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--pz-accent)] px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Icon name="download" />
              {phase.kind === "importing" ? "Importing…" : "Import"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ImportPreview;
