import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import TemplateCard from "./templateCard";
import {
  TemplateMenuProps,
  TemplateCardProps,
} from "../../../models/template.card";
import "./index.css";

const TemplateMenu: React.FC<TemplateMenuProps> = ({
  templateList,
  onTemplateSelect,
  isModalVisible,
  onHide,
  isFloorPlanCleared,
  onTemplateDelete,
}) => {
  // Which custom template the user is about to delete (drives the styled popup).
  const [pendingDelete, setPendingDelete] = useState<TemplateCardProps | null>(
    null
  );

  const confirmDelete = () => {
    if (pendingDelete) onTemplateDelete?.(String(pendingDelete.id));
    setPendingDelete(null);
  };

  // Esc closes, as the old modal did: the delete confirm first if it is open.
  useEffect(() => {
    if (!isModalVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingDelete) setPendingDelete(null);
      else onHide(e as any); // the only caller ignores the event
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isModalVisible, pendingDelete, onHide]);

  return (
    <>
      {isModalVisible &&
        createPortal(
          // A click on the backdrop closes it, as before.
          <div className="pz-tm-backdrop" onClick={onHide}>
            <div
              className="pz-tm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pz-tm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pz-tm-head">
                <div>
                  <h5 id="pz-tm-title" className="pz-tm-title">
                    Choose a floor plan
                  </h5>
                  <p className="pz-tm-sub">
                    Start from a ready-made room or one of your saved plans.
                  </p>
                </div>
                <button
                  type="button"
                  className="pz-tm-close"
                  aria-label="Close"
                  onClick={onHide}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <div className="pz-tm-list">
                {templateList.map((item) => (
                  <TemplateCard
                    key={item.id}
                    template={item}
                    onTemplateSelect={() => onTemplateSelect(item.url)}
                    onRequestDelete={(t) => setPendingDelete(t)}
                  />
                ))}
              </div>
              {!isFloorPlanCleared ? (
                <div className="pz-tm-warn" role="note">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                    <path d="M12 9v4M12 17h.01" />
                  </svg>
                  <span>
                    A floor plan already exists for this project. Choosing a
                    new one will clear your existing floor plan and all of its
                    saved data.
                  </span>
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )}

      {pendingDelete &&
        createPortal(
          <div
            className="pz-tm-backdrop pz-tm-backdrop--top"
            onClick={() => setPendingDelete(null)}
          >
            <div
              className="pz-tm pz-tm-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="pz-tm-del-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="pz-tm-del-title" className="pz-tm-title">
                Delete template
              </h3>
              <p className="pz-tm-sub">
                Delete <strong>"{pendingDelete.title}"</strong>? This can't be
                undone.
              </p>
              <div className="pz-tm-actions">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="pz-tm-btn pz-tm-btn--ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="pz-tm-btn pz-tm-btn--danger"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default TemplateMenu;
