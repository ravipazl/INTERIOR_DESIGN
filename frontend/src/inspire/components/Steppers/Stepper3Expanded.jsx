import React, { useContext, useEffect, useState, useRef } from "react";
import {
  Alert,
  Button,
  Card,
  Navbar,
  Row,
  Col,
  Stack,
  NavLink,
  Container,
} from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import ArrowBack from "../../assets/images/arrow_back.svg";
import FavOutline from "../../assets/images/favorite_add.svg";
import FavFill from "../../assets/images/favorite_fill.svg";
import { CountContext } from "../../context/CountContext";
import ProjectContext from "../../context/ProjectContext";
import { StepperContext } from "../../context/StepperContext";
import UserRoleContext from "../../context/UserRoleContext";
import ServiceContext from "../../context/ServiceContext";
import {
  getAIImages,
  getGeneratedImages,
  updateImageInfo,
} from "../../services/imagesService";
import Thumbnail from "../Thumbnail";
import TitleHeader from "../TitleHeader";
import "./index.css";
import { updateProject } from "../../services/projectService";
import { uploadImage } from "../../services/uploadService";
import { ToastContainer, toast } from "react-toastify";
import Checked from "../../assets/images/checked.svg";
import Unchecked from "../../assets/images/unchecked.svg";
import Modal from "react-bootstrap/Modal";
import Close from "../../assets/images/close_black.svg";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import SliderLandscape from "../SliderLandscape";
import FullScreen from "../../assets/images/fullscreen-icon.svg";
import Slider from "../Slider";
import QuoteImagePicker from "../QuoteImagePicker";
import ObjectSelector from "../ObjectSelector";

