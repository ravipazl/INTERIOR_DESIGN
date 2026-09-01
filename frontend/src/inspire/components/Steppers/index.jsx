import React, { useContext, useEffect, useState } from "react";
import { Col, Container, Nav, Row } from "react-bootstrap";
import { StepperContext } from "../../context/StepperContext";
import Stepper1 from "./Stepper1";
import Stepper2 from "./Stepper2";
import Stepper3 from "./Stepper3";
import "./index.css";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import ProjectContext from "../../context/ProjectContext";
import Stepper2Expanded from "./Stepper2Expanded";
import Stepper3Expanded from "./Stepper3Expanded";
import Stepper1Expanded from "./Stepper1Expanded";
import { useTypeStore } from "../../context/TypeStoreContext";
import ServiceContext from "../../context/ServiceContext";

const Steppers = () => {
  const { activeStep, setActiveStep, setSelectedImage, selectedImage, handleNext } =
    useContext(StepperContext);
  const { currentProject } = useContext(ProjectContext);
  const {authService, imagesService} = useContext(ServiceContext);
  const [rooms, setRooms] = useState([]);
  const [themeArray, setThemeArray] = useState([]);
  const typeStoreContext = useTypeStore();

  async function loadData() {
    if (selectedImage && selectedImage._id) {
      const tempThemeArray = await typeStoreContext.typeStore.getThemeArray();
      const uniqueThemes = new Set();
      const filteredThemes = tempThemeArray.filter((item) => {
        if (
          !uniqueThemes.has(item.theme_name) &&
          item.room_type === selectedImage.roomType
        ) {
          uniqueThemes.add(item.theme_name);
          return true;
        }
        return false;
      });

      setThemeArray(filteredThemes);
      setSelectedImage({
        ...selectedImage,
        themeName:
          selectedImage && selectedImage.themeName
            ? selectedImage.themeName
            : filteredThemes[0]?.theme_name,
      });
    } else {
      loadDataDefaultData();
    }
  }

  useEffect(() => {
    loadData();
  }, [typeStoreContext.themeInfo, selectedImage?._id]);

  async function loadDataDefaultData() {
    const tempThemeArray = await typeStoreContext.typeStore.getThemeArray();
    const uniqueThemes = new Set();
    const filteredThemes = tempThemeArray.filter((item) => {
      if (
        !uniqueThemes.has(item.theme_name) &&
        item.room_type === "Living Room"
      ) {
        uniqueThemes.add(item.theme_name);
        return true;
      }
      return false;
    });
    setThemeArray(filteredThemes);
    setSelectedImage({
      ...selectedImage,
      themeName:
        selectedImage && selectedImage.themeName
          ? selectedImage.themeName
          : filteredThemes[0]?.theme_name,
    });
  }

  useEffect(() => {
    getUserImages();
  }, [currentProject?.id]);

  const groupBy = (array, key) =>
    array.reduce((result, item) => {
      (result[item[key]] = result[item[key]] || []).push(item);
      return result;
    }, {});

  const getUserImages = async () => {
    if (currentProject && currentProject.id) {
      let images = await imagesService.getImages(currentProject?._id);
      images = images?.data;
      if (images?.length) {
        const rooms = getRoomsFromImagesData(images);
        setRooms([...rooms]);
      }
      return images;
    }
  };

  const getRoomsFromImagesData = (images) => {
    const groupedByRoom = groupBy(images, "roomName");
    let roomsList = [];
    if (groupedByRoom && Object.keys(groupedByRoom).length) {
      Object.keys(groupedByRoom).forEach((key) => {
        const roomData = {
          roomName: key,
          roomType: images.find((image) => image?.roomName === key)?.roomType,
          images: images.filter((image) => image?.roomName === key),
        };
        roomsList.push(roomData);
      });
    }
    return roomsList;
  };

  const handleTabNavigation = (event) => {
    setActiveStep(event);
    console.log('activeStep', event);
  };

  return (
    <>
      <div className="d-block d-lg-none">
        <Tabs
          variant="underline"
          className="custom-tabs"
          justify
          activeKey={activeStep}
          onSelect={handleTabNavigation}
        >
          <Tab eventKey="1" title="01 Room">
            <Stepper1Expanded
              rooms={rooms}
              setRooms={setRooms}
              themeArray={themeArray}
              handleTabNavigation={handleTabNavigation}
            />
          </Tab>
          <Tab eventKey="2" title="02 Theme">
            <Stepper2Expanded
              themeArray={themeArray}
              handleTabNavigation={handleTabNavigation}
            />
          </Tab>
          <Tab eventKey="3" title="03 Generate">
            <Stepper3Expanded />
          </Tab>
        </Tabs>
      </div>
      <div className="d-none d-lg-block">
        <div className="d-flex align-items-start justify-content-start flex-nowrap">
          <div
            className="p-0 m-0"
            style={{
              flexBasis: activeStep === 1 ? "100%" : "124px",
              minWidth: activeStep === 1 ? "calc(100% - 248px)" : "124px",
              transition: `flex-basis 0.3s`,
            }}
          >
            <Stepper1
              rooms={rooms}
              setRooms={setRooms}
              themeArray={themeArray}
            />
          </div>
          <div
            className="p-0 m-0 border"
            style={{
              flexBasis: activeStep === 2 ? "100%" : "124px",
              minWidth: activeStep === 2 ? "calc(100% - 248px)" : "124px",
              transition: `flex-basis 0.3s`,
            }}
          >
            <Stepper2 themeArray={themeArray} />
          </div>
          <div
            className="p-0 m-0"
            style={{
              flexBasis: activeStep === 3 ? "100%" : "124px",
              minWidth: activeStep === 3 ? "calc(100% - 248px)" : "124px",
              transition: `flex-basis 0.3s`,
            }}
          >
            <Stepper3 />
          </div>
        </div>
      </div>
    </>
  );
};

export default Steppers;
