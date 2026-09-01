import React, { useContext, useEffect, useState } from "react";
import {
  Badge,
  Button,
  ButtonGroup,
  Col,
  Container,
  Nav,
  Navbar,
  Offcanvas,
  Row,
} from "react-bootstrap";
import NavDropdown from "react-bootstrap/NavDropdown";
import { useLocation, useNavigate } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import FavoriteIcon from "../../assets/images/fav_icon.svg";
import HistoryIcon from "../../assets/images/history_icon.svg";
import Logout from "../../assets/images/logout.svg";
import pazlLogo from "../../assets/images/pazl_logo.svg";
import Profile from "../../assets/images/profile_avatar.svg";
import Share from "../../assets/images/share_icon.svg";
import { CountContext } from "../../context/CountContext";
import ProjectContext from "../../context/ProjectContext";
import { StepperContext } from "../../context/StepperContext";
import UserContext from "../../context/UserContext";
import ServiceContext from "../../context/ServiceContext";
import { signOut } from "../../services/authService";
import { getGeneratedImages } from "../../services/imagesService";
import {
  updateProject,
  getProjectsByStatus,
  getProject,
  getAllProjects,
  markQuoteRequestRead,
  markAssignmentRead,
  markArchitectUpdateRead,
} from "../../services/projectService";
// Pending client change requests live on the DESIGN backend (changeRequestPending);
// this returns the set of project ids currently awaiting a revised quote.
import { getChangeRequestedProjectIds } from "../../services/projectWorkspaceService";
// Same icon pack already used elsewhere in the app (e.g. Teams.jsx CloseIcon).
import NotificationsIcon from "@mui/icons-material/Notifications";
import { USER_ROLES } from "../../utils/constants";
import Title from "../AppHeaderTitle";
import ShareModal from "../ShareModal";
import "./index.css";
import Dropdown from 'react-bootstrap/Dropdown';
import DropdownButton from 'react-bootstrap/DropdownButton';
import SplitButton from 'react-bootstrap/SplitButton';


