import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "react-bootstrap";
import { Icon } from "../../components/PzTable";
import {
  createEmailTemplate,
  deleteEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  previewEmailTemplate,
  resetEmailTemplate,
  testEmailTemplate,
  updateEmailTemplate,
} from "../../services/emailTemplatesService";
import "./EmailTemplates.css";

/**
 * Settings → Email Templates. The words of every email Pazl sends.
 *
 *   ?tab=templates                      the list
 *   ?tab=templates&tpl=<key>&mode=view  one template, read-only
 *   ?tab=templates&tpl=<key>&mode=edit  edit it
 *   ?tab=templates&tpl=new              create a custom template
 *
 * Built-in templates (the 14 emails the app sends by itself) can be edited,
 * switched off or reset to their original text, but not deleted. Custom
 * templates are the admins' own, picked in the email composers.
 *
 * The preview is the real email, rendered by the server with sample data, in a
 * sandboxed frame (no scripts can run in it).
 */

const RECIPIENT_TONE = { client: "client", admin: "admin", team: "team", architect: "arch", any: "any" };
const KEY_RE = /^[a-z][a-z0-9_]{2,49}$/;
const VAR_RE = /\{([a-z_]+)\}/g;
const PER_PAGE = [10, 25, 50];

const textOf = (html) => {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent || "").trim();
};

// ───────────────────────────── URL state ─────────────────────────────

const readRoute = () => {
  const p = new URLSearchParams(window.location.search);
  return { tpl: p.get("tpl") || "", mode: p.get("mode") === "edit" ? "edit" : p.get("tpl") === "new" ? "edit" : "view" };
};
const writeRoute = (tpl, mode) => {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "templates");
  if (tpl) url.searchParams.set("tpl", tpl);
  else url.searchParams.delete("tpl");
  if (tpl && tpl !== "new" && mode) url.searchParams.set("mode", mode);
  else url.searchParams.delete("mode");
  window.history.pushState(null, "", url);
};

// ───────────────────────────── small pieces ─────────────────────────────

const Confirm = ({ show, title, body, confirmLabel, danger, busy, onConfirm, onCancel }) => (
  <Modal show={show} onHide={onCancel} centered className="pzt-modal">
    <Modal.Body>
      <h2 className="pzt-modal-title">{title}</h2>
      <p className="pzt-modal-text">{body}</p>
      <div className="pzt-modal-actions">
        <button type="button" className="pzs-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`pzs-btn ${danger ? "pzt-btn-danger" : "pzs-btn--primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal.Body>
  </Modal>
);

const RecipientPill = ({ value, recipients }) => (
  <span className={`pzt-pill is-${RECIPIENT_TONE[value] || "any"}`}>{recipients?.[value] || value}</span>
);

