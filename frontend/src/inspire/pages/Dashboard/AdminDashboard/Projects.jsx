import React, { useContext, useEffect, useMemo, useState } from "react";
import Form from "react-bootstrap/Form";
import Pagination from "react-bootstrap/Pagination";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Badge, Col, Container, Dropdown, Row } from "react-bootstrap";
import VerticalDot from "../../../assets/images/more_vert_dot.svg";
import "./index.css";
import ProjectContext from "../../../context/ProjectContext";
import Button from "react-bootstrap/Button";
import AppHeader from "../../../components/AppHeader";
import ConfirmationModal from "../../../components/ConfirmationModal";
import { DashboardCard } from "../../../components/DashboardCard";
import TitleHeader from "../../../components/TitleHeader";
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
import CloseIcon from "@mui/icons-material/Close";
import { styled } from "styled-components";
import differenceBy from "lodash/differenceBy";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import EditIcon from "../../../assets/images/architect_edit.svg";

const TextField = styled.input`
  height: 40px;
  width: 200px;
  border-radius: 3px;
  border-top-left-radius: 5px;
  border-bottom-left-radius: 5px;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border: 1px solid #e5e5e5;
  padding: 0 32px 0 16px;
  &:hover {
    cursor: pointer;
  }
`;

const FilterComponent = ({ filterText, onFilter, onClear }) => (
  <>
    <div className="d-flex align-items-center p-2">
      <TextField
        id="search"
        type="text"
        placeholder="Search by user name"
        aria-label="Search Input"
        value={filterText}
        onChange={onFilter}
      />
      <CloseIcon className="close-btn" type="button" onClick={onClear} />
    </div>
  </>
);

const getColorForStatus = (status) => {
  switch (status) {
    case "open":
      return "primary";
    case "quotation_requested":
      return "danger";
    case "quotation_pending_approval":
      return "warning";
    case "quotation_sent":
      return "success";
    case "quotation_accepted":
      return "info";
    case "quotation_rejected":
      return "danger";
    case "closed":
      return "light";
    default:
      return "light";
  }
};

