import React, { useEffect, useContext, useState } from "react";
import DashboardProvider from "./context/dashboardContext";
import Router from "./routes/router";
import "tw-elements-react/dist/css/tw-elements-react.min.css";
import "@fontsource/source-sans-pro"; // Defaults to weight 400
import "material-symbols";
import "../css/styles.css";
import { SyncService } from "./services/syncService";
import LoaderContext from "@pazl/context/loaderContext";

const timeIntervalToSyncLocalDBToDB = 60 * 1000; // 60 seconds

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
