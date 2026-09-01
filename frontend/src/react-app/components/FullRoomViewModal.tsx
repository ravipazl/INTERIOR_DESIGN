import React, { useCallback, useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import {
  generateRoomDrawing,
  renderRoomSnapshots,
} from "@pazl/main/drawing2d/Drawing2DEngine";
import {
  buildSVG,
  exportSVG,
  exportDXF,
  exportPDF,
  buildWorkingDrawingSVG,
  exportWorkingDrawingSVG,
} from "@pazl/main/drawing2d/Drawing2DExport";

/**
 * FullRoomViewModal — generates a whole-room view from the live 3D model in
 * two forms and previews them:
 *
 *   • Line Drawing   — AutoCAD-style Front / Plan / Left / Right with
 *                      hidden-line removal; exports to SVG / DXF / PDF.
 *   • Rendered Images — orthographic PNG snapshots of the same 4 viewpoints,
 *                      textured and lit; each downloadable.
 *
 * Both run against the live three.js renderer of blueprint3d.roomplanner.
 * Self-contained inline styling, same as Drawing2DModal.
 */

interface FullRoomViewModalProps {
  show: boolean;
  onClose: () => void;
}

type Snapshot = {
  id: string;
  label: string;
  width: number;
  height: number;
  dataUrl: string;
};

const FullRoomViewModal: React.FC<FullRoomViewModalProps> = ({
  show,
  onClose,
}) => {
  const [tab, setTab] = useState<"drawing" | "images" | "working">("drawing");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapWarning, setSnapWarning] = useState<string | null>(null);

  // ---- Working Drawing form state (Phase 1) ----
  const [wdViewId, setWdViewId] = useState<"front" | "left" | "right">("front");
  const [wdTitle, setWdTitle] = useState("KITCHEN INTERNAL VIEW");
  const [wdViewNumber, setWdViewNumber] = useState("2");
  const [wdWallCode, setWdWallCode] = useState("A");
  const [wdSite, setWdSite] = useState("");
  const [wdRevisionNo, setWdRevisionNo] = useState("00");
  const [wdDrawnBy, setWdDrawnBy] = useState("");
  const [wdCheckedBy, setWdCheckedBy] = useState("");

  const generate = useCallback(async () => {
    setError(null);
    setSnapWarning(null);
    setLoading(true);
    setSvg(null);
    setResult(null);
    setSnapshots([]);
    // Let the spinner paint before the heavy synchronous generation.
    await new Promise((r) => setTimeout(r, 40));
    try {
      const bp3d: any = BlueprintInterface?.blueprint3d;
      // blueprint3d.roomplanner is the live Viewer3D (it extends THREE.Scene).
      const viewer3d: any = bp3d?.roomplanner || bp3d?.viewer3d;
      const renderer = viewer3d?.renderer;
      if (!viewer3d || !renderer) {
        throw new Error("Open the 3D room view first, then try again.");
      }

      // Line drawing — fatal if it fails.
      const drawing = generateRoomDrawing(viewer3d, renderer);
      setResult(drawing);
      setSvg(buildSVG(drawing));

      // Rendered images — non-fatal: keep the drawing if these fail.
      try {
        setSnapshots(renderRoomSnapshots(viewer3d, renderer));
      } catch (se: any) {
        setSnapWarning(
          se?.message || "The rendered images could not be generated."
        );
      }
    } catch (e: any) {
      setError(e?.message || "Failed to generate the full room view.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (show) {
      generate();
    } else {
      setSvg(null);
      setResult(null);
      setSnapshots([]);
      setError(null);
      setSnapWarning(null);
      setTab("drawing");
    }
  }, [show, generate]);

  if (!show) return null;

  const downloadImage = (shot: Snapshot) => {
    const a = document.createElement("a");
    a.href = shot.dataUrl;
    a.download = `room_${shot.id}_view.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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

  // Small text-input style shared by the Working Drawing form fields.
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

  // Bundle the Working Drawing form state into the `project` object the
  // export function expects. Defined here so both preview and download
  // pull from the same source.
  const buildWdProject = () => ({
    title: wdTitle,
    viewNumber: wdViewNumber,
    wallCode: wdWallCode,
    site: wdSite,
    date: new Date().toISOString(),
    revisionNo: wdRevisionNo,
    drawnBy: wdDrawnBy,
    checkedBy: wdCheckedBy,
  });

  const tabBtn = (
    id: "drawing" | "images" | "working",
    label: string
  ) => (
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
          width: "min(1040px, 95vw)",
          height: "min(760px, 94vh)",
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
              Full Room View
            </div>
            {result && (
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                Whole room &nbsp;·&nbsp; W {result.dimensions.width} × H{" "}
                {result.dimensions.height} × D {result.dimensions.depth} mm
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

        {/* tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "0 12px",
            borderBottom: "1px solid #e5e7eb",
            background: "#fafafa",
          }}
        >
          {tabBtn("drawing", "Line Drawing")}
          {tabBtn("images", "Rendered Images")}
          {tabBtn("working", "Working Drawing")}
        </div>

        {/* body */}
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
              Generating full room view…
            </div>
          )}

          {!loading && error && (
            <div
              style={{
                color: "#fff",
                fontSize: 14,
                textAlign: "center",
                maxWidth: 440,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠</div>
              {error}
            </div>
          )}

          {!loading && !error && tab === "drawing" && svg && (
            <div
              style={{
                background: "#fff",
                padding: 8,
                boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
              dangerouslySetInnerHTML={{
                __html: svg.replace(
                  "<svg ",
                  '<svg style="max-width:100%;max-height:64vh;height:auto;display:block" '
                ),
              }}
            />
          )}

          {!loading && !error && tab === "images" && (
            <div style={{ width: "100%" }}>
              {snapWarning && (
                <div
                  style={{
                    color: "#ffd479",
                    fontSize: 13,
                    textAlign: "center",
                    marginBottom: 12,
                  }}
                >
                  {snapWarning}
                </div>
              )}
              {snapshots.length > 0 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 16,
                  }}
                >
                  {snapshots.map((shot) => (
                    <div
                      key={shot.id}
                      style={{
                        background: "#fff",
                        borderRadius: 6,
                        overflow: "hidden",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#333",
                          }}
                        >
                          {shot.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => downloadImage(shot)}
                          style={{
                            border: "none",
                            background: "#1e88e5",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "4px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          Download PNG
                        </button>
                      </div>
                      <img
                        src={shot.dataUrl}
                        alt={shot.label}
                        style={{
                          display: "block",
                          width: "100%",
                          height: "auto",
                          background: "#fff",
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                !snapWarning && (
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 14,
                      textAlign: "center",
                    }}
                  >
                    No rendered images available.
                  </div>
                )
              )}
            </div>
          )}

          {!loading && !error && tab === "working" && result && (
            <div style={{ width: "100%", display: "flex", gap: 16 }}>
              {/* Project info form */}
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
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  Sheet details
                </div>

                <label>
                  <div style={{ marginBottom: 2 }}>Wall to draw</div>
                  <select
                    value={wdViewId}
                    onChange={(e) =>
                      setWdViewId(
                        e.target.value as "front" | "left" | "right"
                      )
                    }
                    style={fld()}
                  >
                    <option value="front">Front elevation</option>
                    <option value="left">Left elevation</option>
                    <option value="right">Right elevation</option>
                  </select>
                </label>

                <label>
                  <div style={{ marginBottom: 2 }}>Title</div>
                  <input
                    value={wdTitle}
                    onChange={(e) => setWdTitle(e.target.value)}
                    style={fld()}
                  />
                </label>

                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ flex: 1 }}>
                    <div style={{ marginBottom: 2 }}>View no.</div>
                    <input
                      value={wdViewNumber}
                      onChange={(e) => setWdViewNumber(e.target.value)}
                      style={fld()}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    <div style={{ marginBottom: 2 }}>Wall code</div>
                    <input
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
                    rows={2}
                    style={{ ...fld(), resize: "vertical" }}
                  />
                </label>

                <label>
                  <div style={{ marginBottom: 2 }}>Revision no.</div>
                  <input
                    value={wdRevisionNo}
                    onChange={(e) => setWdRevisionNo(e.target.value)}
                    style={fld()}
                  />
                </label>

                <label>
                  <div style={{ marginBottom: 2 }}>Drawn by</div>
                  <input
                    value={wdDrawnBy}
                    onChange={(e) => setWdDrawnBy(e.target.value)}
                    style={fld()}
                  />
                </label>

                <label>
                  <div style={{ marginBottom: 2 }}>Checked by</div>
                  <input
                    value={wdCheckedBy}
                    onChange={(e) => setWdCheckedBy(e.target.value)}
                    style={fld()}
                  />
                </label>
              </div>

              {/* Live SVG preview */}
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  padding: 8,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                  alignSelf: "flex-start",
                  maxHeight: "70vh",
                  overflow: "auto",
                }}
                dangerouslySetInnerHTML={{
                  __html: (() => {
                    try {
                      return buildWorkingDrawingSVG(result, {
                        viewId: wdViewId,
                        project: buildWdProject(),
                      }).replace(
                        "<svg ",
                        '<svg style="max-width:100%;max-height:68vh;height:auto;display:block" '
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

        {/* footer */}
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
            {tab === "drawing"
              ? "Front / Plan / Left / Right · solid = visible, dashed = hidden"
              : tab === "images"
                ? "Orthographic renders of the whole room"
                : "Single-wall architectural sheet with legend, key plan and title block"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {btn("#6b7280", generate, "Regenerate", !loading)}
            {tab === "working" &&
              btn(
                "#1e88e5",
                () =>
                  result &&
                  exportWorkingDrawingSVG(result, {
                    viewId: wdViewId,
                    project: buildWdProject(),
                  }),
                "Download SVG",
                !!result && !loading
              )}
            {tab === "drawing" && (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullRoomViewModal;
