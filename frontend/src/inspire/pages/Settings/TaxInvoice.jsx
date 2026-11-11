import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/PzTable";
import { listInvoiceProfiles, updateInvoiceProfile } from "../../services/invoiceProfilesService";
import { DEFAULT_INVOICE_PROFILE } from "@pazl/services/InvoiceProfileService";
import { useBranding } from "@pazl/services/BrandingService";
import "./EmailTemplates.css";
import "./TaxInvoice.css";

/**
 * Settings → Tax / Invoice. The details printed on the Bill of Quantity:
 * company ("From"), GSTIN / PAN, logo, GST and Transport / Packing rates, the
 * quote number prefix, payment schedule, notes, bank details and footer.
 *
 * One set of details, edited and saved here. (The backend stores it as the
 * DEFAULT invoice profile — the one every new BOQ uses: the 3D app's BOQ page
 * and PDF, the client's BOQ view and the quote link. A quote already sent
 * keeps the details it was sent with.)
 */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_LOGO = 2 * 1024 * 1024;

// The form keeps numbers as typed text and notes as one block of lines.
const toForm = (p) => ({
  ...DEFAULT_INVOICE_PROFILE,
  ...p,
  gstRate: String(p.gstRate ?? ""),
  transportPct: String(p.transportPct ?? ""),
  packingPct: String(p.packingPct ?? ""),
  paymentSchedule: (p.paymentSchedule || []).map((r) => ({ percent: String(r.percent ?? ""), text: r.text || "" })),
  notesText: (p.notes || []).join("\n"),
});
const fromForm = (f) => ({
  name: f.name,
  companyName: f.companyName,
  address: f.address,
  phone: f.phone,
  email: f.email,
  contactLine: f.contactLine,
  gstin: f.gstin.trim().toUpperCase(),
  pan: f.pan.trim().toUpperCase(),
  logo: f.logo,
  gstRate: f.gstRate,
  transportPct: f.transportPct,
  packingPct: f.packingPct,
  quotePrefix: f.quotePrefix.trim().toUpperCase(),
  paymentSchedule: f.paymentSchedule,
  notes: f.notesText.split("\n").map((l) => l.trim()).filter(Boolean),
  bankName: f.bankName,
  accountName: f.accountName,
  accountNumber: f.accountNumber,
  ifsc: f.ifsc.trim().toUpperCase(),
  branch: f.branch,
  forText: f.forText,
  signText: f.signText,
  footerTerms: f.footerTerms,
});

const num = (v) => (String(v).trim() === "" ? NaN : Number(v));
const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const scheduleTotal = (rows) => Math.round(rows.reduce((a, r) => a + (Number(r.percent) || 0), 0) * 100) / 100;

// The same checks the server makes, so mistakes show before a round trip.
// (The profile's own name isn't on this page: it keeps its saved value.)
const validate = (f) => {
  const e = {};
  if (!f.companyName.trim()) e.companyName = "Enter the company name.";
  if (f.phone.trim() && !/^[+0-9 ()-]{6,20}$/.test(f.phone.trim())) e.phone = "Enter a phone number, such as +91 94440 94422.";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
  const gstin = f.gstin.trim().toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) e.gstin = "Enter a valid 15-character GSTIN, such as 33ABCDE1234F1Z7.";
  const pan = f.pan.trim().toUpperCase();
  if (pan && !PAN_RE.test(pan)) e.pan = "Enter a valid PAN, such as ABCDE1234F.";
  if (!inRange(num(f.gstRate), 0, 28)) e.gstRate = "Enter a GST rate between 0 and 28.";
  if (!inRange(num(f.transportPct), 0, 10)) e.transportPct = "Enter a transport rate between 0 and 10.";
  if (!inRange(num(f.packingPct), 0, 10)) e.packingPct = "Enter a packing rate between 0 and 10.";
  if (!/^[A-Z0-9\-/]{0,10}$/.test(f.quotePrefix.trim().toUpperCase())) e.quotePrefix = "Use up to 10 capital letters, numbers, - or /.";
  const rows = f.paymentSchedule;
  if (!rows.length) e.paymentSchedule = "Add at least one payment step.";
  else if (rows.some((r) => !inRange(num(r.percent), 0.01, 100))) e.paymentSchedule = "Each step needs a percent between 0 and 100.";
  else if (rows.some((r) => !r.text.trim())) e.paymentSchedule = "Each step needs a description.";
  else if (scheduleTotal(rows) !== 100) e.paymentSchedule = `The steps add up to ${scheduleTotal(rows)}%. They must add up to 100%.`;
  if (f.notesText.split("\n").filter((l) => l.trim()).length > 15) e.notes = "Use at most 15 notes.";
  const ifsc = f.ifsc.trim().toUpperCase();
  if (ifsc && !IFSC_RE.test(ifsc)) e.ifsc = "Enter a valid IFSC code, such as SBIN0000962.";
  const acc = f.accountNumber.replace(/\s+/g, "");
  if (acc && !/^[0-9]{6,20}$/.test(acc)) e.accountNumber = "Enter 6–20 digits.";
  return e;
};

