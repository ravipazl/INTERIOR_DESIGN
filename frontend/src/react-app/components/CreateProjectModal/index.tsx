import React, { useEffect, useState } from "react";
import {
  TEModal,
  TERipple,
  TEModalDialog,
  TEModalContent,
  TEModalBody,
  TEModalFooter,
} from "tw-elements-react";
import "./index.css";
import { ProjectsService } from "@pazl/services/projectsService";
import { AuthService } from "@pazl/services/authService";
import { Project } from "@pazl/entities/Project";
import { User, UserPermission } from "@pazl/entities/User";

interface CreateProjectProps {
  onClose: () => void;
  onEditComplete: (project: Project) => void;
  onCreateComplete: (project: Project) => void;
  editingProject?: Project | null;
  isDarkMode: boolean;
  isCloneProject?: boolean;
}

const CreateProjectModal = ({
  onClose,
  editingProject,
  onEditComplete,
  onCreateComplete,
  isDarkMode,
  isCloneProject,
}: CreateProjectProps) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [project, setProject] = useState<any>();
  const [showError, setShowError] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [architectUsers, setArchitectUsers] = useState<User[]>([]);

  useEffect(() => {
    if (editingProject) {
      // Many projects never had a SEPARATE client name/email entered, but we
      // already have them from the OWNER's account (captured at signup). Pre-fill
      // the empty client fields from the owner so the data we already hold shows
      // in the form instead of blank inputs.
      const owner = (editingProject as any)?.ownerUser;
      setProject({
        ...editingProject,
        clientName: (editingProject as any).clientName || owner?.name || "",
        clientEmail: (editingProject as any).clientEmail || owner?.email || "",
        clientPhoneNumber:
          (editingProject as any).clientPhoneNumber ||
          owner?.phoneNumber ||
          owner?.phone ||
          "",
      });
    }
  }, [editingProject]);

  useEffect(() => {
    getArchitectUsers();
    setCurrentUser(AuthService.getCurrentUser());
    if (!editingProject) {
      setProject({ ...project, status: "open" });
    }
  }, []);

  const getArchitectUsers = async () => {
    const users = await AuthService.getAllArchitectUsers();
    if (users?.length) setArchitectUsers(users);
  };

  const handleSave = async () => {
    // Phone is optional, but if entered it must be a full 10-digit number.
    let localDigits = String(project?.clientPhoneNumber || "")
      .replace(/[^\d]/g, "")
      .replace(/^0+/, "");
    if (localDigits.length > 10 && localDigits.startsWith("91")) {
      localDigits = localDigits.slice(2);
    }
    const phoneOk = localDigits.length === 0 || localDigits.length === 10;
    setPhoneError(phoneOk ? "" : "Enter a valid 10-digit mobile number");
    if (project?.name && project?.address && project?.clientName) {
      if (!phoneOk) return;
      setShowError(false);
      if (editingProject && !isCloneProject) {
        // NOTE: `status` is deliberately NOT sent on edit. Status is driven by the
        // quote lifecycle (Get Quote / Send to client / Accept / Close) and the
        // list page — sending it here re-fired those emails/notifications on every
        // unrelated edit (e.g. changing the address). Editing details must never
        // move the status.
        const obj = {
          name: project.name ?? "",
          address: project.address ?? "",
          clientName: project.clientName ?? "",
          architectUserId: project.architectUserId ?? "",
          clientGSTNumber: project.clientGSTNumber ?? "",
          clientEmail: project.clientEmail ?? "",
          clientPhoneNumber: project.clientPhoneNumber ?? "",
        };
        const response = await ProjectsService.updateProject(
          editingProject?._id,
          obj
        );
        if (response) {
          onEditComplete(response);
        }
      } else {
        const response = await ProjectsService.createProject({
          name: project.name,
          address: project.address,
          clientName: project.clientName,
          status: "open",
          sharedUserIDs: [],
          architectUserId: project.architectUserId ?? "",
          shareId: Math.random().toString().substring(2),
          ownerUserId: currentUser?._id,
          clientGSTNumber: project.clientGSTNumber ?? "",
          clientEmail: project.clientEmail ?? "",
          clientPhoneNumber: project.clientPhoneNumber ?? "",
        });
        if (response) {
          onCreateComplete(response);
        }
      }
    } else {
      setShowError(true);
    }
  };

  // The field edits only the local 10 digits; the +91 is a fixed visual prefix
  // and the backend adds the country code at send time. Strip a legacy "91"
  // prefix (12-digit stored values) so old numbers still show their local part.
  const localPhone = (() => {
    let d = String(project?.clientPhoneNumber || "")
      .replace(/[^\d]/g, "")
      .replace(/^0+/, "");
    if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
    return d.slice(0, 10);
  })();

  return (
    <>
      <TEModal show={true} setShow={onClose} staticBackdrop>
        <TEModalDialog
          centered
          style={{
            bottom:
              currentUser?.permissions === UserPermission.ADMIN ||
              currentUser?.permissions === UserPermission.SUPER_ADMIN
                ? "42%"
                : "40%",
            right: "10%",
          }}
          className={`${isDarkMode ? "dark" : "light"}`}
        >
          <TEModalContent className="bg-white dark:bg-[#333333]">
            <div
              className="project-modal-content dark:bg-[#333333]"
              style={{
                height:
                  currentUser?.permissions === UserPermission.ADMIN ||
                  currentUser?.permissions === UserPermission.SUPER_ADMIN
                    ? "600px"
                    : "555px",
              }}
            >
              <div className="project-modal-header">
                <div className="project-spacing" />
                <h5 className="project-modal-title dark:text-[#FFFFFF]">
                  {editingProject && !isCloneProject
                    ? "UPDATE PROJECT"
                    : "CREATE PROJECT"}
                </h5>
                <img
                  className="project-modal-close-icon"
                  src={require("../../images/close.svg")}
                  onClick={onClose}
                />
              </div>
              <TEModalBody>
                <div className="modal-body d-flex justify-content-center align-items-center">
                  <div className="project-modal-form-container dark:bg-[#333333]">
                    <label className="project-modal-form-label dark:text-[#FFFFFF]">
                      Project Name
                    </label>
                    <input
                      required
                      type="text"
                      className="project-modal-form-input"
                      id="projectname"
                      value={project?.name}
                      onChange={(e) => {
                        setProject({ ...project, name: e.target.value });
                      }}
                    />
                  </div>
                  <div className="project-modal-form-container dark:bg-[#333333]">
                    <label className="project-modal-form-label dark:text-[#FFFFFF]">
                      Address
                    </label>
                    <input
                      required
                      type="text"
                      className="project-modal-form-input"
                      id="address"
                      value={project?.address}
                      onChange={(e) => {
                        setProject({ ...project, address: e.target.value });
                      }}
                    />
                  </div>
                  <div className="project-modal-form-container dark:bg-[#333333]">
                    <label className="project-modal-form-label dark:text-[#FFFFFF]">
                      Client Name
                    </label>
                    <input
                      required
                      type="text"
                      className="project-modal-form-input"
                      id="clientname"
                      value={project?.clientName}
                      onChange={(e) => {
                        setProject({ ...project, clientName: e.target.value });
                      }}
                    />
                  </div>
                  <div className="project-modal-form-container dark:bg-[#333333]">
                    <label className="project-modal-form-label dark:text-[#FFFFFF]">
                      Client Phone Number
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        width: 244,
                      }}
                    >
                      <div style={{ display: "flex", width: "100%" }}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            background: "#e2dfe6",
                            borderRadius: "2px 0 0 2px",
                            fontSize: 14,
                            color: "#414063",
                            flex: "0 0 auto",
                          }}
                        >
                          +91
                        </span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="98765 43210"
                          className="project-modal-form-input"
                          id="clientPhoneNumber"
                          style={{
                            width: "auto",
                            flex: 1,
                            borderRadius: "0 2px 2px 0",
                          }}
                          value={localPhone}
                          onChange={(e) => {
                            const d = e.target.value
                              .replace(/[^\d]/g, "")
                              .slice(0, 10);
                            setProject({ ...project, clientPhoneNumber: d });
                            if (phoneError) setPhoneError("");
                          }}
                        />
                      </div>
                      {phoneError && (
                        <div
                          style={{
                            color: "#dc2626",
                            fontSize: 11,
                            lineHeight: "15px",
                            marginTop: 4,
                          }}
                        >
                          {phoneError}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="project-modal-form-container dark:bg-[#333333]">
                    <label className="project-modal-form-label dark:text-[#FFFFFF]">
                      Client Email Id
                    </label>
                    <input
                      required
                      type="email"
                      className="project-modal-form-input"
                      id="clientEmail"
                      value={project?.clientEmail}
                      onChange={(e) => {
                        setProject({ ...project, clientEmail: e.target.value });
                      }}
                    />
                  </div>
                  <div className="project-modal-form-container dark:bg-[#333333]">
                    <label className="project-modal-form-label dark:text-[#FFFFFF]">
                      Client GST Number
                    </label>
                    <input
                      required
                      type="text"
                      className="project-modal-form-input"
                      id="clientGSTNumber"
                      value={project?.clientGSTNumber}
                      onChange={(e) => {
                        setProject({
                          ...project,
                          clientGSTNumber: e.target.value,
                        });
                      }}
                    />
                  </div>
                  {currentUser?.permissions === UserPermission.ADMIN ||
                  currentUser?.permissions === UserPermission.SUPER_ADMIN ? (
                    <div className="project-modal-form-container dark:bg-[#333333]">
                      <label className="project-modal-form-label dark:text-[#FFFFFF]">
                        Architect
                      </label>
                      <select
                        id="dropdown"
                        value={project?.architectUserId}
                        onChange={(e) => {
                          setProject({
                            ...project,
                            architectUserId: e.target.value,
                          });
                        }}
                        className="project-modal-dropdown"
                      >
                        {architectUsers?.map((architectUser) => (
                          <option
                            key={architectUser._id}
                            value={architectUser._id}
                          >
                            {architectUser.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {/* Project Status editor removed: status is managed by the quote
                      lifecycle (Get Quote / Send to client / Accept / Close) and the
                      list page. Editing it here re-fired emails/notifications and
                      could set a status without doing the real action (e.g. marking
                      a quote "sent" without emailing it). */}
                  {showError ? (
                    <div className="text-danger font-semibold text-xs mb-2 -mt-4">
                      Please fill all the required parameters.
                    </div>
                  ) : null}
                  <div className="project-modal-footer">
                    <TERipple rippleColor="light">
                      <button
                        type="button"
                        className="save-project-button bg-[#414063]"
                        onClick={handleSave}
                      >
                        <p className="save-project-button-text">
                          {editingProject && !isCloneProject
                            ? "Update"
                            : "Create"}
                        </p>
                      </button>
                    </TERipple>
                  </div>
                </div>
              </TEModalBody>
            </div>
          </TEModalContent>
        </TEModalDialog>
      </TEModal>
    </>
  );
};

export default CreateProjectModal;
