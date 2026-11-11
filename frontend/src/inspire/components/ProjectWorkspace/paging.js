import { useState } from "react";
import { ROWS_PER_PAGE } from "../PzTable";

/**
 * Rows-per-page for one list (a workspace tab, the renders grid…), remembered
 * in this browser under `pz.ws.rows.<key>`. 10 until changed.
 */
const STORE = "pz.ws.rows.";

export const readRows = (key) => {
  try {
    const n = Number(window.localStorage.getItem(STORE + key));
    return ROWS_PER_PAGE.includes(n) ? n : 10;
  } catch {
    return 10;
  }
};

export const saveRows = (key, n) => {
  try {
    window.localStorage.setItem(STORE + key, String(n));
  } catch {
    /* not remembered this time; the page size still applies now */
  }
};

/** Page + rows-per-page state for one list; changing the size goes to page 1. */
export const usePaging = (key) => {
  const [page, setPage] = useState(1);
  const [rows, setRowsState] = useState(() => readRows(key));
  const setRows = (n) => {
    setRowsState(n);
    setPage(1);
    saveRows(key, n);
  };
  return { page, setPage, rows, setRows };
};
