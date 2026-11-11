import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Container } from "react-bootstrap";
import { getCurrentUser } from "../../services/authService";
import { USER_ROLES } from "../../utils/constants";
import NavRail from "@pazl/components/NavRail";
import AppHeader from "../../components/AppHeader";
import { Icon } from "../../components/PzTable";
import {
  getAppSettings,
  saveAppSettings,
  testAppSettings,
} from "../../services/appSettingsService";
import EmailTemplates from "./EmailTemplates";
import TaxInvoice from "./TaxInvoice";
import Branding from "./Branding";
import "./Settings.css";

/**
 * Settings — the outside services' keys, set from the website instead of the
 * server's .env file. Admin only (the backend checks too).
 *
 *   Email    SMTP server + sender
 *   Tripo    photo -> 3D model
 *   Claude   floor plan AI, Claude + Blender
 *   Render   MyArchitectAI (the Render Studio)
 *
 * A saved key never comes back to the browser: the page shows its last 4
 * characters, and an empty key field on save keeps it. Every "Test" is free —
 * it checks the key or sends one email, never a paid job.
 */

const SECTIONS = [
  {
    // A page of its own (Branding.jsx): the app logo and name, everywhere.
    key: "branding",
    page: "branding",
    group: "General",
    label: "Branding",
    tone: "amber",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-4.5-4.5L7 20" />
      </>
    ),
  },
  {
    // A page of its own (TaxInvoice.jsx): what the BOQ prints.
    key: "invoice",
    page: "invoice",
    group: "General",
    label: "Tax / Invoice",
    tone: "blue",
    icon: (
      <>
        <path d="M6 2.5h12v19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
        <path d="M9.5 8h5M9.5 12h5M9.5 16h3" />
      </>
    ),
  },
  {
    key: "email",
    group: "Messaging",
    label: "Email",
    tone: "blue",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    testLabel: "Send test email",
    testHint: "Sends one email to your own address.",
    cards: [
      {
        title: "SMTP server",
        fields: [
          { name: "enabled", label: "Enable SMTP", type: "switch", wide: true },
          { name: "host", label: "Host", placeholder: "smtp.zeptomail.in", needsEnabled: true },
          { name: "port", label: "Port", placeholder: "587", inputMode: "numeric", needsEnabled: true },
          {
            name: "encryption",
            label: "Encryption",
            type: "select",
            options: [
              ["tls", "TLS (port 587)"],
              ["ssl", "SSL (port 465)"],
              ["none", "None"],
            ],
            needsEnabled: true,
          },
          { name: "username", label: "Username", placeholder: "noreply@pazl.info", needsEnabled: true },
          { name: "password", label: "Password", type: "secret", wide: true, needsEnabled: true },
        ],
      },
      {
        title: "Sender",
        fields: [
          { name: "fromName", label: "From name", placeholder: "PAZL Interiors", needsEnabled: true },
          { name: "fromAddress", label: "From address", placeholder: "noreply@pazl.info", needsEnabled: true },
        ],
      },
    ],
  },
  {
    // A page of its own (EmailTemplates.jsx), not a SectionForm.
    key: "templates",
    page: "templates",
    group: "Messaging",
    label: "Email Templates",
    tone: "red",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 13h8M8 16h5" />
      </>
    ),
  },
  {
    key: "tripo",
    group: "AI services",
    label: "Tripo 3D",
    tone: "orange",
    icon: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7z" />
        <path d="m12 12 9-5M12 12v10M12 12 3 7" />
      </>
    ),
    testLabel: "Test connection",
    testHint: "Free. Shows the credits left.",
    cards: [
      {
        title: "Tripo 3D",
        subtitle: "Turns a product photo into a 3D model.",
        fields: [
          { name: "apiKey", label: "API key", type: "secret", wide: true, placeholder: "tsk_…" },
          { name: "modelVersion", label: "Model version", placeholder: "v2.5-20250123" },
          { name: "timeoutSec", label: "Timeout (seconds)", placeholder: "600", inputMode: "numeric" },
        ],
      },
    ],
  },
  {
    key: "claude",
    group: "AI services",
    label: "Claude",
    tone: "violet",
    icon: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <path d="m6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
      </>
    ),
    testLabel: "Test connection",
    testHint: "Free. Checks the key, not the account’s credit.",
    cards: [
      {
        title: "Claude",
        subtitle: "Reads floor plans and builds models in Claude + Blender.",
        fields: [
          { name: "apiKey", label: "API key", type: "secret", wide: true, placeholder: "sk-ant-…" },
          { name: "model", label: "Model", type: "select", options: "claudeModels" },
          { name: "enabled", label: "Claude + Blender photo to 3D", type: "switch" },
        ],
      },
    ],
  },
  {
    key: "render",
    group: "AI services",
    label: "Render",
    tone: "teal",
    icon: (
      <>
        <path d="M4 8h3l1.6-2.2h6.8L17 8h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8z" />
        <circle cx="12" cy="13" r="3.3" />
      </>
    ),
    testLabel: "Test connection",
    testHint: "Free. Shows the balance left.",
    cards: [
      {
        title: "Render (MyArchitectAI)",
        subtitle: "Photoreal renders, relight, style, edit, upscale and animate.",
        fields: [
          { name: "apiKey", label: "API key", type: "secret", wide: true },
          {
            name: "format",
            label: "Output format",
            type: "select",
            options: [
              ["jpg", "JPG"],
              ["png", "PNG"],
              ["webp", "WebP"],
              ["avif", "AVIF"],
            ],
          },
        ],
      },
    ],
  },
];

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const ENCRYPTIONS = ["tls", "ssl", "none"];
const TLS_PORTS = [587, 25, 2525];
// Hosts that only take the full email address as the SMTP username.
const EMAIL_HOSTS = {
  "smtp.gmail.com": "Gmail",
  "smtp.googlemail.com": "Gmail",
  "smtp.office365.com": "Outlook",
  "smtp-mail.outlook.com": "Outlook",
  "smtp.outlook.com": "Outlook",
};

