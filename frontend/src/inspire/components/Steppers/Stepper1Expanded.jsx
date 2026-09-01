import axios from "axios";
import React, { useContext, useEffect, useState, useRef } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Modal,
  Navbar,
  Row,
  Stack,
} from "react-bootstrap";
import { useLocation } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import BEDROOM from "../../assets/images/bedroom.jpg";
import DINING_ROOM from "../../assets/images/diningroom.jpg";
import KITCHEN from "../../assets/images/kitchen.jpg";
import LIVING_ROOM from "../../assets/images/livingroom.jpg";
import ProjectContext from "../../context/ProjectContext";
import { StepperContext } from "../../context/StepperContext";
import UserContext from "../../context/UserContext";
import ServiceContext from "../../context/ServiceContext";
import UserRoleContext from "../../context/UserRoleContext";
import { useTypeStore } from "../../context/TypeStoreContext";
import {
  deleteImageInfo,
  getGeneratedImages,
  getImages,
  saveImageInfo,
} from "../../services/imagesService";
import { uploadImage } from "../../services/uploadService";
import roomTypes from "../../utils/roomTypes.json";
import ConfirmationModal from "../ConfirmationModal";
import UploadRoomImageSection from "../UploadingRoomImageSection";
import QuoteImagePicker from "../QuoteImagePicker";
import { updateProject } from "../../services/projectService";
import "./index.css";
import Close from "../../assets/images/close.svg";

// Image formats accepted for room-photo upload. Widened beyond JPEG/PNG to the
// common web raster formats browsers produce today (WebP/AVIF from phones and
// screenshots, plus BMP). HEIC (iPhone) is handled separately — it can't be
// decoded natively, so it's converted to JPEG before upload (see below).
const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/bmp",
];

// HEIC/HEIF isn't reliably given a MIME type by the browser and can't be read
// by the AI generator, so we detect it (by type OR extension) and convert.
const isHeicFile = (file) =>
  file?.type === "image/heic" ||
  file?.type === "image/heif" ||
  /\.(heic|heif)$/i.test(file?.name || "");

