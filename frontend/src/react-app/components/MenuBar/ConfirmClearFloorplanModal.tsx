import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import "@pazl/components/Dialog/dialog.css";

const ConfirmClearFloorplanModal = ({
  showClearConfirmModal,
  onCloseClearConfirmModal,
  handleClear,
}: any) => {
  // Esc answers "no", as the old modal did. A click on the backdrop does not:
  // it stays a deliberate choice, as before (static backdrop).
  useEffect(() => {
    if (!showClearConfirmModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseClearConfirmModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showClearConfirmModal, onCloseClearConfirmModal]);

  if (!showClearConfirmModal) return null;
  return createPortal(
    <div className="pz-dlg-backdrop">
      <div
        className="pz-dlg pz-dlg--sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pz-clear-title"
        aria-describedby="pz-clear-desc"
      >
        <div className="pz-dlg-head">
          <div className="pz-dlg-head-row">
            <span className="pz-dlg-badge pz-dlg-badge--danger" aria-hidden="true">
              <span className="material-symbols-outlined">ink_eraser</span>
            </span>
            <h3 id="pz-clear-title" className="pz-dlg-title">
              Clear floor plan?
            </h3>
          </div>
        </div>
        <div className="pz-dlg-body">
          <p id="pz-clear-desc">
            This removes your existing floor plan and all of its saved data.
            It can't be undone.
          </p>
        </div>
        <div className="pz-dlg-foot">
          <button
            type="button"
            className="pz-dlg-btn pz-dlg-btn--ghost"
            onClick={onCloseClearConfirmModal}
            autoFocus
          >
            No, keep it
          </button>
          <button
            type="button"
            className="pz-dlg-btn pz-dlg-btn--danger"
            onClick={handleClear}
          >
            Yes, clear
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmClearFloorplanModal;
