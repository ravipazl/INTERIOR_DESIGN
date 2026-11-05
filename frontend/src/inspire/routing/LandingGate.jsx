import React, { Suspense, lazy, useEffect, useState } from "react";
import { getAccessToken, getCurrentUser } from "../services/authService";

// The landing page carries three.js; signed-in people never download it.
const Landing = lazy(() => import("../pages/Landing"));

/**
 * "/" for everyone: signed in, the page as before (its children — the
 * protected home); signed out, the landing page instead of the sign-in
 * screen. The same check ProtectedRoute makes.
 */
const LandingGate = ({ children }) => {
  const [signedIn, setSignedIn] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const token = await getAccessToken();
      const user = await getCurrentUser();
      if (live) setSignedIn(!!token && token !== "undefined" && !!user);
    })();
    return () => {
      live = false;
    };
  }, []);
  if (signedIn === null) return null;
  if (signedIn) return children;
  return (
    <Suspense fallback={null}>
      <Landing />
    </Suspense>
  );
};

/** /welcome: the landing page itself, signed in or not. */
export const LandingPage = () => (
  <Suspense fallback={null}>
    <Landing />
  </Suspense>
);

export default LandingGate;
