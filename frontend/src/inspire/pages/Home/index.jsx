import React, { useEffect, useState, useContext, useRef } from "react";
import "./index.css";
import { Dropdown, Container, Row, Col, Stack } from "react-bootstrap";
import Button from "react-bootstrap/Button";
import { useNavigate, useLocation } from "react-router-dom";
import { useTypeStore } from "../../context/TypeStoreContext";
import { createProject, getProject } from "../../services/projectService";
import { removeDuplicatesInArray } from "../../utils/genericFunctions";
import ProjectContext from "../../context/ProjectContext";
import UserContext from "../../context/UserContext";
import roomTypes from "../../utils/roomTypes";
import UploadImage from "../../assets/images/upload_image.svg";
import UserRoleContext from "../../context/UserRoleContext";
import StepCircle from "../../assets/images/step_circle.svg";
import StepBar from "../../assets/images/step_bar.svg";
import { USER_ROLES } from "../../utils/constants";
import ServiceContext from "../../context/ServiceContext";

const Home = () => {
  const location = useLocation();
  const isSignUp = location?.state?.isSignUp;
  const typeStoreContext = useTypeStore();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject } = useContext(ProjectContext);
  const { currentUser } = useContext(UserContext);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const { authService, imagesService } = useContext(ServiceContext);
  const isCreatingProjectRef = useRef(false);

  // Runs for ANY signed-in client, not just someone arriving from sign-up.
  //
  // This used to be gated on `isSignUp`, which is navigation state set only by
  // the sign-up page. An INVITED client (email link -> set password -> sign in)
  // never passes through sign-up, so they ended up with no project at all: the
  // uploader then sent `projectID: "undefined"` and calls hit
  // /projects/undefined -> 404.
  //
  // Safe for existing users: handleProjectCreation only creates when the client
  // genuinely has none, otherwise it just adopts their first project.
  useEffect(() => {
    if (currentUser && !isCreatingProjectRef.current) {
      isCreatingProjectRef.current = true;
      handleProjectCreation();
    }
  }, [isSignUp, currentUser]);

  useEffect(() => {
    if (currentProject?._id) {
      getUserImages();
    }
  }, [currentProject]);

  const getUserImages = async () => {
    setLoading(true);
    const generatedImages = await imagesService.getGeneratedImages(currentProject?._id);
    console.debug("DEBUG: HomePage ~ getUserImages ~ generatedImages:",generatedImages);

    if (generatedImages?.data?.length > 0) {
      setLoading(false);
      navigateToProject();
    } else {
      const uploadedImages = await imagesService.getImages(currentProject?._id);
      console.debug("DEBUG: HomePage ~ getUserImages ~ uploadedImages:",uploadedImages?.data?.length);
      setLoading(false);
      if (uploadedImages?.data?.length) {
        // Automatic redirect → replace so Back doesn't return to this router page.
        navigate(`/dashboard`, { replace: true });
      }
    }
  };

  // AUTOMATIC redirect (image-based routing on mount), not a user click — so
  // replace the "/" entry instead of pushing. Otherwise Back walks into the
  // intermediate page the app auto-navigated through (e.g. an empty
  // /project-detail), which reads as a broken back-button flow.
  const navigateToProject = () => {
    navigate(`/project-detail`, { replace: true });
  };

  // USER click ("Get Started") → normal push, so Back correctly returns here to
  // the Home landing page. (The automatic image-based redirect to /dashboard
  // uses replace inline in getUserImages, above.)
  const navigateToDashboard = () => {
    navigate(`/dashboard`);
  };

  const handleProjectCreation = async () => {
    if (currentUser?.permissions === USER_ROLES.USER) {
      const projects = await getProject(currentUser?._id);
      if (projects?.data?.length) {
        setCurrentProject(projects.data[0]);
      } else {
        const createProjectResponse = await createProject({
          name: "My Project",
          status: "open",
          ownerUserId: currentUser?._id,
        });
        createProjectResponse && setCurrentProject(createProjectResponse);
      }
    }
  };

  const handleDropdownSelect = (id) => {
    const response = roomTypes.find((room) => room.id == id);
    navigate(`/dashboard?roomType=${response.roomType}`);
  };

  return (
    <>
      <Container fluid className="bg-img-container px-0">
        <div className="overlay d-flex align-items-center  justify-content-center flex-column">
          <Row className=" mw-900">
            <h1 className="dashboard_heading_desktop dashboard_heading_mobile">
              Design your dream house in Just{" "}
              <span className="dashboard_heading_desktop dashboard_heading_mobile"
                style={{
                  color: '#414063', WebkitTextStroke: '1px #FFFFFF',
                }}
              >
                {" "}
                3 steps
              </span>
            </h1>
          </Row>
          <div className="dashboard_mobile_border mb-4"></div>
          <Row className="step_bar d-none d-lg-block">
            <img src={StepBar} alt="stepbar" />
          </Row>
          <Row style={{ width: '900px' }} className="d-flex flex-lg-row flex-column">
            <Col className="step_flow mb-lg-0 mb-3">
              <div className="position-relative">
                <img src={StepCircle} alt="stepcircle" />
                <p className="step_number">01</p>
              </div>
              <div>
                <p className="step_text stepper-text-mobile">Select Room Type</p>
              </div>
            </Col>
            <Col className="step_flow mb-lg-0 mb-3">
              <div className="position-relative">
                <img src={StepCircle} alt="stepcircle" />
                <p className="step_number">02</p>
              </div>
              <div>
                <p className="step_text stepper-text-mobile">Select Room Theme</p>
              </div>
            </Col>
            <Col className="step_flow">
              <div className="position-relative">
                <img src={StepCircle} alt="stepcircle" />
                <p className="step_number">03</p>
              </div>
              <div>
                <p className="step_text stepper-text-mobile">Generate Image</p>
              </div>
            </Col>
          </Row>
          <div className="dashboard_mobile_border mb-3"></div>
          {/* <Row className="d-block d-lg-none">
            <p className="try-now-home mb-2">Try now</p>
          </Row> */}
          <Row className="d-block">
            <Button
              className="primary-button-filled"
              size="lg"
              onClick={navigateToDashboard}
            >
              Get Started
            </Button>
          </Row>
        </div>
      </Container>
    </>
  );
};

export default Home;