const ToolIcon = ({ d, children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
);

// ───────────────────────────── rich-text editor ─────────────────────────────

const TOOLS = [
  { cmd: "bold", label: "Bold", icon: <ToolIcon d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" /> },
  { cmd: "italic", label: "Italic", icon: <ToolIcon d="M14 5h-4M14 19h-4M14.5 5 9.5 19" /> },
  { cmd: "underline", label: "Underline", icon: <ToolIcon d="M7 5v6a5 5 0 0 0 10 0V5M5 20h14" /> },
  { cmd: "strikeThrough", label: "Strikethrough", icon: <ToolIcon d="M5 12h14M16 7a4 3 0 0 0-8 0c0 4 8 2 8 6a4 3 0 0 1-8 0" /> },
  "|",
  { cmd: "formatBlock", arg: "H2", label: "Heading", text: "H2" },
  { cmd: "formatBlock", arg: "H3", label: "Small heading", text: "H3" },
  { cmd: "formatBlock", arg: "P", label: "Paragraph", text: "¶" },
  "|",
  { cmd: "insertUnorderedList", label: "Bulleted list", icon: <ToolIcon d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /> },
  { cmd: "insertOrderedList", label: "Numbered list", icon: <ToolIcon d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 15h2l-2 3h2" /> },
  { cmd: "justifyLeft", label: "Align left", icon: <ToolIcon d="M4 6h16M4 10h10M4 14h16M4 18h10" /> },
  { cmd: "justifyCenter", label: "Align centre", icon: <ToolIcon d="M4 6h16M7 10h10M4 14h16M7 18h10" /> },
  { cmd: "justifyRight", label: "Align right", icon: <ToolIcon d="M4 6h16M10 10h10M4 14h16M10 18h10" /> },
  "|",
  { cmd: "createLink", label: "Add link", icon: <ToolIcon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /> },
  { cmd: "unlink", label: "Remove link", icon: <ToolIcon d="M10 14a4 4 0 0 0 5.7 0l1.3-1.3M14 10a4 4 0 0 0-5.7 0L7 11.3M4 4l16 16" /> },
  { cmd: "removeFormat", label: "Clear formatting", icon: <ToolIcon d="M6 5h12M12 5l-3 14M15 15l5 5M20 15l-5 5" /> },
  "|",
  { cmd: "undo", label: "Undo", icon: <ToolIcon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /> },
  { cmd: "redo", label: "Redo", icon: <ToolIcon d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /> },
];

/**
 * A small editor on the browser's own editing (contentEditable). Formatting
 * stays simple on purpose: email clients only show plain HTML well. Paste
 * arrives as plain text, so Word / web formatting can't sneak in.
 */
const RichEditor = React.forwardRef(({ value, onChange, disabled, invalid, onFocus }, ref) => {
  const [source, setSource] = useState(false);
  const box = useRef(null);
  const area = useRef(null);
  const shown = useRef(null); // the HTML the editable box currently holds
  const range = useRef(null);

  useEffect(() => {
    if (!source && box.current && value !== shown.current) {
      box.current.innerHTML = value || "";
      shown.current = value || "";
    }
  }, [value, source]);

  const emit = () => {
    const html = box.current.innerHTML;
    shown.current = html;
    onChange(html);
  };
  const keepRange = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  // Remember the cursor on every move (typing, clicks, arrow keys), so a
  // variable chip inserts exactly where it was.
  useEffect(() => {
    document.addEventListener("selectionchange", keepRange);
    return () => document.removeEventListener("selectionchange", keepRange);
  }, []);
  const restoreRange = () => {
    box.current.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const run = (tool) => {
    if (disabled) return;
    restoreRange();
    if (tool.cmd === "createLink") {
      const url = window.prompt("Link address (https://… or {link})", "https://");
      if (!url) return;
      document.execCommand("createLink", false, url.trim());
    } else {
      document.execCommand(tool.cmd, false, tool.arg);
    }
    keepRange();
    emit();
  };

  React.useImperativeHandle(ref, () => ({
    insert(text) {
      if (disabled) return;
      if (source) {
        const el = area.current;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const next = el.value.slice(0, start) + text + el.value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + text.length, start + text.length);
        });
        return;
      }
      restoreRange();
      document.execCommand("insertText", false, text);
      keepRange();
      emit();
    },
  }));

  return (
    <div className={`pzt-editor${invalid ? " is-invalid" : ""}${disabled ? " is-disabled" : ""}`}>
      <div className="pzt-editor-modes" role="tablist" aria-label="Editor mode">
        <button type="button" role="tab" aria-selected={!source} className={!source ? "is-on" : ""} onClick={() => setSource(false)}>
          Visual
        </button>
        <button type="button" role="tab" aria-selected={source} className={source ? "is-on" : ""} onClick={() => setSource(true)}>
          Source HTML
        </button>
      </div>
      <div className="pzt-editor-frame">
        {!source ? (
          <div className="pzt-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLS.map((t, i) =>
              t === "|" ? (
                <span key={i} className="pzt-tool-sep" aria-hidden="true" />
              ) : (
                <button
                  key={t.label}
                  type="button"
                  className="pzt-tool"
                  title={t.label}
                  aria-label={t.label}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(t)}
                >
                  {t.icon || <span className="pzt-tool-text">{t.text}</span>}
                </button>
              )
            )}
          </div>
        ) : null}
        {source ? (
          <textarea
            ref={area}
            className="pzt-source"
            value={value || ""}
            spellCheck={false}
            disabled={disabled}
            onFocus={onFocus}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Email text (HTML)"
          />
        ) : (
          <div
            ref={box}
            className="pzt-editable"
            contentEditable={!disabled}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Email text"
            onInput={emit}
            onFocus={onFocus}
            onKeyUp={keepRange}
            onMouseUp={keepRange}
            onBlur={keepRange}
            onPaste={(e) => {
              e.preventDefault();
              document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              emit();
            }}
          />
        )}
      </div>
    </div>
  );
});

