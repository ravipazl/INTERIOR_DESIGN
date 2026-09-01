import React, { useEffect, useState } from "react";
import {
  TRACKER_STAGES,
  statusToStageIndex,
  stageIndexByKey,
} from "@pazl/utils/trackerStages";
import { ProjectWorkspaceService as WS } from "@pazl/services/ProjectWorkspaceService";

/**
 * Read-only client Project Tracker — a "pizza-tracker" style timeline shown at
 * the top of the Project Detail page. Green = done, purple = current, grey =
 * upcoming. Phase 1 is derived from the project `status`; Phase 2 stages show as
 * upcoming until the team advances them (a later build step).
 */
interface ProjectTrackerProps {
  projectId?: string;
  status?: string;
  refreshKey?: number;
  // Clicking a step filters the Project Workspace below to that step's items.
  onStepClick?: (stageKey: string) => void;
  // The stage currently used as the workspace filter (highlights that row).
  activeStage?: string;
  // The project's creation date — used as the date for "Project started" (which
  // has no logged event of its own).
  projectCreatedAt?: string;
}

const DONE = "#0F6E56";
const DONE_BG = "#E1F5EE";
const NOW = "#534AB7";
const NOW_BG = "#EEEDFE";
const NOW_TX = "#26215C";

const dotStyle = (state: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    flex: "none",
    border: "1px solid",
    lineHeight: 1,
  };
  if (state === "done")
    return { ...base, background: DONE_BG, borderColor: DONE, color: DONE };
  if (state === "current")
    return {
      ...base,
      background: NOW_BG,
      borderColor: NOW,
      color: NOW,
      fontSize: 9,
    };
  return {
    ...base,
    background: "#F1EFE8",
    borderColor: "#e5e7eb",
    color: "#9ca3af",
  };
};

