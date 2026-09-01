import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import "bootstrap/dist/css/bootstrap.min.css";
import { UserRoleProvider } from "./context/UserRoleContext";
import '@fontsource/poppins';
import "@fontsource/source-sans-pro";
import './custom.scss';
import 'react-super-responsive-table/dist/SuperResponsiveTableStyle.css';

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <UserRoleProvider>
      <App />
    </UserRoleProvider>
  </React.StrictMode>
);
reportWebVitals();
