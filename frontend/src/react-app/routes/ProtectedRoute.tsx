import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AuthService } from "../services/authService";
import { UserPermission } from "../entities/User";

const ProtectedRoute = (props: any) => {
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const loginAccessToken = params.has("login") ? params.get("login") : null;
  const emailId = params.has("email") ? params.get("email") : null;

  useEffect(() => {
    if (loginAccessToken) {
      AuthService.setAccessToken(loginAccessToken);
      getUserDetails();
    } else {
      checkLoginStatus();
    }
  }, [loginAccessToken, emailId]);

  const getUserDetails = async () => {
    if (emailId) {
      const getUserDetailsResponse = await AuthService.getUserByEmailId(
        emailId
      );
      console.debug(
        "ProtectedRote.tsx ~ getUserDetails ~ getUserDetailsResponse",
        getUserDetailsResponse
      );
      if (getUserDetailsResponse) {
        checkLoginStatus();
      }
    } else {
      const getUserDetailsResponse = await AuthService.getUser();
      console.debug(
        "ProtectedRote.tsx ~ getUserDetails ~ getUserDetailsResponse",
        getUserDetailsResponse
      );
      if (getUserDetailsResponse) {
        checkLoginStatus();
      }
    }
  };

  const checkLoginStatus = async () => {
    const accessToken = AuthService.getAccessToken();
    const currentUser = AuthService.getCurrentUser();
    console.debug(
      "ProtectedRote.tsx ~ checkLoginStatus ~ currentUser",
      currentUser
    );
    if (!accessToken || accessToken === "undefined" || !currentUser) {
      setIsUserLoggedIn(false);
      return window.location.replace(
        `${process.env.REACT_APP_PAZL_INSPIRE_URL}/signin?requestedFrom=pazl-3d-design&redirectTo=${window.location.origin}${window.location.pathname}`
      );
    }
    // Clients (role 'user') do NOT belong in the design / 3D app — this is the
    // team workspace. Send them back to the Inspire (client) app instead of
    // showing them the designer site.
    if (currentUser.permissions === UserPermission.USER) {
      setIsUserLoggedIn(false);
      return window.location.replace(
        `${process.env.REACT_APP_PAZL_INSPIRE_URL}`
      );
    }
    setIsUserLoggedIn(true);
  };

  return (
    <React.Fragment>{isUserLoggedIn ? props.children : null}</React.Fragment>
  );
};

export default ProtectedRoute;
