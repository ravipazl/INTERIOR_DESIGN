// Boots the Inspire app (formerly pazl-ai-frontend/src/index.js).
// Rendered for every route that is NOT /design/*. Same global CSS + the
// UserRoleProvider wrapper the original CRA entry used.
import React from "react";
import InspireApp from "./inspire/App";
import { UserRoleProvider } from "./inspire/context/UserRoleContext";
import "bootstrap/dist/css/bootstrap.min.css";
import "@fontsource/poppins";
import "@fontsource/source-sans-pro";
import "./inspire/index.css";
import "./inspire/custom.scss";
import "react-super-responsive-table/dist/SuperResponsiveTableStyle.css";
import "react-perfect-scrollbar/dist/css/styles.css";
import "react-toastify/dist/ReactToastify.css";

export function renderInspire(root) {
  root.render(
    <UserRoleProvider>
      <InspireApp />
    </UserRoleProvider>
  );
}
