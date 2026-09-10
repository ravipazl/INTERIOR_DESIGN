import React, { useContext } from "react";
import AppHeader from "../../components/AppHeader";
import Steppers from "../../components/Steppers";
import NavRail from "@pazl/components/NavRail";
import ProjectContext from "../../context/ProjectContext";
import "./index.css";

/**
 * Upload room images for a project.
 *
 * This was the client's landing and the start of the old upload-then-request-a-
 * quote journey. Clients now land on the projects dashboard and work the way an
 * architect does, so this page is one screen among several rather than the
 * whole flow, and it carries the SAME rail as every other page (variant="app").
 *
 * Laid out with the shared .pz-app-shell / .pz-app-main classes, the same as
 * Projects, Teams and Rate card. That is not just for consistency: the shell
 * pins the rail with `position: sticky; height: 100vh`, which is what keeps the
 * account and sign-out block at the bottom of the SCREEN. Sizing the rail by
 * the page instead (a plain flex row with min-height) lets it grow with the
 * content, and the sign-out button ends up below the fold where it cannot be
 * clicked — which is exactly what happened before this used the shell.
 *
 * The rail is also the FIRST child on purpose: it is fixed-width and
 * full-height, so anything rendered ahead of it pushes it off the left edge.
 */
const Dashboard = (user) => {
  const { currentProject } = useContext(ProjectContext);

  return (
    <div className="pz-app-shell">
      {/* The rail's project items appear as soon as a project exists. A sidebar
          whose items come and go as the status changes is harder to trust than
          one that stays put. */}
      {/* Same rail as staff - see the note in ProjectDetail. */}
      <NavRail variant="app" />
      <div className="pz-app-main">
        <AppHeader user={user} />
        <Steppers />
      </div>
    </div>
  );
};

export default Dashboard;
