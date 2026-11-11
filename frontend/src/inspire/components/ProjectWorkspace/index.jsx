import React, { useEffect, useRef, useState } from "react";
import {
  listItemsPage,
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
import { TablePager } from "../PzTable";
import { readRows, saveRows } from "./paging";
import "@pazl/components/ProjectWorkspace/index.css";
import "./pager.css";

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
  // Page by page from the server (Rows per page remembered per tab).
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rowsByTab, setRowsByTab] = useState({});
  const rows = rowsByTab[tab] || readRows(tab);
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

  // One page of this tab, from the server (the step filter applies there too).
  // `target` defaults to the page on screen, so an edit or delete stays put.
  const load = async (target = page) => {
    if (!projectId) return;
    // BOQ, Renders & Videos and the Tracker render their own components (fetch
    // their own data).
    if (tab === "renders" || tab === "boq" || tab === "stage_event") return;
    setLoading(true);
    const res = await listItemsPage(projectId, tab, {
      limit: rows,
      skip: (target - 1) * rows,
      stage: stageFilter || undefined,
    });
    // A page emptied by a delete steps back to the last page that has items.
    if (!res.items.length && res.total > 0 && target > 1) {
      setLoading(false);
      return load(Math.max(1, Math.ceil(res.total / rows)));
    }
    setItems(res.items);
    setTotal(res.total);
    setPage(target);
    setLoading(false);
  };

  // A new tab, step filter or page size starts from page 1.
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tab, stageFilter, rows]);

  const changeRows = (n) => {
    setRowsByTab((m) => ({ ...m, [tab]: n }));
    saveRows(tab, n);
  };

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
      await load(1);
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
    await load(1);
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
    await load(1);
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
    <select className="pz-ws-input pz-ws-stage" value={relStage} onChange={(e) => setRelStage(e.target.value)} title="Link this to a tracker step (optional)">
      <option value="">Related to: (no step)</option>
      {TRACKER_STAGES.map((s) => (
        <option key={s.key} value={s.key}>Related to: {s.label}</option>
      ))}
    </select>
  );

  // The server already applied the step filter and the page.
  const shown = items;

  return (
    <div className="pz-ws pz-ws--inspire">
      <div className="pz-ws-tabs" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`pz-ws-tab${tab === t.key ? " is-on" : ""}`}
            onClick={() => setTab(t.key)}
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
        <TrackerAdmin projectId={projectId} status={status} clientEmail={clientEmail} onAdvance={() => load()} />
      ) : (
      <>
      <div className="pz-ws-form">
        {tab === "document" && (
          <div className="pz-ws-row">
            <select className="pz-ws-input" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="pz-ws-input pz-ws-grow" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="pz-ws-input pz-ws-grow" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} className="pz-ws-file" type="file" accept=".pdf,image/*,audio/*" />
            <button type="button" className="pz-ws-btn" disabled={busy} onClick={addDocument}>{busy ? "Uploading…" : "Upload"}</button>
          </div>
        )}
        {tab === "change" && (
          <div className="pz-ws-row">
            <input className="pz-ws-input pz-ws-grow pz-ws-wide" placeholder="What change did the client ask for?" value={text} onChange={(e) => setText(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} className="pz-ws-file" type="file" accept=".pdf,image/*,audio/*" />
            <button type="button" className="pz-ws-btn" disabled={busy} onClick={() => addWithAttachment("change")}>{busy ? "Saving…" : "Add change"}</button>
          </div>
        )}
        {tab === "task" && (
          <div className="pz-ws-row">
            <input className="pz-ws-input pz-ws-grow pz-ws-wide" placeholder="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="pz-ws-input pz-ws-assignee" placeholder="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            <input className="pz-ws-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {stageSelect()}
            <button type="button" className="pz-ws-btn" disabled={busy} onClick={addTask}>Add task</button>
          </div>
        )}
        {tab === "discussion" && (
          <div className="pz-ws-row">
            <input className="pz-ws-input pz-ws-grow pz-ws-wide" placeholder="Note a discussion / decision…" value={text} onChange={(e) => setText(e.target.value)} />
            {stageSelect()}
            <input ref={fileRef} className="pz-ws-file" type="file" accept=".pdf,image/*,audio/*" />
            <button type="button" className="pz-ws-btn" disabled={busy} onClick={() => addWithAttachment("discussion")}>{busy ? "Saving…" : "Add note"}</button>
          </div>
        )}
      </div>

      <div className="pz-ws-filter">
        <span>Filter by step:</span>
        <select className="pz-ws-input pz-ws-stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All steps</option>
          {TRACKER_STAGES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        {stageFilter && (
          <button type="button" onClick={() => setStageFilter("")} className="pz-ws-btn pz-ws-btn--ghost pz-ws-btn--sm">
            Clear ✕
          </button>
        )}
      </div>

      <div className="pz-ws-list pz-ws-list--free">
      {loading ? (
        <div className="pz-ws-skeleton" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pz-ws-sk" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="pz-ws-empty">
          <span className="pz-ws-empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </span>
          <span>{stageFilter ? `Nothing linked to “${stageLabel(stageFilter)}” here.` : "Nothing here yet."}</span>
        </div>
      ) : (
        shown.map((it) => (
          <div key={it._id} className="pz-ws-item">
            <div className="pz-ws-item-row">
              <div className="pz-ws-item-body">
                {tab === "document" && (
                  <>
                    <div className="pz-ws-item-title">
                      <span className="pz-ws-type">{it.type}</span>
                      <span>{it.title}</span>
                    </div>
                    {it.note ? <div className="pz-ws-note">{it.note}</div> : null}
                    <FilePreview url={it.fileUrl} mime={it.mimeType} />
                  </>
                )}
                {tab === "change" && (
                  <>
                    <div className="pz-ws-text">{it.description}</div>
                    <div className="pz-ws-seg" role="group" aria-label="Status">
                      {["pending", "in_progress", "done"].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStatus(it._id, s)}
                          className={`pz-ws-seg-btn${it.status === s ? " is-on" : ""}`}
                          data-status={s}
                          aria-pressed={it.status === s}
                        >
                          {s.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                    <FilePreview url={it.attachmentUrl} mime={it.mimeType} />
                  </>
                )}
                {tab === "task" && (
                  <label className="pz-ws-task">
                    <input type="checkbox" checked={it.status === "done"} onChange={() => setStatus(it._id, it.status === "done" ? "todo" : "done", { completedAt: it.status === "done" ? "" : new Date().toISOString() })} />
                    <span className={`pz-ws-task-title${it.status === "done" ? " is-done" : ""}`}>{it.title}</span>
                    {it.assignedTo ? <span className="pz-ws-muted">· {it.assignedTo}</span> : null}
                    {it.dueDate ? <span className={`pz-ws-muted${isToday(it.dueDate) ? " pz-ws-due-today" : ""}`}>· due {it.dueDate}{isToday(it.dueDate) ? " (today)" : ""}</span> : null}
                  </label>
                )}
                {tab === "discussion" && (
                  <>
                    <div className="pz-ws-text">{it.text}</div>
                    <div className="pz-ws-muted">{it.author} · {fmtDate(it.createdAt)}</div>
                    <FilePreview url={it.attachmentUrl} mime={it.mimeType} />
                  </>
                )}
                {tab !== "discussion" && (
                  <div className="pz-ws-muted pz-ws-meta">{it.createdBy ? `${it.createdBy} · ` : ""}{fmtDate(it.createdAt)}</div>
                )}
                {it.stage && stageLabel(it.stage) && (
                  <span className="pz-ws-chip">{stageLabel(it.stage)}</span>
                )}
              </div>
              <div className="pz-ws-item-actions">
                <button type="button" onClick={() => del(it._id)} className="pz-ws-icon pz-ws-icon--danger" data-tip="Delete" aria-label="Delete">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      {total > 0 ? (
        <TablePager
          rowsPerPage={rows}
          rowCount={total}
          currentPage={page}
          onChangePage={(p) => load(p)}
          onChangeRowsPerPage={changeRows}
        />
      ) : null}
      </>
      )}
    </div>
  );
};

export default ProjectWorkspace;
