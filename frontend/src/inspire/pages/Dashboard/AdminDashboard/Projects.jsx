import React, { useContext, useEffect, useMemo, useState } from "react";
import Form from "react-bootstrap/Form";
import Pagination from "react-bootstrap/Pagination";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Col,
  Container,
  Dropdown,
  OverlayTrigger,
  Row,
  Tooltip,
} from "react-bootstrap";
import VerticalDot from "../../../assets/images/more_vert_dot.svg";
import "./index.css";
import "./Projects.css";
import ProjectContext from "../../../context/ProjectContext";
import Button from "react-bootstrap/Button";
import AppHeader from "../../../components/AppHeader";
import NavRail from "@pazl/components/NavRail";
import ConfirmationModal from "../../../components/ConfirmationModal";
import UserContext from "../../../context/UserContext";
import {
  deleteProject,
  getAllProjects,
  getClosedProjectsCount,
  getOpenProjectsCount,
  getProjectsByStatus,
  getQuotationRequestedProjectsCount,
  getQuotationSentProjectsCount,
  updateProject,
} from "../../../services/projectService";
import projectStatus from "../../../utils/projectStatus.json";
import { Table, Thead, Tbody, Tr, Th, Td } from "react-super-responsive-table";
import ShareModal from "../../../components/ShareModal";
import UserRoleContext from "../../../context/UserRoleContext";
import { ArrowBackIos, ArrowForwardIos } from "@mui/icons-material";
import { USER_ROLES } from "../../../utils/constants";
import { getAccessToken } from "../../../services/authService";
import { getChangeRequestedProjectIds } from "../../../services/projectWorkspaceService";
import EditProjectModal from "../../../components/EditProjectModal";
import AssignArchitectModal from "../../../components/AssignArchitectModal";
import DataTable from "react-data-table-component";
import differenceBy from "lodash/differenceBy";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// --- small inline icons (stroke = the text colour) ---------------------------
const Icon = ({ size = 16, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);
const SearchIcon = () => (
  <Icon className="pzp-search-icon" stroke="#697386">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
const ClearIcon = () => (
  <Icon size={12} strokeWidth="3">
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
const GearIcon = () => (
  <Icon size={18}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
const PencilIcon = () => (
  <Icon size={14}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

// The row's actions, each an icon whose name shows on hover.
const QuoteIcon = () => (
  <Icon size={17}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Icon>
);
const CubeIcon = () => (
  <Icon size={17}>
    <path d="M12 2 3 7v10l9 5 9-5V7z" />
    <path d="m3 7 9 5 9-5M12 12v10" />
  </Icon>
);
const FolderIcon = () => (
  <Icon size={17}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
const EditIcon = () => (
  <Icon size={17}>
    <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
    <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  </Icon>
);
const ActionIcon = ({ label, onClick, primary, children }) => (
  <OverlayTrigger
    placement="top"
    delay={{ show: 120, hide: 0 }}
    overlay={<Tooltip className="pzp-tip">{label}</Tooltip>}
  >
    <button
      type="button"
      className={`pzp-act${primary ? " pzp-act--primary" : ""}`}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  </OverlayTrigger>
);

// The pill's colour comes from Projects.css, one class per status.
const statusClass = (status) => `pzp-status pzp-status--${status || "closed"}`;

// The dot on each status card, in the pill's own colour.
const STAT_DOT = {
  All: "#5b3df5",
  open: "#3f4bb8",
  quotation_requested: "#d48806",
  closed: "#8a93a6",
  quotation_sent: "#4b30dc",
};

const initialsOf = (name) =>
  String(name || "")
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/** "Today", "Yesterday", else "02 Nov 2026". */
const formatDay = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// What the ⚙ menu can hide, in table order. "Project" and the row's actions
// always show: a row needs a name and a way in.
const HIDEABLE_COLUMNS = [
  { id: "owner", label: "Owner", staffOnly: true },
  { id: "date", label: "Date" },
  { id: "client", label: "Client" },
  { id: "address", label: "Address" },
  { id: "architect", label: "Architect", staffOnly: true },
  { id: "status", label: "Status" },
];
const ROWS_PER_PAGE = [10, 25, 50, 100];
const DEFAULT_ROWS_PER_PAGE = 10;

// The viewer's table choices (hidden columns, row height, rows per page),
// kept in this browser per signed-in user. Storage can be blocked (private
// windows), so every read and write is allowed to fail.
const TABLE_PREFS_KEY = "pz.projectsTable.v1";
const readTablePrefs = (userId) => {
  try {
    const all = JSON.parse(window.localStorage.getItem(TABLE_PREFS_KEY) || "{}");
    return all[userId || "anon"] || {};
  } catch (e) {
    return {};
  }
};
const writeTablePrefs = (userId, prefs) => {
  try {
    const all = JSON.parse(window.localStorage.getItem(TABLE_PREFS_KEY) || "{}");
    all[userId || "anon"] = prefs;
    window.localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify(all));
  } catch (e) {
    /* not remembered this time; the table still works */
  }
};

/** Page buttons: all of them when few, else first … around the current … last. */
const pageList = (current, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) pages.push("…");
  for (let p = from; p <= to; p++) pages.push(p);
  if (to < total - 1) pages.push("…");
  pages.push(total);
  return pages;
};

/** The table's foot: rows per page, "1–10 of 48", and the page buttons. */
const TablePager = ({ rowsPerPage, rowCount, currentPage, onChangePage, onChangeRowsPerPage, query }) => {
  const pages = Math.max(1, Math.ceil(rowCount / rowsPerPage));
  const first = rowCount ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const last = Math.min(rowCount, currentPage * rowsPerPage);
  const go = (p) => onChangePage(Math.min(pages, Math.max(1, p)), rowCount);
  return (
    <div className="pzp-pager">
      <div className="pzp-pager-left">
        <span>Rows per page</span>
        <select
          className="pzp-pager-size"
          aria-label="Rows per page"
          value={rowsPerPage}
          onChange={(e) => onChangeRowsPerPage(Number(e.target.value), currentPage)}
        >
          {ROWS_PER_PAGE.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="pzp-pager-range">
          {first}–{last} of {rowCount}
          {query ? ` matching “${query}”` : ""}
        </span>
      </div>
      <div className="pzp-pages">
        <button type="button" className="pzp-page" aria-label="First page" disabled={currentPage <= 1} onClick={() => go(1)}>
          «
        </button>
        <button type="button" className="pzp-page" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => go(currentPage - 1)}>
          ‹
        </button>
        {pageList(currentPage, pages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="pzp-gap">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`pzp-page${p === currentPage ? " is-on" : ""}`}
              aria-current={p === currentPage ? "page" : undefined}
              onClick={() => go(p)}
            >
              {p}
            </button>
          )
        )}
        <button type="button" className="pzp-page" aria-label="Next page" disabled={currentPage >= pages} onClick={() => go(currentPage + 1)}>
          ›
        </button>
        <button type="button" className="pzp-page" aria-label="Last page" disabled={currentPage >= pages} onClick={() => go(pages)}>
          »
        </button>
      </div>
    </div>
  );
};

/** Grey rows that shimmer while the list loads, instead of a blank table. */
const TableSkeleton = () => (
  <div className="pzp-skeleton" aria-label="Loading projects">
    {[0, 1, 2, 3, 4].map((i) => (
      <div className="pzp-sk-row" key={i}>
        <div className="pzp-sk" style={{ width: 28, height: 28, borderRadius: "50%" }} />
        <div className="pzp-sk" style={{ flex: 2 }} />
        <div className="pzp-sk" style={{ flex: 1 }} />
        <div className="pzp-sk" style={{ flex: 1 }} />
        <div className="pzp-sk" style={{ width: 96, height: 24, borderRadius: 999 }} />
      </div>
    ))}
  </div>
);

/** ⚙ — which columns show, and how tall the rows are. */
const ColumnSettings = ({ columns, hidden, onToggle, dense, onDense, onReset }) => (
  <Dropdown align="end" autoClose="outside">
    <Dropdown.Toggle
      variant="light"
      className="pzp-btn pzp-btn-secondary pzp-icon-btn"
      aria-label="Table settings: choose columns"
      title="Choose columns"
    >
      <GearIcon />
    </Dropdown.Toggle>
    <Dropdown.Menu className="pzp-menu" renderOnMount popperConfig={{ strategy: "fixed" }}>
      <div className="pzp-cols">
        <div className="pzp-cols-head">
          <span>Show columns</span>
          <button type="button" className="pzp-link" onClick={onReset}>
            Reset
          </button>
        </div>
        <label className="pzp-col is-locked">
          <input type="checkbox" checked disabled />
          Project
          <small>Always</small>
        </label>
        {columns.map((c) => (
          <label className="pzp-col" key={c.id}>
            <input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => onToggle(c.id)} />
            {c.label}
          </label>
        ))}
        <div className="pzp-cols-sep" />
        <div className="pzp-cols-label">Row height</div>
        <div className="pzp-seg" role="group" aria-label="Row height">
          <button type="button" className={dense ? "" : "is-on"} aria-pressed={!dense} onClick={() => onDense(false)}>
            Comfortable
          </button>
          <button type="button" className={dense ? "is-on" : ""} aria-pressed={dense} onClick={() => onDense(true)}>
            Compact
          </button>
        </div>
        <div className="pzp-cols-note">Saved for you on this device.</div>
      </div>
    </Dropdown.Menu>
  </Dropdown>
);

// The data table's own look, matched to Projects.css.
const tableStyles = {
  headRow: {
    style: { minHeight: "38px", backgroundColor: "#f6f5fe", borderBottomColor: "#e8e5fb" },
  },
  headCells: {
    style: {
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "10.5px",
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: "#2b3247",
      paddingLeft: "14px",
      paddingRight: "14px",
    },
  },
  rows: {
    style: {
      minHeight: "44px",
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "12px",
      color: "#172033",
      "&:not(:last-of-type)": { borderBottomColor: "#f0f1f4" },
    },
    denseStyle: { minHeight: "38px" },
    highlightOnHoverStyle: {
      backgroundColor: "#f8f6ff",
      color: "#172033",
      borderBottomColor: "#f0f1f4",
      outline: "none",
      transitionDuration: "0.15s",
      transitionProperty: "background-color",
    },
  },
  cells: { style: { paddingLeft: "14px", paddingRight: "14px" } },
  progress: { style: { display: "block", width: "100%" } },
  noData: { style: { display: "block", width: "100%" } },
};

const PROJECTS_PAGE_LIMIT = 50;

// How often the list re-checks for work done elsewhere (an architect finishing a
// design, a client requesting a quote). Each tick is 5 requests: the list plus
// the four status counters.
//
// 5s was chosen over the 20s this started at because the admin's complaint was
// the WAIT, and while they are sitting watching the list that delay is the whole
// experience. Going below ~2s only adds load — nobody can tell 2s from 5s when
// waiting on someone else's work.
const PROJECTS_REFRESH_MS = 5000;

const Projects = () => {
  const { loading, setLoading } = useContext(UserRoleContext);
  const location = useLocation();
  const currentUrl = window.location.href;
  const url = new URL(currentUrl);
  const [showAssignArchitectModal, setShowAssignArchitectModal] =
    useState(false);
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [pageNumbers, setPageNumbers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const { currentUser } = useContext(UserContext);
  const [selectedProjectStatus, setSelectedProjectStatus] = useState("All");
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showToggleDropdown, setShowToggleDropdown] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [totalProjectsCount, setTotalProjectsCount] = useState(null);
  const [openProjectsCount, setOpenProjectsCount] = useState(null);
  const [projectShareId, setProjectShareId] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [quotationRequestedProjectsCount, setQuotationRequestedProjectsCount] =
    useState(null);
  const [closedProjectsCount, setClosedProjectsCount] = useState(null);
  const [quotationSentProjectsCount, setQuotationSentProjectsCount] =
    useState(null);
  const { currentProject } = useContext(ProjectContext);
  // Project ids with a pending client change request (design backend source of
  // truth) — used to badge the rows so admins spot them without opening email.
  const [changeReqIds, setChangeReqIds] = useState(new Set());
  useEffect(() => {
    getChangeRequestedProjectIds().then(setChangeReqIds);
  }, []);
  const navigate = useNavigate();
  const [filterText, setFilterText] = React.useState("");
  const [toggleCleared, setToggleCleared] = React.useState(false);
  const [selectedRows, setSelectedRows] = React.useState([]);
  const [resetPaginationToggle, setResetPaginationToggle] =
    React.useState(false);
  const handleRowSelected = React.useCallback((state) => {
    setSelectedRows(state.selectedRows);
  }, []);

  const handleSelectProject = (event, project) => {
    if (event.target.checked) {
      setSelectedProjects([...selectedProjects, project]);
    } else {
      const res = selectedProjects.filter((pro) => pro._id !== project._id);
      setSelectedProjects(res);
    }
  };

  useEffect(() => {
    if (currentUrl.includes("/teams")) {
      navigateToTeams();
    }
  }, []);

  useEffect(() => {
    getProjects();
  }, [currentUser]);

  // Keep this list in step with work happening elsewhere — an architect adding a
  // model, a BOQ regenerating, a client requesting a quote. The page used to
  // fetch ONCE on mount, so an admin watching it saw nothing until they reloaded
  // and changes made seconds earlier looked like they had not happened.
  //
  // Polling rather than live events, deliberately: it is the pattern this
  // codebase already uses (ProjectTracker/index.jsx refreshes on an interval
  // for exactly this reason), and channels.js currently publishes every event to
  // every authenticated user — switching to sockets would need that scoped first
  // or it would push other people's projects to the browser.
  //
  // Only polls while the tab is VISIBLE; a background tab refreshing every few
  // seconds is pure waste.
  useEffect(() => {
    if (!currentUser) return;
    let timer = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        // Page 1 only — re-fetching while the admin reads page 3 would yank the
        // table out from under them.
        if (currentPageNumber <= 1) getProjects(true);
      }, PROJECTS_REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Refresh on return: coming back to a stale list is exactly when the
        // delay is most noticeable.
        if (currentPageNumber <= 1) getProjects(true);
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentPageNumber]);

  useEffect(() => {
    filterProjects(selectedProjectStatus, projects);
  }, [selectedProjectStatus, projects]);

  // Arriving from the header notification bell (router state) or from the
  // "Review request" button in the admin email (?status=... in the URL, since a
  // link cannot carry router state). Either way, land on the right filter.
  // `location.key` is in the deps on purpose: it changes on EVERY navigation,
  // even to an identical URL. Without it, clicking the bell again after having
  // switched to another status card would not re-apply the filter (same search
  // string => effect never re-runs), which reads as a dead link.
  useEffect(() => {
    const fromQuery = new URLSearchParams(location.search).get("status");
    const status = location.state?.status || fromQuery;
    if (status) {
      setSelectedProjectStatus(status);
    }
  }, [location.key, location.state, location.search]);

  useEffect(() => {
    if (currentPageNumber > 1) {
      getProjectsByPage();
    }
  }, [currentPageNumber]);

  // A client sees only their own projects (enforced server-side by
  // limitProjectsToViewer), so some of these columns carry no information for
  // them: every row has the same owner, searching by user name searches a list
  // of one, and they do not assign architects.
  //
  // Declared HERE, above the first use. It was originally declared beside the
  // columns array 300 lines below and referenced in the dependency array just
  // under this line - a temporal dead zone error that threw on every render
  // and took the whole table down with it, Actions column included.
  const isClientViewer = currentUser?.permissions === USER_ROLES.USER;

  // The ⚙ menu's choices and the rows per page, remembered per user.
  const prefsUserId = currentUser?._id;
  const [tablePrefs, setTablePrefs] = useState(() => readTablePrefs(prefsUserId));
  useEffect(() => {
    setTablePrefs(readTablePrefs(prefsUserId));
  }, [prefsUserId]);
  const savePrefs = (patch) =>
    setTablePrefs((prev) => {
      const next = { ...prev, ...patch };
      writeTablePrefs(prefsUserId, next);
      return next;
    });
  const hiddenCols = Array.isArray(tablePrefs.hidden) ? tablePrefs.hidden : [];
  const denseRows = !!tablePrefs.dense;
  const perPage = ROWS_PER_PAGE.includes(tablePrefs.perPage)
    ? tablePrefs.perPage
    : DEFAULT_ROWS_PER_PAGE;
  const settableColumns = HIDEABLE_COLUMNS.filter((c) => !(c.staffOnly && isClientViewer));
  const toggleColumn = (id) =>
    savePrefs({
      hidden: hiddenCols.includes(id) ? hiddenCols.filter((c) => c !== id) : [...hiddenCols, id],
    });

  // A new search or filter starts again from page 1.
  const backToFirstPage = () => setResetPaginationToggle((t) => !t);
  const handleSearch = (value) => {
    setFilterText(value);
    backToFirstPage();
  };

  const handleFilterData = (status) => {
    setSelectedProjectStatus(status);
    backToFirstPage();
  };

  const navigateToTeams = () => {
    navigate(`/teams`);
  };

  const navigateToProjectDetails = (shareId) => {
    navigate(`/share/${shareId}`);
  };

  const filterProjects = (status, projects) => {
    if (status === "All") {
      const start = PROJECTS_PAGE_LIMIT * (currentPageNumber - 1);
      setFilterData([...projects].slice(start, PROJECTS_PAGE_LIMIT + start));
    } else {
      const filteredData = projects.filter((item) => item.status === status);
      let arr = [];
      for (
        let i = 0;
        i < Math.ceil(filteredData?.length / PROJECTS_PAGE_LIMIT);
        i++
      ) {
        arr.push(i + 1);
      }
      setPageNumbers(arr);
      setFilterData(filteredData);
    }
  };

  // `silent` skips the loading spinner. The 20s background refresh uses it —
  // flashing a spinner over a table the admin is reading, three times a minute,
  // would be worse than the staleness it fixes.
  const getProjects = async (silent = false) => {
    if (!silent) setLoading(true);
    const projectResponse = await getAllProjects(PROJECTS_PAGE_LIMIT, 0);
    if (projectResponse?.data) {
      let arr = [];
      for (
        let i = 0;
        i < Math.ceil(projectResponse?.total / PROJECTS_PAGE_LIMIT);
        i++
      ) {
        arr.push(i + 1);
      }
      setPageNumbers(arr);
      setTotalProjectsCount(projectResponse?.total);
      setProjects(projectResponse?.data);
      const openProjCount = await getOpenProjectsCount();
      setOpenProjectsCount(openProjCount);
      const closedProjCount = await getClosedProjectsCount();
      setClosedProjectsCount(closedProjCount);
      const quoteSentProjCount = await getQuotationSentProjectsCount();
      setQuotationSentProjectsCount(quoteSentProjCount);
      const quoteReqProjCount = await getQuotationRequestedProjectsCount();
      setQuotationRequestedProjectsCount(quoteReqProjCount);
    }
    if (!silent) setLoading(false);
  };

  const getProjectsByPage = async () => {
    setLoading(true);
    const projectResponse = await getAllProjects(
      PROJECTS_PAGE_LIMIT,
      (currentPageNumber - 1) * PROJECTS_PAGE_LIMIT
    );
    if (projectResponse?.data) {
      setProjects([...projects, ...projectResponse.data]);
    }
    setLoading(false);
  };

  const onUpdateProject = async (projectId, data) => {
    setLoading(true);
    const updateResponse = await updateProject(projectId, data);
    setLoading(false);
    return updateResponse;
  };

  const handleStatusChange = async (index, projectId, value) => {
    try {
      const data = { status: value };
      const res = await onUpdateProject(projectId, data);
      if (res) {
        const wa = res?.whatsapp;
        const waMsg = wa?.sent
          ? ` · WhatsApp sent to +${wa.to}`
          : wa?.skipped && wa.reason === "no_phone"
          ? " · WhatsApp skipped — no phone"
          : wa && !wa.sent && !wa.skipped
          ? " · WhatsApp failed"
          : "";
        const msg =
          value === "closed"
            ? "Project completed — the client has been notified." + waMsg
            : value === "quotation_accepted"
            ? "Marked as accepted — the client has been notified." + waMsg
            : "Status updated successfully!";
        toast.success(msg, {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
        await getProjects();
        return;
      }
    } catch (error) {
      toast.error("Status updated failed!", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      console.error("Error in handleStatusChange:", error);
    }
  };

  const getProjectStatus = (status) => {
    if (status == "All") return "All Projects";
    else if (status == "open") return "Open";
    else if (status == "quotation_requested") return "Quotation requested";
    else if (status == "quotation_pending_approval") return "Pending Approval";
    else if (status == "quotation_sent") return "Quotation sent";
    else if (status == "quotation_accepted") return "Quotation Accepted";
    else if (status == "quotation_rejected") return "Quotation Rejected";
    else if (status == "closed") return "Closed";
  };

  const handleSelectAll = (event) => {
    if (event.target.checked) {
      setSelectedProjects([...filterData]);
    } else {
      setSelectedProjects([]);
    }
  };

  const isProjectSelected = (project) => {
    return !!selectedProjects.find((pro) => project._id === pro._id);
  };

  const handleDeleteProject = async () => {
    const res = await Promise.all(
      selectedProjects.map(async (project) => {
        await deleteProject(project._id);
      })
    );
    setToggleCleared(!toggleCleared);
    await getProjects();
    setShowConfirmationModal(false);
  };

  const toggleDropdown = () => {
    setShowToggleDropdown(!showToggleDropdown);
  };

  const getProjectsBasedOnStatus = async (status) => {
    if (status === "All") {
      await getProjects();
    } else {
      setLoading(true);
      const projectResponse = await getProjectsByStatus(status);
      if (projectResponse?.data?.data) {
        let arr = [];
        for (
          let i = 0;
          i < Math.ceil(projectResponse?.data?.total / PROJECTS_PAGE_LIMIT);
          i++
        ) {
          arr.push(i + 1);
        }
        setLoading(false);
        setPageNumbers(arr);
        setProjects(projectResponse?.data?.data);
      }
    }
    console.log("selectedProjectStatus", selectedProjectStatus);
  };

  const contextActions = React.useMemo(() => {
    const handleDelete = async () => {
      if (
        window.confirm(
          `Are you sure you want to delete:\r ${selectedRows.map(
            (r) => r.title
          )}?`
        )
      ) {
        setToggleCleared(!toggleCleared);
        const res = await Promise.all(
          selectedProjects.map(async (project) => {
            await deleteProject(project._id);
          })
        );
        console.log("🚀 ~ file: Projects.jsx:333 ~ handleDelete ~ res:", res);
        console.log("🚀 ~ file: Projects.jsx:333 ~ handleDelete ~ res:", res);
        await getProjects();
        setShowConfirmationModal(false);
      }
    };

    return (
      <Button
        key="delete"
        onClick={handleDelete}
        variant="danger"
        disabled
        icon
      >
        Remove
      </Button>
    );
  }, [projects, selectedRows, toggleCleared]);

  const handleEditProject = async (project) => {
    if (editingProject?._id && project) {
      const resp = await updateProject(editingProject._id, project);
      if (resp) {
        const arr = filterData.map((proj) => {
          if (proj._id === resp._id) {
            return resp;
          }
          return proj;
        });
        setFilterData([...arr]);
        const wa = resp?.whatsapp;
        const waMsg = wa?.sent
          ? ` · WhatsApp sent to +${wa.to}`
          : wa?.skipped && wa.reason === "no_phone"
          ? " · WhatsApp skipped — no phone"
          : wa && !wa.sent && !wa.skipped
          ? " · WhatsApp failed"
          : "";
        const msg =
          project.status === "closed"
            ? "Project completed — the client has been notified." + waMsg
            : project.status === "quotation_accepted"
            ? "Marked as accepted — the client has been notified." + waMsg
            : "Project updated.";
        toast.success(msg, {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
      } else {
        toast.error("Could not update the project. Please try again.", {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
      }
    }
  };

  const handleAssignArchitect = async (architect) => {
    try {
      if (editingProject?._id && architect?._id) {
        const resp = await updateProject(editingProject._id, {
          architectUserId: architect._id,
        });

        if (resp) {
          const arr = filterData.map((proj) => {
            if (proj._id === resp._id) {
              return resp;
            }
            return proj;
          });
          setFilterData([...arr]);
          // The assignment is saved either way — only the architect's email may
          // have failed. Say which happened, so "assigned" never silently means
          // the architect was never told.
          if (resp.architectNotified) {
            toast.success("Architect assigned — they have been notified by email.", {
              position: toast.POSITION.TOP_RIGHT,
              theme: "colored",
            });
          } else {
            toast.warning(
              "Architect assigned, but the notification email could not be sent. Please tell them directly.",
              { position: toast.POSITION.TOP_RIGHT, theme: "colored", autoClose: 8000 }
            );
          }
        }
      }
    } catch (error) {
      toast.error("Architect updated failed!", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      console.error("An error occurred:", error);
    }
  };

  // Architects only see the projects they've been assigned to; admins see all.
  const scopedData =
    currentUser?.permissions === USER_ROLES.ARCHITECT
      ? filterData.filter(
          (p) =>
            p.architectUserId === currentUser?._id ||
            p.architectUser?._id === currentUser?._id
        )
      : filterData;

  // An EMPTY search box must show everything.
  //
  // The old predicate was a chain of `field && field.includes(query)` tests. On
  // an empty query `"".includes("")` is true — but ONLY for rows that have the
  // field at all. A project with no name, no clientName and no ownerUser failed
  // every branch and was silently dropped, so the table read "There are no
  // records to display" while the counters above it said 2 projects.
  // Short-circuiting on an empty query is both correct and cheaper.
  const query = (filterText || "").trim().toLowerCase();
  const matchesQuery = (value) =>
    typeof value === "string" && value.toLowerCase().includes(query);

  const filteredProjects = query
    ? scopedData.filter(
        (item) =>
          matchesQuery(item.name) ||
          matchesQuery(item.clientName) ||
          matchesQuery(item.ownerUser?.name) ||
          matchesQuery(item.ownerUser?.email) ||
          matchesQuery(item.address) ||
          matchesQuery(item.architectUser?.name) ||
          matchesQuery(item.architectUser?.email)
      )
    : scopedData;

  const isStaffAdmin =
    currentUser?.permissions === USER_ROLES.ADMIN ||
    currentUser?.permissions === USER_ROLES.SUPER_ADMIN;

  // The table's foot, told the search so its count can say "matching …".
  const Pager = React.useCallback(
    (props) => <TablePager {...props} query={(filterText || "").trim()} />,
    [filterText]
  );

  // Opens the 3D app on this project, signed in, in the same tab.
  const openDesign = (row) => {
    // Navigate in the SAME tab (not a new one). Hand the current Inspire
    // session token to the 3D app via ?login=&email= so it authenticates
    // seamlessly (its ProtectedRoute consumes these) — no bounce to the login
    // screen. Both apps validate against the same auth backend, so the token
    // is cross-valid.
    const base = process.env.REACT_APP_PAZL_DESIGN_URL || "http://localhost:3040";
    const token = getAccessToken();
    const email = currentUser?.email || "";
    const qs = new URLSearchParams();
    if (token && email) {
      qs.set("login", token);
      qs.set("email", email);
    }
    // Tell the 3D app where this hop started, so ITS back arrow returns here
    // instead of dropping the user on the 3D app's own dashboard — a page they
    // were never on. It validates this against its configured Inspire origin
    // before using it.
    qs.set("from", window.location.href);
    // Merged app: the 3D Designer lives under /design/* (Inspire owns the root
    // routes). A full-page nav is required so main.tsx loads the Designer
    // bundle instead of the Inspire one.
    window.location.href = `${base}/design/project-detail/${row._id}?${qs.toString()}`;
  };

  const hide = (id) => hiddenCols.includes(id);

  const columns = useMemo(() => [
    {
      id: "project",
      name: "Project",
      selector: (row) => row.name || "",
      cell: (row) => (
        <div className="pzp-two">
          <strong title={row.name || "Untitled project"}>{row.name || "Untitled project"}</strong>
        </div>
      ),
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
      minWidth: "200px",
    },
    ...(isClientViewer ? [] : [{
      id: "owner",
      name: "Owner",
      selector: (row) => row?.ownerUser?.name || row?.ownerUser?.email || "",
      cell: (row) => (
        <div className="pzp-two">
          <strong>{row?.ownerUser?.name || row?.ownerUser?.email || "—"}</strong>
          {row?.ownerUser?.name && row?.ownerUser?.email ? (
            <span>{row.ownerUser.email}</span>
          ) : null}
        </div>
      ),
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
      omit: hide("owner"),
      minWidth: "200px",
    }]),
    {
      id: "date",
      name: "Date",
      // Sorted by the real time; shown as "Today", "Yesterday" or "02 Nov 2026".
      selector: (row) => new Date(row.createdAt).getTime() || 0,
      cell: (row) => <span className="pzp-muted">{formatDay(row.createdAt)}</span>,
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
      omit: hide("date"),
      width: "130px",
    },
    {
      id: "client",
      omit: hide("client"),
      name: "Client",
      // Fall back to the owner account's name when the project has no explicit
      // clientName. The owner IS the client, so their account name is the right
      // stand-in — otherwise the column is blank for every project whose client
      // never filled the details form (e.g. the auto-created "My Project").
      // Display only; the stored project.clientName is left untouched.
      selector: (row) => row.clientName || row?.ownerUser?.name || "",
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
    },
    {
      id: "address",
      name: "Address",
      selector: (row) => row.address,
      cell: (row) => <span className="pzp-muted">{row.address || "—"}</span>,
      sortable: true,
      reorder: true,
      wrap: true,
      ignoreRowClick: true,
      omit: hide("address"),
    },
    ...(isClientViewer ? [] : [{
      id: "architect",
      name: "Architect",
      omit: hide("architect"),
      selector: (row) => row.architectUser?.name || row.architectUser?.email || "",
      cell: (row) => {
        const assign = () => {
          setEditingProject(row);
          setShowAssignArchitectModal(true);
        };
        if (row.architectUser) {
          const who = row.architectUser.name ?? row.architectUser.email;
          return (
            <div className="pzp-person">
              <span className="pzp-av">{initialsOf(who)}</span>
              <span className="pzp-person-name" title={who}>{who}</span>
              <button type="button" className="pzp-pencil" aria-label={`Change architect for ${row.name || "this project"}`} title="Change architect" onClick={assign}>
                <PencilIcon />
              </button>
            </div>
          );
        }
        if (isStaffAdmin) {
          return (
            <Button variant="light" className="pzp-btn pzp-btn-dashed" onClick={assign}>
              <Icon size={14} strokeWidth="2.4">
                <path d="M12 5v14M5 12h14" />
              </Icon>
              Assign architect
            </Button>
          );
        }
        return <span className="pzp-muted">Not assigned</span>;
      },
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
      minWidth: "190px",
    }]),
    {
      id: "status",
      name: "Status",
      omit: hide("status"),
      cell: (row) => {
        // A pending change replaces the whole status with a single amber
        // "Change requested" — no stacked second badge.
        const changeRequested =
          row.status === "quotation_sent" && changeReqIds.has(String(row._id));
        const statusLabel = changeRequested
          ? "⚠ Change requested"
          : getProjectStatus(row.status);
        const pillClass = changeRequested
          ? "pzp-status pzp-status--change"
          : statusClass(row.status);
        const statusTitle = changeRequested
          ? "The client requested a change — send a revised quote"
          : undefined;
        if (isStaffAdmin) {
          return (
            <Dropdown title={statusTitle || "Change status"}>
              <Dropdown.Toggle
                variant="light"
                id={`dropdown-status-${row._id}`}
                className={pillClass}
              >
                <i />
                {statusLabel}
              </Dropdown.Toggle>

              {/* The table body is a 400px `overflow-y: auto` box (DataTable's
                  fixedHeader + fixedHeaderScrollHeight), so an absolutely
                  positioned menu is clipped at the container edge — only the
                  first sliver of the status list was visible.
                  `strategy: "fixed"` positions the menu against the VIEWPORT
                  instead, which takes it out of that scroll container's clipping
                  entirely. `renderOnMount` lets Popper measure the menu before
                  it is first shown, so the very first open is placed correctly
                  rather than jumping. */}
              <Dropdown.Menu
                className="pzp-menu"
                renderOnMount
                popperConfig={{ strategy: "fixed" }}
              >
                {projectStatus.map((status, index) => (
                  <Dropdown.Item
                    key={status.id}
                    active={false}
                    onClick={() =>
                      handleStatusChange(row.index, row._id, status.value)
                    }
                  >
                    <span className={`pzp-menu-dot pzp-status--${status.value}`} />
                    {status.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          );
        } else {
          return (
            <span className={pillClass} title={statusTitle}>
              <i />
              {statusLabel}
            </span>
          );
        }
      },
      reorder: true,
      ignoreRowClick: true,
      // Let the open status menu spill out of its cell. Without this the cell
      // itself clips it, on top of the scroll-container clipping handled by the
      // menu's fixed positioning above. (`ignoreRowClick` was listed twice here;
      // the duplicate is dropped.)
      allowOverflow: true,
      minWidth: "150px",
    },
    {
      id: "actions",
      name: "Actions",
      width: isStaffAdmin ? "160px" : "110px",
      center: true,
      // One icon per action, its name on hover. The first (indigo) is the
      // main step: into the 3D app.
      cell: (row) => (
        <div className="pzp-actions">
          {/* A client now does the design themselves, so they get the
              architect's label rather than "Prepare Quote" - which described
              the old flow where someone else designed it. */}
          <ActionIcon
            primary
            label={isStaffAdmin ? "Prepare Quote" : "Open Design"}
            onClick={() => openDesign(row)}
          >
            {isStaffAdmin ? <QuoteIcon /> : <CubeIcon />}
          </ActionIcon>
          <ActionIcon
            label="Workspace"
            onClick={() => navigate(`/project-detail/${row._id}?tab=workspace`)}
          >
            <FolderIcon />
          </ActionIcon>
          {/* Edit is an admin action — hidden from architects. */}
          {isStaffAdmin && (
            <ActionIcon
              label="Edit details"
              onClick={() => {
                setEditingProject(row);
                setShowEditProjectModal(true);
              }}
            >
              <EditIcon />
            </ActionIcon>
          )}
        </div>
      ),
      ignoreRowClick: true,
      button: true,
      allowOverflow: true,
      // Clients included: this column carries Workspace and Open Design,
      // which are how they reach their own project at all. Omitting it left
      // a client with a row they could look at and not open.
      omit: !(
        currentUser?.permissions === USER_ROLES.USER ||
        currentUser?.permissions === USER_ROLES.ADMIN ||
        currentUser?.permissions === USER_ROLES.SUPER_ADMIN ||
        currentUser?.permissions === USER_ROLES.ARCHITECT
      ),
      reorder: true,
    },
  ]);

  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);

  return (
    <div className="pz-app-shell">
      <NavRail variant="app" />
      <div className="pz-app-main pz-projects-main">
      <ToastContainer />
      <ShareModal
        show={showShareModal}
        onHide={() => setShowShareModal(false)}
        shareUrl={`${currentProject?.shareId ?? projectShareId}`}
      />
      <EditProjectModal
        show={showEditProjectModal}
        onHide={() => setShowEditProjectModal(false)}
        onConfirm={handleEditProject}
        project={editingProject}
      />
      <AssignArchitectModal
        show={showAssignArchitectModal}
        onHide={() => setShowAssignArchitectModal(false)}
        onConfirm={handleAssignArchitect}
        project={editingProject}
      />
      <ConfirmationModal
        show={showConfirmationModal}
        onHide={() => setShowConfirmationModal(false)}
        body={` Are you sure you want to delete  ${
          selectedProjects.length == 1
            ? selectedProjects[0].name
            : `${selectedProjects.length} projects`
        }
      ?`}
        onConfirm={handleDeleteProject}
      />
      <div className="sticky">
        <AppHeader />
      </div>
      {/* Fills the window below the header (Projects.css), so the table's
          foot — the pagination — stays on screen instead of under the fold. */}
      <Container fluid className="pz-projects overflow-x-hidden overflow-y-auto">
        <div className="pz-projects-inner">
          <div>
            <h1 className="pzp-title">Projects</h1>
            <p className="pzp-subtitle">
              {isClientViewer
                ? "Your designs and where each quote stands."
                : "Every design, its client, its architect and where the quote stands."}
            </p>
          </div>

          {/* The counters are also the status filter: tap one to show only those. */}
          <div className="pzp-stats" role="group" aria-label="Filter by status">
            {[
              { status: "All", label: "All projects", count: totalProjectsCount },
              { status: "open", label: "Open", count: openProjectsCount },
              { status: "quotation_requested", label: "Quotation requested", count: quotationRequestedProjectsCount },
              { status: "quotation_sent", label: "Quotation sent", count: quotationSentProjectsCount },
              { status: "closed", label: "Closed", count: closedProjectsCount },
            ].map((s) => (
              <button
                key={s.status}
                type="button"
                className={`pzp-stat${selectedProjectStatus === s.status ? " is-on" : ""}`}
                aria-pressed={selectedProjectStatus === s.status}
                onClick={() => handleFilterData(s.status)}
              >
                <span className="pzp-stat-label">
                  <i style={{ background: STAT_DOT[s.status] }} />
                  {s.label}
                </span>
                <span className="pzp-stat-value">{s.count ?? "–"}</span>
              </button>
            ))}
          </div>

          <div className="pzp-card">
            <div className="pzp-toolbar">
              <div className="pzp-toolbar-title">
                {getProjectStatus(selectedProjectStatus) || "Projects"}
                <span className="pzp-count">{filteredProjects.length}</span>
              </div>
              <div className="pzp-toolbar-tools">
                {/* Searching your own single project is not a search: hidden
                    for a client, as before. */}
                {!isClientViewer && (
                  <span className="pzp-search">
                    <SearchIcon />
                    <input
                      className="pzp-search-input"
                      type="search"
                      aria-label="Search projects"
                      placeholder="Search projects, clients, addresses"
                      value={filterText}
                      onChange={(e) => handleSearch(e.target.value)}
                    />
                    {filterText ? (
                      <button type="button" className="pzp-search-clear" aria-label="Clear search" onClick={() => handleSearch("")}>
                        <ClearIcon />
                      </button>
                    ) : null}
                  </span>
                )}
                <ColumnSettings
                  columns={settableColumns}
                  hidden={hiddenCols}
                  onToggle={toggleColumn}
                  dense={denseRows}
                  onDense={(dense) => savePrefs({ dense })}
                  onReset={() => savePrefs({ hidden: [], dense: false })}
                />
              </div>
            </div>

            <DataTable
              // The table reads its rows-per-page only when it mounts, and on a
              // reload the user arrives after that. Keyed on the user, it
              // mounts again once they do and picks up their saved choice.
              key={prefsUserId || "anon"}
              columns={columns}
              data={filteredProjects}
              pagination
              paginationPerPage={perPage}
              paginationRowsPerPageOptions={ROWS_PER_PAGE}
              paginationResetDefaultPage={resetPaginationToggle}
              paginationComponent={Pager}
              onChangeRowsPerPage={(n) => savePrefs({ perPage: n })}
              fixedHeader
              contextActions={contextActions}
              // The card sets the height (Projects.css): rows scroll under a
              // sticky header, and the pager sits right below them.
              fixedHeaderScrollHeight="none"
              progressPending={loading}
              progressComponent={<TableSkeleton />}
              noDataComponent={
                <div className="pzp-empty">
                  <div className="pzp-empty-icon">
                    <Icon size={24}>
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </Icon>
                  </div>
                  {query ? (
                    <>
                      <strong>No projects match “{filterText.trim()}”</strong>
                      <span>Check the spelling, or search by client, address or architect.</span>
                      <Button variant="light" className="pzp-btn pzp-btn-secondary" onClick={() => handleSearch("")}>
                        Clear search
                      </Button>
                    </>
                  ) : selectedProjectStatus !== "All" ? (
                    <>
                      <strong>No {String(getProjectStatus(selectedProjectStatus) || "").toLowerCase()} projects</strong>
                      <span>Nothing has this status right now.</span>
                      <Button variant="light" className="pzp-btn pzp-btn-secondary" onClick={() => handleFilterData("All")}>
                        Show all projects
                      </Button>
                    </>
                  ) : (
                    <>
                      <strong>No projects yet</strong>
                      <span>New projects show here as soon as they are created.</span>
                    </>
                  )}
                </div>
              }
              customStyles={tableStyles}
              dense={denseRows}
              pointerOnHover
              highlightOnHover
              persistTableHead
              responsive
              onSelectedRowsChange={handleRowSelected}
              clearSelectedRows={toggleCleared}
            />
          </div>
        </div>
      </Container>
      </div>
    </div>
  );
};

export default Projects;
