import React from "react";
import { useNavigate } from "react-router-dom";
import { Button, Container, Row } from "react-bootstrap";
import Image from "react-bootstrap/Image";
import NotFound404Image from "../../assets/images/404.jpg";
import PageNotFound from "../../assets/images/page_not_found.svg";

const NotFound = () => {
  const navigate = useNavigate();

  const handleGoHome = () => {
    navigate("/");
  };

  return (
    <>
      <Container fluid className="page-not-found-container">
        <Row>
          <img src={PageNotFound} alt="page not found" width={'120px'} height={'120px'} />
        </Row>
        <Row className="pb-4 pt-2">
          <h4 className="text-center fw-bold">Oops!</h4>
          <h5 className="text-center page_not_found_message"
          >Looks like we're on a treasure hunt! Let's find that missing page together. </h5>
        </Row>
        <Row>
          <Button
            className="primary-button-filled"
            variant="primary"
            onClick={handleGoHome}
          >
            Go Back Home
          </Button>
        </Row>
      </Container>


      {/* <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            margin: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image src={NotFound404Image} width="30%" />
        </div>
        <div>
          <Button
            className="primary-button-filled"
            onClick={handleGoHome}
          >
            Go Back Home
          </Button>
        </div>
      </div> */}
    </>
  );
};

export default NotFound;