const AppHeader = ({ user, showLogo, isGuestUser }) => {
  const { activeStep } = useContext(StepperContext);
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useContext(UserContext);
  const { currentProject } = useContext(ProjectContext);
  const { authService, imagesService } = useContext(ServiceContext);
  const { historyStatus, favoriteStatus, setHistoryStatus, setFavoriteStatus } =
    useContext(CountContext);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isheaderMobile, setIsHeaderMobile] = useState(window.innerWidth < 992);
  // Quotation requests shown in the header bell dropdown. A notification is
  // just a project awaiting a quote — no separate notifications collection.
  // Unread = never read, or read BEFORE the latest request on that project.
  const [quoteNotifications, setQuoteNotifications] = useState([]);
  const isUnread = (p) =>
    !p.quoteRequestReadAt ||
    (p.quoteRequestedAt &&
      new Date(p.quoteRequestReadAt) < new Date(p.quoteRequestedAt));
  const quoteRequestCount = quoteNotifications.filter(isUnread).length;

  // Architect bell: projects assigned to the logged-in architect. Same shape as
  // the admin quote bell, keyed on the architect fields instead.
  const [assignmentNotifications, setAssignmentNotifications] = useState([]);
  const isAssignmentUnread = (p) =>
    !p.architectAssignmentReadAt ||
    (p.architectAssignedAt &&
      new Date(p.architectAssignmentReadAt) < new Date(p.architectAssignedAt));
  const assignmentCount = assignmentNotifications.filter(isAssignmentUnread).length;

  // Architect "team update" bell items — milestones on their own work (quote
  // sent, client accepted, project closed) they should see after handing off.
  // Derived from the SAME assigned-projects fetch; unread until they open it.
  const UPDATE_STATUSES = ["quotation_sent", "quotation_accepted", "closed"];
  const isUpdateUnread = (p) =>
    p.architectUpdateAt &&
    (!p.architectUpdateReadAt ||
      new Date(p.architectUpdateReadAt) < new Date(p.architectUpdateAt));
  const updateNotifications = assignmentNotifications.filter(
    (p) => UPDATE_STATUSES.includes(p.status) && isUpdateUnread(p)
  );
  const updateCount = updateNotifications.length;

  const architectUpdateLabel = (status) =>
    status === "quotation_sent"
      ? "Your quote was sent to the client"
      : status === "quotation_accepted"
      ? "The client accepted your quote"
      : status === "closed"
      ? "Project completed & closed"
      : "Project update";

  // Change requests: projects (this admin's / this architect's) where the client
  // asked for changes on a sent quote. No read-state — a project stays here until
  // the admin sends a revised quote (which clears the flag), so its presence IS
  // the "needs action" signal, and it always counts as unread.
  const [changeReqNotifications, setChangeReqNotifications] = useState([]);
  const changeReqCount = changeReqNotifications.length;

  // Client bell: the client's own projects whose quotation is ready to review
  // (status quotation_sent and no pending change of their own). Same "presence =
  // action needed" model — it clears when they accept or request a change.
  const [clientNotifications, setClientNotifications] = useState([]);
  const clientNotifyCount = clientNotifications.length;

  // Tracker step-move bell: projects that advanced a step. The design backend
  // stamps `lastStepMoveAt` / `lastStepMoveLabel` on the project when a stage
  // event is created (see project_items.js). There is NO backend read-state for
  // this, so "seen" is tracked client-side in localStorage (project id → the
  // lastStepMoveAt we last opened); a move stays unread until it's opened again
  // after a newer move.
  const STEP_MOVE_SEEN_KEY = "pazl-stepmove-seen";
  const stepMoveField = "stepMoveReadAt";
  const readStepMoveSeen = () => {
    try {
      return JSON.parse(localStorage.getItem(STEP_MOVE_SEEN_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const [stepMoveNotifications, setStepMoveNotifications] = useState([]);
  const [stepMoveSeen, setStepMoveSeen] = useState(readStepMoveSeen);
  const isStepMoveUnread = (p, field = stepMoveField) => {
    if (!p?.lastStepMoveAt) return false;
    const seen = p?.[field] || stepMoveSeen[p?._id];
    return !seen || new Date(seen) < new Date(p.lastStepMoveAt);
  };
  const markStepMoveRead = async (id, field = stepMoveField) => {
    const now = new Date().toISOString();
    setStepMoveSeen((prev) => {
      const next = { ...prev, [id]: now };
      try {
        localStorage.setItem(STEP_MOVE_SEEN_KEY, JSON.stringify(next));
      } catch {
        /* storage disabled — the highlight just won't persist */
      }
      return next;
    });
    return { _id: id, [field]: now };
  };
  const stepMoveCount = stepMoveNotifications.filter((p) =>
    isStepMoveUnread(p, stepMoveField)
  ).length;

  // Combined badge counts (a change request is an extra unread item on the
  // admin's and the assigned architect's existing bell).
  const adminBellCount = quoteRequestCount + changeReqCount;
  const architectBellCount = assignmentCount + changeReqCount + updateCount;
  const headerTitle = {
    title: "PAZL",
    color: "#414063",
    fontSize: "18px",
    fontWeight: "700",
  };
  const isAdmin = currentUser?.permissions === USER_ROLES.ADMIN;
  const isSuperAdmin = currentUser?.permissions === USER_ROLES.SUPER_ADMIN;
  const isArchitect = currentUser?.permissions === USER_ROLES.ARCHITECT;
  // "Generate Inspiration" and "Get Quote" are the client's actions. Architects
  // /admins reach the project page via Workspace and must NOT see them (the
  // former routes to /dashboard → NotFound for non-users; the latter wrongly
  // flips the project to "quotation_requested").
  const isUser = currentUser?.permissions === USER_ROLES.USER;
  const teamsIsActive = location.pathname.includes("/teams");
  const rateCardIsActive = location.pathname.includes("/rate-card");
  const isDashboard = location.pathname.includes("/dashboard");
  const projectsIsActive =
    location.pathname === "/projects" || location.pathname === "/";

  useEffect(() => {
    if (historyStatus === "updated" || favoriteStatus === "updated") {
      getCounts();
      setHistoryStatus("clear");
      setFavoriteStatus("clear");
    }
  }, [historyStatus, favoriteStatus]);

  useEffect(() => {
    getCounts();
  }, [currentProject?._id]);

  // Refresh the bell whenever an admin navigates, so a new request (or one just
  // handled) is reflected without a full page reload.
  useEffect(() => {
    if (!isAdmin && !isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      // Four things need the admin's attention in the bell: a client's new quote
      // request, an architect's quote awaiting approval, a client who has accepted
      // a quote (ready to close), and a client who requested changes on a sent
      // quote (needs a revised quote). The last lives on the design backend.
      const [reqRes, apprRes, accRes, sentRes, changeIds] = await Promise.all([
        getProjectsByStatus("quotation_requested"),
        getProjectsByStatus("quotation_pending_approval"),
        getProjectsByStatus("quotation_accepted"),
        getProjectsByStatus("quotation_sent"),
        getChangeRequestedProjectIds(),
      ]);
      const reqList = reqRes?.data?.data || reqRes?.data || [];
      const apprList = apprRes?.data?.data || apprRes?.data || [];
      const accList = accRes?.data?.data || accRes?.data || [];
      const sentList = sentRes?.data?.data || sentRes?.data || [];
      const list = [
        ...(Array.isArray(reqList) ? reqList : []),
        ...(Array.isArray(apprList) ? apprList : []),
        ...(Array.isArray(accList) ? accList : []),
      ];
      const changeReq = (Array.isArray(sentList) ? sentList : []).filter((p) =>
        changeIds.has(String(p._id))
      );
      if (!cancelled) {
        // Newest first.
        const sorted = [...list].sort(
          (a, b) =>
            new Date(b.quoteRequestedAt || b.createdAt || 0) -
            new Date(a.quoteRequestedAt || a.createdAt || 0)
        );
        setQuoteNotifications(sorted);
        setChangeReqNotifications(changeReq);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isSuperAdmin, location.pathname]);

  // Opening a notification marks it read and takes the admin to the request.
  const handleOpenNotification = async (project) => {
    if (isUnread(project)) {
      const updated = await markQuoteRequestRead(project._id);
      if (updated?._id) {
        setQuoteNotifications((prev) =>
          prev.map((p) => (p._id === project._id ? { ...p, ...updated } : p))
        );
      }
    }
    // Query string, not router state — see navigateToQuoteRequests below. Land
    // on the list matching THIS item's status so design-completed and
    // pending-approval items don't drop into the quote-requested filter.
    navigate(`/projects?status=${project?.status || "quotation_requested"}`);
  };

  // Architect bell: their assigned projects. The backend already scopes an
  // architect's GET /projects to architectUserId === them, so a plain fetch
  // returns exactly their assignments — no new endpoint.
  useEffect(() => {
    if (!isArchitect) return;
    let cancelled = false;
    (async () => {
      const [res, changeIds] = await Promise.all([
        getProject(currentUser?._id),
        getChangeRequestedProjectIds(),
      ]);
      const list = res?.data || [];
      if (!cancelled && Array.isArray(list)) {
        const sorted = [...list].sort(
          (a, b) =>
            new Date(b.architectAssignedAt || b.createdAt || 0) -
            new Date(a.architectAssignedAt || a.createdAt || 0)
        );
        setAssignmentNotifications(sorted);
        // Their assigned projects that have a pending client change request.
        setChangeReqNotifications(sorted.filter((p) => changeIds.has(String(p._id))));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isArchitect, currentUser?._id, location.pathname]);

  // Client bell: the client's own projects whose quote is ready to review. The
  // client gets no email-only silence in-app now — a header bell mirrors the
  // "your quotation is ready" banner so it's visible from anywhere in the app.
  useEffect(() => {
    if (!isUser) return;
    let cancelled = false;
    (async () => {
      const [res, changeIds] = await Promise.all([
        getProject(currentUser?._id),
        getChangeRequestedProjectIds(),
      ]);
      const list = res?.data || [];
      if (!cancelled && Array.isArray(list)) {
        // Quote ready = sent AND the client hasn't since requested a change
        // (which would mean they're waiting on the revised quote, not acting).
        const ready = list.filter(
          (p) => p.status === "quotation_sent" && !changeIds.has(String(p._id))
        );
        setClientNotifications(ready);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isUser, currentUser?._id, location.pathname]);

  const handleOpenClientNotification = (project) => {
    navigate(`/project-detail/${project._id}`);
  };

  const handleOpenChangeRequest = (project) => {
    navigate(`/project-detail/${project._id}`);
  };

  // Opening a team update marks it read (so it clears from the bell) and jumps
  // to the project.
  const handleOpenArchitectUpdate = async (project) => {
    const updated = await markArchitectUpdateRead(project._id);
    if (updated?._id) {
      setAssignmentNotifications((prev) =>
        prev.map((p) => (p._id === project._id ? { ...p, ...updated } : p))
      );
    }
    navigate(`/project-detail/${project._id}`);
  };

  // Opening an assignment marks it read and takes the architect to the project.
  const handleOpenAssignment = async (project) => {
    if (isAssignmentUnread(project)) {
      const updated = await markAssignmentRead(project._id);
      if (updated?._id) {
        setAssignmentNotifications((prev) =>
          prev.map((p) => (p._id === project._id ? { ...p, ...updated } : p))
        );
      }
    }
    navigate(`/project-detail/${project._id}`);
  };

  // Tracker step-move bell: projects that advanced a step. Admin sees all
  // projects; architect sees only their assigned ones.
  useEffect(() => {
    if (!isAdmin && !isSuperAdmin && !isArchitect) return;
    let cancelled = false;
    (async () => {
      let list = [];
      if (isArchitect) {
        const res = await getProject(currentUser?._id);
        list = res?.data || [];
      } else {
        const res = await getAllProjects(500, 0);
        list = res?.data?.data || res?.data || [];
      }
      if (!cancelled && Array.isArray(list)) {
        const moved = list
          .filter((p) => p.lastStepMoveAt)
          .sort(
            (a, b) => new Date(b.lastStepMoveAt) - new Date(a.lastStepMoveAt)
          );
        setStepMoveNotifications(moved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isSuperAdmin, isArchitect, currentUser?._id, location.pathname]);

  // Opening a step-move notification marks it read and opens the project.
  const handleOpenStepMove = async (project) => {
    if (isStepMoveUnread(project, stepMoveField)) {
      const updated = await markStepMoveRead(project._id, stepMoveField);
      if (updated?._id) {
        setStepMoveNotifications((prev) =>
          prev.map((p) => (p._id === project._id ? { ...p, ...updated } : p))
        );
      }
    }
    navigate(`/project-detail/${project._id}`);
  };

  useEffect(() => {
    const handleResize = () => {
      setIsHeaderMobile(window.innerWidth < 992);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const getCounts = async () => {
    if (!currentProject) {
      return;
    }
    const imagesGenerated = await imagesService.getGeneratedImages(currentProject._id);
    const history = imagesGenerated?.data || [];
    const favCount = history.reduce((count, image) => {
      return image.isFavorite ? count + 1 : count;
    }, 0);
    setHistoryCount(history.length);
    setFavoriteCount(favCount);
  };

  const handleLogout = async () => {
    await authService.signOut();
    navigate("/signin");
  };

  const handleLogoClick = () => {
    // Single entry point: "/" (HomeDispatcher) sends each role to the right
    // landing. No role branching here — that decision lives in one place.
    navigate("/");
  };

  const handleNavLinkClick = (path, tab) => {
    const queryParams = tab;
    const queryString = new URLSearchParams(queryParams).toString();
    navigate(`${path}?${queryString}`);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(
      `${window.location.host}/share/${currentProject?.shareId}`
    );
    toast.success("Project share link copied", {
      position: toast.POSITION.TOP_RIGHT,
      theme: "colored",
    });
  };

  const naviateToDashboard = () => {
    navigate("/dashboard");
  };

  const getProgressStatus = () => {
    if (activeStep == 1) {
      return 33;
    } else if (activeStep == 2) {
      return 66;
    } else if (activeStep == 3) {
      return 99;
    }
  };

  const navigateToProjects = () => {
    navigate("/projects"); // Navigate to the "Projects" route
  };

  // The bell is only useful if it lands on the requests themselves.
  //
  // Uses the QUERY STRING rather than router state: the URL visibly changes (so
  // it is obvious something happened, and the view is linkable), it survives a
  // refresh, and it is the exact mechanism the emailed "Review request" button
  // already uses. Router state is invisible and does nothing when you are
  // already on /projects, which made the link look broken.
  const QUOTE_REQUESTS_URL = "/projects?status=quotation_requested";
  const navigateToQuoteRequests = () => {
    navigate(QUOTE_REQUESTS_URL);
  };

  const navigateToTeams = () => {
    navigate("/teams"); // Navigate to the "Teams" route
  };

  const navigateToRateCard = () => {
    navigate("/rate-card"); // BOQ master rates (moved here from the design app)
  };

  // A client may (re)request a quote ONLY when the project is not already in an
  // active quote/build cycle. Requesting mid-flow would reset the project back to
  // "quotation_requested" and break the existing flow (and rewind the tracker), so
  // it's allowed only from a fresh (open), finished (closed) or previously-rejected
  // project. Undefined status (no project yet) stays allowed.
  const quoteInProgress = [
    "quotation_requested",
    "quotation_pending_approval",
    "quotation_sent",
    "quotation_accepted",
  ].includes(currentProject?.status);

  const handleGetQuote = async () => {
    if (quoteInProgress) {
      toast.info("A quotation is already in progress for this project.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }
    const data = { status: "quotation_requested" };
    const updateResponse = await updateProject(currentProject?._id, data);
    // updateProject returns null when the backend refused the write, so this no
    // longer reports success for a request that was never saved.
    if (!updateResponse) {
      toast.error("Could not send your quotation request. Please try again.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }
    // The request IS saved either way — only the admin's email may have failed.
    // Say which happened rather than a blanket "requested!", so the client is
    // never told the admin was notified when nobody was.
    if (updateResponse.adminNotified) {
      toast.success("Quotation requested — the admin has been notified by email.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } else {
      toast.warning(
        "Quotation requested. We could not email the admin just now, but your request is saved and visible to them.",
        { position: toast.POSITION.TOP_RIGHT, theme: "colored", autoClose: 8000 }
      );
    }
  };

  // Tracker step-move notifications, rendered INSIDE the main bell (merged from
  // the old separate second bell). Reused in both the admin quote bell and the
  // architect assignment bell so there is now just ONE bell per user.
  const stepMoveMenuItems =
    stepMoveNotifications.length > 0 ? (
      <>
        <Dropdown.Divider />
        <Dropdown.Header>
          Project updates{stepMoveCount > 0 && ` (${stepMoveCount} new)`}
        </Dropdown.Header>
        {stepMoveNotifications.map((p) => {
          const unread = isStepMoveUnread(p, stepMoveField);
          return (
            <Dropdown.Item
              key={`sm-${p._id}`}
              onClick={() => handleOpenStepMove(p)}
              style={{
                whiteSpace: "normal",
                background: unread ? "#eafaf3" : "transparent",
                borderLeft: unread ? "3px solid #0F6E56" : "3px solid transparent",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: unread ? 600 : 400,
                  color: "#1f2033",
                }}
              >
                {p.name || "Untitled project"} — moved to{" "}
                {p.lastStepMoveLabel || "a new step"}
              </div>
              <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                {p.ownerUser?.email || p.clientName || "Client"}
                {p.lastStepMoveAt &&
                  ` · ${new Date(p.lastStepMoveAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`}
              </div>
            </Dropdown.Item>
          );
        })}
      </>
    ) : null;

  return (
    <>
      <ShareModal
        show={showShareModal}
        onHide={() => setShowShareModal(false)}
        shareUrl={`${currentProject?.shareId}`}
      />

      <Container fluid className="border-bottom p-0">
        {["lg"].map((expand) => (
          <Navbar key={expand} expand={expand} className="p-0">
            <Container fluid>
              <Navbar.Brand className="m-0">
                <Button
                  className="d-flex align-items-center p-0 cursor shadow-none logo-active"
                  variant="text"
                  onClick={handleLogoClick}
                >
                  <img
                    src={pazlLogo}
                    alt="PazlLogo"
                    width={"60px"}
                    height={"60px"}
                  />
                  <Title
                    className="fw-bold"
                    title={headerTitle.title}
                    color={headerTitle.color}
                    fontSize={headerTitle.fontSize}
                    fontWeight={headerTitle.fontWeight}
                  />
                </Button>
              </Navbar.Brand>
              {isheaderMobile && (
                <Col className="d-flex justify-content-end">
                  <Button variant="link">
                    <img
                      src={Share}
                      alt="share"
                      onClick={() => setShowShareModal(true)}
                    />
                  </Button>
                </Col>
              )}
              <Navbar.Toggle
                aria-controls={`offcanvasNavbar-expand-${expand}`}
              />
              <Navbar.Offcanvas
                id={`offcanvasNavbar-expand-${expand}`}
                aria-labelledby={`offcanvasNavbarLabel-expand-${expand}`}
                placement="end "
                style={{ maxWidth: "75vw", minWidth: "40vw" }}
              >
                <Offcanvas.Header closeButton className="pb-0">
                  <Offcanvas.Title id={`offcanvasNavbarLabel-expand-${expand}`}>
                    <Col
                      className="d-flex align-items-center"
                      onClick={handleLogoClick}
                      style={{ cursor: "pointer" }}
                    >
                      <img
                        src={pazlLogo}
                        alt="PazlLogo"
                        width={"60px"}
                        height={"60px"}
                      />
                      <span>
                        <Title
                          title={headerTitle.title}
                          color={headerTitle.color}
                          fontSize={headerTitle.fontSize}
                          fontWeight={headerTitle.fontWeight}
                        />
                      </span>
                    </Col>
                  </Offcanvas.Title>
                </Offcanvas.Header>
                <Offcanvas.Body className="pt-0">
                  <Nav className="justify-content-end flex-grow-1">
                    {!showLogo && !isGuestUser && isDashboard && (
                      <Row className="d-lg-flex flex-lg-row flex-column">
                        {!isheaderMobile && (
                          <Col>
                            <Nav.Link
                              className="pe-3 header_link"
                              href="#"
                              onClick={() => setShowShareModal(true)}
                            >
                              Share
                            </Nav.Link>
                          </Col>
                        )}
                        <Col>
                          <Nav.Link
                            className="d-flex align-items-center header_link position-relative"
                            onClick={() =>
                              handleNavLinkClick("/project-detail", {
                                tab: "history",
                              })
                            }
                          >
                            {isheaderMobile && (
                              <img
                                src={HistoryIcon}
                                alt="history"
                                className="pe-3"
                              />
                            )}
                            History{" "}
                            {!isheaderMobile && (
                              <Badge
                                className="ms-1 badge-width counter-icon"
                                bg="primary"
                              >
                                {historyCount || 0}
                              </Badge>
                            )}
                          </Nav.Link>
                        </Col>
                        <Col>
                          <Nav.Link
                            className="d-flex align-items-center header_link position-relative"
                            onClick={() =>
                              handleNavLinkClick("/project-detail", {
                                tab: "favorites",
                              })
                            }
                          >
                            {isheaderMobile && (
                              <img
                                src={FavoriteIcon}
                                alt="fav"
                                className="pe-3"
                              />
                            )}
                            Favorites
                            {!isheaderMobile && (
                              <Badge
                                className="ms-1 badge-width counter-icon"
                                bg="primary"
                              >
                                {favoriteCount || 0}{" "}
                              </Badge>
                            )}
                          </Nav.Link>
                        </Col>
                      </Row>
                    )}
                    <ToastContainer />
                    {showLogo && !isheaderMobile && !isGuestUser && (
                      <Row className="d-lg-flex flex-lg-row flex-column align-items-center">
                        {isUser && (
                          <Col className="pb-lg-0 pb-3 pe-lg-3">
                            <Button
                              variant="outlined"
                              className="outline-button button-width"
                              onClick={naviateToDashboard}
                            >
                              Generate Inspiration
                            </Button>
                          </Col>
                        )}
                        {isUser && (
                          <Col className="p-0">
                            <Button
                              variant="primary"
                              className="primary-button-filled button-width"
                              onClick={handleGetQuote}
                              disabled={quoteInProgress}
                              title={
                                quoteInProgress
                                  ? "A quotation is already in progress for this project."
                                  : undefined
                              }
                            >
                              Get Quote
                            </Button>
                          </Col>
                        )}
                        <Col className="p-0">
                          <Button className="button-icons">
                            <img
                              src={Share} alt="share"
                              width={48} height={48}
                              onClick={() => setShowShareModal(true)}
                            />
                          </Button>
                        </Col>
                      </Row>
                    )}
                    {(isAdmin || isSuperAdmin) && (
                      <Row className="d-lg-flex flex-lg-row flex-column">
                        <Col className="p-0">
                          <Nav.Link onClick={navigateToProjects}>
                            <span
                              className={`${projectsIsActive
                                ? "border-bottom border-primary fw-bold p-2 border-4"
                                : ""
                                }`}
                            >
                              Projects
                            </span>
                          </Nav.Link>
                        </Col>
                        <Col className="p-0">
                          <Nav.Link onClick={navigateToTeams}>
                            <span
                              className={`${teamsIsActive
                                ? "border-bottom border-primary fw-bold p-2 border-4"
                                : ""
                                }`}
                            >
                              Teams
                            </span>
                          </Nav.Link>
                        </Col>
                        {/* xs="auto" + text-nowrap: the sibling Cols are
                            equal-width, so a two-word label would wrap to
                            "Rate / Card". Sizing this one to its content keeps
                            it on a single line and leaves Projects/Teams as they
                            were. */}
                        <Col xs="auto" className="p-0 text-nowrap">
                          <Nav.Link onClick={navigateToRateCard}>
                            <span
                              className={`${rateCardIsActive
                                ? "border-bottom border-primary fw-bold p-2 border-4"
                                : ""
                                }`}
                            >
                              Rate Card
                            </span>
                          </Nav.Link>
                        </Col>
                        {/* Notifications. The bell opens the list of quotation
                            requests; opening one marks it read and jumps to it. */}
                        <Col className="p-0">
                          <Dropdown align="end">
                            <Dropdown.Toggle
                              as="span"
                              role="button"
                              bsPrefix="notification-bell"
                              className="position-relative d-inline-block p-2"
                              title={
                                adminBellCount
                                  ? `${adminBellCount} unread notification(s)`
                                  : "No unread notifications"
                              }
                              style={{ cursor: "pointer" }}
                            >
                              <NotificationsIcon
                                style={{ color: "#414063", fontSize: "22px" }}
                              />
                              {adminBellCount > 0 && (
                                <Badge
                                  bg="danger"
                                  pill
                                  className="position-absolute"
                                  style={{
                                    top: "0px",
                                    right: "-2px",
                                    fontSize: "10px",
                                  }}
                                >
                                  {adminBellCount}
                                </Badge>
                              )}
                            </Dropdown.Toggle>
                            <Dropdown.Menu
                              style={{ minWidth: "320px", maxHeight: "380px", overflowY: "auto" }}
                            >
                              <Dropdown.Header>
                                Notifications
                                {adminBellCount > 0 && ` (${adminBellCount} unread)`}
                              </Dropdown.Header>
                              {/* Change requests first — they need a revised quote. */}
                              {changeReqNotifications.map((p) => (
                                <Dropdown.Item
                                  key={`cr-${p._id}`}
                                  onClick={() => handleOpenChangeRequest(p)}
                                  style={{
                                    whiteSpace: "normal",
                                    background: "#fff8ec",
                                    borderLeft: "3px solid #d98a00",
                                  }}
                                >
                                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#8a5a00" }}>
                                    ⚠ Change requested — {p.name || "Untitled project"}
                                  </div>
                                  <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                                    {p.ownerUser?.email || p.clientEmail || "Client"} · send a revised quote
                                  </div>
                                </Dropdown.Item>
                              ))}
                              {quoteNotifications.length === 0 &&
                                changeReqNotifications.length === 0 && (
                                <div className="px-3 py-3 text-muted" style={{ fontSize: "13px" }}>
                                  You have no notifications.
                                </div>
                              )}
                              {quoteNotifications.map((p) => {
                                const unread = isUnread(p);
                                return (
                                  <Dropdown.Item
                                    key={p._id}
                                    onClick={() => handleOpenNotification(p)}
                                    style={{
                                      whiteSpace: "normal",
                                      background: unread ? "#f2f4ff" : "transparent",
                                      borderLeft: unread
                                        ? "3px solid #414063"
                                        : "3px solid transparent",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "13px",
                                        fontWeight: unread ? 600 : 400,
                                        color: "#1f2033",
                                      }}
                                    >
                                      {p.status === "quotation_pending_approval"
                                        ? "Pending your approval"
                                        : p.status === "quotation_accepted"
                                        ? "Client accepted — ready to close"
                                        : "Quotation requested"}{" "}
                                      — {p.name || "Untitled project"}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                                      {p.ownerUser?.email || p.clientEmail || "Client"}
                                      {p.quoteRequestedAt &&
                                        ` · ${new Date(p.quoteRequestedAt).toLocaleString("en-GB", {
                                          dateStyle: "medium",
                                          timeStyle: "short",
                                        })}`}
                                    </div>
                                  </Dropdown.Item>
                                );
                              })}
                              {quoteNotifications.length > 0 && (
                                <>
                                  <Dropdown.Divider />
                                  <Dropdown.Item
                                    onClick={navigateToQuoteRequests}
                                    style={{ fontSize: "13px", textAlign: "center" }}
                                  >
                                    View all quotation requests
                                  </Dropdown.Item>
                                </>
                              )}
                              {/* Merged: tracker step-moves in the same bell. */}
                              {stepMoveMenuItems}
                            </Dropdown.Menu>
                          </Dropdown>
                        </Col>
                      </Row>
                    )}
                    {/* Client notifications: the bell lists the client's own
                        projects whose quote is ready to review. */}
                    {isUser && (
                      <Dropdown align="end">
                        <Dropdown.Toggle
                          as="span"
                          role="button"
                          bsPrefix="notification-bell"
                          className="position-relative d-inline-block p-2"
                          title={
                            clientNotifyCount
                              ? `${clientNotifyCount} notification(s)`
                              : "No notifications"
                          }
                          style={{ cursor: "pointer" }}
                        >
                          <NotificationsIcon
                            style={{ color: "#414063", fontSize: "22px" }}
                          />
                          {clientNotifyCount > 0 && (
                            <Badge
                              bg="danger"
                              pill
                              className="position-absolute"
                              style={{ top: "0px", right: "-2px", fontSize: "10px" }}
                            >
                              {clientNotifyCount}
                            </Badge>
                          )}
                        </Dropdown.Toggle>
                        <Dropdown.Menu
                          style={{ minWidth: "320px", maxHeight: "380px", overflowY: "auto" }}
                        >
                          <Dropdown.Header>
                            Notifications
                            {clientNotifyCount > 0 && ` (${clientNotifyCount})`}
                          </Dropdown.Header>
                          {clientNotifications.length === 0 && (
                            <div className="px-3 py-3 text-muted" style={{ fontSize: "13px" }}>
                              You have no notifications.
                            </div>
                          )}
                          {clientNotifications.map((p) => (
                            <Dropdown.Item
                              key={`cn-${p._id}`}
                              onClick={() => handleOpenClientNotification(p)}
                              style={{
                                whiteSpace: "normal",
                                background: "#f2f4ff",
                                borderLeft: "3px solid #414063",
                              }}
                            >
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#1f2033" }}>
                                Your quotation is ready — {p.name || "Untitled project"}
                              </div>
                              <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                                Review the BOQ and accept, or request a change
                              </div>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown>
                    )}
                    {/* Architect notifications: the bell lists projects assigned
                        to them; opening one marks it read and jumps to it. */}
                    {isArchitect && (
                      <Dropdown align="end">
                        <Dropdown.Toggle
                          as="span"
                          role="button"
                          bsPrefix="notification-bell"
                          className="position-relative d-inline-block p-2"
                          title={
                            architectBellCount
                              ? `${architectBellCount} unread notification(s)`
                              : "No unread notifications"
                          }
                          style={{ cursor: "pointer" }}
                        >
                          <NotificationsIcon
                            style={{ color: "#414063", fontSize: "22px" }}
                          />
                          {architectBellCount > 0 && (
                            <Badge
                              bg="danger"
                              pill
                              className="position-absolute"
                              style={{ top: "0px", right: "-2px", fontSize: "10px" }}
                            >
                              {architectBellCount}
                            </Badge>
                          )}
                        </Dropdown.Toggle>
                        <Dropdown.Menu
                          style={{ minWidth: "320px", maxHeight: "380px", overflowY: "auto" }}
                        >
                          <Dropdown.Header>
                            Notifications
                            {architectBellCount > 0 && ` (${architectBellCount} unread)`}
                          </Dropdown.Header>
                          {/* Change requests the architect must revise, first. */}
                          {changeReqNotifications.map((p) => (
                            <Dropdown.Item
                              key={`cr-${p._id}`}
                              onClick={() => handleOpenChangeRequest(p)}
                              style={{
                                whiteSpace: "normal",
                                background: "#fff8ec",
                                borderLeft: "3px solid #d98a00",
                              }}
                            >
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#8a5a00" }}>
                                ⚠ Changes requested — {p.name || "Untitled project"}
                              </div>
                              <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                                The client requested changes · revise the design
                              </div>
                            </Dropdown.Item>
                          ))}
                          {/* Team updates on the architect's own work. */}
                          {updateNotifications.map((p) => (
                            <Dropdown.Item
                              key={`up-${p._id}`}
                              onClick={() => handleOpenArchitectUpdate(p)}
                              style={{
                                whiteSpace: "normal",
                                background: "#f2f4ff",
                                borderLeft: "3px solid #414063",
                              }}
                            >
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#1f2033" }}>
                                {architectUpdateLabel(p.status)} — {p.name || "Untitled project"}
                              </div>
                              <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                                {p.ownerUser?.email || p.clientName || "Client"}
                                {p.architectUpdateAt &&
                                  ` · ${new Date(p.architectUpdateAt).toLocaleString("en-GB", {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  })}`}
                              </div>
                            </Dropdown.Item>
                          ))}
                          {assignmentNotifications.length === 0 &&
                            changeReqNotifications.length === 0 &&
                            updateNotifications.length === 0 && (
                            <div className="px-3 py-3 text-muted" style={{ fontSize: "13px" }}>
                              You have no notifications.
                            </div>
                          )}
                          {assignmentNotifications.map((p) => {
                            const unread = isAssignmentUnread(p);
                            return (
                              <Dropdown.Item
                                key={p._id}
                                onClick={() => handleOpenAssignment(p)}
                                style={{
                                  whiteSpace: "normal",
                                  background: unread ? "#f2f4ff" : "transparent",
                                  borderLeft: unread
                                    ? "3px solid #414063"
                                    : "3px solid transparent",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "13px",
                                    fontWeight: unread ? 600 : 400,
                                    color: "#1f2033",
                                  }}
                                >
                                  Assigned to you — {p.name || "Untitled project"}
                                </div>
                                <div style={{ fontSize: "12px", color: "#8a8d9f" }}>
                                  {p.ownerUser?.email || p.clientName || "Client"}
                                  {p.architectAssignedAt &&
                                    ` · ${new Date(p.architectAssignedAt).toLocaleString("en-GB", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })}`}
                                </div>
                              </Dropdown.Item>
                            );
                          })}
                          {/* Merged: tracker step-moves in the same bell. */}
                          {stepMoveMenuItems}
                        </Dropdown.Menu>
                      </Dropdown>
                    )}
                    <img
                      className="d-none d-lg-block "
                      src={Profile}
                      alt="profile"
                      style={{ paddingLeft: '30px' }}
                    />
                    <div className="d-flex align-items-center">
                      <DropdownButton
                        className="d-none d-lg-block"
                        bsPrefix="profile-button"
                        as={ButtonGroup}
                        align={{ lg: 'end' }}
                        title={currentUser?.email || "User"}
                        id="dropdown-menu-align-responsive-1"
                      >
                        <Dropdown.Item eventKey="1"
                          onClick={handleLogout}
                        >Logout </Dropdown.Item>
                      </DropdownButton>
                    </div>
                    <Nav.Link
                      className="d-block d-lg-none"
                      onClick={handleLogout}
                    >
                      {isheaderMobile && (
                        <img src={Logout} alt="logout" className="pe-3" />
                      )}
                      Logout
                    </Nav.Link>
                    {/* <NavDropdown
                      title={currentUser?.email || "User"}
                      id={`offcanvasNavbarDropdown-expand-${expand}`}
                      className="d-none d-lg-block"
                    >
                      <NavDropdown.Item
                        onClick={handleLogout}>
                        Logout
                      </NavDropdown.Item>
                    </NavDropdown>
                    <Nav.Link
                      className="d-block d-lg-none"
                      onClick={handleLogout}
                    >
                      {isheaderMobile && (
                        <img src={Logout} alt="logout" className="pe-3" />
                      )}
                      Logout
                    </Nav.Link> */}
                  </Nav>
                </Offcanvas.Body>
              </Navbar.Offcanvas>
            </Container>
          </Navbar>
        ))}
      </Container>
    </>
  );
};

export default AppHeader;
