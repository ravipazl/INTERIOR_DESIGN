import React, { useContext } from "react";
import AppHeader from "../../components/AppHeader";
import Steppers from "../../components/Steppers";
import NavRail from "@pazl/components/NavRail";
import ProjectContext from "../../context/ProjectContext";
import "./index.css";

/**
 * The client's working page: upload room images, then request a quote.
 *
 * The rail carries the client's whole journey — "My rooms" here, and "Project
 * workspace" once a quote has been requested and there is something to follow.
 * Both come from the shared NavRail (variant="client"), so the client's sidebar
 * looks and behaves like the one on Projects, Teams and Rate card rather than
 * being a second thing to maintain.
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
      <NavRail variant="client" clientHasProject={!!currentProject?._id} />
      <div className="pz-app-main">
        <AppHeader user={user} />
        <Steppers />
      </div>
    </div>
  );
};

export default Dashboard;
