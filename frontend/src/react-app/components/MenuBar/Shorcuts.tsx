import React, { useState } from "react";
import {
  TEModal,
  TEModalBody,
  TEModalContent,
  TEModalDialog,
  TERipple,
} from "tw-elements-react";

interface ShortcutsModalProps {
  showShortcutsModal: boolean;
  setShowShortcutsModal: (value: boolean) => void;
}

const ShortcutsModal = ({
  showShortcutsModal,
  setShowShortcutsModal,
}: ShortcutsModalProps) => {
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;
  const [os, setOs] = useState("windows");

  return (
    <TEModal
      show={showShortcutsModal}
      setShow={setShowShortcutsModal}
      staticBackdrop
    >
      <TEModalDialog
        centered
        style={{ right: "5%" }}
        className={`${isDarkMode ? "dark" : "light"}`}
      >
        <TEModalContent className="dark:bg-[#333333]">
          <div className="shortcuts-modal-content dark:bg-[#333333]">
            <div className="shortcuts-modal-header bg-[#F9F9FA]">
              <p className="shortcuts-modal-title dark:text-[#ffffff]">
                Keyboard Shortcuts
              </p>
              <div className="shortcuts-model-header-container">
                <div className="shortcuts-modal-flex-container">
                  <TERipple rippleColor="light">
                    <button
                      className={
                        os === "windows"
                          ? "shortcuts-os-selected-button"
                          : "shortcuts-os-button"
                      }
                      onClick={() => {
                        setOs("windows");
                      }}
                    >
                      <p className="shortcuts-button-text">Windows</p>
                    </button>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <button
                      className={
                        os === "mac"
                          ? "shortcuts-os-selected-button"
                          : "shortcuts-os-button"
                      }
                      onClick={() => {
                        setOs("mac");
                      }}
                    >
                      <p className="shortcuts-button-text">Mac</p>
                    </button>
                  </TERipple>
                </div>
                <img
                  className="shortcuts-modal-close-icon"
                  src={require("../../images/close2.svg")}
                  onClick={() => {
                    setShowShortcutsModal(false);
                  }}
                />
              </div>
            </div>
            <TEModalBody>
              <div className="shortcut-container">
                <div>
                  <div className="shortcut-title">Copy</div>
                  <div className="shortcut-desc">
                    It copies the selected model in the scene.
                  </div>
                </div>
                <div>
                  <span className="shortcut-key">Ctrl</span>
                  <span className="mx-2">+</span>
                  <span className="shortcut-key">C</span>
                </div>
              </div>
              <div className="shortcut-container">
                <div>
                  <div className="shortcut-title">Paste</div>
                  <div className="shortcut-desc">
                    It pastes/adds the copied model & also creates a new model
                    with same properties of the copied model.
                  </div>
                </div>
                <div>
                  <span className="shortcut-key">Ctrl</span>
                  <span className="mx-2">+</span>
                  <span className="shortcut-key">V</span>
                </div>
              </div>
            </TEModalBody>
          </div>
        </TEModalContent>
      </TEModalDialog>
    </TEModal>
  );
};

export default ShortcutsModal;
