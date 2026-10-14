import React from "react";

/**
 * The Wall Editor's icons: plain line drawings on a 24 × 24 grid, drawn in the
 * current text colour so a button's state colours them for free.
 *
 * Each entry is the inside of an <svg>. Kept as data in one place rather than
 * one component per icon — there are two dozen, and nothing differs between
 * them but the lines.
 */
const PATHS: Record<string, React.ReactNode> = {
  undo: <path d="M9 7 4 12l5 5M4 12h10a5 5 0 0 1 0 10h-2" />,
  redo: <path d="m15 7 5 5-5 5M20 12H10a5 5 0 0 0 0 10h2" />,
  clear: <path d="m14 4 6 6-9 9H6l-3-3 11-12ZM8 10l6 6M11 20h10" />,
  save: (
    <path d="M5 4h11l3 3v13H5V4Zm3 0v5h7V4M8 20v-6h8v6" />
  ),
  close: <path d="M5 5l14 14M19 5 5 19" />,
  search: <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 4.5 4.5" />,
  camera: (
    <path d="M4 8h3l2-3h6l2 3h3v11H4V8Zm8 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
  ),
  library: <path d="M4 9l8-5 8 5v10H4V9Zm4 10v-6h8v6" />,
  user: <path d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM4 21c0-4 3.5-6 8-6s8 2 8 6" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  import: <path d="M12 16V5m0 0-4 4m4-4 4 4M5 14v6h14v-6" />,
  line: (
    <>
      <path d="M5 19 16 6" />
      <rect x="3" y="17" width="4" height="4" />
      <rect x="15" y="3" width="4" height="4" />
      <path d="m14 18 5-5 2 2-5 5h-2v-2Z" />
    </>
  ),
  rect: <rect x="5" y="5" width="14" height="14" />,
  circle: <circle cx="12" cy="12" r="8" />,
  light: (
    <>
      <path d="M5 4v16M5 20h15" />
      <path d="M9 9h10" strokeDasharray="2 2" />
      <path d="M9 13h2M13 13h2M17 13h2M9 16h10" />
    </>
  ),
  free: (
    <>
      <path d="M5 5h11v4M5 5v14h9" />
      <path d="m12 17 7-7 2 2-7 7h-2v-2Z" />
    </>
  ),
  offset: (
    <>
      <rect x="4" y="4" width="16" height="16" strokeDasharray="3 2" />
      <rect x="8" y="8" width="8" height="8" />
    </>
  ),
  measure: (
    <>
      <circle cx="11" cy="11" r="7" />
      <circle cx="11" cy="11" r="2.5" />
      <path d="M11 18h9v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  guides: (
    <>
      <path d="M3 8h18" />
      <path d="M3 17h18" strokeDasharray="3 2" />
      <path d="M12 9v6m0 0-2.5-2.5M12 15l2.5-2.5" />
    </>
  ),
  grid: <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />,
  brush: (
    <>
      <path d="m13 4 7 7-6 6-7-7 6-6Z" />
      <path d="M7 10 4 13l3 3M9 18l-2 3M12 19l-1 2" />
    </>
  ),
  templates: (
    <>
      <path d="M4 4h10v10H4V4Z" />
      <path d="M14 8h6v12H10v-6" />
      <path d="M14 14h3v3" />
    </>
  ),
  cube: <path d="M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4 8-4M12 12v8" />,
  zoomOut: <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 4.5 4.5M8 11h6" />,
  zoomIn: (
    <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 4.5 4.5M8 11h6M11 8v6" />
  ),
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 9h6v6H9V9Z" />,
  collapse: <path d="M14 6v12l-7-6 7-6ZM17 6v12" />,
};

export const Icon: React.FC<{ name: string; size?: number }> = ({
  name,
  size = 20,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {PATHS[name] || null}
  </svg>
);
