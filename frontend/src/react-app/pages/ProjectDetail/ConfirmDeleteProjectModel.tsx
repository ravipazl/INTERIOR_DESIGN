import React from "react";
import {
  TEModal,
  TEModalBody,
  TEModalContent,
  TEModalDialog,
  TERipple,
} from "tw-elements-react";

const ConfirmDeleteProjectModal = ({
  showDeleteConfirmModal,
  setShowDeleteConfirmModal,
  handleDeleteProject,
  isDarkMode,
}: any) => {
  return (
    <TEModal
      show={showDeleteConfirmModal}
      setShow={setShowDeleteConfirmModal}
      staticBackdrop
    >
      <TEModalDialog
        centered
        style={{ right: "5%" }}
        className={`${isDarkMode ? "dark" : "light"}`}
      >
        <TEModalContent className="bg-white dark:bg-[#333333]">
          <div className="delete-modal-content dark:bg-[#333333]">
            <div className="clear-modal-header">
              <p className="clear-modal-title dark:text-[#FFFFFF]">
                DELETE PROJECT
              </p>
            </div>
            <TEModalBody>
              <p className="clear-modal-subtitle dark:text-[#FFFFFF]">
                Are you sure you want to delete this project and it's saved
                floorplan data ?
              </p>
              <div className="clear-modal-body">
                <div className="clear-modal-flex-container">
                  <TERipple rippleColor="light">
                    <button
                      className="clear-button"
                      onClick={handleDeleteProject}
                    >
                      <p className="clear-button-text">Yes</p>
                    </button>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <button
                      className="clear-button"
                      onClick={() => {
                        setShowDeleteConfirmModal(false);
                      }}
                    >
                      <p className="clear-button-text">No</p>
                    </button>
                  </TERipple>
                </div>
              </div>
            </TEModalBody>
          </div>
        </TEModalContent>
      </TEModalDialog>
    </TEModal>
  );
};

export default ConfirmDeleteProjectModal;
