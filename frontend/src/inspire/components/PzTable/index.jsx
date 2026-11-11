import React, { useEffect, useState } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
// The look these pieces wear: the shared list-page styles, scoped to
// `.pz-projects` (the Projects page's scope, reused by Teams and Rate card so
// all three read as one).
import "../../pages/Dashboard/AdminDashboard/Projects.css";
import "./ListPages.css";
import "./pager.css";

/**
 * The parts of the refreshed list pages that Teams and Rate card share with
 * Projects: icons, the row action button with its name on hover, the data
 * table's look, its pager and its loading rows.
 *
 * Projects keeps its own copies for now: it is live and already checked, and
 * pointing it here can be done on its own, later.
 */

// --- small inline icons (stroke = the text colour) ---------------------------
export const Icon = ({ size = 16, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);
export const SearchIcon = () => (
  <Icon className="pzp-search-icon" stroke="#697386">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const ClearIcon = () => (
  <Icon size={12} strokeWidth="3">
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon size={16} strokeWidth="2.4">
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const EditIcon = () => (
  <Icon size={17}>
    <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
    <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon size={17}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
  </Icon>
);
export const RefreshIcon = () => (
  <Icon size={16}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);
export const ListIcon = () => (
  <Icon size={16}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);

/** An icon button whose name shows on hover. `danger` for a destructive one. */
export const ActionIcon = ({ label, onClick, primary, danger, disabled, children }) => (
  <OverlayTrigger
    placement="top"
    delay={{ show: 120, hide: 0 }}
    overlay={<Tooltip className="pzp-tip">{label}</Tooltip>}
  >
    <button
      type="button"
      className={`pzp-act${primary ? " pzp-act--primary" : ""}${danger ? " pzp-act--danger" : ""}`}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  </OverlayTrigger>
);

export const initialsOf = (name) =>
  String(name || "")
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

// The data table's own look, matched to Projects.css.
export const tableStyles = {
  headRow: {
    style: { minHeight: "38px", backgroundColor: "#f6f5fe", borderBottomColor: "#e8e5fb" },
  },
  headCells: {
    style: {
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "10.5px",
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: "#2b3247",
      paddingLeft: "14px",
      paddingRight: "14px",
    },
  },
  rows: {
    style: {
      minHeight: "44px",
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "12px",
      color: "#172033",
      "&:not(:last-of-type)": { borderBottomColor: "#f0f1f4" },
    },
    highlightOnHoverStyle: {
      backgroundColor: "#f8f6ff",
      color: "#172033",
      borderBottomColor: "#f0f1f4",
      outline: "none",
      transitionDuration: "0.15s",
      transitionProperty: "background-color",
    },
  },
  cells: { style: { paddingLeft: "14px", paddingRight: "14px" } },
  progress: { style: { display: "block", width: "100%" } },
  noData: { style: { display: "block", width: "100%" } },
};

export const ROWS_PER_PAGE = [10, 25, 50, 100];

/** Page buttons: all of them when few, else first … around the current … last. */
export const pageList = (current, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) pages.push("…");
  for (let p = from; p <= to; p++) pages.push(p);
  if (to < total - 1) pages.push("…");
  pages.push(total);
  return pages;
};

/**
 * « ‹ › » with its name as a tooltip. When it can't be used it stays hoverable
 * (aria-disabled, not `disabled`, which swallows the hover) so the tooltip
 * still shows, over a greyed arrow, instead of looking broken.
 */
const PagerArrow = ({ label, off, onClick, children }) => (
  <button
    type="button"
    className="pzp-page pzp-arrow"
    aria-label={label}
    aria-disabled={off || undefined}
    data-tip={label}
    onClick={off ? undefined : onClick}
  >
    {children}
  </button>
);

/** The table's foot: rows per page, "1–10 of 48", and the page buttons. */
export const TablePager = ({ rowsPerPage, rowCount, currentPage, onChangePage, onChangeRowsPerPage, query }) => {
  const pages = Math.max(1, Math.ceil(rowCount / rowsPerPage));
  const first = rowCount ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const last = Math.min(rowCount, currentPage * rowsPerPage);
  const go = (p) => onChangePage(Math.min(pages, Math.max(1, p)), rowCount);
  return (
    <div className="pzp-pager">
      <div className="pzp-pager-left">
        <span>Rows per page</span>
        <select
          className="pzp-pager-size"
          aria-label="Rows per page"
          value={rowsPerPage}
          onChange={(e) => onChangeRowsPerPage(Number(e.target.value), currentPage)}
        >
          {ROWS_PER_PAGE.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="pzp-pager-range">
          {first}–{last} of {rowCount}
          {query ? ` matching “${query}”` : ""}
        </span>
      </div>
      <div className="pzp-pages">
        <PagerArrow label="First page" off={currentPage <= 1} onClick={() => go(1)}>
          «
        </PagerArrow>
        <PagerArrow label="Previous page" off={currentPage <= 1} onClick={() => go(currentPage - 1)}>
          ‹
        </PagerArrow>
        {pageList(currentPage, pages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="pzp-gap">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`pzp-page${p === currentPage ? " is-on" : ""}`}
              aria-current={p === currentPage ? "page" : undefined}
              data-tip={`Page ${p}`}
              onClick={() => go(p)}
            >
              {p}
            </button>
          )
        )}
        <PagerArrow label="Next page" off={currentPage >= pages} onClick={() => go(currentPage + 1)}>
          ›
        </PagerArrow>
        <PagerArrow label="Last page" off={currentPage >= pages} onClick={() => go(pages)}>
          »
        </PagerArrow>
      </div>
    </div>
  );
};

/**
 * Search and pages for a plain list of rows (the Rate card's tables): which
 * rows match the search, which of those are on this page, and the props for
 * TablePager. Only chooses what to SHOW — the rows themselves are drawn by the
 * page, unchanged. A new search, or a new page size, starts from page 1; a
 * page past the end (after a delete) falls back to the last one.
 */
export const useSearchPaging = (items, textOf, initialPerPage = 10) => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialPerPage);
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((it) => String(textOf(it) || "").toLowerCase().includes(q))
    : items;
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const current = Math.min(page, pages);
  const visible = shown.slice((current - 1) * perPage, current * perPage);
  // Rows deleted down to fewer pages: the page itself moves back too, so
  // rows added later do not send it forward to where it was.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return {
    query,
    search: (value) => {
      setQuery(value);
      setPage(1);
    },
    visible,
    matches: shown.length,
    // Shown under every table with rows, even a short one, so each table
    // reads the same and the rows-per-page choice is always there.
    showPager: items.length > 0,
    pagerProps: {
      rowsPerPage: perPage,
      rowCount: shown.length,
      currentPage: current,
      onChangePage: (p) => setPage(p),
      onChangeRowsPerPage: (n) => {
        setPerPage(n);
        setPage(1);
      },
      query: query.trim(),
    },
  };
};

