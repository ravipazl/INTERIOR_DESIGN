import React, { useEffect, useState } from "react";
import {
  EmailIcon,
  FacebookIcon,
  FacebookShareButton,
  TwitterIcon,
  TwitterShareButton,
  WhatsappIcon,
  WhatsappShareButton,
  EmailShareButton,
} from "react-share";
import {
  TEModal,
  TERipple,
  TEModalDialog,
  TEModalContent,
  TEModalBody,
  TEModalFooter,
} from "tw-elements-react";
import "./index.css";
import { UserPermission } from "@pazl/entities/User";
import { AuthService } from "@pazl/services/authService";
import { Project } from "@pazl/entities/Project";
import { ProjectsService } from "@pazl/services/projectsService";
import { capitalizeText } from "@pazl/utils/genericFunctions";

interface ShareProjectModalType {
  shareId: string;
  onClose: () => void;
  isDarkMode: boolean;
  project: Project;
  refetchProject: () => void;
}

const ShareProjectModal = ({
  shareId,
  onClose,
  isDarkMode,
  project,
  refetchProject,
}: ShareProjectModalType) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [shareUserEmail, setShareUserEmail] = useState("");
  const isShareUserEmailValid =
    shareUserEmail.length &&
    shareUserEmail.includes("@") &&
    shareUserEmail.includes(".com");
  const currentUser = AuthService.getCurrentUser();
  const shareURL = `${process.env.REACT_APP_PAZL_INSPIRE_URL}/share/${shareId}`;
  const isAdminUser = () =>
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareURL);
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 1800);
  };

  const handleShareProject = async () => {
    if (project && shareUserEmail) {
      setIsLoading(true);
      const resp = await ProjectsService.shareProjectToUser(
        project._id,
        shareUserEmail
      );
      console.debug("Share project to user ~ response", resp);
      setShareUserEmail("");
      refetchProject();
      setIsLoading(false);
    }
  };

  /*const handleRemoveSharedUser = async (userName: string) => {
     if (project?.sharedUserIDs?.length) {
      const list1 = [...project.sharedUserIDs];
      const list = list1.filter((id) => id != user._id);
      const resp = await ProjectsService.updateProject(project._id, {
        sharedUserIDs: list,
      });
      setShareUserEmail("");
      refetchProject();
    } 
  };*/

  return (
    <>
      <TEModal show={true} setShow={onClose} staticBackdrop>
        <TEModalDialog
          centered
          style={{ right: "5%" }}
          className={`${isDarkMode ? "dark" : "light"}`}
        >
          <TEModalContent className="bg-white dark:bg-[#333333]">
            <div className="share-modal-content dark:bg-[#333333]">
              <div className="share-modal-header">
                <div className="share-modal-spacing" />
                <p className="share-modal-title dark:text-[#FFFFFF]">
                  SHARE PROJECT
                </p>
                <img
                  className="share-modal-close-icon"
                  src={require("../../images/close.svg")}
                  onClick={onClose}
                />
              </div>
              <TEModalBody>
                <div>
                  {currentUser?.permissions != UserPermission.ARCHITECT ? (
                    <>
                      <p className="font-bold text-[#333333] text-sm mb-1">
                        Invite people
                      </p>
                      <div className="share-modal-flex-container">
                        <input
                          className="search-input dark:bg-[#333333] dark:text-[#FFFFFF]"
                          type="email"
                          placeholder="Email"
                          value={shareUserEmail}
                          onChange={(e) => {
                            setShareUserEmail(e.target.value);
                          }}
                        />
                        <button
                          className={`share-button ${
                            !isShareUserEmailValid ? "bg-[#C3C2EE]" : ""
                          }`}
                          disabled={!isShareUserEmailValid}
                          onClick={handleShareProject}
                        >
                          <p className="share-button-text">Share</p>
                        </button>
                      </div>
                    </>
                  ) : null}
                  {isLoading ? (
                    <div className="share-project-loader">
                      <img
                        src={require("../../images/spinner-loader.gif")}
                        width={50}
                      />
                    </div>
                  ) : (
                    <>
                      {project?.sharedUsers?.length ? (
                        <div>
                          <p
                            className={`shared-user-title font-semibold text-[#aaaaaa] text-sm mt-4`}
                          >
                            Shared users{" "}
                            <span className="text-[#414063]">
                              (
                              {project.sharedUsers.length > 0 &&
                              project.sharedUsers.length < 10
                                ? "0" + project.sharedUsers.length
                                : project.sharedUsers.length}
                              )
                            </span>
                          </p>
                          <div
                            style={{
                              overflowY: "auto",
                              maxHeight: "250px",
                            }}
                          >
                            {project.sharedUsers.map((user) => {
                              return (
                                <div className="shared-user-container">
                                  <span className="shared-user-name-container">
                                    <span
                                      className="material-symbols-outlined mr-2"
                                      style={{ color: "#414063" }}
                                    >
                                      account_circle
                                    </span>
                                    <span className="shared-user-name">
                                      {capitalizeText(user)}
                                    </span>
                                  </span>
                                  {/* {isAdminUser() ? (
                                <img
                                  className="shared-user-close-icon"
                                  src={require("../../images/close2.svg")}
                                  onClick={() => {
                                    handleRemoveSharedUser(user);
                                  }}
                                />
                              ) : null} */}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </TEModalBody>
              <TEModalFooter className="share-footer-container">
                <div className="copy-link-input-container">
                  <span className="font-bold text-[#414063] px-1">Link:</span>
                  <input
                    className="copy-link-input dark:bg-[#333333] dark:text-[#FFFFFF]"
                    type="text"
                    value={shareURL}
                    contentEditable="false"
                  />
                </div>
                <div className="social-media-share-container">
                  <TERipple rippleColor="light" onClick={handleCopyLink}>
                    {isCopied ? (
                      <img
                        className="copy-icon-button"
                        src={require("../../images/done.svg")}
                        height={30}
                        width={30}
                      />
                    ) : (
                      <img
                        className="copy-icon-button"
                        src={require("../../images/copy-file.svg")}
                        height={30}
                        width={30}
                      />
                    )}
                  </TERipple>
                  <TERipple rippleColor="light">
                    <FacebookShareButton
                      className="social-media-button"
                      url={shareURL}
                    >
                      <FacebookIcon size={30} round={true} />
                    </FacebookShareButton>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <TwitterShareButton url={shareURL}>
                      <TwitterIcon size={30} round={true} />
                    </TwitterShareButton>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <EmailShareButton
                      url={shareURL}
                      className="social-media-button"
                    >
                      <EmailIcon size={30} round={true} />
                    </EmailShareButton>
                  </TERipple>
                  <TERipple rippleColor="light">
                    <WhatsappShareButton url={shareURL}>
                      <WhatsappIcon size={30} round={true} />
                    </WhatsappShareButton>
                  </TERipple>
                </div>
              </TEModalFooter>
            </div>
          </TEModalContent>
        </TEModalDialog>
      </TEModal>
    </>
  );
};

export default ShareProjectModal;
