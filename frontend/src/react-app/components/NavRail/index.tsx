import React from "react";
import { AuthService } from "@pazl/services/authService";
import { UserPermission } from "@pazl/entities/User";
import "./index.css";

/**
 * App navigation rail for the Designer.
 *
 * This replaced the horizontal FLOOR PLAN / FURNISH / PRODUCTION strip. The
 * four workflow steps are the order the work actually happens in:
 *
 *     Floor plan  ->  3D  ->  Render  ->  BOQ
 *
 * Render and BOQ are the two halves of what used to be the single Production
 * tab; see the NAV_VIEWS note in MenuBar for why they stay one tab underneath.
 *
 * Dashboard is the odd one out: a real route, not a view of this project, so
 * it is a plain anchor and sits apart from the four. Inspire (/) and the
 * Designer (/design/*) are separate webpack bundles behind different router
 * basenames, so it must be a full page load, NOT a react-router <Link>.
 */

type Step = { key: string; label: string; icon: React.ReactNode };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" {...stroke}>
    {children}
  </svg>
);

const STEPS: Step[] = [
  {
    key: "floor_plan",
    label: "Floor plan",
    icon: (
      <Svg>
        <rect x="3" y="3" width="18" height="18" rx="1.5" />
        <path d="M3 14h7V3M10 14h11M14 14v7" />
      </Svg>
    ),
  },
  {
    key: "furnish",
    label: "3D",
    icon: (
      <Svg>
        <path d="m12 2 9 5v10l-9 5-9-5V7z" />
        <path d="m12 12 9-5M12 12v10M12 12 3 7" />
      </Svg>
    ),
  },
  {
    key: "render",
    label: "Render",
    // A CAMERA, not a picture frame. Rendering is taking a photograph of the
    // scene, and the picture-frame glyph is already "Uploaded images" on the
    // client rail — the same shape meaning two different things in two rails.
    icon: (
      <Svg>
        <path d="M4 8h3l1.6-2.2h6.8L17 8h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8z" />
        <circle cx="12" cy="13" r="3.3" />
      </Svg>
    ),
  },
  {
    key: "boq",
    label: "BOQ",
    // A RECEIPT, not a plain document. A page with lines could be any file; the
    // torn edge says "a priced document", which is what a Bill of Quantity is.
    icon: (
      <Svg>
        <path d="M6 2.5h12v19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
        <path d="M9.5 8h5M9.5 12h5" />
      </Svg>
    ),
  },
];

/**
 * The CLIENT's rail. Two items, and the second only when it leads somewhere.
 *
 * A client's whole journey is "here is my room" and then "how is it going?", so
 * the rail holds exactly those two. It deliberately shares nothing with the
 * staff rail below: Teams and Rate card are admin-only, and the four workflow
 * steps are views INSIDE the 3D editor, which a client never opens — reusing
 * that rail would hand them four permanently dead buttons.
 *
 * Project workspace is HIDDEN until a project exists rather than shown disabled.
 * On a two-item rail a greyed item is half the sidebar doing nothing.
 */
const buildClientLinks = (hasProject?: boolean) => {
  const links = [
    {
      href: "/dashboard",
      label: "My rooms",
      icon: (
        <Svg>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </Svg>
      ),
    },
  ];
  // /project-detail with NO id on purpose: that route is registered, and the
  // page looks up the signed-in client's own project when none is given. A
  // client only ever has the one, so carrying an id would add a value to keep
  // in sync for no gain — and it is the form already proven in the browser.
  if (hasProject) {
    links.push({
      href: "/project-detail?tab=uploadedImages",
      label: "Uploaded images",
      icon: (
        <Svg>
          <rect x="2.5" y="4" width="19" height="15" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.6" />
          <path d="m3 17 5.5-5 4 3.5L16 12l5 5" />
        </Svg>
      ),
    });
  }
  // Shown as soon as there is a project, alongside Uploaded images.
  //
  // This used to wait for a quote to have been requested, on the reasoning that
  // at status "open" the workspace opens on an early tracker with little in it.
  // That was over-thinking it: the page works perfectly well at "open", the
  // client can see their project is real and where it stands, and a sidebar
  // whose items appear and disappear as the status changes is harder to trust
  // than one that simply stays put.
  if (hasProject) {
    links.push({
      href: "/project-detail?tab=workspace",
      label: "Project workspace",
      icon: (
        <Svg>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <path d="M3 14h7V3M10 14h11M14 14v7" />
        </Svg>
      ),
    });
  }
  return links;
};

