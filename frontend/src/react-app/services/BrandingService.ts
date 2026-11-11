import { useEffect, useState } from "react";

/**
 * The app's logo and name (Settings → General → Branding), for every place
 * the PAZL logo used to be written in the code: both top headers, the side
 * menu, the sign-in pages, the landing page, the client's quote page, the BOQ
 * and the browser tab icon. Shared by both apps.
 *
 * `logo` is the uploaded image (a data: URL), or "" for the built-in PAZL
 * logo — each place keeps its own built-in file as the fallback, so nothing
 * changes until an admin uploads a logo.
 *
 * The last branding is remembered in this browser, so a page shows the right
 * logo at once instead of flashing the old one while it loads.
 */

export interface Branding {
  appName: string;
  logo: string;
}

export const DEFAULT_BRANDING: Branding = { appName: "PAZL", logo: "" };

const API = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL || "";
const STORE_KEY = "pz.branding";

const read = (): Branding => {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
    if (v && typeof v === "object") return { appName: v.appName || DEFAULT_BRANDING.appName, logo: v.logo || "" };
  } catch {
    /* nothing remembered */
  }
  return DEFAULT_BRANDING;
};

let current: Branding = typeof window !== "undefined" ? read() : DEFAULT_BRANDING;
const listeners = new Set<(b: Branding) => void>();
let loading: Promise<Branding> | null = null;

// The browser tab icon follows the logo; the original favicon otherwise.
let originalIcon: string | null = null;
const applyFavicon = (b: Branding) => {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (originalIcon === null) originalIcon = link.getAttribute("href") || "/assets/favicon.ico";
  link.href = b.logo || originalIcon;
  applyTitle(b);
};

// The tab title ("Pazl Designer") follows the app name. A page that sets its
// own title (e.g. the landing page) is left alone.
let originalTitle: string | null = null;
let titleWeSet: string | null = null;
const applyTitle = (b: Branding) => {
  if (originalTitle === null) originalTitle = document.title || "Pazl Designer";
  if (document.title !== originalTitle && document.title !== titleWeSet) return;
  const custom = b.appName && b.appName !== DEFAULT_BRANDING.appName;
  document.title = custom ? originalTitle.replace(/pazl/i, b.appName) : originalTitle;
  titleWeSet = document.title;
};

/** Use new branding everywhere on this page (and remember it). */
export const setBranding = (b: Branding) => {
  current = { appName: b.appName || DEFAULT_BRANDING.appName, logo: b.logo || "" };
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(current));
  } catch {
    /* too big or storage blocked: it still applies to this page */
  }
  applyFavicon(current);
  listeners.forEach((fn) => fn(current));
};

/** The saved branding from the server (once per page load). */
export const loadBranding = (): Promise<Branding> => {
  if (!loading) {
    loading = fetch(`${API}/branding`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b) setBranding({ appName: b.appName, logo: b.logo });
        return current;
      })
      .catch(() => {
        loading = null; // try again next time
        return current;
      });
  }
  return loading;
};

/** The branding to show; re-renders when it loads or an admin saves. */
export const useBranding = (): Branding => {
  const [b, setB] = useState<Branding>(current);
  useEffect(() => {
    listeners.add(setB);
    applyFavicon(current);
    loadBranding();
    return () => {
      listeners.delete(setB);
    };
  }, []);
  return b;
};
