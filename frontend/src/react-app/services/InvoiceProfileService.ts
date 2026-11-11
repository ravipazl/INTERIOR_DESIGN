import { useEffect, useState } from "react";

/**
 * The Tax / Invoice profile the BOQ prints (Settings → Tax / Invoice).
 *
 * Used by the 3D app's BOQ page (and its PDF) and the client's BOQ view, so
 * both read the same saved company, tax, payment, bank and footer details
 * instead of values written in their code.
 *
 * DEFAULT_INVOICE_PROFILE is what the BOQ printed before the page existed. It
 * is shown while the saved profile loads, and if it can't be loaded, so a BOQ
 * never renders blank and its totals never change unexpectedly.
 */

export interface InvoiceProfile {
  id?: string;
  name: string;
  companyName: string;
  address: string;
  phone: string;
  email: string;
  contactLine: string;
  gstin: string;
  pan: string;
  logo: string; // data: URL, or "" for the PAZL logo
  gstRate: number; // percent, e.g. 18
  transportPct: number; // percent of the items subtotal, e.g. 0.15
  packingPct: number;
  quotePrefix: string;
  paymentSchedule: { percent: number; text: string }[];
  notes: string[];
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  forText: string;
  signText: string;
  footerTerms: string;
}

export const DEFAULT_INVOICE_PROFILE: InvoiceProfile = {
  name: "Pazl",
  companyName: "PAZL",
  address: "Regd. office: 17/12 #3B, Ganapathy Street, Chennai 600014",
  phone: "+91 94440 94422",
  email: "gafoo.ak@pazl.in",
  contactLine: "R. Karthik (CEO) · +91 98405 44441 · karthik@nichedesginloft.com",
  gstin: "",
  pan: "",
  logo: "",
  gstRate: 18,
  transportPct: 0.15,
  packingPct: 0.15,
  quotePrefix: "",
  paymentSchedule: [
    { percent: 10, text: "upon order & design confirmation" },
    { percent: 40, text: "before commencement of work" },
    { percent: 40, text: "upon delivery of products" },
    { percent: 10, text: "after completion of work" },
  ],
  notes: [
    "Dimensions and estimation based on drawing provided by client, actual measurements may vary on site.",
    "Items not mentioned in estimate will be charged additionally.",
    "All civil works not mentioned will be additional.",
    "Estimate is valid for a time period of 30 days from date mentioned above.",
    "Light fittings will be based on final design, not included in this estimate, cost will be actual.",
  ],
  bankName: "State Bank of India",
  accountName: "NDL Interiors Private Ltd",
  accountNumber: "36342320833",
  ifsc: "SBIN0000962",
  branch: "Gopalapuram",
  forText: "For Pazl",
  signText: "Authorized seal or stamp",
  footerTerms: "",
};

const API = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL || "";

/** Fill any missing field with the default, and make the numbers numbers. */
export const normaliseInvoiceProfile = (p: any): InvoiceProfile => {
  const out: any = { ...DEFAULT_INVOICE_PROFILE, ...(p || {}) };
  for (const k of ["gstRate", "transportPct", "packingPct"]) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? n : (DEFAULT_INVOICE_PROFILE as any)[k];
  }
  if (!Array.isArray(out.paymentSchedule)) out.paymentSchedule = DEFAULT_INVOICE_PROFILE.paymentSchedule;
  if (!Array.isArray(out.notes)) out.notes = DEFAULT_INVOICE_PROFILE.notes;
  return out;
};

let cached: Promise<InvoiceProfile> | null = null;

/** The default profile from the server (cached for this page load). */
export const loadActiveInvoiceProfile = (fresh = false): Promise<InvoiceProfile> => {
  if (!cached || fresh) {
    cached = fetch(`${API}/invoice-profiles/active`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => normaliseInvoiceProfile(p))
      .catch(() => {
        cached = null; // try again next time
        return DEFAULT_INVOICE_PROFILE;
      });
  }
  return cached;
};

/**
 * The profile to print. `override` (a sent quote's own copy) wins; otherwise
 * the current default profile, re-read each time a BOQ screen opens.
 */
export const useInvoiceProfile = (override?: any): InvoiceProfile => {
  const [profile, setProfile] = useState<InvoiceProfile>(() =>
    override ? normaliseInvoiceProfile(override) : DEFAULT_INVOICE_PROFILE
  );
  useEffect(() => {
    if (override) {
      setProfile(normaliseInvoiceProfile(override));
      return undefined;
    }
    let live = true;
    loadActiveInvoiceProfile(true).then((p) => live && setProfile(p));
    return () => {
      live = false;
    };
  }, [override]);
  return profile;
};

/** "0.15" → "0.15", "18" → "18" — for labels like "GST 18%". */
export const pctLabel = (n: number) => String(Number((Number(n) || 0).toFixed(3)));
