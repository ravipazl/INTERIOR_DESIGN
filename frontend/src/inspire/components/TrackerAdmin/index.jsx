import React, { useEffect, useState } from "react";
import {
  listItems,
  createItem,
  updateItem,
  removeItem,
  sendStepMail,
} from "../../services/projectWorkspaceService";
import { getCurrentUser } from "../../services/authService";
import {
  TRACKER_STAGES,
  stageLabel,
  stageIndexByKey,
  statusToStageIndex,
} from "../../utils/trackerStages";

/**
 * TrackerAdmin (Inspire app) — team control panel ported from the design app.
 * Advance stages, edit/rename, remove/restore, add custom steps, and email the
 * client per step. Writes the SAME shared stage_event data as the design app.
 */

const DONE = "#0F6E56";
const NOW = "#534AB7";

const TrashIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const TrackerAdmin = ({ projectId, status, clientEmail, projectCreatedAt, onAdvance }) => {
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [customAfter, setCustomAfter] = useState("");
  const [editCustomId, setEditCustomId] = useState(null);
  const [editCustomLabel, setEditCustomLabel] = useState("");
  const [editCustomDate, setEditCustomDate] = useState("");
  const [editStageKey, setEditStageKey] = useState(null);
  const [editStageLabel, setEditStageLabel] = useState("");
  const [mailKey, setMailKey] = useState(null);
  const [mailSubject, setMailSubject] = useState("");
  const [mailMessage, setMailMessage] = useState("");
  const [mailCc, setMailCc] = useState("");
  const [mailFile, setMailFile] = useState(null);
  const [mailSending, setMailSending] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  };

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    let rows = (await listItems(projectId, "stage_event")) || [];
    const unanchored = rows.filter((e) => e.stage === "__custom" && !e.note);
    if (unanchored.length) {
      const fixed = rows.map((e) => stageIndexByKey(e.stage)).filter((i) => i >= 0);
      const cur = Math.max(statusToStageIndex(status), fixed.length ? Math.max(...fixed) : -1);
      const anchorKey = TRACKER_STAGES[Math.min(Math.max(cur, 0), TRACKER_STAGES.length - 1)]?.key;
      if (anchorKey) {
        await Promise.all(unanchored.map((cs) => updateItem(cs._id, { note: anchorKey })));
        rows = (await listItems(projectId, "stage_event")) || [];
      }
    }
    setEvents(rows);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!mailKey) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !mailSending) setMailKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mailKey, mailSending]);

  const fixedIdxs = events.map((e) => stageIndexByKey(e.stage)).filter((i) => i >= 0);
  const latestEventIdx = fixedIdxs.length ? Math.max(...fixedIdxs) : -1;
  const current = Math.max(statusToStageIndex(status), latestEventIdx);
  const total = TRACKER_STAGES.length;
  const nextIdx = current + 1;
  const canAdvance = nextIdx < total;

  const customSteps = events.filter((e) => e.stage === "__custom").slice().reverse();
  const eventForStage = (key) => events.find((e) => e.stage === key);
  const labelForStage = (s) => eventForStage(s.key)?.title || s.label;
  const isHidden = (key) => eventForStage(key)?.status === "hidden";
  const hiddenStages = TRACKER_STAGES.filter((s) => isHidden(s.key));
  const customsForStage = (key, isCurrent) =>
    customSteps.filter((cs) => (cs.note ? cs.note === key : isCurrent));
  const autoDate = (ev) => {
    if (!ev?.createdAt) return "";
    try {
      return new Date(ev.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return "";
    }
  };
  // "Project started" has no event → fall back to the project's creation date.
  const rowDate = (s, ev) =>
    autoDate(ev) || (s.key === "project_created" ? autoDate({ createdAt: projectCreatedAt }) : "");

  const markDone = async () => {
    if (!canAdvance || saving) return;
    setSaving(true);
    try {
      const next = TRACKER_STAGES[nextIdx];
      const user = getCurrentUser();
      await createItem({ projectId, kind: "stage_event", stage: next.key, by: user?._id, auto: false });
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const saveEditStage = async () => {
    if (!editStageKey || saving) return;
    setSaving(true);
    try {
      const def = TRACKER_STAGES.find((s) => s.key === editStageKey)?.label;
      const name = editStageLabel.trim();
      const titleOverride = name && name !== def ? name : "";
      const ev = eventForStage(editStageKey);
      if (ev?._id) await updateItem(ev._id, { title: titleOverride });
      else {
        const user = getCurrentUser();
        await createItem({ projectId, kind: "stage_event", stage: editStageKey, title: titleOverride, by: user?._id, auto: false });
      }
      setEditStageKey(null);
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const hideStage = async (key) => {
    if (saving) return;
    setSaving(true);
    try {
      const ev = eventForStage(key);
      if (ev?._id) await updateItem(ev._id, { status: "hidden" });
      else {
        const user = getCurrentUser();
        await createItem({ projectId, kind: "stage_event", stage: key, status: "hidden", by: user?._id, auto: false });
      }
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const restoreStage = async (key) => {
    if (saving) return;
    setSaving(true);
    try {
      const ev = eventForStage(key);
      if (ev?._id) await updateItem(ev._id, { status: "" });
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const deleteCustom = async (id) => {
    if (!id || saving) return;
    setSaving(true);
    try {
      await removeItem(id);
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const saveEditCustom = async () => {
    if (!editCustomId || saving) return;
    setSaving(true);
    try {
      await updateItem(editCustomId, { title: editCustomLabel.trim() || "Custom step", expectedDate: editCustomDate || undefined });
      setEditCustomId(null);
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const addCustom = async () => {
    const label = customLabel.trim();
    if (!label || saving) return;
    setSaving(true);
    try {
      const user = getCurrentUser();
      let anchorKey = customAfter || TRACKER_STAGES[Math.min(Math.max(current, 0), total - 1)]?.key;
      if (customAfter.startsWith("custom:")) {
        const cid = customAfter.slice("custom:".length);
        anchorKey = customSteps.find((c) => c._id === cid)?.note || TRACKER_STAGES[Math.min(Math.max(current, 0), total - 1)]?.key;
      }
      await createItem({ projectId, kind: "stage_event", stage: "__custom", title: label, note: anchorKey, expectedDate: customDate || undefined, by: user?._id, auto: false });
      setCustomLabel("");
      setCustomDate("");
      setCustomAfter("");
      setShowAdd(false);
      await load();
      onAdvance && onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const openMail = (s) => {
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
      const res = await sendStepMail({ projectId, stage: mailKey, subject: mailSubject.trim() || "Update", message: mailMessage.trim(), cc: mailCc.trim() || undefined, file: mailFile });
      if (res.sent) {
        setMailKey(null);
        setMailFile(null);
        showToast("success", "Successfully sent mail");
      } else showToast("error", res.error || "Send failed");
    } catch {
      showToast("error", "Send failed");
    } finally {
      setMailSending(false);
    }
  };

  const dot = (state) => ({
    width: 24, height: 24, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, border: "1px solid",
    ...(state === "done" ? { background: "#E1F5EE", borderColor: DONE, color: DONE } : state === "current" ? { background: "#EEEDFE", borderColor: NOW, color: NOW } : { background: "#F1EFE8", borderColor: "#e5e7eb", color: "#9ca3af" }),
  });

  return (
    <div style={{ padding: "12px 4px" }}>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
        Advance the project stage by stage. Each “Mark done” updates the client’s tracker instantly.
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</div>
      ) : (
        TRACKER_STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";
          const ev = eventForStage(s.key);
          const isCurrent = state === "current";
          if (isHidden(s.key) && !isCurrent) return null;
          return (
            <React.Fragment key={s.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderBottom: "1px solid #f1f1f1", background: isCurrent ? "#EEEDFE" : undefined, borderRadius: isCurrent ? 8 : 0, border: isCurrent ? "1px solid #534AB7" : undefined, margin: isCurrent ? "4px 0" : undefined }}>
                <div style={dot(state)}>{state === "done" ? "✓" : state === "current" ? "●" : "○"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: isCurrent ? 600 : 400, color: state === "upcoming" ? "#9ca3af" : "#26215C" }}>{labelForStage(s)}</div>
                  {i <= current ? (
                    editStageKey === s.key ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                        <input value={editStageLabel} onChange={(e) => setEditStageLabel(e.target.value)} placeholder="Stage name" style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "3px 7px", fontSize: 12, flex: "1 1 160px" }} />
                        <button onClick={saveEditStage} disabled={saving} style={{ background: NOW, color: "#fff", border: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditStageKey(null)} style={{ background: "transparent", border: "none", color: "#9ca3af", fontSize: 14, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      rowDate(s, ev) && <div style={{ fontSize: 12, color: "#6b7280" }}>{rowDate(s, ev)}</div>
                    )
                  ) : null}
                </div>
                {/* "Mark done" only for MANUAL steps (6+). The first 5 advance
                    automatically from the project status, so no manual button. */}
                {isCurrent && canAdvance && i >= 5 && (
                  <button onClick={markDone} disabled={saving} style={{ background: NOW, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, whiteSpace: "nowrap" }}>{saving ? "Saving…" : "✓ Mark done"}</button>
                )}
                {isCurrent && !canAdvance && <span style={{ fontSize: 12, color: DONE, fontWeight: 600 }}>Completed 🎉</span>}
                {state !== "upcoming" && editStageKey !== s.key && (
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button onClick={() => { if (state !== "done") openMail(s); }} disabled={state === "done"} title={state === "done" ? "Completed step — locked" : "Send an email to the client"} style={{ background: "transparent", border: "none", color: state === "done" ? "#c4c1cb" : "#0F6E56", fontSize: 15, lineHeight: 1, cursor: state === "done" ? "not-allowed" : "pointer", padding: "2px 6px" }}>✉</button>
                    {i <= current && (
                      <button onClick={() => { if (state === "done") return; setEditStageKey(s.key); setEditStageLabel(labelForStage(s)); }} disabled={state === "done"} title={state === "done" ? "Completed step — locked" : "Edit name"} style={{ background: "transparent", border: "none", color: state === "done" ? "#c4c1cb" : "#534AB7", fontSize: 14, lineHeight: 1, cursor: state === "done" ? "not-allowed" : "pointer", padding: "2px 6px" }}>✎</button>
                    )}
                    {!isCurrent && (
                      <button onClick={() => { if (state !== "done") hideStage(s.key); }} disabled={saving || state === "done"} title={state === "done" ? "Completed step — locked" : "Remove this stage"} style={{ background: "transparent", border: "none", color: state === "done" ? "#e0bcbc" : "#b91c1c", lineHeight: 1, display: "flex", alignItems: "center", cursor: saving || state === "done" ? "not-allowed" : "pointer", padding: "2px 6px" }}><TrashIcon /></button>
                    )}
                  </div>
                )}
              </div>
              {customsForStage(s.key, isCurrent).map((cs) => (
                <div key={cs._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: "1px solid #f6f6f6" }}>
                  <div style={dot("done")}>✓</div>
                  {editCustomId === cs._id ? (
                    <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input value={editCustomLabel} onChange={(e) => setEditCustomLabel(e.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 8px", fontSize: 13, flex: "1 1 200px" }} />
                      <input type="date" value={editCustomDate} onChange={(e) => setEditCustomDate(e.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 7px", fontSize: 12 }} />
                      <button onClick={saveEditCustom} disabled={saving} style={{ background: NOW, color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditCustomId(null)} style={{ background: "transparent", border: "none", color: "#9ca3af", fontSize: 14, cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#26215C" }}>{cs.title || "Custom step"}</div>
                        {cs.expectedDate && <div style={{ fontSize: 12, color: "#6b7280" }}>expected {cs.expectedDate}</div>}
                      </div>
                      <button onClick={() => { setEditCustomId(cs._id); setEditCustomLabel(cs.title || ""); setEditCustomDate(cs.expectedDate || ""); }} title="Edit this step" style={{ background: "transparent", border: "none", color: "#534AB7", fontSize: 13, cursor: "pointer", padding: "2px 6px" }}>✎</button>
                      <button onClick={() => deleteCustom(cs._id)} disabled={saving} title="Remove this custom step" style={{ background: "transparent", border: "none", color: "#b91c1c", lineHeight: 1, display: "flex", alignItems: "center", cursor: saving ? "default" : "pointer", padding: "2px 6px" }}><TrashIcon /></button>
                    </>
                  )}
                </div>
              ))}
            </React.Fragment>
          );
        })
      )}

      {!loading && hiddenStages.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #eee" }}>
          <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Removed stages</div>
          {hiddenStages.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <span style={{ flex: 1, fontSize: 13, color: "#9ca3af", textDecoration: "line-through" }}>{labelForStage(s)}</span>
              <button onClick={() => restoreStage(s.key)} disabled={saving} style={{ background: "transparent", border: "1px solid #c4c1db", color: "#534AB7", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↺ Restore</button>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div style={{ paddingTop: 10 }}>
          {showAdd ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input autoFocus value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Custom step (e.g. Waiting for client approval)" style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 9px", fontSize: 13, flex: "1 1 240px" }} />
              <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 8px", fontSize: 12 }} />
              <select value={customAfter} onChange={(e) => setCustomAfter(e.target.value)} style={{ border: "1px solid #7F77DD", borderRadius: 6, padding: "5px 8px", fontSize: 12, color: "#26215C" }}>
                {TRACKER_STAGES.flatMap((st) => [
                  <option key={st.key} value={st.key}>After: {labelForStage(st)}</option>,
                  ...customSteps.filter((cs) => cs.note === st.key).map((cs) => (
                    <option key={cs._id} value={`custom:${cs._id}`}>After: {cs.title || "Custom step"}</option>
                  )),
                ])}
              </select>
              <button onClick={addCustom} disabled={saving || !customLabel.trim()} style={{ background: NOW, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: saving || !customLabel.trim() ? 0.6 : 1 }}>{saving ? "Saving…" : "Add step"}</button>
              <button onClick={() => { setShowAdd(false); setCustomLabel(""); setCustomDate(""); setCustomAfter(""); }} style={{ background: "transparent", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => { setShowAdd(true); setCustomAfter(TRACKER_STAGES[Math.min(Math.max(current, 0), total - 1)]?.key || ""); }} style={{ background: "transparent", border: "1px dashed #c4c1db", color: "#534AB7", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add custom step</button>
          )}
        </div>
      )}

      {mailKey && (
        <div onClick={() => { if (!mailSending) setMailKey(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.35)", padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0F6E56" }}>✉ Email the client{(() => { const st = TRACKER_STAGES.find((x) => x.key === mailKey); return st ? ` — ${labelForStage(st)}` : ""; })()}</div>
              <button onClick={() => setMailKey(null)} style={{ background: "transparent", border: "none", fontSize: 22, color: "#9ca3af", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ color: "#6b7280", minWidth: 28 }}>To:</span>
              {clientEmail ? <span style={{ fontWeight: 600, color: "#26215C" }}>{clientEmail}</span> : <span style={{ color: "#b45309", fontSize: 12 }}>⚠ No client email set — add one on the project first.</span>}
            </div>
            <label style={{ fontSize: 12, color: "#6b7280" }}>Cc (optional)</label>
            <input value={mailCc} onChange={(e) => setMailCc(e.target.value)} placeholder="architect@pazl.info, colleague@pazl.info" style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 14 }} />
            <label style={{ fontSize: 12, color: "#6b7280" }}>Subject</label>
            <input autoFocus value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} placeholder="Subject" style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 14 }} />
            <label style={{ fontSize: 12, color: "#6b7280" }}>Message</label>
            <textarea value={mailMessage} onChange={(e) => setMailMessage(e.target.value)} placeholder="Write a message to the client…" rows={5} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 14, resize: "vertical", fontFamily: "inherit" }} />
            <label style={{ fontSize: 12, color: "#6b7280" }}>Attachment (optional)</label>
            <input type="file" onChange={(e) => setMailFile(e.target.files?.[0] || null)} style={{ fontSize: 13 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setMailKey(null)} style={{ background: "transparent", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#6b7280" }}>Cancel</button>
              <button onClick={sendMail} disabled={mailSending} style={{ background: DONE, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: mailSending ? "default" : "pointer", opacity: mailSending ? 0.6 : 1 }}>{mailSending ? "Sending…" : "✉ Send to client"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 11000, background: toast.type === "success" ? "#0F6E56" : "#b91c1c", color: "#fff", padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 28px rgba(0,0,0,0.28)", display: "flex", alignItems: "center", gap: 8, maxWidth: 360 }}>
          <span style={{ fontSize: 15 }}>{toast.type === "success" ? "✓" : "⚠"}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
};

export default TrackerAdmin;
