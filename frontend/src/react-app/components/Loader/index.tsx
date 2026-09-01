import React from "react";
import "./index.css";

const Loader = () => {
  return (
    <div className="loader-container bg-[#ffffff]">
      <div className="flex flex-col items-center">
        <img
          src={require("../../images/full-screen-loader.gif")}
          style={{ height: "30vh" }}
        />
      </div>
      <div className="loader-text-container">
        <p className="text-[#333333] text-base font-bold">Loading</p>
        <img src={require("../../images/small-loader.gif")} width={75} />
      </div>
    </div>
  );
};

export default Loader;
