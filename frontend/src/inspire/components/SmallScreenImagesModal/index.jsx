import React, { useState, useEffect } from "react";
import "./index.css";
import { Card, Modal, Image, Row, Col } from "react-bootstrap";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import Carousel from "react-material-ui-carousel";
import { Paper, Button } from "@mui/material";
import zIndex from "@mui/material/styles/zIndex";

function SmallScreenImagesModal({
  show,
  onHide,
  items,
  handleImageLike,
  handleImageUnLike,
  title,
}) {
  const getImageURL = () => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}`;
  };
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentThemeName, setCurrentThemeName] = useState("");
  const [currentRoomName, setCurrentRoomName] = useState("");

  useEffect(() => {
    if (items.images[currentIndex] && items.images[currentIndex].themeName) {
      setCurrentThemeName(items.images[currentIndex].themeName);
      setCurrentRoomName(items.images[currentIndex].roomName);
    }
  }, [currentIndex, items.images]);

  return (
    <>
      <Modal show={show} onHide={onHide} fullscreen>
        <Modal.Header closeButton>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row>
            <Col xs={12} className="p-3">
              <Card className="border-0">
                <p className="image-title">
                  Uploaded Image - {currentRoomName}
                </p>
                <Image
                  src={`${getImageURL()}/${items.url}`}
                  alt="uploaded Image"
                  className="block-pic"
                />
              </Card>
            </Col>
            <Col xs={12} className="p-3">
              <Card className="border-0">
                <p className="image-title">
                  Generated Image{" "}
                  <span className="image-count text-muted">
                    {currentIndex + 1 < 10
                      ? `0${currentIndex + 1}`
                      : currentIndex + 1}
                    /
                    {items.images.length < 10
                      ? `0${items.images.length}`
                      : items.images.length}
                  </span>{" "}
                  {currentThemeName}
                </p>
                {items.images.length > 0 && (
                  <div className="block-pic-icon">
                    <Carousel
                      animation="slide"
                      autoPlay="false"
                      interval={50000}
                      fullHeightHover={false}
                      index={currentIndex}
                      onChange={(index) => setCurrentIndex(index)}
                    >
                      {(Array.isArray(items?.images) ? items.images : []).map((generated, index) => (
                        <div key={index}>
                          <Paper key={index}>
                            <Image
                              src={`${getImageURL()}/${generated.url}`}
                              alt="generated Image"
                              className="block-pic"
                            />
                          </Paper>
                          {!generated.isFavorite && (
                            <Button
                              className="block-icon unlike"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleImageLike(generated);
                              }}
                            >
                              <FavoriteBorderIcon />
                            </Button>
                          )}
                          {generated.isFavorite && (
                            <Button
                              className="block-icon like"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleImageUnLike(generated);
                              }}
                            >
                              <FavoriteIcon />
                            </Button>
                          )}
                        </div>
                      ))}
                    </Carousel>
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </Modal.Body>
      </Modal>
    </>
  );
}

export default SmallScreenImagesModal;
