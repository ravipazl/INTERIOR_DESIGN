import React, { useRef, useState } from "react";
import { roomPanelModalProps } from "@pazl/helpers/Types";
import { ModelsService } from "@pazl/services/ModelsService";
import {
  setDraggedModel,
  clearDraggedModel,
} from "@pazl/helpers/dragDropModel";
import { warmModelCache } from "@pazl/viewer3d-state-interface";

function RoomPanelModal({
  modalData,
  onAddItemToSceneClick,
  canDelete,
  onDelete,
  isDeleting,
}: roomPanelModalProps) {
  const [confirming, setConfirming] = useState(false);

  // Method 1 — in-app thumbnail upload. Kept fully local so no parent wiring
  // changes: the card shows its own preview and refreshes itself on upload.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [thumbSrc, setThumbSrc] = useState<string>(modalData?.thumbnail || "");
  const [imgError, setImgError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");

  const openFilePicker = () => fileInputRef.current?.click();

  const handleThumbnailSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file || !modalData?._id) return;
    setUploading(true);
    setUploadError("");
    try {
      const res = await ModelsService.uploadThumbnail(modalData._id, file);
      // cache-bust so the browser re-fetches the (possibly overwritten) file
      setThumbSrc(`${res.thumbnail}?t=${Date.now()}`);
      setImgError(false);
    } catch (err: any) {
      setUploadError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteClick = () => {
    if (!onDelete) return;
    setConfirming(true);
  };
  const cancelConfirm = () => setConfirming(false);
  const confirmDelete = () => {
    setConfirming(false);
    onDelete && onDelete();
  };

  return (
    // Coohom-style card: shows ONLY the image by default. Hovering reveals the
    // Upload Image + delete actions (top) and a detail overlay that slides up
    // (name, Width, price, + Add). Everything still works — the details just
    // appear on hover instead of always being visible.
    <div
      className="group relative w-[135px] h-[150px] m-1.5 rounded-lg overflow-hidden bg-neutral-50 dark:bg-[#3a3a3a] border border-neutral-100 dark:border-[#444444] shadow-sm"
      key={modalData?._id}
      // Pre-warm the GLB the moment the user hovers the card, so by the time
      // they click "+ Add" (or drag-drop) the model is already downloaded and
      // parsed — the item then appears instantly instead of after a white-box
      // wait. Best-effort and a no-op on a cache hit, so hovering is cheap.
      onMouseEnter={() => {
        try {
          warmModelCache(modalData);
        } catch (_) {
          /* non-fatal */
        }
      }}
      // Drag-to-place: pick up this model, then drop it onto the 3D canvas to
      // add it at that spot. The "+ Add" button (on hover) still works too.
      draggable
      onDragStart={(e) => {
        setDraggedModel(modalData);
        try {
          e.dataTransfer.setData("text/plain", "pazl-model");
          e.dataTransfer.effectAllowed = "copy";
        } catch (_) {
          /* some browsers restrict dataTransfer — non-fatal */
        }
      }}
      onDragEnd={() => clearDraggedModel()}
    >
      {/* Clean image tile (default view) */}
      {thumbSrc && !imgError ? (
        <img
          className="w-full h-full object-contain p-2 transition-transform duration-200 group-hover:scale-105"
          src={thumbSrc}
          alt={modalData?._id}
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[11px] text-neutral-400">
          No preview
        </div>
      )}

      {/* Hidden file input for the thumbnail upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={handleThumbnailSelected}
      />

      {/* Top-corner actions — appear on hover: Upload Image + delete × */}
      <div className="absolute top-1 left-1 right-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity z-20">
        <button
          type="button"
          onClick={openFilePicker}
          disabled={uploading}
          title="Upload or change preview image"
          className="px-1.5 h-6 rounded-full flex items-center justify-center bg-white/90 hover:bg-neutral-50 text-[#414063] border border-neutral-200 shadow-sm text-[10px] disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Upload Image"}
        </button>
        {canDelete && !confirming && (
          <button
            type="button"
            title="Delete from catalog"
            disabled={isDeleting}
            onClick={handleDeleteClick}
            className="w-6 h-6 rounded-full flex items-center justify-center bg-white/90 hover:bg-red-50 text-red-500 border border-red-200 shadow-sm disabled:opacity-40"
          >
            ×
          </button>
        )}
      </div>
      {uploadError && (
        <p className="absolute top-8 left-1 z-20 text-[10px] text-red-500 max-w-[90%]">
          {uploadError}
        </p>
      )}

      {/* Bottom detail overlay — slides up on hover: name, Width, price, + Add.
          Forced visible while confirming a delete so the buttons are reachable. */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-white/95 dark:bg-[#2b2b2b]/95 px-2 pt-1.5 pb-2 transition-transform duration-200 z-20 ${
          confirming
            ? "translate-y-0"
            : "translate-y-full group-hover:translate-y-0"
        }`}
      >
        {confirming ? (
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[11px] text-red-600 text-center leading-tight">
              Delete this model?
            </p>
            <div className="flex gap-2">
              <button
                onClick={cancelConfirm}
                disabled={isDeleting}
                className="rounded-lg px-2 py-0.5 text-[11px] border border-neutral-300 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="rounded-lg px-2 py-0.5 text-[11px] bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <h5
              className="text-[11px] font-semibold text-center leading-tight text-neutral-800 dark:text-neutral-50 w-full truncate"
              title={modalData?.name}
            >
              {modalData?.name?.toUpperCase()}
            </h5>
            <div className="flex items-center gap-1 text-[10px] text-neutral-600 dark:text-neutral-200">
              <span>Width</span>
              <select className="text-[10px] focus:outline-none bg-transparent dark:bg-[#2b2b2b]">
                {(Array.isArray(modalData?.standardWidth)
                  ? modalData.standardWidth
                  : []
                ).map((option, index) => (
                  <option key={index}>{option} mm</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] font-medium text-[#414063] dark:text-neutral-100">
              ₹ {modalData?.price} / Sq.ft
            </p>
            <button
              onClick={onAddItemToSceneClick}
              disabled={isDeleting}
              className="mt-0.5 rounded-lg px-3 py-0.5 text-[11px] bg-[#414063] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#414063] disabled:opacity-40"
            >
              + Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoomPanelModal;
