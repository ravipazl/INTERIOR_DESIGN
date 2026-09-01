// Merged Interior Design frontend — single entry.
//
// One origin serves both apps:
//   /design/*  -> the 3D Designer (Three.js/Pixi) — loaded lazily, since it is
//                 heavy and only needed inside the editor.
//   everything else -> the Inspire app (login, dashboard, mood book, admin).
//
// Both apps read the SAME localStorage session (pazl-access-token /
// pazl-current-user), so logging in on the Inspire side carries straight into
// the Designer — no cross-app token handoff.
import ReactDOM from "react-dom/client";

const rootEl = document.getElementById("app") as HTMLElement;
const root = ReactDOM.createRoot(rootEl);

if (window.location.pathname.startsWith("/design")) {
  import("./design-boot").then((m) => m.renderDesign(root));
} else {
  import("./inspire-boot").then((m) => m.renderInspire(root));
}