// ───────────────────────────── the list ─────────────────────────────

const TemplateList = ({ data, notice, onOpen, onNew, onDeleted }) => {
  const [query, setQuery] = useState("");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data?.templates || [];
    if (!q) return all;
    return all.filter((t) =>
      [t.key, t.name, t.subject, data?.recipients?.[t.recipient]].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [data, query]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * perPage, current * perPage);

  const confirmDelete = async () => {
    setDeleting(true);
    setError("");
    const res = await deleteEmailTemplate(toDelete.key);
    setDeleting(false);
    if (res.error) {
      setError(res.message);
      return;
    }
    const name = toDelete.name;
    setToDelete(null);
    onDeleted(`“${name}” was deleted.`);
  };

  return (
    // pzt-page--list: the page fits the window and only the rows scroll
    // (EmailTemplates.css).
    <div className="pzt-page pzt-page--list">
      <div className="pzt-head">
        <div>
          <h1 className="pzt-title">Email Templates</h1>
          <p className="pzt-sub">The subject and text of every email Pazl sends. Changes apply to the next email.</p>
        </div>
        <div className="pzt-tools">
          <label className="pzt-search">
            <Icon size={16}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </Icon>
            <input
              type="search"
              value={query}
              placeholder="Search"
              aria-label="Search templates"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="pzt-perpage">
            <span>Per page</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {PER_PAGE.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="pzs-btn pzs-btn--primary" onClick={onNew}>
            <Icon size={16}>
              <path d="M12 5v14M5 12h14" />
            </Icon>
            New template
          </button>
        </div>
      </div>

      {notice ? <p className="pzt-notice">{notice}</p> : null}

      <div className="pzt-card">
        <div className="pzt-table-wrap">
          <table className="pzt-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Subject</th>
                <th>Recipient</th>
                <th className="is-center">Active</th>
                <th className="is-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((t) => (
                  <tr key={t.key}>
                    <td className="pzt-key">{t.key}</td>
                    <td>
                      <span className="pzt-name">{t.name}</span>
                      {!t.builtIn ? <span className="pzt-tag">Custom</span> : t.edited ? <span className="pzt-tag is-edited">Edited</span> : null}
                    </td>
                    <td className="pzt-subject" title={t.subject}>
                      {t.subject}
                    </td>
                    <td>
                      <RecipientPill value={t.recipient} recipients={data?.recipients} />
                    </td>
                    <td className="is-center">
                      {t.active ? (
                        <span className="pzt-on" title="Sent">
                          <Icon size={18}>
                            <circle cx="12" cy="12" r="9" />
                            <path d="m8.5 12 2.5 2.5 4.5-5" />
                          </Icon>
                        </span>
                      ) : (
                        <span className="pzt-off" title="Switched off — not sent">
                          Off
                        </span>
                      )}
                    </td>
                    <td className="is-right">
                      <div className="pzt-actions">
                        <button type="button" className="pzt-act" title="View" aria-label={`View ${t.name}`} onClick={() => onOpen(t.key, "view")}>
                          <Icon size={16}>
                            <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </Icon>
                        </button>
                        <button type="button" className="pzt-act" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => onOpen(t.key, "edit")}>
                          <Icon size={16}>
                            <path d="M4 20h4L19 9l-4-4L4 16z" />
                            <path d="m13.5 6.5 4 4" />
                          </Icon>
                        </button>
                        <button
                          type="button"
                          className="pzt-act is-danger"
                          title={t.builtIn ? "Built-in templates can’t be deleted" : "Delete"}
                          aria-label={`Delete ${t.name}`}
                          disabled={t.builtIn}
                          onClick={() => setToDelete(t)}
                        >
                          <Icon size={16}>
                            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                          </Icon>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="pzt-empty">
                    Nothing matches “{query.trim()}”.{" "}
                    <button type="button" className="pzt-link" onClick={() => setQuery("")}>
                      Clear search
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pzt-foot">
        <span>
          {rows.length
            ? `Showing ${(current - 1) * perPage + 1} to ${Math.min(current * perPage, rows.length)} of ${rows.length} entries`
            : "No entries"}
        </span>
        {pages > 1 ? (
          <div className="pzt-pager" aria-label="Pages">
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className={n === current ? "is-on" : ""} aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)}>
                {n}
              </button>
            ))}
            <button type="button" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}>
              ›
            </button>
          </div>
        ) : null}
      </div>

      <Confirm
        show={!!toDelete}
        title={`Delete “${toDelete?.name || ""}”?`}
        body={error || "This can’t be undone. Emails already sent are not affected."}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          setToDelete(null);
          setError("");
        }}
      />
    </div>
  );
};

