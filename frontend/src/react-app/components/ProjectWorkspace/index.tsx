import React, { useEffect, useRef, useState } from "react";
import {
  ProjectWorkspaceService as WS,
  ProjectItem,
  ItemKind,
  resolveFileUrl,
} from "@pazl/services/ProjectWorkspaceService";
import { AuthService } from "@pazl/services/authService";
import TrackerAdmin from "@pazl/components/TrackerAdmin";
import Toast, { ToastState } from "@pazl/components/Toast";
import { TRACKER_STAGES } from "@pazl/utils/trackerStages";

// Human label for a tracker step key (e.g. "design_finalized" → "Design finalized").
const stageLabel = (key?: string) =>
  TRACKER_STAGES.find((s) => s.key === key)?.label || "";

/**
 * ProjectWorkspace — per-project tabs to capture the real-world project work:
 *  Documents & Media (client PDFs / images / audio recordings),
 *  Change Requests, Tasks (done/not-done), Discussions, and the project Tracker
 *  (team advances the project stage by stage).
 */

const TABS: { key: ItemKind; label: string }[] = [
  { key: "document", label: "Documents & Media" },
  { key: "change", label: "Change Requests" },
  { key: "task", label: "Tasks" },
  { key: "discussion", label: "Discussions" },
  { key: "stage_event", label: "Tracker" },
];

const DOC_TYPES = ["Requirement", "Reference", "Contract", "Recording", "Other"];

const input: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
};
const btn: React.CSSProperties = {
  background: "var(--pz-accent, #059669)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 13,
  cursor: "pointer",
};
const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  marginBottom: 10,
  background: "#fff",
};
const muted: React.CSSProperties = { color: "#6b7280", fontSize: 12 };

const fmtDate = (s?: string) =>
  s ? new Date(s).toLocaleString() : "";
const isToday = (s?: string) => {
  if (!s) return false;
  const d = new Date(s);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
};

/**
 * Full-size media viewer. Renders nothing until `src` is set; clicking the
 * dark backdrop, the ✕, or pressing Esc clears it. Shows an image or, when
 * `kind` is "video", a player with controls. Kept in this file because it is
 * only ever opened from FilePreview's thumbnail.
 */
const MediaLightbox: React.FC<{
  src: string | null;
  kind: "image" | "video";
  onClose: () => void;
}> = ({ src, kind, onClose }) => {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;
  const mediaStyle: React.CSSProperties = {
    maxWidth: "90vw",
    maxHeight: "90vh",
    objectFit: "contain",
    borderRadius: 8,
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
    background: "#000",
  };
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 24,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 16,
          right: 20,
          background: "transparent",
          border: "none",
          color: "#fff",
          fontSize: 32,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        ×
      </button>
      {/* Stop clicks on the media itself from closing the popup — so you can
          use the video controls without the backdrop swallowing the click. */}
      {kind === "video" ? (
        <video
          src={src}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          style={mediaStyle}
        />
      ) : (
        <img
          src={src}
          alt=""
          onClick={(e) => e.stopPropagation()}
          style={mediaStyle}
        />
      )}
    </div>
  );
};

