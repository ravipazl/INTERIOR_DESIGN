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

const Field = ({ label, value }) => (
  <p
    className="mb-1"
    style={{ fontSize: 14, color: "#414063", fontWeight: 600 }}
  >
    {label} :
    <span className="ps-2" style={{ fontWeight: 400 }}>
      {value || "N/A"}
    </span>
  </p>
);

function ProjectInfoCard({ project }) {
  if (!project) return null;

  const status = project.status;
  const statusLabel = STATUS_LABELS[status] || cap(status) || "N/A";
  const statusColor = STATUS_COLORS[status] || "#888";

  return (
    <div
      className="bg-white rounded p-3 mx-2 mb-3"
      style={{ boxShadow: "0 0 6px rgba(0,0,0,0.08)" }}
    >
      <div className="d-flex flex-column flex-md-row gap-3">
        <div className="flex-fill pe-md-4">
          <Field label="Project Name" value={cap(project.name)} />
          <Field label="Created Date" value={formatDate(project.createdAt)} />
          <Field label="Created By" value={cap(project.ownerUser?.name)} />
        </div>
        <div className="flex-fill pe-md-4">
          <Field label="Client Name" value={cap(project.clientName)} />
          <Field label="Client Phone Number" value={project.clientPhoneNumber} />
          <Field
            label="Client Email Id"
            value={project.clientEmail || project.ownerUser?.email}
          />
        </div>
        <div className="flex-fill">
          <Field label="Address" value={project.address} />
          <p
            className="mb-1"
            style={{ fontSize: 14, color: "#414063", fontWeight: 600 }}
          >
            Status :
            <span className="ps-2" style={{ fontWeight: 400, color: statusColor }}>
              {statusLabel}
            </span>
          </p>
          <Field label="Architect" value={cap(project.architectUser?.name)} />
        </div>
      </div>
    </div>
  );
}

export default ProjectInfoCard;