/**
 * Routes out of the Designer, below the divider.
 *
 * ROLE-GATED, and it matters: inspire's Router.js does not even REGISTER
 * /teams or /rate-card unless the user is ADMIN or SUPER_ADMIN, so for an
 * architect — the main user of this editor — those links fall through to the
 * `*` NotFound route. Showing them to everyone would put two dead ends in the
 * rail. Dashboard is fine for every role.
 */
const buildLinks = () => {
  const role = AuthService.getCurrentUser()?.permissions;
  const isAdmin =
    role === UserPermission.ADMIN || role === UserPermission.SUPER_ADMIN;

  const links = [
    {
      href: "/",
      label: "Dashboard",
      // A HOUSE, not a panel grid. The grid was four rectangles inside a
      // rectangle — the same silhouette as the Floor plan icon four rows below,
      // so the two could not be told apart without hovering for a tooltip. A
      // house also says "back to the start", which is what this does.
      icon: (
        <Svg>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </Svg>
      ),
    },
  ];

  if (isAdmin) {
    links.push(
      {
        href: "/teams",
        label: "Teams",
        icon: (
          <Svg>
            <circle cx="9" cy="8" r="3.6" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M16.5 4.6a3.6 3.6 0 0 1 0 6.8M18 20a6.5 6.5 0 0 0-2.2-4.9" />
          </Svg>
        ),
      },
      {
        href: "/rate-card",
        label: "Rate card",
        // A PRICE TAG, not a credit card. The old glyph was a bank card with a
        // magnetic stripe — it promised payment, and this screen is a price list
        // nobody pays from. A tag says price without implying a transaction.
        icon: (
          <Svg>
            <path d="M20.6 12.7 12.7 20.6a2 2 0 0 1-2.8 0l-6.5-6.5a2 2 0 0 1-.6-1.4V4.5a2 2 0 0 1 2-2h8.2a2 2 0 0 1 1.4.6l6.2 6.2a2 2 0 0 1 0 2.8z" />
            <circle cx="7.6" cy="7.6" r="1.3" />
          </Svg>
        ),
      }
    );
  }
  return links;
};

interface NavRailProps {
  /**
   * Where the rail is mounted.
   *
   * "designer" — inside /design/*: shows the four project steps plus the app
   *              links, and drives the steps through onNavigate.
   * "app"      — inside Inspire (Dashboard / Teams / Rate card): app links
   *              only. The four steps are views of an OPEN PROJECT and mean
   *              nothing on a project list, so they are hidden rather than
   *              shown disabled.
   *
   * The two apps are separate webpack bundles sharing one origin and one
   * localStorage session, which is why this component can serve both.
   */
  variant?: "designer" | "app" | "client";
  /**
   * client only — does the client have a project yet? Gates "Uploaded images",
   * which is a view OF a project and has nothing to show without one.
   */
  clientHasProject?: boolean;
  /** One of NAV_VIEWS — which step is on screen (designer only). */
  activeView?: string;
  /** Ask MenuBar to switch to this view. */
  onNavigate?: (view: string) => void;
  /**
   * Flush the design to the server before leaving. Every link below is a full
   * page load out of the editor, and the autosave timer only runs every 5s, so
   * without this you can lose the last few seconds of work just by clicking
   * "Dashboard". Chosen over a confirm dialog: saving is what the user wanted
   * anyway, and a prompt they have to dismiss every time is worse.
   */
  onBeforeLeave?: () => Promise<unknown> | void;
}

/** Sentinel for the "leaving" state — sign-out is not a plain href. */
const SIGN_OUT = "__signout__";

