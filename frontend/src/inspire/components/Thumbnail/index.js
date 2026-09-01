import React, { useState, useEffect, useContext } from "react";
import Card from "react-bootstrap/Card";
import FavFill from "../../assets/images/favorite_fill.svg";
import FavOutline from "../../assets/images/favorite_add.svg";
import checked from "../../assets/images/checked.svg";
import unchecked from "../../assets/images/unchecked.svg";
import "./index.css";
import { StepperContext } from "../../context/StepperContext";

const Thumbnail = ({
  forSelection = false,
  isFavorite = false,
  forFavorite = false,
  imageUrl,
  handleFavSelection,
  handleCheckboxChange,
  width = 98,
  height = 98,
  imageObj = null,
  themeObj = null,
}) => {
  const [imageSrc, setImageSrc] = useState("");
  const {
    activeStep,
    selectedImage,
    setSelectedImage,
    handleNext,
    handleBack,
  } = useContext(StepperContext);

  useEffect(() => {
    const getImageSource = async () => {
      let source;
      if (imageUrl?.includes("/")) {
        source = imageUrl;
      } else {
        source = getImageURL(imageUrl);
      }
      setImageSrc(source);
    };
    getImageSource();
  }, [imageUrl]);

  const getImageURL = (imageName) => {
    const imageURL = `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${imageName}`;
    return imageURL;
  };

  const fetchSelectionStatus = () => {
    if (!selectedImage) {
      return false;
    }
    return (
      (imageObj && imageObj._id === selectedImage._id) ||
      (themeObj && themeObj.theme_name === selectedImage.themeName)
    );
  };
  return (
    <Card
      role="checkbox"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        height: `${height}px`,
        backgroundImage: `url(${encodeURI(imageSrc)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        margin: "4px",
      }}
      className="thumbnail-card"
      onClick={(event) =>
        forSelection && !forFavorite
          ? handleCheckboxChange(event)
          : handleFavSelection(event)
      }
    >
      {forSelection && (
        <img
          role="button"
          src={fetchSelectionStatus() ? checked : unchecked}
          alt="selection"
          style={{
            position: "absolute",
            top: `${width == 98 ? "4px" : "10px"}`,
            right: `${width == 98 ? "4px" : "10px"}`,
            width: `${width == 98 ? "24px" : "32px"}`,
          }}
        />
      )}

      {forFavorite && (
        <img
          role="button"
          src={isFavorite ? FavFill : FavOutline}
          alt="fav"
          style={{
            position: "absolute",
            top: "5px",
            right: "5px",
            width: "22px",
          }}
        />
      )}
    </Card>
  );
};

export default Thumbnail;
