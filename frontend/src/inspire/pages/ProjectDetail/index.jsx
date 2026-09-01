import React, { useContext, useEffect, useMemo, useState } from "react";
import { Button, Container, Modal, Navbar, Row, Stack } from "react-bootstrap";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import "react-perfect-scrollbar/dist/css/styles.css";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import AddProject from "../../components/AddProject";
import AppHeader from "../../components/AppHeader";
import { CountContext } from "../../context/CountContext";
import ProjectContext from "../../context/ProjectContext";
import UserContext from "../../context/UserContext";
import UserRoleContext from "../../context/UserRoleContext";
import { getCurrentUser, signInGuestUser } from "../../services/authService";
import {
  getGeneratedImages,
  getImages,
  updateImageInfo,
} from "../../services/imagesService";
import {
  getProject,
  getProjectById,
  getProjectByShareId,
  updateProject,
} from "../../services/projectService";
import { uploadImage } from "../../services/uploadService";
import { USER_ROLES } from "../../utils/constants";
import Favourites from "../Favourites";
import History from "../History";
import UploadedImages from "./UploadedImages";
import ProjectInfoCard from "./ProjectInfoCard";
import ProjectWorkspace from "../../components/ProjectWorkspace";
import ProjectTracker from "../../components/ProjectTracker";
import "./index.css";
import NoHistory from "../../assets/images/no_history.svg";
import ServiceContext from "../../context/ServiceContext";
import { ACTIVE_TAB } from "../../utils/constants";
import GetQuoteModal from "../../components/GetQuoteModal";
import BoqScreen from "../../components/BoqScreen";
import { getProjectFlags } from "../../services/projectWorkspaceService";

