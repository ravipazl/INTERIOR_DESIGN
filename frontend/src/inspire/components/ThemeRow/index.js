import React, { useContext, useEffect, useState } from "react";
import { StepperContext } from "../../context/StepperContext";
import { useTypeStore } from "../../context/TypeStoreContext";
import Thumbnail from "../Thumbnail";
import "./index.css";
import PhotoGallery from "../PhotoGallery";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import { v4 as uuidv4 } from "uuid";
import { LightBox } from "react-lightbox-pack";
import "react-lightbox-pack/dist/index.css";
import TitleHeader from "../../components/TitleHeader";
import ArrowIcon from "../../assets/images/arrow_circle_right.svg";

import checked from "../../assets/images/checked.svg";
import unchecked from "../../assets/images/unchecked.svg";

const ThemeRow = ({ themeName, width = 84 }) => {
  const { selectedImage, setSelectedImage } = useContext(StepperContext);
  const typeStoreContext = useTypeStore();
  const [themeArray, setThemeArray] = useState([]);
  const [defaultThumbnailArray, setDefaultThumbnailArray] = useState([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [viewThemeName, setViewThemeName] = useState("");
  const [isViewAllImages, setIsViewAllImages] = useState(false);
  const [toggle, setToggle] = React.useState(false);
  const [sIndex, setSIndex] = React.useState(0);

  useEffect(() => {
    loadData();
  }, [typeStoreContext.themeInfo, selectedImage?._id]);

  useEffect(() => {
    extractDefaultImages(themeArray);
  }, [themeArray]);

  // Handler
  const lightBoxHandler = (state, sIndex) => {
    setIsViewAllImages(state);
    setToggle(state);
    setSIndex(sIndex);
  };

  function extractDefaultImages(themeArray) {
    const filteredObjects = [];
    for (const obj of themeArray) {
      const image_name = obj.image_name;
      const [filename, extension] = image_name.split(".");
      if (filename.endsWith("-1") || filename.endsWith("-2")) {
        filteredObjects.push(obj);
      }
    }
    setDefaultThumbnailArray(filteredObjects);
  }

  async function loadData() {
    if (selectedImage && selectedImage._id) {
      const tempThemeArray = await typeStoreContext.typeStore.getThemeArray();
      const theme = tempThemeArray.filter(
        (item) =>
          item.room_type === selectedImage.roomType &&
          item.theme_name === themeName
      );
      setThemeArray(theme);
    } else {
      loadDataDefaultData();
    }
  }

  async function loadDataDefaultData() {
    const tempThemeArray = await typeStoreContext.typeStore.getThemeArray();
    const theme = tempThemeArray.filter(
      (item) =>
        item.room_type === "Living Room" && item.theme_name === themeName
    );
    setThemeArray(theme);
  }

  const handleViewAll = (value, themeName) => {
    setViewThemeName(themeName);
    setImageIndex(value);
    setIsViewAllImages(true);
    lightBoxHandler(true, 0);
  };

  const handlePhotoGalleryClosed = () => {
    setIsViewAllImages(false);
  };

  const getThemeArraywithId = () => {
    const updatedThemeArray = themeArray.map((theme) => ({
      id: uuidv4(),
      image: theme.url,
      title: theme.theme_name,
    }));
    //console.log("🚀 ~ file: index.js:95 ~ updatedThemeArray ~ updatedThemeArray:", updatedThemeArray)
    return updatedThemeArray;
  };

  const handleThemeSelect = (themeName) => {
    const newObj = { ...selectedImage, themeName: themeName };
    setSelectedImage(newObj);
  };

  const handleThumbnailSelected = (index, themeName) => {
    handleViewAll(index, themeName);
    handleThemeSelect(themeName);
    lightBoxHandler(true, index);
  };

  return (
    <>
      <Container
        fluid
        className={`row_container ${selectedImage.themeName == themeName ? "selected" : ""
          }`}
        style={{
          cursor: "pointer",
          borderRadius: "8px",
        }}
        onClick={() => handleThemeSelect(themeName)}
      >
        <Row>
          <div className="py-2 px-3 d-flex align-items-center justify-content-start w-100">
            <TitleHeader title={themeName} />
            <div>
              <Button
                variant="none"
                onClick={() => handleThemeSelect(themeName)}
                style={{
                  marginLeft: "4px",
                  padding: "0px",
                  border: "0px",
                  boxShadow: "none",
                }}
              >
                <img
                  role="button"
                  src={`${selectedImage.themeName == themeName ? checked : unchecked
                    }`}
                  alt="selection"
                  style={{ width: "24px" }}
                />

                <span className="selected">{`${selectedImage.themeName == themeName ? "Selected" : ""
                  }`}</span>
              </Button>
            </div>
          </div>
        </Row>
        <div
          className="d-flex align-items-center justify-content-start overflow-x-auto overflow-x-lg-hidden"
          style={{ paddingBottom: "10px" }}
        >
          <div className="d-flex justify-content-start">
            {themeArray.slice(0, 2).map((theme, index) => {
              return (
                < div className="mr-2 mb-1" key={index} >
                  <Thumbnail
                    imageUrl={theme.url}
                    width="288"
                    height="288"
                    handleFavSelection={() =>
                      handleThumbnailSelected(index, theme.theme_name)
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="p-3 me-5 d-flex align-items-center" onClick={() => handleViewAll(0, themeName)}>
            <p className="m-0 view-more pe-2">View more</p>
            <img src={ArrowIcon} alt="ArrowDown" />
          </div>
        </div>
      </Container>
      <div className="w-100 mt-3"></div>
      <LightBox
        state={toggle}
        event={lightBoxHandler}
        data={getThemeArraywithId()}
        imageWidth="60vw"
        imageHeight="70vh"
        thumbnailHeight={50}
        thumbnailWidth={50}
        setImageIndex={setSIndex}
        imageIndex={sIndex}
      />
    </>
  );
};

export default ThemeRow;
