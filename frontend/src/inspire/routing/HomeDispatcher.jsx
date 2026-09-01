import React, { useContext, useEffect } from "react";
import { Spinner } from "react-bootstrap";
import UserContext from "../context/UserContext";
import { USER_ROLES } from "../utils/constants";
import { getCurrentUser } from "../services/authService";
import AdminDashboard from "../pages/Dashboard/AdminDashboard";
import Home from "../pages/Home";

// The "receptionist" for the app's single entry point, "/".
//
// Every role and every home/after-login navigation lands here, and this ONE
// place decides what each person sees — so the "which landing does this role
// get?" rule lives in exactly one spot instead of being copied across SignIn,
// the header logo, etc. (which is how an architect ended up sent to the
// client-only /dashboard and hit the NotFound page).
//
//   • admin / super-admin / architect → the admin dashboard (rendered here)
//   • client (USER)                    → Home, which routes them on by their
//                                        own project data (to their designs,
//                                        the upload step, or the landing)
const HomeDispatcher = () => {
  const { currentUser } = useContext(UserContext);
  // Fall back to the persisted user so a hard refresh on "/" doesn't flash the
  // wrong view before the React context re-hydrates from storage.
  const user = currentUser || getCurrentUser();

  // Keep the Back button from leaving the app at the landing. We drop a sentinel
  // history entry on top of "/"; if the user presses Back while here, popstate
  // fires and we push it again — so Back can never step out to the external page
  // (e.g. Google) or the login page. Pages opened by a click still Back normally
  // (they return here); this guard only runs while the "/" landing is shown, so
  // it blocks ONLY the final step that would exit the app.
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Still figuring out who this is — wait rather than guess a destination.
  if (!user) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ height: "60vh" }}
      >
        <Spinner animation="border" />
      </div>
    );
  }

  const isAdminLike =
    user.permissions === USER_ROLES.ADMIN ||
    user.permissions === USER_ROLES.SUPER_ADMIN ||
    user.permissions === USER_ROLES.ARCHITECT;

  return isAdminLike ? <AdminDashboard /> : <Home />;
};

export default HomeDispatcher;
