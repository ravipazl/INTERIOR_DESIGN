import React, { useState, useEffect, useContext } from "react";
import "./index.css";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import GoogleImg from "../../assets/images/google.svg";
import FacebookImg from "../../assets/images/facebook.svg";
import PhoneImg from "../../assets/images/phone.svg";
import {
  signIn,
  requestPasswordReset,
  getAccessToken,
  getCurrentUser,
} from "../../services/authService";
import UserContext from "../../context/UserContext";
import UserRoleContext from "../../context/UserRoleContext";
import ServiceContext from "../../context/ServiceContext";
import { Alert } from "react-bootstrap";
import VisibilityOn from "../../assets/images/visibility-on.svg";
import VisibilityOff from "../../assets/images/visibility-off.svg";

const SignIn = () => {
  const { userRole, setUserRole } = useContext(UserRoleContext);
  const navigate = useNavigate();
  const { setCurrentUser, currentUser } = useContext(UserContext);
  const { authService } = useContext(ServiceContext);
  const [showEmailIdField, setShowEmailIdField] = useState(true);
  const [showPhoneNumField, setShowPhoneNumField] = useState(false);
  const [showOtpField, setShowOtpField] = useState(false);
  const [showForgotPasswordField, setShowForgotPasswordField] = useState(false);
  // Shown after a reset is requested. Deliberately the SAME message whether or
  // not the email exists — telling the user "no such account" would let anyone
  // discover who has an account here.
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hidePassword, setHidePassword] = useState(true);
  const [isEmailValid, setIsEmailValid] = useState(true);
  const [isInvalidLogin, setIsInvalidLogin] = useState(false);
  const [timer, setTimer] = useState(120);
  const [otp, setOtp] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isPhoneNumberValid, setIsPhoneNumberValid] = useState(true);
  const [isOTPValid, setIsOTPValid] = useState(true);
  const [signInStatus, setSignInStatus] = useState(true);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const redirectToUrl = params.has("redirectTo")
    ? params.get("redirectTo")
    : null;
  const requestedFromOrigin = params.has("requestedFrom")
    ? params.get("requestedFrom")
    : null;
  const { isLoading, setLoading } = useContext(UserRoleContext);

  useEffect(() => {
    let interval;

    if (showOtpField) {
      interval = setInterval(() => {
        setTimer((prevTimer) => prevTimer - 1);
      }, 1000);
    }
    return () => {
      clearInterval(interval);
    };
  }, [showOtpField]);

  useEffect(() => {
    setSignInStatus(email !== "" && password !== "" && isEmailValid);
  }, [email, password, isEmailValid]);

  useEffect(() => {
    if (requestedFromOrigin) {
      authService.signOut();
    }
  }, [requestedFromOrigin]);

  // Already signed in? Never show the login page again — e.g. the browser Back
  // button after a successful login. Bounce into the app ("/" routes to Home or
  // the admin dashboard by role). Skipped for the cross-app login handshake
  // (requestedFrom), which deliberately signs out above to force a fresh login.
  useEffect(() => {
    const redirectIfLoggedIn = () => {
      if (requestedFromOrigin) return;
      const token = getAccessToken();
      const user = getCurrentUser();
      if (token && token !== "undefined" && user?._id) {
        navigate("/", { replace: true });
      }
    };
    redirectIfLoggedIn();
    // The browser Back button restores this page from the bfcache (a frozen
    // snapshot) WITHOUT re-running React effects, so the check above never runs
    // on a Back navigation. The `pageshow` event DOES fire on a bfcache restore
    // (event.persisted === true) — re-check there so a logged-in user is still
    // bounced away instead of seeing the login page.
    window.addEventListener("pageshow", redirectIfLoggedIn);
    return () => window.removeEventListener("pageshow", redirectIfLoggedIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePhoneNumField = () => {
    setShowPhoneNumField(true);
  };

  const toggleOTPField = () => {
    setShowOtpField(true);
    setTimer(120);
  };

  const toggleForgotPasswordField = () => {
    setShowForgotPasswordField(true);
    setShowEmailIdField(false);
  };

  const handleEmailChange = (e) => {
    const emailValue = e.target.value;
    setEmail(emailValue);

    // Basic email validation
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
    setIsEmailValid(isValid);
  };

  const handlePhoneNumberChange = (e) => {
    const phoneNumberValue = e.target.value;
    if (phoneNumberValue.length === 10 || phoneNumberValue.length === 0) {
      setPhoneNumber(phoneNumberValue);
      setIsPhoneNumberValid(true);
    } else {
      setIsPhoneNumberValid(false);
    }
  };

  const handleOTPChange = (e) => {
    const otpValue = e.target.value;
    if (otpValue.length === 0 || otpValue.length === 6) {
      setOtp(otpValue);
      setIsOTPValid(true);
    } else {
      setIsOTPValid(false);
    }
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  };

  const verifyOTP = () => {
    if (otp && otp === "123456") {
      localStorage.setItem("pazl-accesss-token", `pazl-${phoneNumber}-${otp}`);
      navigate("/", { replace: true });
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    const loginResponse = await authService.signIn({
      email,
      password,
    });
    setLoading(false);
    if (loginResponse?._id) {
      if (requestedFromOrigin === "pazl-3d-design" && redirectToUrl) {
        return window.location.replace(
          `${redirectToUrl}?login=${loginResponse.accessToken}&email=${loginResponse.email}`
        );
      }
      setCurrentUser(loginResponse);
      // Single entry point: "/" (HomeDispatcher) routes each role to the right
      // landing — admin/architect to the admin dashboard, a client on to their
      // designs / upload step / first project. No role or data branching here
      // anymore; that decision lives in exactly one place.
      navigate("/", { replace: true });
    } else {
      setIsInvalidLogin(true);
    }
  };

  return (
    <>
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
                Login
              </p>
            </div>
            {!showPhoneNumField && showEmailIdField && (
              <div>
                <div>
                  <Form>
                    <Form.Group
                      className="email_password_text_field mb-3"
                      controlId="emailId"
                    >
                      <Form.Control
                        size="sm"
                        className="email_password_text"
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={handleEmailChange}
                        isInvalid={!isEmailValid} // Apply isInvalid styling if email is not valid
                      />
                      <Form.Control.Feedback
                        type="invalid"
                        className="authentication_error"
                      >
                        Please enter a valid email address.
                      </Form.Control.Feedback>
                    </Form.Group>
                    <InputGroup
                      className={`password-input-style ${
                        isInvalidLogin ? "invalid-password" : ""
                      }`}
                    >
                      <Form.Control
                        size="sm"
                        type={hidePassword ? "password" : "text"}
                        value={password}
                        placeholder="Password"
                        className="email_password_text border-0 shadow-none"
                        onChange={(e) => setPassword(e.target.value)}
                        isInvalid={isInvalidLogin}
                      />
                      <InputGroup.Text
                        className="visibility-eye-container bg-white d-flex align-items-center justify-content-center border-0"
                        onClick={() => setHidePassword(!hidePassword)}
                      >
                        {hidePassword ? (
                          <Button
                            className="button-icons"
                            disabled={password.length === 0}
                          >
                            <img
                              src={VisibilityOn}
                              alt="VisiblityOn"
                              className={`bg-transparent visibility-eye ${
                                password ? "icon" : ""
                              }`}
                            />
                          </Button>
                        ) : (
                          <Button
                            className="button-icons"
                            disabled={password.length === 0}
                          >
                            <img
                              src={VisibilityOff}
                              alt="VisibilityOff"
                              className={`bg-transparent visibility-eye ${
                                password ? "icon" : ""
                              }`}
                              onClick={() => setHidePassword(true)}
                            />
                          </Button>
                        )}
                      </InputGroup.Text>
                    </InputGroup>
                    {isInvalidLogin && (
                      <Form.Text
                        id="passwordHelpBlock"
                        className="text-danger authentication_error"
                      >
                        Invalid login credentials
                      </Form.Text>
                    )}
                    <Form.Group>
                      <p
                        onClick={toggleForgotPasswordField}
                        className="forgot_password_text"
                      >
                        Forgot password
                      </p>
                    </Form.Group>
                    <Button
                      variant="primary"
                      className={`primary-button-filled login my-3 ${
                        !signInStatus ? "disabled-button" : ""
                      }`}
                      style={{ width: "330px" }}
                      onClick={handleLogin}
                      disabled={!signInStatus}
                    >
                      Login
                    </Button>
                  </Form>
                </div>
                {/* <div className="my-3">
                <p className="text-center m-0 or">Or Continue with</p>
              </div>
              <div className="d-flex align-items-center justify-content-center">
                <img role="button" src={GoogleImg} alt="Google" />
                <img
                  role="button"
                  className="mx-4"
                  src={FacebookImg}
                  alt="Facebook"
                />
                <img
                  role="button"
                  src={PhoneImg}
                  alt="Phone"
                  onClick={togglePhoneNumField}
                />
              </div> */}
              </div>
            )}
            {showPhoneNumField && !showOtpField && (
              <div>
                <Form>
                  <Form.Group
                    className="email_password_text_field"
                    controlId="phoneNumber"
                  >
                    <Form.Control
                      onChange={handlePhoneNumberChange}
                      className="email_password_text"
                      type="number"
                      placeholder="Phone Number"
                      isInvalid={!isPhoneNumberValid}
                    />
                    <Form.Control.Feedback type="invalid" className="mb-3">
                      Please enter a valid 10 digit phone number.
                    </Form.Control.Feedback>
                  </Form.Group>
                  <Button
                    onClick={toggleOTPField}
                    variant="primary"
                    className=" login primary-button-filled"
                  >
                    Send OTP
                  </Button>
                </Form>
              </div>
            )}
            {showOtpField && (
              <div>
                <Form>
                  <Form.Group
                    className="email_password_text_field"
                    controlId="otp"
                  >
                    <Form.Control
                      onChange={handleOTPChange}
                      className="email_password_text mb-2"
                      type="number"
                      placeholder="OTP"
                      isInvalid={!isOTPValid}
                    />
                    <Form.Control.Feedback type="invalid" className="mb-3">
                      Please enter 6 digit otp sent to your phone number.
                    </Form.Control.Feedback>
                  </Form.Group>
                  <Button
                    onClick={verifyOTP}
                    variant="primary"
                    className="w-100 login custom-btn"
                  >
                    Verify OTP
                  </Button>
                </Form>
                {timer > 0 ? (
                  <p className="resendotp">
                    Resend OTP{" "}
                    <span className="text-black">({formatTime(timer)})</span>
                  </p>
                ) : (
                  <p
                    onClick={toggleOTPField}
                    className="text-black text-center resendAfterTimeup"
                  >
                    Resend OTP
                  </p>
                )}
              </div>
            )}
            {showForgotPasswordField && (
              <div>
                {resetSent ? (
                  <Alert variant="success">
                    If an account exists for that email, we’ve sent a link to
                    reset your password. Please check your inbox.
                  </Alert>
                ) : (
                  <Form>
                    <Form.Group
                      className="email_password_text_field"
                      controlId="emailId"
                    >
                      <Form.Control
                        size="sm"
                        className="email_password_text"
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={handleEmailChange}
                        isInvalid={!isEmailValid} // Apply isInvalid styling if email is not valid
                      />
                      <Form.Control.Feedback type="invalid" className="mb-3">
                        Please enter a valid email address.
                      </Form.Control.Feedback>
                    </Form.Group>
                    <Button
                      variant="primary"
                      className={`primary-button-filled login ${
                        !email || !isEmailValid ? "disabled-button" : ""
                      }`}
                      disabled={!email || !isEmailValid}
                      onClick={async () => {
                        await requestPasswordReset(email);
                        // Always show the same confirmation — see `resetSent`.
                        setResetSent(true);
                      }}
                    >
                      Send reset link
                    </Button>
                  </Form>
                )}
              </div>
            )}
            <div className="my-3 d-flex align-items-center justify-content-center w-100">
              <p className="text-muted">New User? </p>
              <Link
                to={
                  redirectToUrl && requestedFromOrigin && location.search
                    ? `/signup${location.search}`
                    : "/signup"
                }
                className="new_user_login"
              >
                <p className="ms-2">Sign up</p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SignIn;