const PROJECTS_PAGE_LIMIT = 50;

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

  const subHeaderComponentMemo = React.useMemo(() => {
    const handleClear = () => {
      if (filterText) {
        setResetPaginationToggle(!resetPaginationToggle);
        setFilterText("");
      }
    };

    return (
      <>
        <div className="d-flex align-items-center justify-content-between w-100 bg-transparent">
          <TitleHeader title="All Projects" />
          <FilterComponent
            onFilter={(e) => setFilterText(e.target.value)}
            onClear={handleClear}
            filterText={filterText}
          />
        </div>
      </>
    );
  }, [filterText, resetPaginationToggle]);

  const handleFilterData = (status) => {
    setSelectedProjectStatus(status);
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

  const getProjects = async () => {
    setLoading(true);
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
    setLoading(false);
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

  const filteredProjects = scopedData.filter(
    (item) =>
      (item.name &&
        item.name.toLowerCase().includes(filterText.toLowerCase())) ||
      (item.clientName &&
        item.clientName.toLowerCase().includes(filterText.toLowerCase())) ||
      (item.ownerUser &&
        ((item.ownerUser.name &&
          item.ownerUser.name
            .toLowerCase()
            .includes(filterText.toLowerCase())) ||
          (item.ownerUser.email &&
            item.ownerUser.email
              .toLowerCase()
              .includes(filterText.toLowerCase()))))
  );

  const columns = useMemo(() => [
    {
      name: "Owner User Name",
      selector: (row) => {
        const namePart = row?.ownerUser?.name
          ? row?.ownerUser?.name + " / "
          : "";
        const emailPart = row?.ownerUser?.email;
        return namePart + emailPart;
      },
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
    },
    {
      name: "Date",
      selector: (row) => {
        const createdDate = new Date(row.createdAt);
        const todayDate = new Date();
        const yesterdayDate = new Date(todayDate);
        yesterdayDate.setDate(todayDate.getDate() - 1);
        if (createdDate.toDateString() === todayDate.toDateString()) {
          return "Today";
        } else if (
          createdDate.toDateString() === yesterdayDate.toDateString()
        ) {
          return "Yesterday";
        } else {
          return createdDate.toDateString();
        }
      },
      sortable: true,
      reorder: true,
      ignoreRowClick: true,
    },
    {
      name: "Client Name",
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
      name: "Address",
      selector: (row) => row.address,
      sortable: true,
      reorder: true,
      wrap: true,
      ignoreRowClick: true,
    },
    {
      name: "Architect",
      selector: (row) => {
        if (row.architectUser) {
          return (
            <div className="d-flex ">
              <span className="py-2 w-100 text-truncate flex-grow-1">
                {row.architectUser.name ?? row.architectUser.email}
              </span>
              <img
                src={EditIcon}
                alt="edit-icon"
                className="flex-shrink-1"
                onClick={() => {
                  setEditingProject(row);
                  setShowAssignArchitectModal(true);
                }}
              />
            </div>
          );
        } else {
          if (
            currentUser?.permissions === USER_ROLES.ADMIN ||
            currentUser?.permissions === USER_ROLES.SUPER_ADMIN
          ) {
            return (
              <Button
                className="w-100"
                variant="outline-secondary"
                onClick={() => {
                  setEditingProject(row);
                  setShowAssignArchitectModal(true);
                }}
              >
                Assign Architect
              </Button>
            );
          } else {
            return null;
          }
        }
      },
      reorder: true,
      ignoreRowClick: true,
      minWidth: "203px",
    },
    {
      name: "Status",
      cell: (row) => {
        // A pending change replaces the whole status with a single amber
        // "Change requested" — no stacked second badge.
        const changeRequested =
          row.status === "quotation_sent" && changeReqIds.has(String(row._id));
        const statusLabel = changeRequested
          ? "⚠ Change requested"
          : getProjectStatus(row.status);
        const statusVariant = changeRequested
          ? "warning"
          : getColorForStatus(row.status);
        const statusTitle = changeRequested
          ? "The client requested a change — send a revised quote"
          : undefined;
        if (
          currentUser?.permissions === USER_ROLES.ADMIN ||
          currentUser?.permissions === USER_ROLES.SUPER_ADMIN
        ) {
          return (
            <Dropdown title={statusTitle}>
              <Dropdown.Toggle
                variant={statusVariant}
                id={`dropdown-status-${row.index}`}
                style={{
                  width: "100%",
                  fontSize: "12px",
                }}
                className="d-flex align-items-center justify-content-between"
              >
                {statusLabel}
              </Dropdown.Toggle>

              <Dropdown.Menu>
                {projectStatus.map((status, index) => (
                  <Dropdown.Item
                    key={status.id}
                    onClick={() =>
                      handleStatusChange(row.index, row._id, status.value)
                    }
                  >
                    {status.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          );
        } else {
          return (
            <Badge
              title={statusTitle}
              style={{
                width: "150px",
                fontSize: "12px",
                padding: "10px",
              }}
              bg={statusVariant}
            >
              {statusLabel}
            </Badge>
          );
        }
      },
      ignoreRowClick: true,
      reorder: true,
      ignoreRowClick: true,
      minWidth: "150px",
    },
    {
      name: "Actions",
      minWidth: "460px",
      cell: (row) => (
        <>
          <Button
            variant="outline-success"
            onClick={() => navigate(`/project-detail/${row._id}?tab=workspace`)}
            title="Open the project's documents, tasks, changes & discussions"
          >
            Workspace
          </Button>
          <Button
            variant="dark mx-2"
            onClick={() => {
              // Navigate in the SAME tab (not a new one). Hand the current
              // Inspire session token to the 3D app via ?login=&email= so it
              // authenticates seamlessly (its ProtectedRoute consumes these) —
              // no bounce to the login screen. Both apps validate against the
              // same auth backend, so the token is cross-valid.
              const base =
                process.env.REACT_APP_PAZL_DESIGN_URL || "http://localhost:3040";
              const token = getAccessToken();
              const email = currentUser?.email || "";
              const qs = new URLSearchParams();
              if (token && email) {
                qs.set("login", token);
                qs.set("email", email);
              }
              // Tell the 3D app where this hop started, so ITS back arrow
              // returns here instead of dropping the user on the 3D app's own
              // dashboard — a page they were never on. It validates this
              // against its configured Inspire origin before using it.
              qs.set("from", window.location.href);
              // Merged app: the 3D Designer lives under /design/* (Inspire owns
              // the root routes). A full-page nav is required so main.tsx loads
              // the Designer bundle instead of the Inspire one.
              window.location.href = `${base}/design/project-detail/${row._id}?${qs.toString()}`;
            }}
            title="Open the 3D app to design this project / build its BOQ"
          >
            {currentUser?.permissions === USER_ROLES.ARCHITECT
              ? "Open Design"
              : "Prepare Quote"}
          </Button>
          {/* Edit / Share are admin actions — hidden from architects. */}
          {(currentUser?.permissions === USER_ROLES.ADMIN ||
            currentUser?.permissions === USER_ROLES.SUPER_ADMIN) && (
            <>
              <Button
                variant="outline-primary mx-2"
                onClick={() => {
                  setEditingProject(row);
                  setShowEditProjectModal(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setShowShareModal(true);
                  setProjectShareId(row?.shareId);
                }}
              >
                Share
              </Button>
            </>
          )}
        </>
      ),
      ignoreRowClick: true,
      button: true,
      allowOverflow: true,
      omit: !(
        currentUser?.permissions === USER_ROLES.ADMIN ||
        currentUser?.permissions === USER_ROLES.SUPER_ADMIN ||
        currentUser?.permissions === USER_ROLES.ARCHITECT
      ),
      reorder: true,
    },
  ]);

  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);

  return (
    <>
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
      <Container
        fluid
        className="p-4 bg-light overflow-x-hidden overflow-y-auto"
        style={{
          height: "100vh",
        }}
      >
        <div className="d-flex flex-wrap align-items-center justify-content-start">
          <Row className="gx-0 row-cols-auto">
            <Col>
              <DashboardCard
                title={"All projects"}
                subtitle={totalProjectsCount}
                handleView={() => handleFilterData("All")}
                variant="primary"
                isSelected={selectedProjectStatus === "All"}
              />
            </Col>
            <Col>
              <DashboardCard
                title={"Open"}
                subtitle={openProjectsCount}
                handleView={() => handleFilterData("open")}
                variant="info"
                isSelected={selectedProjectStatus === "open"}
              />
            </Col>
            <Col>
              <DashboardCard
                title={"Quotation requested"}
                subtitle={quotationRequestedProjectsCount}
                handleView={() => handleFilterData("quotation_requested")}
                variant="danger"
                isSelected={selectedProjectStatus === "quotation_requested"}
              />
            </Col>
            <Col>
              <DashboardCard
                title={"Closed"}
                subtitle={closedProjectsCount}
                handleView={() => handleFilterData("closed")}
                variant="success"
                isSelected={selectedProjectStatus === "closed"}
              />
            </Col>
            <Col>
              <DashboardCard
                title={"Quotation sent"}
                subtitle={quotationSentProjectsCount}
                handleView={() => handleFilterData("quotation_sent")}
                variant="secondary"
                isSelected={selectedProjectStatus === "quotation_sent"}
              />
            </Col>
          </Row>
        </div>

        <DataTable
          columns={columns}
          data={filteredProjects}
          pagination
          fixedHeader
          contextActions={contextActions}
          fixedHeaderScrollHeight="400px"
          progressPending={loading}
          pointerOnHover
          highlightOnHover
          persistTableHead
          responsive
          striped
          subHeader
          subHeaderComponent={subHeaderComponentMemo}
          onSelectedRowsChange={handleRowSelected}
          clearSelectedRows={toggleCleared}
        />
      </Container>
    </>
  );
};

export default Projects;
