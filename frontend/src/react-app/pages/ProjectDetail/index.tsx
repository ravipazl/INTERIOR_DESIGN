import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Project } from "@pazl/entities/Project";
import { ProjectsService } from "@pazl/services/projectsService";
import Loader from "@pazl/components/Loader";
import "./index.css";
import { ProjectStatuses } from "@pazl/pages/ProjectDashboard";
import ShareProjectModal from "@pazl/components/ShareProjectModal";
import CreateProjectModal from "@pazl/components/CreateProjectModal";
import ProjectWorkspace from "@pazl/components/ProjectWorkspace";
import ProjectTracker from "@pazl/components/ProjectTracker";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import ConfirmDeleteProjectModal from "./ConfirmDeleteProjectModel";
import ConfirmCloneProjectModal from "./ConfirmCloneProjectModal";
import { AuthService } from "@pazl/services/authService";
import { UserPermission } from "@pazl/entities/User";
import NotFound from "@pazl/components/NotFound";
import Toast, { ToastState } from "@pazl/components/Toast";

const ProjectDetail = () => {
  const navigate = useNavigate();
  const [isDarkMode, setIsDarkMode] = useState(
    localStorage.getItem("isDarkMode") === "true" || false
  );
  const currentUser = AuthService.getCurrentUser();
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const projectId = params?.id ?? project?._id;
  const [isLoading, setIsLoading] = useState(false);
  // Bumped whenever the team advances a stage in the Tracker tab, so the
  // "Track your project" card at the top re-fetches and updates live.
  const [trackerRefresh, setTrackerRefresh] = useState(0);
  // Clicking a step in the tracker filters the Project Workspace to that step.
  const [workspaceStage, setWorkspaceStage] = useState("");
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [showCloneConfirmModal, setShowCloneConfirmModal] = useState(false);
  const [isCloneProject, setIsCloneProject] = useState(false);
  const [projectShareId, setProjectShareId] = useState("");
  // Shared app toast (same look as TrackerAdmin / RenderHistory) — replaces the
  // native alert() this screen used, so feedback matches the rest of the app.
  const [toast, setToast] = useState<ToastState>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  // In-flight flags so the Accept / Close buttons visibly show they're working
  // (and can't be double-clicked) while the request is running.
  const [accepting, setAccepting] = useState(false);
  const [closing, setClosing] = useState(false);
  const isAccessibleToEdit3dDesign =
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN ||
    (currentUser?.permissions === UserPermission.ARCHITECT &&
      currentUser?._id === project?.architectUserId) ||
    (currentUser?.permissions === UserPermission.USER &&
      (currentUser?._id === project?.ownerUserId ||
        project?.sharedUserIDs?.some((id) => id === currentUser?._id)));
  const isAccessibleToEditDeleteProject =
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN ||
    currentUser?._id === project?.ownerUserId;
  // The Tracker tab is the TEAM control panel. Only the team may see/use it:
  // admins, super-admins, and the architect assigned to THIS project. Clients
  // (USER) get only the read-only "Track your project" card above.
  const canManageTracker =
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN ||
    (currentUser?.permissions === UserPermission.ARCHITECT &&
      currentUser?._id === project?.architectUserId);

  useEffect(() => {
    setIsLoading(true);
    getProject();
  }, [projectId]);

  const getProject = async () => {
    try {
      if (projectId) {
        const resp = await ProjectsService.getProjectById(projectId);
        if (resp) {
          setProject(resp);
        }
      }
    } catch (e) {
      // Project not in the design backend (e.g. an Inspire-only project) → the
      // fetch 404s. Don't hang the loader; fall through to the not-found view.
      console.error("ProjectDetail.getProject failed", e);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem("isDarkMode", newMode.toString());
  };

  const getProjectStatus = (status: string | undefined) => {
    const statusLabel = ProjectStatuses.find(
      (proStatus) => proStatus.value === status
    )?.label;
    return statusLabel;
  };

  const getColorForStatus = (status: string | undefined) => {
    switch (status) {
      case "open":
        return "#ffbe26";
      case "quotation_requested":
        return "#dc3545";
      case "quotation_pending_approval":
        return "#f59e0b";
      case "quotation_sent":
        return "#198754";
      case "quotation_accepted":
        return "#0ea5e9";
      case "quotation_rejected":
        return "#dc3545";
      case "closed":
        return "#888";
      default:
        return "#888";
    }
  };

  const getProjectCreatedDate = (date: Date | undefined) => {
    if (date) {
      const datetime = new Date(date);
      return (
        datetime.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }) +
        ", " +
        datetime.toLocaleTimeString("en-GB", {
          hour: "numeric",
          minute: "numeric",
          hour12: true,
        })
      );
    }
  };

  const navigateTo3dDesignScreen = () => {
    navigate(`/draw?projectId=${projectId}`);
  };

  const navigateToPazlInspire = () => {
    // Use the env-configured Inspire base (localhost in dev, the live domain in
    // prod) instead of a hardcoded URL, matching ShareProjectModal / ProtectedRoute.
    window.location.href = `${process.env.REACT_APP_PAZL_INSPIRE_URL}/project-detail/${projectId}`;
  };

  const handleShareProject = () => {
    if (project) setProjectShareId(project.shareId);
  };

  const handleDeleteProject = async () => {
    if (project) {
      const response = await ProjectsService.deleteProject(project._id);
      console.debug("Deleting project response", response);
      if (response) {
        // Go straight to the dashboard, NOT handleGoBack() — history.back()
        // could return to a now-stale view of the project we just deleted.
        navigate("/");
      }
    }
  };

  const handleCloneProject = async () => {
    setShowCloneConfirmModal(false);
    setIsCloneProject(true);
    setShowEditProjectModal(true);
  };

  const handleEditProjectComplete = (project: Project) => {
    if (project) {
      setShowEditProjectModal(false);
      setProject(project);
    }
  };

  const handleCreateProjectComplete = (project: Project) => {
    if (project) {
      setShowEditProjectModal(false);
      navigate(`/project-detail/${project._id}`);
    }
  };

  // Where the back arrow goes. This page is reached two different ways:
  //   1. from inside this app (dashboard → project)      → "/" is correct
  //   2. from Inspire, via a full cross-origin navigation → must return there
  // Case 2 used to land on this app's dashboard, a page the user was never on,
  // because navigate() is React Router and can only move within this origin.
  // Inspire now passes ?from=<its url>, so the arrow can go back where it came
  // from — matching what the browser's own Back button does on this screen.
  //
  // ?from= is just a query param, so it is attacker-controllable: honouring it
  // blindly would be an open redirect (…/project-detail/x?from=https://evil).
  // It is therefore only accepted when it resolves to this origin or the
  // configured Inspire origin.
  const resolveBackTarget = (): string | null => {
    const from = new URLSearchParams(window.location.search).get("from");
    if (!from) return null;
    try {
      // Absolute URLs only. Parsing with a base would turn any junk string into
      // a same-origin path ("abc" → /abc, a 404), which is worse than the
      // fallback. Inspire always sends an absolute URL.
      const target = new URL(from);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return null;
      }
      const allowed = [window.location.origin];
      const inspire = process.env.REACT_APP_PAZL_INSPIRE_URL;
      if (inspire) allowed.push(new URL(inspire).origin);
      return allowed.includes(target.origin) ? target.href : null;
    } catch {
      return null; // malformed ?from= → ignore it and use the fallback
    }
  };

  // Capture the Inspire return target ONCE, on entry. The designer is launched
  // from Inspire with ?login=&email= (and, on newer Inspire builds, an explicit
  // ?from=<inspire url>). Internal navigation between this page and the 3D
  // editor (/draw) drops those params AND stacks 3031 entries onto the browser
  // history — so later neither the URL nor history.back() can return to Inspire:
  // history.back() just ping-pongs between /project-detail and /draw. Recording
  // the target on the first entry makes the back arrow reliable no matter how
  // much internal navigation happened in between.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const validFrom = resolveBackTarget(); // validated ?from=, or null
    if (validFrom) {
      sessionStorage.setItem("pazl-return-to", validFrom);
    } else if (
      (params.has("login") || params.has("from")) &&
      process.env.REACT_APP_PAZL_INSPIRE_URL
    ) {
      // Came from Inspire but without an explicit page → its project list.
      sessionStorage.setItem(
        "pazl-return-to",
        `${process.env.REACT_APP_PAZL_INSPIRE_URL}/projects`
      );
    }
    // Only the FIRST entry carries the params; a bare remount (after visiting
    // the 3D editor) must NOT clobber what we stored, so run once and never
    // overwrite with an empty value above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoBack = () => {
    // Use the target captured on entry: it reliably escapes to Inspire even
    // after internal /project-detail <-> /draw navigation, and never loops.
    const stored = sessionStorage.getItem("pazl-return-to");
    if (stored) {
      window.location.href = stored;
      return;
    }
    // Nothing recorded → this tab never came from Inspire (opened straight from
    // the designer's own dashboard). Go there.
    navigate("/");
  };

  // Client accepts the sent quote → 'quotation_accepted' (notifies the admin).
  const handleAcceptQuote = async () => {
    if (!project?._id || accepting) return;
    setAccepting(true);
    try {
      const resp = await ProjectsService.updateProject(project._id, {
        status: "quotation_accepted",
      });
      if (resp) {
        setProject(resp);
        setToast({ type: "success", text: "Quotation accepted. The admin has been notified." });
      } else {
        setToast({ type: "error", text: "Could not accept the quotation. Please try again." });
      }
    } finally {
      setAccepting(false);
    }
  };

  // Admin closes the project after the client accepted → 'closed'
  // (notifies the client + architect).
  const handleCloseProject = async () => {
    if (!project?._id || closing) return;
    setClosing(true);
    try {
      const resp = await ProjectsService.updateProject(project._id, {
        status: "closed",
      });
      if (resp) {
        setProject(resp);
        setToast({ type: "success", text: "Project closed. The client and architect were notified." });
      } else {
        setToast({ type: "error", text: "Could not close the project. Please try again." });
      }
    } finally {
      setClosing(false);
    }
  };

  if (!isLoading && !isAccessibleToEdit3dDesign) {
    return (
      <div className={`${isDarkMode ? "dark" : "light"}`}>
        <NotFound />
      </div>
    );
  }

  return (
    <div className={`${isDarkMode ? "dark" : "light"}`}>
      <Toast toast={toast} />
      {isLoading || !project ? (
        <Loader />
      ) : (
        <div className="projects-detail-container dark:bg-[#333333]">
          <div>
            <div className="block bg-white m-2 text-surface shadow-secondary-1 dark:bg-surface-dark dark:text-white rounded">
              <div className="title-flex-container dark:bg-[#333333]">
                <h1 className="title dark:bg-[#333333] dark:text-[#FFFFFF] flex flex-row">
                  <img
                    className="back-button"
                    alt="back"
                    style={{ marginTop: "4px" }}
                    src={require("../../images/back2.svg")}
                    onClick={handleGoBack}
                  />
                  Project Detail
                </h1>
                <div className="create-project-flex-container gap-2">
                  <span
                    className="material-symbols-outlined mx-2 cursor-pointer"
                    style={{ color: "#333333" }}
                    onClick={handleShareProject}
                  >
                    share
                  </span>
                  {isAccessibleToEditDeleteProject ? (
                    <span
                      className="material-symbols-outlined mx-2 cursor-pointer"
                      style={{ color: "#444444" }}
                      onClick={() => {
                        setShowEditProjectModal(true);
                      }}
                    >
                      border_color
                    </span>
                  ) : null}
                  {isAccessibleToEditDeleteProject ? (
                    <span
                      className="material-symbols-outlined mx-2 cursor-pointer"
                      style={{ color: "#333333" }}
                      onClick={() => {
                        setShowDeleteConfirmModal(true);
                      }}
                    >
                      delete
                    </span>
                  ) : null}
                  <span
                    className="material-symbols-outlined mx-2 cursor-pointer"
                    style={{ color: "#333333" }}
                    onClick={() => {
                      setShowCloneConfirmModal(true);
                    }}
                  >
                    content_copy
                  </span>
                  <button
                    className="ml-1.5 px-6 py-2 rounded border border-[#414063]"
                    onClick={navigateToPazlInspire}
                  >
                    <p className="project-detail-button-text text-[#414063]">
                      View AI Inspiration
                    </p>
                  </button>
                  {isAccessibleToEdit3dDesign ? (
                    <button
                      className="ml-1.5 px-6 py-2 rounded bg-[#414063]"
                      onClick={navigateTo3dDesignScreen}
                    >
                      <p className="project-detail-button-text text-[#FFFFFF]">
                        Edit 3D Design
                      </p>
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-row items-start justify-start px-5 pt-4 pb-8 gap-8 dark:bg-[#333333] shadow-md shadow-[#00000026]">
                <div className="flex flex-col gap-1 border-e border-[#4C4C4C4C] pe-6 min-w-[300px]">
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Project Name :
                    <span className="font-normal pl-3">
                      {project?.name ? capitalizeText(project.name) : "N/A"}
                    </span>
                  </p>
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Created Date :
                    <span className="font-normal pl-3">
                      {getProjectCreatedDate(project?.createdAt)}
                    </span>
                  </p>
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Created By :
                    <span className="font-normal pl-3">
                      {project?.ownerUser?.name
                        ? capitalizeText(project.ownerUser.name)
                        : "N/A"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-col gap-1 border-e border-[#4C4C4C4C] pe-6 min-w-[300px]">
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Client Name :
                    <span className="font-normal pl-3">
                      {project?.clientName
                        ? capitalizeText(project.clientName)
                        : project?.ownerUser?.name
                        ? capitalizeText(project.ownerUser.name)
                        : "N/A"}
                    </span>
                  </p>
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Client Phone Number :
                    <span className="font-normal pl-3">
                      {project?.clientPhoneNumber
                        ? project.clientPhoneNumber
                        : (project?.ownerUser as any)?.phoneNumber ||
                          (project?.ownerUser as any)?.phone ||
                          "N/A"}
                    </span>
                  </p>
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Client Email Id :
                    <span className="font-normal pl-3">
                      {project?.clientEmail
                        ? project.clientEmail
                        : project?.ownerUser?.email || "N/A"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-col gap-1 min-w-[300px]">
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Address :
                    <span className="font-normal pl-3">
                      {project?.address ? project.address : "N/A"}
                    </span>
                  </p>
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Status :
                    <span
                      className="font-normal pl-3"
                      style={{
                        color: getColorForStatus(project?.status),
                      }}
                    >
                      {getProjectStatus(project?.status)}
                    </span>
                  </p>
                  <p className="font-semibold text-sm text-[#414063] py-1">
                    Architect :
                    <span className="font-normal pl-3">
                      {project?.architectUser?.name
                        ? capitalizeText(project.architectUser.name)
                        : "N/A"}
                    </span>
                  </p>
                </div>
              </div>
            </div>
            {/* Client Project Tracker — a live "pizza-tracker" of the project's
                journey, shown right under the project info. */}
            <ProjectTracker
              projectId={projectId}
              status={project?.status}
              refreshKey={trackerRefresh}
              activeStage={workspaceStage}
              projectCreatedAt={(project as any)?.createdAt}
              onStepClick={(key) => {
                // Toggle: click the active step again to clear the filter.
                setWorkspaceStage((cur) => (cur === key ? "" : key));
                document
                  .getElementById("project-workspace")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
            {/* Quote acceptance → close flow. The client accepts the sent quote;
                then (and ONLY then) the admin can close the project. */}
            {project?.status === "quotation_sent" &&
              !project?.changeRequestPending &&
              currentUser?.permissions === UserPermission.USER && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 m-2 px-4 py-3 rounded"
                  style={{ background: "#eef6ff", border: "1px solid #d6e4f5" }}
                >
                  <span className="text-sm text-[#1f2033]">
                    Your quotation is ready — please review and accept it.
                  </span>
                  <button
                    className="px-6 py-2 rounded text-white disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: "#059669" }}
                    onClick={handleAcceptQuote}
                    disabled={accepting}
                  >
                    {accepting ? "Accepting…" : "Accept Quote"}
                  </button>
                </div>
              )}
            {/* Change requested on a sent quote → Accept is hidden until the admin
                sends a revised quotation, which clears changeRequestPending. */}
            {project?.status === "quotation_sent" &&
              project?.changeRequestPending &&
              currentUser?.permissions === UserPermission.USER && (
                <div
                  className="m-2 px-4 py-3 rounded text-sm"
                  style={{
                    background: "#fff7ed",
                    border: "1px solid #fed7aa",
                    color: "#9a3412",
                  }}
                >
                  Your change request has been received. A revised quotation will
                  be sent shortly — you can accept it once it arrives.
                </div>
              )}
            {project?.status === "quotation_accepted" &&
              currentUser?.permissions === UserPermission.USER && (
                <div
                  className="m-2 px-4 py-3 rounded text-sm"
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    color: "#166534",
                  }}
                >
                  ✓ You have accepted the quotation. The team will finalise and
                  close the project.
                </div>
              )}
            {project?.status === "quotation_accepted" &&
              (currentUser?.permissions === UserPermission.ADMIN ||
                currentUser?.permissions === UserPermission.SUPER_ADMIN) && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 m-2 px-4 py-3 rounded"
                  style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}
                >
                  <span className="text-sm text-[#1f2033]">
                    The client has accepted the quote. You can now close the
                    project.
                  </span>
                  <button
                    className="px-6 py-2 rounded text-white disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: "#414063" }}
                    onClick={handleCloseProject}
                    disabled={closing}
                  >
                    {closing ? "Closing…" : "Close Project"}
                  </button>
                </div>
              )}
            {project?.status === "quotation_rejected" &&
              currentUser?.permissions === UserPermission.USER && (
                <div
                  className="m-2 px-4 py-3 rounded text-sm"
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                  }}
                >
                  You've declined this quotation. The team has been notified and
                  will send a revised quote or close the project.
                </div>
              )}
            {project?.status === "quotation_rejected" &&
              (currentUser?.permissions === UserPermission.ADMIN ||
                currentUser?.permissions === UserPermission.SUPER_ADMIN) && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 m-2 px-4 py-3 rounded"
                  style={{ background: "#fef2f2", border: "1px solid #fecaca" }}
                >
                  <span className="text-sm text-[#1f2033]">
                    The client rejected the quote. Send a revised quotation from
                    the workspace below, or close the project.
                  </span>
                  <button
                    className="px-6 py-2 rounded text-white disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: "#414063" }}
                    onClick={handleCloseProject}
                    disabled={closing}
                  >
                    {closing ? "Closing…" : "Close Project"}
                  </button>
                </div>
              )}
            {project?.status === "closed" && (
              <div
                className="m-2 px-4 py-3 rounded text-sm"
                style={{
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  color: "#374151",
                }}
              >
                ✓ This project is completed and closed.
              </div>
            )}
            <div id="project-workspace" className="mt-4 border-t border-[#e5e7eb] pt-2">
              <h2 className="text-lg font-semibold text-[#414063] px-4">
                Project Workspace
              </h2>
              <ProjectWorkspace
                projectId={projectId}
                status={project?.status}
                canManageTracker={canManageTracker}
                projectCreatedAt={(project as any)?.createdAt}
                clientEmail={
                  (project as any)?.clientEmail ||
                  (project as any)?.ownerUser?.email
                }
                filterStage={workspaceStage}
                onClearFilter={() => setWorkspaceStage("")}
                onChangeRequest={() => {
                  getProject();
                  setTrackerRefresh((k) => k + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}
      {showEditProjectModal && project ? (
        <CreateProjectModal
          onClose={() => {
            setShowEditProjectModal(false);
          }}
          editingProject={project}
          onCreateComplete={handleCreateProjectComplete}
          onEditComplete={handleEditProjectComplete}
          isDarkMode={isDarkMode}
          isCloneProject={isCloneProject}
        />
      ) : null}
      {projectShareId && project ? (
        <ShareProjectModal
          shareId={projectShareId}
          onClose={() => setProjectShareId("")}
          isDarkMode={isDarkMode}
          project={project}
          refetchProject={getProject}
        />
      ) : null}
      <ConfirmDeleteProjectModal
        showDeleteConfirmModal={showDeleteConfirmModal}
        setShowDeleteConfirmModal={setShowDeleteConfirmModal}
        handleDeleteProject={handleDeleteProject}
        isDarkMode={isDarkMode}
      />
      <ConfirmCloneProjectModal
        showCloneConfirmModal={showCloneConfirmModal}
        setShowCloneConfirmModal={setShowCloneConfirmModal}
        handleCloneProject={handleCloneProject}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

export default ProjectDetail;
