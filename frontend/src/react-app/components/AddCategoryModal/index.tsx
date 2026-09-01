import React, { useEffect, useMemo, useState } from "react";
import { CategoriesService } from "@pazl/services/categoriesService";
import { Category } from "@pazl/entities/Category";
import SearchableSelect from "@pazl/components/SearchableSelect";

interface AddCategoryModalProps {
  show: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pre-select this parent in the dropdown (used by hover "+" per main). */
  presetParentId?: string | null;
}

const NONE_VALUE = "__none__";

function AddCategoryModal({
  show,
  onClose,
  onSuccess,
  presetParentId,
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
      presetParentId === null
        ? NONE_VALUE
        : presetParentId
        ? presetParentId
        : NONE_VALUE
    );
  }, [show, presetParentId]);

  const mainCategories = useMemo(
    () => allCategories.filter((c) => !c.parentCategoryId),
    [allCategories]
  );

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
      await CategoriesService.createCategory({
        name: trimmed,
        parentCategoryId: parentId === NONE_VALUE ? null : parentId,
      });
      await CategoriesService.refreshCategoriesCache();
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to create category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-[#333333] rounded-lg shadow-xl w-[420px] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="font-semibold text-base text-[#414063] dark:text-white">
            Add Category
          </h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-2xl leading-none text-neutral-500 hover:text-neutral-800 disabled:opacity-30"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block text-sm">
            <span className="text-neutral-600 dark:text-neutral-300">
              Name
            </span>
            <input
              type="text"
              className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Bedroom or Bed"
              disabled={busy}
              autoFocus
            />
          </label>

          <div className="block text-sm">
            <span className="text-neutral-600 dark:text-neutral-300">
              Parent
            </span>
            <div className="mt-1">
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
                  ...mainCategories.map((c) => ({
                    value: c._id,
                    label: `${c.name} (sub-category under this)`,
                  })),
                ]}
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-sm border rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="px-4 py-1.5 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddCategoryModal;