/** The search box of the list pages, with its own clear ✕. */
export const SearchBox = ({ value, onChange, placeholder = "Search", label }) => (
  <span className="pzp-search">
    <SearchIcon />
    <input
      className="pzp-search-input"
      type="search"
      aria-label={label || placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    {value ? (
      <button type="button" className="pzp-search-clear" aria-label="Clear search" onClick={() => onChange("")}>
        <ClearIcon />
      </button>
    ) : null}
  </span>
);

/** Grey rows that shimmer while a list loads, instead of a blank table. */
export const TableSkeleton = ({ label = "Loading" }) => (
  <div className="pzp-skeleton" aria-label={label}>
    {[0, 1, 2, 3, 4].map((i) => (
      <div className="pzp-sk-row" key={i}>
        <div className="pzp-sk" style={{ width: 28, height: 28, borderRadius: "50%" }} />
        <div className="pzp-sk" style={{ flex: 2 }} />
        <div className="pzp-sk" style={{ flex: 1 }} />
        <div className="pzp-sk" style={{ flex: 1 }} />
        <div className="pzp-sk" style={{ width: 96, height: 24, borderRadius: 999 }} />
      </div>
    ))}
  </div>
);

/** Nothing to show: an icon, a line, and what to do about it. */
export const EmptyState = ({ title, hint, children }) => (
  <div className="pzp-empty">
    <div className="pzp-empty-icon">
      <Icon size={24}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </Icon>
    </div>
    <strong>{title}</strong>
    {hint ? <span>{hint}</span> : null}
    {children}
  </div>
);
