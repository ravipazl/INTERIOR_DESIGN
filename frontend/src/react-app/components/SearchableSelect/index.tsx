import React, { useEffect, useMemo, useRef, useState } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional grouping label shown in muted text before the option label. */
  group?: string;
  /** Optional disabled state for the option. */
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  onChange: (newValue: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Hide the search input automatically when there are fewer than this many
   * options. Defaults to 5. Set to 0 to always show search.
   */
  searchThreshold?: number;
  /** Force show or hide the search input regardless of threshold. */
  showSearch?: boolean;
  /** Custom empty-state message when the search yields no results. */
  noResultsText?: string;
}

/**
 * Generic searchable dropdown. Use anywhere you'd otherwise use <select>.
 *
 *   <SearchableSelect
 *     value={pickedId}
 *     onChange={setPickedId}
 *     options={[{ value: "1", label: "Sofa", group: "LIVINGROOM" }, ...]}
 *     placeholder="— select —"
 *   />
 *
 * - Click trigger to open. Click outside to close.
 * - Type to filter (matches label OR group OR "group label").
 * - When fewer than `searchThreshold` options, search input is hidden.
 */
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "— select —",
  disabled = false,
  className = "",
  searchThreshold = 5,
  showSearch,
  noResultsText,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const g = (o.group || "").toLowerCase();
      const l = (o.label || "").toLowerCase();
      return g.includes(q) || l.includes(q) || `${g} ${l}`.includes(q);
    });
  }, [options, search]);

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const searchVisible =
    showSearch !== undefined ? showSearch : options.length >= searchThreshold;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center justify-between w-full border rounded px-2 py-1 text-left text-sm bg-white dark:bg-neutral-800 dark:text-white disabled:opacity-40"
      >
        <span
          className={
            selected
              ? "truncate"
              : "truncate text-neutral-400 dark:text-neutral-500"
          }
        >
          {selected ? (
            <>
              {selected.group ? (
                <span className="text-neutral-400 dark:text-neutral-500">
                  {selected.group} →{" "}
                </span>
              ) : null}
              {selected.label}
            </>
          ) : (
            placeholder
          )}
        </span>
        <span className="text-xs text-neutral-400 ml-2 shrink-0">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-50 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded shadow-lg">
          {searchVisible && (
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="block w-full px-2 py-1.5 text-sm border-b border-neutral-200 dark:border-neutral-700 focus:outline-none dark:bg-neutral-900 dark:text-white"
            />
          )}
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-xs text-neutral-500 text-center">
                {noResultsText ||
                  (search
                    ? `No matches for "${search}".`
                    : "No options available.")}
              </div>
            ) : (
              filtered.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`block w-full text-left px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-40 ${
                      isSelected
                        ? "bg-[#E9E5EC] dark:bg-neutral-600"
                        : ""
                    }`}
                  >
                    {o.group ? (
                      <span className="text-neutral-400 dark:text-neutral-500">
                        {o.group} →{" "}
                      </span>
                    ) : null}
                    <span>{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
