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
import TitleHeader from "../../../components/TitleHeader";
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
// ToastContainer is already mounted by <AppHeader /> on this page.
import { toast } from "react-toastify";
import DataTable, { createTheme } from "react-data-table-component";
import { styled } from "styled-components";
import memoize from "memoize-one";
import CloseIcon from "@mui/icons-material/Close";

const getColorForRole = (role) => {
  switch (role) {
    case "admin":
      return "primary";
    case "architect":
      return "secondary";
    case "user":
      return "info";
    default:
      return "light";
  }
};

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
  <div className="d-flex align-items-lg-center mb-lg-0 mb-2">
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
);

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
      sortable: true,
      reorder: true,
    },
    {
      name: "Email",
      selector: (row) => row.email,
      reorder: true,
    },
    {
      name: "Role",
      cell: (row) => (
        <Badge variant={getColorForRole(row.permissions)}>
          {row.permissions}
        </Badge>
      ),
      sortable: true,
      reorder: true,
    },
    {
      name: "Actions",
      cell: (row) => (
        <Button
          variant="outline-primary"
          onClick={() => {
            setSelectedUserForEdit(row);
            setShowInviteMemberModal(true);
          }}
        >
          Edit
        </Button>
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

  const subHeaderComponentMemo = React.useMemo(() => {
    const handleClear = () => {
      if (filterText) {
        setResetPaginationToggle(!resetPaginationToggle);
        setFilterText("");
      }
    };

    return (
      <div className="d-flex flex-md-row flex-column align-items-lg-center justify-content-between w-100 bg-transparent">
        <TitleHeader title="Teams" />
        <div className="d-flex flex-md-row flex-column align-items-lg-center p-lg-2 pt-3">
          <FilterComponent
            onFilter={(e) => setFilterText(e.target.value)}
            onClear={handleClear}
            filterText={filterText}
          />
          <Button
            className="primary-button-filled ms-lg-3"
            variant="primary"
            onClick={() => {
              setSelectedUserForEdit(null);
              setShowInviteMemberModal(true);
            }}
          >
            Invite Member
          </Button>
        </div>
      </div>
    );
  }, [filterText, resetPaginationToggle]);

  return (
    <>
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

      <Container fluid className="p-4 bg-light h-100vh overflow-auto">
        <DataTable
          columns={columns}
          data={filteredTeamItems}
          pagination
          fixedHeader
          fixedHeaderScrollHeight="500px"
          progressPending={loading}
          pointerOnHover
          highlightOnHover
          persistTableHead
          responsive
          striped
          subHeader
          subHeaderComponent={subHeaderComponentMemo}
        />
      </Container>
    </>
  );
};

export default Teams;
