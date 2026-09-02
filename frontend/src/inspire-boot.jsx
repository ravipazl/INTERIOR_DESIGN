// Boots the Inspire app (formerly pazl-ai-frontend/src/index.js).
// Rendered for every route that is NOT /design/*. Same global CSS + the
// UserRoleProvider wrapper the original CRA entry used.
import React from "react";
import { StyleSheetManager } from "styled-components";
import isPropValid from "@emotion/is-prop-valid";
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

// Restores the prop filtering that styled-components v5 did automatically.
//
// v6 REMOVED that filtering, but react-data-table-component (7.7.1) still relies
// on it: it forwards its column options — minWidth, allowOverflow, button — into
// styled `div`s. Without filtering those reach the real DOM and React warns
//   "React does not recognize the `minWidth` prop on a DOM element"
// three times on every render of the Projects table. Its peer range is
// `styled-components >= 5.0.0`, so v6 installs cleanly and the mismatch only
// shows up at runtime.
//
// Filter for DOM elements ONLY (`typeof target === "string"`). Custom React
// components must keep receiving every prop — filtering those would break them.
const shouldForwardProp = (prop, target) =>
  typeof target === "string" ? isPropValid(prop) : true;

export function renderInspire(root) {
  root.render(
    <StyleSheetManager shouldForwardProp={shouldForwardProp}>
      <UserRoleProvider>
        <InspireApp />
      </UserRoleProvider>
    </StyleSheetManager>
  );
}
