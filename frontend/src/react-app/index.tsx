import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import ErrorBoundary from "./errorBoundary";
import { LoaderProvider } from "@pazl/context/loaderContext";
import { SyncService } from "./services/syncService";
import { LocalDBManager } from "./services/LocalDBManager";

// Light theme only. Dark mode has been retired — lock the stored flag to
// "false" before anything renders or the canvas initialises, so the whole app
// (and the 2D/3D canvas, which reads this flag directly) is always light.
localStorage.setItem("isDarkMode", "false");

const resetLocalDB = async () => {
  console.debug(
    "index.tsx ~ resetLocalDB ~ sync the existing data in localDB into server"
  );
  await SyncService.syncToDB();
  const localDB = new LocalDBManager();
  await localDB.initLocalDB(true);
};

resetLocalDB();

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  /*   <React.StrictMode> */
  <ErrorBoundary>
    <LoaderProvider>
      <App />
    </LoaderProvider>
  </ErrorBoundary>
  /*   </React.StrictMode> */
);
