import { useMediaQuery } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import React, { useContext, useEffect, useState } from "react";
import { Button, Container, Image, Row } from "react-bootstrap";
import { LightBox } from "react-lightbox-pack";
import "react-lightbox-pack/dist/index.css";
import { useNavigate } from "react-router-dom";
import NoHistory from "../../assets/images/no_history.svg";
import conversionPath from "../../assets/images/conversion_path.svg";
import TitleHeader from "../../components/TitleHeader";
import UserRoleContext from "../../context/UserRoleContext";
import FavouriteThumbnail from "../Favourites/FavouriteThumbnail";
import { formatDate } from "../../utils/genericFunctions";
import "./index.css";

const History = ({
  images,
  editedImages = [],
  onEditedDone,
  handleImageLike,
  handleImageUnLike,
}) => {
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [roomNames, setRoomNames] = useState([]);
  const [groupingImages, setGroupingImages] = useState([]);
  const [lbToggle, setLbToggle] = useState(false);
  const [lbIndex, setLbIndex] = useState(0);
  const [lbData, setLbData] = useState(null);
  const navigate = useNavigate();
  const isLargeScreen = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    getRoomNames();
  }, [images]);

  const getRoomNames = () => {
    const res = Array.from(new Set(images.map((image) => image.roomName)));
    setRoomNames(res);
  };

  const navigateToDashboard = () => {
    navigate("/dashboard");
  };

  useEffect(() => {
    if (!roomNames || roomNames.length === 0 || !images.length) {
      setGroupingImages([]);
      return;
    }
    const groupedDataArray = roomNames.map((roomName) => {
      const filteredImages = images.filter(
        (image) => image.roomName === roomName
      );
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
    setGroupingImages(groupedDataArray);
  }, [images, roomNames]);

  const getUploadedAndGeneratedImages = (room) => {
    const uploadedImages = room.items.length;
    const generatedImages = room.items.flatMap((item) => item.images).length;
    return {
      uploadedImages,
      generatedImages,
    };
  };

  const totalCount = (number) => {
    return number < 10 ? `0${number}` : number;
  };

  const imageBase = process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH;

  // Edited images that belong to a given room, newest first.
  const getEditedForRoom = (roomName) =>
    editedImages
      .filter((img) => img.roomName === roomName)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const lbHandler = (state, index) => {
    setLbToggle(state);
    setLbIndex(index);
  };

  // Open the full-screen lightbox for the edited images of a room, starting on
  // the clicked one — same viewer the generated/uploaded images use.
  const openEditedLightBox = (roomName, clickedIndex) => {
    const data = getEditedForRoom(roomName).map((img) => ({
      id: img._id,
      image: `${imageBase}/${img.url}`,
      title: img.themeName || "Edited",
      roomName: img.roomName,
    }));
    setLbData(data);
    setLbIndex(clickedIndex);
    setLbToggle(true);
  };

  return (
    <>
      {isLoading ? (
        <div></div>
      ) : groupingImages.length > 0 ? (
        <Container
          fluid
          className="ps-0 upload-image-mobile"
          style={{ paddingBottom: "200px" }}
        >
          <div className="align-items-center">
            {groupingImages.map((room, index) => (
              <div key={index} className="room-type-container mt-3 ps-3">
                <div className="d-flex">
                  <TitleHeader title={room.roomName} />
                </div>
                <div className={isLargeScreen ? "pt-3" : "p-3"}>
                  <div className={isLargeScreen ? "mb-1" : "mb-3"}>
                    <p className="m-0 room_type_title">
                      <span>
                        {getUploadedAndGeneratedImages(room).uploadedImages > 1
                          ? `Uploaded Images | ${totalCount(
                              getUploadedAndGeneratedImages(room).uploadedImages
                            )}`
                          : "Uploaded Image | 01"}
                      </span>
                      <span
                        style={
                          isLargeScreen
                            ? { paddingLeft: "132px" }
                            : { paddingLeft: "90px" }
                        }
                      >
                        {getUploadedAndGeneratedImages(room).generatedImages > 1
                          ? `Generated Images | ${totalCount(
                              getUploadedAndGeneratedImages(room)
                                .generatedImages
                            )}`
                          : "Generated Image | 01"}
                      </span>
                    </p>
                  </div>
                  <div>
                    {room.items.map((item, index) => (
                      <FavouriteThumbnail
                        key={index}
                        items={item}
                        onEditedDone={onEditedDone}
                        handleImageLike={handleImageLike}
                        handleImageUnLike={handleImageUnLike}
                      />
                    ))}
                  </div>
                  {getEditedForRoom(room.roomName).length > 0 && (
                    <>
                      {/* Desktop: align the Edited row under the Generated
                          column by mirroring the uploaded-image + arrow spacers
                          used in each history row. */}
                      <div className="d-none d-lg-flex edited-images-section">
                        <div style={{ width: "187px", flex: "0 0 187px" }} />
                        <div
                          className="conversion-path"
                          style={{ visibility: "hidden" }}
                        >
                          <img src={conversionPath} alt="" />
                        </div>
                        <div>
                          <div className="mb-1">
                            <p className="m-0 room_type_title">
                              {`Edited Images | ${totalCount(
                                getEditedForRoom(room.roomName).length
                              )}`}
                            </p>
                          </div>
                          <div className="d-flex flex-wrap">
                            {getEditedForRoom(room.roomName).map((edited, i) => (
                              <div
                                key={edited._id || i}
                                className="fav-pic-container me-3"
                                style={{ position: "relative" }}
                              >
                                <Image
                                  src={`${imageBase}/${edited.url}`}
                                  alt={`edited ${i + 1}`}
                                  className="fav-pic"
                                  style={{ cursor: "pointer" }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEditedLightBox(room.roomName, i);
                                  }}
                                />
                                <p className="theme_name mt-1 mb-3">
                                  {edited.themeName
                                    ? `${edited.themeName} style |`
                                    : "Edited |"}
                                  <span className="theme_date">
                                    {" "}
                                    {formatDate(edited.createdAt)}
                                  </span>
                                </p>
                                {!edited.isFavorite ? (
                                  <FavoriteBorderIcon
                                    className="hist-unlike-icon"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleImageLike(edited);
                                    }}
                                  />
                                ) : (
                                  <FavoriteIcon
                                    className="hist-like-icon"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleImageUnLike(edited);
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Mobile: simple stacked block. */}
                      <div className="d-lg-none edited-images-section mt-2">
                        <div className="mb-3">
                          <p className="m-0 room_type_title">
                            {`Edited Images | ${totalCount(
                              getEditedForRoom(room.roomName).length
                            )}`}
                          </p>
                        </div>
                        <div className="d-flex flex-wrap">
                          {getEditedForRoom(room.roomName).map((edited, i) => (
                            <div
                              key={edited._id || i}
                              className="fav-pic-container me-3"
                              style={{ position: "relative" }}
                            >
                              <Image
                                src={`${imageBase}/${edited.url}`}
                                alt={`edited ${i + 1}`}
                                className="fav-pic"
                                style={{ cursor: "pointer" }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditedLightBox(room.roomName, i);
                                }}
                              />
                              <p className="theme_name mt-1 mb-3">
                                {edited.themeName
                                  ? `${edited.themeName} style |`
                                  : "Edited |"}
                                <span className="theme_date">
                                  {" "}
                                  {formatDate(edited.createdAt)}
                                </span>
                              </p>
                              {!edited.isFavorite ? (
                                <FavoriteBorderIcon
                                  className="hist-unlike-icon"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleImageLike(edited);
                                  }}
                                />
                              ) : (
                                <FavoriteIcon
                                  className="hist-like-icon"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleImageUnLike(edited);
                                  }}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Container>
      ) : (
        <Container
          fluid
          className="d-flex flex-column align-items-center justify-content-center"
          style={{ height: "calc(100vh - 200px" }}
        >
          <Row className="pb-3">
            <img
              src={NoHistory}
              alt="nohistory"
              width={"138px"}
              height={"138px"}
            />
          </Row>
          <Row>
            <p className="noData">Design yet to be discovered !</p>
          </Row>
          <Row className="pt-4">
            <Button
              onClick={navigateToDashboard}
              className="primary-button-filled"
            >
              Generate Design
            </Button>
          </Row>
        </Container>
      )}
      <LightBox
        state={lbToggle}
        event={lbHandler}
        data={lbData}
        imageWidth="60vw"
        imageHeight="70vh"
        thumbnailHeight={50}
        thumbnailWidth={50}
        setImageIndex={setLbIndex}
        imageIndex={lbIndex}
      />
    </>
  );
};

export default History;
