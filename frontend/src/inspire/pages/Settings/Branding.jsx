import React, { useCallback, useEffect, useRef, useState } from "react";
import { getBrandingSettings, saveBranding } from "../../services/brandingService";
import { setBranding } from "@pazl/services/BrandingService";
import pazlLogo from "../../assets/images/pazl_logo.svg";
import "./TaxInvoice.css";
import "./Branding.css";

/**
 * Settings → Branding. The app logo and name, used everywhere the PAZL logo
 * was written in the code: both top headers, the side menu, the sign-in pages,
 * the landing page, the client's quote page, the BOQ (unless Tax / Invoice has
 * its own invoice logo), the browser tab icon and every email's header.
 *
 * Removing the logo goes back to the built-in PAZL logo. A save applies at
 * once on this page; other open pages pick it up when they next load.
 */

const MAX_LOGO = 2 * 1024 * 1024;

const Branding = () => {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError("");
    const res = await getBrandingSettings();
    if (res.error) {
      setLoadError(res.message);
      return;
    }
    setSaved(res.data);
    setForm({ appName: res.data.appName || "PAZL", logo: res.data.logo || "" });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
    setNotice(null);
  };

  const pickLogo = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) {
      setErrors((e) => ({ ...e, logo: "Choose a PNG, JPG or SVG image." }));
      return;
    }
    if (file.size > MAX_LOGO) {
      setErrors((e) => ({ ...e, logo: "The logo must be 2 MB or smaller." }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  if (loadError && !form) {
    return (
      <div className="pzs-card pzs-loading">
        <p className="pzs-err">{loadError}</p>
        <button type="button" className="pzs-btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!form) return <div className="pzs-card pzs-loading">Loading branding…</div>;

  const dirty = form.appName !== (saved?.appName || "PAZL") || form.logo !== (saved?.logo || "");
  const logo = form.logo || pazlLogo;
  const name = form.appName.trim() || "PAZL";

  const save = async () => {
    if (busy) return;
    if (!dirty) {
      setNotice({ tone: "ok", text: "No changes to save." });
      return;
    }
    const e = {};
    if (!form.appName.trim()) e.appName = "Enter the app name.";
    else if (form.appName.trim().length > 30) e.appName = "Keep the app name under 30 characters.";
    setErrors(e);
    if (Object.keys(e).length) {
      setNotice({ tone: "bad", text: "Fix the highlighted fields first." });
      return;
    }
    setBusy(true);
    const res = await saveBranding({ appName: form.appName.trim(), logo: form.logo });
    setBusy(false);
    if (res.error) {
      setErrors(res.fields || {});
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    setSaved(res.data);
    setForm({ appName: res.data.appName, logo: res.data.logo || "" });
    setBranding({ appName: res.data.appName, logo: res.data.logo || "" });
    setNotice({ tone: "ok", text: "Saved. The new logo shows everywhere — other open pages after they reload." });
  };

  return (
    <div className="pzt-page">
      <div className="pzt-head">
        <div>
          <nav className="pzt-crumbs" aria-label="Breadcrumb">
            <span>Settings</span>
          </nav>
          <h1 className="pzt-title">Branding</h1>
          <p className="pzt-sub">The logo and name shown across Pazl, in emails and on the BOQ.</p>
        </div>
      </div>

      <div className="pzi-cols">
        <section className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>Branding</h2>
              <p>Used everywhere the PAZL logo appears.</p>
            </div>
            <span className={`pzs-badge ${saved?.logo ? "is-ok" : "is-off"}`}>{saved?.logo ? "Custom logo" : "PAZL logo"}</span>
          </header>
          <div className="pzs-grid">
            <div className="pzs-field is-wide">
              <label htmlFor="pzb-name">
                App name<span className="pzt-req"> *</span>
              </label>
              <input
                id="pzb-name"
                type="text"
                className={errors.appName ? "is-invalid" : ""}
                value={form.appName}
                placeholder="PAZL"
                onChange={(e) => set("appName", e.target.value)}
              />
              {errors.appName ? (
                <p className="pzs-err">{errors.appName}</p>
              ) : (
                <p className="pzs-hint">Shown beside the logo in the header, side menu, sign-in page and emails.</p>
              )}
            </div>
            <div className="pzs-field is-wide">
              <label>Logo</label>
              <div className={`pzi-logo${errors.logo ? " is-invalid" : ""}`}>
                <img src={logo} alt="App logo" />
                <span className="pzs-hint">
                  {form.logo ? "Your logo." : "The built-in PAZL logo."} PNG, JPG or SVG, up to 2 MB. A square image
                  works best.
                </span>
                <span className="pzi-logo-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    hidden
                    onChange={(e) => {
                      pickLogo(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="pzs-btn" onClick={() => fileRef.current?.click()}>
                    {form.logo ? "Replace" : "Upload"}
                  </button>
                  {form.logo ? (
                    <button type="button" className="pzs-btn" onClick={() => set("logo", "")}>
                      Use PAZL logo
                    </button>
                  ) : null}
                </span>
              </div>
              {errors.logo ? <p className="pzs-err">{errors.logo}</p> : null}
            </div>
          </div>
        </section>

        <aside className="pzi-preview">
          <p className="pzt-label">
            Preview <span>— where it shows</span>
          </p>
          <div className="pzb-previews">
            <div className="pzb-place">
              <span className="pzb-cap">Top header</span>
              <div className="pzb-topbar">
                <span className="pzb-tile">
                  <img src={logo} alt="" />
                </span>
                <b>{name}</b>
              </div>
            </div>
            <div className="pzb-place">
              <span className="pzb-cap">Side menu and sign-in page</span>
              <div className="pzb-menu">
                <img src={logo} alt="" />
                <b>{name}</b>
              </div>
            </div>
            <div className="pzb-place">
              <span className="pzb-cap">Email header</span>
              <div className="pzb-mail">
                <img src={logo} alt="" />
                <b>{name}</b>
              </div>
              {form.logo && /^data:image\/svg/.test(form.logo) ? (
                <p className="pzs-hint">Mail apps can’t show SVG, so emails get a PNG copy of this logo automatically.</p>
              ) : null}
            </div>
            <div className="pzb-place">
              <span className="pzb-cap">Browser tab</span>
              <div className="pzb-tab">
                <img src={form.logo || "/assets/favicon.ico"} alt="" />
                <span>{name} Designer</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="pzs-bar">
        <div className="pzs-bar-msg" role="status" aria-live="polite">
          {notice ? (
            <span className={`pzs-notice is-${notice.tone}`}>{notice.text}</span>
          ) : saved?.updatedAt ? (
            <span className="pzs-meta">
              Last saved {new Date(saved.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {saved.updatedBy ? ` by ${saved.updatedBy}` : ""}
            </span>
          ) : (
            <span className="pzs-meta">Not changed yet — the app uses the PAZL logo.</span>
          )}
        </div>
        <div className="pzs-bar-actions">
          <button type="button" className="pzs-btn pzs-btn--primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Branding;
