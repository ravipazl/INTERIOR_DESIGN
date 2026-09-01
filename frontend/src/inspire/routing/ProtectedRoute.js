import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccessToken, getCurrentUser } from "../services/authService";

const ProtectedRoute = (props) => {
  const navigate = useNavigate();
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    const accessToken = await getAccessToken();
    const currentUser = await getCurrentUser();
    if (!accessToken || accessToken === "undefined" || !currentUser) {
      setIsUserLoggedIn(false);
      return navigate("/signin", { replace: true });
    }
    setIsUserLoggedIn(true);
  };

  return (
    <React.Fragment>{isUserLoggedIn ? props.children : null}</React.Fragment>
  );
};

export default ProtectedRoute;
