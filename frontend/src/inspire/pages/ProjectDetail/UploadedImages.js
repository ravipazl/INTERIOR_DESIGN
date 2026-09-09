import React, { useContext, useEffect, useState } from "react";
import { Button, Col, Container, Row } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import NoData from "../../assets/images/no_data.svg";
import TitleHeader from "../../components/TitleHeader";
import UserRoleContext from "../../context/UserRoleContext";
import { LightBox } from "react-lightbox-pack";
import "react-lightbox-pack/dist/index.css";
import { formatDate } from "../../utils/genericFunctions";
import ObjectSelector from "../../components/ObjectSelector";
import ServiceContext from "../../context/ServiceContext";
import { uploadImage } from "../../services/uploadService";
import { toast } from "react-toastify";

function UploadedImages({ images, editedImages = [] }) {
  //console.log('images', images);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [isDataLoading, setDataLoading] = useState(true);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [toggle, setToggle] = React.useState(false);
  const [sIndex, setSIndex] = React.useState(0);
  const [lightBoxData, setLightBoxData] = React.useState(null);
  // The uploaded image currently open in the object editor (null = closed).
  const [selectorImage, setSelectorImage] = useState(null);
  const [savingEdited, setSavingEdited] = useState(false);
  // Edits saved during THIS visit. The parent's `editedImages` only refreshes on
  // a project reload, so a freshly saved edit would otherwise not appear until
  // the page was reloaded — the client would see the success toast and nothing
  // else, which is the exact problem this feature exists to fix.
  const [newEdits, setNewEdits] = useState([]);
  const { imagesService } = useContext(ServiceContext);
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

  // Clicking an edit VIEWS it, exactly as clicking the original does. The
  // editor is only ever reached from the "Select object" button, so opening a
  // picture never silently puts the client into an editing tool.
  const handleLightBoxSingle = (edit) => {
    setLightBoxData([
      {
        id: edit?._id,
        image: `${getImageURL()}/${edit?.url}`,
        title: edit?.title,
        roomName: edit?.roomName,
      },
    ]);
    lightBoxHandler(true, 0);
  };

  /**
   * Edits grouped by the photo they came from.
   *
   * `inputImageId` is written by the save below (and by the designer stepper),
   * so an edit always knows its source. Records without one are older or came
   * from a generated image — they belong to the All Images tab, not here, so
   * they are skipped rather than shown under an arbitrary photo.
   *
   * Newest first: the most recent edit is the one the client just made.
   */
  const editsBySource = React.useMemo(() => {
    const all = [...(editedImages || []), ...newEdits];
    const map = {};
    all.forEach((edit) => {
      const src = edit?.inputImageId;
      if (!src) return;
      if (!map[src]) map[src] = [];
      map[src].push(edit);
    });
    Object.keys(map).forEach((k) => {
      map[k].sort(
        (a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)
      );
    });
    return map;
  }, [editedImages, newEdits]);

  /**
   * Save the result of an object edit.
   *
   * NON-DESTRUCTIVE by design, and deliberately the same shape as
   * Stepper3Expanded.handleEditedDone: the edit is uploaded and saved as a NEW
   * image of type "edited", linked back to the source through `inputImageId`.
   * The client's original upload is never touched, so an edit can't destroy
   * the photo the quotation was based on.
   */
  const handleEditedDone = async (blob) => {
    const source = selectorImage;
    if (!source || !blob) return;
    setSavingEdited(true);
    try {
      const file = new File([blob], `edited-${Date.now()}.png`, {
        type: "image/png",
      });
      const uploaded = await uploadImage(file);
      if (!uploaded?.key) throw new Error("upload failed");
      const saved = await imagesService.saveImageInfo({
        url: uploaded.key,
        imageType: "edited",
        inputImageId: source._id,
        projectID: source.projectID,
        userId: source.userId,
        roomType: source.roomType,
        roomName: source.roomName,
        themeName: source.themeName,
      });
      // Show it straight away. Fall back to a locally-built record if the
      // service answers without one, so the trail never silently stays empty
      // after a save that actually succeeded.
      setNewEdits((prev) => [
        ...prev,
        {
          ...(saved && saved._id ? saved : {}),
          _id: saved?._id || `local-${Date.now()}`,
          url: saved?.url || uploaded.key,
          inputImageId: source._id,
          roomName: source.roomName,
          createdAt: saved?.createdAt || new Date().toISOString(),
        },
      ]);
      toast.success("Sent to your designer.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } catch (e) {
      console.error("saving edited uploaded image failed", e);
      toast.error("Couldn't save the edited image.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } finally {
      setSavingEdited(false);
    }
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
                  {/* The thumbnail keeps its original job — click opens the
                      lightbox. Editing is a separate control layered on top,
                      because a client opening a photo expects to LOOK at it;
                      swapping that for an editor would take the viewer away. */}
                  <div
                    style={{
                      position: "relative",
                      width: "187px",
                      marginRight: "10px",
                    }}
                  >
                    <img
                      src={`${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${uploadedImage?.url}`}
                      alt="sample"
                      width={187}
                      height={127}
                      style={{
                        borderRadius: "8px",
                        cursor: "pointer",
                        objectFit: "cover",
                        width: "187px",
                        height: "127px",
                        display: "block",
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
                    {/* Always visible rather than hover-only: this page is used
                        on tablets, where there is no hover state to reveal it. */}
                    <button
                      type="button"
                      title="Select an object in this image"
                      disabled={savingEdited}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectorImage(uploadedImage);
                      }}
                      style={{
                        position: "absolute",
                        right: 8,
                        bottom: 8,
                        border: "none",
                        borderRadius: "6px",
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#fff",
                        background: "rgba(28, 27, 31, 0.72)",
                        cursor: savingEdited ? "not-allowed" : "pointer",
                        opacity: savingEdited ? 0.6 : 1,
                        backdropFilter: "blur(2px)",
                      }}
                    >
                      Select object
                    </button>
                  </div>
                  <div className="mr-2 ">
                    <p className="uploaded_time">
                      {formatDate(uploadedImage?.createdAt)}
                    </p>
                  </div>

                  {/* The edit trail. Rendered only when this photo actually has
                      edits — no empty slot, no "0 edits" label — so a project
                      with none looks exactly as it does today.

                      The hairline down the left ties each edit to the photo
                      above it. That connector does the work a caption would
                      otherwise do ("edited from this photo") for one pixel. */}
                  {(editsBySource[uploadedImage?._id] || []).length > 0 && (
                    <div
                      style={{
                        position: "relative",
                        marginTop: "8px",
                        paddingLeft: "13px",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: "4px",
                          top: "-4px",
                          bottom: "18px",
                          width: "1px",
                          background: "#dfe3ec",
                        }}
                      />
                      {editsBySource[uploadedImage?._id].map((edit) => (
                        <div
                          key={edit?._id}
                          style={{ position: "relative", marginBottom: "10px" }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              left: "-9px",
                              top: "26px",
                              width: "9px",
                              height: "1px",
                              background: "#dfe3ec",
                            }}
                          />
                          {/* 174×108 against the original's 187×127, so the eye
                              still lands on the client's photo first: an edit is
                              a note attached to it, not a rival to it. */}
                          <img
                            src={`${getImageURL()}/${edit?.url}`}
                            alt="edited"
                            style={{
                              width: "174px",
                              height: "108px",
                              objectFit: "cover",
                              borderRadius: "7px",
                              display: "block",
                              cursor: "pointer",
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleLightBoxSingle(edit);
                            }}
                          />
                          {/* The client's real question isn't "where is my
                              file" — it's "did anyone get this". */}
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              marginTop: "5px",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#0f7b52",
                            }}
                          >
                            <span
                              style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                background: "#0f7b52",
                                display: "inline-block",
                              }}
                            />
                            Sent to your designer
                          </span>
                          <p
                            style={{
                              fontSize: "10.5px",
                              color: "#7a8191",
                              margin: "1px 0 0",
                            }}
                          >
                            Edited {formatDate(edit?.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
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
      {/* ObjectSelector reads `image.url` and builds its own source URL, so an
          uploaded-image record can be handed to it as-is. It calls onHide()
          itself after onDone, so closing is handled in one place.

          Click-to-select works with the Python image-service switched OFF —
          that runs in the browser via public/sam.worker.js. Remove/fill,
          background removal and text-select do need it on 127.0.0.1:8199, and
          the component already reports that itself when a call fails. */}
      <ObjectSelector
        show={!!selectorImage}
        onHide={() => setSelectorImage(null)}
        onDone={handleEditedDone}
        image={selectorImage}
      />
    </Container>
  );
}

export default UploadedImages;
