import React, { useState, useEffect } from "react";
import Modal from "react-bootstrap/Modal";
import { Button, Col, Form, Row } from "react-bootstrap";
import "./index.css";

function InviteTeamsModal({
  show,
  onHide,
  selectedRoles,
  onConfirm,
  handleRoleChange,
  userForEdit,
  isCreate,
  isDuplicateEmail,
  setIsDuplicateEmail,
}) {
  const [name, setName] = useState(userForEdit?.name || "");
  const [nameError, setNameError] = useState("");
  const [email, setEmail] = useState(userForEdit?.email || "");
  const [emailError, setEmailError] = useState("");
  const [userRole, setUserRole] = useState(userForEdit?.permissions || "");
  const [roleError, setRoleError] = useState("");
  // --- KEPT FOR FUTURE USE -------------------------------------------------
  // The admin no longer sets anyone's password. Creating a member now sends an
  // invitation email and the person chooses their own password (auth-backend
  // `invite` service). The password state, handlers and form fields below are
  // COMMENTED OUT rather than deleted, so this screen can be switched back to
  // setting a password directly if that is ever needed again.
  // const [password, setPassword] = useState(userForEdit?.password || "");
  // const [passwordError, setPasswordError] = useState("");
  // const [confirmPassword, setConfirmPassword] = useState("");
  // const [confirmPasswordError, setConfirmPasswordError] = useState("");

  useEffect(() => {
    if (isCreate) {
      setName("");
      setEmail("");
      setUserRole("");
      // setPassword("");
      // setConfirmPassword("");
    }
  }, [isCreate]);

  useEffect(() => {
    if (userForEdit) {
      setName(userForEdit.name || "");
      setEmail(userForEdit.email || "");
      setUserRole(userForEdit.permissions || "");
    }
  }, [userForEdit]);

  // KEPT FOR FUTURE USE — live "passwords do not match" check.
  // useEffect(() => {
  //   if (confirmPassword && confirmPassword !== password) {
  //     setConfirmPasswordError("Passwords do not match");
  //   } else {
  //     setConfirmPasswordError("");
  //   }
  // }, [confirmPassword, password]);

  const handleNameChange = (event) => {
    const inputValue = event.target.value;
    const regex = /^[a-zA-Z\s]*$/; // Regular expression to match only letters and spaces
    if (regex.test(inputValue)) {
      setName(inputValue);
      setNameError("");
    } else {
      setNameError("Only alphabets allowed");
    }
  };

  const handleEmailChange = (event) => {
    const inputValue = event.target.value;
    setEmail(inputValue);
    const validDomainRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,4}$/;

    if (!validDomainRegex.test(inputValue)) {
      setEmailError("Please enter a valid email address");
    } else {
      if (inputValue.includes(".") && inputValue.length > 3) {
        setEmailError("");
      } else {
        setEmailError("Please enter a valid email address");
      }
    }
  };

  // KEPT FOR FUTURE USE — password + confirm-password change handlers.
  // const handlePasswordChange = (event) => {
  //   const inputValue = event.target.value;
  //   setPassword(inputValue);
  //   // Password complexity checks
  //   const hasUppercase = /[A-Z]/.test(inputValue);
  //   const hasLowercase = /[a-z]/.test(inputValue);
  //   const hasNumber = /[0-9]/.test(inputValue);
  //
  //   if (inputValue.length < 8 || !hasUppercase || !hasLowercase || !hasNumber) {
  //     setPasswordError(
  //       "Password must have 8 characters, at least one lowercase letter, one uppercase letter, and one number"
  //     );
  //   } else {
  //     setPasswordError("");
  //   }
  // };

  // const handleConfirmPasswordChange = (event) => {
  //   const inputValue = event.target.value;
  //   setConfirmPassword(inputValue);
  //
  //   if (password && inputValue !== password) {
  //     setConfirmPasswordError("Passwords do not match");
  //   } else {
  //     setConfirmPasswordError("");
  //   }
  // };

  const resetFields = () => {
    setName("");
    setNameError("");
    setEmail("");
    setEmailError("");
    // setPassword("");
    // setPasswordError("");
    // setConfirmPassword("");
    // setConfirmPasswordError("");
    setUserRole("");
    setRoleError("");
  };

  const handleSaveAndAddMore = () => {
    // Was: onConfirm(name, email, userRole, password)
    onConfirm(name, email, userRole);
    resetFields();
  };

  const handleUserRoleChange = (event) => {
    const selectedRole = event.target.value;
    console.log("Inside handleUserRoleChange", selectedRole);
    setUserRole(selectedRole);
  };

  const handleSave = () => {
    // Was: onConfirm(name, email, userRole, password)
    onConfirm(name, email, userRole);
    onHide();
    resetFields();
  };

  return (
    <Modal
      show={show || isDuplicateEmail}
      onHide={() => (isDuplicateEmail ? setIsDuplicateEmail(false) : onHide())}
      centered
    >
      <Modal.Header closeButton onClick={resetFields}>
        <Modal.Title className="fw-bold" style={{ fontSize: "18px" }}>
          Add Team
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group as={Row} className="mb-3" controlId="userName">
            <Form.Label column sm="4" className="form_input_text">
              User name
            </Form.Label>
            <Col sm="8">
              <Form.Control
                type="text"
                value={name}
                placeholder="Enter name"
                autoFocus
                onChange={handleNameChange}
              />
              {nameError && <div className="error_text">{nameError}</div>}
              {isDuplicateEmail && (
                <Form.Text id="passwordHelpBlock" className="error_text">
                  User already exist. Please sign in using same email Id or use
                  a differenet email Id.
                </Form.Text>
              )}
            </Col>
          </Form.Group>
          <Form.Group as={Row} className="mb-3" controlId="emailId">
            <Form.Label column sm="4" className="form_input_text">
              Email ID
            </Form.Label>
            <Col sm="8">
              <Form.Control
                type="email"
                value={email}
                placeholder="name@example.com"
                onChange={handleEmailChange}
              />
              {emailError && <div className="error_text">{emailError}</div>}
            </Col>
          </Form.Group>
          {/* KEPT FOR FUTURE USE — the Password / Confirm Password fields.
              The admin no longer sets anyone's password: an invitation email is
              sent and the person chooses their own (auth-backend `invite`).
              Restore this block (and the state/handlers above) to go back to
              setting a password here.

          {isCreate && (
            <Form.Group as={Row} className="mb-3" controlId="password">
              <Form.Label column sm="4" className="form_input_text">
                Password
              </Form.Label>
              <Col sm="8">
                <Form.Control
                  type="password"
                  value={password}
                  placeholder="******"
                  onChange={handlePasswordChange}
                />
                {passwordError && (
                  <div className="error_text">{passwordError}</div>
                )}
              </Col>
            </Form.Group>
          )}
          {isCreate && (
            <Form.Group as={Row} className="mb-3" controlId="confirmPassword">
              <Form.Label column sm="4" className="form_input_text">
                Confirm Password
              </Form.Label>
              <Col sm="8">
                <Form.Control
                  type="password"
                  value={confirmPassword}
                  placeholder="******"
                  onChange={handleConfirmPasswordChange}
                />
                {confirmPasswordError && confirmPassword && (
                  <div className="error_text">{confirmPasswordError}</div>
                )}
              </Col>
            </Form.Group>
          )}
          */}
          <Form.Group as={Row} className="mb-3" controlId="confirmPassword">
            <Form.Label column sm="4" className="form_input_text">
              Select Roles
            </Form.Label>
            <Col sm="8">
              {/* Admin is intentionally NOT invitable from the UI — the initial
                  admin is created with `scripts/create-admin.js`. Only Architect
                  and User can be invited here. */}
              <Form.Check
                type="checkbox"
                label="Architect"
                value="architect"
                checked={userRole === "architect"}
                onChange={handleUserRoleChange}
              />
              <Form.Check
                type="checkbox"
                label="User"
                value="user"
                checked={userRole === "user"}
                onChange={handleUserRoleChange}
              />
              {roleError && <div className="error_text">{roleError}</div>}
            </Col>
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer className="bg-light justify-content-center">
        <Button
          variant="outlined"
          className="outline-button"
          disabled={!name || !email || !userRole}
          onClick={handleSaveAndAddMore}
        >
          Save & Add more
        </Button>
        <Button
          variant="primary"
          className="primary-button-filled"
          disabled={!name || !email || !userRole}
          onClick={handleSave}
          style={{ minWidth: "130px" }}
        >
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default InviteTeamsModal;
