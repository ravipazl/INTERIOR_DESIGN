import React from "react";
import {
  TEModal,
  TEModalDialog,
  TEModalContent,
  TEModalBody,
  TERipple,
} from "tw-elements-react";

const ConfirmClearFloorplanModal = ({
  showClearConfirmModal,
  onCloseClearConfirmModal,
  handleClear,
  isDarkMode,
}: any) => {
  return (
    <TEModal
      show={showClearConfirmModal}
      setShow={onCloseClearConfirmModal}
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
                CLEAR FLOORPLAN
              </p>
            </div>
            <TEModalBody>
              <p className="clear-modal-subtitle dark:text-[#FFFFFF]">
                Are you sure you want to clear your existing floorplan & it's
                saved data ?
              </p>
              <div className="clear-modal-body">
                <div className="clear-modal-flex-container">
                  <TERipple rippleColor="light">
                    <button className="clear-button" onClick={handleClear}>
                      <p className="clear-button-text">Yes</p>
                    </button>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <button
                      className="clear-button"
                      onClick={onCloseClearConfirmModal}
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

export default ConfirmClearFloorplanModal;
