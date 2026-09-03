import React, { useEffect, useContext, useState } from "react";
import DashboardProvider from "./context/dashboardContext";
import Router from "./routes/router";
import "tw-elements-react/dist/css/tw-elements-react.min.css";
import "@fontsource/source-sans-pro"; // Defaults to weight 400
import "material-symbols";
import "../css/styles.css";
import { SyncService } from "./services/syncService";
import LoaderContext from "@pazl/context/loaderContext";

// How often the browser pushes its local copy of the design to the server.
//
// Edits are written to the browser's local database first (FloorPlan.update ->
// updateToLocalDB); this timer is what actually gets them onto the server. So it
// sets how long the architect's work stays invisible to everyone else: at 60s a
// model added just after a tick took a full minute to reach the admin, on top of
// the admin list's own 5s refresh.
//
// 5s makes a change visible to the admin in well under ten seconds.
//
// TRADE-OFF, worth knowing: each tick uploads the WHOLE scene (~128 KB here) and
// the backend then reconciles — it switches off any model the incoming scene
// does not list (sync.class.js). A page holding a stale scene therefore deletes
// newer work on its next tick, so at 5s that happens almost immediately rather
// than up to a minute later. Reload before editing a project someone else may
// have touched.
const timeIntervalToSyncLocalDBToDB = 5 * 1000; // 5 seconds

const App = () => {
  const { isLoading } = useContext(LoaderContext);
  const [isErrorSyncing, setIsErrorSyncing] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState("");

  useEffect(() => {
    setLastSavedTime(new Date().toLocaleTimeString());
    let intervalId = setInterval(syncLocalToDB, timeIntervalToSyncLocalDBToDB);
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const syncLocalToDB = async () => {
    const isSynced = await SyncService.syncToDB();
    if (isSynced) {
      setLastSavedTime(new Date().toLocaleTimeString());
      setIsErrorSyncing(false);
    } else {
      setIsErrorSyncing(true);
      setTimeout(() => {
        setIsErrorSyncing(false);
      }, 9000);
    }
  };

  return (
    <>
      {isLoading ? <div className="loading">Loading</div> : null}
      <DashboardProvider>
        <Router
          lastSavedTime={lastSavedTime}
          isErrorSyncing={isErrorSyncing}
          handleSync={syncLocalToDB}
        />
      </DashboardProvider>
    </>
  );
};

export default App;
