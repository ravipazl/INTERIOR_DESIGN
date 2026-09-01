import React from "react";
import { Finishing } from "@pazl/entities/Finishing";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import Draggable from "react-draggable";

interface FloorFinishingsModalProps {
  isDarkMode: boolean;
  selectedFinishing: Finishing | null;
  finishingCategories: any[];
  filteredFinishings: Finishing[] | null;
  setSelectedFinishing: (finishing: Finishing) => void;
  setShowTextureMenu: (value: boolean) => void;
  handleTextureCategorySelection: (value: any) => void;
}

const FloorFinishingsModal = ({
  isDarkMode,
  selectedFinishing,
  finishingCategories,
  filteredFinishings,
  setSelectedFinishing,
  setShowTextureMenu,
  handleTextureCategorySelection,
}: FloorFinishingsModalProps) => {
  return (
    <Draggable handle="strong">
      <div
        style={{ marginRight: "12.5em" }}
        className="box absolute top-36 right-3 z-10 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)]"
      >
        <div className="floor-color-header">
          <span className="floor-color-title">Floor color</span>
          <img
            className="finishing-modal-close-icon"
            src={require("../../images/close.svg")}
            onClick={() => {
              setShowTextureMenu(false);
            }}
          />
        </div>
        <div className="textures-flex-container">
          {finishingCategories?.length ? (
            <select
              style={{ width: "18em" }}
              defaultValue={selectedFinishing?.category?._id}
              className="h-8 pb-1 pl-1 m-1 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
              onClick={handleTextureCategorySelection}
            >
              {finishingCategories.map((category: any) => {
                return (
                  <option
                    key={category._id}
                    className="floor-option-container"
                    value={category._id}
                  >
                    {convertToTitleCase(category.name)}
                  </option>
                );
              })}
            </select>
          ) : null}
          {filteredFinishings?.length
            ? filteredFinishings.map((finishing: Finishing) => {
                return (
                  <div
                    key={finishing._id}
                    className="p-2"
                    onClick={() => setSelectedFinishing(finishing)}
                  >
                    <img
                      src={finishing.texture.fileUrl}
                      width={120}
                      height={120}
                      style={{
                        cursor: "pointer",
                        border:
                          selectedFinishing?._id === finishing._id
                            ? "5px solid #ffcd00"
                            : "1px solid #ccc",
                      }}
                    />
                    <div className="texture-name">
                      {convertToTitleCase(finishing.name)}
                    </div>
                  </div>
                );
              })
            : null}
        </div>
      </div>
    </Draggable>
  );
};

export default FloorFinishingsModal;
