import React, { useEffect, useState } from "react";
import { ProjectWorkspaceService as WS } from "@pazl/services/ProjectWorkspaceService";
import { AuthService } from "@pazl/services/authService";
import {
  TRACKER_STAGES,
  statusToStageIndex,
  stageIndexByKey,
} from "@pazl/utils/trackerStages";
import Toast from "../Toast";

/**
 * TrackerAdmin — the team control panel (Project Workspace → "Tracker" tab).
 * The team advances the project stage by stage. "Mark done" writes a stage_event
 * for the NEXT stage; the client's read-only tracker then reflects it.
 *
 * The current stage = max(status-derived Phase 1, latest stage_event). Phase 1
 * flows automatically from the project status; Phase 2 is advanced here.
 */
interface Props {
  projectId: string;
  status?: string;
  onAdvance?: () => void;
  // The client's email — shown as the "To" in the send-mail popup.
  clientEmail?: string;
  // The project's creation date — used as "Project started"'s date.
  projectCreatedAt?: string;
  // "Close Project" is rendered on the final "Done & handover" row, so finishing
  // a project happens where the work visibly ends instead of in a separate
  // banner at the top of the page. The PAGE still owns the action and its
  // pending state — this component only decides WHERE the control appears.
  canCloseProject?: boolean;
  closingProject?: boolean;
  onCloseProject?: () => void;
}

const DONE = "#0F6E56";
const NOW = "#534AB7";

