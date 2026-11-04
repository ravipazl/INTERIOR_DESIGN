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
import AuthLayout from "../../components/AuthLayout";

const SignUp = () => {
  const navigate = useNavigate();
  const { setCurrentUser } = useContext(UserContext);
  const { authService } = useContext(ServiceContext);
  const [showEmailIdField, setShowEmailIdField] = useState(true);
  const [showPhoneNumField, setShowPhoneNumField] = useState(false);
  const [showOtpField, setShowOtpField] = useState(false);
  // Collected here so the client's first project can be created WITH a name
  // and address. Without them the projects list and the project header show
  // "N/A" for every client, because the auto-created project only carries a
  // title, a status and an owner id.
  const [clientName, setClientName] = useState("");
  const [address, setAddress] = useState("");
  const [isNameValid, setIsNameValid] = useState(true);
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
    // Name is required, address is not: a project with no name is a row you
    // cannot identify in the list, whereas a missing address is just a blank
    // field someone can fill in later.
    if (!clientName.trim()) {
      setIsNameValid(false);
      return;
    }
    setLoading(true);
    const response = await authService.signUp({
      email,
      password,
      name: clientName.trim(),
      address: address.trim(),
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

  // The live checklist under the password: the same three rules as
  // validatePassword, ticked as they are met.
  const passwordRules = [
    { label: "8 or more characters", ok: password.length >= 8 },
    { label: "Upper and lower case", ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: "A number", ok: /\d/.test(password) },
  ];
  const rulesMet = passwordRules.filter((r) => r.ok).length;

  return (
    <AuthLayout
      mode="signup"
      title="Create your account"
      subtitle="Your first project is ready when you sign in."
      footer={
        <>
          Already have an account?
          <Link
            to={
              redirectToUrl && requestedFromOrigin && location.search
                ? `/signin${location.search}`
                : "/signin"
            }
          >
            Sign in
          </Link>
        </>
      }
    >
            {!showPhoneNumField && showEmailIdField && (
              <div>
                <Form onSubmit={(e) => e.preventDefault()}>
                  <Form.Group
                    className="email_password_text_field"
                    controlId="clientName"
                  >
                    <Form.Label>Name</Form.Label>
                    <Form.Control
                      size="sm"
                      className="email_password_text"
                      type="text"
                      autoComplete="name"
                      placeholder="Your full name"
                      value={clientName}
                      onChange={(e) => {
                        setClientName(e.target.value);
                        if (!isNameValid) setIsNameValid(true);
                      }}
                      isInvalid={!isNameValid}
                    />
                    <Form.Control.Feedback
                      type="invalid"
                      className="mb-3 authentication_error"
                    >
                      Please enter your name.
                    </Form.Control.Feedback>
                  </Form.Group>
                  <Form.Group
                    className="email_password_text_field"
                    controlId="address"
                  >
                    <Form.Label>
                      Address <span className="pz-auth-opt">(optional)</span>
                    </Form.Label>
                    <Form.Control
                      size="sm"
                      className="email_password_text"
                      type="text"
                      autoComplete="street-address"
                      placeholder="Where the project is"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group
                    className="email_password_text_field"
                    controlId="emailId"
                  >
                    <Form.Label>Email</Form.Label>
                    <Form.Control
                      size="sm"
                      className="email_password_text"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
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
                      <Form.Label>Password</Form.Label>
                      <InputGroup>
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
                            autoComplete="new-password"
                            placeholder="Make a password"
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
                      </InputGroup>
                      {/* What the password still needs, ticked off as you
                          type — instead of one red sentence after the fact. */}
                      <div className="pz-auth-strength" style={{ marginTop: 10 }} aria-live="polite">
                        <div className={`pz-auth-bar${rulesMet === passwordRules.length ? " is-done" : ""}`}>
                          {passwordRules.map((r, i) => (
                            <i key={r.label} className={i < rulesMet ? "is-on" : ""} />
                          ))}
                        </div>
                        <ul className="pz-auth-rules">
                          {passwordRules.map((r) => (
                            <li key={r.label} className={r.ok ? "is-ok" : ""}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={r.ok ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {r.ok ? <path d="m5 12 5 5 9-10" /> : <circle cx="12" cy="12" r="8" />}
                              </svg>
                              {r.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </Form.Group>
                    <Form.Group className="" controlId="confirmpwdId" style={{ marginTop: 16 }}>
                      <Form.Label>Confirm password</Form.Label>
                      <InputGroup>
                        <div
                          className="d-flex password-input-style"
                          style={{ width: "330px" }}
                        >
                          <Form.Control
                            size="sm"
                            className="password border-0 shadow-none"
                            type={hideConfirmPassword ? "password" : "text"}
                            autoComplete="new-password"
                            placeholder="Type it again"
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
                            The two passwords don't match yet.
                          </Form.Text>
                        )}
                      </InputGroup>
                    </Form.Group>
                    {error && <p style={{ color: "red" }}>{error}</p>}
                  </div>
                  <Button
                    variant="primary"
                    className="pz-auth-submit"
                    onClick={handleSignup}
                    disabled={signUpStatus}
                  >
                    Create account
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
    </AuthLayout>
  );
};

export default SignUp;
