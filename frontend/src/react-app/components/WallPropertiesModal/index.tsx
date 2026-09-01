import React, { useEffect, useState } from "react";
import Draggable from "react-draggable";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import { TexturesService } from "@pazl/services/texturesService";
import { Texture } from "@pazl/entities/Texture";
import BlueprintInterface from "@pazl/blueprint-interface";
import { Finishing } from "@pazl/entities/Finishing";
import WallFinishingsModal from "./WallFinishingsModal";
import "./index.css";
import { defaultWallTexture } from "@pazl/main/core/constants";

interface WallPropertiesModalProps {
  onOpenRoomPanel: () => void;
  onSelectedWallFrontTexture: (texture: Texture) => void;
  onSelectedWallBackTexture: (texture: Texture) => void;
  onHideWallPropertiesPanel: () => void;
}

function WallPropertiesModal({
  onOpenRoomPanel,
  onSelectedWallFrontTexture,
  onSelectedWallBackTexture,
  onHideWallPropertiesPanel,
}: WallPropertiesModalProps) {
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;
  const [allFinishings, setAllFinishings] = useState<Finishing[] | null>(null);
  const [filteredFrontFinishings, setFilteredFrontFinishings] = useState<
    Finishing[] | null
  >(null);
  const [filteredBackFinishings, setFilteredBackFinishings] = useState<
    Finishing[] | null
  >(null);
  const [finishingCategories, setFinishingCategories] = useState<any[]>([]);
  const [showFrontTextureMenu, setShowFrontTextureMenu] = useState(false);
  const [showBackTextureMenu, setShowBackTextureMenu] = useState(false);
  const [selectedFrontFinishing, setSelectedFrontFinishing] =
    useState<Finishing | null>(null);
  const [selectedBackFinishing, setSelectedBackFinishing] =
    useState<Finishing | null>(null);

  useEffect(() => {
    getAllFinishings();
  }, []);

  useEffect(() => {
    console.debug(
      "Selected Wall",
      BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall
    );
    if (
      selectedFrontFinishing?.texture?.fileUrl &&
      selectedFrontFinishing.texture.fileUrl !==
        BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall
          .frontTexture.colormap
    ) {
      onSelectedWallFrontTexture(selectedFrontFinishing.texture);
    }
    if (
      selectedBackFinishing?.texture?.fileUrl &&
      selectedBackFinishing.texture.fileUrl !==
        BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall
          .backTexture.colormap
    ) {
      onSelectedWallBackTexture(selectedBackFinishing.texture);
    }
  }, [
    selectedFrontFinishing,
    selectedBackFinishing,
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
      setFinishingCategories(categoriesList);
      finishingsList = finishingsList.filter(
        (finishing: Finishing) => finishing.type === "wall"
      );
      setAllFinishings(finishingsList);
      const prevSelectedFrontFinishing = finishingsList.find(
        (finishing: Finishing) =>
          finishing.texture.fileUrl ===
          BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall
            .frontTexture.colormap
      );
      if (prevSelectedFrontFinishing) {
        const filteredFinishings = finishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === prevSelectedFrontFinishing.categoryId
        );
        setFilteredFrontFinishings(filteredFinishings ?? []);
        setSelectedFrontFinishing(prevSelectedFrontFinishing);
      } else {
        const filteredFinishings = finishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === categoriesList[0]._id
        );
        setFilteredFrontFinishings(filteredFinishings ?? []);
      }
      const prevSelectedBackFinishing = finishingsList.find(
        (finishing: Finishing) =>
          finishing.texture.fileUrl ===
          BlueprintInterface.blueprint3d.roomplanningHelper.__selectedWall
            .backTexture.colormap
      );
      if (prevSelectedBackFinishing) {
        const filteredFinishings = finishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === prevSelectedBackFinishing.categoryId
        );
        setFilteredBackFinishings(filteredFinishings ?? []);
        setSelectedBackFinishing(prevSelectedBackFinishing);
      } else {
        const filteredFinishings = finishingsList.filter(
          (finishing: Finishing) =>
            finishing.categoryId === categoriesList[0]._id
        );
        setFilteredBackFinishings(filteredFinishings ?? []);
      }
    }
  };

  const handleFrontTextureCategorySelection = async (e: any) => {
    const id = e.target.value;
    const list = allFinishings?.filter(
      (finishing) => finishing.categoryId === id
    );
    setFilteredFrontFinishings(list ?? []);
  };

  const handleBackTextureCategorySelection = async (e: any) => {
    const id = e.target.value;
    const list = allFinishings?.filter(
      (finishing) => finishing.categoryId === id
    );
    setFilteredBackFinishings(list ?? []);
  };

  return (
    <>
      <Draggable handle="strong">
        <div className="box absolute top-36 right-3 z-10 max-w-60 max-h-60 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)]">
          <div className="wall-modal-title-container">
            <div className="wall-modal-title">Wall Properties</div>
            <img
              className="finishing-modal-close-icon"
              src={require("../../images/close.svg")}
              onClick={onHideWallPropertiesPanel}
            />
          </div>
          <div className="px-4 bg-[#fff]">
            <div className="py-1 grid justify-items-stretch">
              <div>
                <div className="wall-title">Wall front color</div>
                <div className="wall-selected-container">
                  <select
                    style={{ width: "8em" }}
                    className="h-8 pb-1 pl-1 mr-2 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      e.preventDefault();
                      setShowFrontTextureMenu(true);
                      setShowBackTextureMenu(false);
                    }}
                  >
                    <option className="wall-option-container">
                      {selectedFrontFinishing
                        ? convertToTitleCase(selectedFrontFinishing?.name)
                        : "Default texture"}
                    </option>
                  </select>
                  <div
                    onClick={(e) => {
                      setShowFrontTextureMenu(true);
                      setShowBackTextureMenu(false);
                    }}
                  >
                    <img
                      src={
                        selectedFrontFinishing
                          ? selectedFrontFinishing?.texture?.fileUrl
                          : defaultWallTexture.colormap
                      }
                      height={40}
                      width={40}
                    />
                  </div>
                </div>
              </div>
              <div className="pt-3">
                <div className="wall-title">Wall back color</div>
                <div className="wall-selected-container">
                  <select
                    style={{ width: "8em" }}
                    className="h-8 pb-1 pl-1 mr-2 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      e.preventDefault();
                      setShowBackTextureMenu(true);
                      setShowFrontTextureMenu(false);
                    }}
                  >
                    <option className="wall-option-container">
                      {selectedBackFinishing
                        ? convertToTitleCase(selectedBackFinishing?.name)
                        : "Default texture"}
                    </option>
                  </select>
                  <div
                    onClick={(e) => {
                      setShowBackTextureMenu(true);
                      setShowFrontTextureMenu(false);
                    }}
                  >
                    <img
                      src={
                        selectedBackFinishing
                          ? selectedBackFinishing?.texture?.fileUrl
                          : defaultWallTexture.colormap
                      }
                      height={40}
                      width={40}
                    />
                  </div>
                </div>
              </div>
              <div className="add-wall-items-container">
                <div className="wall-title">Add Wall Items</div>
                <button
                  className="flex items-start justify-self-start"
                  onClick={onOpenRoomPanel}
                >
                  <span className="select-items font-normal text-xs ml-1 mt-1">
                    Select Items
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Draggable>
      {showFrontTextureMenu && allFinishings?.length ? (
        <WallFinishingsModal
          isDarkMode={isDarkMode}
          selectedFinishing={selectedFrontFinishing}
          finishingCategories={finishingCategories}
          filteredFinishings={filteredFrontFinishings}
          setSelectedFinishing={setSelectedFrontFinishing}
          setShowTextureMenu={setShowFrontTextureMenu}
          handleTextureCategorySelection={handleFrontTextureCategorySelection}
        />
      ) : null}
      {showBackTextureMenu && allFinishings?.length ? (
        <WallFinishingsModal
          isDarkMode={isDarkMode}
          selectedFinishing={selectedBackFinishing}
          finishingCategories={finishingCategories}
          filteredFinishings={filteredBackFinishings}
          setSelectedFinishing={setSelectedBackFinishing}
          setShowTextureMenu={setShowBackTextureMenu}
          handleTextureCategorySelection={handleBackTextureCategorySelection}
        />
      ) : null}
    </>
  );
}

export default WallPropertiesModal;
