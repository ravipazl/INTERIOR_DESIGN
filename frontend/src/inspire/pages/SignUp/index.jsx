import React, { useState, useEffect, useContext } from "react";
import "./index.css";
import { Link, useNavigate, useLocation } from "react-router-dom";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Feedback from "react-bootstrap/Feedback";
import GoogleImg from "../../assets/images/google.svg";
import FacebookImg from "../../assets/images/facebook.svg";
import PhoneImg from "../../assets/images/phone.svg";
import { signUp } from "../../services/authService";
import UserContext from "../../context/UserContext";
import { USER_ROLES } from "../../utils/constants";
import InputGroup from "react-bootstrap/InputGroup";
import UserRoleContext from "../../context/UserRoleContext";
import ServiceContext from "../../context/ServiceContext";
import VisibilityOn from "../../assets/images/visibility-on.svg";
import VisibilityOff from "../../assets/images/visibility-off.svg";

const SignUp = () => {
  const navigate = useNavigate();
  const { setCurrentUser } = useContext(UserContext);
  const { authService } = useContext(ServiceContext);
  const [showEmailIdField, setShowEmailIdField] = useState(true);
  const [showPhoneNumField, setShowPhoneNumField] = useState(false);
  const [showOtpField, setShowOtpField] = useState(false);
  const [email, setEmail] = useState("");
  const [isEmailValid, setIsEmailValid] = useState(true);
  const [isPasswordValid, setIsPasswordValid] = useState(true);
  const [isConfirmPasswordValid, setIsConfirmPasswordValid] = useState(true);
  const [password, setPassword] = useState("");
  const [hidePassword, setHidePassword] = useState(true);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hideConfirmPassword, setHideConfirmPassword] = useState(true);
  const [error, setError] = useState("");
  const [isDuplicateEmail, setIsDuplicateEmail] = useState(false);
  const [timer, setTimer] = useState(120);
  const [signUpStatus, setSignUpStatus] = useState(true);
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

  const togglePhoneNumField = () => {
    setShowPhoneNumField(true);
    setShowEmailIdField(false);
  };

  const toggleOTPField = () => {
    setShowOtpField(true);
    setTimer(120);
  };

  const isSimilar = (text1, text2) => {
    let res = true;
    for (let i = 0; i < text1.length; i++) {
      if (text1.charAt(i) !== text2.charAt(i)) {
        res = false;
      }
    }
    return res;
  };

  const handleSignup = async () => {
    setLoading(true);
    const response = await authService.signUp({
      email,
      password,
      permissions: USER_ROLES.USER,
    });
    setLoading(false);
    if (response?.data?.message?.includes("duplicate key error collection")) {
      setIsDuplicateEmail(true);
      return;
    }
    if (response?.accessToken) {
      if (requestedFromOrigin === "pazl-3d-design" && redirectToUrl) {
        return window.location.replace(
          `${redirectToUrl}?login=${response.accessToken}&email=${response.email}`
        );
      }
      setCurrentUser(response);
      navigate("/", { state: { isSignUp: true } });
      setIsDuplicateEmail(false);
    }
  };

  const handleEmailChange = (e) => {
    const emailValue = e.target.value;
    setEmail(emailValue);
    setIsDuplicateEmail(false);
    // Basic email validation
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
    setIsEmailValid(isValid);
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  };

  const validatePassword = (password) => {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(password);
  };

  const handlePasswordValidation = (e) => {
    setPassword(e.target.value);
    const status = validatePassword(e.target.value);
    setIsPasswordValid(status);
    setHidePassword(e.target.value === "");
  };

  const handleConfirmPasswordValidation = (e) => {
    setConfirmPassword(e.target.value);
    const status = isSimilar(password, e.target.value);
    setIsConfirmPasswordValid(status); // Set status (true or false) based on password similarity
  };

  useEffect(() => {
    getSignupStatus();
  }, [
    email,
    password,
    confirmPassword,
    isEmailValid,
    isPasswordValid,
    isConfirmPasswordValid,
  ]);

  const getSignupStatus = () => {
    const isValid =
      email !== "" &&
      password !== "" &&
      confirmPassword !== "" &&
      isEmailValid &&
      isPasswordValid &&
      isConfirmPasswordValid;
    if (
      password &&
      confirmPassword &&
      password.length === confirmPassword.length &&
      isSimilar(password, confirmPassword)
    ) {
      setSignUpStatus(!isValid);
    } else {
      setSignUpStatus(true);
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
                Sign up
              </p>
            </div>
            {!showPhoneNumField && showEmailIdField && (
              <div>
                <Form.Control.Feedback className="mb-3">
                  User already exists.
                </Form.Control.Feedback>
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
                      className="mb-3 authentication_error"
                    >
                      Please enter a valid email address.
                    </Form.Control.Feedback>
                    {isDuplicateEmail && (
                      <Form.Text id="passwordHelpBlock" className="text-danger">
                        User already exists. Please sign in using same email Id
                        or use a different email Id to sign up.
                      </Form.Text>
                    )}
                  </Form.Group>
                  <div>
                    <Form.Group controlId="passwordId">
                      <InputGroup className="mb-3">
                        <div
                          className={`d-flex password-input-style ${
                            !isPasswordValid ? "invalid-password" : ""
                          }`}
                          style={{ width: "330px" }}
                        >
                          <Form.Control
                            size="sm"
                            className="password border-0 shadow-none"
                            type={hidePassword ? "password" : "text"}
                            placeholder="Password"
                            value={password}
                            onChange={handlePasswordValidation}
                            isInvalid={!isPasswordValid}
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
                                  alt="visibilityOn"
                                  className={`visibility-eye ${
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
                                  className={`visibility-eye ${
                                    password ? "icon" : ""
                                  }`}
                                />
                              </Button>
                            )}
                          </InputGroup.Text>
                        </div>
                        {!isPasswordValid && (
                          <Form.Text
                            type="invalid"
                            className="text-danger authentication_error"
                          >
                            Your password should have a minimum of 8 characters,
                            a special character, a number, lowercase and
                            uppercase.
                          </Form.Text>
                        )}
                      </InputGroup>
                    </Form.Group>
                    <Form.Group className="" controlId="confirmpwdId">
                      <InputGroup className="mb-3">
                        <div
                          className="d-flex password-input-style"
                          style={{ width: "330px" }}
                        >
                          <Form.Control
                            size="sm"
                            className="password border-0 shadow-none"
                            type={hideConfirmPassword ? "password" : "text"}
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={(e) => {
                              handleConfirmPasswordValidation(e);
                            }}
                            onBlur={handleConfirmPasswordValidation}
                            isInvalid={!isConfirmPasswordValid}
                          />
                          <InputGroup.Text
                            className="visibility-eye-container bg-white d-flex align-items-center justify-content-center border-0"
                            onClick={() =>
                              setHideConfirmPassword(!hideConfirmPassword)
                            }
                          >
                            {hideConfirmPassword ? (
                              <Button
                                className="button-icons"
                                disabled={confirmPassword.length === 0}
                              >
                                <img
                                  src={VisibilityOn}
                                  alt="VisibilityOn"
                                  className={`visibility-eye ${
                                    confirmPassword ? "icon" : ""
                                  }`}
                                />
                              </Button>
                            ) : (
                              <Button
                                className="button-icons"
                                disabled={confirmPassword.length === 0}
                              >
                                <img
                                  src={VisibilityOff}
                                  alt="VisibilityOff"
                                  className={`visibility-eye ${
                                    confirmPassword ? "icon" : ""
                                  }`}
                                />
                              </Button>
                            )}
                          </InputGroup.Text>
                        </div>
                        {!isConfirmPasswordValid && (
                          <Form.Text
                            type="invalid"
                            className="text-danger authentication_error"
                          >
                            Passwords do not match.
                          </Form.Text>
                        )}
                      </InputGroup>
                    </Form.Group>
                    {error && <p style={{ color: "red" }}>{error}</p>}
                  </div>
                  <Button
                    variant="primary"
                    className={`login primary-button-filled my-3 ${
                      signUpStatus ? "disabled-button" : ""
                    }`}
                    onClick={handleSignup}
                    disabled={signUpStatus}
                  >
                    Sign up
                  </Button>
                </Form>

                {/* <div className="my-3">
                <p className="text-center m-0 or">Or</p>
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
                      className="email_password_text mb-4"
                      type="number"
                      placeholder="Phone Number"
                    />
                  </Form.Group>
                  <Button
                    onClick={toggleOTPField}
                    variant="primary"
                    className="w-100 login custom-btn"
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
                      className="email_password_text"
                      type="number"
                      placeholder="OTP"
                    />
                  </Form.Group>
                  <Button
                    onClick={toggleOTPField}
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
            <div className="my-3 d-flex align-items-center justify-content-center w-100">
              <p className="text-muted"> Already have an account? </p>
              <Link
                to={
                  redirectToUrl && requestedFromOrigin && location.search
                    ? `/signin${location.search}`
                    : "/signin"
                }
                className="new_user_login"
              >
                <p className="ms-2">Login</p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SignUp;
