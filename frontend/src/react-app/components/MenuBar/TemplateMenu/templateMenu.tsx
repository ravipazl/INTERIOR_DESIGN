import React, { useState } from "react";
import { createPortal } from "react-dom";
import TemplateCard from "./templateCard";
import {
  TEModal,
  TEModalDialog,
  TEModalContent,
  TEModalBody,
} from "tw-elements-react";
import {
  TemplateMenuProps,
  TemplateCardProps,
} from "../../../models/template.card";
import "./index.css";

const TemplateMenu: React.FC<TemplateMenuProps> = ({
  templateList,
  onTemplateSelect,
  isModalVisible,
  onHide,
  isFloorPlanCleared,
  onTemplateDelete,
}) => {
  // Which custom template the user is about to delete (drives the styled popup).
  const [pendingDelete, setPendingDelete] = useState<TemplateCardProps | null>(
    null
  );

  const confirmDelete = () => {
    if (pendingDelete) onTemplateDelete?.(String(pendingDelete.id));
    setPendingDelete(null);
  };

  return (
    <>
      <TEModal show={isModalVisible} setShow={onHide}>
        <TEModalDialog centered className="max-w-4xl">
          <TEModalContent className="bg-white dark:bg-[#333333]">
            <TEModalBody>
              <div className="template-menu-close-container">
                <div className="w-100" />
                <h5 className="mb-2.5 text-center font-semibold text-base text-[#414063] dark:text-[#999999]">
                  Choose a pre-made floor plan
                </h5>
                <img
                  className="finishing-modal-close-icon"
                  src={require("../../../images/close.svg")}
                  onClick={onHide}
                />
              </div>
              <div className="flex flex-nowrap gap-3 overflow-x-auto py-2 px-1">
                {templateList.map((item) => (
                  <TemplateCard
                    key={item.id}
                    template={item}
                    onTemplateSelect={() => onTemplateSelect(item.url)}
                    onRequestDelete={(t) => setPendingDelete(t)}
                  />
                ))}
              </div>
              {!isFloorPlanCleared ? (
                <h5 className="text-sm font-normal text-[#333333] dark:text-[#ffffff] m-2">
                  Note: A floorplan already exists for your current project,
                  selecting a new floorplan will clear your existing floorplan
                  and all of it's saved data.
                </h5>
              ) : null}
            </TEModalBody>
          </TEModalContent>
        </TEModalDialog>
      </TEModal>

      {pendingDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40"
            onClick={() => setPendingDelete(null)}
          >
            <div
              className="w-80 rounded-md bg-white dark:bg-[#333333] p-4 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-1 font-semibold text-black dark:text-white">
                Delete template
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Delete <span className="font-semibold">"{pendingDelete.title}"</span>?
                This can't be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="rounded px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#4E4E4E]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default TemplateMenu;
