import React from "react";
import {
  TEModal,
  TEModalBody,
  TEModalContent,
  TEModalDialog,
  TERipple,
} from "tw-elements-react";

const ConfirmCloneProjectModal = ({
  showCloneConfirmModal,
  setShowCloneConfirmModal,
  handleCloneProject,
  isDarkMode,
}: any) => {
  return (
    <TEModal
      show={showCloneConfirmModal}
      setShow={setShowCloneConfirmModal}
      staticBackdrop
    >
      <TEModalDialog
        centered
        style={{ right: "5%" }}
        className={`${isDarkMode ? "dark" : "light"}`}
      >
        <TEModalContent className="bg-white dark:bg-[#333333]">
          <div className="clear-modal-content dark:bg-[#333333]">
            <div className="clear-modal-header">
              <p className="clear-modal-title dark:text-[#FFFFFF]">
                CLONE PROJECT
              </p>
            </div>
            <TEModalBody>
              <p className="clear-modal-subtitle dark:text-[#FFFFFF]">
                Do you want to create a new project with the same project
                details ?
              </p>
              <div className="clear-modal-body">
                <div className="clear-modal-flex-container">
                  <TERipple rippleColor="light">
                    <button
                      className="clear-button"
                      onClick={handleCloneProject}
                    >
                      <p className="clear-button-text">Yes</p>
                    </button>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <button
                      className="clear-button"
                      onClick={() => {
                        setShowCloneConfirmModal(false);
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

export default ConfirmCloneProjectModal;
