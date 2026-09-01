import React, { useContext, useEffect, useState } from "react";
import { Button, Col, Container, Row } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import NoData from "../../assets/images/no_data.svg";
import TitleHeader from "../../components/TitleHeader";
import UserRoleContext from "../../context/UserRoleContext";
import { LightBox } from "react-lightbox-pack";
import "react-lightbox-pack/dist/index.css";
import { formatDate } from "../../utils/genericFunctions";

function UploadedImages({ images }) {
  //console.log('images', images);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [isDataLoading, setDataLoading] = useState(true);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [toggle, setToggle] = React.useState(false);
  const [sIndex, setSIndex] = React.useState(0);
  const [lightBoxData, setLightBoxData] = React.useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setDataLoading(true);
    const loadingTimeout = setTimeout(() => {
      const groupedImages = groupImages(images);
      const groupedImagesArray = Object.values(groupedImages);
      setUploadedImages(groupedImagesArray);
      setDataLoading(false);
    }, 2500);
    return () => {
      clearTimeout(loadingTimeout);
    };
  }, [images]);

  useEffect(() => {
    if (!isDataLoading) {
      setLoading(false); // Set isLoading to false
    }
  }, [isDataLoading, setLoading]);

  function groupImages(images) {
    return images.reduce((groups, uploadedImage) => {
      const { roomName, _id } = uploadedImage || {};
      if (roomName) {
        if (!groups[roomName]) {
          groups[roomName] = {};
        }
        if (!groups[roomName][_id]) {
          groups[roomName][_id] = uploadedImage;
        }
      }
      return groups;
    }, {});
  }

  const navigateToDashboard = () => {
    navigate("/dashboard");
  };

  const lightBoxHandler = (state, sIndex) => {
    console.log("state", state, "sIndex", sIndex);
    setToggle(state);
    setSIndex(sIndex);
  };

  const handleLightBoxUploaded = (images, roomName, index) => {
    const uploadedImage = images
      .filter((image) => image.roomName === roomName)
      .map((image) => ({
        id: image.id,
        image: `${getImageURL()}/${image.url}`,
        title: image.title,
        roomName: image.roomName,
      }));
    setLightBoxData(uploadedImage);
    lightBoxHandler(true, index);
  };

  const getImageURL = () => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}`;
  };

  return (
    <Container
      fluid
      style={{
        paddingBottom: "144px",
        marginLeft: "14px",
        overflowX: "hidden",
      }}
    >
      {isDataLoading ? (
        <></>
      ) : isLoading ? (
        <></>
      ) : uploadedImages?.length > 0 ? (
        uploadedImages.map((imageGroup, groupIndex) => (
          <Row
            key={groupIndex}
            className="d-flex"
            style={{ borderBottom: "0.5px solid #bdbbc07d" }}
          >
            <div className="mt-3 p-0">
              <TitleHeader title={Object.values(imageGroup)[0]?.roomName} />
            </div>
            <Col className="d-flex flex-row flex-wrap w-100 pt-3 ps-0">
              {Object.values(imageGroup).map((uploadedImage, index) => (
                <div key={uploadedImage?._id} className="pb-2">
                  <img
                    src={`${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${uploadedImage?.url}`}
                    alt="sample"
                    width={187}
                    height={127}
                    style={{
                      borderRadius: "8px",
                      marginRight: "10px",
                      cursor: "pointer",
                      objectFit: "cover",
                      width: "187px",
                      height: "127px",
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleLightBoxUploaded(
                        images,
                        Object.values(imageGroup)[0]?.roomName,
                        index
                      );
                    }}
                  />
                  <div className="mr-2 ">
                    <p className="uploaded_time">
                      {formatDate(uploadedImage?.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </Col>
          </Row>
        ))
      ) : (
        <Container
          fluid
          className="d-flex flex-column align-items-center justify-content-center pb-0"
          style={{ height: "calc(100vh - 100px" }}
        >
          <Row className="pb-3">
            <img src={NoData} alt="nodata" width={"86px"} height={"109px"} />
          </Row>
          <Row>
            <p className="noData text-center">
              Your creative journey is ready to begin!
            </p>
          </Row>
          <Row>
            <Button
              onClick={navigateToDashboard}
              className="primary-button-filled"
            >
              Upload Images
            </Button>
          </Row>
        </Container>
      )}
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
  );
}

export default UploadedImages;
