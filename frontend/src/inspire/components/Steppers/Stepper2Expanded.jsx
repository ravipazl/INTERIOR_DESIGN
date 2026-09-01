import React, { useContext, useEffect, useState } from "react";
import { Alert, Button, Col, Navbar, Row, Stack } from "react-bootstrap";
import ArrowBack from "../../assets/images/arrow_back.svg";
import { StepperContext } from "../../context/StepperContext";
import { useTypeStore } from "../../context/TypeStoreContext";
import UserRoleContext from "../../context/UserRoleContext";
import ServiceContext from "../../context/ServiceContext";
import { removeDuplicatesInArray } from "../../utils/genericFunctions";
import ThemeRow from "../ThemeRow";
import "../UploadingRoomImageSection/index.css";
import "./index.css";
import { getAIImages } from "../../services/imagesService";

const Stepper2Expanded = ({ handleTabNavigation }) => {
  const {
    activeStep,
    selectedImage,
    setSelectedImage,
    handleNext,
    setGeneratedAIImage,
    generatedAIImage,
    setActiveStep,
    handleBack,
    setTriggerAIGeneration,
  } = useContext(StepperContext);

  const { isLoading, setLoading } = useContext(UserRoleContext);
  const { imagesService } = useContext(ServiceContext);
  const typeStoreContext = useTypeStore();
  const [themeNames, setThemeNames] = useState([]);
  const [selectedItem, setSelectedItem] = useState("Select Room");

  useEffect(() => {
    loadData();
  }, [typeStoreContext.themeInfo]);

  async function loadData() {
    const array = typeStoreContext.typeStore.getThemeNames();
    const newArray = await removeDuplicatesInArray(array);
    setThemeNames(newArray);
    setSelectedImage({
      ...selectedImage,
      themeName:
        selectedImage && selectedImage.themeName
          ? selectedImage.themeName
          : newArray[0],
    });
  }

  useEffect(() => {
    setSelectedItem(selectedImage.roomType);
    loadData();
  }, [selectedImage?._id]);

  const navigateStepperTo = (value) => {
    setActiveStep(value);
  };

  const onGenerateAIImage = async () => {
    if (selectedImage) {
      const ImageUrl = `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${selectedImage.url}`;
      const reqBody = {
        inputImage: ImageUrl,
        inputImageId: selectedImage._id,
        roomType: selectedImage.roomType,
        themeName: selectedImage.themeName,
        roomName: selectedImage.roomName,
        userId: selectedImage.userId,
        projectId: selectedImage.projectID,
      };
      handleNext();
      setLoading(true);
      setTriggerAIGeneration(true);
      let tempGeneratedImage = await imagesService.getAIImages(reqBody);
      setGeneratedAIImage(tempGeneratedImage);
      setLoading(false);
      //console.log('tempGeneratedImage', tempGeneratedImage);
      //console.log('generatedAIImage', generatedAIImage);
    }
  };

  const validateInputsForGeneration = () => {
    const isMissingThemeOrId = !selectedImage.themeName || !selectedImage._id;
    return isMissingThemeOrId;
  };

  return (
    <>
      <div className=" fluid border-right">
        <div className="d-block d-lg-none pt-3">
          {!selectedImage.themeName && (
            <Alert variant="danger" className="p-1 px-3 ">
              <i>Kindly select any theme style to generate AI Images</i>
            </Alert>
          )}
          {!selectedImage._id && (
            <Alert variant="danger" className="p-1 px-3 ">
              <i>Upload and select any room image to continue...</i>
            </Alert>
          )}
        </div>
        <Row
          className="d-none d-lg-flex d-flex align-items-center title-header-color"
          style={{
            minHeight: "100px",
            maxWidth: "87vw",
          }}
        >
          <Navbar className="p-0 d-flex align-items-center justify-content-center">
            <div className="px-3 d-flex flex-row align-items-center justify-content-between w-100">
              <div className="d-flex flex-row align-items-center">
                <Button
                  variant="text"
                  className="shadow-none"
                  onClick={handleBack}
                >
                  <img role="button" src={ArrowBack} alt="back" />
                </Button>
                <h3 className="display-5 stepper-header-number fw-bold px-2 m-0">
                  02{" "}
                </h3>
                <Navbar.Brand className="text-wrap mx-3 stepper-header-text">
                  SELECT THEME STYLES
                  {!selectedImage.themeName && (
                    <Alert variant="danger" className="py-0 px-3 mb-0 border-0">
                      <i>Kindly select any theme style to generate AI Images</i>
                    </Alert>
                  )}
                  {!selectedImage._id && (
                    <Alert variant="danger" className="p-1 px-3 ">
                      <i>
                        Upload and select any room image from previous step to
                        continue...
                      </i>
                    </Alert>
                  )}
                </Navbar.Brand>
              </div>
              <span className="d-flex align-items-center justify-content-center">
                <Button
                  disabled={validateInputsForGeneration()}
                  className="primary-button-filled"
                  onClick={onGenerateAIImage}
                  variant="primary"
                >
                  Generate
                </Button>
              </span>
            </div>
          </Navbar>
        </Row>
        <Row
          className="overflow-y-auto overflow-x-hidden mt-2 ms-0 bg-white me-3"
          style={{
            height:
              window.innerWidth > 768
                ? `calc(100vh - 180px)`
                : `calc(100vh - 260px)`,
          }}
        >
          <Col className="my-2 bg-white px-3">
            {(Array.isArray(themeNames) ? themeNames : []).map((themeName, index) => (
              <Stack gap={1} key={index}>
                <ThemeRow themeName={themeName} isViewAllImages={false} />
              </Stack>
            ))}
          </Col>
        </Row>
        <Row className="d-block d-lg-none">
          <Navbar
            fixed="bottom"
            className="bg-light p-2 d-flex justify-content-center"
          >
            <Button
              disabled={validateInputsForGeneration()}
              className="primary-button-filled w-50 m-2"
              onClick={() => {
                onGenerateAIImage();
                handleTabNavigation("3");
              }}
              variant="primary"
            >
              Generate
            </Button>
          </Navbar>
        </Row>
      </div>
    </>
  );
};

export default Stepper2Expanded;
