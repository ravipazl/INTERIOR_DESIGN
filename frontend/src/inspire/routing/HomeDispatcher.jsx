import React, { useContext, useEffect } from "react";
import { Spinner } from "react-bootstrap";
import UserContext from "../context/UserContext";
import { getCurrentUser } from "../services/authService";
import AdminDashboard from "../pages/Dashboard/AdminDashboard";
// Home is no longer a post-login destination - it is the signed-out landing,
// routed directly. Import removed with the role branch that used it.

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

  // EVERY signed-in role lands on the projects dashboard, clients included.
  //
  // Clients used to get the upload-photo / request-quote wizard (Home). They
  // now work the way an architect does: open their own project and go floor
  // plan -> furnish -> render -> BOQ, which is what the landing page
  // advertises.
  //
  // Scoping is NOT done here, and does not need to be. limitProjectsToViewer
  // in backend/src/services/projects already restricts a non-admin to projects
  // where they are the owner, the architect, or a shared user - and it merges
  // into , so the five dashboard counters are scoped by the same rule as
  // the list. Filtering in the browser would be cosmetic; the data would
  // already have been sent.
  return <AdminDashboard />;
};

export default HomeDispatcher;
