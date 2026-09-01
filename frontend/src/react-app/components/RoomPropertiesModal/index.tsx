import React, { useEffect, useState } from "react";
import Draggable from "react-draggable";
import FloorFinishingsModal from "./FloorFinishingsModal";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import { Finishing } from "@pazl/entities/Finishing";
import "./index.css";
import BlueprintInterface from "@pazl/blueprint-interface";
import { TexturesService } from "@pazl/services/texturesService";
import { Texture } from "@pazl/entities/Texture";
import WallFinishingsModal from "../WallPropertiesModal/WallFinishingsModal";
import Wall from "@pazl/main/model/wall";

interface RoomPropertiesModalProps {
  handleRoomNameChange: (e: any) => void;
  onSelectedFloorTexture: (texture: Texture) => void;
  onSelectedWallTexture: (texture: Texture) => void;
  onOpenRoomPanel: () => void;
  selectedRoom: any;
  onHideRoomPropertiesPanel: () => void;
  handleSelectAllRoomItems: () => void;
}

const RoomPropertiesModal = ({
  handleRoomNameChange,
  onSelectedFloorTexture,
  onSelectedWallTexture,
  onOpenRoomPanel,
  selectedRoom,
  onHideRoomPropertiesPanel,
  handleSelectAllRoomItems,
}: RoomPropertiesModalProps) => {
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;
  const [showFloorTextureMenu, setShowFloorTextureMenu] = useState(false);
  const [showWallTextureMenu, setShowWallTextureMenu] = useState(false);
  // Ceiling finish — SAME format as Floor color (dropdown + swatch + finishings
  // picker). Reuses the floor finishings list/categories.
  const [showCeilingTextureMenu, setShowCeilingTextureMenu] = useState(false);
  const [selectedCeilingFinishing, setSelectedCeilingFinishing] =
    useState<Finishing | null>(null);

  const handleSelectCeilingFinishing = (finishing: Finishing) => {
    setSelectedCeilingFinishing(finishing);
    try {
      const url = finishing?.texture?.fileUrl;
      (BlueprintInterface as any)?.blueprint3d?.roomplanner?.setCeilingTexture?.(
        url
      );
      (BlueprintInterface as any)?.ProjectManagerService?.updateFloorPlan?.(
        "Ceiling finish changed"
      );
    } catch (e) {
      console.error("RoomPropertiesModal ~ handleSelectCeilingFinishing", e);
    }
  };
  const [allFloorFinishings, setAllFloorFinishings] = useState<
    Finishing[] | null
  >(null);
  const [allWallFinishings, setAllWallFinishings] = useState<
    Finishing[] | null
  >(null);
  const [filteredFloorFinishings, setFilteredFloorFinishings] = useState<
    Finishing[] | null
  >(null);
  const [filteredWallFinishings, setFilteredWallFinishings] = useState<
    Finishing[] | null
  >(null);
  const [floorFinishingCategories, setFloorFinishingCategories] = useState<
    any[]
  >([]);
  const [wallFinishingCategories, setWallFinishingCategories] = useState<any[]>(
    []
  );
  const [selectedFloorFinishing, setSelectedFloorFinishing] =
    useState<Finishing | null>(null);
  const [selectedWallFinishing, setSelectedWallFinishing] =
    useState<Finishing | null>(null);

  useEffect(() => {
    getAllFinishings();
  }, []);

  useEffect(() => {
    if (
      selectedFloorFinishing?.texture?.fileUrl &&
      selectedFloorFinishing.texture.fileUrl !==
        BlueprintInterface?.blueprint3d?.roomplanner?.floors3d?.find(
          (floor3d: any) => floor3d.room.uuid === selectedRoom?.uuid
        )?.__floorMaterial3D?.textureMapPack?.colormap
    ) {
      onSelectedFloorTexture(selectedFloorFinishing.texture);
    }
  }, [
    selectedFloorFinishing,
    BlueprintInterface,
    BlueprintInterface.blueprint3d,
  ]);

  useEffect(() => {
    if (
      selectedWallFinishing?.texture?.fileUrl &&
      selectedWallFinishing.texture.fileUrl !==
        selectedRoom?.__walls[0]?.frontTexture?.colormap
    ) {
      onSelectedWallTexture(selectedWallFinishing.texture);
    }
  }, [
    selectedWallFinishing,
    BlueprintInterface,
    BlueprintInterface.blueprint3d,
  ]);

  const getAllFinishings = async () => {
    let categoriesList =
      await TexturesService.getFinishingCategoriesFromLocalStorage();
    let finishingsList = await TexturesService.getFinishingsFromLocalStorage();
    if (categoriesList?.length && finishingsList?.length) {
      const laminateFinishingId = categoriesList.find((category: any) =>
        category.name.toLowerCase().includes("laminates")
      )?._id;
      categoriesList = categoriesList.filter(
        (category: any) => category.parentCategoryId === laminateFinishingId
      );
      setFloorFinishingCategories(categoriesList);
      setWallFinishingCategories(categoriesList);
      const floorFinishingsList = finishingsList.filter(
        (finishing: Finishing) => finishing.type === "floor"
      );
      const wallFinishingsList = finishingsList.filter(
        (finishing: Finishing) => finishing.type === "wall"
      );
      setAllFloorFinishings(floorFinishingsList);
      setAllWallFinishings(wallFinishingsList);
      const floorTexture =
        BlueprintInterface?.blueprint3d?.roomplanner?.floors3d?.find(
          (floor3d: any) => floor3d.room.uuid === selectedRoom?.uuid
        )?.__floorMaterial3D?.textureMapPack?.colormap;
      const prevSelectedFloorFinishing = floorFinishingsList.find(
        (finishing: Finishing) => finishing.texture.fileUrl === floorTexture
      );
      if (prevSelectedFloorFinishing) {
        const filteredFloorFinishings = floorFinishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === prevSelectedFloorFinishing.categoryId
        );
        setFilteredFloorFinishings(filteredFloorFinishings ?? []);
        setSelectedFloorFinishing(prevSelectedFloorFinishing);
      } else {
        const filteredFloorFinishings = floorFinishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === categoriesList[0]._id
        );
        setFilteredFloorFinishings(filteredFloorFinishings ?? []);
      }
      const wallTexture = selectedRoom?.__walls?.length
        ? selectedRoom.__walls[0].frontTexture?.colormap
        : "";
      const prevSelectedWallFinishing = wallFinishingsList.find(
        (finishing: Finishing) => finishing.texture.fileUrl === wallTexture
      );
      if (prevSelectedWallFinishing) {
        const filteredWallFinishings = wallFinishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === prevSelectedWallFinishing.categoryId
        );
        setFilteredWallFinishings(filteredWallFinishings ?? []);
        setSelectedWallFinishing(prevSelectedWallFinishing);
      } else {
        const filteredWallFinishings = wallFinishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === categoriesList[0]._id
        );
        setFilteredWallFinishings(filteredWallFinishings ?? []);
      }
      // Ceiling finish — initialise the dropdown from the SAVED value (mirrors
      // the floor init above), so it shows the real selection, not "Default".
      const ceilFloor3d =
        BlueprintInterface?.blueprint3d?.roomplanner?.floors3d?.find(
          (f: any) => f.room.uuid === selectedRoom?.uuid
        );
      const ceilingTextureUrl =
        ceilFloor3d?.room?.floorplan?.getCeilingTexture?.(selectedRoom?.uuid)
          ?.textureUrl || ceilFloor3d?.room?.__ceilingTextureUrl;
      const prevSelectedCeilingFinishing = floorFinishingsList.find(
        (finishing: Finishing) => finishing.texture.fileUrl === ceilingTextureUrl
      );
      if (prevSelectedCeilingFinishing) {
        setSelectedCeilingFinishing(prevSelectedCeilingFinishing);
      }
    }
  };

  const handleFloorTextureCategorySelection = async (e: any) => {
    const id = e.target.value;
    const list = allFloorFinishings?.filter(
      (finishing) => finishing.categoryId === id
    );
    setFilteredFloorFinishings(list ?? []);
  };

  const handleWallTextureCategorySelection = async (e: any) => {
    const id = e.target.value;
    const list = allWallFinishings?.filter(
      (finishing) => finishing.categoryId === id
    );
    setFilteredWallFinishings(list ?? []);
  };

  return (
    <Draggable handle="strong">
      <div className="box absolute top-36 right-3 z-10 max-w-60 max-h-44 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)]">
        <div className="room-modal-title-container">
          <div className="room-modal-title">Room Properties</div>
          <img
            className="finishing-modal-close-icon"
            src={require("../../images/close.svg")}
            onClick={onHideRoomPropertiesPanel}
          />
        </div>
        <div className="py-2 px-3 grid justify-items-stretch bg-[#fff]">
          <div className="mb-2">
            <p className="font-bold text-sm text-[#414063] dark:text-[#FFFFFF] py-0.5">
              Room name
            </p>
            <div className="flex items-center">
              <input
                type="text"
                id="roomNameInput"
                className="w-full h-6 border rounded-sm border-[#dddddd] p-1 text-[#333333] dark:text-[#FFFFFF]"
                defaultValue={selectedRoom?._name ?? ""}
                onChange={handleRoomNameChange}
              />
            </div>
          </div>
          <div className="py-1 grid justify-items-stretch">
            <div className="mb-2">
              <div className="floor-title">Wall color</div>
              <div className="floor-selected-container">
                <select
                  style={{ width: "8em" }}
                  className="h-8 pb-1 pl-1 mr-2 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    e.preventDefault();
                    setShowWallTextureMenu(true);
                    setShowFloorTextureMenu(false);
                  }}
                >
                  <option className="floor-option-container">
                    {selectedWallFinishing
                      ? convertToTitleCase(selectedWallFinishing?.name)
                      : "Default texture"}
                  </option>
                </select>
                <div
                  onClick={(e) => {
                    setShowWallTextureMenu(true);
                    setShowFloorTextureMenu(false);
                  }}
                >
                  <img
                    src={
                      selectedWallFinishing
                        ? selectedWallFinishing?.texture?.fileUrl
                        : "/assets/rooms/textures/library/solids/21051.jpg"
                    }
                    height={40}
                    width={40}
                  />
                </div>
              </div>
            </div>
            <div>
              <div className="floor-title">Floor color</div>
              <div className="floor-selected-container">
                <select
                  style={{ width: "8em" }}
                  className="h-8 pb-1 pl-1 mr-2 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    e.preventDefault();
                    setShowFloorTextureMenu(true);
                    setShowWallTextureMenu(false);
                  }}
                >
                  <option className="floor-option-container">
                    {selectedFloorFinishing
                      ? convertToTitleCase(selectedFloorFinishing?.name)
                      : "Default texture"}
                  </option>
                </select>
                <div
                  onClick={(e) => {
                    setShowFloorTextureMenu(true);
                    setShowWallTextureMenu(false);
                  }}
                >
                  <img
                    src={
                      selectedFloorFinishing
                        ? selectedFloorFinishing?.texture?.fileUrl
                        : "/assets/models/textures/10159.jpg"
                    }
                    height={40}
                    width={40}
                  />
                </div>
              </div>
            </div>
            <div>
              <div className="floor-title">Ceiling color</div>
              <div className="floor-selected-container">
                <select
                  style={{ width: "8em" }}
                  className="h-8 pb-1 pl-1 mr-2 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    e.preventDefault();
                    setShowCeilingTextureMenu(true);
                    setShowFloorTextureMenu(false);
                    setShowWallTextureMenu(false);
                  }}
                >
                  <option className="floor-option-container">
                    {selectedCeilingFinishing
                      ? convertToTitleCase(selectedCeilingFinishing?.name)
                      : "Default texture"}
                  </option>
                </select>
                <div
                  onClick={() => {
                    setShowCeilingTextureMenu(true);
                    setShowFloorTextureMenu(false);
                    setShowWallTextureMenu(false);
                  }}
                >
                  <img
                    src={
                      selectedCeilingFinishing
                        ? selectedCeilingFinishing?.texture?.fileUrl
                        : "/assets/models/textures/10159.jpg"
                    }
                    height={40}
                    width={40}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        {showFloorTextureMenu && allFloorFinishings?.length ? (
          <FloorFinishingsModal
            isDarkMode={isDarkMode}
            selectedFinishing={selectedFloorFinishing}
            finishingCategories={floorFinishingCategories}
            filteredFinishings={filteredFloorFinishings}
            setSelectedFinishing={setSelectedFloorFinishing}
            setShowTextureMenu={setShowFloorTextureMenu}
            handleTextureCategorySelection={handleFloorTextureCategorySelection}
          />
        ) : null}
        {showCeilingTextureMenu && allFloorFinishings?.length ? (
          <FloorFinishingsModal
            isDarkMode={isDarkMode}
            selectedFinishing={selectedCeilingFinishing}
            finishingCategories={floorFinishingCategories}
            filteredFinishings={filteredFloorFinishings}
            setSelectedFinishing={handleSelectCeilingFinishing}
            setShowTextureMenu={setShowCeilingTextureMenu}
            handleTextureCategorySelection={handleFloorTextureCategorySelection}
          />
        ) : null}
        {showWallTextureMenu && allWallFinishings?.length ? (
          <WallFinishingsModal
            isDarkMode={isDarkMode}
            selectedFinishing={selectedWallFinishing}
            finishingCategories={wallFinishingCategories}
            filteredFinishings={filteredWallFinishings}
            setSelectedFinishing={setSelectedWallFinishing}
            setShowTextureMenu={setShowWallTextureMenu}
            handleTextureCategorySelection={handleWallTextureCategorySelection}
          />
        ) : null}
      </div>
    </Draggable>
  );
};

export default RoomPropertiesModal;
