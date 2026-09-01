// "Set your password" — the page an invited user (or someone who forgot their
// password) lands on from the emailed link:  /set-password?token=...
//
// Deliberately reuses the SignIn page's stylesheet and markup/classes so it
// looks like it has always been part of the app — no new styling introduced.
//
// Flow: read ?token= -> choose a password -> PATCH /invite -> go to /signin.
// The token is the only credential; there is nothing to be logged in for here,
// so this page is public.
import React, { useState } from "react";
import "../SignIn/index.css";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import { Alert } from "react-bootstrap";
import VisibilityOn from "../../assets/images/visibility-on.svg";
import VisibilityOff from "../../assets/images/visibility-off.svg";
import { setPassword as setPasswordApi } from "../../services/authService";
import {
  validatePassword,
  PASSWORD_RULE_MESSAGE,
} from "../../utils/genericFunctions";

const SetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hidePassword, setHidePassword] = useState(true);
  const [hideConfirm, setHideConfirm] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  // Same rule as signup — an invited architect/admin must not be able to set a
  // weaker password than a client who signs themselves up.
  const isPasswordValid = validatePassword(password);
  const weak = password.length > 0 && !isPasswordValid;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    !!token && isPasswordValid && password === confirmPassword && !loading;

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    const res = await setPasswordApi(token, password);
    setLoading(false);
    if (res?.success) {
      setDone(true);
      // They chose their own password — send them to the normal login so it is
      // proven to work, rather than silently signing them in.
      setTimeout(() => navigate("/signin"), 1500);
      return;
    }
    setError(
      res?.message ||
        "This link is invalid or has expired. Please ask for a new one."
    );
  };

  // Someone opened /set-password with no token at all.
  if (!token) {
    return (
      <div className="container-fluid bg-light">
        <div className="h-100vh d-flex flex-column justify-content-center align-items-center">
          <div className="max-width-330">
            <Alert variant="danger">
              This link is not valid. Please use the link from your invitation
              email.
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid bg-light">
      <div className="h-100vh d-flex flex-column justify-content-center align-items-center">
        <div className="max-width-330">
          <div className="d-flex">
            <p
              style={{
                fontSize: "20px",
                marginBottom: "30px",
                borderBottom: "5px solid #414063",
              }}
            >
              Set your password
            </p>
          </div>

          {done ? (
            <Alert variant="success">
              Your password has been set. Taking you to the login page…
            </Alert>
          ) : (
            <div>
              {error && <Alert variant="danger">{error}</Alert>}
              <Form>
                {/* new password */}
                <InputGroup
                  className={`password-input-style ${
                    weak ? "invalid-password" : ""
                  }`}
                >
                  <Form.Control
                    size="sm"
                    type={hidePassword ? "password" : "text"}
                    value={password}
                    placeholder="New password"
                    className="email_password_text border-0 shadow-none"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <InputGroup.Text
                    className="visibility-eye-container bg-white d-flex align-items-center justify-content-center border-0"
                    onClick={() => setHidePassword(!hidePassword)}
                  >
                    <Button className="button-icons" disabled={!password.length}>
                      <img
                        src={hidePassword ? VisibilityOn : VisibilityOff}
                        alt={hidePassword ? "VisibilityOn" : "VisibilityOff"}
                        className={`bg-transparent visibility-eye ${
                          password ? "icon" : ""
                        }`}
                      />
                    </Button>
                  </InputGroup.Text>
                </InputGroup>
                {weak && (
                  <Form.Text className="text-danger authentication_error">
                    {PASSWORD_RULE_MESSAGE}
                  </Form.Text>
                )}

                {/* confirm password */}
                <InputGroup
                  className={`password-input-style mt-3 ${
                    mismatch ? "invalid-password" : ""
                  }`}
                >
                  <Form.Control
                    size="sm"
                    type={hideConfirm ? "password" : "text"}
                    value={confirmPassword}
                    placeholder="Confirm password"
                    className="email_password_text border-0 shadow-none"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <InputGroup.Text
                    className="visibility-eye-container bg-white d-flex align-items-center justify-content-center border-0"
                    onClick={() => setHideConfirm(!hideConfirm)}
                  >
                    <Button
                      className="button-icons"
                      disabled={!confirmPassword.length}
                    >
                      <img
                        src={hideConfirm ? VisibilityOn : VisibilityOff}
                        alt={hideConfirm ? "VisibilityOn" : "VisibilityOff"}
                        className={`bg-transparent visibility-eye ${
                          confirmPassword ? "icon" : ""
                        }`}
                      />
                    </Button>
                  </InputGroup.Text>
                </InputGroup>
                {mismatch && (
                  <Form.Text className="text-danger authentication_error">
                    Passwords do not match.
                  </Form.Text>
                )}

                <Button
                  variant="primary"
                  className={`primary-button-filled login my-3 ${
                    !canSubmit ? "disabled-button" : ""
                  }`}
                  style={{ width: "330px" }}
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                >
                  {loading ? "Saving…" : "Set password"}
                </Button>
              </Form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetPassword;