const FilePreview: React.FC<{ url?: string; mime?: string }> = ({
  url,
  mime,
}) => {
  const [zoomed, setZoomed] = useState(false);
  if (!url) return null;
  const src = resolveFileUrl(url);
  if ((mime || "").startsWith("image/"))
    return (
      <>
        <img
          src={src}
          alt=""
          title="Click to view full size"
          onClick={() => setZoomed(true)}
          style={{
            maxWidth: 160,
            maxHeight: 120,
            borderRadius: 6,
            marginTop: 6,
            cursor: "zoom-in",
          }}
        />
        <MediaLightbox
          src={zoomed ? src : null}
          kind="image"
          onClose={() => setZoomed(false)}
        />
      </>
    );
  if ((mime || "").startsWith("video/"))
    return (
      <>
        {/* A muted <video> shows the first frame as a thumbnail. The overlaid
            ▶ badge signals it's playable; clicking opens the popup player. */}
        <div
          onClick={() => setZoomed(true)}
          title="Click to play"
          style={{
            position: "relative",
            display: "inline-block",
            marginTop: 6,
            cursor: "pointer",
          }}
        >
          <video
            src={src}
            muted
            preload="metadata"
            style={{
              maxWidth: 160,
              maxHeight: 120,
              borderRadius: 6,
              display: "block",
              background: "#000",
            }}
          />
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 34,
              textShadow: "0 1px 6px rgba(0,0,0,0.7)",
              pointerEvents: "none",
            }}
          >
            ▶
          </span>
        </div>
        <MediaLightbox
          src={zoomed ? src : null}
          kind="video"
          onClose={() => setZoomed(false)}
        />
      </>
    );
  if ((mime || "").startsWith("audio/"))
    return (
      <audio controls src={src} style={{ display: "block", marginTop: 6 }} />
    );
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      style={{ color: "#2563eb", fontSize: 13, display: "inline-block", marginTop: 6 }}
    >
      ↗ Open file
    </a>
  );
};

