import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  ButtonGroup,
  Container,
  Form,
  Row,
} from "react-bootstrap";
import "./index.css";
import Button from "react-bootstrap/Button";
import AppHeader from "../../../components/AppHeader";
import ConfirmationModal from "../../../components/ConfirmationModal";
import UserContext from "../../../context/UserContext";
import { Table, Thead, Tbody, Tr, Th, Td } from "react-super-responsive-table";
import UserRoleContext from "../../../context/UserRoleContext";
import ServiceContext from "../../../context/ServiceContext";
import {
  getTeamMembers,
  deleteUser,
  updateUser,
  createUser,
  inviteUser,
} from "../../../services/authService";
import InviteTeamsModal from "../../../components/InviteTeamsModal";
import NavRail from "@pazl/components/NavRail";
// ToastContainer is already mounted by <AppHeader /> on this page.
import { toast } from "react-toastify";
import DataTable from "react-data-table-component";
import {
  ActionIcon,
  ClearIcon,
  EditIcon,
  EmptyState,
  PlusIcon,
  ROWS_PER_PAGE,
  SearchIcon,
  TablePager,
  TableSkeleton,
  initialsOf,
  tableStyles,
} from "../../../components/PzTable";

// The role as people say it, and its badge colour (Projects.css).
const ROLE_LABEL = {
  super_admin: "Super admin",
  admin: "Admin",
  architect: "Architect",
  user: "Client",
};
const roleLabel = (role) => ROLE_LABEL[role] || role || "—";