// The same checks the server makes, so most mistakes show before a round trip.
const validate = (section, v, secrets) => {
  const e = {};
  const has = (f) => !!String(v[f] || "").trim() || !!secrets?.[f]?.set;
  if (section === "email") {
    if (!v.enabled) return e;
    if (!String(v.host || "").trim()) e.host = "Enter the SMTP host.";
    const port = Number(v.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = "Enter a port between 1 and 65535.";
    const host = String(v.host || "").trim().toLowerCase();
    if (!ENCRYPTIONS.includes(v.encryption)) e.encryption = "Choose TLS, SSL or None.";
    else if (!e.port) {
      if (v.encryption === "tls" && !TLS_PORTS.includes(port)) e.encryption = "TLS uses port 587. Change the port or the encryption.";
      if (v.encryption === "ssl" && port !== 465) e.encryption = "SSL uses port 465. Change the port or the encryption.";
      if (v.encryption === "none" && port === 465) e.encryption = "Port 465 needs SSL.";
    }
    // Not always an email (ZeptoMail: emailapikey, SendGrid: apikey), but
    // anything with an @ must be a whole one, and Gmail / Outlook need one.
    const user = String(v.username || "").trim();
    if (!user) e.username = "Enter the SMTP username.";
    else if (/\s/.test(user)) e.username = "The username cannot contain spaces.";
    else if (user.includes("@") && !EMAIL_RE.test(user)) e.username = "Enter a valid email address.";
    else if (EMAIL_HOSTS[host] && !EMAIL_RE.test(user)) e.username = `${EMAIL_HOSTS[host]} needs the full email address as the username.`;
    const typedPass = String(v.password || "");
    if (!has("password")) e.password = "Enter the SMTP password.";
    else if (typedPass && typedPass.trim().length < 6) e.password = "The password is too short.";
    const from = String(v.fromAddress || "").trim();
    if (!from && !String(v.username || "").trim()) e.fromAddress = "Enter the address emails are sent from.";
    else if (from && !EMAIL_RE.test(from)) e.fromAddress = "Enter a valid email address.";
    if (/["<>]/.test(v.fromName || "")) e.fromName = "The name cannot contain \" < or >.";
  }
  if (section === "tripo") {
    const k = String(v.apiKey || "").trim();
    if (!has("apiKey")) e.apiKey = "Enter the Tripo API key.";
    else if (k && !/^tsk_\S{10,}$/.test(k)) e.apiKey = "A Tripo API key starts with tsk_.";
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(String(v.modelVersion || ""))) e.modelVersion = "Enter a model version such as v2.5-20250123.";
    const t = Number(v.timeoutSec);
    if (!Number.isInteger(t) || t < 60 || t > 3600) e.timeoutSec = "Enter a timeout between 60 and 3600 seconds.";
  }
  if (section === "claude") {
    const k = String(v.apiKey || "").trim();
    if (!has("apiKey")) e.apiKey = "Enter the Claude API key.";
    else if (k && !/^sk-ant-\S{10,}$/.test(k)) e.apiKey = "A Claude API key starts with sk-ant-.";
  }
  if (section === "render") {
    const k = String(v.apiKey || "").trim();
    if (!has("apiKey")) e.apiKey = "Enter the MyArchitectAI API key.";
    else if (k && (/\s/.test(k) || k.length < 16)) e.apiKey = "That does not look like a MyArchitectAI key.";
  }
  return e;
};

/** The badge beside a section's title. */
const statusOf = (data, test) => {
  if (test) return test.ok ? { tone: "ok", text: "Connected" } : { tone: "bad", text: "Failed" };
  if (!data) return null;
  const secrets = Object.values(data.secrets || {});
  const anySet = secrets.some((s) => s.set) || (data.values?.enabled && data.values?.host);
  if (data.values?.enabled === false && "host" in (data.values || {})) return { tone: "off", text: "Off" };
  if (!anySet) return { tone: "warn", text: "Not set up" };
  if (data.saved) return { tone: "ok", text: "Saved here" };
  return { tone: "warn", text: "Using server file" };
};

const formatWhen = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};

const EyeIcon = ({ open }) => (
  <Icon size={18}>
    {open ? (
      <>
        <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1M6.2 6.2C3.9 7.9 2.5 12 2.5 12s3.5 7 9.5 7a9.4 9.4 0 0 0 4.2-1" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </>
    )}
  </Icon>
);

const SecretInput = ({ id, field, value, secret, onChange, disabled, invalid }) => {
  const [shown, setShown] = useState(false);
  const placeholder = secret?.set ? "Leave empty to keep the saved one" : field.placeholder || "Not set";
  return (
    <div className={`pzs-secret${invalid ? " is-invalid" : ""}`}>
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value || ""}
        placeholder={placeholder}
        autoComplete="new-password"
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="pzs-eye"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide" : "Show"}
        title={shown ? "Hide" : "Show"}
        disabled={disabled}
      >
        <EyeIcon open={!shown} />
      </button>
    </div>
  );
};

