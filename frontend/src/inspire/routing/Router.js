import React, { useContext, useEffect } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { getProject } from "../services/projectService";
import { USER_ROLES } from "../utils/constants";
import UserContext from "../context/UserContext";
import ProjectContext from "../context/ProjectContext";
import ProjectDetail from "../pages/ProjectDetail";
import Dashboard from "../pages/Dashboard";
import SignIn from "../pages/SignIn";
import SignUp from "../pages/SignUp";
import SetPassword from "../pages/SetPassword";
import NotFound from "../pages/NotFound";
import ProtectedRoute from "./ProtectedRoute";
import HomeDispatcher from "./HomeDispatcher";
import Teams from "../pages/Dashboard/AdminDashboard/Teams";
import Projects from "../pages/Dashboard/AdminDashboard/Projects";
import RateCard from "../pages/RateCard";
import PublicQuote from "../pages/PublicQuote";

const Router = () => {
  const { currentUser } = useContext(UserContext);
  const { setCurrentProject } = useContext(ProjectContext);

  useEffect(() => {
    getCurrentUserAndProjectData();
  }, [currentUser]);

  const getCurrentUserAndProjectData = async () => {
    if (currentUser?._id && currentUser?.permissions === USER_ROLES.USER) {
      const projectResponse = await getProject(currentUser._id);
      if (projectResponse?.data?.length) {
        setCurrentProject(projectResponse?.data[0]);
      }
    }
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* PROTECTED ROUTES */}
        <Route
          exact
          path="/"
          element={
            <ProtectedRoute>
              <HomeDispatcher />
            </ProtectedRoute>
          }
        />
        {currentUser?.permissions === USER_ROLES.USER && (
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
        )}
        {/* Safety net: admin/super-admin/architect have NO /dashboard (it's a
            client-only page). If they land there anyway — a stale history entry,
            an old link, a mis-routed button — bounce them to "/" (their own
            dashboard) instead of showing the NotFound "Oops!" page. */}
        {currentUser &&
          currentUser?.permissions !== USER_ROLES.USER && (
            <Route
              path="/dashboard"
              element={<Navigate to="/" replace />}
            />
          )}
        {(currentUser?.permissions === USER_ROLES.USER ||
          currentUser?.permissions === USER_ROLES.ADMIN ||
          currentUser?.permissions === USER_ROLES.SUPER_ADMIN ||
          currentUser?.permissions === USER_ROLES.ARCHITECT) && (
          <Route
            path="/project-detail"
            element={
              <ProtectedRoute>
                <ProjectDetail />
              </ProtectedRoute>
            }
          />
        )}
        {(currentUser?.permissions === USER_ROLES.USER ||
          currentUser?.permissions === USER_ROLES.ADMIN ||
          currentUser?.permissions === USER_ROLES.SUPER_ADMIN ||
          currentUser?.permissions === USER_ROLES.ARCHITECT) && (
          <Route
            path="/project-detail/:id"
            element={
              <ProtectedRoute>
                <ProjectDetail />
              </ProtectedRoute>
            }
          />
        )}
        {(currentUser?.permissions === USER_ROLES.ADMIN ||
          currentUser?.permissions === USER_ROLES.SUPER_ADMIN) && (
          <Route
            path="/teams"
            element={
              <ProtectedRoute>
                <Teams />
              </ProtectedRoute>
            }
          />
        )}
        {/* Rate Card (Masters) — moved here from the design app (:3031). Admin
            only; the rows still live in the design backend. */}
        {(currentUser?.permissions === USER_ROLES.ADMIN ||
          currentUser?.permissions === USER_ROLES.SUPER_ADMIN) && (
          <Route
            path="/rate-card"
            element={
              <ProtectedRoute>
                <RateCard />
              </ProtectedRoute>
            }
          />
        )}
        {(currentUser?.permissions === USER_ROLES.ADMIN ||
          currentUser?.permissions === USER_ROLES.SUPER_ADMIN ||
          currentUser?.permissions === USER_ROLES.ARCHITECT) && (
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <Projects />
              </ProtectedRoute>
            }
          />
        )}

        {/* PUBLIC ROUTES */}
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signin" element={<SignIn />} />
        {/* Landing page for the emailed invite / password-reset link. Public:
            the token in the URL is the credential. */}
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/share/:id" element={<ProjectDetail />} />
        {/* Login-free client quote page from the emailed link. Public: the
            unguessable token in the URL is the credential. */}
        <Route path="/quote/:token" element={<PublicQuote />} />
        {/* Catch-all Route for 404 NOT FOUND */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export default Router;
