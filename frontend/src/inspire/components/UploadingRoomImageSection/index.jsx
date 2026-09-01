import React, { useContext, useEffect, useRef, useState } from "react";
import UploadImage from "../../assets/images/new_upload_image.svg";
import { StepperContext } from "../../context/StepperContext";
import UserContext from "../../context/UserContext";
import Thumbnail from "../Thumbnail";
import "./index.css";

import { Button, Card, ProgressBar } from "react-bootstrap";
import Delete from "../../assets/images/delete.svg";

const UploadRoomImageSection = ({
  selected,
  index,
  handleImageUpload,
  handleRemoveImage,
  imagesData,
  roomName,
  inlineLoader,
  uploadedRoomName,
  onDeleteRoom,
  progress,
}) => {
  const {
    activeStep,
    selectedImage,
    setSelectedImage,
    handleNext,
    handleBack,
  } = useContext(StepperContext);

  const fileInputRef = useRef(null);
  const { currentUser } = useContext(UserContext);
  const [showUploadImage, setShowUploadImage] = useState(false);

  useEffect(() => {
    setShowUploadImage(selected !== "Select Room");
  }, [selected, selectedImage]);

  const handleImageChange = (e) => {
    e.preventDefault();
    handleImageUpload(e);
  };

  const onHandleImageUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleSelectedImage = (imageObj, selected) => {
    setSelectedImage(selected ? imageObj : null);
  };

  const getImageURL = (imageName) => {
    const imageURL = `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${imageName}`;
    return imageURL;
  };

  return (
    <>
      <div className="mt-lg-3 mb-4 p-2">
        <div className="title_border d-flex align-items-start">
          {roomName !== "Select Room" && (
            <>
              <p className="ms-2 title_text">
                {roomName}
                {!inlineLoader && (
                  <Button className="mx-3 button-icons">
                    <img
                      onClick={onDeleteRoom}
                      src={Delete}
                      alt="delete"
                    />
                  </Button>
                )}
              </p>
            </>
          )}
        </div>
        <div className="d-flex flex-wrap align-items-start justify-content-start mt-3">
          {selected !== "Select Room" && (
            <>
              {imagesData.map((image, index) => {
                return (
                  <div
                    key={image._id ? image._id : index}
                    className="text-center"
                  >
                    <Thumbnail
                      imageUrl={image.url}
                      imageObj={image}
                      width="288"
                      height="288"
                      fileInputRef={fileInputRef}
                      forSelection={true}
                      isSelected={
                        selectedImage && image._id === selectedImage._id
                          ? true
                          : false
                      }
                      handleCheckboxChange={(event) =>
                        handleSelectedImage(image, event)
                      }
                    />

                    <Button
                      variant="link"
                      size="sm"
                      className="py-2"
                      onClick={() => handleRemoveImage(image._id)}
                      disabled={inlineLoader}
                      style={{
                        borderRadius: 0,
                        color: "red",
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
            </>
          )}
          {showUploadImage && !inlineLoader && (
            <>
              <Card
                className="upload-placeholder-card"
                style={{
                  backgroundImage: `url(${encodeURI(UploadImage)})`,
                  backgroundSize: "40%",
                  borderRadius: "8px",
                  backgroundPosition: "center",
                  margin: "4px",
                  backgroundRepeat: "no-repeat",
                }}
                onClick={onHandleImageUpload}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept="image/*"
                  onChange={handleImageChange}
                />
              </Card>
            </>
          )}
          {inlineLoader && uploadedRoomName == roomName && (
            <>
              <Card
                style={{
                  width: "288px",
                  height: "288px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  borderStyle: "dotted",
                  borderWidth: "2px",
                  borderColor: "#ccc",
                  margin: "8px",
                }}
              >
                <Card.Body></Card.Body>
                <Card.Footer className="border-0">
                  <ProgressBar
                    now={progress}
                    variant="primary"
                    animated
                    label={`${progress}%`}
                  />
                </Card.Footer>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default UploadRoomImageSection;