const NavRail = ({
  variant = "designer",
  clientHasProject,
  activeView,
  onNavigate,
  onBeforeLeave,
}: NavRailProps) => {
  const isClient = variant === "client";
  const links = isClient
    ? buildClientLinks(clientHasProject)
    : buildLinks();
  // Outside the Designer the current app link is highlighted instead of a step.
  const here =
    typeof window !== "undefined" ? window.location.pathname : "/";
  const user = AuthService.getCurrentUser();
  const [leavingTo, setLeavingTo] = React.useState<string | null>(null);

  const leave = async (e: React.MouseEvent, href: string) => {
    if (!onBeforeLeave) return; // no flush wired -> let the anchor do its job
    // Let the user open in a new tab / window normally.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (leavingTo) return; // already going
    setLeavingTo(href);
    try {
      await onBeforeLeave();
    } catch {
      // A failed save must not strand the user in the editor; the design is
      // still in local storage and will sync on next load.
    }
    window.location.href = href;
  };

  /**
   * Sign out. Mirrors AppHeader.handleLogout deliberately — clear the token,
   * then a FULL redirect with replace(): navigate() is a no-op when you are
   * already on the target route, and replace() keeps the logged-in page out of
   * history so Back cannot return to it.
   *
   * Unlike AppHeader's version this flushes the design first, because signing
   * out mid-edit would otherwise drop up to 5s of work with no way to recover
   * it — the local copy is cleared along with the token.
   */
  const signOut = async () => {
    if (leavingTo) return;
    setLeavingTo(SIGN_OUT);
    try {
      await onBeforeLeave?.();
    } catch {
      // Never trap the user in the editor because a save failed.
    }
    AuthService.signOut();
    window.location.replace(
      `${process.env.REACT_APP_PAZL_INSPIRE_URL}/signin`
    );
  };

  // Is this link the page we are on?
  //
  // The path alone is not enough for a client: "Uploaded images" and "Project
  // workspace" are the SAME path (/project-detail) and differ only by ?tab=.
  // Comparing paths would light both at once, so when a link carries a tab the
  // current tab has to match as well.
  const hereTab =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tab")
      : null;

  const isHere = (href: string) => {
    if (variant === "designer") return false; // a step is active, not a link
    const [path, query] = href.split("?");
    const linkTab = query ? new URLSearchParams(query).get("tab") : null;
    if (path === "/") return here === "/" || here === "/projects";
    const samePath = here === path || here.startsWith(path + "/");
    if (!samePath) return false;
    // No tab on the link: match the path, but don't claim a page that IS on a
    // tab belonging to a sibling link.
    return linkTab ? hereTab === linkTab : true;
  };

  return (
  <nav
    className="pz-nav"
    aria-label={isClient ? "Your project" : "Design steps"}
  >
    {/* The brand tile used to sit here, linking to "/" with the tooltip
        "back to dashboard" — which is precisely what the Dashboard item just
        below already does. Two controls with one destination, so it went. */}

    {/* App-level destinations first — these LEAVE the project. */}
    <div className="pz-nav-links">
      {links.map((l) => (
        <a
          key={l.href}
          className={`pz-nav-i ${leavingTo === l.href ? "is-leaving" : ""} ${
            isHere(l.href) ? "is-active" : ""
          }`}
          href={l.href}
          title={leavingTo === l.href ? "Saving…" : l.label}
          onClick={(e) => leave(e, l.href)}
        >
          {l.icon}
          <span className="pz-nav-label">{l.label}</span>
        </a>
      ))}
    </div>

    {/* Below the divider: the four views OF this project, in work order.
        Shown for staff so the rail keeps its shape between the Designer and the
        app, disabled outside the editor where there is no open project.

        Omitted ENTIRELY for a client: these are views inside the 3D editor,
        which a client never opens, so for them the four would not be "disabled
        for now" — they would be four buttons that can never work. */}
    <ul className="pz-nav-list" hidden={isClient}>
      {(isClient ? [] : STEPS).map((s) => {
        const inDesigner = variant === "designer";
        const isActive = inDesigner && activeView === s.key;
        return (
          <li key={s.key}>
            <button
              type="button"
              className={`pz-nav-i ${isActive ? "is-active" : ""} ${
                inDesigner ? "" : "is-disabled"
              }`}
              title={inDesigner ? s.label : `${s.label} — open a project first`}
              aria-current={isActive ? "page" : undefined}
              disabled={!inDesigner}
              onClick={() => inDesigner && onNavigate?.(s.key)}
            >
              {s.icon}
              <span className="pz-nav-label">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ul>

    {/* Pinned to the bottom: who you are, and the way out. */}
    <div className="pz-nav-account">
      <span className="pz-nav-avatar" title={user?.email || "Signed in"}>
        {(user?.email || "?").trim().charAt(0).toUpperCase() || "?"}
      </span>
      <button
        type="button"
        className={`pz-nav-i ${leavingTo === SIGN_OUT ? "is-leaving" : ""}`}
        title={
          user?.email ? `Sign out (${user.email})` : "Sign out"
        }
        onClick={signOut}
      >
        <Svg>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </Svg>
        <span className="pz-nav-label">Sign out</span>
      </button>
    </div>
  </nav>
  );
};

export default NavRail;
