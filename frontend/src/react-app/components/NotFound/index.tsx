import React from "react";
import "./index.css";

interface NotFoundProps {
  title?: string;
}

const NotFound = ({ title }: NotFoundProps) => {
  return (
    <div className="projects-not-found-container dark:bg-[#333333]">
      <img
        src={require("../../images/projects-not-found.svg")}
        className="projects-not-found-icon"
      />
      <p className="projects-not-found-title text-[#07143B] dark:text-[#FFFFFF]">
        Oops!
      </p>
      <p className="projects-not-found-subtitle text-[#07143B] dark:text-[#FFFFFF]">
        {title
          ? title
          : "looks like we're on a treasure hunt! Let's find that missing page together."}
      </p>
    </div>
  );
};

export default NotFound;
