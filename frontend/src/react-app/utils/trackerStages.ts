// Shared source of truth for the client-facing Project Tracker.
//
// The tracker is intentionally SHORT — 6 fixed milestones, the same for every
// project. If a specific project needs more detail, the team adds per-project
// "custom steps" (the + Add custom step button in the Tracker tab) — those are
// stored as stage_event records and show only for that project.
//
// Phase 1 stages are DERIVED from the project's existing `status` field (auto).
// Phase 2 stages advance manually via `stage_event` records ("Mark done").

export interface TrackerStage {
  key: string;
  label: string;
  phase: 1 | 2;
}

// The full milestone list shown to every client. Phase 1 steps auto-fill from
// the project `status`; Phase 2 steps (production / delivery / installation) are
// advanced manually by the team with "Mark done".
export const TRACKER_STAGES: TrackerStage[] = [
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

// Index of a stage by its key (−1 if unknown — e.g. an old event whose stage is
// no longer in the 6-step list; it's simply ignored by the tracker).
export function stageIndexByKey(key?: string): number {
  if (!key) return -1;
  return TRACKER_STAGES.findIndex((s) => s.key === key);
}

// Map the project `status` to the CURRENT tracker stage index.
export function statusToStageIndex(status?: string): number {
  switch (status) {
    case "open":
      return 0; // Project started
    case "quotation_requested":
      return 1; // Quote requested
    case "quotation_pending_approval":
      return 2; // Design in progress
    case "quotation_sent":
      return 3; // Quote sent
    case "quotation_accepted":
      return 5; // Quote approved (Phase 2 advances manually from here)
    case "quotation_rejected":
      // The quote WAS sent (that's how the client could reject it), so the
      // tracker holds at "Quote sent" — paused until the team sends a revised
      // quote (→ quotation_sent, same step) or closes the project.
      return 4; // Quote sent
    case "closed":
      return TRACKER_STAGES.length - 1; // Done & handover
    default:
      return 0;
  }
}
