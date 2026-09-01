import React, { useContext, useState, useEffect } from "react";
import { Navbar, Row, Stack } from "react-bootstrap";
import Thumbnail from "../../components/Thumbnail";
import { StepperContext } from "../../context/StepperContext";
import "../UploadingRoomImageSection/index.css";
import "./index.css";
import { size } from "lodash";

const Stepper1Collapsed = ({ rooms }) => {
  const { setSelectedImage, setActiveStep } = useContext(StepperContext);
  const [selectedImageTitle, setSelectedImageTitle] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);

  const handleSelectedImage = (imageObj, index) => {
    setSelectedImage(imageObj);
    setSelectedImageTitle(index);
    setSelectedImageId(imageObj._id);
    console.log("selectedImageId", selectedImageId);
  };

  const navigateStepperTo = (value) => {
    setActiveStep(value);
  };

  useEffect(() => {
    if (Array.isArray(rooms) && rooms.length > 0) {
      const firstImage = rooms[0]?.images?.[0];
      if (firstImage) {
        setSelectedImage(firstImage);
        setSelectedImageId(firstImage._id);
      }
    }
  }, [rooms]);

  return (
    <>
      <div className="h-100vh">
        <Row
          className="p-0 m-0"
          style={{
            borderBottom: "1px solid rgba(28, 27, 31, 0.25)",
            minHeight: "101px",
          }}
        >
          <Navbar className="d-flex flex-column align-items-center justify-content-center m-0 p-0 title-header-color border-right">
            <div
              className="d-flex flex-column align-items-center justify-content-center"
              style={{ cursor: "pointer" }}
              onClick={() => navigateStepperTo(1)}
            >
              <h3
                className="display-5 fw-bold m-0"
                style={{ fontSize: "36px" }}
              >
                01
              </h3>
              <Navbar.Brand
                className="text-wrap text-center fs-16 m-0 title"
                style={{ padding: "0px 0 12px 0" }}
              >
                CHOOSE A ROOM
              </Navbar.Brand>
            </div>
          </Navbar>
        </Row>
        <div
          className="overflow-y-auto overflow-x-hidden bg-white"
          style={{
            height: `calc(100vh - 140px)`,
            padding: "12px 0 100px 0",
            width: "124px",
          }}
        >
          {(Array.isArray(rooms) ? rooms : []).map((room, roomIndex) => (
            <Stack key={room._id ?? roomIndex} className="d-flex align-items-center">
              {(Array.isArray(room?.images) ? room.images : []).map((image, imageIndex) => {
                const isSelected = selectedImageId === image._id;
                return (
                  <div key={image._id ?? image.url ?? imageIndex}>
                    <Thumbnail
                      imageUrl={image.url}
                      imageObj={image}
                      forSelection={true}
                      handleCheckboxChange={() =>
                        handleSelectedImage(image, imageIndex)
                      }
                    />
                    <h6
                      className={`mt-1 text-center ${
                        isSelected ? "selected-room" : ""
                      }`}
                    >
                      {room?.roomName}
                    </h6>
                  </div>
                );
              })}
            </Stack>
          ))}
        </div>
      </div>
    </>
  );
};

export default Stepper1Collapsed;
