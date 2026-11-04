import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "@pazl/components/Dialog/dialog.css";
import { CategoriesService } from "@pazl/services/categoriesService";

interface EditCategoryModalProps {
  show: boolean;
  category: { id: string; name: string; parentCategoryId?: string | null } | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EditCategoryModal({
  show,
  category,
  onClose,
  onSuccess,
}: EditCategoryModalProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show || !category) return;
    setName(category.name || "");
    setError(null);
  }, [show, category]);

  if (!show || !category) return null;

  const handleUpdate = async () => {
    setError(null);
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Name is required.");
      return;
    }

    setBusy(true);
    try {
      await CategoriesService.updateCategory(category.id, {
        name: trimmed,
      });
      await CategoriesService.refreshCategoriesCache();
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to update category name.");
    } finally {
      setBusy(false);
    }
  };

  // Into <body>, like Add category, so no panel can clip it.
  return createPortal(
    <div
      className="pz-dlg-backdrop"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="pz-dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pz-editcat-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pz-dlg-head">
          <div className="pz-dlg-head-row">
            <span className="pz-dlg-badge" aria-hidden="true">
              <span className="material-symbols-outlined">edit</span>
            </span>
            <div>
              <h3 id="pz-editcat-title" className="pz-dlg-title">
                Rename category
              </h3>
              <p className="pz-dlg-sub">Change the name shown in the list.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pz-dlg-close"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="pz-dlg-body">
          <label className="pz-dlg-field">
            <span className="pz-dlg-label">
              Name <span className="pz-dlg-req">*</span>
            </span>
            <input
              type="text"
              className="block w-full"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Base Unit or Oil Pullout"
              disabled={busy}
              autoFocus
            />
          </label>

          {error && (
            <div className="pz-dlg-alert" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="pz-dlg-foot">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pz-dlg-btn pz-dlg-btn--ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={busy || !name.trim()}
            className="pz-dlg-btn pz-dlg-btn--primary"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default EditCategoryModal;
