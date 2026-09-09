import React, { useContext, useEffect, useState } from "react";
import { Alert, Button, Container, Row } from "react-bootstrap";
import "./index.css";
import "react-lightbox-pack/dist/index.css";
import { LightBox } from "react-lightbox-pack";
import TitleHeader from "../../components/TitleHeader";
import { useNavigate } from "react-router-dom";
import UserRoleContext from "../../context/UserRoleContext";
import NoData from "../../assets/images/no_data.svg";
import FavouriteThumbnail from "./FavouriteThumbnail";
import { useMediaQuery } from "@mui/material";
import PhotoAlbum from "react-photo-album";
import { v4 as uuidv4 } from "uuid";
import MagicWand from "../../assets/images/magic_wand.png";
import DownloadPdf from "../../assets/images/download_pdf.svg";

const Favourites = ({
  images,
  handleImageUnLike,
  historyImages,
  handleTabSelect,
}) => {
  const navigate = useNavigate();
  const [roomNames, setRoomNames] = useState([]);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [groupingImages, setGroupingImages] = useState([]);
  const [groupedUrls, setGroupedUrls] = useState([]);
  const isLargeScreen = useMediaQuery("(min-width: 768px)");
  const [imageWidthsAndHeights, setImageWidthsAndHeights] = useState([]);
  const [toggle, setToggle] = React.useState(false);
  const [sIndex, setSIndex] = React.useState(0);
  const [lightBoxData, setLightBoxData] = React.useState(null);
  console.debug("DEBUG: images", images);
  console.debug("DEBUG: initial roomNames:", roomNames);
  console.debug("DEBUG: initial groupingImages:", groupingImages);

  const isMobileDevice = !isLargeScreen;

  useEffect(() => {
    getRoomNames();
  }, [images]);

  useEffect(() => {
    // Load the original images to get their width and height
    const loadImagesAndGetDimensions = () => {
      const imageDimensions = [];
      const imagePromises = images.map((image) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.src = `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${image.url}`;
          img.onload = () => {
            imageDimensions.push({
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
            resolve();
          };
        });
      });
      Promise.all(imagePromises).then(() => {
        // Once all images are loaded, update the state with dimensions
        setImageWidthsAndHeights(imageDimensions);
      });
    };

    loadImagesAndGetDimensions();
  }, [images]);

  useEffect(() => {
    const handleAfterPrint = () => {
      // This function will be called after the print job or print preview is closed
      window.location.reload(); // Reload the page
    };

    // Add an event listener for the afterprint event
    window.addEventListener("afterprint", handleAfterPrint);

    // Remove the event listener when the component is unmounted
    return () => {
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, []);

  const getRoomNames = () => {
    const res = Array.from(new Set(images.map((image) => image.roomName)));
    setRoomNames(res);
    console.debug("DEBUG: roomNames", roomNames);
  };

  const navigateToDashboard = () => {
    navigate("/dashboard");
  };

  const hasHistoryImagesButNoFavorites =
    images.some((image) => image.isHistory) && roomNames.length === 0;

  useEffect(() => {
    if (!roomNames || roomNames.length === 0 || !images.length) {
      setGroupingImages([]);
      return;
    }
    const groupUploadGeneratedImagesArray = roomNames.map((roomName) => {
      const filteredImages = images.filter(
        (image) => image.roomName === roomName
      );
      console.debug("DEBUG: filteredImages", filteredImages);
      const groupData = filteredImages.reduce((result, item) => {
        const { inputImageId, inputImage } = item;
        const imageId = inputImage?._id;
        const url = inputImage?.url;
        const createdOn = inputImage?.createdAt;

        if (inputImageId && imageId && inputImageId === imageId) {
          result[inputImageId] ||= {
            inputImageId,
            url,
            createdOn,
            images: [],
          };
          result[inputImageId].images.push(item);
        }
        return result;
      }, {});
      return {
        roomName,
        items: Object.values(groupData),
      };
    });
    const groupUrls = groupUploadGeneratedImagesArray.map((group, index) => {
      const room_name = group.roomName;
      const items = group.items;
      const inputUrls = items.map((inputUrl) => ({
        inputUrl: inputUrl.url,
        inputImageId: inputUrl.inputImageId,
        generatedImages: inputUrl.images.map((image) => ({
          generatedImageId: image._id,
          generatedImageUrl: image.url,
          theme_name: image.themeName,
        })),
      }));
      return { room_name, inputUrls };
    });
    setGroupingImages(groupUrls);
  }, [images, roomNames]);

  const getUploadedAndGeneratedImages = (room) => {
    const uploadedImages = room.items.length;
    const generatedImages = room.items.flatMap((item) => item.images).length;
    return { uploadedImages, generatedImages };
  };

  const totalCount = (number) => {
    return number < 10 ? `0${number}` : number;
  };

  const getImageURL = () => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}`;
  };

  const lightBoxHandler = (state, sIndex) => {
    setToggle(state);
    setSIndex(sIndex);
  };

  const handleLightBoxInputImage = (inputUrl, photo) => {
    console.log("photo", photo);
    console.log("inputUrl", inputUrl);
    const inputImages = [
      {
        id: "Uploaded Id",
        image: `${getImageURL()}/${inputUrl.inputUrl}`,
        title: "Uploaded Image",
        roomName: "Room name",
      },
    ];
    setLightBoxData(inputImages);
    lightBoxHandler(true, 0);
  };

  const handleLightBoxGeneratedImage = (inputUrl, photo) => {
    const generatedUrls = inputUrl.generatedImages?.map((generatedUrl) => ({
      id: uuidv4(),
      image: `${getImageURL()}/${generatedUrl.generatedImageUrl}`,
      room_name: generatedUrl.room_name,
      theme_name: generatedUrl.theme_name,
    }));
    const index = inputUrl.generatedImages.findIndex((image) => {
      return image.generatedImageId === photo.generatedImageId;
    });
    setLightBoxData(generatedUrls);
    setSIndex(index);
    lightBoxHandler(true, index);
  };

  const printdiv = (elem) => {
    var header_str =
      "<html><head><title>" + document.title + "</title></head><body>";
    var footer_str = "</body></html>";
    var new_str = document.getElementById(elem).innerHTML;
    var old_str = document.body.innerHTML;
    document.body.innerHTML = header_str + new_str + footer_str;

    // Open print dialog
    window.print();

    document.body.innerHTML = old_str;

    return false;
  };

  const downloadImages = async () => {
    if (isMobileDevice) {
      const printableDiv = document.getElementById("printable_div_id");
      if (printableDiv) {
        const clonedDiv = printableDiv.cloneNode(true);
        const printWindow = window.open("", "_blank");

        printWindow.document.body.appendChild(clonedDiv);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        printWindow.print();
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      printdiv("printable_div_id");
    }
  };

  return (
    <>
      {isLoading ? (
        <div></div>
      ) : groupingImages.length > 0 ? (
        <Container
          fluid
          style={{ height: `calc(100vh - 160px)` }}
          className="ps-3 mt-3 overflow-y-auto moodboard-container-height"
        >
          <div>
            <Button
              onClick={downloadImages}
              className={
                "button-icons d-flex align-items-center justify-content-end w-100"
              }
            >
              <img src={DownloadPdf} alt="download" width={30} height={30} />
              <p className="text-black fw-bold m-0 p-2">Pdf</p>
            </Button>
          </div>
          <div
            id="printable_div_id"
            className=" overflow-y-sm-auto"
            style={{ height: `calc(100vh )` }}
          >
            {groupingImages.map((group, index) => (
              <div key={index}>
                {group.inputUrls.map((inputUrl, inputIndex) => (
                  // Keyed by the source image URL, unique within a group; the
                  // index is only a fallback. The OUTER map already had a key,
                  // this inner one did not - which is what React warned about,
                  // and it let these rows be reused against the wrong data when
                  // a group's images change.
                  <div
                    key={inputUrl?.inputUrl ?? inputIndex}
                    className="flex-container"
                    style={{
                      backgroundColor: index % 2 === 0 ? "#F7F7F7" : "white",
                    }}
                  >
                    {/* <div>
                    <div className="pe-2 position-relative">
                      <img
                        src={`${getImageURL()}/${inputUrl.inputUrl}`}
                        alt={`Input Image ${inputIndex + 1}`}
                        width={600}
                        height={"auto"}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleLightBoxInputImage(inputUrl);
                        }}
                      />
                      <div className="room_and_theme_name">
                        <p className="fw-normal fs-5 m-0 px-3">
                          {group.room_name}
                        </p>
                      </div>
                    </div>
                  </div> */}
                    <div style={{ width: "100%" }}>
                      <PhotoAlbum
                        photos={[
                          {
                            src: `${getImageURL()}/${inputUrl.inputUrl}`,
                            alt: `Input Image ${inputIndex + 1}`,
                            width: imageWidthsAndHeights[inputIndex]?.width,
                            height: imageWidthsAndHeights[inputIndex]?.height,
                            room_name: group.room_name,
                          },
                          ...inputUrl.generatedImages.map(
                            (generatedImage, generatedIndex) => ({
                              src: `${getImageURL()}/${
                                generatedImage.generatedImageUrl
                              }`,
                              alt: `generated ${generatedIndex}`,
                              width: imageWidthsAndHeights[inputIndex]?.width,
                              height: imageWidthsAndHeights[inputIndex]?.height,
                              theme_name: generatedImage.theme_name,
                              generatedImageId: generatedImage.generatedImageId,
                              room_name: group.room_name,
                            })
                          ),
                        ]}
                        layout="columns"
                        columns={2}
                        spacing={3}
                        renderPhoto={({
                          photo,
                          wrapperStyle,
                          renderDefaultPhoto,
                        }) => (
                          <div
                            style={{ position: "relative", ...wrapperStyle }}
                          >
                            <a
                              href="#"
                              onClick={(event) => {
                                event.preventDefault();
                                if (photo.generatedImageId) {
                                  handleLightBoxGeneratedImage(inputUrl, photo);
                                } else {
                                  handleLightBoxInputImage(inputUrl, photo);
                                }
                              }}
                            >
                              {renderDefaultPhoto({ wrapped: true })}
                            </a>
                            {photo.room_name && !photo.theme_name && (
                              <div className="room_and_theme_name p-0 mb-3">
                                <p className="fw-bold fs-lg-5 m-0 p-lg-2">
                                  <span className="fw-bold fs-lg-5 m-0">
                                    Your {""}
                                  </span>
                                  {photo.room_name}
                                </p>
                              </div>
                            )}
                            {photo.theme_name && photo.room_name && (
                              <div>
                                <div className="room_and_theme_name p-0 mb-3">
                                  <p className="fw-normal fs-lg-5 m-0 p-lg-2">
                                    {`${photo.theme_name} - ${photo.room_name}`}
                                  </p>
                                </div>
                                <div className="magic_wand">
                                  <img
                                    src={MagicWand}
                                    alt="Magic Wand"
                                    width={25}
                                    height={25}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <LightBox
            state={toggle}
            event={lightBoxHandler}
            data={lightBoxData}
            imageWidth="60vw"
            imageHeight="70vh"
            thumbnailHeight={50}
            thumbnailWidth={50}
            setImageIndex={setSIndex}
            imageIndex={sIndex}
          />
        </Container>
      ) : (
        <Container
          fluid
          className="d-flex flex-column align-items-center justify-content-center pb-0"
          style={{ height: "calc(100vh - 200px" }}
        >
          <Row className="pb-3">
            <img src={NoData} alt="nodata" width={"86px"} height={"109px"} />
          </Row>
          <Row>
            <p className="noData text-center">
              Currently awaiting for unique selection of favorite images!
            </p>
          </Row>
          <Row>
            {historyImages.length === 0 && images.length === 0 ? (
              // If there are no history and favorite images
              <Button
                onClick={navigateToDashboard}
                className="primary-button-filled"
              >
                Generate Design
              </Button>
            ) : historyImages.length > 0 && images.length === 0 ? (
              // If there are history images in tab but no favorite images
              <Button
                onClick={() => handleTabSelect("history")}
                className="primary-button-filled"
              >
                Go to History
              </Button>
            ) : null}
          </Row>
        </Container>
      )}
    </>
  );
};

export default Favourites;