// Trash/delete icon (used for both fixed-stage "remove" and custom-step "delete"
// so every row's action buttons look the same).
const TrashIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const TrackerAdmin: React.FC<Props> = ({
  projectId,
  status,
  onAdvance,
  clientEmail,
  projectCreatedAt,
  canCloseProject = false,
  closingProject = false,
  onCloseProject,
}) => {
  const [events, setEvents] = useState<any[]>([]);
  const [expected, setExpected] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customDate, setCustomDate] = useState("");
  // Which stage the new custom step is placed AFTER (its anchor). Defaults to
  // the current stage when the form opens; the admin can pick any stage.
  const [customAfter, setCustomAfter] = useState("");
  // Edit a custom step (rename + date).
  const [editCustomId, setEditCustomId] = useState<string | null>(null);
  const [editCustomLabel, setEditCustomLabel] = useState("");
  const [editCustomDate, setEditCustomDate] = useState("");
  // Edit the name + expected date on a fixed (done/current) stage.
  const [editStageKey, setEditStageKey] = useState<string | null>(null);
  const [editStageDate, setEditStageDate] = useState("");
  const [editStageLabel, setEditStageLabel] = useState("");
  // Send a custom email to the client for a step (subject + message + file).
  const [mailKey, setMailKey] = useState<string | null>(null);
  const [mailSubject, setMailSubject] = useState("");
  const [mailMessage, setMailMessage] = useState("");
  const [mailFile, setMailFile] = useState<File | null>(null);
  const [mailCc, setMailCc] = useState("");
  const [mailSending, setMailSending] = useState(false);
  // Toast for send success / failure (auto-dismisses).
  const [toast, setToast] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  };

  // Close the mail popup on Escape.
  useEffect(() => {
    if (!mailKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !mailSending) setMailKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mailKey, mailSending]);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    let rows = (await WS.list(projectId, "stage_event")) || [];

    // Back-fill: pin any un-anchored custom step (added before pinning existed)
    // to the current stage, so it stops following the current position.
    const unanchored = rows.filter((e) => e.stage === "__custom" && !e.note);
    if (unanchored.length) {
      const fixed = rows
        .map((e) => stageIndexByKey(e.stage))
        .filter((i) => i >= 0);
      const cur = Math.max(
        statusToStageIndex(status),
        fixed.length ? Math.max(...fixed) : -1
      );
      const anchorKey =
        TRACKER_STAGES[
          Math.min(Math.max(cur, 0), TRACKER_STAGES.length - 1)
        ]?.key;
      if (anchorKey) {
        await Promise.all(
          unanchored.map((cs) => WS.update(cs._id, { note: anchorKey }))
        );
        rows = (await WS.list(projectId, "stage_event")) || [];
      }
    }

    setEvents(rows);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Current = furthest FIXED stage reached (ignore custom steps, which map to -1)
  // vs the status-derived Phase-1 index.
  const fixedIdxs = events
    .map((e) => stageIndexByKey(e.stage))
    .filter((i) => i >= 0);
  const latestEventIdx = fixedIdxs.length ? Math.max(...fixedIdxs) : -1;
  // Phase-2 "Mark done" events may only advance the tracker past the quote stage
  // once the quote is ACCEPTED (or closed). Before that — including a REOPENED
  // project (rejected → closed → quote re-requested, status back to an early stage)
  // — the tracker follows the STATUS alone so leftover ticks from a prior cycle
  // don't keep it pinned at the end.
  const inBuildPhase = status === "quotation_accepted" || status === "closed";
  const current = inBuildPhase
    ? Math.max(statusToStageIndex(status), latestEventIdx)
    : statusToStageIndex(status);
  const total = TRACKER_STAGES.length;
  const nextIdx = current + 1;
  const canAdvance = nextIdx < total;

  // Custom steps the team added (oldest first; service returns newest first).
  const customSteps = events
    .filter((e) => e.stage === "__custom")
    .slice()
    .reverse();

  const eventForStage = (key: string) =>
    events.find((e) => e.stage === key);

  // A fixed stage's display name = its per-project override (stored in the
  // event's `title`) if set, else the standard label.
  const labelForStage = (s: { key: string; label: string }) =>
    eventForStage(s.key)?.title || s.label;

  // A fixed stage removed FOR THIS PROJECT (event `status` === "hidden").
  const isHidden = (key: string) => eventForStage(key)?.status === "hidden";
  const hiddenStages = TRACKER_STAGES.filter((s) => isHidden(s.key));

  // Custom steps pinned to a stage (by their `note` anchor). Un-anchored ones
  // (old rows with no anchor) fall back to the current stage.
  const customsForStage = (key: string, isCurrent: boolean) =>
    customSteps.filter((cs) => (cs.note ? cs.note === key : isCurrent));

  const markDone = async () => {
    if (!canAdvance || saving) return;
    setSaving(true);
    try {
      const next = TRACKER_STAGES[nextIdx];
      const user = AuthService.getCurrentUser();
      const created: any = await WS.create({
        projectId,
        kind: "stage_event",
        stage: next.key,
        expectedDate: expected || undefined,
        by: (user as any)?._id,
        auto: false,
      } as any);
      setExpected("");
      await load();
      onAdvance?.();
      const wa = created?.whatsapp;
      const waMsg = wa?.sent
        ? ` · WhatsApp sent to +${wa.to}`
        : wa?.skipped && wa.reason === "no_phone"
        ? " · WhatsApp skipped — no phone"
        : wa && !wa.sent && !wa.skipped
        ? " · WhatsApp failed"
        : "";
      showToast(
        "success",
        `Marked "${next.label}" — the client has been notified.` + waMsg
      );
    } catch (e) {
      console.error("TrackerAdmin.markDone", e);
      showToast("error", "Could not update the step. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Save a rename / date change on a custom step.
  const saveEditCustom = async () => {
    if (!editCustomId || saving) return;
    setSaving(true);
    try {
      await WS.update(editCustomId, {
        title: editCustomLabel.trim() || "Custom step",
        expectedDate: editCustomDate || undefined,
      });
      setEditCustomId(null);
      await load();
      onAdvance?.();
    } catch (e) {
      console.error("TrackerAdmin.saveEditCustom", e);
    } finally {
      setSaving(false);
    }
  };

  // Save an expected-date change on a fixed stage (create the event if the stage
  // has none yet — only allowed for reached stages, i <= current).
  const saveEditStage = async () => {
    if (!editStageKey || saving) return;
    setSaving(true);
    try {
      // A blank / unchanged name clears the override (empty string → the display
      // falls back to the standard label). Empty string (not undefined) so the
      // patch actually clears a previous rename.
      const def = TRACKER_STAGES.find((s) => s.key === editStageKey)?.label;
      const name = editStageLabel.trim();
      const titleOverride = name && name !== def ? name : "";
      const ev = eventForStage(editStageKey);
      if (ev?._id) {
        await WS.update(ev._id, {
          expectedDate: editStageDate || undefined,
          title: titleOverride,
        });
      } else {
        const user = AuthService.getCurrentUser();
        await WS.create({
          projectId,
          kind: "stage_event",
          stage: editStageKey,
          expectedDate: editStageDate || undefined,
          title: titleOverride,
          by: (user as any)?._id,
          auto: false,
        } as any);
      }
      setEditStageKey(null);
      await load();
      onAdvance?.();
    } catch (e) {
      console.error("TrackerAdmin.saveEditStage", e);
    } finally {
      setSaving(false);
    }
  };

  // Remove (hide) a fixed stage FOR THIS PROJECT — stored on its event, so it's
  // restorable and never touches the shared master list.
  const hideStage = async (key: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const ev = eventForStage(key);
      if (ev?._id) {
        await WS.update(ev._id, { status: "hidden" });
      } else {
        const user = AuthService.getCurrentUser();
        await WS.create({
          projectId,
          kind: "stage_event",
          stage: key,
          status: "hidden",
          by: (user as any)?._id,
          auto: false,
        } as any);
      }
      await load();
      onAdvance?.();
    } catch (e) {
      console.error("TrackerAdmin.hideStage", e);
    } finally {
      setSaving(false);
    }
  };

  const restoreStage = async (key: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const ev = eventForStage(key);
      if (ev?._id) await WS.update(ev._id, { status: "" });
      await load();
      onAdvance?.();
    } catch (e) {
      console.error("TrackerAdmin.restoreStage", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteCustom = async (id?: string) => {
    if (!id || saving) return;
    setSaving(true);
    try {
      await WS.remove(id);
      await load();
      onAdvance?.();
    } catch (e) {
      console.error("TrackerAdmin.deleteCustom", e);
    } finally {
      setSaving(false);
    }
  };

  // Add a one-off custom step (e.g. "Waiting for client approval"). Stored as a
  // stage_event with stage "__custom" and the label in `title`. It shows on both
  // the team panel and the client tracker, and notifies the client.
  const addCustom = async () => {
    const label = customLabel.trim();
    if (!label || saving) return;
    setSaving(true);
    try {
      const user = AuthService.getCurrentUser();
      // Pin the step AFTER the chosen step (its anchor, stored in `note`), so it
      // stays there even as the project advances. Defaults to the current stage.
      // If the chosen anchor is ANOTHER custom step ("custom:<id>"), reuse that
      // step's own anchor so the new one joins the same group (lands after it).
      let anchorKey =
        customAfter ||
        TRACKER_STAGES[Math.min(Math.max(current, 0), total - 1)]?.key;
      if (customAfter.startsWith("custom:")) {
        const cid = customAfter.slice("custom:".length);
        anchorKey =
          customSteps.find((c) => c._id === cid)?.note ||
          TRACKER_STAGES[Math.min(Math.max(current, 0), total - 1)]?.key;
      }
      await WS.create({
        projectId,
        kind: "stage_event",
        stage: "__custom",
        title: label,
        note: anchorKey,
        expectedDate: customDate || undefined,
        by: (user as any)?._id,
        auto: false,
      } as any);
      setCustomLabel("");
      setCustomDate("");
      setCustomAfter("");
      setShowAdd(false);
      await load();
      onAdvance?.();
    } catch (e) {
      console.error("TrackerAdmin.addCustom", e);
    } finally {
      setSaving(false);
    }
  };

  // Open the "send mail to client" composer for a step (prefills the subject).
  const openMail = (s: { key: string; label: string }) => {
    setMailKey(s.key);
    setMailSubject(`Update on ${labelForStage(s)}`);
    setMailMessage("");
    setMailCc("");
    setMailFile(null);
  };

  const sendMail = async () => {
    if (!mailKey || mailSending) return;
    setMailSending(true);
    try {
      const res = await WS.sendStepMail({
        projectId,
        stage: mailKey,
        subject: mailSubject.trim() || "Update",
        message: mailMessage.trim(),
        cc: mailCc.trim() || undefined,
        file: mailFile,
      });
      if (res.sent) {
        // Success → close the popup and show a success toast.
        setMailKey(null);
        setMailFile(null);
        const wa = (res as any).whatsapp;
        const waMsg = wa?.sent
          ? ` · WhatsApp sent to +${wa.to}`
          : wa?.skipped && wa.reason === "no_phone"
          ? " · WhatsApp skipped — no phone"
          : wa && !wa.sent && !wa.skipped
          ? " · WhatsApp failed"
          : "";
        showToast("success", "Update sent to the client by email." + waMsg);
      } else {
        // Failure → keep the popup open, show an error toast.
        showToast("error", res.error || "Send failed");
      }
    } catch (e) {
      showToast("error", "Send failed");
    } finally {
      setMailSending(false);
    }
  };

  const dot = (state: string): React.CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: 999,
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    border: "1px solid",
    ...(state === "done"
      ? { background: "#E1F5EE", borderColor: DONE, color: DONE }
      : state === "current"
      ? { background: "#EEEDFE", borderColor: NOW, color: NOW }
      : { background: "#F1EFE8", borderColor: "#e5e7eb", color: "#9ca3af" }),
  });

  // The step's REAL date — when its event was created / marked done (automatic,
  // no manual entry). Blank if the step has no event yet.
  const autoDate = (ev: any): string => {
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
  // "Project started" has no event of its own → fall back to the project's
  // creation date so it's never blank.
  const rowDate = (s: { key: string }, ev: any): string =>
    autoDate(ev) ||
    (s.key === "project_created" ? autoDate({ createdAt: projectCreatedAt }) : "");

  return (
    <div style={{ padding: "12px 4px" }}>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
        Advance the project stage by stage. Each “Mark done” updates the
        client’s tracker instantly.
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</div>
      ) : (
        TRACKER_STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";
          const ev = eventForStage(s.key);
          const isCurrent = state === "current";
          // Removed (hidden) stages don't render; the current one can't be hidden.
          if (isHidden(s.key) && !isCurrent) return null;
          return (
            <React.Fragment key={s.key}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderBottom: "1px solid #f1f1f1",
                background: isCurrent ? "#EEEDFE" : undefined,
                borderRadius: isCurrent ? 8 : 0,
                border: isCurrent ? "1px solid #534AB7" : undefined,
                margin: isCurrent ? "4px 0" : undefined,
              }}
            >
              <div style={dot(state)}>
                {state === "done" ? "✓" : state === "current" ? "●" : "○"}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: isCurrent ? 600 : 400,
                    color: state === "upcoming" ? "#9ca3af" : "#26215C",
                  }}
                >
                  {labelForStage(s)}
                </div>
                {i <= current ? (
                  editStageKey === s.key ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        marginTop: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <input
                        value={editStageLabel}
                        onChange={(e) => setEditStageLabel(e.target.value)}
                        placeholder="Stage name"
                        title="Rename this stage (this project only)"
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          padding: "3px 7px",
                          fontSize: 12,
                          flex: "1 1 160px",
                        }}
                      />
                      <button
                        onClick={saveEditStage}
                        disabled={saving}
                        style={{
                          background: NOW,
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "3px 9px",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditStageKey(null)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#9ca3af",
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    rowDate(s, ev) && (
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {rowDate(s, ev)}
                      </div>
                    )
                  )
                ) : null}
              </div>
              {/* "Mark done" only for MANUAL steps. The first 5 steps
                  (indices 0–4) advance AUTOMATICALLY from the project status
                  (open → quotation_requested → …_pending_approval → …_sent →
                  …_accepted), so a manual button there is redundant. Steps 6+
                  have no status trigger and still need it. */}
              {isCurrent && canAdvance && i >= 5 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={markDone}
                    disabled={saving}
                    style={{
                      background: NOW,
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {saving ? "Saving…" : "✓ Mark done"}
                  </button>
                </div>
              )}
              {isCurrent && !canAdvance && (
                <span style={{ fontSize: 12, color: DONE, fontWeight: 600 }}>
                  Completed 🎉
                </span>
              )}
              {/* "Close Project" — the final action, on the final step.
                  Anchored to the stage KEY rather than `isCurrent`: the quote
                  can be accepted while the tracker still sits on an earlier
                  stage, and gating on "current" there would leave no way to
                  close the project at all. */}
              {s.key === "completed_handover" && canCloseProject && (
                <button
                  onClick={onCloseProject}
                  disabled={closingProject}
                  title="The client has accepted the quote — close this project"
                  style={{
                    background: "#414063",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: closingProject ? "default" : "pointer",
                    opacity: closingProject ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {closingProject ? "Closing…" : "Close Project"}
                </button>
              )}
              {/* Action icons show only on DONE (disabled/locked) and CURRENT
                  steps. Upcoming steps show no icons at all. */}
              {state !== "upcoming" && editStageKey !== s.key && (
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <button
                    onClick={() => {
                      if (state !== "done") openMail(s);
                    }}
                    disabled={state === "done"}
                    title={
                      state === "done"
                        ? "Completed step — locked"
                        : "Send an email to the client for this step"
                    }
                    aria-label="Send mail to client"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: state === "done" ? "#c4c1cb" : "#0F6E56",
                      fontSize: 15,
                      lineHeight: 1,
                      cursor: state === "done" ? "not-allowed" : "pointer",
                      padding: "2px 6px",
                    }}
                  >
                    ✉
                  </button>
                  {i <= current && (
                    <button
                      onClick={() => {
                        if (state === "done") return;
                        setEditStageKey(s.key);
                        setEditStageDate(ev?.expectedDate || "");
                        setEditStageLabel(labelForStage(s));
                      }}
                      disabled={state === "done"}
                      title={
                        state === "done"
                          ? "Completed step — locked"
                          : "Edit name"
                      }
                      aria-label="Edit name"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: state === "done" ? "#c4c1cb" : "#534AB7",
                        fontSize: 14,
                        lineHeight: 1,
                        cursor: state === "done" ? "not-allowed" : "pointer",
                        padding: "2px 6px",
                      }}
                    >
                      ✎
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      onClick={() => {
                        if (state !== "done") hideStage(s.key);
                      }}
                      disabled={saving || state === "done"}
                      title={
                        state === "done"
                          ? "Completed step — locked"
                          : "Remove this stage from this project"
                      }
                      aria-label="Remove stage"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: state === "done" ? "#e0bcbc" : "#b91c1c",
                        lineHeight: 1,
                        display: "flex",
                        alignItems: "center",
                        cursor:
                          saving || state === "done"
                            ? "not-allowed"
                            : "pointer",
                        padding: "2px 6px",
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              )}
            </div>
            {customsForStage(s.key, isCurrent).map((cs) => (
                <div
                  key={cs._id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderBottom: "1px solid #f6f6f6",
                  }}
                >
                  <div style={dot("done")}>✓</div>
                  {editCustomId === cs._id ? (
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <input
                        value={editCustomLabel}
                        onChange={(e) => setEditCustomLabel(e.target.value)}
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          padding: "5px 8px",
                          fontSize: 13,
                          flex: "1 1 200px",
                        }}
                      />
                      <input
                        type="date"
                        value={editCustomDate}
                        onChange={(e) => setEditCustomDate(e.target.value)}
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          padding: "4px 7px",
                          fontSize: 12,
                        }}
                      />
                      <button
                        onClick={saveEditCustom}
                        disabled={saving}
                        style={{
                          background: NOW,
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditCustomId(null)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#9ca3af",
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#26215C" }}>
                          {cs.title || "Custom step"}
                        </div>
                        {cs.expectedDate && (
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            expected {cs.expectedDate}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setEditCustomId(cs._id);
                          setEditCustomLabel(cs.title || "");
                          setEditCustomDate(cs.expectedDate || "");
                        }}
                        title="Edit this step"
                        aria-label="Edit custom step"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#534AB7",
                          fontSize: 13,
                          cursor: "pointer",
                          padding: "2px 6px",
                        }}
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => deleteCustom(cs._id)}
                        disabled={saving}
                        title="Remove this custom step"
                        aria-label="Remove custom step"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#b91c1c",
                          lineHeight: 1,
                          display: "flex",
                          alignItems: "center",
                          cursor: saving ? "default" : "pointer",
                          padding: "2px 6px",
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </React.Fragment>
          );
        })
      )}

      {!loading && hiddenStages.length > 0 && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: "1px solid #eee",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: ".04em",
              marginBottom: 6,
            }}
          >
            Removed stages
          </div>
          {hiddenStages.map((s) => (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: "#9ca3af",
                  textDecoration: "line-through",
                }}
              >
                {labelForStage(s)}
              </span>
              <button
                onClick={() => restoreStage(s.key)}
                disabled={saving}
                title="Restore this stage"
                style={{
                  background: "transparent",
                  border: "1px solid #c4c1db",
                  color: "#534AB7",
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ↺ Restore
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div style={{ paddingTop: 10 }}>
          {showAdd ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                autoFocus
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Custom step (e.g. Waiting for client approval)"
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  padding: "6px 9px",
                  fontSize: 13,
                  flex: "1 1 240px",
                }}
              />
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                title="Expected date (optional)"
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  padding: "5px 8px",
                  fontSize: 12,
                }}
              />
              {/* Choose exactly where the step goes — placed AFTER this stage. */}
              <select
                value={customAfter}
                onChange={(e) => setCustomAfter(e.target.value)}
                title="Place this step after…"
                style={{
                  border: "1px solid #7F77DD",
                  borderRadius: 6,
                  padding: "5px 8px",
                  fontSize: 12,
                  color: "#26215C",
                }}
              >
                {TRACKER_STAGES.flatMap((st) => [
                  <option key={st.key} value={st.key}>
                    After: {labelForStage(st)}
                  </option>,
                  // Custom steps already anchored to this stage — pick one to
                  // drop the new step into the same group (it lands after it).
                  ...customSteps
                    .filter((cs) => cs.note === st.key)
                    .map((cs) => (
                      <option key={cs._id} value={`custom:${cs._id}`}>
                        After: {cs.title || "Custom step"}
                      </option>
                    )),
                ])}
              </select>
              <button
                onClick={addCustom}
                disabled={saving || !customLabel.trim()}
                style={{
                  background: NOW,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: saving || !customLabel.trim() ? 0.6 : 1,
                }}
              >
                {saving ? "Saving…" : "Add step"}
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setCustomLabel("");
                  setCustomDate("");
                  setCustomAfter("");
                }}
                style={{
                  background: "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#6b7280",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowAdd(true);
                // Default the placement to the stage the project is on now.
                setCustomAfter(
                  TRACKER_STAGES[Math.min(Math.max(current, 0), total - 1)]
                    ?.key || ""
                );
              }}
              style={{
                background: "transparent",
                border: "1px dashed #c4c1db",
                color: "#534AB7",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Add custom step
            </button>
          )}
        </div>
      )}

      {/* Send-mail popup — opens when the ✉ icon on a step is clicked. */}
      {mailKey && (
        <div
          onClick={() => {
            if (!mailSending) setMailKey(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "min(560px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0F6E56" }}>
                ✉ Email the client
                {(() => {
                  const st = TRACKER_STAGES.find((x) => x.key === mailKey);
                  return st ? ` — ${labelForStage(st)}` : "";
                })()}
              </div>
              <button
                onClick={() => setMailKey(null)}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 22,
                  color: "#9ca3af",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {/* Recipient (read-only) — a warning if the project has no client email. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <span style={{ color: "#6b7280", minWidth: 28 }}>To:</span>
              {clientEmail ? (
                <span style={{ fontWeight: 600, color: "#26215C" }}>
                  {clientEmail}
                </span>
              ) : (
                <span style={{ color: "#b45309", fontSize: 12 }}>
                  ⚠ No client email set — add one on the project first.
                </span>
              )}
            </div>

            <label style={{ fontSize: 12, color: "#6b7280" }}>Cc (optional)</label>
            <input
              value={mailCc}
              onChange={(e) => setMailCc(e.target.value)}
              placeholder="architect@pazl.info, colleague@pazl.info"
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 14,
              }}
            />

            <label style={{ fontSize: 12, color: "#6b7280" }}>Subject</label>
            <input
              autoFocus
              value={mailSubject}
              onChange={(e) => setMailSubject(e.target.value)}
              placeholder="Subject"
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 14,
              }}
            />

            <label style={{ fontSize: 12, color: "#6b7280" }}>Message</label>
            <textarea
              value={mailMessage}
              onChange={(e) => setMailMessage(e.target.value)}
              placeholder="Write a message to the client…"
              rows={5}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 14,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />

            <label style={{ fontSize: 12, color: "#6b7280" }}>
              Attachment (optional)
            </label>
            <input
              type="file"
              onChange={(e) => setMailFile(e.target.files?.[0] || null)}
              style={{ fontSize: 13 }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                justifyContent: "flex-end",
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => setMailKey(null)}
                style={{
                  background: "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#6b7280",
                }}
              >
                Cancel
              </button>
              <button
                onClick={sendMail}
                disabled={mailSending}
                style={{
                  background: DONE,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: mailSending ? "default" : "pointer",
                  opacity: mailSending ? 0.6 : 1,
                }}
              >
                {mailSending ? "Sending…" : "✉ Send to client"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast — success / error feedback after sending (auto-dismisses). */}
      <Toast toast={toast} />
    </div>
  );
};

export default TrackerAdmin;
