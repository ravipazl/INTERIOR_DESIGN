import React, { useContext, useEffect, useState } from "react";
import { Card, Col, Navbar, Row, Stack } from "react-bootstrap";
import FavOutline from "../../assets/images/favorite_add.svg";
import FavFill from "../../assets/images/favorite_fill.svg";
import { CountContext } from "../../context/CountContext";
import ProjectContext from "../../context/ProjectContext";
import { StepperContext } from "../../context/StepperContext";
import ServiceContext from "../../context/ServiceContext";
import {
  getGeneratedImages,
  updateImageInfo,
} from "../../services/imagesService";
import "../UploadingRoomImageSection/index.css";
import "./index.css";
const Stepper3Collapsed = () => {
  const {
    selectedImage,
    generatedAIImage,
    setGeneratedAIImage,
    setActiveStep,
  } = useContext(StepperContext);
  const { setHistoryStatus, setFavoriteStatus } = useContext(CountContext);
  const [imagesHistory, setImagesHistory] = useState([]);
  const [generatedDesign, setGeneratedDesign] = useState();
  const { currentProject } = useContext(ProjectContext);
  const { imagesService } = useContext(ServiceContext);
  const [filterHistoryImages, setFilterHistoryImages] = useState([]);

  const navigateStepperTo = (value) => {
    setActiveStep(value);
  };

  useEffect(() => {
    getImagesHistory();
  }, [selectedImage]);

  useEffect(() => {
    if (generatedAIImage) {
      setGeneratedDesign(generatedAIImage);
    }
  }, [generatedAIImage]);

  const getImageURL = (imageName) => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${imageName}`;
  };

  const getImagesHistory = async (refreshGeneratedImages = false) => {
    if (currentProject) {
      const imagesGenerated = await imagesService.getGeneratedImages(currentProject._id, false, refreshGeneratedImages);
      if (imagesGenerated && imagesGenerated["data"]?.length) {
        setImagesHistory(imagesGenerated.data);
        setHistoryStatus();
      }
    }
  };

  const handleFavAddClick = async (image) => {
    if (!image || !generatedDesign) {
      return;
    }

    const updateImageResponse = await imagesService.updateImageInfo(image?._id, {
      isFavorite: !image.isFavorite,
    });

    setFavoriteStatus();

    if (image._id === generatedDesign._id) {
      setGeneratedAIImage(updateImageResponse);
    }
    await getImagesHistory(true);
  };

  useEffect(() => {
    if (selectedImage && imagesHistory.length) {
      const filterData = imagesHistory.filter(
        (image) => image.inputImageId === selectedImage._id
      );
      filterData.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      setFilterHistoryImages(filterData);
      if (
        !generatedDesign ||
        generatedDesign.inputImageId !== selectedImage._id
      ) {
        setGeneratedDesign(filterData[0]);
      }
      filterData.sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) {
          return -1; // a comes before b
        }
        if (!a.isFavorite && b.isFavorite) {
          return 1; // b comes before a
        }
        return 0; // no change in order
      });
    } else {
      setFilterHistoryImages(imagesHistory);
    }
  }, [imagesHistory, selectedImage]);

  return (
    <>
      <div className="h-100vh" style={{ marginLeft: '1px' }}>
        <Row
          className="p-0 m-0"
          style={{
            borderBottom: "1px solid rgba(28, 27, 31, 0.25)",
            minHeight: "101px",
          }}
        >
          <Navbar className="d-flex flex-column align-items-center 
                             justify-content-center m-0 p-0 title-header-color">
            <div
              className="d-flex flex-column align-items-center justify-content-center"
              style={{ cursor: "pointer" }}
              onClick={() => navigateStepperTo(3)}
            >
              <h3 className="display-5 fw-bold px-2 m-0"
                style={{ fontSize: '36px' }}
              >03 </h3>
              <Navbar.Brand
                className="text-wrap text-center fs-16 title w-100 m-0"
                style={{ padding: "0px 0 12px 0" }}
              >
                GENERATE INSPIRATION
              </Navbar.Brand>
            </div>
          </Navbar>
        </Row>
        <Row className="h-75 text-center d-flex align-items-center justify-content-center"
          style={{ minWidth: '100px', paddingLeft: '10px', maxWidth: '130px' }}
        >
          {filterHistoryImages && filterHistoryImages.length > 0 && (
            <Col
              className="text-center overflow-y-auto overflow-x-hidden bg-white"
              style={{ height: `calc(100vh - 140px)`, padding: "12px 0 100px 0" }}
            >
              <h6 className="text-center" style={{ fontSize: "14px" }}>
                History
              </h6>
              <Stack
                gap={2}
                className="text-center d-flex align-items-center mb-5"
              >
                {(Array.isArray(filterHistoryImages) ? filterHistoryImages : []).map((image, index) => (
                  <Card
                    key={index}
                    onClick={() => setGeneratedDesign(image)}
                    style={{
                      backgroundImage: `url(${getImageURL(image.url)})`,
                      backgroundSize: "cover",
                      backgroundPosition: "top center",
                      backgroundRepeat: "no-repeat",
                      backgroundColor: "transparent",
                      border: "none",
                      width: "7rem",
                      height: "7rem",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                    className="history-card"
                  >
                    <img
                      role="button"
                      src={image.isFavorite ? FavFill : FavOutline}
                      alt="fav"
                      style={{
                        position: "absolute",
                        top: "5px",
                        right: "5px",
                        width: "22px",
                      }}
                      onClick={() => handleFavAddClick(image)}
                    />
                  </Card>
                ))}
              </Stack>
            </Col>
          )}
        </Row>
      </div>
    </>
  );
};
export default Stepper3Collapsed;