const Stepper3Expanded = ({ handleViewAll, original, modified, delay = 0 }) => {
  const width = process.env.REACT_APP_WINDOW_WIDTH;
  const {
    activeStep,
    selectedImage,
    handleNext,
    setActiveStep,
    handleBack,
    generatedAIImage,
    setGeneratedAIImage,
    setTriggerAIGeneration,
    triggerAIGeneration,
  } = useContext(StepperContext);
  const { setHistoryStatus, setFavoriteStatus } = useContext(CountContext);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const navigate = useNavigate();
  const [generatedDesign, setGeneratedDesign] = useState();
  const [imagesHistory, setImagesHistory] = useState([]);
  const { currentProject } = useContext(ProjectContext);
  const { imagesService } = useContext(ServiceContext);
  const [filterHistoryImages, setFilterHistoryImages] = useState([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [show, setShow] = useState(false);
  const [showLandscape, setShowLandscape] = useState(false);
  const [rotatedImageWidth, setRotatedImageWidth] = useState("auto");
  const [rotatedImageHeight, setRotatedImageHeight] = useState("100%");
  const [showStepper3Content, setShowStepper3Content] = useState(false);
  const [showGetQuoteModal, setShowGetQuoteModal] = useState(false);
  const [selectorImage, setSelectorImage] = useState(null);
  const [editedImages, setEditedImages] = useState([]);
  const [generatedList, setGeneratedList] = useState([]);
  const [uploadedList, setUploadedList] = useState([]);
  const [savingEdited, setSavingEdited] = useState(false);
  const [sendingQuote, setSendingQuote] = useState(false);

  // Load the project's saved "uploaded" / "edited" / "generated" images (kept
  // separate so the quote picker can list them in their own sections).
  const loadEditedImages = async () => {
    if (!currentProject?._id) return;
    const res = await imagesService.getImagesByType(currentProject._id, "edited");
    setEditedImages(res?.data || []);
  };
  const loadGeneratedList = async () => {
    if (!currentProject?._id) return;
    const res = await imagesService.getImagesByType(currentProject._id, "generated");
    setGeneratedList(res?.data || []);
  };
  const loadUploadedList = async () => {
    if (!currentProject?._id) return;
    const res = await imagesService.getImagesByType(currentProject._id, "input");
    setUploadedList(res?.data || []);
  };

  // Send the chosen design to the admin: mark it favourite (the admin's quote view
  // shows the favourited design) + flip the project into "quotation_requested".
  const handleSendQuote = async (selected) => {
    if (!selected?._id) return;
    setSendingQuote(true);
    try {
      await imagesService.updateImageInfo(selected._id, { isFavorite: true });
      // Full URL of the chosen design so the admin email can show/attach exactly
      // this image (the backend only accepts an http(s) URL). `selected.url` is
      // the stored key; the uploads base makes it absolute.
      const quoteImageUrl = selected.url
        ? `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${selected.url}`
        : undefined;
      // updateProject returns null when the backend REFUSED the write (a no-op
      // patch answered with 200 + []). Without this check the toast claimed
      // success while nothing was saved — so no status change, no admin email,
      // and nothing in the admin's project list.
      const updateResponse = await updateProject(currentProject?._id, {
        status: "quotation_requested",
        quoteImageId: selected._id,
        ...(quoteImageUrl ? { quoteImageUrl } : {}),
      });
      if (!updateResponse) {
        toast.error(
          "Could not send for quote. Please try again — if it keeps failing, the request wasn't saved.",
          { position: toast.POSITION.TOP_RIGHT, theme: "colored" }
        );
        return;
      }
      // The request IS saved; only the admin email is best-effort. Report which
      // actually happened instead of a blanket success.
      if (updateResponse.adminNotified) {
        toast.success("Sent for quote — the admin has been notified by email.", {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
      } else {
        toast.warning(
          "Sent for quote. We couldn't email the admin just now, but your request is saved and visible to them.",
          { position: toast.POSITION.TOP_RIGHT, theme: "colored", autoClose: 8000 }
        );
      }
      setShowGetQuoteModal(false);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't send for quote.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } finally {
      setSendingQuote(false);
    }
  };

  // Called when the editor's "Done" hands back the final annotated PNG. Uploads it
  // and saves it as an 'edited' image linked to the source generated image.
  const handleEditedDone = async (blob) => {
    const source = selectorImage;
    if (!source || !blob) return;
    setSavingEdited(true);
    try {
      const file = new File([blob], `edited-${Date.now()}.png`, { type: "image/png" });
      const uploaded = await uploadImage(file);
      if (!uploaded?.key) throw new Error("upload failed");
      await imagesService.saveImageInfo({
        url: uploaded.key,
        imageType: "edited",
        inputImageId: source._id,
        projectID: source.projectID || currentProject?._id,
        userId: source.userId,
        roomType: source.roomType,
        roomName: source.roomName,
        themeName: source.themeName,
      });
      toast.success("Edited design saved!", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      await loadEditedImages();
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save the edited design.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } finally {
      setSavingEdited(false);
    }
  };

  useEffect(() => {
    loadEditedImages();
    loadGeneratedList();
    loadUploadedList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?._id]);

  //document.getElementById().getClientRects()
  const handleClose = () => setShow(false);

  const handleShow = () => {
    setShow(true);
    setShowLandscape(true);

    // Calculate the dimensions for the rotated image to cover the entire screen
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Set the dimensions in state
    setRotatedImageWidth(`${screenHeight}px`);
    setRotatedImageHeight(`${screenWidth}px`);
  };

  // A client may (re)request a quote ONLY when the project is not already in an
  // active quote/build cycle — otherwise requesting again resets an in-progress
  // project back to "quotation_requested" and breaks the flow (and rewinds the
  // tracker). Allowed only from a fresh (open), finished (closed) or
  // previously-rejected project.
  const quoteInProgress = [
    "quotation_requested",
    "quotation_pending_approval",
    "quotation_sent",
    "quotation_accepted",
  ].includes(currentProject?.status);

  const handleGetQuoteModal = () => {
    if (quoteInProgress) {
      toast.info("A quotation is already in progress for this project.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }
    loadGeneratedList();
    loadEditedImages();
    loadUploadedList();
    setShowGetQuoteModal(true);
  };

  useEffect(() => {
    if (generatedAIImage) {
      setGeneratedDesign(generatedAIImage);
    }
  }, [generatedAIImage]);

  useEffect(() => {
    if (triggerAIGeneration) {
      // onGenerateAIImage();
    }
  }, [triggerAIGeneration]);

  useEffect(() => {
    // Simulate content loading after a delay
    setTimeout(() => {
      setIsVisible(true); // Set content as loaded
      // if (activeStep === 3 && generatedDesign) {
      //   setLoading(!generatedDesign);
      // }
    }, delay);
  }, [generatedDesign, delay]);

  const handleFavAddClick = async (image) => {
    const updateImageResponse = await imagesService.updateImageInfo(
      image?._id,
      {
        isFavorite: !image.isFavorite,
      }
    );
    setFavoriteStatus();
    if (image._id === generatedDesign._id) {
      setGeneratedAIImage(updateImageResponse);
    }
    await getImagesHistory(true);
  };

  const handleCheckboxClick = () => {
    setIsChecked(!isChecked);
  };

  const onGenerateAIImage = async () => {
    if (selectedImage) {
      const ImageUrl = `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${selectedImage?.url}`;
      const reqBody = {
        inputImage: ImageUrl,
        inputImageId: selectedImage?._id,
        roomType: selectedImage?.roomType,
        themeName: selectedImage?.themeName,
        roomName: selectedImage?.roomName,
        userId: selectedImage?.userId,
        projectId: selectedImage?.projectID,
      };
      setLoading(true);
      setTriggerAIGeneration(false);
      let tempGeneratedImage = await imagesService.getAIImages(reqBody);
      setGeneratedAIImage(tempGeneratedImage);
      setLoading(false);
    }
  };

  const navigateStepperTo = (value) => {
    setActiveStep(value);
  };

  const getImageURL = (imageName) => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${imageName}`;
  };

  const getImagesHistory = async (refreshGeneratedImages = false) => {
    if (!currentProject) return;
    const generatedImages = await imagesService.getGeneratedImages(
      currentProject._id,
      false,
      refreshGeneratedImages
    );
    if (generatedImages?.data?.length) {
      setImagesHistory(generatedImages.data);
      setHistoryStatus();
      if (!generatedDesign) {
        setGeneratedDesign(generatedImages.data[0]);
      }
    }
  };

  useEffect(() => {
    // refresh=true so a just-generated image is included immediately (a cached
    // read would miss it) — keeps the Generate/Regenerate button label accurate
    // right after generating.
    getImagesHistory(true);
  }, [currentProject, generatedAIImage]);

  const customSort = (a, b) => {
    // Sort by favorite status
    if (a.isFavorite && !b.isFavorite) {
      return -1; // 'a' comes before 'b'
    } else if (!a.isFavorite && b.isFavorite) {
      return 1; // 'b' comes before 'a'
    }

    // Sort by createdAt in reverse chronological order
    return new Date(b.createdAt) - new Date(a.createdAt);
  };

  useEffect(() => {
    if (selectedImage && imagesHistory.length) {
      const filterData = imagesHistory.filter(
        (image) => image.inputImageId === selectedImage._id
      );
      filterData.sort(customSort);
      setFilterHistoryImages(filterData);
      if (
        !generatedDesign ||
        generatedDesign.inputImageId !== selectedImage._id
      ) {
        setGeneratedDesign(filterData[0]);
      }
    } else {
      setFilterHistoryImages(imagesHistory);
    }
  }, [imagesHistory, selectedImage]);


  const sliderImageData = {
    delay: 500,
    original: {
      url: `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${generatedDesign?.url}`,
      title: "Generated Image",
    },
    modified: {
      url: `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${generatedDesign?.inputImage?.url}`,
      title: "Uploaded Image",
    },
  };

  return (
    <>
      <ToastContainer />
      <QuoteImagePicker
        show={showGetQuoteModal}
        onHide={() => setShowGetQuoteModal(false)}
        generated={generatedList}
        edited={editedImages}
        uploaded={uploadedList}
        onSend={handleSendQuote}
        sending={sendingQuote}
      />
      <ObjectSelector
        show={!!selectorImage}
        onHide={() => setSelectorImage(null)}
        onDone={handleEditedDone}
        image={selectorImage}
      />
      <div>
        <Row
          className="px-2 d-none d-lg-flex d-flex align-items-center title-header-color"
          style={{
            borderBottom: "1px solid rgba(28, 27, 31, 0.25)",
            minHeight: "101px",
            marginLeft: "0px",
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
                <h3 className="display-5 fw-bold px-2 m-0">03 </h3>
                <Navbar.Brand className="text-wrap stepper-header-text">
                  GENERATE INSPIRATION
                  {!generatedDesign && (
                    <Alert variant="danger" className="p-1 px-3 mb-0 border-0">
                      <i>
                        Upload your room type and select theme style to generate
                        an AI inspiration.
                      </i>
                    </Alert>
                  )}
                </Navbar.Brand>
              </div>
              <div className="d-flex flex-row align-items-center justify-content-end pr-3">
                <Button
                  disabled={
                    !selectedImage.roomType ||
                    !selectedImage.themeName ||
                    isLoading ||
                    !generatedDesign
                  }
                  className="btn-mw-150 outline-button me-3"
                  onClick={() => onGenerateAIImage()}
                  variant="outlined"
                >
                  {filterHistoryImages && filterHistoryImages.length > 0
                    ? "Regenerate"
                    : "Generate"}
                </Button>
                {generatedDesign && (
                  <Button
                    className="btn-mw-150 outline-button me-3"
                    onClick={() => setSelectorImage(generatedDesign)}
                    variant="outlined"
                  >
                    Select objects
                  </Button>
                )}
                {(generatedDesign || uploadedList.length > 0) && (
                  <Button
                    className="btn-mw-150 primary-button-filled"
                    onClick={handleGetQuoteModal}
                    variant="primary"
                    disabled={quoteInProgress}
                    title={
                      quoteInProgress
                        ? "A quotation is already in progress for this project."
                        : undefined
                    }
                  >
                    Request quote
                  </Button>
                )}
              </div>
            </div>
          </Navbar>
        </Row>
        <Row
          className="d-none d-lg-block overflow-auto"
          style={{ height: `calc(100vh-300px)` }}
        >
          <div className="d-flex ">
            <Col className="ps-3 pt-3 d-flex align-items-center justify-content-center">
              {generatedDesign && !isLoading ? (
                <div>
                  <div className="d-flex justify-content-between">
                    <div className="pb-2">
                      <TitleHeader
                        title={`${generatedDesign?.roomType}- ${generatedDesign?.themeName}`}
                      />
                    </div>
                    <Button
                      variant="text"
                      className="d-flex align-items-center me-3 button-icons ps-0"
                      onClick={handleCheckboxClick}
                    >
                      <img
                        src={isChecked ? Checked : Unchecked}
                        alt="Checkbox"
                        style={{
                          cursor: "pointer",
                          width: "24px",
                          height: "auto",
                          marginRight: "8px",
                        }}
                        onClick={handleCheckboxClick}
                      />
                      View generated image only
                    </Button>
                  </div>
                  <div>
                    {isChecked ? (
                      <figure style={{ margin: 0, position: "relative" }}>
                        <img
                          src={`${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${generatedDesign?.url}`}
                          alt="Generated Images"
                          className="generated-image"
                        />
                      </figure>
                    ) : (
                      <div className="slider-conatiner ">
                        <Slider
                          {...sliderImageData}
                          key={sliderImageData?.modified?.url}
                          generatedDesign={generatedDesign}
                          handleFavAddClick={handleFavAddClick}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </Col>
            {generatedDesign && !isLoading ? (
              <Col style={{ display: "contents" }}>
                {filterHistoryImages && filterHistoryImages.length > 0 && (
                  <span className="border-left p-3">
                    <span className="">
                      <TitleHeader title={"History"} />
                    </span>
                    <div
                      className="overflow-y-auto overflow-x-hidden pe-2 mt-2"
                      style={{ height: "calc(100vh - 240px)" }}
                    >
                      <Stack gap={2}>
                        {(Array.isArray(filterHistoryImages) ? filterHistoryImages : []).map((image, index) => (
                          <Card
                            key={index}
                            onClick={() => setGeneratedDesign(image)}
                            style={{
                              backgroundImage: `url(${getImageURL(
                                image?.url
                              )})`,
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
                            <span
                              role="button"
                              title="Select objects in this image"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectorImage(image);
                              }}
                              style={{
                                position: "absolute",
                                top: "5px",
                                left: "5px",
                                background: "rgba(127,119,221,0.92)",
                                color: "#fff",
                                fontSize: "10px",
                                fontWeight: 600,
                                padding: "2px 6px",
                                borderRadius: "6px",
                                cursor: "pointer",
                                lineHeight: 1.3,
                              }}
                            >
                              Select
                            </span>
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
                              onClick={(event) => {
                                event.stopPropagation();
                                handleFavAddClick(image);
                              }}
                            />
                          </Card>
                        ))}
                      </Stack>
                    </div>
                  </span>
                )}
              </Col>
            ) : null}
          </div>
        </Row>
        <div className="d-block d-lg-none overflow-x-hidden">
          {generatedDesign && (
            <div>
              <div className="py-2 ps-2 d-flex justify-content-center">
                <TitleHeader
                  title={`${generatedDesign?.roomType}- ${generatedDesign?.themeName}`}
                />
              </div>
              <div
                className="d-flex flex-column align-items-center justify-content-between mt-2"
                style={{ height: "calc(100vh - 180px)", paddingBottom: "70px" }}
              >
                <Row>
                  {isChecked ? (
                    <div className="d-flex justify-content-center ps-1 position-relative">
                      <figure
                        className={`cd-image-container ${
                          isVisible && "is-visible"
                        }`}
                      >
                        <img
                          src={`${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${generatedDesign?.url}`}
                          alt="Generated Image"
                          className="comparing-image"
                        />
                        <img
                          role="button"
                          src={
                            generatedDesign.isFavorite ? FavFill : FavOutline
                          }
                          alt="fav"
                          onClick={() => handleFavAddClick(generatedDesign)}
                          className="slider-favourite-icon"
                        />
                      </figure>
                    </div>
                  ) : (
                    <div className="d-flex justify-content-center ps-1 position-relative">
                      <Slider
                        {...sliderImageData}
                        key={sliderImageData?.modified?.url}
                        generatedDesign={generatedDesign}
                        handleFavAddClick={handleFavAddClick}
                      />
                    </div>
                  )}
                  <div className="d-flex flex-row justify-content-end mt-2 pe-4">
                    <Button
                      variant="text"
                      className="button-icons me-3"
                      onClick={handleCheckboxClick}
                    >
                      <img
                        src={isChecked ? Checked : Unchecked}
                        alt="Checkbox"
                        style={{
                          cursor: "pointer",
                          width: "24px",
                          height: "auto",
                          marginRight: "8px",
                        }}
                        onClick={handleCheckboxClick}
                      />
                      View generated image only
                    </Button>
                    <Button
                      variant="text"
                      className="button-icons"
                      onClick={handleShow}
                    >
                      <img
                        src={FullScreen}
                        alt="Fullscreen"
                        style={{
                          cursor: "pointer",
                          width: "24px",
                          height: "auto",
                        }}
                      />
                      Full screen view
                    </Button>
                  </div>
                  <Row>
                    <Modal show={show} onHide={handleClose}>
                      <div className="custom-modal">
                        <div className="image-slider-modal">
                          <SliderLandscape {...sliderImageData} />
                        </div>
                        <div className="modalCloseButton">
                          <img
                            src={Close}
                            alt="close"
                            role="button"
                            onClick={handleClose}
                          />
                        </div>
                      </div>
                    </Modal>
                  </Row>
                </Row>
                <Row className="ms-2">
                  {filterHistoryImages && filterHistoryImages.length > 0 && (
                    <span>
                      <span className="">
                        <TitleHeader title={"History"} />
                      </span>
                      <div
                        className="overflow-x-auto"
                        style={{ width: "100vw" }}
                      >
                        <Stack
                          direction="horizontal"
                          gap={2}
                          style={{ width: "fit-content" }}
                        >
                          {(Array.isArray(filterHistoryImages) ? filterHistoryImages : []).map((image, index) => (
                            <Card
                              key={index}
                              onClick={() => setGeneratedDesign(image)}
                              style={{
                                backgroundImage: `url(${getImageURL(
                                  image?.url
                                )})`,
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
                            >
                              <span
                                role="button"
                                title="Select objects in this image"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectorImage(image);
                                }}
                                style={{
                                  position: "absolute",
                                  top: "5px",
                                  left: "5px",
                                  background: "rgba(127,119,221,0.92)",
                                  color: "#fff",
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  lineHeight: 1.3,
                                }}
                              >
                                Select
                              </span>
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
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleFavAddClick(image);
                                }}
                              />
                            </Card>
                          ))}
                        </Stack>
                      </div>
                    </span>
                  )}
                </Row>
              </div>
            </div>
          )}
        </div>
        {generatedDesign && (
          <Row className="d-block d-lg-none">
            <nav className="bg-light p-2 d-flex justify-content-center navbar navbar-expand navbar-light fixed-bottom">
              <div className="d-flex flex-row align-items-center justify-content-between border-top">
                <Button
                  disabled={
                    !selectedImage.roomType ||
                    !selectedImage.themeName ||
                    isLoading
                  }
                  className="outline-button w-100 m-2"
                  onClick={() => onGenerateAIImage()}
                  variant="outlined"
                >
                  {filterHistoryImages && filterHistoryImages.length > 0
                    ? "Regenerate"
                    : "Generate"}
                </Button>
                {(generatedDesign || uploadedList.length > 0) && (
                  <Button
                    className="primary-button-filled w-100 my-2 me-2"
                    onClick={handleGetQuoteModal}
                    variant="primary"
                    style={{ minWidth: "165px" }}
                    disabled={quoteInProgress}
                    title={
                      quoteInProgress
                        ? "A quotation is already in progress for this project."
                        : undefined
                    }
                  >
                    Request for quote
                  </Button>
                )}
              </div>
            </nav>
          </Row>
        )}
      </div>
    </>
  );
};

export default Stepper3Expanded;
