import React, { useEffect, useState } from "react";
import { listItems } from "../../services/projectWorkspaceService";
import {
  TRACKER_STAGES,
  stageLabel,
  stageIndexByKey,
  statusToStageIndex,
} from "../../utils/trackerStages";

/**
 * ProjectTracker (Inspire app) — a read-only "Track your project" timeline that
 * matches the design app (:3031). Reads the SAME shared stage_event data, so the
 * progress is identical across both apps. Clicking a step calls onStepClick so
 * the workspace below can filter to that step.
 */

const DONE = "#0F6E56";
const DONE_BG = "#E1F5EE";
const NOW = "#534AB7";
const NOW_BG = "#EEEDFE";
const NOW_TX = "#26215C";
const UPCOMING = "#B4B2A9";

const ProjectTracker = ({ projectId, status, refreshKey, onStepClick, activeStage, projectCreatedAt }) => {
  const total = TRACKER_STAGES.length;
  const fmtDate = (d) => {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return "";
    }
  };
  const isClosed = status === "closed";
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) return;
      const rows = await listItems(projectId, "stage_event");
      if (!cancelled) setEvents(rows || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  // Poll every 20s so the client's tracker picks up changes made in another
  // session (e.g. the admin marking steps done) without a manual reload.
  useEffect(() => {
    if (!projectId) return;
    const id = setInterval(async () => {
      const rows = await listItems(projectId, "stage_event");
      setEvents(rows || []);
    }, 20000);
    return () => clearInterval(id);
  }, [projectId]);

  // Manual "Mark done" events (Phase 2 — Design finalized onward) may only push the
  // tracker PAST the quote stage once the quote is actually ACCEPTED (or the project
  // is closed). Before that — crucially, when a project is REOPENED (client rejects →
  // admin closes → client requests a quote again), which drops the status back to an
  // early stage — the tracker must follow the STATUS alone, so leftover ticks from a
  // previous cycle don't keep it pinned at "Done & handover". This is what makes the
  // tracker correctly rewind on a re-request.
  const statusIdx = statusToStageIndex(status);
  const inBuildPhase = status === "quotation_accepted" || status === "closed";
  const fixedIdxs = events.map((e) => stageIndexByKey(e.stage)).filter((i) => i >= 0);
  const eventIdx = fixedIdxs.length ? Math.max(...fixedIdxs) : -1;
  const current = inBuildPhase ? Math.max(statusIdx, eventIdx) : statusIdx;
  const pct = Math.round(((isClosed ? total - 1 : current) / (total - 1)) * 100);

  const labelFor = (key, fallback) =>
    events.find((e) => e.stage === key)?.title || fallback;
  const isHidden = (key) =>
    events.find((e) => e.stage === key)?.status === "hidden";
  const dateFor = (key) => {
    const ev = events.find((e) => e.stage === key);
    if (!ev?.createdAt) return "";
    try {
      return new Date(ev.createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  const columns = [];
  TRACKER_STAGES.forEach((s, i) => {
    const st = isClosed || i < current ? "done" : i === current ? "current" : "upcoming";
    if (isHidden(s.key) && st !== "current") return;
    columns.push({
      key: s.key,
      label: labelFor(s.key, s.label),
      state: st,
      date:
        st !== "upcoming"
          ? dateFor(s.key) || (s.key === "project_created" ? fmtDate(projectCreatedAt) : "")
          : "",
      reached: st === "done" || st === "current",
    });
  });

  return (
    <div
      style={{
        margin: "8px 0",
        borderRadius: 10,
        background: "#fff",
        border: "1px solid #e5e7eb",
        padding: 18,
      }}
    >
      <style>{`
        .pz-ai-step-dot { transition: box-shadow .18s ease, transform .18s ease; box-shadow: 0 4px 10px rgba(0,0,0,0.20); }
        .pz-ai-step:hover .pz-ai-step-dot { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(15,110,86,0.45); }
        .pz-ai-step-label { transition: color .18s ease; }
        .pz-ai-step:hover .pz-ai-step-label { color: #0F6E56 !important; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#414063", margin: 0 }}>
          Track your project
        </h3>
        <span style={{ fontSize: 12, fontWeight: 600, color: NOW }}>
          {isClosed ? "Completed" : `Step ${current + 1} of ${total}`}
        </span>
      </div>

      <div style={{ height: 7, borderRadius: 999, overflow: "hidden", background: "#e3f1ea", marginBottom: 4 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: DONE, borderRadius: 999 }} />
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 6, marginTop: 30 }}>
        {columns.map((col, idx) => {
          const st = col.state;
          const accent = st === "done" ? DONE : st === "current" ? NOW : UPCOMING;
          const tileBg = st === "done" ? DONE_BG : st === "current" ? NOW_BG : "#F1EFE8";
          const glyph = st === "done" ? "✓" : st === "current" ? "●" : "○";
          const active = activeStage === col.key;
          return (
            <div
              key={col.key}
              className="pz-ai-step"
              onClick={() => onStepClick && onStepClick(col.key)}
              title={onStepClick ? "Click to see this step's items" : undefined}
              style={{
                flex: "1 0 84px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
                padding: "16px 8px",
                borderRadius: 12,
                cursor: onStepClick ? "pointer" : "default",
                background: active ? "#EEF6FE" : undefined,
              }}
            >
              {idx > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 39,
                    right: "50%",
                    width: "100%",
                    height: 2,
                    background: col.reached ? DONE : "#e5e7eb",
                    opacity: col.reached ? 0.5 : 1,
                  }}
                />
              )}
              <div
                className="pz-ai-step-dot"
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: 46,
                  height: 46,
                  borderRadius: 999,
                  background: tileBg,
                  border: `2px solid ${accent}`,
                  color: accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: st === "current" ? 14 : 19,
                  lineHeight: 1,
                  flex: "none",
                }}
              >
                {glyph}
              </div>
              <span
                className="pz-ai-step-label"
                style={{
                  fontSize: 13,
                  marginTop: 14,
                  textAlign: "center",
                  lineHeight: 1.25,
                  color: st === "upcoming" ? "#9ca3af" : NOW_TX,
                  fontWeight: st === "current" ? 600 : 500,
                }}
              >
                {col.label}
              </span>
              {col.date && (
                <span style={{ fontSize: 10, color: "#9ca3af", marginTop: 7 }}>
                  {col.date}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectTracker;
