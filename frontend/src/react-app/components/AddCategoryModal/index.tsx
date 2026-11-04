import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "@pazl/components/Dialog/dialog.css";
import { CategoriesService } from "@pazl/services/categoriesService";
import { Category } from "@pazl/entities/Category";
import SearchableSelect from "@pazl/components/SearchableSelect";

interface AddCategoryModalProps {
  show: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pre-select this parent in the dropdown (used by hover "+" per main). */
  presetParentId?: string | null;
  /** Only create a main (top-level) category: the Parent choice is hidden. */
  mainOnly?: boolean;
}

const NONE_VALUE = "__none__";

function AddCategoryModal({
  show,
  onClose,
  onSuccess,
  presetParentId,
  mainOnly = false,
}: AddCategoryModalProps) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>(NONE_VALUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!show) return;
    // Reload categories every time the modal opens — keeps the dropdown +
    // duplicate check in sync if the user added one a moment ago.
    const cats = CategoriesService.getCategoriesFromLocalStorage() || [];
    setAllCategories(cats);
    setName("");
    setError(null);
    setParentId(
      mainOnly || !presetParentId ? NONE_VALUE : presetParentId
    );
  }, [show, presetParentId, mainOnly]);

  const parentOptions = useMemo(() => {
    const getPath = (cat: Category): string => {
      if (!cat.parentCategoryId) return cat.name;
      const parent = allCategories.find((c) => c._id === cat.parentCategoryId);
      return parent ? `${getPath(parent)} → ${cat.name}` : cat.name;
    };
    return allCategories
      .slice()
      .sort((a, b) => getPath(a).localeCompare(getPath(b)))
      .map((c) => {
        const parentCat = c.parentCategoryId
          ? allCategories.find((p) => p._id === c.parentCategoryId)
          : null;
        return {
          value: c._id,
          group: parentCat ? getPath(parentCat) : undefined,
          label: c.name,
        };
      });
  }, [allCategories]);

  // Names already used at the same level (case-insensitive), for duplicate check
  const siblingNames = useMemo(() => {
    const wantParent = parentId === NONE_VALUE ? null : parentId;
    return new Set(
      allCategories
        .filter((c) => (c.parentCategoryId ?? null) === wantParent)
        .map((c) => (c.name || "").trim().toLowerCase())
    );
  }, [allCategories, parentId]);

  if (!show) return null;

  const handleCreate = async () => {
    setError(null);
    const trimmed = name.trim();

    // Validation 1: empty name
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    // Validation 2: duplicate name in the same parent
    if (siblingNames.has(trimmed.toLowerCase())) {
      setError(
        `A category named "${trimmed}" already exists at this level. Pick a different name.`
      );
      return;
    }

    setBusy(true);
    try {
      const parentVal = mainOnly || parentId === NONE_VALUE ? null : parentId;
      const created = await CategoriesService.createCategory({
        name: trimmed,
        parentCategoryId: parentVal,
      });
      await CategoriesService.refreshCategoriesCache();
      onSuccess(created?._id, parentVal);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to create category.");
    } finally {
      setBusy(false);
    }
  };

  // Into <body>, so the panel it is opened from (a fixed, stacked layer) can
  // never clip it or slide it under the toolbar.
  return createPortal(
    <div
      className="pz-dlg-backdrop"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="pz-dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pz-addcat-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pz-dlg-head">
          <div className="pz-dlg-head-row">
            <span className="pz-dlg-badge" aria-hidden="true">
              <span className="material-symbols-outlined">create_new_folder</span>
            </span>
            <div>
              <h3 id="pz-addcat-title" className="pz-dlg-title">
                {mainOnly ? "Add main category" : "Add category"}
              </h3>
              <p className="pz-dlg-sub">
                {mainOnly
                  ? "A new top-level group, like Kitchen or Bedroom."
                  : "A new group for models, under the parent you choose."}
              </p>
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
              placeholder={
                mainOnly ? "e.g. Dining Room" : "e.g. Glass Bottle or Shutter"
              }
              disabled={busy}
              autoFocus
            />
          </label>

          {mainOnly ? null : (
          <div className="pz-dlg-field">
            <span className="pz-dlg-label">Parent</span>
            <div>
              <SearchableSelect
                value={parentId}
                onChange={(v) => {
                  setParentId(v);
                  if (error) setError(null);
                }}
                disabled={busy}
                placeholder="— select parent —"
                showSearch
                options={[
                  {
                    value: NONE_VALUE,
                    label: "None — top-level (main) category",
                  },
                  ...parentOptions,
                ]}
              />
            </div>
          </div>
          )}

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
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="pz-dlg-btn pz-dlg-btn--primary"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AddCategoryModal;
