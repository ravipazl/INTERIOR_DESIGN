// Boots the 3D Designer app (formerly pazl-design-frontend/src/react-app/index.tsx).
// Rendered only under /design/*. Carries over the original entry's side effects:
// force light mode and reconcile the local DB before the canvas initialises.
import React from "react";
import type { Root } from "react-dom/client";
import App from "./react-app/app";
import ErrorBoundary from "./react-app/errorBoundary";
import { LoaderProvider } from "@pazl/context/loaderContext";
import { SyncService } from "./react-app/services/syncService";
import { LocalDBManager } from "./react-app/services/LocalDBManager";

export async function renderDesign(root: Root) {
  // Light theme only (the 2D/3D canvas reads this flag directly).
  localStorage.setItem("isDarkMode", "false");
  try {
    await SyncService.syncToDB();
    const localDB = new LocalDBManager();
    await localDB.initLocalDB(true);
  } catch (e) {
    console.warn("[design-boot] localDB init failed", e);
  }
  root.render(
    <ErrorBoundary>
      <LoaderProvider>
        <App />
      </LoaderProvider>
    </ErrorBoundary>
  );
}
