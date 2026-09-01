import { Model } from "@pazl/entities/Model";
import React from "react";
import {
  TETabs,
  TETabsContent,
  TETabsItem,
  TETabsPane,
} from "tw-elements-react";
import RoomPanelModal from "../MenuBar/RoomPanel/roomPanelModal";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import { handleAddItemsToScene } from "@pazl/viewer3d-state-interface";
import BlueprintInterface from "@pazl/blueprint-interface";

const HandleTypesModal = ({
  onHideObjectPanel,
  isDarkMode,
  showHandleTypesModal,
  setShowHandleTypesModal,
  selectedHandleType,
  handles,
  selectedComponentGroup,
}: any) => {
  const onAddItemToSceneClick = async (model: Model | FurnishedModel) => {
    if (BlueprintInterface?.selectedModels?.length) {
      BlueprintInterface.selectedModels.map(async (item) => {
        await item.__replaceHandleEvent(
          model,
          selectedComponentGroup.components
        );
      });
      setShowHandleTypesModal(false);
    }
  };

  return (
    <div className="fixed w-[275px] h-[450px] overflow-x-hidden overflow-y-scroll block right-[386px] bottom-0 top-[168px] z-10 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700">
      <div className="h-screen mb-10px bg-white dark:bg-neutral-700">
        <div className=" bg-[#E9E5EC] dark:bg-[#333333] text-l text-center font-medium leading-tight text-neutral-800 dark:text-neutral-50">
          <TETabs className="mb-0 flex items-center justify-between">
            <div className="p-3 mt-0 bg-[#F9F9FA] border-t border-r border-l border-b-0 border-inherit">
              <span className="font-bold">
                {selectedHandleType ? selectedHandleType.name : ""}
              </span>
            </div>
            <img
              className="finishing-modal-close-icon"
              src={require("../../images/close.svg")}
              style={{ marginRight: "5px" }}
              onClick={() => {
                setShowHandleTypesModal(false);
              }}
            />
          </TETabs>
          <TETabsContent className="bg-white m-0">
            <TETabsPane show={showHandleTypesModal}>
              <div>
                <div className="px-3 flex flex-col text-justify">
                  <div className="flex flex-col items-center">
                    <div className="mt-3 mb-2.5">
                      <div className="flex flex-wrap justify-start align-middle">
                        {handles.map((model: any) => (
                          <RoomPanelModal
                            modalData={model}
                            key={model._id}
                            onAddItemToSceneClick={() => {
                              onAddItemToSceneClick(model);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TETabsPane>
          </TETabsContent>
        </div>
      </div>
    </div>
  );
};

export default HandleTypesModal;
