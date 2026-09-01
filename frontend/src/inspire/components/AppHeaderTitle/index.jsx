import React from "react";

const Title = ({ title, color, fontSize, fontWeight }) => {
  const titleStyle = {
    color,
    width: "max-content",
    fontSize,
    textDecoration: "none",
    fontWeight,
  };

  return (
    <h3 className="m-0" style={titleStyle}>
      {title}
    </h3>
  );
};

export default Title;