const ProjectWorkspace: React.FC<{
  projectId?: string;
  status?: string;
  onChangeRequest?: () => void;
  // The Tracker tab is a TEAM control panel (advance / edit / remove stages).
  // Only the team (admin, super-admin, assigned architect) may see it — clients
  // get the read-only "Track your project" card at the top of the page instead.
  canManageTracker?: boolean;
  // When set (from clicking a step in "Track your project"), only items linked to
  // this tracker step are shown. `onClearFilter` removes the filter.
  filterStage?: string;
  onClearFilter?: () => void;
  // The client's email — passed to the Tracker tab's send-mail popup.
  clientEmail?: string;
  // The project's creation date — used as "Project started"'s date.
  projectCreatedAt?: string;
}> = ({
  projectId,
  status,
  onChangeRequest,
  canManageTracker = false,
  filterStage,
  onClearFilter,
  projectCreatedAt,
  clientEmail,
}) => {
  const [tab, setTab] = useState<ItemKind>("document");

  // Hide the Tracker tab from clients. (Also guards the render below so a stale
  // "stage_event" tab can never show the control panel to a non-team user.)
  const visibleTabs = TABS.filter(
    (t) => t.key !== "stage_event" || canManageTracker
  );
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Shared app toast (same look as the rest of the design app) — replaces the
  // native alert() this component used for validation/upload feedback.
  const [toast, setToast] = useState<ToastState>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const fileRef = useRef<HTMLInputElement>(null);

  // draft fields (reused across tabs)
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Which tracker step this new item relates to ("" = none). Links the item to a
  // step so clicking that step in the tracker surfaces it.
  const [relStage, setRelStage] = useState("");

  // Inline edit of a Documents & Media item's text (type / title / note). The
  // file itself is never touched here — only the metadata around it.
  const [editId, setEditId] = useState<string | null>(null);
  const [editType, setEditType] = useState(DOC_TYPES[0]);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  // Separate file input for the edit row, so picking a replacement here never
  // clashes with the main upload picker (fileRef).
  const editFileRef = useRef<HTMLInputElement>(null);

  const me =
    AuthService.getCurrentUser()?.name ||
    AuthService.getCurrentUser()?.email ||
    "";

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    setItems(await WS.list(projectId, tab));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tab]);

  // Default the "Related to" step to the step you've filtered/clicked to, so new
  // items auto-tag to that step (you can still change it before saving).
  useEffect(() => {
    setRelStage(filterStage || "");
  }, [filterStage]);

  const resetDraft = () => {
    setTitle("");
    setNote("");
    setText("");
    setAssignee("");
    setDueDate("");
    setRelStage(filterStage || "");
    if (fileRef.current) fileRef.current.value = "";
  };

  const addDocument = async () => {
    if (!projectId) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setToast({ type: "error", text: "Choose a file (PDF / image / audio)." });
      return;
    }
    setBusy(true);
    const up = await WS.uploadFile(projectId, file);
    if (up) {
      await WS.create({
        projectId,
        kind: "document",
        type: docType,
        title: title || up.originalName,
        fileUrl: up.fileUrl,
        mimeType: up.mimeType,
        note,
        stage: relStage || undefined,
        createdBy: me,
      });
      resetDraft();
      await load();
    } else {
      setToast({ type: "error", text: "Upload failed." });
    }
    setBusy(false);
  };

  const addChange = async () => {
    if (!projectId || !text.trim()) return;
    setBusy(true);
    let attachmentUrl: string | undefined;
    let mimeType: string | undefined;
    const file = fileRef.current?.files?.[0];
    if (file) {
      const up = await WS.uploadFile(projectId, file);
      attachmentUrl = up?.fileUrl;
      mimeType = up?.mimeType;
    }
    await WS.create({
      projectId,
      kind: "change",
      description: text,
      status: "pending",
      attachmentUrl,
      mimeType,
      stage: relStage || undefined,
      createdBy: me,
    });
    resetDraft();
    await load();
    // Tell the parent (ProjectDetail) to refetch the project so it sees the
    // changeRequestPending flag and hides the "Accept Quote" bar immediately.
    onChangeRequest?.();
    setBusy(false);
  };

  const addTask = async () => {
    if (!projectId || !title.trim()) return;
    setBusy(true);
    await WS.create({
      projectId,
      kind: "task",
      title,
      assignedTo: assignee,
      dueDate,
      status: "todo",
      stage: relStage || undefined,
      createdBy: me,
    });
    resetDraft();
    await load();
    setBusy(false);
  };

  const addDiscussion = async () => {
    if (!projectId || !text.trim()) return;
    setBusy(true);
    let attachmentUrl: string | undefined;
    let mimeType: string | undefined;
    const file = fileRef.current?.files?.[0];
    if (file) {
      const up = await WS.uploadFile(projectId, file);
      attachmentUrl = up?.fileUrl;
      mimeType = up?.mimeType;
    }
    await WS.create({
      projectId,
      kind: "discussion",
      text,
      author: me,
      attachmentUrl,
      mimeType,
      stage: relStage || undefined,
      createdBy: me,
    });
    resetDraft();
    await load();
    setBusy(false);
  };

  const removeItem = async (id?: string) => {
    if (!id) return;
    if (!window.confirm("Delete this?")) return;
    await WS.remove(id);
    await load();
  };

  const setStatus = async (id?: string, status?: string, extra?: any) => {
    if (!id) return;
    await WS.update(id, { status, ...(extra || {}) });
    await load();
  };

  const startEdit = (it: ProjectItem) => {
    setEditId(it._id || null);
    setEditType(it.type || DOC_TYPES[0]);
    setEditTitle(it.title || "");
    setEditNote(it.note || "");
  };

  const cancelEdit = () => {
    setEditId(null);
    if (editFileRef.current) editFileRef.current.value = "";
  };

  const saveEdit = async (id?: string) => {
    if (!id || !projectId) return;
    setBusy(true);
    const patch: any = { type: editType, title: editTitle, note: editNote };
    // Replacement file is optional. If the user picked one, upload it and point
    // the item at the new URL; if the upload fails, keep the old file rather
    // than saving a broken link. The old file is left on disk (harmless) — the
    // item simply stops referencing it.
    const file = editFileRef.current?.files?.[0];
    if (file) {
      const up = await WS.uploadFile(projectId, file);
      if (!up) {
        setBusy(false);
        setToast({ type: "error", text: "Could not upload the new file. The old file is unchanged." });
        return;
      }
      patch.fileUrl = up.fileUrl;
      patch.mimeType = up.mimeType;
    }
    await WS.update(id, patch);
    setBusy(false);
    setEditId(null);
    if (editFileRef.current) editFileRef.current.value = "";
    await load();
  };

  // "Related to step" dropdown reused in every add form — links the new item to
  // a tracker step (optional).
  const stageSelect = () => (
    <select
      style={{ ...input, minWidth: 150 }}
      value={relStage}
      onChange={(e) => setRelStage(e.target.value)}
      title="Link this to a tracker step (optional)"
    >
      <option value="">Related to: (no step)</option>
      {TRACKER_STAGES.map((s) => (
        <option key={s.key} value={s.key}>
          Related to: {s.label}
        </option>
      ))}
    </select>
  );

  // Apply the step filter (from clicking a step in "Track your project").
  const shown = filterStage
    ? items.filter((it) => it.stage === filterStage)
    : items;

  return (
    <div style={{ padding: 16 }}>
      <Toast toast={toast} />
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              background: tab === t.key ? "var(--pz-accent, #059669)" : "#f3f4f6",
              color: tab === t.key ? "#fff" : "#374151",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stage_event" && canManageTracker ? (
        <TrackerAdmin
          projectId={projectId || ""}
          status={status}
          onAdvance={onChangeRequest}
          clientEmail={clientEmail}
          projectCreatedAt={projectCreatedAt}
        />
      ) : (
      <>
      {/* Add form (per tab) */}
      <div style={{ ...card, background: "#f9fafb" }}>
        {tab === "document" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select style={input} value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} type="file" accept=".pdf,image/*,video/*,audio/*" style={{ fontSize: 12 }} />
            <button style={btn} disabled={busy} onClick={addDocument}>
              {busy ? "Uploading…" : "Upload"}
            </button>
          </div>
        )}
        {tab === "change" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 300px" }} placeholder="What change did the client ask for?" value={text} onChange={(e) => setText(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} type="file" accept=".pdf,image/*,video/*,audio/*" style={{ fontSize: 12 }} />
            <button style={btn} disabled={busy} onClick={addChange}>
              {busy ? "Saving…" : "Add change"}
            </button>
          </div>
        )}
        {tab === "task" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 220px" }} placeholder="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input style={{ ...input, width: 140 }} placeholder="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            <input style={input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {stageSelect()}
            <button style={btn} disabled={busy} onClick={addTask}>
              Add task
            </button>
          </div>
        )}
        {tab === "discussion" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 300px" }} placeholder="Note a discussion / decision…" value={text} onChange={(e) => setText(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} type="file" accept=".pdf,image/*,video/*,audio/*" style={{ fontSize: 12 }} />
            <button style={btn} disabled={busy} onClick={addDiscussion}>
              {busy ? "Saving…" : "Add note"}
            </button>
          </div>
        )}
      </div>

      {/* Active step filter (set by clicking a step in "Track your project"). */}
      {filterStage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            fontSize: 13,
            color: "#374151",
          }}
        >
          <span>Showing items for:</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#E6F1FB",
              color: "#0C447C",
              padding: "3px 10px",
              borderRadius: 999,
              fontWeight: 600,
            }}
          >
            {stageLabel(filterStage) || filterStage}
            <span
              onClick={onClearFilter}
              title="Clear filter"
              style={{ cursor: "pointer", fontWeight: 700 }}
            >
              ×
            </span>
          </span>
        </div>
      )}

      {/* List — capped height so a long list scrolls INSIDE this box instead
          of pushing the rest of the page (Bill of Quantity) down. Only the
          uploaded items scroll; tabs and the add form above stay put. */}
      <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
      {loading ? (
        <p style={muted}>Loading…</p>
      ) : shown.length === 0 ? (
        <p style={muted}>
          {filterStage
            ? `Nothing linked to “${stageLabel(filterStage) || filterStage}” here.`
            : "Nothing here yet."}
        </p>
      ) : (
        shown.map((it) => (
          <div key={it._id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ flex: 1 }}>
                {tab === "document" && (
                  <>
                    {editId === it._id ? (
                      // Edit mode: type / title / note become editable. The
                      // uploaded file below is left untouched.
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                        <select style={input} value={editType} onChange={(e) => setEditType(e.target.value)}>
                          {DOC_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <input style={{ ...input, flex: "1 1 160px" }} placeholder="Title (optional)" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                        <input style={{ ...input, flex: "1 1 160px" }} placeholder="Note (optional)" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                        {/* Optional replacement. Leave empty to keep the
                            current file; the label reminds the user of that. */}
                        <label style={{ ...muted, display: "flex", alignItems: "center", gap: 4 }}>
                          Replace file:
                          <input ref={editFileRef} type="file" accept=".pdf,image/*,video/*,audio/*" style={{ fontSize: 12 }} />
                        </label>
                        <button style={btn} disabled={busy} onClick={() => saveEdit(it._id)}>
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          style={{ ...btn, background: "#e5e7eb", color: "#374151" }}
                          disabled={busy}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        <span style={{ color: "#059669" }}>{it.type}</span> · {it.title}
                      </div>
                    )}
                    {editId !== it._id && it.note ? <div style={muted}>{it.note}</div> : null}
                    <FilePreview url={it.fileUrl} mime={it.mimeType} />
                  </>
                )}
                {tab === "change" && (
                  <>
                    <div style={{ fontSize: 13 }}>{it.description}</div>
                    <div style={{ marginTop: 4 }}>
                      {["pending", "in_progress", "done"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(it._id, s)}
                          style={{
                            marginRight: 6,
                            padding: "2px 8px",
                            fontSize: 11,
                            borderRadius: 4,
                            border: "1px solid #e5e7eb",
                            cursor: "pointer",
                            background: it.status === s ? "#059669" : "#fff",
                            color: it.status === s ? "#fff" : "#374151",
                          }}
                        >
                          {s.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                    <FilePreview url={it.attachmentUrl} mime={it.mimeType} />
                  </>
                )}
                {tab === "task" && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={it.status === "done"}
                      onChange={() =>
                        setStatus(
                          it._id,
                          it.status === "done" ? "todo" : "done",
                          { completedAt: it.status === "done" ? "" : new Date().toISOString() }
                        )
                      }
                    />
                    <span style={{ textDecoration: it.status === "done" ? "line-through" : "none" }}>
                      {it.title}
                    </span>
                    {it.assignedTo ? <span style={muted}>· {it.assignedTo}</span> : null}
                    {it.dueDate ? (
                      <span style={{ ...muted, color: isToday(it.dueDate) ? "#b45309" : "#6b7280" }}>
                        · due {it.dueDate}
                        {isToday(it.dueDate) ? " (today)" : ""}
                      </span>
                    ) : null}
                  </label>
                )}
                {tab === "discussion" && (
                  <>
                    <div style={{ fontSize: 13 }}>{it.text}</div>
                    <div style={muted}>
                      {it.author} · {fmtDate(it.createdAt)}
                    </div>
                    <FilePreview url={it.attachmentUrl} mime={it.mimeType} />
                  </>
                )}
                {tab !== "discussion" && (
                  <div style={{ ...muted, marginTop: 4 }}>
                    {it.createdBy ? `${it.createdBy} · ` : ""}
                    {fmtDate(it.createdAt)}
                  </div>
                )}
                {it.stage && stageLabel(it.stage) && (
                  <span
                    style={{
                      display: "inline-block",
                      marginTop: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#0C447C",
                      background: "#E6F1FB",
                      padding: "2px 9px",
                      borderRadius: 999,
                    }}
                  >
                    {stageLabel(it.stage)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                {tab === "document" && editId !== it._id && (
                  <button
                    onClick={() => startEdit(it)}
                    title="Edit"
                    style={{ border: "none", background: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 }}
                  >
                    ✎
                  </button>
                )}
                <button
                  onClick={() => removeItem(it._id)}
                  title="Delete"
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    padding: 2,
                    lineHeight: 0,
                    color: "#dc2626",
                  }}
                >
                  {/* Inline SVG trash can — unlike the 🗑️ emoji, this honours
                      `color`, so it can actually render red. */}
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))
      )}
      </div>
      </>
      )}
    </div>
  );
};

export default ProjectWorkspace;
