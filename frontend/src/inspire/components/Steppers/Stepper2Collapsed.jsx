import React, { useContext, useState, useEffect } from "react";
import { Navbar, Row } from "react-bootstrap";
import { StepperContext } from "../../context/StepperContext";
import "../UploadingRoomImageSection/index.css";
import "./index.css";

import Thumbnail from "../Thumbnail";

const Stepper2Collapsed = ({ themeArray }) => {
  const { selectedImage, setSelectedImage, setActiveStep } =
    useContext(StepperContext);
  const [selectedImageTitle, setSelectedImageTitle] = useState(null);

  useEffect(() => {
    setSelectedImageTitle(0);
  }, []);

  const navigateStepperTo = (value) => {
    setActiveStep(value);
  };
  const handleSelectedImage = (themeName, index) => {
    const newObj = { ...selectedImage, themeName: themeName };
    setSelectedImage(newObj);
    setSelectedImageTitle(index);
  };

  return (
    <>
      <div className="h-100vh">
        <Row
          className="p-0 m-0"
          style={{
            borderBottom: "1px solid rgba(28, 27, 31, 0.25)",
            minHeight: "100px",
          }}
        >
          <Navbar
            className="d-flex flex-column align-items-center border-right
                            justify-content-center m-0 p-0 title-header-color"
          >
            <div
              className="d-flex flex-column align-items-center justify-content-center"
              style={{ cursor: "pointer" }}
              onClick={() => navigateStepperTo(2)}
            >
              <h3
                className="display-5 fw-bold m-0"
                style={{ fontSize: "36px" }}
              >
                02{" "}
              </h3>
              <Navbar.Brand
                className="text-wrap text-center fs-12 m-0 title"
                style={{ padding: "0px 0 12px 0" }}
              >
                CHOOSE A THEME
              </Navbar.Brand>
            </div>
          </Navbar>
        </Row>
        <Row
          className="text-center overflow-y-auto overflow-x-hidden ms-0 bg-white"
          style={{
            height: `calc(100vh - 140px)`,
            padding: "12px 0 100px 0",
            width: "122px",
          }}
        >
          <div className="d-flex flex-column align-items-center justify-content-start">
            {(Array.isArray(themeArray) ? themeArray : []).map((theme, index) => {
              const isSelected = selectedImageTitle === index;
              return (
                <div
                  className="d-flex flex-column"
                  style={{ height: "131px" }}
                  key={index}
                >
                  <Thumbnail
                    imageUrl={theme.url}
                    themeObj={theme}
                    forSelection={true}
                    handleCheckboxChange={() =>
                      handleSelectedImage(theme.theme_name, index)
                    }
                  />
                  <h6
                    className={`mt-1 text-center ${
                      isSelected ? "selected-room" : ""
                    }`}
                  >
                    {theme.theme_name}
                  </h6>
                </div>
              );
            })}
          </div>
        </Row>
      </div>
    </>
  );
};
export default Stepper2Collapsed;