// ───────────────────────────── the edit / view page ─────────────────────────────

const EMPTY = { key: "", name: "", recipient: "client", subject: "", heading: "", body: "", buttonText: "", active: true };

const validate = (f, { isNew, builtIn, allowed, keys }) => {
  const e = {};
  if (isNew) {
    if (!f.key) e.key = "Enter a key, such as site_visit_reminder.";
    else if (!KEY_RE.test(f.key)) e.key = "Use 3–50 lowercase letters, numbers or _, starting with a letter.";
    else if (keys.includes(f.key)) e.key = "A template with this key already exists.";
  }
  if (!f.name.trim()) e.name = "Enter a name.";
  else if (f.name.length > 80) e.name = "Keep the name under 80 characters.";
  if (!f.subject.trim()) e.subject = "Enter a subject.";
  else if (f.subject.length > 200) e.subject = "Keep the subject under 200 characters.";
  if (f.heading.length > 120) e.heading = "Keep the heading under 120 characters.";
  if (!textOf(f.body)) e.body = "Write the email text.";
  if (builtIn && !f.buttonText.trim()) e.buttonText = "Enter the button text.";
  else if (f.buttonText.length > 40) e.buttonText = "Keep the button text under 40 characters.";
  for (const field of ["subject", "heading", "body", "buttonText"]) {
    if (e[field]) continue;
    const bad = [...new Set([...String(f[field] || "").matchAll(VAR_RE)].map((m) => m[1]).filter((v) => !allowed.includes(v)))];
    if (bad.length) e[field] = `This template can’t fill ${bad.map((v) => `{${v}}`).join(", ")}. Use a variable from the list.`;
  }
  return e;
};

const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};

