import React, { useContext, useEffect, useState } from "react";
import "./index.css";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import { Button, Card, Container, ToggleButton } from "react-bootstrap";
import { StepperContext } from "../../context/StepperContext";

const PhotoGallery = ({ themeName, imageIndex, images, galleryClosed }) => {

  const [isOpen, setIsOpen] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const closeGallery = () => {
    setIsOpen(false);
    setCurrentImageIndex(0);
    galleryClosed();
  };

  useEffect(() => {
    console.log("image Index", imageIndex);
      setCurrentImageIndex((imageIndex) % images.length);
  }, [imageIndex]);

  const nextImage = () => {
    setCurrentImageIndex((currentImageIndex + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex(
      (currentImageIndex - 1 + images.length) % images.length
    );
  };

  return (
    <Container fluid>
      {isOpen ? (
        <div className="lightbox-overlay">
          <CloseIcon className="close-icon" onClick={closeGallery} />
          <div className="theme-name">
            <p className="theme-name-text">{themeName}</p>
          </div>
          <div>
            {currentImageIndex > 0 ? (
              <button className="prev-button" onClick={prevImage}>
                <ArrowBackIosIcon color="#fff" />
              </button>
            ) : null}
            <div className="lightbox-container">
              <img
                src={images[currentImageIndex].url}
                alt={images[currentImageIndex].id}
                className="lightbox-image"
              />
            </div>
            {currentImageIndex < images.length - 1 ? (
              <button className="next-button" onClick={nextImage}>
                <ArrowForwardIosIcon color="#fff" />
              </button>
            ) : null}
          </div>
          <div className="gallery-container">
            {images?.length
              ? images.map((image, index) => (
                  <Card
                    key={index}
                    style={{
                      width: "7rem",
                      height: "7rem",
                      backgroundImage: `url(${encodeURI(image.url)})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      marginRight: "16px",
                    }}
                    className={
                      currentImageIndex === index
                        ? "selected-gallery-image"
                        : "gallery-image"
                    }
                    onClick={() => setCurrentImageIndex(index)}
                  ></Card>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </Container>
  );
};

export default PhotoGallery;
