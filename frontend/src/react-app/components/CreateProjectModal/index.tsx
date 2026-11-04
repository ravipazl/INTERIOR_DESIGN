import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  // While the save request runs: the buttons show it and can't be pressed
  // twice (a double click used to be able to create the project twice).
  const [saving, setSaving] = useState(false);

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

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await handleSave();
    } finally {
      setSaving(false);
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

  const isEdit = !!editingProject && !isCloneProject;
  const isAdmin =
    currentUser?.permissions === UserPermission.ADMIN ||
    currentUser?.permissions === UserPermission.SUPER_ADMIN;

  // Rendered into <body> so no page layout (transforms, overflow) can clip or
  // shift it. Clicking the backdrop does nothing, as before (static backdrop):
  // a stray click must not throw away what was typed.
  return createPortal(
    <div className={`pz-pm-backdrop ${isDarkMode ? "dark" : "light"}`}>
      <div
        className="pz-pm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pz-pm-title"
      >
        <div className="pz-pm-head">
          <div>
            <h5 id="pz-pm-title" className="pz-pm-title">
              {isEdit
                ? "Edit project"
                : isCloneProject
                ? "Duplicate project"
                : "Create project"}
            </h5>
            <p className="pz-pm-sub">
              {isEdit
                ? "Update the project and client details."
                : "Add the project and client details."}
            </p>
          </div>
          <button
            type="button"
            className="pz-pm-close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="pz-pm-body">
          <div className="pz-pm-grid">
            <div className="pz-pm-field">
              <label htmlFor="projectname">
                Project Name <span className="pz-pm-req">*</span>
              </label>
              <input
                required
                type="text"
                className="pz-pm-input"
                id="projectname"
                placeholder="e.g. 3BHK Interiors"
                value={project?.name ?? ""}
                onChange={(e) => {
                  setProject({ ...project, name: e.target.value });
                }}
              />
            </div>
            <div className="pz-pm-field">
              <label htmlFor="address">
                Address <span className="pz-pm-req">*</span>
              </label>
              <input
                required
                type="text"
                className="pz-pm-input"
                id="address"
                placeholder="Site address"
                value={project?.address ?? ""}
                onChange={(e) => {
                  setProject({ ...project, address: e.target.value });
                }}
              />
            </div>
            <div className="pz-pm-field">
              <label htmlFor="clientname">
                Client Name <span className="pz-pm-req">*</span>
              </label>
              <input
                required
                type="text"
                className="pz-pm-input"
                id="clientname"
                placeholder="Client's full name"
                value={project?.clientName ?? ""}
                onChange={(e) => {
                  setProject({ ...project, clientName: e.target.value });
                }}
              />
            </div>
            <div className="pz-pm-field">
              <label htmlFor="clientPhoneNumber">Client Phone Number</label>
              <div className={`pz-pm-phone${phoneError ? " is-error" : ""}`}>
                <span className="pz-pm-cc">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="98765 43210"
                  className="pz-pm-input"
                  id="clientPhoneNumber"
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
              {phoneError && <div className="pz-pm-error">{phoneError}</div>}
            </div>
            <div className="pz-pm-field">
              <label htmlFor="clientEmail">Client Email Id</label>
              <input
                required
                type="email"
                className="pz-pm-input"
                id="clientEmail"
                placeholder="name@example.com"
                value={project?.clientEmail ?? ""}
                onChange={(e) => {
                  setProject({ ...project, clientEmail: e.target.value });
                }}
              />
            </div>
            <div className="pz-pm-field">
              <label htmlFor="clientGSTNumber">Client GST Number</label>
              <input
                required
                type="text"
                className="pz-pm-input"
                id="clientGSTNumber"
                placeholder="Optional"
                value={project?.clientGSTNumber ?? ""}
                onChange={(e) => {
                  setProject({
                    ...project,
                    clientGSTNumber: e.target.value,
                  });
                }}
              />
            </div>
            {isAdmin ? (
              <div className="pz-pm-field pz-pm-field--full">
                <label htmlFor="dropdown">Architect</label>
                <select
                  id="dropdown"
                  value={project?.architectUserId}
                  onChange={(e) => {
                    setProject({
                      ...project,
                      architectUserId: e.target.value,
                    });
                  }}
                  className="pz-pm-input pz-pm-select"
                >
                  {architectUsers?.map((architectUser) => (
                    <option key={architectUser._id} value={architectUser._id}>
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
          </div>
          {showError ? (
            <div className="pz-pm-alert" role="alert">
              Please fill all the required parameters.
            </div>
          ) : null}
        </div>

        <div className="pz-pm-foot">
          <button
            type="button"
            className="pz-pm-btn pz-pm-btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pz-pm-btn pz-pm-btn--primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? (isEdit ? "Updating…" : "Creating…") : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CreateProjectModal;