const TaxInvoice = () => {
  const brand = useBranding();
  const [profile, setProfile] = useState(null); // the saved details
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError("");
    const res = await listInvoiceProfiles();
    if (res.error) {
      setLoadError(res.message);
      return;
    }
    const list = res.data.profiles || [];
    const p = list.find((x) => x.isDefault) || list[0];
    if (!p) {
      setLoadError("No invoice details were found. Reload the page to try again.");
      return;
    }
    setProfile(p);
    setForm(toForm(p));
    setErrors({});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => !!form && !!profile && JSON.stringify(fromForm(form)) !== JSON.stringify(fromForm(toForm(profile))),
    [form, profile]
  );

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
    setNotice(null);
  };
  const setRow = (i, key, value) => {
    setForm((f) => ({ ...f, paymentSchedule: f.paymentSchedule.map((r, j) => (j === i ? { ...r, [key]: value } : r)) }));
    setErrors((e) => (e.paymentSchedule ? { ...e, paymentSchedule: undefined } : e));
    setNotice(null);
  };

  const pickLogo = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setErrors((e) => ({ ...e, logo: "Choose a PNG or JPG image." }));
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

  const save = async () => {
    if (busy) return;
    if (!dirty) {
      setNotice({ tone: "ok", text: "No changes to save." });
      return;
    }
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) {
      setNotice({ tone: "bad", text: "Fix the highlighted fields first." });
      return;
    }
    setBusy(true);
    const res = await updateInvoiceProfile(profile.id, fromForm(form));
    setBusy(false);
    if (res.error) {
      setErrors(res.fields || {});
      setNotice({ tone: "bad", text: res.message });
      return;
    }
    setProfile(res.data);
    setForm(toForm(res.data));
    setNotice({ tone: "ok", text: "Saved. New BOQs use these details." });
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
  if (!form) return <div className="pzs-card pzs-loading">Loading invoice settings…</div>;

  const field = (name, label, opts = {}) => (
    <div className={`pzs-field${opts.wide ? " is-wide" : ""}`}>
      <label htmlFor={`pzi-${name}`}>
        {label}
        {opts.required ? <span className="pzt-req"> *</span> : null}
      </label>
      {opts.textarea ? (
        <textarea
          id={`pzi-${name}`}
          className={`pzi-textarea${errors[name] ? " is-invalid" : ""}`}
          rows={opts.rows || 3}
          value={form[name] ?? ""}
          placeholder={opts.placeholder}
          onChange={(e) => set(name, e.target.value)}
        />
      ) : (
        <input
          id={`pzi-${name}`}
          type="text"
          inputMode={opts.numeric ? "decimal" : undefined}
          className={errors[name] ? "is-invalid" : ""}
          value={form[name] ?? ""}
          placeholder={opts.placeholder}
          onChange={(e) => set(name, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      )}
      {errors[name] ? <p className="pzs-err">{errors[name]}</p> : opts.hint ? <p className="pzs-hint">{opts.hint}</p> : null}
    </div>
  );

  const total = scheduleTotal(form.paymentSchedule);
  const notesError = errors.notes;

  return (
    <div className="pzt-page">
      <div className="pzt-head">
        <div>
          <nav className="pzt-crumbs" aria-label="Breadcrumb">
            <span>Settings</span>
          </nav>
          <h1 className="pzt-title">Tax &amp; Invoice</h1>
        </div>
      </div>

      <div className="pzi-form">
        <section className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>Company (on invoice)</h2>
              <p>The “From” block at the top of the BOQ.</p>
            </div>
          </header>
          <div className="pzs-grid">
            {field("companyName", "Company name", { required: true, placeholder: "PAZL" })}
            {field("address", "Address", { wide: true, textarea: true, rows: 2, placeholder: "Regd. office: 17/12 #3B, Ganapathy Street, Chennai 600014" })}
            {field("phone", "Phone", { placeholder: "+91 94440 94422" })}
            {field("email", "Email", { placeholder: "accounts@pazl.info" })}
            {field("contactLine", "Contact line", { wide: true, hint: "Shown under the address, e.g. the CEO’s name and number." })}
            {field("gstin", "GSTIN", { upper: true, placeholder: "33ABCDE1234F1Z7" })}
            {field("pan", "PAN", { upper: true, placeholder: "ABCDE1234F" })}
            <div className="pzs-field is-wide">
              <label>Invoice logo</label>
              <div className={`pzi-logo${errors.logo ? " is-invalid" : ""}`}>
                <img src={form.logo || brand.logo || require("../../../react-app/images/pazl.png")} alt="Invoice logo" />
                <span className="pzs-hint">
                  {form.logo
                    ? "Your invoice logo — used on the BOQ only."
                    : "None uploaded — the BOQ uses the logo from Settings → Branding."}{" "}
                  PNG or JPG, up to 2 MB.
                </span>
                <span className="pzi-logo-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg"
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
                      Remove
                    </button>
                  ) : null}
                </span>
              </div>
              {errors.logo ? <p className="pzs-err">{errors.logo}</p> : null}
            </div>
          </div>
        </section>

        <section className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>Tax &amp; charges</h2>
              <p>Used in the BOQ totals.</p>
            </div>
          </header>
          <div className="pzs-grid">
            {field("gstRate", "GST rate (%)", { required: true, numeric: true, hint: "Charged on the items total." })}
            {field("quotePrefix", "Quote number prefix", {
              upper: true,
              placeholder: "PZL-",
              hint: `New quote numbers: ${(form.quotePrefix || "").toUpperCase()}CBF02CACFA. Existing ones don’t change.`,
            })}
            {field("transportPct", "Transport (% of items)", { required: true, numeric: true })}
            {field("packingPct", "Packing (% of items)", { required: true, numeric: true })}
          </div>
        </section>

        <section className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>Payment schedule</h2>
              <p>The steps must add up to 100%.</p>
            </div>
            <span className={`pzs-badge ${total === 100 ? "is-ok" : "is-warn"}`}>Total {total}%</span>
          </header>
          <div className="pzi-rows">
            {form.paymentSchedule.map((r, i) => (
              <div className="pzi-row" key={i}>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Step ${i + 1} percent`}
                  className={errors.paymentSchedule ? "is-invalid" : ""}
                  value={r.percent}
                  onChange={(e) => setRow(i, "percent", e.target.value)}
                />
                <span className="pzi-pct">%</span>
                <input
                  type="text"
                  aria-label={`Step ${i + 1} description`}
                  className={errors.paymentSchedule ? "is-invalid" : ""}
                  value={r.text}
                  placeholder="upon order & design confirmation"
                  onChange={(e) => setRow(i, "text", e.target.value)}
                />
                <button
                  type="button"
                  className="pzt-act is-danger"
                  aria-label={`Remove step ${i + 1}`}
                  title="Remove"
                  onClick={() => set("paymentSchedule", form.paymentSchedule.filter((_, j) => j !== i))}
                >
                  <Icon size={16}>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </Icon>
                </button>
              </div>
            ))}
            {errors.paymentSchedule ? <p className="pzs-err">{errors.paymentSchedule}</p> : null}
            <div>
              <button
                type="button"
                className="pzs-btn"
                disabled={form.paymentSchedule.length >= 10}
                onClick={() => set("paymentSchedule", [...form.paymentSchedule, { percent: "", text: "" }])}
              >
                <Icon size={16}>
                  <path d="M12 5v14M5 12h14" />
                </Icon>
                Add step
              </button>
            </div>
          </div>
        </section>

        <section className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>Notes &amp; bank details</h2>
            </div>
          </header>
          <div className="pzs-grid">
            <div className="pzs-field is-wide">
              <label htmlFor="pzi-notes">Notes (one per line)</label>
              <textarea
                id="pzi-notes"
                className={`pzi-textarea${notesError ? " is-invalid" : ""}`}
                rows={5}
                value={form.notesText}
                onChange={(e) => {
                  set("notesText", e.target.value);
                  setErrors((er) => (er.notes ? { ...er, notes: undefined } : er));
                }}
              />
              {notesError ? <p className="pzs-err">{notesError}</p> : <p className="pzs-hint">Each line is one numbered note on the BOQ.</p>}
            </div>
            {field("bankName", "Bank name", { placeholder: "State Bank of India" })}
            {field("accountName", "Account name", { placeholder: "NDL Interiors Private Ltd" })}
            {field("accountNumber", "Account number", { numeric: true, placeholder: "36342320833" })}
            {field("ifsc", "IFSC code", { upper: true, placeholder: "SBIN0000962" })}
            {field("branch", "Branch", { wide: true, placeholder: "Gopalapuram" })}
          </div>
        </section>

        <section className="pzs-card">
          <header className="pzs-card-head">
            <div>
              <h2>Invoice footer</h2>
            </div>
          </header>
          <div className="pzs-grid">
            {field("forText", "“For …” line", { placeholder: "For Pazl" })}
            {field("signText", "Signature line", { placeholder: "Authorized seal or stamp" })}
            {field("footerTerms", "Footer terms", { wide: true, textarea: true, rows: 3, placeholder: "Thank you for your business.", hint: "Printed at the very bottom. Leave empty for none." })}
          </div>
        </section>
      </div>

      <div className="pzs-bar">
        <div className="pzs-bar-msg" role="status" aria-live="polite">
          {notice ? (
            <span className={`pzs-notice is-${notice.tone}`}>{notice.text}</span>
          ) : profile?.updatedAt ? (
            <span className="pzs-meta">
              Last saved {new Date(profile.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {profile.updatedBy && profile.updatedBy !== "system" ? ` by ${profile.updatedBy}` : ""}
            </span>
          ) : null}
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

export default TaxInvoice;
