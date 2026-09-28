import React, { useEffect, useState } from "react";
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
            Edit Category / Title Name
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
            <span className="text-neutral-600 dark:text-neutral-300 font-medium">
              Title Name
            </span>
            <input
              type="text"
              className="mt-1.5 block w-full border rounded px-3 py-1.5 dark:bg-neutral-800 dark:text-white text-sm"
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
            onClick={handleUpdate}
            disabled={busy || !name.trim()}
            className="px-4 py-1.5 text-sm rounded bg-[#414063] text-white disabled:opacity-40 font-medium"
          >
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditCategoryModal;