const ProjectTracker: React.FC<ProjectTrackerProps> = ({
  projectId,
  status,
  refreshKey,
  onStepClick,
  activeStage,
  projectCreatedAt,
}) => {
  const total = TRACKER_STAGES.length;
  const isClosed = status === "closed";

  // Stage events (auto Phase-1 + manual Phase-2) carry the date of each step and
  // the furthest reached stage. Current = max(status-derived, furthest event).
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) return;
      const rows = await WS.list(projectId, "stage_event");
      if (!cancelled) setEvents(rows || []);
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetch when the team advances (refreshKey bumps) — keeps the top tracker
    // in sync with the Tracker tab without a page reload.
  }, [projectId, refreshKey]);

  // Poll every 20s so the tracker picks up changes made in ANOTHER session
  // (e.g. the admin marking steps done while the client has the page open),
  // without the client needing a manual reload.
  useEffect(() => {
    if (!projectId) return;
    const id = setInterval(async () => {
      const rows = await WS.list(projectId, "stage_event");
      setEvents(rows || []);
    }, 20000);
    return () => clearInterval(id);
  }, [projectId]);

  const fixedIdxs = events
    .map((e) => stageIndexByKey(e.stage))
    .filter((i) => i >= 0);
  const eventIdx = fixedIdxs.length ? Math.max(...fixedIdxs) : -1;
  // Phase-2 "Mark done" events may only push the tracker past the quote stage once
  // the quote is ACCEPTED (or the project is closed). Otherwise — including when a
  // project is REOPENED (client rejects → admin closes → client re-requests a quote,
  // dropping the status back to an early stage) — the tracker follows the STATUS
  // alone, so leftover ticks don't keep it pinned at the end. Makes it rewind on a
  // re-request.
  const inBuildPhase = status === "quotation_accepted" || status === "closed";
  const current = inBuildPhase
    ? Math.max(statusToStageIndex(status), eventIdx)
    : statusToStageIndex(status);
  const customSteps = events
    .filter((e) => e.stage === "__custom")
    .slice()
    .reverse();
  // Custom steps pinned to their anchor stage (`note`); un-anchored → current.
  const customsForStage = (key: string, isCurrent: boolean) =>
    customSteps.filter((cs) => (cs.note ? cs.note === key : isCurrent));
  // Per-project renamed stage (stored in its event's `title`), else the default.
  const labelForStage = (key: string, fallback: string) =>
    events.find((e) => e.stage === key)?.title || fallback;
  // Stages the team removed for this project are hidden from the client too.
  const isHidden = (key: string) =>
    events.find((e) => e.stage === key)?.status === "hidden";
  const dateForStage = (key: string): string => {
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
  const pct = Math.round(((isClosed ? total - 1 : current) / (total - 1)) * 100);

  // Flatten fixed steps + their pinned custom steps into one left-to-right
  // sequence for the horizontal stepper (Style A).
  const columns: any[] = [];
  const fmt = (d?: string) => {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };
  TRACKER_STAGES.forEach((s, i) => {
    const st = isClosed || i < current ? "done" : i === current ? "current" : "upcoming";
    if (isHidden(s.key) && st !== "current") return;
    columns.push({
      type: "fixed",
      key: s.key,
      label: labelForStage(s.key, s.label),
      state: st,
      date:
        st !== "upcoming"
          ? dateForStage(s.key) ||
            (s.key === "project_created" ? fmt(projectCreatedAt) : "")
          : "",
      reached: st === "done" || st === "current",
    });
    customsForStage(s.key, st === "current").forEach((cs) => {
      columns.push({
        type: "custom",
        key: cs._id,
        label: cs.title || "Update",
        state: "done",
        date: fmt(cs.createdAt),
        count: 0,
        reached: true,
      });
    });
  });

  return (
    <div className="m-2 rounded bg-white dark:bg-[#2b2b2b] border border-[#e5e7eb] dark:border-[#444444] p-4">
      <style>{`
        .pz-step-dot {
          transition: box-shadow .18s ease, transform .18s ease;
          box-shadow: 0 4px 10px rgba(0,0,0,0.20);
        }
        .pz-step:hover .pz-step-dot {
          transform: translateY(-4px);
          box-shadow: 0 14px 30px rgba(15,110,86,0.45);
        }
        .pz-step-label { transition: color .18s ease; }
        .pz-step:hover .pz-step-label { color: #0F6E56 !important; }
      `}</style>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-[#414063] dark:text-white">
          Track your project
        </h3>
        <span
          className="text-xs font-semibold"
          style={{ color: NOW }}
        >
          {isClosed ? "Completed" : `Step ${current + 1} of ${total}`}
        </span>
      </div>
      <div
        className="rounded-full overflow-hidden mb-4"
        style={{ height: 7, background: "#e3f1ea" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: DONE }}
        />
      </div>

      {/* Horizontal stepper (Style A) — scrolls sideways when steps overflow.
          align-items:flex-start so a taller step (with the "In progress" badge)
          doesn't stretch the other step boxes and throw off their alignment. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          overflowX: "auto",
          paddingBottom: 6,
          marginTop: 30,
        }}
      >
        {columns.map((col, idx) => {
          const st = col.state as string;
          const accent = st === "done" ? DONE : st === "current" ? NOW : "#B4B2A9";
          const tileBg = st === "done" ? DONE_BG : st === "current" ? NOW_BG : "#F1EFE8";
          const glyph = st === "done" ? "✓" : st === "current" ? "●" : "○";
          const clickable = col.type === "fixed" && !!onStepClick;
          const active = col.type === "fixed" && activeStage === col.key;
          return (
            <div
              key={col.key}
              className="pz-step"
              onClick={() => clickable && onStepClick?.(col.key)}
              title={clickable ? "Click to see this step’s documents, tasks & discussions" : undefined}
              style={{
                // Grow to fill the full width evenly; keep a min so many steps
                // still scroll sideways on a narrow screen instead of crushing.
                flex: "1 0 84px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
                padding: "16px 8px",
                borderRadius: 12,
                cursor: clickable ? "pointer" : "default",
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
                className="pz-step-dot"
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
                className="pz-step-label dark:text-[#dddddd]"
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
