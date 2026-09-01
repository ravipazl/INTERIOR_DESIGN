import React, { useEffect, useRef, useState } from "react";
import {
  listItems,
  createItem,
  updateItem,
  removeItem,
  uploadFile,
  fileUrl,
} from "../../services/projectWorkspaceService";
import { toast } from "react-toastify";
import { getCurrentUser } from "../../services/authService";
import { USER_ROLES } from "../../utils/constants";
import { TRACKER_STAGES, stageLabel } from "../../utils/trackerStages";
import TrackerAdmin from "../TrackerAdmin";
import RendersVideos from "../../pages/ProjectDetail/RendersVideos";
import BoqView from "../BoqView";

/**
 * ProjectWorkspace (Inspire admin) — same per-project workspace the 3D app
 * writes to (documents/media, change requests, tasks, discussions), read/edited
 * from the DESIGN backend by projectId. Full edit for admins.
 */

const TABS = [
  { key: "document", label: "Documents & Media" },
  { key: "change", label: "Change Requests" },
  { key: "task", label: "Tasks" },
  { key: "discussion", label: "Discussions" },
];
const DOC_TYPES = ["Requirement", "Reference", "Contract", "Recording", "Other"];

const input = { border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", fontSize: 13 };
const btn = { background: "#0d6efd", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer" };
const card = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 10, background: "#fff" };
const muted = { color: "#6b7280", fontSize: 12 };

const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "");
const isToday = (s) => {
  if (!s) return false;
  const d = new Date(s);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

const FilePreview = ({ url, mime }) => {
  if (!url) return null;
  const src = fileUrl(url);
  if ((mime || "").startsWith("image/"))
    return <img src={src} alt="" style={{ maxWidth: 160, maxHeight: 120, borderRadius: 6, marginTop: 6 }} />;
  if ((mime || "").startsWith("audio/"))
    return <audio controls src={src} style={{ display: "block", marginTop: 6 }} />;
  return (
    <a href={src} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontSize: 13, display: "inline-block", marginTop: 6 }}>
      ↗ Open file
    </a>
  );
};

