import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AuthService } from "../services/authService";
// UserPermission was imported only for the client-rejection check removed
// below; the guard now cares whether you are signed in, not which role.

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
    // Clients are ALLOWED in the 3D app now.
    //
    // This used to bounce role 'user' straight back to Inspire, on the basis
    // that the designer was a team-only workspace. That is no longer the
    // product: a client lands on the projects dashboard and does their own
    // floor plan, furnishing, render and BOQ - the four steps the landing page
    // advertises. With the guard in place the "Open Design" button looked
    // dead, because the redirect fired the moment the page loaded.
    //
    // Access to project DATA is still enforced server-side by
    // limitProjectsToViewer, which scopes on the caller rather than on which
    // app they happen to be in.
    setIsUserLoggedIn(true);
  };

  return (
    <React.Fragment>{isUserLoggedIn ? props.children : null}</React.Fragment>
  );
};

export default ProtectedRoute;
