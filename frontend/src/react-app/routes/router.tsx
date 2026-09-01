import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import DrawingComponent from "../pages/DrawingComponent";
import ProtectedRoute from "./ProtectedRoute";
import ProjectDashboard from "../pages/ProjectDashboard";
import ErrorBoundary from "../errorBoundary";
import NotFound from "@pazl/components/NotFound";
import ProjectDetail from "@pazl/pages/ProjectDetail";

interface RouterProps {
  lastSavedTime: string;
  isErrorSyncing: boolean;
  handleSync: () => void;
}

const Router = ({ lastSavedTime, isErrorSyncing, handleSync }: RouterProps) => {
  return (
    <BrowserRouter basename="/design">
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <ProjectDashboard />
              </ErrorBoundary>
            </ProtectedRoute>
          }
          errorElement={<NotFound />}
        />
        <Route
          path="/project-detail/:id"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <ProjectDetail />
              </ErrorBoundary>
            </ProtectedRoute>
          }
          errorElement={<NotFound />}
        />
        <Route
          path="/draw"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <DrawingComponent
                  lastSavedTime={lastSavedTime}
                  isErrorSyncing={isErrorSyncing}
                  handleSync={handleSync}
                />
              </ErrorBoundary>
            </ProtectedRoute>
          }
          errorElement={<NotFound />}
        />
        {/* /masters moved to the Inspire web app (:3000, route /rate-card). */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export default Router;