const ProjectWorkspace = ({ projectId, project, openSection, openSectionNonce, status, clientEmail, filterStage, onFilterChange, onChangeRequest }) => {
  const [tab, setTab] = useState("document");
  // Let the parent deep-link a sub-section (e.g. "Request a change" → the Change
  // Requests tab). The nonce re-triggers even when the same section is asked for.
  useEffect(() => {
    if (openSection) setTab(openSection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSection, openSectionNonce]);
  // Filter is controlled by the parent (so clicking a tracker step filters here).
  const stageFilter = filterStage || "";
  const setStageFilter = onFilterChange || (() => {});
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [relStage, setRelStage] = useState("");

  const meUser = getCurrentUser();
  const me = meUser?.name || meUser?.email || "";
  // Tasks are internal team workflow (admin ↔ architect). Hide that tab from the
  // client (USER role); they still get Documents, Change Requests & Discussions.
  const isClient = meUser?.permissions === USER_ROLES.USER;
  const baseTabs = isClient ? TABS.filter((t) => t.key !== "task") : TABS;
  // BOQ and Renders & Videos are workspace sections for everyone (client + team).
  const boqTab = { key: "boq", label: "BOQ" };
  const rendersTab = { key: "renders", label: "Renders & Videos" };
  // The Tracker control panel is team-only (hidden from clients).
  const visibleTabs = isClient
    ? [...baseTabs, boqTab, rendersTab]
    : [...baseTabs, boqTab, rendersTab, { key: "stage_event", label: "Tracker" }];

  const load = async () => {
    if (!projectId) return;
    // BOQ and Renders & Videos render their own components (fetch their own data).
    if (tab === "renders" || tab === "boq") return;
    setLoading(true);
    setItems(await listItems(projectId, tab));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tab]);

  // Default the "Related to" step to the step you've filtered/clicked to.
  useEffect(() => {
    setRelStage(stageFilter || "");
  }, [stageFilter]);

  const resetDraft = () => {
    setTitle("");
    setNote("");
    setText("");
    setAssignee("");
    setDueDate("");
    setRelStage(stageFilter || "");
    if (fileRef.current) fileRef.current.value = "";
  };

  const addDocument = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file)
      return toast.error("Choose a file (PDF / image / audio).", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    setBusy(true);
    const up = await uploadFile(projectId, file);
    if (up) {
      await createItem({ projectId, kind: "document", type: docType, title: title || up.originalName, fileUrl: up.fileUrl, mimeType: up.mimeType, note, stage: relStage || undefined, createdBy: me });
      resetDraft();
      await load();
    } else
      toast.error("Upload failed.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    setBusy(false);
  };

  const addWithAttachment = async (kind) => {
    if (!text.trim()) return;
    setBusy(true);
    let attachmentUrl, mimeType;
    const file = fileRef.current?.files?.[0];
    if (file) {
      const up = await uploadFile(projectId, file);
      attachmentUrl = up?.fileUrl;
      mimeType = up?.mimeType;
    }
    let createdChange = null;
    if (kind === "change")
      // Notifying admins + the architect is done RELIABLY on the backend
      // (project_items after.create hook), which fires no matter which app the
      // change was added from — see pazl-design-backend project_items.js. The
      // created item carries `.whatsapp` (the real send status) for the toast.
      createdChange = await createItem({ projectId, kind: "change", description: text, status: "pending", attachmentUrl, mimeType, stage: relStage || undefined, createdBy: me });
    else await createItem({ projectId, kind: "discussion", text, author: me, attachmentUrl, mimeType, stage: relStage || undefined, createdBy: me });
    resetDraft();
    await load();
    // A change request reopens the quote for a revision — tell the parent to
    // refresh the project so the "Accept / Request a change" bar hides until the
    // team sends a revised quotation.
    if (kind === "change") {
      onChangeRequest?.();
      const wa = createdChange?.whatsapp;
      const waMsg = wa?.sent
        ? ` · WhatsApp sent to +${wa.to}`
        : wa?.skipped && wa.reason === "no_phone"
        ? " · WhatsApp skipped — no phone"
        : wa && !wa.sent && !wa.skipped
        ? " · WhatsApp failed"
        : "";
      toast.success(
        "Change request sent — the team has been notified." + waMsg,
        {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        }
      );
    }
    setBusy(false);
  };

  const addTask = async () => {
    if (!title.trim()) return;
    setBusy(true);
    await createItem({ projectId, kind: "task", title, assignedTo: assignee, dueDate, status: "todo", stage: relStage || undefined, createdBy: me });
    resetDraft();
    await load();
    setBusy(false);
  };

  const del = async (id) => {
    if (!id || !window.confirm("Delete this?")) return;
    await removeItem(id);
    await load();
  };
  const setStatus = async (id, status, extra) => {
    if (!id) return;
    await updateItem(id, { status, ...(extra || {}) });
    await load();
  };

  const stageSelect = () => (
    <select style={{ ...input, minWidth: 150 }} value={relStage} onChange={(e) => setRelStage(e.target.value)} title="Link this to a tracker step (optional)">
      <option value="">Related to: (no step)</option>
      {TRACKER_STAGES.map((s) => (
        <option key={s.key} value={s.key}>Related to: {s.label}</option>
      ))}
    </select>
  );

  const shown = stageFilter ? items.filter((it) => it.stage === stageFilter) : items;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: tab === t.key ? "#0d6efd" : "#f3f4f6", color: tab === t.key ? "#fff" : "#374151" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "boq" ? (
        <BoqView
          projectId={projectId}
          project={project}
          quoteNumber={project?.boqNumber}
        />
      ) : tab === "renders" ? (
        <RendersVideos projectId={projectId} />
      ) : tab === "stage_event" && !isClient ? (
        <TrackerAdmin projectId={projectId} status={status} clientEmail={clientEmail} onAdvance={load} />
      ) : (
      <>
      <div style={{ ...card, background: "#f9fafb" }}>
        {tab === "document" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select style={input} value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} type="file" accept=".pdf,image/*,audio/*" style={{ fontSize: 12 }} />
            <button style={btn} disabled={busy} onClick={addDocument}>{busy ? "Uploading…" : "Upload"}</button>
          </div>
        )}
        {tab === "change" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 300px" }} placeholder="What change did the client ask for?" value={text} onChange={(e) => setText(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} type="file" accept=".pdf,image/*,audio/*" style={{ fontSize: 12 }} />
            <button style={btn} disabled={busy} onClick={() => addWithAttachment("change")}>{busy ? "Saving…" : "Add change"}</button>
          </div>
        )}
        {tab === "task" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 220px" }} placeholder="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input style={{ ...input, width: 140 }} placeholder="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            <input style={input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {stageSelect()}
            <button style={btn} disabled={busy} onClick={addTask}>Add task</button>
          </div>
        )}
        {tab === "discussion" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 300px" }} placeholder="Note a discussion / decision…" value={text} onChange={(e) => setText(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} type="file" accept=".pdf,image/*,audio/*" style={{ fontSize: 12 }} />
            <button style={btn} disabled={busy} onClick={() => addWithAttachment("discussion")}>{busy ? "Saving…" : "Add note"}</button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
        <span style={muted}>Filter by step:</span>
        <select style={{ ...input, minWidth: 160 }} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All steps</option>
          {TRACKER_STAGES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        {stageFilter && (
          <button onClick={() => setStageFilter("")} style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#374151" }}>
            Clear ✕
          </button>
        )}
      </div>

      {loading ? (
        <p style={muted}>Loading…</p>
      ) : shown.length === 0 ? (
        <p style={muted}>{stageFilter ? `Nothing linked to “${stageLabel(stageFilter)}” here.` : "Nothing here yet."}</p>
      ) : (
        shown.map((it) => (
          <div key={it._id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ flex: 1 }}>
                {tab === "document" && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      <span style={{ color: "#0d6efd" }}>{it.type}</span> · {it.title}
                    </div>
                    {it.note ? <div style={muted}>{it.note}</div> : null}
                    <FilePreview url={it.fileUrl} mime={it.mimeType} />
                  </>
                )}
                {tab === "change" && (
                  <>
                    <div style={{ fontSize: 13 }}>{it.description}</div>
                    <div style={{ marginTop: 4 }}>
                      {["pending", "in_progress", "done"].map((s) => (
                        <button key={s} onClick={() => setStatus(it._id, s)} style={{ marginRight: 6, padding: "2px 8px", fontSize: 11, borderRadius: 4, border: "1px solid #e5e7eb", cursor: "pointer", background: it.status === s ? "#0d6efd" : "#fff", color: it.status === s ? "#fff" : "#374151" }}>
                          {s.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                    <FilePreview url={it.attachmentUrl} mime={it.mimeType} />
                  </>
                )}
                {tab === "task" && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" checked={it.status === "done"} onChange={() => setStatus(it._id, it.status === "done" ? "todo" : "done", { completedAt: it.status === "done" ? "" : new Date().toISOString() })} />
                    <span style={{ textDecoration: it.status === "done" ? "line-through" : "none" }}>{it.title}</span>
                    {it.assignedTo ? <span style={muted}>· {it.assignedTo}</span> : null}
                    {it.dueDate ? <span style={{ ...muted, color: isToday(it.dueDate) ? "#b45309" : "#6b7280" }}>· due {it.dueDate}{isToday(it.dueDate) ? " (today)" : ""}</span> : null}
                  </label>
                )}
                {tab === "discussion" && (
                  <>
                    <div style={{ fontSize: 13 }}>{it.text}</div>
                    <div style={muted}>{it.author} · {fmtDate(it.createdAt)}</div>
                    <FilePreview url={it.attachmentUrl} mime={it.mimeType} />
                  </>
                )}
                {tab !== "discussion" && (
                  <div style={{ ...muted, marginTop: 4 }}>{it.createdBy ? `${it.createdBy} · ` : ""}{fmtDate(it.createdAt)}</div>
                )}
                {it.stage && stageLabel(it.stage) && (
                  <span style={{ display: "inline-block", marginTop: 6, fontSize: 11, fontWeight: 600, color: "#0C447C", background: "#E6F1FB", padding: "2px 9px", borderRadius: 999 }}>
                    {stageLabel(it.stage)}
                  </span>
                )}
              </div>
              <button onClick={() => del(it._id)} title="Delete" style={{ border: "none", background: "none", color: "#993c1d", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          </div>
        ))
      )}
      </>
      )}
    </div>
  );
};

export default ProjectWorkspace;
