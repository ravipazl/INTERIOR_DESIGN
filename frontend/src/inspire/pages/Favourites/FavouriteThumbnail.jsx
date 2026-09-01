import React, { useState } from "react";
import "./index.css";
import "../History/index.css";
import { Image, Row, Card, Button } from "react-bootstrap";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { LightBox } from "react-lightbox-pack";
import "react-lightbox-pack/dist/index.css";
import { v4 as uuidv4 } from "uuid";
import conversionPath from "../../assets/images/conversion_path.svg";
import SmallScreenImagesModal from "../../components/SmallScreenImagesModal";
import ObjectSelector from "../../components/ObjectSelector";
import { formatDate } from "../../utils/genericFunctions";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function FavouriteThumbnail({
  items,
  handleImageUnLike,
  handleImageLike,
  onEditedDone,
}) {
  //console.log('items', items)
  const [toggle, setToggle] = React.useState(false);
  const [sIndex, setSIndex] = React.useState(0);
  const [lightBoxData, setLightBoxData] = React.useState(null);
  //console.log("🚀 ~ file: FavouriteThumbnail.jsx:21 ~ FavouriteThumbnail ~ lightBoxData:", lightBoxData)
  const [smallScreenImagesModal, setSmallScreenImagesModal] = useState(false);
  const [showToastunlike, setShowToastUnlike] = useState(false);
  const [selectorImage, setSelectorImage] = useState(null);

  const notifyLike = () => toast.info("Image has been added to favorites!");
  const notifyUnlike = () =>
    toast.info("Image has been removed from favorites!");

  const lightBoxHandler = (state, sIndex) => {
    setToggle(state);
    setSIndex(sIndex);
    //console.log('sIndex', sIndex)
  };

  const handleLightBoxUploaded = (items) => {
    const uploadedImage = [
      {
        id: "Input image Id",
        image: `${getImageURL()}/${items.url}`,
        title: "Input Image",
        roomName: "Room name",
      },
    ];
    console.log("Uploaded Image Details:", uploadedImage);
    setLightBoxData(uploadedImage);
    lightBoxHandler(true, 0);
  };

  const handleLightBoxGenerated = (items, generated) => {
    //console.log("🚀 ~ file: FavouriteThumbnail.jsx:49 ~ handleLightBoxGenerated ~ items:", items, generated)
    const generatedImages = items.images.map((generatedImage) => ({
      id: uuidv4(),
      image: `${getImageURL()}/${generatedImage.url}`,
      title: generatedImage.themeName,
      roomName: generatedImage.roomName,
    }));
    console.log("items.images", items.images);
    const index = items.images.findIndex(
      (image) => image._id === generated._id
    );
    console.log("generated._id", generated._id);
    console.log("index", index);
    setLightBoxData(generatedImages);
    setSIndex(index);
    lightBoxHandler(true, index);
  };

  const getImageURL = () => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}`;
  };

  const sortImages = (images) => {
    return [...images].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  };
  const sortedImages = sortImages(items.images);

  return (
    <>
      <SmallScreenImagesModal
        show={smallScreenImagesModal}
        onHide={() => setSmallScreenImagesModal(false)}
        items={items}
        handleImageLike={handleImageLike}
        handleImageUnLike={handleImageUnLike}
        title={"History"}
      />

      <div>
        <ToastContainer />
      </div>

      <div
        className="d-none d-lg-flex mb-3"
        style={{ borderBottom: "0.5px solid #bdbbc07d" }}
      >
        <div>
          <div>
            <Image
              src={`${getImageURL()}/${items.url}`}
              alt="uploaded Image"
              width={187}
              height={127}
              style={{ borderRadius: "8px", width: "187px", height: "127px" }}
              onClick={(event) => {
                event.stopPropagation();
                handleLightBoxUploaded(items);
              }}
            />
            <div>
              <p className="theme_date text-end">
                Uploaded on {formatDate(items.createdOn)}
              </p>
            </div>
          </div>
        </div>
        <div className="conversion-path">
          <img src={conversionPath} alt="conversion" />
        </div>
        <div className="flex-lg-row">
          <div className="d-flex flex-wrap">
            {sortedImages?.map((generated, index) => (
              <div
                key={index}
                className="fav-pic-container me-3"
                style={{ position: "relative" }}
              >
                <span
                  role="button"
                  title="Select objects in this image"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectorImage(generated);
                  }}
                  style={{
                    position: "absolute",
                    top: "6px",
                    left: "6px",
                    zIndex: 2,
                    background: "rgba(127,119,221,0.92)",
                    color: "#fff",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    lineHeight: 1.3,
                  }}
                >
                  Select
                </span>
                <Image
                  src={`${getImageURL()}/${generated.url}`}
                  alt={`generated ${index + 1}`}
                  className="fav-pic"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleLightBoxGenerated(items, generated);
                  }}
                />
                <p className="theme_name mt-1 mb-3">
                  {generated.themeName} style |
                  <span className="theme_date">
                    {" "}
                    {formatDate(generated.createdAt)}
                  </span>
                </p>
                {!generated.isFavorite && (
                  <FavoriteBorderIcon
                    className="hist-unlike-icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleImageLike(generated);
                      notifyLike();
                    }}
                  />
                )}
                {generated.isFavorite && (
                  <FavoriteIcon
                    className="hist-like-icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleImageUnLike(generated);
                      setShowToastUnlike(true);
                      notifyUnlike();
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Row className="d-block d-lg-none">
        <div className="w-100 text-center overflow-y-hidden overflow-x-hidden border-bottom">
          <div className="text-center d-flex align-items-center py-3">
            <Card className="border-0">
              <Image
                src={`${getImageURL()}/${items.url}`}
                alt="uploaded Image"
                className="fav-pic-block"
                onClick={(event) => {
                  event.stopPropagation();
                  handleLightBoxUploaded(items);
                }}
              />
            </Card>
            <div className="align-self-center p-1">
              <img src={conversionPath} alt="conversion" />
            </div>
            <Card className="border-0">
              {items.images.length > 0 && (
                <div>
                  <Image
                    src={`${getImageURL()}/${items.images[0].url}`}
                    alt="generated Image"
                    className="fav-pic-block"
                    onClick={() => {
                      setSmallScreenImagesModal(true);
                    }}
                  />
                  {!items.images[0].isFavorite && (
                    <FavoriteBorderIcon
                      className="hist-unlike-icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleImageLike(items.images[0]);
                      }}
                    />
                  )}
                  {items.images[0].isFavorite && (
                    <FavoriteIcon
                      className="hist-like-icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleImageUnLike(items.images[0]);
                      }}
                    />
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      </Row>
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
      <ObjectSelector
        show={!!selectorImage}
        onHide={() => setSelectorImage(null)}
        image={selectorImage}
        onDone={(blob) => onEditedDone && onEditedDone(blob, selectorImage)}
      />
    </>
  );
}

export default FavouriteThumbnail;
