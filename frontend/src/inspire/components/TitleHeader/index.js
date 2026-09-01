import React from "react";

const TitleHeader = ({ title }) => {
  return (
    <>
      <div className="title_border">
        <h5 className="ms-2 title_text d-flex">{title}</h5>
      </div>
    </>
  );
};

export default TitleHeader;