const TemplateEditor = ({ tplKey, mode, list, onBack, onMode, onSaved }) => {
  const isNew = tplKey === "new";
  const readOnly = mode === "view" && !isNew;
  const [tpl, setTpl] = useState(null); // as saved
  const [form, setForm] = useState(EMPTY);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null); // save | test | reset
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ask, setAsk] = useState(null); // reset | discard
  const editor = useRef(null);
  const inputs = { subject: useRef(null), heading: useRef(null), buttonText: useRef(null) };
  const lastField = useRef("body");

  useEffect(() => {
    let live = true;
    setLoadError("");
    setErrors({});
    setNotice(null);
    if (isNew) {
      setTpl(null);
      setForm(EMPTY);
      return undefined;
    }
    getEmailTemplate(tplKey).then((res) => {
      if (!live) return;
      if (res.error) {
        setLoadError(res.message);
        return;
      }
      setTpl(res.data);
      setForm({
        key: res.data.key,
        name: res.data.name,
        recipient: res.data.recipient,
        subject: res.data.subject,
        heading: res.data.heading || "",
        body: res.data.body || "",
        buttonText: res.data.buttonText || "",
        active: res.data.active,
      });
    });
    return () => {
      live = false;
    };
  }, [tplKey, isNew]);

  const builtIn = !!tpl?.builtIn;
  const allowed = useMemo(
    () => [...new Set(tpl?.vars?.length ? tpl.vars : [...(list?.customVariables || []), "app_name"])],
    [tpl, list]
  );
  const varInfo = useMemo(() => Object.fromEntries((list?.variables || []).map((v) => [v.name, v])), [list]);

  const dirty = useMemo(() => {
    if (isNew) return Object.entries(form).some(([k, v]) => k !== "recipient" && k !== "active" && String(v).trim());
    if (!tpl) return false;
    return ["name", "recipient", "subject", "heading", "body", "buttonText", "active"].some(
      (k) => String(form[k] ?? "") !== String((k === "heading" || k === "buttonText" ? tpl[k] || "" : tpl[k]) ?? "")
    );
  }, [form, tpl, isNew]);

  // Live preview, rendered by the server (the real email frame), debounced.
  useEffect(() => {
    if (!isNew && !tpl) return undefined;
    const t = setTimeout(async () => {
      const res = await previewEmailTemplate({ ...form, key: isNew ? form.key || "new" : tplKey });
      if (!res.error) setPreview(res.data);
    }, 350);
    return () => clearTimeout(t);
  }, [form, tpl, isNew, tplKey]);

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
    setNotice(null);
  };

  const insertVar = (name) => {
    if (readOnly) return;
    const text = `{${name}}`;
    const field = lastField.current;
    if (field === "body") {
      editor.current?.insert(text);
      return;
    }
    const el = inputs[field]?.current;
    const value = form[field] || "";
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    set(field, value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const check = () => {
    const e = validate(form, { isNew, builtIn, allowed, keys: (list?.templates || []).map((t) => t.key) });
    setErrors(e);
    if (Object.keys(e).length) {
      setNotice({ tone: "bad", text: "Fix the highlighted fields first." });
      return false;
    }
    return true;
  };

  const save = async () => {
    if (busy) return;
    if (!isNew && !dirty) {
      setNotice({ tone: "ok", text: "No changes to save." });
      return;
    }
    if (!check()) return;
    setBusy("save");
    const res = isNew ? await createEmailTemplate(form) : await updateEmailTemplate(tplKey, form);
    setBusy(null);
    if (res.error) {
      setErrors(res.fields || {});
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    onSaved(res.data, isNew ? `“${res.data.name}” was created.` : "Template saved. The next email uses it.");
  };

  const sendTest = async () => {
    if (busy || !check()) return;
    setBusy("test");
    setNotice(null);
    const res = await testEmailTemplate({ ...form, key: isNew ? form.key || "new" : tplKey });
    setBusy(null);
    if (res.error) {
      setErrors(res.fields || {});
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    setNotice({ tone: res.data.ok ? "ok" : "bad", text: res.data.message });
  };

  const doReset = async () => {
    setBusy("reset");
    const res = await resetEmailTemplate(tplKey);
    setBusy(null);
    setAsk(null);
    if (res.error) {
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    onSaved(res.data, "Template reset to the original text.", true);
    setTpl(res.data);
    setForm({
      key: res.data.key,
      name: res.data.name,
      recipient: res.data.recipient,
      subject: res.data.subject,
      heading: res.data.heading || "",
      body: res.data.body || "",
      buttonText: res.data.buttonText || "",
      active: res.data.active,
    });
  };

  const leave = () => {
    if (!readOnly && dirty) setAsk("discard");
    else onBack();
  };

  if (loadError) {
    return (
      <div className="pzs-card pzs-loading">
        <p className="pzs-err">{loadError}</p>
        <button type="button" className="pzs-btn" onClick={onBack}>
          Back to templates
        </button>
      </div>
    );
  }
  if (!isNew && !tpl) return <div className="pzs-card pzs-loading">Loading template…</div>;

  const field = (name, label, props = {}) => (
    <div className={`pzs-field${props.wide ? " is-wide" : ""}`}>
      <label htmlFor={`pzt-${name}`}>
        {label}
        {props.required ? <span className="pzt-req"> *</span> : null}
      </label>
      <input
        id={`pzt-${name}`}
        ref={inputs[name]}
        type="text"
        className={errors[name] ? "is-invalid" : ""}
        value={form[name] ?? ""}
        placeholder={props.placeholder}
        disabled={readOnly || props.disabled}
        spellCheck={name !== "key"}
        onFocus={() => {
          if (inputs[name]) lastField.current = name;
        }}
        onChange={(e) => set(name, name === "key" ? e.target.value.toLowerCase().replace(/\s+/g, "_") : e.target.value)}
      />
      {errors[name] ? <p className="pzs-err">{errors[name]}</p> : props.hint ? <p className="pzs-hint">{props.hint}</p> : null}
    </div>
  );

  const title = isNew ? "New email template" : readOnly ? "View email template" : "Edit email template";

  return (
    <div className="pzt-page">
      <div className="pzt-head">
        <div>
          <nav className="pzt-crumbs" aria-label="Breadcrumb">
            <span>Settings</span>
            <span aria-hidden="true">›</span>
            <button type="button" className="pzt-link" onClick={leave}>
              Email Templates
            </button>
            <span aria-hidden="true">›</span>
            <span>{isNew ? "New" : readOnly ? "View" : "Edit"}</span>
          </nav>
          <h1 className="pzt-title">{title}</h1>
        </div>
      </div>

      <section className="pzs-card">
        <header className="pzs-card-head">
          <div>
            <h2>Template</h2>
            <p>{builtIn ? "Built-in — sent by the app itself." : "Custom — picked in Send email and Send to client."}</p>
          </div>
          {!isNew ? (
            <span className={`pzs-badge ${form.active ? "is-ok" : "is-off"}`}>{form.active ? "Active" : "Switched off"}</span>
          ) : null}
        </header>
        <div className="pzs-grid">
          {field("key", "Key", {
            required: isNew,
            disabled: !isNew,
            placeholder: "site_visit_reminder",
            hint: isNew ? "Lowercase letters, numbers and _. Can’t be changed later." : "System identifier — read-only.",
          })}
          {field("name", "Name", { required: true, placeholder: "Site visit reminder" })}
          <div className="pzs-field">
            <label htmlFor="pzt-recipient">Recipient</label>
            <select
              id="pzt-recipient"
              className={errors.recipient ? "is-invalid" : ""}
              value={form.recipient}
              disabled={readOnly || builtIn}
              onChange={(e) => set("recipient", e.target.value)}
            >
              {Object.entries(list?.recipients || {}).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {errors.recipient ? (
              <p className="pzs-err">{errors.recipient}</p>
            ) : (
              <p className="pzs-hint">{builtIn ? "Set by the app for this email." : "Who this email is written for."}</p>
            )}
          </div>
          <div className="pzs-field pzs-field--switch">
            <label className="pzs-switch" htmlFor="pzt-active">
              <input
                id="pzt-active"
                type="checkbox"
                role="switch"
                checked={!!form.active}
                disabled={readOnly || tpl?.lockActive}
                onChange={(e) => set("active", e.target.checked)}
              />
              <span className="pzs-switch-track" aria-hidden="true" />
              <span>Active</span>
            </label>
            <p className="pzs-hint">
              {tpl?.lockActive
                ? "Always on — someone presses a button to send this, or it’s a sign-in link."
                : form.active
                ? "This email is sent."
                : "Switched off — this email is not sent."}
            </p>
          </div>
        </div>
      </section>

      <section className="pzs-card">
        <header className="pzs-card-head">
          <div>
            <h2>Content</h2>
            <p>Variables are filled in when the email is sent.</p>
          </div>
        </header>
        <div className="pzt-content">
          <div className="pzt-grid1">
            {field("subject", "Subject", { required: true, wide: true, placeholder: "Site visit for {project_name}" })}
            {field("heading", "Heading", { wide: true, placeholder: "The large line at the top of the email (optional)" })}
          </div>

          <div className="pzt-vars">
            <p className="pzt-label">
              Available variables <span>— click to insert where your cursor is</span>
            </p>
            <div className="pzt-chips">
              {allowed.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="pzt-chip"
                  title={varInfo[v] ? `${varInfo[v].label} — e.g. ${varInfo[v].sample}` : v}
                  disabled={readOnly}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVar(v)}
                >
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="pzt-split">
            <div className="pzt-col">
              <p className="pzt-label">
                Email text<span className="pzt-req"> *</span>
              </p>
              <RichEditor
                ref={editor}
                value={form.body}
                disabled={readOnly}
                invalid={!!errors.body}
                onFocus={() => {
                  lastField.current = "body";
                }}
                onChange={(v) => set("body", v)}
              />
              {errors.body ? <p className="pzs-err">{errors.body}</p> : null}
              <div className="pzt-grid1">
                {field("buttonText", "Button text", {
                  required: builtIn,
                  placeholder: "View your project",
                  hint: "The button under the text. It opens the project (or the sign-in link).",
                })}
              </div>
            </div>
            <div className="pzt-col">
              <p className="pzt-label">Live preview <span>— sample data</span></p>
              <div className="pzt-preview">
                <p className="pzt-preview-subject">
                  <b>Subject:</b> {preview?.subject || "…"}
                </p>
                {preview ? (
                  <iframe title="Email preview" className="pzt-preview-frame" sandbox="" srcDoc={preview.html} />
                ) : (
                  <div className="pzt-preview-frame pzt-preview-wait">Preparing preview…</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="pzs-bar">
        <div className="pzs-bar-msg" role="status" aria-live="polite">
          {notice ? (
            <span className={`pzs-notice is-${notice.tone}`}>{notice.text}</span>
          ) : tpl?.updatedAt ? (
            <span className="pzs-meta">
              Last saved {fmtWhen(tpl.updatedAt)}
              {tpl.updatedBy ? ` by ${tpl.updatedBy}` : ""}
            </span>
          ) : builtIn ? (
            <span className="pzs-meta">Original text — not edited yet.</span>
          ) : null}
          {builtIn && tpl?.edited && !readOnly ? (
            <button type="button" className="pzt-link pzt-reset" onClick={() => setAsk("reset")} disabled={!!busy}>
              Reset to original text
            </button>
          ) : null}
        </div>
        <div className="pzs-bar-actions">
          <button type="button" className="pzs-btn" onClick={leave} disabled={!!busy}>
            {readOnly ? "Back" : "Cancel"}
          </button>
          {readOnly ? (
            <button type="button" className="pzs-btn pzs-btn--primary" onClick={() => onMode("edit")}>
              Edit
            </button>
          ) : (
            <>
              <button type="button" className="pzs-btn" onClick={sendTest} disabled={!!busy} title="Sends this email, with sample data, to your own address">
                {busy === "test" ? "Sending…" : "Send test"}
              </button>
              <button type="button" className="pzs-btn pzs-btn--primary" onClick={save} disabled={!!busy}>
                {busy === "save" ? "Saving…" : isNew ? "Create template" : "Save changes"}
              </button>
            </>
          )}
        </div>
      </div>

      <Confirm
        show={ask === "reset"}
        title="Reset to the original text?"
        body="The subject, heading, text and button go back to how Pazl first wrote them. Your edits are lost."
        confirmLabel="Reset"
        danger
        busy={busy === "reset"}
        onConfirm={doReset}
        onCancel={() => setAsk(null)}
      />
      <Confirm
        show={ask === "discard"}
        title="Discard your changes?"
        body="You have changes that are not saved."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setAsk(null);
          onBack();
        }}
        onCancel={() => setAsk(null)}
      />
    </div>
  );
};

// ───────────────────────────── the section ─────────────────────────────

const EmailTemplates = () => {
  const [route, setRoute] = useState(readRoute);
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await listEmailTemplates();
    if (res.error) {
      setError(res.message);
      return;
    }
    setList(res.data);
  }, []);

  useEffect(() => {
    load();
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  const go = (tpl, mode) => {
    writeRoute(tpl, mode);
    setRoute({ tpl: tpl || "", mode: mode || "view" });
    setNotice("");
  };

  if (error && !list) {
    return (
      <div className="pzs-card pzs-loading">
        <p className="pzs-err">{error}</p>
        <button type="button" className="pzs-btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!list) return <div className="pzs-card pzs-loading">Loading templates…</div>;

  if (route.tpl) {
    return (
      <TemplateEditor
        key={`${route.tpl}`}
        tplKey={route.tpl}
        mode={route.mode}
        list={list}
        onBack={() => go("")}
        onMode={(m) => go(route.tpl, m)}
        onSaved={async (saved, message, stay) => {
          await load();
          if (stay) return;
          go("");
          setNotice(message);
        }}
      />
    );
  }

  return (
    <TemplateList
      data={list}
      notice={notice}
      onOpen={(key, mode) => go(key, mode)}
      onNew={() => go("new")}
      onDeleted={async (message) => {
        await load();
        setNotice(message);
      }}
    />
  );
};

export default EmailTemplates;