const Stepper1Expanded = ({
  rooms,
  setRooms,
  themeArray,
  handleTabNavigation,
}) => {
  const typeStoreContext = useTypeStore();
  const [showAddRoomType, setShowAddRoomType] = useState(false);
  const [inlineLoader, setInlineLoader] = useState(false);
  const [uploadedRoomName, setUploadedRoomName] = useState("");
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const roomType = params.get("roomType");
  const { currentUser } = useContext(UserContext);
  const { currentProject } = useContext(ProjectContext);
  const { authService, imagesService } = useContext(ServiceContext);
  const {
    handleNext,
    setSelectedImage,
    selectedImage,
    setActiveStep,
    activeStep,
  } = useContext(StepperContext);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [selectedRoom, setSelectedRoom] = useState(null);
  // Request-quote picker (same flow as the Generate step) so an uploaded photo
  // can be sent for a quote straight from the upload page.
  const [showGetQuoteModal, setShowGetQuoteModal] = useState(false);
  const [sendingQuote, setSendingQuote] = useState(false);
  const [quoteUploaded, setQuoteUploaded] = useState([]);
  const [quoteEdited, setQuoteEdited] = useState([]);
  const [quoteGenerated, setQuoteGenerated] = useState([]);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  // Cascade-delete confirm: removing an uploaded photo that has generated
  // designs asks first, then deletes those designs too (they're linked to it
  // via inputImageId and would otherwise be orphaned).
  const [showCascadeModal, setShowCascadeModal] = useState(false);
  const [cascadeImageId, setCascadeImageId] = useState(null);
  const [cascadeCount, setCascadeCount] = useState(0);
  // Edited versions that descend from this upload's generated designs
  // (edited.inputImageId points at a generated image). Deleted together so
  // nothing is left orphaned.
  const [cascadeEditedIds, setCascadeEditedIds] = useState([]);
  const [cascadeEditedCount, setCascadeEditedCount] = useState(0);
  // Same cascade info, but for deleting a whole room (all its uploaded images
  // plus every generated design and edited version derived from them).
  const [roomCascadeGenIds, setRoomCascadeGenIds] = useState([]);
  const [roomCascadeEditedIds, setRoomCascadeEditedIds] = useState([]);
  const [roomCascadeGenCount, setRoomCascadeGenCount] = useState(0);
  const [roomCascadeEditedCount, setRoomCascadeEditedCount] = useState(0);
  const [imagesHistory, setImagesHistory] = useState([]);
  const width = process.env.REACT_APP_WINDOW_WIDTH;
  const [uploadProgress, setUploadProgress] = useState(0);
  const componentRef = useRef(null);

  const getImagesHistory = async () => {
    if (currentProject) {
      const imagesGenerated = await imagesService.getGeneratedImages(
        currentProject._id
      );
      if (imagesGenerated && imagesGenerated["data"]?.length) {
        setImagesHistory(imagesGenerated.data);
      }
    }
  };

  useEffect(() => {
    getImagesHistory();
  }, [currentProject]);

  // useEffect(() => {
  //   if (roomType !== null) {
  //     handleAddRoomClick(roomType);
  //   }
  // }, [roomType]);

  useEffect(() => {
    if (currentProject !== null) {
      fetchData();
    }
  }, [currentProject?._id]);

  const fetchData = async () => {
    if (currentProject && currentProject._id) {
      const images = await getUserImages();
      if (images.length == 0 && rooms.length == 0) {
        addDefaultRooms(roomTypes);
        setLoading(false);
        //handleAddRoomClick(roomType || roomTypes[0].roomType);
      }
    }
  };

  const getUserImages = async () => {
    if (currentProject && currentProject._id) {
    const tempThemeArray = await typeStoreContext.typeStore.getThemeArray();
    const uniqueThemes = new Set();
    const filteredThemes = tempThemeArray.filter((item) => {
      if (
        !uniqueThemes.has(item.theme_name) &&
        item.room_type === "Living Room"
      ) {
        uniqueThemes.add(item.theme_name);
        return true;
      }
      return false;
    });
      let images = await imagesService.getImages(currentProject._id);
      images = images?.data;
      if (images?.length) {
        const rooms = getRoomsFromImagesData(images);
        if (rooms && rooms.length > 0) {
          if (rooms[0].images && rooms[0].images.length > 0) {
            const image = { ...rooms[0].images[0] };

            if (!image.themeName) {
              image.themeName =
                selectedImage?.themeName ? selectedImage.themeName : themeArray?.length ? themeArray[0]?.theme_name : filteredThemes[0]?.theme_name;
            }
            setSelectedImage(image);
          }
          setRooms([...rooms]);
        }
        return images;
      }
    }
    return [];
  };

  const groupBy = (array, key) =>
    array.reduce((result, item) => {
      (result[item[key]] = result[item[key]] || []).push(item);
      return result;
    }, {});

  const getRoomsFromImagesData = (images) => {
    const groupedByRoom = groupBy(images, "roomName");
    let roomsList = [];
    if (groupedByRoom && Object.keys(groupedByRoom).length) {
      Object.keys(groupedByRoom).forEach((key) => {
        const roomData = {
          roomName: key,
          roomType: images.find((image) => image?.roomName === key)?.roomType,
          images: images.filter((image) => image?.roomName === key),
        };
        roomsList.push(roomData);
      });
    }
    return roomsList;
  };

  const handleDropdownSelect = (selectedRoomType, room) => {
    room.roomName = getRoomNameForSelectedRoomType(selectedRoomType);
    room.roomType = selectedRoomType;
    setRooms([...rooms]);
    closeAddRoomModal();
  };

  const getRoomNameForSelectedRoomType = (selectedRoomType) => {
    const roomsOfTypeSelected = rooms.filter(
      (roomItem) => roomItem.roomType === selectedRoomType
    );
    if (roomsOfTypeSelected.length) {
      const roomNames = roomsOfTypeSelected
        .map((item) => item?.roomName)
        .filter((item) => item !== "")
        .sort();
      const roomCount = roomNames[roomNames.length - 1].replace(
        selectedRoomType,
        ""
      );
      const count = roomCount ? parseInt(roomCount) + 1 : 1;
      return `${selectedRoomType}${count}`;
    } else {
      return selectedRoomType;
    }
  };

  const addDefaultRooms = (roomTypeObjects) => {
    const newRooms = roomTypeObjects.map((roomTypeObj) => {
      const name = getRoomNameForSelectedRoomType(roomTypeObj.roomType);
      return {
        roomType: roomTypeObj?.roomType,
        roomName: name,
        images: [],
      };
    });

    setRooms([...rooms, ...newRooms]);
  };

  const handleAddRoomClick = (defaultRoomType) => {
    let name = "";
    if (defaultRoomType) {
      name = getRoomNameForSelectedRoomType(defaultRoomType);
    }
    const room = {
      roomType: defaultRoomType || "",
      roomName: name,
      images: [],
    };
    const newRooms = [room, ...rooms];
    setRooms(newRooms);
    closeAddRoomModal();
    if (componentRef.current) {
      componentRef.current.scrollTop = 0;
    }
  };

  const resetRoomCascade = () => {
    setRoomCascadeGenIds([]);
    setRoomCascadeEditedIds([]);
    setRoomCascadeGenCount(0);
    setRoomCascadeEditedCount(0);
  };

  const handleDeleteRoom = async () => {
    setShowConfirmationModal(false);
    const room = selectedRoom;
    try {
      // Cascade order: edited versions → generated designs → uploaded photos,
      // so nothing is left orphaned. Delete DB records directly here rather than
      // via handleRemoveImage (which would re-open the per-image cascade modal).
      for (const eId of roomCascadeEditedIds) {
        await imagesService.deleteImageInfo(eId);
      }
      for (const gId of roomCascadeGenIds) {
        await imagesService.deleteImageInfo(gId);
      }
      if (roomCascadeGenIds.length) {
        const delSet = new Set(roomCascadeGenIds);
        setImagesHistory((prev) => prev.filter((g) => !delSet.has(g._id)));
      }
      for (const image of room?.images || []) {
        await imagesService.deleteImageInfo(image._id);
      }
      const newRooms = rooms.filter(
        (item) => item?.roomName !== room?.roomName
      );
      // Bug fix: spreading an array into {} produced an object ({0:..,1:..}),
      // which then broke every subsequent rooms.map / rooms.length / rooms.filter.
      setRooms([...newRooms]);
      if (selectedImage?._id) {
        setDefaultSelectedImage(newRooms);
      }
      const extra =
        roomCascadeGenCount > 0
          ? ` (with ${roomCascadeGenCount} generated design${
              roomCascadeGenCount === 1 ? "" : "s"
            }${
              roomCascadeEditedCount > 0
                ? ` and ${roomCascadeEditedCount} edited version${
                    roomCascadeEditedCount === 1 ? "" : "s"
                  }`
                : ""
            })`
          : "";
      toast.success(`Deleted ${room?.roomName}${extra}.`, {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      setSelectedRoom(null);
      if (newRooms.length == 0) {
        showAddRoomModal();
      }
    } catch (e) {
      console.error(e);
      toast.error("Could not delete the room. Please try again.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } finally {
      resetRoomCascade();
    }
  };

  const handleImageUpload = async (event, room) => {
    if (!event?.target?.files?.length) return;
    const original = event.target.files[0];
    const heic = isHeicFile(original);
    if (!heic && !(original && ALLOWED_UPLOAD_TYPES.includes(original.type))) {
      toast.error("Invalid image type !", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }

    setInlineLoader(true);
    setUploadedRoomName(room.roomName);

    // HEIC/HEIF (iPhone) can't be uploaded as-is — convert to JPEG in the
    // browser first so it previews and works through AI generation.
    let fileToUpload = original;
    if (heic) {
      try {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({
          blob: original,
          toType: "image/jpeg",
          quality: 0.92,
        });
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        fileToUpload = new File(
          [jpegBlob],
          (original.name || "photo").replace(/\.(heic|heif)$/i, ".jpg"),
          { type: "image/jpeg" }
        );
      } catch (e) {
        console.error("HEIC conversion failed", e);
        setInlineLoader(false);
        toast.error("Couldn't read that HEIC image. Please try a JPEG or PNG.", {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
        return;
      }
    }

    // Server-hosted upload (replaces the old presigned-S3 PUT flow).
    // The backend writes the file to /var/pazl/images (or local
    // ./uploads/images in dev) and returns { key, url, … }.
    const uploadResult = await uploadImage(fileToUpload, (progress) =>
      setUploadProgress(progress)
    );
    if (uploadResult?.key) {
      setInlineLoader(false);
      const response3 = await imagesService.saveImageInfo({
        url: `${uploadResult.key}`,
        imageType: "input",
        roomType: `${room.roomType}`,
        roomName: room.roomName,
        userId: currentUser?._id,
        projectID: `${currentProject?._id}`,
      });
      setSelectedImage(response3);
      room.images.push(response3);
      setRooms([...rooms]);
    } else {
      setInlineLoader(false);
    }
  };

  // The generated designs that were produced from a given uploaded image.
  const generatedFor = (imageId) =>
    imagesHistory.filter(
      (g) => g.imageType === "generated" && g.inputImageId === imageId
    );

  // Edited versions that descend from a set of generated designs.
  const editedDescendantsOf = async (genIds) => {
    if (!genIds.length || !currentProject?._id) return [];
    try {
      const res = await imagesService.getImagesByType(
        currentProject._id,
        "edited"
      );
      const editedList = res?.data || [];
      const genSet = new Set(genIds);
      return editedList.filter((e) => genSet.has(e.inputImageId));
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const handleRemoveImage = async (imageId) => {
    const gens = generatedFor(imageId);
    if (gens.length > 0) {
      // Has generated designs → confirm the cascade instead of blocking. Also
      // pull in any edited versions of those designs so the count is honest.
      const edited = await editedDescendantsOf(gens.map((g) => g._id));
      setCascadeImageId(imageId);
      setCascadeCount(gens.length);
      setCascadeEditedIds(edited.map((e) => e._id));
      setCascadeEditedCount(edited.length);
      setShowCascadeModal(true);
    } else {
      await deleteInputImage(imageId);
    }
  };

  // Remove one uploaded image from its room + the DB, then re-point the
  // selection to a sensible remaining image.
  const deleteInputImage = async (imageId) => {
    for (const obj of rooms) {
      const images = obj.images;
      for (let i = 0; i < images.length; i++) {
        if (images[i]._id === imageId) {
          await imagesService.deleteImageInfo(images[i]?._id);
          images.splice(i, 1);
          if (images[i - 1]) {
            const previousImage = images[i - 1];
            setSelectedImage(previousImage);
          } else {
            setDefaultSelectedImage(rooms);
          }
          break;
        }
      }
    }
    setRooms([...rooms]);
  };

  const closeCascadeModal = () => {
    setShowCascadeModal(false);
    setCascadeImageId(null);
    setCascadeCount(0);
    setCascadeEditedIds([]);
    setCascadeEditedCount(0);
  };

  // Confirmed cascade: delete the edited versions and generated designs first
  // (so nothing is left orphaned), then the uploaded photo they came from.
  const confirmCascadeDelete = async () => {
    const imageId = cascadeImageId;
    if (!imageId) return closeCascadeModal();
    const gens = generatedFor(imageId);
    const editedIds = cascadeEditedIds;
    try {
      // Edited versions first (deepest descendants), then their generated parents.
      for (const eId of editedIds) {
        await imagesService.deleteImageInfo(eId);
      }
      for (const g of gens) {
        await imagesService.deleteImageInfo(g._id);
      }
      // Drop the deleted designs from local history so counts/guards stay correct.
      setImagesHistory((prev) =>
        prev.filter(
          (g) => !(g.imageType === "generated" && g.inputImageId === imageId)
        )
      );
      await deleteInputImage(imageId);
      const editedNote =
        editedIds.length > 0
          ? ` and ${editedIds.length} edited version${
              editedIds.length === 1 ? "" : "s"
            }`
          : "";
      toast.success(
        `Deleted the image, ${gens.length} generated design${
          gens.length === 1 ? "" : "s"
        }${editedNote}.`,
        { position: toast.POSITION.TOP_RIGHT, theme: "colored" }
      );
    } catch (e) {
      console.error(e);
      toast.error("Could not delete everything. Please try again.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } finally {
      closeCascadeModal();
    }
  };

  const setDefaultSelectedImage = (rooms) => {
    if (rooms && rooms.length > 0) {
      for (const obj of rooms) {
        const images = obj.images;
        if (images.length > 0) {
          setSelectedImage(images[0]);
        } else {
          const newObj = { themeName: selectedImage.themeName };
          setSelectedImage(newObj);
        }
      }
    }
    setRooms([...rooms]);
  };

  const navigateStepperTo = (value) => {
    setActiveStep(value);
  };

  const showAddRoomModal = () => {
    setShowAddRoomType(true);
  };

  const closeAddRoomModal = () => {
    setShowAddRoomType(false);
  };

  const getImageAsset = (roomType) => {
    const assetMap = {
      Bedroom: BEDROOM,
      "Living Room": LIVING_ROOM,
      Kitchen: KITCHEN,
      "Dining room": DINING_ROOM,
    };
    return assetMap[roomType];
  };

  // Generated designs produced from any uploaded image in a room.
  const generatedForRoom = (room) => {
    const imageIds = new Set((room?.images || []).map((i) => i._id));
    return imagesHistory.filter(
      (g) => g.imageType === "generated" && imageIds.has(g.inputImageId)
    );
  };

  const onDeleteRoom = async (room) => {
    setSelectedRoom(room);
    // Gather everything that would cascade so the confirm text is accurate and
    // the delete has the exact ids to remove.
    const gens = generatedForRoom(room);
    const edited = gens.length
      ? await editedDescendantsOf(gens.map((g) => g._id))
      : [];
    setRoomCascadeGenIds(gens.map((g) => g._id));
    setRoomCascadeEditedIds(edited.map((e) => e._id));
    setRoomCascadeGenCount(gens.length);
    setRoomCascadeEditedCount(edited.length);
    setShowConfirmationModal(true);
  };

  const CloseConfirmationModal = () => {
    setShowConfirmationModal(false);
    resetRoomCascade();
  };

  // Load the project's uploaded / edited / generated images for the quote picker.
  const loadQuoteImages = async () => {
    if (!currentProject?._id) return;
    const [up, ed, gen] = await Promise.all([
      imagesService.getImagesByType(currentProject._id, "input"),
      imagesService.getImagesByType(currentProject._id, "edited"),
      imagesService.getImagesByType(currentProject._id, "generated"),
    ]);
    setQuoteUploaded(up?.data || []);
    setQuoteEdited(ed?.data || []);
    setQuoteGenerated(gen?.data || []);
  };

  // A client may (re)request a quote ONLY when the project is not already in an
  // active quote/build cycle — otherwise requesting again resets an in-progress
  // project back to "quotation_requested" and breaks the flow (and rewinds the
  // tracker). Allowed only from a fresh (open), finished (closed) or
  // previously-rejected project.
  const quoteInProgress = [
    "quotation_requested",
    "quotation_pending_approval",
    "quotation_sent",
    "quotation_accepted",
  ].includes(currentProject?.status);

  const handleGetQuoteModal = () => {
    if (quoteInProgress) {
      toast.info("A quotation is already in progress for this project.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
      return;
    }
    loadQuoteImages();
    setShowGetQuoteModal(true);
  };

  // Mark the chosen image favourite + flip the project into "quotation_requested"
  // (same flow as the Generate step). Reports the real outcome — a refused write
  // returns null, so we never claim success for a request that wasn't saved.
  const handleSendQuote = async (selected) => {
    if (!selected?._id) return;
    setSendingQuote(true);
    try {
      await imagesService.updateImageInfo(selected._id, { isFavorite: true });
      const quoteImageUrl = selected.url
        ? `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${selected.url}`
        : undefined;
      const updateResponse = await updateProject(currentProject?._id, {
        status: "quotation_requested",
        quoteImageId: selected._id,
        ...(quoteImageUrl ? { quoteImageUrl } : {}),
      });
      if (!updateResponse) {
        toast.error(
          "Could not send for quote. Please try again — if it keeps failing, the request wasn't saved.",
          { position: toast.POSITION.TOP_RIGHT, theme: "colored" }
        );
        return;
      }
      if (updateResponse.adminNotified) {
        toast.success("Sent for quote — the admin has been notified by email.", {
          position: toast.POSITION.TOP_RIGHT,
          theme: "colored",
        });
      } else {
        toast.warning(
          "Sent for quote. We couldn't email the admin just now, but your request is saved and visible to them.",
          { position: toast.POSITION.TOP_RIGHT, theme: "colored", autoClose: 8000 }
        );
      }
      setShowGetQuoteModal(false);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't send for quote.", {
        position: toast.POSITION.TOP_RIGHT,
        theme: "colored",
      });
    } finally {
      setSendingQuote(false);
    }
  };

  return (
    <>
      <ToastContainer />
      <QuoteImagePicker
        show={showGetQuoteModal}
        onHide={() => setShowGetQuoteModal(false)}
        uploaded={quoteUploaded}
        edited={quoteEdited}
        generated={quoteGenerated}
        onSend={handleSendQuote}
        sending={sendingQuote}
      />
      <ConfirmationModal
        show={showConfirmationModal}
        onHide={CloseConfirmationModal}
        body={
          `Are you sure you want to delete ${selectedRoom?.roomName}?` +
          (roomCascadeGenCount > 0
            ? ` This will also permanently delete ${roomCascadeGenCount} generated design${
                roomCascadeGenCount === 1 ? "" : "s"
              }` +
              (roomCascadeEditedCount > 0
                ? ` and ${roomCascadeEditedCount} edited version${
                    roomCascadeEditedCount === 1 ? "" : "s"
                  }`
                : "") +
              "."
            : "")
        }
        onConfirm={handleDeleteRoom}
      />
      <ConfirmationModal
        show={showCascadeModal}
        onHide={closeCascadeModal}
        body={
          `This image has ${cascadeCount} generated design${
            cascadeCount === 1 ? "" : "s"
          }` +
          (cascadeEditedCount > 0
            ? ` and ${cascadeEditedCount} edited version${
                cascadeEditedCount === 1 ? "" : "s"
              }`
            : "") +
          `. Deleting it will also permanently delete ${
            cascadeCount + cascadeEditedCount === 1 ? "it" : "them"
          }. Continue?`
        }
        onConfirm={confirmCascadeDelete}
      />
      <div className="expanded_container_section px-2">
        <div className="d-block d-lg-none pt-3">
          {(!selectedImage || !selectedImage._id) && (
            <Alert variant="danger" className="p-1 px-3 ">
              <i>Upload and select a room image to continue...</i>
            </Alert>
          )}
        </div>
        <Row
          className="d-none d-lg-flex d-flex align-items-center title-header-color border-right"
          style={{
            minHeight: "101px",
            marginRight: "-6px",
          }}
        >
          <Navbar className="p-0 d-flex align-items-center justify-content-center">
            <div className="px-3 d-flex flex-row align-items-center justify-content-between w-100">
              <div
                className="d-flex flex-row align-items-center"
                onClick={() => navigateStepperTo(1)}
              >
                <h3 className="stepper-header-number pe-2 m-0">01 </h3>
                <Navbar.Brand className="text-wrap stepper-header-text">
                  UPLOAD ROOM IMAGES
                  {(!selectedImage || !selectedImage._id) && (
                    <Alert variant="danger" className="p-1 px-3 mb-0 border-0">
                      <i>Upload and select a room image to continue...</i>
                    </Alert>
                  )}
                </Navbar.Brand>
              </div>
              <span className="d-flex align-items-center">
                <Button
                  className="outline-button me-3"
                  variant="outline"
                  onClick={showAddRoomModal}
                >
                  {" "}
                  + Add Room
                </Button>
                {selectedImage?._id && (
                  <Button
                    className="outline-button me-3"
                    variant="outline"
                    onClick={handleGetQuoteModal}
                    disabled={quoteInProgress}
                    title={
                      quoteInProgress
                        ? "A quotation is already in progress for this project."
                        : undefined
                    }
                  >
                    Request quote
                  </Button>
                )}
                <Button
                  disabled={!selectedImage || !selectedImage.roomType}
                  className="primary-button-filled"
                  style={{ width: "129px" }}
                  onClick={handleNext}
                  variant="primary"
                >
                  Next
                </Button>
              </span>
            </div>
          </Navbar>
        </Row>
        <Row className="justify-content-md-start">
          <Col
            ref={componentRef}
            className="overflow-y-auto bg-white me-1 ps-3"
            style={{ height: `calc(100vh - 140px)`, paddingBottom: "120px" }}
          >
            {(Array.isArray(rooms) ? rooms : []).map((room, index) => (
              <Stack gap={5} key={room.roomName}>
                <UploadRoomImageSection
                  roomName={room.roomName}
                  imagesData={room.images}
                  uploadedRoomName={uploadedRoomName}
                  inlineLoader={inlineLoader}
                  handleImageUpload={(event) => handleImageUpload(event, room)}
                  handleRemoveImage={(imageId) =>
                    handleRemoveImage(imageId, room)
                  }
                  index={parseInt(index, 10)}
                  onDeleteRoom={() => {
                    onDeleteRoom(room);
                  }}
                  selectedImage={selectedImage}
                  setShowConfirmationModal={setShowConfirmationModal}
                  progress={uploadProgress}
                />
              </Stack>
            ))}
          </Col>
        </Row>
        <Row className="d-block d-lg-none">
          <Navbar fixed="bottom" className="bg-light p-2">
            <div
              className="d-flex align-items-center 
            justify-content-between w-100 justify-content-md-evenly"
            >
              <Button
                variant="outlined"
                className="outline-button button-width-mobile w-100 mx-1"
                onClick={showAddRoomModal}
              >
                + Add Room
              </Button>
              {selectedImage?._id && (
                <Button
                  variant="outlined"
                  className="outline-button button-width-mobile w-100 mx-1"
                  onClick={handleGetQuoteModal}
                  disabled={quoteInProgress}
                  title={
                    quoteInProgress
                      ? "A quotation is already in progress for this project."
                      : undefined
                  }
                >
                  Request quote
                </Button>
              )}
              <Button
                disabled={!selectedImage || !selectedImage.roomType}
                className="primary-button-filled button-width-mobile w-100 mx-1"
                onClick={() => {
                  handleNext();
                  handleTabNavigation("2");
                }}
                variant="primary"
              >
                Next
              </Button>
            </div>
          </Navbar>
        </Row>
        <Modal
          size={`${window.innerWidth > width ? "lg" : "xs"}`}
          aria-labelledby="contained-modal-title-vcenter"
          centered
          backdrop
          show={showAddRoomType}
          onHide={closeAddRoomModal}
        >
          <Modal.Header variant="primary" className="bg-primary text-white">
            <Modal.Title id="contained-modal-title-vcenter" className="fs-16">
              Select Room Type
            </Modal.Title>
            <img
              src={Close}
              alt="close"
              role="button"
              onClick={closeAddRoomModal}
            />
          </Modal.Header>
          <Modal.Body className="d-flex flex-column flex-lg-row flex-wrap flex-lg-nowrap align-items-center justify-content-center">
            {(Array.isArray(roomTypes) ? roomTypes : []).map((room, index) => {
              return (
                <Card
                  key={index}
                  style={{
                    margin: "12px",
                    cursor: "pointer",
                    width: "14rem",
                    height: "200px", // Set a fixed height for the cards
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                  className="d-flex align-items-center justify-content-center text-center"
                  onClick={() => handleAddRoomClick(room.roomType)}
                >
                  <Card.Img
                    variant="top"
                    src={getImageAsset(room.roomType)}
                    style={{
                      objectFit: "cover",
                      width: "100%",
                      height: "100%",
                    }}
                  />
                  <Card.Body className="p-3 bg-light w-100">
                    <Card.Title className="fs-16 mb-0">
                      {room.roomType}
                    </Card.Title>
                  </Card.Body>
                </Card>
              );
            })}
          </Modal.Body>
        </Modal>
      </div>
    </>
  );
};

export default Stepper1Expanded;