const Teams = () => {
  const { loading, setLoading } = useContext(UserRoleContext);
  const [teams, setTeams] = useState([]);
  const { currentUser } = useContext(UserContext);
  const { authService } = useContext(ServiceContext);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showDeleteConfirmationModal, setShowDeleteConfirmationModal] =
    useState(false);
  const [showInviteMemberModal, setShowInviteMemberModal] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);
  const [updatedTeamMember, setUpdatedTeamMember] = useState([]);
  const [isDuplicateEmail, setIsDuplicateEmail] = useState(false);

  useEffect(() => {
    getTeams();
  }, [currentUser?._id]);

  const getTeams = async () => {
    setLoading(true);
    // refresh=true — always read the live list. The cached read froze the team
    // list to the first load, so an invited member vanished on the next fetch.
    const teamsResponse = await authService.getTeamMembers(true);
    if (teamsResponse?.data) {
      console.log(
        "🚀 ~ file: Teams.jsx:99 ~ getTeams ~ teamsResponse:",
        teamsResponse
      );
      setTeams(teamsResponse.data);
    }
    console.log("teamsResponse", teamsResponse);
    setLoading(false);
  };

  // Creating a member = sending an INVITE. We no longer set (or ever see) their
  // password: the backend creates the account without one and emails a one-time
  // link so they choose their own. `password` is still accepted from the modal
  // for signature compatibility, but is intentionally ignored.
  const handleCreateUser = async (name, email, permissions) => {
    try {
      const res = await inviteUser({ name, email, permissions });
      if (res?.message?.includes("duplicate key error collection")) {
        setIsDuplicateEmail(true);
        setShowInviteMemberModal(false);
        return;
      }
      if (!res?.success) {
        // The admin must know the invite did NOT go out, otherwise they sit
        // waiting for someone who was never contacted.
        toast.error(res?.message || "Could not send the invitation.", {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
        return;
      }
      // The account exists either way; only the EMAIL may have failed. Say which
      // happened, so "invited" never silently means "nobody was told".
      if (res.emailSent) {
        toast.success(`Invitation email sent to ${email}`, {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
      } else {
        toast.warning(
          `${email} was added, but the invitation email could NOT be sent (mail not configured). Send them the link manually.`,
          { position: toast.POSITION.TOP_RIGHT, theme: "colored", autoClose: 8000 }
        );
      }
      setSelectedUserForEdit(null);
      // Refetch from the server (the source of truth) so the invited member
      // persists in the list. The old optimistic add was silently dropped the
      // next time the cached team list was re-read.
      await getTeams();
    } catch (error) {
      console.log("Error inviting user:", error);
      toast.error("Could not send the invitation.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    }
  };

  const handleUpdateUser = async (name, email, permissions) => {
    try {
      const updatedUser = await authService.updateUser(
        selectedUserForEdit?._id,
        {
          name,
          email,
          permissions,
        }
      );
      if (updatedUser) {
        const newArr = teams.map((user) =>
          user?._id === updatedUser?._id ? updatedUser : user
        );
        setSelectedUserForEdit(null);
        setTeams([...newArr]);
      } else {
        console.log("User update failed");
      }
    } catch (error) {
      console.log("Error updating user:", error);
    }
  };

  const handleDeleteUser = async () => {
    try {
      const deletedUser = await authService.deleteUser(selectedUser?._id);
      if (deletedUser) {
        const newArr = teams.filter((user) => user?._id != selectedUser?._id);
        setSelectedUserForEdit(null);
        setTeams([...newArr]);
      } else {
        console.log("User deletion failed");
      }
    } catch (error) {
      console.error("Error deleting user:", error);
    }
  };

  const handleRoleChange = (role) => {
    if (selectedRoles.includes(role)) {
      setSelectedRoles(selectedRoles.filter((r) => r !== role));
    } else {
      setSelectedRoles([...selectedRoles, role]);
    }
  };

  const columns = useMemo(() => [
    {
      name: "Name",
      selector: (row) => row.name,
      // Initials beside the name; an invited member with no name yet still
      // gets a row you can tell apart, by their email.
      cell: (row) => (
        <div className="pzp-person">
          <span className={`pzp-av pzp-av--${row.permissions || "user"}`}>
            {initialsOf(row.name || row.email)}
          </span>
          <span className="pzp-person-name" title={row.name || row.email}>
            {row.name || <span className="pzp-muted">No name yet</span>}
          </span>
        </div>
      ),
      sortable: true,
      reorder: true,
      minWidth: "220px",
    },
    {
      name: "Email",
      selector: (row) => row.email,
      cell: (row) => <span className="pzp-muted">{row.email}</span>,
      reorder: true,
      minWidth: "240px",
    },
    {
      name: "Role",
      selector: (row) => row.permissions,
      cell: (row) => (
        <span className={`pzp-role pzp-role--${row.permissions || "none"}`}>
          {roleLabel(row.permissions)}
        </span>
      ),
      sortable: true,
      reorder: true,
    },
    {
      name: "Actions",
      center: true,
      width: "110px",
      cell: (row) => (
        <div className="pzp-actions">
          <ActionIcon
            label="Edit member"
            onClick={() => {
              setSelectedUserForEdit(row);
              setShowInviteMemberModal(true);
            }}
          >
            <EditIcon />
          </ActionIcon>
        </div>
      ),
      ignoreRowClick: true,
      button: true,
      allowOverflow: true,
      reorder: true,
    },
  ]);

  const handleButtonClick = () => {
    console.log("clicked");
  };

  const [filterText, setFilterText] = React.useState("");
  const [resetPaginationToggle, setResetPaginationToggle] =
    React.useState(false);

  // Show every user (including accounts with no name, e.g. pending invites);
  // when searching, match on name OR email so nobody is hidden by a blank name.
  const filteredTeamItems = teams.filter((item) => {
    const q = filterText.toLowerCase();
    if (!q) return true;
    return (
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.email && item.email.toLowerCase().includes(q))
    );
  });

  // A new search starts again from page 1.
  const handleSearch = (value) => {
    setFilterText(value);
    setResetPaginationToggle((t) => !t);
  };

  // The table's foot, told the search so its count can say "matching …".
  const Pager = React.useCallback(
    (props) => <TablePager {...props} query={filterText.trim()} />,
    [filterText]
  );

  return (
    <div className="pz-app-shell">
      <NavRail variant="app" />
      <div className="pz-app-main pz-projects-main">
      <AppHeader />
      <ConfirmationModal
        show={showDeleteConfirmationModal}
        onHide={() => setShowDeleteConfirmationModal(false)}
        body={` Are you sure you want to delete  ${selectedUser?.email} user`}
        onConfirm={handleDeleteUser}
      />

      <InviteTeamsModal
        show={showInviteMemberModal}
        onHide={() => {
          setShowInviteMemberModal(false);
          setSelectedUserForEdit(null);
        }}
        setIsDuplicateEmail={setIsDuplicateEmail}
        selectedRoles={selectedRoles}
        onConfirm={selectedUserForEdit ? handleUpdateUser : handleCreateUser}
        handleRoleChange={handleRoleChange}
        userForEdit={selectedUserForEdit}
        isDuplicateEmail={isDuplicateEmail}
        isCreate={selectedUserForEdit ? false : true}
      />

      {/* The Projects page's layout (Projects.css): one window tall, the
          table's pager always on screen. */}
      <Container fluid className="pz-projects overflow-x-hidden overflow-y-auto">
        <div className="pz-projects-inner">
          <div className="pzp-head">
            <div>
              <h1 className="pzp-title">Teams</h1>
              <p className="pzp-subtitle">
                Who can sign in to Pazl, and what each person can do.
              </p>
            </div>
            <Button
              variant="light"
              className="pzp-btn pzp-btn-primary pzp-btn-lg"
              onClick={() => {
                setSelectedUserForEdit(null);
                setShowInviteMemberModal(true);
              }}
            >
              <PlusIcon />
              Invite Member
            </Button>
          </div>

          <div className="pzp-card">
            <div className="pzp-toolbar">
              <div className="pzp-toolbar-title">
                Members
                <span className="pzp-count">{filteredTeamItems.length}</span>
              </div>
              <div className="pzp-toolbar-tools">
                <span className="pzp-search">
                  <SearchIcon />
                  <input
                    className="pzp-search-input"
                    type="search"
                    aria-label="Search members"
                    placeholder="Search by name or email"
                    value={filterText}
                    onChange={(e) => handleSearch(e.target.value)}
                  />
                  {filterText ? (
                    <button
                      type="button"
                      className="pzp-search-clear"
                      aria-label="Clear search"
                      onClick={() => handleSearch("")}
                    >
                      <ClearIcon />
                    </button>
                  ) : null}
                </span>
              </div>
            </div>

            <DataTable
              columns={columns}
              data={filteredTeamItems}
              pagination
              paginationRowsPerPageOptions={ROWS_PER_PAGE}
              paginationResetDefaultPage={resetPaginationToggle}
              paginationComponent={Pager}
              fixedHeader
              // The card sets the height (Projects.css): rows scroll under a
              // sticky header, and the pager sits right below them.
              fixedHeaderScrollHeight="none"
              progressPending={loading}
              progressComponent={<TableSkeleton label="Loading members" />}
              noDataComponent={
                filterText.trim() ? (
                  <EmptyState
                    title={`No members match “${filterText.trim()}”`}
                    hint="Check the spelling, or search by email."
                  >
                    <Button
                      variant="light"
                      className="pzp-btn pzp-btn-secondary"
                      onClick={() => handleSearch("")}
                    >
                      Clear search
                    </Button>
                  </EmptyState>
                ) : (
                  <EmptyState
                    title="No team members yet"
                    hint="Invite an architect or a client to get started."
                  />
                )
              }
              customStyles={tableStyles}
              pointerOnHover
              highlightOnHover
              persistTableHead
              responsive
            />
          </div>
        </div>
      </Container>
      </div>
    </div>
  );
};

export default Teams;
