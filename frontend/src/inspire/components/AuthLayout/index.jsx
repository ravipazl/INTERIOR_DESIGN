import React from "react";
import pazlLogo from "../../assets/images/pazl_logo.svg";
import { BrandLogo, BrandName } from "@pazl/components/BrandLogo";
import livingRoom from "../../assets/images/livingroom.jpg";
import "./index.css";

/**
 * The frame of the Sign in and Sign up pages: Pazl over a real interior on
 * the left, the form on a card on the right. On a tablet in portrait or a
 * phone the panel shrinks to a band above the form.
 *
 * Only the look lives here. Each page keeps its own fields, checks and what
 * happens on submit.
 */
const STEPS = [
  "Draw your rooms, or upload a plan.",
  "Furnish them in 3D and see renders.",
  "Ask for a quote, room by room.",
];

const FEATURES = ["2D floor plans", "3D walkthroughs", "Room-by-room quotes"];

const Tick = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5 9-10" />
  </svg>
);

const AuthLayout = ({ mode = "signin", title, subtitle, children, footer }) => (
  <div className={`pz-auth pz-auth--${mode}`}>
    {/* A real interior behind an indigo wash: what Pazl makes, not a blank panel. */}
    <aside
      className="pz-auth-brand"
      aria-label="Pazl"
      style={{ "--pza-photo": `url(${livingRoom})` }}
    >
      <div className="pz-auth-logo">
        <BrandLogo fallback={pazlLogo} alt="" width="40" height="40" />
        <span>
          <BrandName fallback="Pazl" />
        </span>
      </div>

      {/* Over the photo, on its right: what the app does, as it would look. */}
      <div className="pz-auth-badges" aria-hidden="true">
        <div className="pz-auth-badge pz-auth-badge--alt">
          <span className="pz-auth-badge-tick is-indigo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 3 7v10l9 5 9-5V7z" />
              <path d="m3 7 9 5 9-5M12 12v10" />
            </svg>
          </span>
          <span>
            <strong>Walk through in 3D</strong>
            <small>Every room, before it is built</small>
          </span>
        </div>
        <div className="pz-auth-badge">
          <span className="pz-auth-badge-tick">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5 9-10" />
            </svg>
          </span>
          <span>
            <strong>Quote accepted</strong>
            <small>Living room · 3BHK</small>
          </span>
        </div>
      </div>

      {mode === "signup" ? (
        <div className="pz-auth-pitch">
          <h2>Your home, designed before a single nail goes in.</h2>
          <ol className="pz-auth-steps">
            {STEPS.map((step, i) => (
              <li key={step}>
                <span>{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="pz-auth-pitch">
          <h2>Plan it in 2D. Walk it in 3D. Quote it the same day.</h2>
          <p>One place for the floor plan, the furniture, the renders and the client's quote.</p>
          <ul className="pz-auth-features">
            {FEATURES.map((f) => (
              <li key={f}>
                <Tick />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>

    <main className="pz-auth-main">
      <div className="pz-auth-card">
        <div className="pz-auth-head">
          {/* Sign up's form is long: its room goes to the fields instead. */}
          {mode !== "signup" && (
            <BrandLogo className="pz-auth-mark" fallback={pazlLogo} alt="" width="44" height="44" />
          )}
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
        {footer ? <div className="pz-auth-foot">{footer}</div> : null}
      </div>
      <p className="pz-auth-legal">
        © {new Date().getFullYear()} <BrandName fallback="Pazl" />
      </p>
    </main>
  </div>
);

export default AuthLayout;