const secretHint = (field, secret, changed) => {
  if (changed) return "The new value replaces the saved one when you save.";
  if (!secret?.set) return "";
  const what = field.name === "password" ? "password" : "key";
  return secret.source === "env" ? `Using the ${what} from the server file.` : `Saved on this page.`;
};

const SectionForm = ({ spec, data, options, onSaved }) => {
  const [form, setForm] = useState(() => ({ ...(data?.values || {}) }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null); // "save" | "test"
  const [notice, setNotice] = useState(null); // { tone, text }
  const [test, setTest] = useState(null);

  useEffect(() => {
    setForm({ ...(data?.values || {}) });
    setErrors({});
  }, [data]);

  const dirty = useMemo(() => {
    const base = data?.values || {};
    return Object.keys(form).some((k) => {
      // A key field left empty keeps the saved key, so it is not a change.
      if (data?.secrets?.[k] && !String(form[k] || "").trim()) return false;
      return String(form[k] ?? "") !== String(base[k] ?? "");
    });
  }, [form, data]);

  const set = (name, value) => {
    setForm((f) => {
      const next = { ...f, [name]: value };
      // Keep the port in step with the encryption while it is still a default.
      if (spec.key === "email" && name === "encryption") {
        if (value === "ssl" && String(f.port) === "587") next.port = 465;
        if (value === "tls" && String(f.port) === "465") next.port = 587;
      }
      return next;
    });
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
    setNotice(null);
    setTest(null);
  };

  const payload = () => {
    const out = { ...form };
    // Send a key only when it was changed: empty or unchanged keeps the saved one
    // (and a key from the server file is not copied into the database).
    for (const k of Object.keys(data?.secrets || {})) {
      if (!String(out[k] || "").trim() || out[k] === data?.values?.[k]) delete out[k];
    }
    return out;
  };

  const check = () => {
    const e = validate(spec.key, form, data?.secrets);
    setErrors(e);
    if (Object.keys(e).length) {
      setNotice({ tone: "bad", text: "Fix the highlighted fields first." });
      return false;
    }
    return true;
  };

  const save = async () => {
    if (busy) return;
    if (!dirty) {
      setNotice({ tone: "ok", text: "No changes to save." });
      return;
    }
    if (!check()) return;
    setBusy("save");
    setNotice(null);
    const res = await saveAppSettings(spec.key, payload());
    setBusy(null);
    if (res.error) {
      setErrors(res.fields || {});
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    setNotice({ tone: "ok", text: "Settings saved. They apply right away." });
    onSaved(spec.key, res.data);
  };

  const runTest = async () => {
    if (busy || !check()) return;
    setBusy("test");
    setNotice(null);
    setTest(null);
    const res = await testAppSettings(spec.key, payload());
    setBusy(null);
    if (res.error) {
      setErrors(res.fields || {});
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    setTest(res.data);
    setNotice({
      tone: res.data.ok ? "ok" : "bad",
      text: res.data.ok && dirty ? `${res.data.message} Save to use these settings.` : res.data.message,
    });
  };

  const status = statusOf(data, test);
  const off = spec.key === "email" && !form.enabled;

  const renderField = (field) => {
    const id = `pzs-${spec.key}-${field.name}`;
    const err = errors[field.name];
    const disabled = !!busy || (field.needsEnabled && off);
    if (field.type === "switch") {
      return (
        <div key={field.name} className={`pzs-field pzs-field--switch${field.wide ? " is-wide" : ""}`}>
          <label className="pzs-switch" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              role="switch"
              checked={!!form[field.name]}
              disabled={!!busy}
              onChange={(e) => set(field.name, e.target.checked)}
            />
            <span className="pzs-switch-track" aria-hidden="true" />
            <span>{field.label}</span>
          </label>
        </div>
      );
    }
    let control;
    if (field.type === "secret") {
      control = (
        <SecretInput
          key={data?.updatedAt || "loaded"}
          id={id}
          field={field}
          value={form[field.name]}
          secret={data?.secrets?.[field.name]}
          disabled={disabled}
          invalid={!!err}
          onChange={(v) => set(field.name, v)}
        />
      );
    } else if (field.type === "select") {
      const opts =
        field.options === "claudeModels"
          ? [
              ["", `Server default (${options?.defaultClaudeModel || "claude-opus-4-8"})`],
              ...(options?.claudeModels || []).map((m) => [m, m]),
            ]
          : field.options;
      control = (
        <select
          id={id}
          className={err ? "is-invalid" : ""}
          value={form[field.name] ?? ""}
          disabled={disabled}
          onChange={(e) => set(field.name, e.target.value)}
        >
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <input
          id={id}
          type="text"
          className={err ? "is-invalid" : ""}
          value={form[field.name] ?? ""}
          placeholder={field.placeholder}
          inputMode={field.inputMode}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => set(field.name, e.target.value)}
        />
      );
    }
    const changed =
      !!String(form[field.name] || "").trim() && form[field.name] !== data?.values?.[field.name];
    const hint = field.type === "secret" ? secretHint(field, data?.secrets?.[field.name], changed) : "";
    return (
      <div key={field.name} className={`pzs-field${field.wide ? " is-wide" : ""}`}>
        <label htmlFor={id}>{field.label}</label>
        {control}
        {err ? <p className="pzs-err">{err}</p> : hint ? <p className="pzs-hint">{hint}</p> : null}
      </div>
    );
  };

  return (
    <div className="pzs-section">
      <div className={`pzs-cards${spec.cards.length > 1 ? " is-pair" : ""}`}>
      {spec.cards.map((card, i) => (
        <section key={card.title} className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>{card.title}</h2>
              {card.subtitle ? <p>{card.subtitle}</p> : null}
            </div>
            {i === 0 && status ? <span className={`pzs-badge is-${status.tone}`}>{status.text}</span> : null}
          </header>
          <div className="pzs-grid">{card.fields.map(renderField)}</div>
        </section>
      ))}
      </div>

      <div className="pzs-bar">
        <div className="pzs-bar-msg" role="status" aria-live="polite">
          {notice ? (
            <span className={`pzs-notice is-${notice.tone}`}>{notice.text}</span>
          ) : data?.updatedAt ? (
            <span className="pzs-meta">
              Last saved {formatWhen(data.updatedAt)}
              {data.updatedBy ? ` by ${data.updatedBy}` : ""}
            </span>
          ) : (
            <span className="pzs-meta">{spec.testHint}</span>
          )}
        </div>
        <div className="pzs-bar-actions">
          <button type="button" className="pzs-btn" onClick={runTest} disabled={!!busy} title={spec.testHint}>
            {busy === "test" ? "Testing…" : spec.testLabel}
          </button>
          <button type="button" className="pzs-btn pzs-btn--primary" onClick={save} disabled={!!busy}>
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

const readTab = () => {
  const t = new URLSearchParams(window.location.search).get("tab");
  return SECTIONS.some((s) => s.key === t) ? t : "email";
};

const Settings = () => {
  const user = getCurrentUser();
  const isAdmin =
    user?.permissions === USER_ROLES.ADMIN ||
    user?.permissions === USER_ROLES.SUPER_ADMIN;

  const [tab, setTab] = useState(readTab);
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [closedGroups, setClosedGroups] = useState({});
  const [pageKey, setPageKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const res = await getAppSettings();
    setLoading(false);
    if (res.error) {
      setLoadError(res.message);
      return;
    }
    setSettings(res.data);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const pick = (key) => {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    // Leaving (or re-opening) Email Templates goes back to its list.
    url.searchParams.delete("tpl");
    url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
    setPageKey((n) => n + 1);
  };

  const onSaved = (key, data) => setSettings((s) => ({ ...s, [key]: data }));

  if (!isAdmin) {
    return (
      <div className="pz-app-shell">
        <NavRail variant="app" />
        <Container className="py-4">
          <Alert variant="warning">
            You don’t have access to Settings. This screen is available to admins only.
          </Alert>
        </Container>
      </div>
    );
  }

  const spec = SECTIONS.find((s) => s.key === tab);
  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <div className="pz-app-shell">
      <NavRail variant="app" />
      <div className="pz-app-main pz-projects-main">
        <AppHeader />
        <Container fluid className="pz-projects pz-settings overflow-x-hidden overflow-y-auto">
          <div className="pz-projects-inner">
            <div className="pzs-layout">
              <nav className="pzs-nav" aria-label="Settings sections">
                {groups.map((g) => (
                  <div key={g} className={`pzs-nav-group${closedGroups[g] ? " is-closed" : ""}`}>
                    <button
                      type="button"
                      className="pzs-nav-title"
                      aria-expanded={!closedGroups[g]}
                      onClick={() => setClosedGroups((c) => ({ ...c, [g]: !c[g] }))}
                    >
                      {g}
                      <Icon size={16}>
                        <path d="m6 15 6-6 6 6" />
                      </Icon>
                    </button>
                    {closedGroups[g] ? null : SECTIONS.filter((s) => s.group === g).map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        className={`pzs-nav-i${tab === s.key ? " is-active" : ""}`}
                        data-tone={s.tone}
                        aria-current={tab === s.key ? "page" : undefined}
                        onClick={() => pick(s.key)}
                      >
                        <span className="pzs-nav-ic">
                          <Icon size={17}>{s.icon}</Icon>
                        </span>
                        {s.label}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              <div className="pzs-main">
                {spec.page === "templates" ? (
                  <EmailTemplates key={pageKey} />
                ) : spec.page === "invoice" ? (
                  <TaxInvoice key={pageKey} />
                ) : spec.page === "branding" ? (
                  <Branding key={pageKey} />
                ) : loading && !settings ? (
                  <div className="pzs-card pzs-loading">Loading settings…</div>
                ) : loadError && !settings ? (
                  <div className="pzs-card pzs-loading">
                    <p className="pzs-err">{loadError}</p>
                    <button type="button" className="pzs-btn" onClick={load}>
                      Try again
                    </button>
                  </div>
                ) : (
                  <SectionForm
                    key={spec.key}
                    spec={spec}
                    data={settings?.[spec.key]}
                    options={settings?.options}
                    onSaved={onSaved}
                  />
                )}
              </div>
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
};

export default Settings;
