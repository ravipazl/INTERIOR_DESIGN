// Shared tracker steps for the AI/Inspire app — mirrors the design app's
// pazl-design-frontend/src/react-app/utils/trackerStages.ts so both show the
// same "Track your project" flow (same shared stage_event data).

export const TRACKER_STAGES = [
  { key: "project_created", label: "Project started", phase: 1 },
  { key: "quote_requested", label: "Quote requested", phase: 1 },
  { key: "design_in_progress", label: "Design in progress", phase: 1 },
  { key: "quote_sent", label: "Quote sent", phase: 1 },
  { key: "quote_accepted", label: "Quote approved", phase: 1 },
  { key: "design_finalized", label: "Design finalized", phase: 2 },
  { key: "in_production", label: "In production", phase: 2 },
  { key: "quality_check", label: "Quality check", phase: 2 },
  { key: "installation", label: "Installation", phase: 2 },
  { key: "completed_handover", label: "Done & handover", phase: 2 },
];

export const stageLabel = (key) =>
  TRACKER_STAGES.find((s) => s.key === key)?.label || "";

export const stageIndexByKey = (key) =>
  key ? TRACKER_STAGES.findIndex((s) => s.key === key) : -1;

export const statusToStageIndex = (status) => {
  switch (status) {
    case "open":
      return 0;
    case "quotation_requested":
      return 1;
    case "quotation_pending_approval":
      return 2;
    case "quotation_sent":
      return 3;
    case "quotation_accepted":
      return 5;
    case "quotation_rejected":
      // The quote WAS sent (that's why the client could reject it), so the
      // tracker holds at "Quote sent" — paused until the team sends a revised
      // quote (→ quotation_sent, same step) or closes the project.
      return 4;
    case "closed":
      return TRACKER_STAGES.length - 1;
    default:
      return 0;
  }
};
