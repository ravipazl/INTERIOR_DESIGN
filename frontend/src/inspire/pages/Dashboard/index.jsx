import React from "react";
import AppHeader from "../../components/AppHeader";
import Steppers from "../../components/Steppers";
import "./index.css";

const Dashboard = (user) => {
  return (
    <>
      <AppHeader user={user} />
      <Steppers />
    </>
  );
};

export default Dashboard;
