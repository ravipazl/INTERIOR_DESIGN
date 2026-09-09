import React, { useContext, useEffect, useState } from "react";
import { Col, Container, Nav, Row } from "react-bootstrap";
import { StepperContext } from "../../context/StepperContext";
import "./index.css";
import ProjectContext from "../../context/ProjectContext";
// Only step 1 is rendered now — see the note above the return. The imports for
// Stepper1/2/3, Stepper2Expanded, Stepper3Expanded and react-bootstrap's
// Tab/Tabs went with the renders that used them; the component FILES are all
// still here, so restoring the styling path means re-adding those imports.
import Stepper1Expanded from "./Stepper1Expanded";
import { useTypeStore } from "../../context/TypeStoreContext";
import ServiceContext from "../../context/ServiceContext";

const Steppers = () => {
  // activeStep and handleNext are no longer read here — there is one step, so
  // nothing advances. setActiveStep is kept: handleTabNavigation still hands it
  // to Stepper1Expanded, whose own modals use it.
  const { setActiveStep, setSelectedImage, selectedImage } =
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

  /**
   * The client flow is now ONE step: upload a room photo, then request a quote
   * on it.
   *
   * "02 Theme" and "03 Generate" are hidden. They were the AI styling path —
   * pick a theme, generate concepts, mark up objects — and a client had to walk
   * all three before they could ask for a price. Requesting a quote never
   * needed any of it: handleSendQuote reads only the image's _id and url, and
   * Stepper1Expanded has carried its own "Request quote" button all along.
   *
   * Stepper2 / Stepper3 and their Expanded / Collapsed halves are left in the
   * tree untouched, not deleted — restoring the styling path is a matter of
   * putting these renders back, not rebuilding three screens.
   *
   * Rendering Stepper1Expanded DIRECTLY rather than through Stepper1 is
   * deliberate: Stepper1 shows the collapsed rail whenever activeStep !== 1,
   * and with nothing left to navigate to, a stale activeStep of 2 or 3 would
   * collapse the only screen the client has to a 124px sliver.
   */
  return (
    <>
      <div className="d-block d-lg-none">
        <Stepper1Expanded
          rooms={rooms}
          setRooms={setRooms}
          themeArray={themeArray}
          handleTabNavigation={handleTabNavigation}
        />
      </div>
      <div className="d-none d-lg-block">
        <div className="p-0 m-0" style={{ width: "100%" }}>
          <Stepper1Expanded
            rooms={rooms}
            setRooms={setRooms}
            themeArray={themeArray}
          />
        </div>
      </div>
    </>
  );
};

export default Steppers;
