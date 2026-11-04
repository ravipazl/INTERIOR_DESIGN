import React, { useState, useEffect, useContext, useRef } from "react";
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
import AuthLayout from "../../components/AuthLayout";

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

  /**
   * Enter in the password field logs in, exactly as the Login button does.
   *
   * The button is a plain button, not a submit, so the form never submitted on
   * Enter and the key did nothing. preventDefault stops the browser reloading
   * the page on an implicit submit, and the guard is the SAME `signInStatus`
   * that disables the button — so Enter can never do anything a click could
   * not, such as sending an empty or badly formed email.
   */
  const handlePasswordKeyDown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!signInStatus && !autofilled) return;
    handleLogin();
  };

  // Chrome's saved-login fill puts the email and password in the fields
  // WITHOUT an input event, so `email` / `password` stay empty and the button
  // looked disabled over a filled form. The fill starts a 1 ms CSS animation
  // (AuthLayout/index.css, `pza-autofill`). Seeing it:
  //  - a value the page can read goes straight into state, exactly as typing
  //    would — otherwise React's next render would put the empty state back
  //    into the field and wipe the fill;
  //  - a value Chrome still hides (it shows saved passwords to the page only
  //    after the person clicks) is read by handleLogin at the click.
  // Either way the button is enabled over a filled form.
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [autofilled, setAutofilled] = useState(false);
  const onAutofill = (e) => {
    if (e.animationName !== "pza-autofill") return;
    const value = e.target.value;
    if (value && e.target === emailRef.current) {
      handleEmailChange({ target: { value } });
    } else if (value && e.target === passwordRef.current) {
      setPassword(value);
    }
    setAutofilled(true);
  };

  // Only for the button's "Signing in…" while the request runs; what signing
  // in does is unchanged.
  const [submitting, setSubmitting] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const watchCaps = (e) => {
    if (e.getModifierState) setCapsOn(e.getModifierState("CapsLock"));
  };

  const handleLogin = async () => {
    // Typed values as before; a browser-filled field's value when the typed
    // one is empty (see onAutofill).
    const loginEmail = email || emailRef.current?.value || "";
    const loginPassword = password || passwordRef.current?.value || "";
    if (!loginEmail || !loginPassword) {
      setAutofilled(false);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) {
      setIsEmailValid(false);
      setAutofilled(false);
      return;
    }
    if (loginEmail !== email) setEmail(loginEmail);
    if (loginPassword !== password) setPassword(loginPassword);

    setLoading(true);
    setSubmitting(true);
    let loginResponse;
    try {
      loginResponse = await authService.signIn({
        email: loginEmail,
        password: loginPassword,
      });
    } finally {
      // Whatever happens, the button is not left saying "Signing in…".
      setSubmitting(false);
    }
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

  const backToSignIn = () => {
    setShowForgotPasswordField(false);
    setShowEmailIdField(true);
    setResetSent(false);
  };

  return (
    <AuthLayout
      mode="signin"
      title={showForgotPasswordField ? "Reset your password" : "Welcome back"}
      subtitle={
        showForgotPasswordField
          ? "Enter your account's email and we'll send you a link to set a new password."
          : "Sign in to your Pazl workspace."
      }
      footer={
        <>
          New to Pazl?
          <Link
            to={
              redirectToUrl && requestedFromOrigin && location.search
                ? `/signup${location.search}`
                : "/signup"
            }
          >
            Create an account
          </Link>
        </>
      }
    >
            {!showPhoneNumField && showEmailIdField && (
              <div>
                <div>
                  <Form onSubmit={(e) => e.preventDefault()}>
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
                        autoFocus
                        ref={emailRef}
                        onAnimationStart={onAutofill}
                        placeholder="you@example.com"
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
                    <Form.Group controlId="passwordId">
                    <Form.Label>Password</Form.Label>
                    <InputGroup
                      className={`password-input-style ${
                        isInvalidLogin ? "invalid-password" : ""
                      }`}
                    >
                      <Form.Control
                        size="sm"
                        type={hidePassword ? "password" : "text"}
                        autoComplete="current-password"
                        ref={passwordRef}
                        onAnimationStart={onAutofill}
                        value={password}
                        placeholder="Your password"
                        className="email_password_text border-0 shadow-none"
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          watchCaps(e);
                          handlePasswordKeyDown(e);
                        }}
                        onKeyUp={watchCaps}
                        onBlur={() => setCapsOn(false)}
                        isInvalid={isInvalidLogin}
                      />
                      <InputGroup.Text
                        className="visibility-eye-container bg-white d-flex align-items-center justify-content-center border-0"
                        onClick={() => setHidePassword(!hidePassword)}
                      >
                        {hidePassword ? (
                          <Button
                            className="button-icons"
                            aria-label="Show password"
                            disabled={password.length === 0}
                          >
                            <img
                              src={VisibilityOn}
                              alt=""
                              className={`bg-transparent visibility-eye ${
                                password ? "icon" : ""
                              }`}
                            />
                          </Button>
                        ) : (
                          <Button
                            className="button-icons"
                            aria-label="Hide password"
                            disabled={password.length === 0}
                          >
                            <img
                              src={VisibilityOff}
                              alt=""
                              className={`bg-transparent visibility-eye ${
                                password ? "icon" : ""
                              }`}
                              onClick={() => setHidePassword(true)}
                            />
                          </Button>
                        )}
                      </InputGroup.Text>
                    </InputGroup>
                    {capsOn && (
                      <div className="pz-auth-caps" role="status">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m12 4 8 8h-4v4H8v-4H4z" />
                          <path d="M8 20h8" />
                        </svg>
                        Caps Lock is on
                      </div>
                    )}
                    {isInvalidLogin && (
                      <Form.Text
                        id="passwordHelpBlock"
                        className="pz-auth-error"
                        role="alert"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 8v5M12 16.5v.01" />
                        </svg>
                        <span>
                          That email and password don't match an account. Check
                          them and try again.
                        </span>
                      </Form.Text>
                    )}
                    </Form.Group>
                    <button
                      type="button"
                      onClick={toggleForgotPasswordField}
                      className="pz-auth-link"
                    >
                      Forgot password?
                    </button>
                    <Button
                      variant="primary"
                      className="pz-auth-submit"
                      onClick={handleLogin}
                      disabled={(!signInStatus && !autofilled) || submitting}
                    >
                      {submitting ? (
                        <>
                          <span className="pz-auth-spin" aria-hidden="true" />
                          Signing in…
                        </>
                      ) : (
                        "Sign in"
                      )}
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
                  <Form onSubmit={(e) => e.preventDefault()}>
                    <Form.Group
                      className="email_password_text_field"
                      controlId="resetEmailId"
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
                      <Form.Control.Feedback type="invalid" className="mb-3">
                        Please enter a valid email address.
                      </Form.Control.Feedback>
                    </Form.Group>
                    <Button
                      variant="primary"
                      className="pz-auth-submit"
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
                <button
                  type="button"
                  className="pz-auth-link is-start"
                  style={{ marginTop: 16 }}
                  onClick={backToSignIn}
                >
                  ‹ Back to sign in
                </button>
              </div>
            )}
    </AuthLayout>
  );
};

export default SignIn;