const ProjectDetail = () => {
  const location = useLocation();
  const params = useParams();
  const [activeTab, setActiveTab] = useState("");
  // Client "Reject quote" flow — a confirm modal with an optional reason.
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const projectId = location.pathname.includes("project-detail")
    ? params?.id
    : null;
  const shareId = location.pathname.includes("share") ? params?.id : null;
  const { currentUser, setCurrentUser } = useContext(UserContext);
  const { currentProject, setCurrentProject } = useContext(ProjectContext);
  // Open a specific tab when linked with ?tab=... (e.g. the admin "Workspace"
  // button jumps straight to the Project Workspace tab).
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("tab");
    if (t) setActiveTab(t);
  }, [location.search]);
  const [showEditProject, setShowEditProject] = useState(false);
  const [historyImages, setHistoryImages] = useState([]);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [editedImages, setEditedImages] = useState([]);
  const [favoriteImages, setFavoriteImages] = useState([]);
  const [isGuestUser, setIsGuestUser] = useState(false);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [showLogo, setShowLogo] = useState(true);
  const currentUrl = window.location.href;
  const url = new URL(currentUrl);
  const queryParams = new URLSearchParams(url.search);
  const navigate = useNavigate();
  const [selectedTabKey, setSelectedTabKey] = useState(ACTIVE_TAB.HISTORY);
  const { setHistoryStatus, setFavoriteStatus, favoriteStatus, historyStatus } =
    useContext(CountContext);
  const { authService, imagesService } = useContext(ServiceContext);
  const [showGetQuoteModal, setShowGetQuoteModal] = useState(false);
  const [showBoqScreen, setShowBoqScreen] = useState(false);
  // Which Project Workspace sub-section to open (e.g. "change" when the client
  // clicks "Request a change"). The nonce re-triggers navigation on each click.
  const [workspaceSection, setWorkspaceSection] = useState("");
  const [sectionNonce, setSectionNonce] = useState(0);
  // The design backend owns `changeRequestPending`; the AI backend (which
  // currentProject comes from) doesn't, so we read the flag from there.
  const [changeReqPending, setChangeReqPending] = useState(false);
  const openWorkspaceSection = (key) => {
    setActiveTab("workspace");
    setWorkspaceSection(key);
    setSectionNonce((n) => n + 1);
  };
  // Clicking a tracker step filters the workspace below to that step.
  const [workspaceStage, setWorkspaceStage] = useState("");

  useEffect(() => {
    setHistoryImages([]);
    setUploadedImages([]);
    setEditedImages([]);
    setFavoriteImages([]);
  }, []);

  useEffect(() => {
    setActiveTabBasedOnURL();
  }, [location.search]);

  const setActiveTabBasedOnURL = () => {
    // An explicit ?tab= selection (e.g. workspace) must win. Otherwise the
    // history-images heuristic below force-selects "All Images" and snaps the
    // user off tabs it doesn't recognise here — like Project Workspace.
    const explicitTab = new URLSearchParams(location.search).get("tab");
    if (explicitTab) {
      setActiveTab(explicitTab);
      return;
    }
    if (location.search.includes(ACTIVE_TAB.HISTORY)) {
      setActiveTab(ACTIVE_TAB.HISTORY);
    } else if (location.search.includes(ACTIVE_TAB.FAVORITES)) {
      setActiveTab(ACTIVE_TAB.FAVORITES);
    } else if (location.search.includes(ACTIVE_TAB.UPLOADED_IMAGES)) {
      setActiveTab(ACTIVE_TAB.UPLOADED_IMAGES);
    } else if (historyImages.length > 0 && favoriteImages.length === 0) {
      setActiveTab(ACTIVE_TAB.HISTORY); // Navigate to History tab if there are history images but no favorites
    }
  };

  useEffect(() => {
    if (currentUser?._id && currentProject?._id) {
      document.title = "PROJECT DETAILS"; // console.log("currentProject", currentProject);
      getProjectDetailsAndImages();
      console.log(
        "🚀 ~ file: index.jsx:81 ~ useEffect ~ getProjectDetailsAndImages:"
      );
    }
  }, [currentProject]);

  useEffect(() => {
    if (projectId && currentUser) {
      getProjectDetailsByProjectId();
    } else if (shareId && !currentUser) {
      getUserProjectImagesForGuestUser();
    } else if (shareId && currentUser) {
      document.title = "PROJECT DETAILS"; // console.log("currentProject", currentProject);
      getProjectDetailsByShareId(shareId);
    }
  }, [projectId, shareId, currentUser]);

  const getProjectDetailsByProjectId = async () => {
    const projectResponse = await getProjectById(projectId);
    if (projectResponse) {
      setCurrentProject(projectResponse);
      getProjectDetailsAndImages(projectResponse);
    }
  };

  const getUserProjectImagesForGuestUser = async () => {
    const userDataFound = getCurrentUser();
    if (currentUser || userDataFound) {
      if (!currentUser) {
        setCurrentUser(userDataFound);
      }
      if (!currentProject && currentUser?.permissions === USER_ROLES.USER) {
        const projectResponse = await getProject(
          currentUser?._id ?? userDataFound?._id
        );
        if (projectResponse?.data?.length) {
          if (shareId) {
            const proj = projectResponse?.data?.find(
              (proj) => proj.shareId == shareId
            );
            setCurrentProject(proj);
            getProjectDetailsAndImages(proj);
          } else {
            setCurrentProject(projectResponse?.data[0]);
            getProjectDetailsAndImages(projectResponse?.data[0]);
          }
        }
      }
    } else if (shareId) {
      setIsGuestUser(true);
      const user = await authService.signInGuestUser();
      if (user) {
        console.log("Inside shareProject", shareId);
        console.log("isGuestUser", isGuestUser);
        const resp = await getProjectByShareId(shareId, user?.accessToken);
        if (resp?.data?.length) {
          setCurrentProject(resp?.data[0]);
          getProjectDetailsAndImages(resp?.data[0], true);
        }
      }
    }
  };

  const getProjectDetailsAndImages = async (project, isGuestUser) => {
    setLoading(true);
    const imagesResponse = await imagesService.getGeneratedImages(
      project?._id,
      isGuestUser
    );
    const uploadedImages = await imagesService.getImages(
      project?._id,
      isGuestUser
    );
    const editedResponse = await imagesService.getImagesByType(
      project?._id,
      "edited",
      isGuestUser
    );
    console.log("Inside getProjectDetailsAndImages", {
      generatedImages: imagesResponse,
      uploadedImages,
      editedImages: editedResponse,
      project,
    });
    if (imagesResponse?.data?.length) {
      setHistoryImages(imagesResponse.data);
      getFavoriteImages(imagesResponse.data);
    }
    if (uploadedImages?.data?.length) {
      setUploadedImages(uploadedImages.data);
    }
    setEditedImages(editedResponse?.data || []);
    setLoading(false);
  };

  const getProjectDetailsByShareId = async (shareId) => {
    // setLoading(true);
    const imagesResponse = await imagesService.getGeneratedImages(shareId);
    const uploadedImages = await imagesService.getImages(shareId);
    const editedResponse = await imagesService.getImagesByType(
      shareId,
      "edited"
    );
    console.log("Inside getProjectDetailsByShareId", {
      generatedImages: imagesResponse,
      uploadedImages,
      editedImages: editedResponse,
      shareId,
    });
    if (imagesResponse?.data?.length) {
      setHistoryImages(imagesResponse.data);
      getFavoriteImages(imagesResponse.data);
    }
    if (uploadedImages?.data?.length) {
      setUploadedImages(uploadedImages.data);
    }
    setEditedImages(editedResponse?.data || []);
    // setLoading(false);
  };

  const getFavoriteImages = (images) => {
    if (images?.length) {
      const favoriteImages = images.filter((image) => image.isFavorite);
      setFavoriteImages(favoriteImages);
      return favoriteImages;
    }
  };

  const handleImageLike = async (image) => {
    await imagesService.updateImageInfo(image?._id, {
      isFavorite: true,
    });
    const favImage =
      historyImages.find((item) => item._id === image._id) ||
      editedImages.find((item) => item._id === image._id);
    if (favImage) {
      favImage.isFavorite = true;
      //setHistoryImages([...historyImages]);
      setFavoriteStatus();
      setFavoriteImages((prevImages) => {
        const updatedImages = [...prevImages, favImage];
        // console.log("Favorite Images Count:", updatedImages.length);
        return updatedImages;
      });
    }
  };

  const handleImageUnLike = async (image) => {
    const updateImageResponse = await imagesService.updateImageInfo(
      image?._id,
      {
        isFavorite: false,
      }
    );

    const favImage =
      historyImages.find((item) => item._id === image._id) ||
      editedImages.find((item) => item._id === image._id);

    if (favImage) {
      favImage.isFavorite = false;
      //setHistoryImages([...historyImages]);
      setFavoriteStatus();
      const newArray = favoriteImages.filter(
        (favImg) => favImg._id !== image._id
      );
      setFavoriteImages(newArray);
    }
  };

  // Editor "Done" from the All Images page: persist the edited photo as an
  // 'edited' image (before this, edits made here were discarded), then refresh
  // the edited list so it shows up in its own section. `source` is the
  // generated image the edit was based on — we copy its room/theme metadata.
  const handleEditedDone = async (blob, source) => {
    if (!blob) return;
    const file = new File([blob], `edited-${Date.now()}.png`, {
      type: "image/png",
    });
    const uploaded = await uploadImage(file);
    if (!uploaded?.key) {
      toast.error("Could not save the edited image. Please try again.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }
    await imagesService.saveImageInfo({
      url: uploaded.key,
      imageType: "edited",
      inputImageId: source?._id,
      projectID: source?.projectID || currentProject?._id,
      userId: source?.userId || currentUser?._id,
      roomType: source?.roomType,
      roomName: source?.roomName,
      themeName: source?.themeName,
    });
    toast.success("Edited design saved!", {
      position: toast.POSITION.TOP_RIGHT,
      theme: "colored",
    });
    const res = await imagesService.getImagesByType(
      currentProject?._id,
      "edited",
      isGuestUser
    );
    setEditedImages(res?.data || []);
  };

  const handleEditProject = () => {
    setShowEditProject(true);
  };

  const handleUpdateProjectDetails = async (data) => {
    if (data) {
      const response = await updateProject(currentProject?._id, {
        name: data.name,
        clientName: data.clientName,
        address: data.address,
      });
      if (response?.data?.length) {
        setCurrentProject(response?.data[0]);
      }
    }
    setShowEditProject(false);
  };

  const getImageURL = (imageName) => {
    return `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${imageName}`;
  };

  const handleTabSelect = (selectedKey) => {
    // Update the URL with the selected tab
    queryParams.set("tab", selectedKey);
    navigate(`?${queryParams.toString()}`);
    setSelectedTabKey(selectedKey);
  };

  useEffect(() => {
    if (activeTab) {
      setSelectedTabKey(activeTab);
    }
  }, [currentUser, currentProject]);

  const navigateToDashboard = () => {
    navigate("/dashboard");
  };

  // A client may (re)request a quote ONLY when the project is not already in an
  // active quote/build cycle — otherwise the click would reset an in-progress
  // project back to "quotation_requested" and break the flow (and rewind the
  // tracker). Allowed only from a fresh (open), finished (closed) or
  // previously-rejected project.
  const quoteInProgress = [
    "quotation_requested",
    "quotation_pending_approval",
    "quotation_sent",
    "quotation_accepted",
  ].includes(currentProject?.status);

  const handleGetQuote = async () => {
    const data = { status: "quotation_requested" };
    const updateResponse = await updateProject(currentProject?._id, data);
    console.log(
      "🚀 ~ file: Stepper3Expanded.jsx:138 ~ handleRequestForQuote ~ updateResponse:",
      updateResponse
    );
    if (updateResponse) {
      toast.success("Quotation requested!", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    }
  };

  const handleGetQuoteModal = () => {
    if (quoteInProgress) {
      toast.info("A quotation is already in progress for this project.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }
    setShowGetQuoteModal(true);
  };

  // Client accepts the sent quote → status 'quotation_accepted' (notifies admin).
  const handleAcceptQuote = async () => {
    const resp = await updateProject(currentProject?._id, {
      status: "quotation_accepted",
    });
    if (resp) {
      setCurrentProject(resp);
      const wa = resp?.whatsapp;
      const waMsg = wa?.sent
        ? ` · WhatsApp sent to +${wa.to}`
        : wa?.skipped && wa.reason === "no_phone"
        ? " · WhatsApp skipped — no phone"
        : wa && !wa.sent && !wa.skipped
        ? " · WhatsApp failed"
        : "";
      toast.success(
        "Quotation accepted — the team has been notified." + waMsg,
        {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        }
      );
    } else {
      toast.error("Could not accept the quotation. Please try again.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    }
  };

  // Client rejects the sent quote → status 'quotation_rejected' with an optional
  // reason (notifies the team, who can send a revised quote or close it).
  const submitReject = async () => {
    setRejecting(true);
    const resp = await updateProject(currentProject?._id, {
      status: "quotation_rejected",
      rejectReason: rejectReason.trim(),
    });
    setRejecting(false);
    if (resp) {
      setCurrentProject(resp);
      setShowRejectModal(false);
      setRejectReason("");
      const wa = resp?.whatsapp;
      const waMsg = wa?.sent
        ? ` · WhatsApp sent to +${wa.to}`
        : wa?.skipped && wa.reason === "no_phone"
        ? " · WhatsApp skipped — no phone"
        : wa && !wa.sent && !wa.skipped
        ? " · WhatsApp failed"
        : "";
      toast.success(
        "Quotation rejected — the team has been notified." + waMsg,
        {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        }
      );
    } else {
      toast.error("Could not reject the quotation. Please try again.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    }
  };

  // Client wants changes → open the Project Workspace tab AND its Change
  // Requests section, where they raise the change (which notifies the team and
  // reopens the quote for a revision — the existing flow).
  const handleRequestChange = () => openWorkspaceSection("change");

  // Read the pending-change flag from the design backend (its source of truth),
  // so the quote bar hides after a change request and returns only when a
  // revised quotation is sent (which clears the flag on the backend).
  const refreshQuoteFlag = async () => {
    const pid = projectId || currentProject?._id;
    if (!pid) return;
    const { changeRequestPending } = await getProjectFlags(pid);
    setChangeReqPending(!!changeRequestPending);
  };
  useEffect(() => {
    if (currentProject?._id) refreshQuoteFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?._id, currentProject?.status]);

  // Open the BOQ as an in-app SCREEN (the line items + totals), not just the PDF.
  // The screen itself offers a "Download PDF" for the archived quote document.
  const handleViewBoq = () => setShowBoqScreen(true);

  return (
    <>
      <AppHeader
        user={currentUser}
        showLogo={showLogo}
        setShowLogo={setShowLogo}
        isGuestUser={isGuestUser}
      />
      {!isGuestUser ? (
        <Modal animation show={showEditProject} size="sm" backdrop>
          <AddProject
            currentProject={currentProject}
            handleClose={() => setShowEditProject(false)}
            handleSubmit={(data) => handleUpdateProjectDetails(data)}
          />
        </Modal>
      ) : null}

      <GetQuoteModal
        show={showGetQuoteModal}
        onHide={() => setShowGetQuoteModal(false)}
        body={"Are you sure you want to request for quote ?"}
        onConfirm={() => handleGetQuote()}
      />

      <BoqScreen
        show={showBoqScreen}
        onHide={() => setShowBoqScreen(false)}
        projectId={projectId || currentProject?._id}
        project={currentProject}
        quoteNumber={currentProject?.boqNumber}
      />

      {/* Reject-quote confirm — optional reason, then marks the quote rejected. */}
      <Modal
        show={showRejectModal}
        onHide={() => !rejecting && setShowRejectModal(false)}
        centered
      >
        <Modal.Header closeButton={!rejecting}>
          <Modal.Title style={{ fontSize: 18 }}>Reject this quotation?</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ display: "block" }}>
          <p
            style={{
              display: "block",
              width: "100%",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#4b5563",
              marginBottom: 12,
            }}
          >
            The team will be notified. They can send you a revised quote or close
            the project. You can tell us why (optional):
          </p>
          <textarea
            rows={3}
            placeholder="Reason for rejecting (optional)…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            disabled={rejecting}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#1f2033",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              outline: "none",
              resize: "vertical",
              minHeight: 84,
            }}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => setShowRejectModal(false)}
            disabled={rejecting}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={submitReject} disabled={rejecting}>
            {rejecting ? "Rejecting…" : "Confirm reject"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Container fluid className="p-0">
        <Row className="overflow-x-hidden overflow-y-hidden project-container p-0 m-0 w-100 h-100vh">
          <Stack className="px-0">
            <Tabs
              activeKey={activeTab || selectedTabKey}
              onSelect={handleTabSelect}
              defaultActiveKey={"uploadedImages"}
              id="uncontrolled"
              className="custom-tabs custom-tabs_mobile"
              variant="underline"
            >
              <Tab
                eventKey="favorites"
                title="Your Mood Book"
                className="pb-3 overflow-y-scroll h-100vh"
              >
                {isGuestUser ? (
                  <Container
                    fluid
                    className="d-flex flex-column align-items-center justify-content-center pb-0"
                    style={{ height: "calc(100vh - 100px" }}
                  >
                    <p className="noData text-center">
                      Currently awaiting for unique selection of favorite
                      images!
                    </p>
                  </Container>
                ) : (
                  <Favourites
                    images={favoriteImages}
                    handleImageUnLike={handleImageUnLike}
                    getImageURL={getImageURL}
                    historyImages={historyImages} // Pass historyImages as a prop
                    favoriteImages={favoriteImages} // Pass favoriteImages as a prop
                    handleTabSelect={handleTabSelect} // Pass handleTabSelect as a prop
                  />
                )}
              </Tab>
              <Tab
                eventKey="history"
                title="All Images"
                className="pb-3 overflow-y-scroll h-100vh"
              >
                {isGuestUser ? (
                  <Container
                    fluid
                    className="d-flex flex-column align-items-center justify-content-center pb-0"
                    style={{ height: "calc(100vh - 100px" }}
                  >
                    <p className="noData text-center">
                      Design yet to be discovered !
                    </p>
                  </Container>
                ) : (
                  <History
                    images={historyImages}
                    editedImages={editedImages}
                    onEditedDone={handleEditedDone}
                    handleImageLike={handleImageLike}
                    handleImageUnLike={handleImageUnLike}
                  />
                )}
              </Tab>
              <Tab
                eventKey="uploadedImages"
                title="Uploaded Images"
                className="pb-3 overflow-y-scroll overflow-x-hidden h-100vh"
              >
                {isGuestUser ? (
                  <Container
                    fluid
                    className="d-flex flex-column align-items-center justify-content-center pb-0"
                    style={{ height: "calc(100vh - 100px" }}
                  >
                    <p className="noData text-center">
                      Your creative journey is ready to begin!
                    </p>
                  </Container>
                ) : (
                  <UploadedImages images={uploadedImages} />
                )}
              </Tab>
              <Tab
                eventKey="workspace"
                title="Project Workspace"
                className="pb-3 overflow-x-hidden"
              >
                <div
                  style={{
                    maxHeight: "calc(100vh - 150px)",
                    overflowY: "auto",
                    overflowX: "hidden",
                  }}
                >
                  {/* Quote action bar — inside the workspace: view the BOQ,
                      request a change, or accept the quotation. */}
                  {/* Change requested → the quote is stale; hide accept/request
                      until the team sends a revised quotation (which clears the
                      flag). Show a short "received" note meanwhile. */}
                  {currentProject?.status === "quotation_sent" &&
                    changeReqPending &&
                    currentUser?.permissions === USER_ROLES.USER && (
                      <div
                        className="px-3 py-2 m-2 rounded"
                        style={{
                          background: "#fff7ed",
                          border: "1px solid #fed7aa",
                          fontSize: 14,
                          color: "#9a3412",
                        }}
                      >
                        Your change request has been received. A revised quotation
                        will be sent shortly
                      </div>
                    )}
                  {currentProject?.status === "quotation_sent" &&
                    !changeReqPending &&
                    currentUser?.permissions === USER_ROLES.USER && (
                      <div
                        className="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3 py-2 m-2 rounded"
                        style={{
                          background: "#eef6ff",
                          border: "1px solid #d6e4f5",
                        }}
                      >
                        <span style={{ fontSize: 14, color: "#1f2033" }}>
                          Your quotation is ready — review the BOQ, then accept it
                          or request a change.
                        </span>
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <Button
                            variant="outline-danger"
                            onClick={() => {
                              setRejectReason("");
                              setShowRejectModal(true);
                            }}
                          >
                            Reject
                          </Button>
                          <Button
                            variant="outline-secondary"
                            onClick={handleRequestChange}
                          >
                            Request a change
                          </Button>
                          <Button variant="success" onClick={handleAcceptQuote}>
                            Accept Quote
                          </Button>
                        </div>
                      </div>
                    )}
                  {currentProject?.status === "quotation_accepted" &&
                    currentUser?.permissions === USER_ROLES.USER && (
                      <div
                        className="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3 py-2 m-2 rounded"
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          fontSize: 14,
                          color: "#166534",
                        }}
                      >
                        <span>
                          You have accepted the quotation. The team will finalise
                          and close the project.
                        </span>
                        <Button
                          variant="outline-success"
                          size="sm"
                          onClick={handleViewBoq}
                        >
                          View BOQ
                        </Button>
                      </div>
                    )}
                  {currentProject?.status === "quotation_rejected" &&
                    currentUser?.permissions === USER_ROLES.USER && (
                      <div
                        className="px-3 py-2 m-2 rounded"
                        style={{
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          fontSize: 14,
                          color: "#991b1b",
                        }}
                      >
                        You've declined this quotation. The team has been notified
                        and will send a revised quote or close the project.
                      </div>
                    )}
                  {currentProject?.status === "closed" && (
                    <div
                      className="px-3 py-2 m-2 rounded"
                      style={{
                        background: "#f3f4f6",
                        border: "1px solid #e5e7eb",
                        fontSize: 14,
                        color: "#374151",
                      }}
                    >
                      This project is completed and closed.
                    </div>
                  )}
                  <ProjectInfoCard project={currentProject} />
                  <ProjectTracker
                    projectId={projectId || currentProject?._id}
                    status={currentProject?.status}
                    activeStage={workspaceStage}
                    projectCreatedAt={currentProject?.createdAt}
                    onStepClick={(k) =>
                      setWorkspaceStage((cur) => (cur === k ? "" : k))
                    }
                  />
                  <ProjectWorkspace
                    projectId={projectId || currentProject?._id}
                    project={currentProject}
                    openSection={workspaceSection}
                    openSectionNonce={sectionNonce}
                    status={currentProject?.status}
                    projectCreatedAt={currentProject?.createdAt}
                    clientEmail={
                      currentProject?.clientEmail ||
                      currentProject?.ownerUser?.email
                    }
                    filterStage={workspaceStage}
                    onFilterChange={setWorkspaceStage}
                    onChangeRequest={refreshQuoteFlag}
                  />
                </div>
              </Tab>
            </Tabs>
          </Stack>
        </Row>
        {currentUser?.permissions === USER_ROLES.USER && (
          <Row className="d-block d-lg-none">
            <Navbar fixed="bottom" className="bg-light p-2">
              <div
                className="d-flex align-items-center
            justify-content-between w-100 justify-content-md-evenly"
              >
                <Button
                  variant="outlined"
                  className="outline-button button-width-mobile w-100 mx-1 px-0"
                  style={{ width: "180px" }}
                  onClick={navigateToDashboard}
                >
                  Generate Inspiration
                </Button>
                <Button
                  className="primary-button-filled button-width-mobile w-100 mx-1"
                  variant="primary"
                  onClick={handleGetQuoteModal}
                  disabled={quoteInProgress}
                  title={
                    quoteInProgress
                      ? "A quotation is already in progress for this project."
                      : undefined
                  }
                >
                  Get Quote
                </Button>
              </div>
            </Navbar>
          </Row>
        )}
      </Container>
    </>
  );
};

export default ProjectDetail;
