import React from "react";
import { formatDate } from "../../utils/genericFunctions";

/**
 * ProjectInfoCard — the read-only project + client details shown to the client
 * on PAZL web, mirroring the block the team sees in the 3D app. Sits at the top
 * of the Project Workspace tab, above the tracker, so the client always sees who
 * the project is for and where it stands. No edit / delete / 3D controls — those
 * stay team-only in the designer app.
 */

const cap = (s) =>
  typeof s === "string" && s.length
    ? s.charAt(0).toUpperCase() + s.slice(1)
    : s;

const STATUS_LABELS = {
  open: "Open",
  quotation_requested: "Quotation requested",
  quotation_pending_approval: "Pending approval",
  quotation_sent: "Quotation sent",
  quotation_accepted: "Quotation accepted",
  closed: "Closed",
};

const STATUS_COLORS = {
  open: "#ffbe26",
  quotation_requested: "#dc3545",
  quotation_pending_approval: "#f59e0b",
  quotation_sent: "#198754",
  quotation_accepted: "#0ea5e9",
  closed: "#888",
};

// One detail: a small grey label over its value — the same grid as the
// designer's Project Detail card (react-app pages/ProjectDetail, .pz-pd-info).
const Field = ({ label, value, children }) => (
  <div className="pz-pd-field">
    <dt>{label}</dt>
    <dd>{children || value || "N/A"}</dd>
  </div>
);

function ProjectInfoCard({ project }) {
  if (!project) return null;

  const status = project.status;
  const statusLabel = STATUS_LABELS[status] || cap(status) || "N/A";
  const statusColor = STATUS_COLORS[status] || "#888";

  return (
    <div className="pz-pd-card pz-iw-info">
      <div className="pz-iw-info-head">
        <span className="pz-iw-badge" aria-hidden="true">
          {/* A drawn icon: the Material Symbols font is not loaded on PAZL
              web, so a ligature name would show as plain text. */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5.5 9.5V20h13V9.5" />
            <path d="M10 20v-5h4v5" />
          </svg>
        </span>
        <div>
          <h2 className="pz-pd-h2">{cap(project.name) || "Your project"}</h2>
          <p className="pz-iw-sub">Project and client details</p>
        </div>
      </div>
      <dl className="pz-pd-info">
        <div className="pz-pd-col">
          <Field label="Project Name" value={cap(project.name)} />
          <Field label="Created Date" value={formatDate(project.createdAt)} />
          <Field label="Created By" value={cap(project.ownerUser?.name)} />
        </div>
        <div className="pz-pd-col">
          <Field label="Client Name" value={cap(project.clientName)} />
          <Field label="Client Phone Number" value={project.clientPhoneNumber} />
          <Field
            label="Client Email Id"
            value={project.clientEmail || project.ownerUser?.email}
          />
        </div>
        <div className="pz-pd-col">
          <Field label="Address" value={project.address} />
          <Field label="Status">
            <span className="pz-pd-status" style={{ "--pz-status": statusColor }}>
              {statusLabel}
            </span>
          </Field>
          <Field label="Architect" value={cap(project.architectUser?.name)} />
        </div>
      </dl>
    </div>
  );
}

export default ProjectInfoCard;
