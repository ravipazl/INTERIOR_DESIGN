import React, { useCallback, useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import {
  generateItemDrawing,
  generateItemSchematic,
  generateItemOutline,
} from "@pazl/main/drawing2d/Drawing2DEngine";
import {
  buildSVG,
  exportSVG,
  exportDXF,
  exportPDF,
  buildWorkingDrawingSVG,
  exportWorkingDrawingSVG,
} from "@pazl/main/drawing2d/Drawing2DExport";
import { TexturesService } from "@pazl/services/texturesService";
import { RatesService } from "@pazl/services/RatesService";
import { Box3, Vector3 } from "three";

/**
 * Drawing2DModal — generates and previews an AutoCAD-style 2D technical
 * drawing (Front / Top / Left / Right, with hidden-line removal) for the
 * selected furniture item, and exports it to SVG / DXF / PDF.
 *
 * Generation runs against the live three.js renderer; the modal auto-runs
 * it on open. All styling is inline so the widget is self-contained.
 */

interface Drawing2DModalProps {
  show: boolean;
  onClose: () => void;
  selectedModel: any; // FurnishedModel
}

const Drawing2DModal: React.FC<Drawing2DModalProps> = ({
  show,
  onClose,
  selectedModel,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // "shop" = the plain 4-view technical drawing; "working" = the architectural
  // sheet (legend + key plan + title block) for THIS item, like the reference
  // per-unit sheets. Both are built from the same drawing result.
  const [tab, setTab] = useState<"shop" | "working">("shop");
  // "detailed" projects the real mesh edges (accurate, but noisy on beds /
  // sofas); "schematic" draws one clean rectangle per component — the
  // professional working-drawing look. Both sheets (shop + working) use it.
  const [drawStyle, setDrawStyle] = useState<
    "detailed" | "outline" | "schematic"
  >("detailed");
  // Dashed hidden lines clutter detailed drawings — off by default; the toggle
  // lets the user bring them back. (Schematic has no hidden lines regardless.)
  const [showHidden, setShowHidden] = useState(false);
  const [wdViewId, setWdViewId] = useState<"front" | "left" | "right">("front");
  const [wdTitle, setWdTitle] = useState("");
  const [wdViewNumber, setWdViewNumber] = useState("1");
  const [wdWallCode, setWdWallCode] = useState("A");
  const [wdSite, setWdSite] = useState("");
  const [wdRevisionNo, setWdRevisionNo] = useState("00");
  const [wdDrawnBy, setWdDrawnBy] = useState("");
  const [wdCheckedBy, setWdCheckedBy] = useState("");

  // Core-material types master (each has grades[]). The Components panel shows a
  // part's grade as `coreMaterialGrade || the type's first grade`, so the sheet
  // must resolve it the same way — otherwise a part whose grade was never saved
  // explicitly (the common case) reads blank while the panel shows a value.
  const [coreMaterialTypes, setCoreMaterialTypes] = useState<any[]>([]);
  // Finishing masters — a part's exterior finish is stored as an id; these
  // resolve id -> name (colour code) + brand, the same way the Components panel
  // shows "Wood 10002 | Greenlam".
  const [finishingsList, setFinishingsList] = useState<any[]>([]);
  const [finishingBrands, setFinishingBrands] = useState<any[]>([]);
  // Bumped after a legend edit writes back to a 3D component, to re-render the
  // legend from the updated in-memory component data.
  const [compRev, setCompRev] = useState(0);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    (async () => {
      try {
        const [types, finishings, brands] = await Promise.all([
          TexturesService.getAllCoreMaterialTypes(),
          TexturesService.getFinishingsFromLocalStorage(),
          RatesService.getFinishingBrands()
        ]);
        if (cancelled) return;
        setCoreMaterialTypes(
          Array.isArray(types) ? types : (types as any)?.data || []
        );
        setFinishingsList(finishings || []);
        setFinishingBrands(brands || []);
      } catch (e) {
        console.error("Drawing2DModal ~ masters", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show]);

  const resolvePhysicalItem = (): any => {
    const models: any[] = BlueprintInterface?.selectedModels || [];
    if (!models.length) return null;
    const id = selectedModel?._id;
    return (
      models.find(
        (m) => m?.itemModel?.id === id || m?.__itemModel?.__id === id
      ) || models[models.length - 1]
    );
  };

  const generate = useCallback(async () => {
    setError(null);
    setLoading(true);
    setSvg(null);
    setResult(null);
    // Let the spinner paint before the synchronous, heavy generation.
    await new Promise((r) => setTimeout(r, 40));
    try {
      const physical = resolvePhysicalItem();
      // The live 3D viewer is blueprint3d.roomplanner (a Viewer3D); its
      // WebGLRenderer is needed for the hidden-line depth pass.
      const bp3d: any = BlueprintInterface?.blueprint3d;
      const renderer =
        bp3d?.roomplanner?.renderer || bp3d?.viewer3d?.renderer;
      if (!physical) {
        throw new Error("Select a furniture item in the 3D view first.");
      }
      if (!renderer) {
        throw new Error("The 3D viewer is not ready yet.");
      }
      const itemName =
        selectedModel?.model?.name ||
        physical?.__itemModel?.__metadata?.name;
      // Schematic mode = clean component boxes (no renderer needed); detailed
      // mode = real mesh edges with hidden-line removal.
      const res =
        drawStyle === "schematic"
          ? generateItemSchematic(physical, { itemName })
          : drawStyle === "outline"
          ? generateItemOutline(physical, renderer, { itemName })
          : generateItemDrawing(physical, renderer, { itemName });
      // Drop dashed hidden lines unless the user turned them on.
      res.showHidden = showHidden;
      setResult(res);
      setSvg(buildSVG(res));
    } catch (e: any) {
      setError(e?.message || "Failed to generate the 2D drawing.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, drawStyle, showHidden]);

  // Toggling hidden lines only re-skins the existing drawing — rebuild the SVG
  // from the current result instead of regenerating the (heavy) geometry.
  useEffect(() => {
    if (result) setSvg(buildSVG({ ...result, showHidden }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  useEffect(() => {
    if (show) {
      generate();
    } else {
      setSvg(null);
      setResult(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, drawStyle]);

  if (!show) return null;

  const btn = (
    bg: string,
    onClick: () => void,
    label: string,
    enabled: boolean
  ) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={enabled ? onClick : undefined}
      style={{
        padding: "8px 16px",
        borderRadius: 6,
        border: "none",
        background: enabled ? bg : "#c7c7c7",
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        cursor: enabled ? "pointer" : "not-allowed",
      }}
    >
      {label}
    </button>
  );

  const fld = (): React.CSSProperties => ({
    width: "100%",
    padding: "4px 6px",
    fontSize: 12,
    border: "1px solid #d1d5db",
    borderRadius: 4,
    background: "#fff",
    color: "#222",
    boxSizing: "border-box",
    fontFamily: "inherit",
  });

  const buildWdProject = () => ({
    title: wdTitle || result?.itemName || "",
    viewNumber: wdViewNumber,
    wallCode: wdWallCode,
    site: wdSite,
    date: new Date().toISOString(),
    revisionNo: wdRevisionNo,
    drawnBy: wdDrawnBy,
    checkedBy: wdCheckedBy,
  });

  /**
   * This item's material specs for the legend. Because the sheet covers ONE
   * unit, the carcass/shutter split is unambiguous — the reference lists exactly
   * two rows and no brand, so we show the most-used board grade per role.
   * A part named "…shutter…" is the door; everything else counts as carcass.
   */
  const buildWdMaterials = (): { label: string; value: string }[] => {
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      const comps: any[] =
        pm?.getFurnishedModelComponents?.(selectedModel?._id) || [];

      // Resolve a part's grade exactly like the Components panel: the saved
      // coreMaterialGrade, else the FIRST grade of the part's core-material type,
      // else the first grade in the master list. This makes the sheet match what
      // the user sees, since grades are usually shown-by-default, not saved.
      const gradeOf = (c: any): string => {
        const saved = String(c?.coreMaterialGrade || "").trim();
        if (saved) return saved;
        const typeId = c?.coreMaterialTypeId || c?.coreMaterialType?._id;
        const type =
          c?.coreMaterialType ||
          coreMaterialTypes.find((t) => t?._id === typeId);
        const typeGrade = type?.grades?.[0];
        if (typeGrade) return String(typeGrade).trim();
        return String(coreMaterialTypes?.[0]?.grades?.[0] || "").trim();
      };

      const carcass = new Map<string, number>();
      const shutter = new Map<string, number>();
      for (const c of comps) {
        const grade = gradeOf(c);
        if (!grade) continue;
        const isShutter = String(c?.name || "")
          .toLowerCase()
          .includes("shutter");
        const bag = isShutter ? shutter : carcass;
        bag.set(grade, (bag.get(grade) || 0) + 1);
      }
      const dominant = (m: Map<string, number>) => {
        let best = "";
        let n = -1;
        m.forEach((count, grade) => {
          if (count > n) {
            best = grade;
            n = count;
          }
        });
        return best;
      };
      // Always show BOTH rows so the table structure stays consistent; the value
      // is the real dominant grade, or BLANK when the unit has no such part /
      // grade (never a hard-coded placeholder).
      const carcassGrade = dominant(carcass);
      const shutterGrade = dominant(shutter);
      return [
        { label: "Carcass material", value: carcassGrade || "" },
        { label: "Shutter material", value: shutterGrade || "" }
      ];
    } catch (_) {
      return [];
    }
  };

  /**
   * PARTICULARS | COLOUR CODE AND BRAND rows. PART-based: one code per visible/
   * named part (Shutter, Handle, Counter top, …), NOT per finish — carcass and
   * unnamed parts are excluded. Assigned in a fixed order so a shutter+handle
   * unit reads "Shutter S1", "Handle S2". Value = the part's exterior finish
   * (colour code) + brand, resolved from the masters by id when needed.
   */
  const pickById = (list: any[], id: any) =>
    id ? list?.find((x: any) => x?._id === id) : undefined;

  // The coded parts (Shutter S1, Handle H1 …) WITH their component objects, so
  // the legend editor can drive the real 3D component (finish + brand). Same
  // role/order/code scheme as the legend so codes always agree.
  const getCodedParts = (): { code: string; role: string; comp: any }[] => {
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      const comps: any[] =
        pm?.getFurnishedModelComponents?.(selectedModel?._id) || [];
      const roleOf = (name: string): string | null => {
        const n = String(name || "").toLowerCase();
        if (n.includes("shutter") || n.includes("door")) return "Shutter";
        if (n.includes("handle")) return "Handle";
        if (n.includes("counter")) return "Counter top";
        if (n.includes("tray")) return "Tray";
        if (n.includes("hanger")) return "Hanger";
        return null;
      };
      const ORDER = ["Shutter", "Handle", "Counter top", "Tray", "Hanger"];
      const byRole = new Map<string, any[]>();
      for (const c of comps) {
        const role = roleOf(c?.name);
        if (!role) continue;
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role)!.push(c);
      }
      const out: { code: string; role: string; comp: any }[] = [];
      const letterCount = new Map<string, number>();
      for (const role of ORDER) {
        const list = byRole.get(role);
        if (!list || !list.length) continue;
        const letter = role.charAt(0).toUpperCase();
        for (const c of list) {
          const num = (letterCount.get(letter) || 0) + 1;
          letterCount.set(letter, num);
          out.push({ code: `${letter}${num}`, role, comp: c });
        }
      }
      return out;
    } catch (_) {
      return [];
    }
  };

  const colourValueOf = (c: any): string => {
    // Resolve by ID FIRST (updated the moment the finish/brand changes); the
    // embedded object is only a stale fallback.
    const finish =
      pickById(finishingsList, c?.externalFinishFinishingId) ??
      c?.externalFinishFinishing;
    const colour = String(finish?.name || "").trim();
    const brandObj =
      pickById(finishingBrands, c?.externalFinishBrandId) ??
      c?.externalFinishBrand;
    const brand = String(brandObj?.name || "").trim();
    if (colour) return brand ? `${colour} - ${brand}` : colour;
    return "";
  };

  const buildWdColourCodes = (): { label: string; value: string }[] =>
    getCodedParts().map(({ code, role, comp }) => ({
      label: `${role} ${code}`,
      value: colourValueOf(comp),
    }));

  // Design B — edit the legend's finish/brand via the SAME ProjectManager
  // methods the Components panel uses, so the change writes back to the 3D
  // component AND persists (updateFloorPlan). Bumping compRev re-renders the
  // legend from the now-updated in-memory components.
  const handleLegendFinishChange = async (comp: any, finishingId: string) => {
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      const finishing = pickById(finishingsList, finishingId);
      if (finishing && pm?.onFurnishModelComponentExtFinishChange) {
        await pm.onFurnishModelComponentExtFinishChange(comp, finishing);
        setCompRev((r) => r + 1);
      }
    } catch (e) {
      console.error("Drawing2DModal ~ legend finish change", e);
    }
  };
  const handleLegendBrandChange = async (comp: any, brandId: string) => {
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      if (pm?.onFurnisheModelComponentExtBrandChange) {
        await pm.onFurnisheModelComponentExtBrandChange(comp, brandId);
        setCompRev((r) => r + 1);
      }
    } catch (e) {
      console.error("Drawing2DModal ~ legend brand change", e);
    }
  };

  /**
   * On-drawing positions for each S-code, as fractions (0..1) of the view box
   * (fx from left, fy from bottom). Finds each named part's mesh in the loaded
   * 3D item and projects its centre into the chosen elevation, so S1 lands on
   * the shutter and S2 on the handle. Falls back to a sensible default spot per
   * role when the mesh can't be resolved, so codes always show. Uses the SAME
   * role order as buildWdColourCodes so legend codes and circles agree.
   */
  const buildWdSCodePositions = (
    viewId: string
  ): { code: string; fx: number; fy: number }[] => {
    const ORDER = ["Shutter", "Handle", "Counter top", "Tray", "Hanger"];
    const roleOf = (name: string): string | null => {
      const n = String(name || "").toLowerCase();
      if (n.includes("shutter") || n.includes("door")) return "Shutter";
      if (n.includes("handle")) return "Handle";
      if (n.includes("counter")) return "Counter top";
      if (n.includes("tray")) return "Tray";
      if (n.includes("hanger")) return "Hanger";
      return null;
    };
    const DEFAULTS: Record<string, [number, number]> = {
      Shutter: [0.5, 0.55],
      Handle: [0.78, 0.5],
      "Counter top": [0.5, 0.92],
      Tray: [0.5, 0.42],
      Hanger: [0.5, 0.72]
    };
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      const comps: any[] =
        pm?.getFurnishedModelComponents?.(selectedModel?._id) || [];
      // Group parts by role, in the fixed order → the same codes as the legend.
      const byRole = new Map<string, any[]>();
      for (const c of comps) {
        const role = roleOf(c?.name);
        if (!role) continue;
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role)!.push(c);
      }
      // Same first-letter code scheme as the legend (Shutter S1, Handle H1) so
      // the circles and the PARTICULARS table always agree.
      // One code per PART (per mesh): each shutter → S1, S2, S3…; each handle →
      // H1, H2… A single merged mesh per role still yields one code (S1 / H1).
      const coded: { role: string; code: string; comp: any }[] = [];
      const letterCount = new Map<string, number>();
      for (const role of ORDER) {
        const list = byRole.get(role);
        if (!list || !list.length) continue;
        const letter = role.charAt(0).toUpperCase();
        for (const comp of list) {
          const num = (letterCount.get(letter) || 0) + 1;
          letterCount.set(letter, num);
          coded.push({ role, code: `${letter}${num}`, comp });
        }
      }
      if (!coded.length) return [];

      const physical = resolvePhysicalItem();
      const root: any = physical?.__loadedItem;
      const side = viewId === "left" || viewId === "right";

      // Try to project; if the 3D model isn't available, everything falls back.
      let min: any = null;
      let spanX = 1;
      let spanY = 1;
      let spanZ = 1;
      let centerOf: (comp: any) => Vector3 | null = () => null;
      if (root && typeof root.traverse === "function") {
        root.updateWorldMatrix?.(true, true);
        const worldBox = new Box3().setFromObject(root);
        const localBox = new Box3();
        for (const xx of [worldBox.min.x, worldBox.max.x]) {
          for (const yy of [worldBox.min.y, worldBox.max.y]) {
            for (const zz of [worldBox.min.z, worldBox.max.z]) {
              localBox.expandByPoint(
                root.worldToLocal(new Vector3(xx, yy, zz))
              );
            }
          }
        }
        min = localBox.min;
        spanX = localBox.max.x - localBox.min.x || 1;
        spanY = localBox.max.y - localBox.min.y || 1;
        spanZ = localBox.max.z - localBox.min.z || 1;
        const findObj = (nm: string): any => {
          if (!nm) return null;
          const low = nm.toLowerCase();
          let obj: any = null;
          root.traverse((o: any) => {
            if (!obj && o?.name && o.name.toLowerCase() === low) obj = o;
          });
          if (obj) return obj;
          root.traverse((o: any) => {
            if (obj || !o?.name) return;
            const on = o.name.toLowerCase();
            if (on.includes(low) || low.includes(on)) obj = o;
          });
          return obj;
        };
        centerOf = (comp: any): Vector3 | null => {
          const obj =
            findObj(String(comp?.meshName || "")) ||
            findObj(String(comp?.name || ""));
          if (!obj) return null;
          const wc = new Box3().setFromObject(obj).getCenter(new Vector3());
          return root.worldToLocal(wc);
        };
      }

      const out: { code: string; fx: number; fy: number }[] = [];
      for (const cd of coded) {
        let fx: number;
        let fy: number;
        // Position each code at ITS OWN part's mesh centre (so S1 lands on
        // door 1, S2 on door 2 …). Falls back to the role default only when the
        // mesh can't be resolved.
        const c = min ? centerOf(cd.comp) : null;
        if (c) {
          fx = side ? (c.z - min.z) / spanZ : (c.x - min.x) / spanX;
          if (viewId === "left" || viewId === "back") fx = 1 - fx;
          fy = (c.y - min.y) / spanY;
        } else {
          const d = DEFAULTS[cd.role] || [0.5, 0.5];
          fx = d[0];
          fy = d[1];
        }
        out.push({
          code: cd.code,
          fx: Math.max(0.04, Math.min(0.96, fx)),
          fy: Math.max(0.04, Math.min(0.96, fy))
        });
      }
      return out;
    } catch (e) {
      console.error("Drawing2DModal ~ buildWdSCodePositions", e);
      return [];
    }
  };

  const tabBtn = (id: "shop" | "working", label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        padding: "7px 18px",
        border: "none",
        borderBottom:
          tab === id ? "3px solid #1e88e5" : "3px solid transparent",
        background: "transparent",
        color: tab === id ? "#1e88e5" : "#666",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1000px, 94vw)",
          height: "min(720px, 92vh)",
          background: "#fff",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid #e5e7eb",
            background: "#f3f4f6",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#222" }}>
              2D Drawing
            </div>
            {result && (
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                {result.itemName} &nbsp;·&nbsp; W {result.dimensions.width} ×
                H {result.dimensions.height} × D {result.dimensions.depth} mm
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              lineHeight: 1,
              color: "#666",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        {/* tabs — plain shop drawing vs the reference-style working sheet */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid #e5e7eb",
            background: "#fff",
            flexShrink: 0,
          }}
        >
          {tabBtn("shop", "Shop Drawing")}
          {tabBtn("working", "Working Drawing")}

          {/* Detailed (mesh) vs Schematic (clean component boxes) — applies to
              BOTH sheets, since they share the same drawing source. */}
          <div
            style={{
              marginLeft: "auto",
              marginRight: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>
              Style
            </span>
            <div
              style={{
                display: "flex",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {(["detailed", "outline", "schematic"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDrawStyle(s)}
                  title={
                    s === "schematic"
                      ? "Clean rectangle per component (working-drawing look)"
                      : s === "outline"
                      ? "Clean silhouette of the model (no internal edge noise)"
                      : "Exact projected model edges"
                  }
                  style={{
                    padding: "5px 11px",
                    border: "none",
                    borderLeft: s !== "detailed" ? "1px solid #d1d5db" : "none",
                    background: drawStyle === s ? "#1e88e5" : "#fff",
                    color: drawStyle === s ? "#fff" : "#555",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Hidden (dashed) lines on/off — only meaningful for Detailed;
                Schematic never has hidden lines. Off by default = cleaner. */}
            {drawStyle === "detailed" && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginLeft: 6,
                  fontSize: 11,
                  color: "#666",
                  fontWeight: 600,
                  cursor: "pointer",
                  userSelect: "none",
                }}
                title="Show the dashed lines for edges hidden behind the model"
              >
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                Hidden lines
              </label>
            )}
          </div>
        </div>

        {/* preview body */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            background: "#525659",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          {loading && (
            <div style={{ color: "#fff", fontSize: 14 }}>
              Generating drawing…
            </div>
          )}
          {!loading && error && (
            <div
              style={{
                color: "#fff",
                fontSize: 14,
                textAlign: "center",
                maxWidth: 420,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠</div>
              {error}
            </div>
          )}
          {!loading && !error && tab === "shop" && svg && (
            <div
              style={{
                background: "#fff",
                padding: 8,
                boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
              // The SVG carries its own viewBox; CSS keeps it inside the frame.
              dangerouslySetInnerHTML={{
                __html: svg.replace(
                  "<svg ",
                  '<svg style="max-width:100%;max-height:62vh;height:auto;display:block" '
                ),
              }}
            />
          )}

          {/* Working drawing: the SAME item result, rendered through the
              architectural sheet builder (legend + key plan + title block). */}
          {!loading && !error && tab === "working" && result && (
            <div style={{ width: "100%", display: "flex", gap: 16 }}>
              <div
                style={{
                  width: 220,
                  flexShrink: 0,
                  background: "#fff",
                  padding: 12,
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  color: "#222",
                  fontSize: 12,
                  alignSelf: "flex-start",
                  // Cap the panel height and scroll INSIDE it, so the many
                  // colour/brand rows don't stretch the panel taller than the
                  // drawing (which pushed the sheet out of alignment).
                  maxHeight: "64vh",
                  overflowY: "auto",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  Sheet details
                </div>
                <label>
                  <div style={{ marginBottom: 2 }}>View to draw</div>
                  <select
                    value={wdViewId}
                    onChange={(e) =>
                      setWdViewId(e.target.value as "front" | "left" | "right")
                    }
                    style={fld()}
                  >
                    <option value="front">Front elevation</option>
                    <option value="left">Left side</option>
                    <option value="right">Right side</option>
                  </select>
                </label>
                <label>
                  <div style={{ marginBottom: 2 }}>Title</div>
                  <input
                    type="text"
                    value={wdTitle}
                    placeholder={result?.itemName || "Unit name"}
                    onChange={(e) => setWdTitle(e.target.value)}
                    style={fld()}
                  />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ flex: 1 }}>
                    <div style={{ marginBottom: 2 }}>View no.</div>
                    <input
                      type="text"
                      value={wdViewNumber}
                      onChange={(e) => setWdViewNumber(e.target.value)}
                      style={fld()}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    <div style={{ marginBottom: 2 }}>Wall code</div>
                    <input
                      type="text"
                      value={wdWallCode}
                      onChange={(e) => setWdWallCode(e.target.value)}
                      style={fld()}
                    />
                  </label>
                </div>
                <label>
                  <div style={{ marginBottom: 2 }}>Site location</div>
                  <textarea
                    value={wdSite}
                    onChange={(e) => setWdSite(e.target.value)}
                    style={{ ...fld(), height: 46, resize: "vertical" }}
                  />
                </label>
                <label>
                  <div style={{ marginBottom: 2 }}>Revision no.</div>
                  <input
                    type="text"
                    value={wdRevisionNo}
                    onChange={(e) => setWdRevisionNo(e.target.value)}
                    style={fld()}
                  />
                </label>
                <label>
                  <div style={{ marginBottom: 2 }}>Drawn by</div>
                  <input
                    type="text"
                    value={wdDrawnBy}
                    onChange={(e) => setWdDrawnBy(e.target.value)}
                    style={fld()}
                  />
                </label>
                <label>
                  <div style={{ marginBottom: 2 }}>Checked by</div>
                  <input
                    type="text"
                    value={wdCheckedBy}
                    onChange={(e) => setWdCheckedBy(e.target.value)}
                    style={fld()}
                  />
                </label>

                {/* Colour & brand — edits the REAL 3D component (syncs to the
                    Components panel + persists). Design B. */}
                {(() => {
                  const coded = getCodedParts();
                  if (!coded.length) return null;
                  return (
                    <div
                      key={compRev}
                      style={{
                        marginTop: 4,
                        paddingTop: 8,
                        borderTop: "1px solid #eee",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 12,
                          marginBottom: 2,
                        }}
                      >
                        Colour &amp; brand
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#888",
                          marginBottom: 6,
                        }}
                      >
                        Updates the 3D part too
                      </div>
                      {coded.map(({ code, role, comp }) => (
                        <div key={comp?._id || code} style={{ marginBottom: 8 }}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "#444",
                              marginBottom: 2,
                            }}
                          >
                            {role} {code}
                          </div>
                          <select
                            value={comp?.externalFinishFinishingId || ""}
                            onChange={(e) =>
                              handleLegendFinishChange(comp, e.target.value)
                            }
                            style={{ ...fld(), marginBottom: 4 }}
                          >
                            <option value="">— Finish (colour code) —</option>
                            {finishingsList.map((f: any) => (
                              <option key={f._id} value={f._id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={comp?.externalFinishBrandId || ""}
                            onChange={(e) =>
                              handleLegendBrandChange(comp, e.target.value)
                            }
                            style={fld()}
                          >
                            <option value="">— Brand —</option>
                            {finishingBrands.map((b: any) => (
                              <option key={b._id} value={b._id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  padding: 8,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                  minWidth: 0,
                }}
                dangerouslySetInnerHTML={{
                  __html: (() => {
                    try {
                      return buildWorkingDrawingSVG(result, {
                        viewId: wdViewId,
                        project: buildWdProject(),
                        materials: buildWdMaterials(),
                        colourCodes: buildWdColourCodes(),
                        sCodes: buildWdSCodePositions(wdViewId),
                      }).replace(
                        "<svg ",
                        '<svg style="max-width:100%;max-height:64vh;height:auto;display:block" '
                      );
                    } catch (e: any) {
                      return `<div style="color:#c00;padding:12px">${
                        e?.message || "Failed to build working drawing"
                      }</div>`;
                    }
                  })(),
                }}
              />
            </div>
          )}
        </div>

        {/* footer / export bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderTop: "1px solid #e5e7eb",
            background: "#f3f4f6",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>
            {tab === "shop"
              ? "Front / Top / Left / Right · solid = visible, dashed = hidden"
              : "Single-unit architectural sheet with legend, key plan and title block"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {btn("#6b7280", generate, "Regenerate", !loading)}
            {tab === "shop" ? (
              <>
                {btn(
                  "#1e88e5",
                  () => result && exportSVG(result),
                  "Export SVG",
                  !!result && !loading
                )}
                {btn(
                  "#21b35a",
                  () => result && exportDXF(result),
                  "Export DXF",
                  !!result && !loading
                )}
                {btn(
                  "#e53935",
                  () => result && exportPDF(result),
                  "Export PDF",
                  !!result && !loading
                )}
              </>
            ) : (
              btn(
                "#1e88e5",
                () =>
                  result &&
                  exportWorkingDrawingSVG(result, {
                    viewId: wdViewId,
                    project: buildWdProject(),
                    materials: buildWdMaterials(),
                    colourCodes: buildWdColourCodes(),
                    sCodes: buildWdSCodePositions(wdViewId),
                  }),
                "Download SVG",
                !!result && !loading
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Drawing2DModal;
