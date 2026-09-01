import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box3, Vector3 } from "three";
import BlueprintInterface from "@pazl/blueprint-interface";
import { ModelsService } from "@pazl/services/ModelsService";
import { generateAndUploadThumbnail } from "@pazl/helpers/generateThumbnail";
import { CategoriesService } from "@pazl/services/categoriesService";
import { Category } from "@pazl/entities/Category";

interface UploadModelModalProps {
  show: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** If omitted/empty, the modal renders a category picker. */
  categoryId?: string;
  categoryName?: string;
  defaultType?: number;
}

type FileItem = {
  file: File;
  name: string;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
};

// Re-use the shared PLACEMENT_OPTIONS so Upload / Search / Generate stay
// in sync. The old local 3-option list mislabelled type 3 as "Tall" — it's
// actually IN_WALL (embedded), and there was no entry for ceiling-mounted.
import {
  PLACEMENT_OPTIONS,
  guessPlacementType,
} from "@pazl/helpers/guessModelType";
const TYPE_OPTIONS = PLACEMENT_OPTIONS.map((o) => ({
  value: o.value,
  label: `${o.label} — ${o.hint}`,
}));

function UploadModelModal({
  show,
  onClose,
  onSuccess,
  categoryId,
  categoryName,
  defaultType = 1,
}: UploadModelModalProps) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [type, setType] = useState<number>(defaultType);
  const [width, setWidth] = useState<number>(450);
  const [height, setHeight] = useState<number>(600);
  const [depth, setDepth] = useState<number>(600);
  const [meshCount, setMeshCount] = useState<number>(0);
  const [measuring, setMeasuring] = useState<boolean>(false);
  const [measured, setMeasured] = useState<boolean>(false);
  const [price, setPrice] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);
  const [summary, setSummary] = useState<string>("");
  // For toolbar uploads where no category is preselected, the user picks here.
  const [pickedCategoryId, setPickedCategoryId] = useState<string>(categoryId || "");
  const [allCategories, setAllCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!show) return;
    const cats = CategoriesService.getCategoriesFromLocalStorage() || [];
    setAllCategories(cats);
    // Reset picker to provided categoryId each time modal opens.
    setPickedCategoryId(categoryId || "");
    setItems([]);
    setSummary("");
    setMeasured(false);
    setMeasuring(false);
    setMeshCount(0);
  }, [show, categoryId]);

  const subCategories = useMemo(
    () => allCategories.filter((c) => !!c.parentCategoryId),
    [allCategories]
  );
  const mainCategoryName = (subCat: Category) =>
    allCategories.find((c) => c._id === subCat.parentCategoryId)?.name || "";

  // --- searchable category dropdown state ---
  const [catSearch, setCatSearch] = useState("");
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const catBoxRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!catDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        catBoxRef.current &&
        !catBoxRef.current.contains(e.target as Node)
      ) {
        setCatDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [catDropdownOpen]);

  const sortedSubCategories = useMemo(
    () =>
      subCategories.slice().sort((a, b) => {
        const am = mainCategoryName(a);
        const bm = mainCategoryName(b);
        if (am !== bm) return am.localeCompare(bm);
        return (a.name || "").localeCompare(b.name || "");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subCategories, allCategories]
  );

  const filteredCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return sortedSubCategories;
    return sortedSubCategories.filter((c) => {
      const m = mainCategoryName(c).toLowerCase();
      const n = (c.name || "").toLowerCase();
      return m.includes(q) || n.includes(q) || `${m} ${n}`.includes(q);
    });
  }, [sortedSubCategories, catSearch, allCategories]);

  const selectedCategoryLabel = useMemo(() => {
    if (!pickedCategoryId) return "";
    const c = allCategories.find((x) => x._id === pickedCategoryId);
    if (!c) return "";
    return `${mainCategoryName(c)} → ${c.name}`;
  }, [pickedCategoryId, allCategories]);

  if (!show) return null;

  // When called from toolbar (no categoryId prop), require user to pick one.
  const needsCategoryPicker = !categoryId;
  const effectiveCategoryId = categoryId || pickedCategoryId;
  const canUpload =
    items.filter((it) => it.status !== "done").length > 0 &&
    !!effectiveCategoryId;

  // Best-effort: read the real Width / Height / Depth straight from the GLB so
  // the user doesn't have to type them. glTF's standard unit is the metre and
  // Y is up, so size(m) × 1000 = mm. Results are clamped to a sane furniture
  // range (10 mm – 5 m); anything outside means an odd export (wrong units /
  // axis) → we keep the defaults and let the user type. The three boxes stay
  // editable either way, so this never blocks an upload.
  const measureGlbDimensions = async (file: File) => {
    const loader: any = (BlueprintInterface as any)?.GLTFLoader;
    if (!loader || typeof loader.parse !== "function") return;
    setMeasuring(true);
    setMeasured(false);
    try {
      const buffer = await file.arrayBuffer();
      const gltf: any = await new Promise((resolve, reject) =>
        loader.parse(buffer, "", resolve, reject)
      );
      // Count the model's meshes (same recursive order the engine names them
      // Mesh_0, Mesh_1, …). Sent to the backend so it can create one editable
      // component per mesh, so uploaded models get modifiable materials like
      // the built-in ones. Purely informational — never blocks the upload.
      let meshes = 0;
      gltf.scene.traverse((o: any) => {
        if (o.isMesh) meshes += 1;
      });
      setMeshCount(meshes);
      const size = new Box3()
        .setFromObject(gltf.scene)
        .getSize(new Vector3());
      const toMm = (u: number) => Math.round(u * 1000);
      const w = toMm(size.x);
      const h = toMm(size.y);
      const d = toMm(size.z);
      const sane = (v: number) => Number.isFinite(v) && v >= 10 && v <= 5000;
      if (sane(w) && sane(h) && sane(d)) {
        setWidth(w);
        setHeight(h);
        setDepth(d);
        setMeasured(true);
      }
    } catch (_) {
      /* measurement is optional — user can type the values */
    } finally {
      setMeasuring(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const isFirstBatch = items.length === 0;
    const next: FileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.name.toLowerCase().endsWith(".glb")) continue;
      next.push({
        file: f,
        name: f.name.replace(/\.glb$/i, ""),
        status: "queued",
        progress: 0,
      });
    }
    setItems((prev) => {
      const merged = [...prev, ...next];
      // Auto-guess placement type from the FIRST file's name only when
      // the user hasn't already overridden it from the default.
      if (!prev.length && next.length && type === defaultType) {
        setType(guessPlacementType(next[0].name));
      }
      return merged;
    });
    // Auto-measure W/H/D from the first uploaded model (best-effort).
    if (isFirstBatch && next.length) {
      void measureGlbDimensions(next[0].file);
    }
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const renameItem = (idx: number, newName: string) => {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, name: newName } : it))
    );
  };

  const uploadAll = async () => {
    if (!items.length || busy) return;
    setBusy(true);
    let okCount = 0;
    let failCount = 0;
    // Collect created models so we can auto-generate a catalog preview for each
    // after the uploads finish (uploaded GLBs save with an empty thumbnail).
    const created: { id: string; url: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") {
        okCount++;
        continue;
      }
      setItems((prev) =>
        prev.map((it, idx) =>
          idx === i ? { ...it, status: "uploading", progress: 0 } : it
        )
      );
      try {
        const res: any = await ModelsService.uploadGlb({
          file: items[i].file,
          name: items[i].name,
          categoryId: effectiveCategoryId,
          type,
          width,
          height,
          depth,
          meshCount,
          price,
          onProgress: (pct) => {
            setItems((prev) =>
              prev.map((it, idx) =>
                idx === i ? { ...it, progress: pct } : it
              )
            );
          },
        });
        if (res?._id && res?.modelFileUrl) {
          created.push({ id: String(res._id), url: res.modelFileUrl });
        }
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: "done", progress: 100 } : it
          )
        );
        okCount++;
      } catch (e: any) {
        const msg =
          e?.response?.data?.message || e?.message || "Upload failed";
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: "error", error: msg } : it
          )
        );
        failCount++;
      }
    }

    setBusy(false);
    setSummary(`${okCount} uploaded${failCount ? `, ${failCount} failed` : ""}`);
    if (okCount > 0) onSuccess();
    // Auto-generate previews for the just-uploaded models, then refresh again so
    // the thumbnails appear in the catalog (best-effort, never blocks the flow).
    if (created.length) {
      Promise.all(
        created.map((c) => generateAndUploadThumbnail(c.id, c.url).catch(() => false))
      )
        .then((oks) => {
          if (oks.some(Boolean)) onSuccess();
        })
        .catch(() => {});
    }
  };

  const queued = items.filter((it) => it.status !== "done").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-[#333333] rounded-lg shadow-xl w-[640px] max-w-[95vw] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="font-semibold text-base text-[#414063] dark:text-white">
            Upload custom GLB models
            {categoryName ? (
              <span className="font-normal text-sm text-neutral-500 ml-2">
                → {categoryName}
              </span>
            ) : null}
            {!categoryName && effectiveCategoryId ? (
              <span className="font-normal text-sm text-neutral-500 ml-2">
                → {allCategories.find((c) => c._id === effectiveCategoryId)?.name || ""}
              </span>
            ) : null}
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
          {/* Category picker — only when no categoryId was passed in (toolbar mode) */}
          {needsCategoryPicker && (
            <div className="block text-sm" ref={catBoxRef}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-neutral-700 dark:text-neutral-200 font-semibold">
                  Target category{" "}
                  <span className="text-red-500" title="Required">
                    *
                  </span>
                </span>
                {effectiveCategoryId ? (
                  <span className="text-xs text-green-700 dark:text-green-300">
                    ✓ selected
                  </span>
                ) : (
                  <span className="text-xs text-red-500">Required</span>
                )}
              </div>
              {/* Trigger button — shows current selection, opens dropdown */}
              <button
                type="button"
                onClick={() => !busy && setCatDropdownOpen((v) => !v)}
                disabled={busy}
                className={`flex items-center justify-between w-full border rounded px-2 py-1 text-left bg-white dark:bg-neutral-800 dark:text-white disabled:opacity-40 ${
                  effectiveCategoryId
                    ? ""
                    : "ring-2 ring-red-400 dark:ring-red-500"
                }`}
              >
                <span
                  className={
                    selectedCategoryLabel
                      ? ""
                      : "text-neutral-400 dark:text-neutral-500"
                  }
                >
                  {selectedCategoryLabel || "— select a category —"}
                </span>
                <span className="text-xs text-neutral-400 ml-2">
                  {catDropdownOpen ? "▲" : "▼"}
                </span>
              </button>

              {/* Dropdown — search + filtered list */}
              {catDropdownOpen && (
                <div className="relative">
                  <div className="absolute left-0 right-0 mt-1 z-10 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded shadow-lg">
                    <input
                      type="text"
                      autoFocus
                      value={catSearch}
                      onChange={(e) => setCatSearch(e.target.value)}
                      placeholder="Search… e.g. sofa, kitchen, bottle"
                      className="block w-full px-2 py-1.5 text-sm border-b border-neutral-200 dark:border-neutral-700 focus:outline-none dark:bg-neutral-900 dark:text-white"
                    />
                    <div className="max-h-60 overflow-y-auto">
                      {filteredCategories.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-neutral-500 text-center">
                          No categories match "{catSearch}".
                        </div>
                      ) : (
                        filteredCategories.map((c) => {
                          const isSelected = c._id === pickedCategoryId;
                          return (
                            <button
                              key={c._id}
                              type="button"
                              onClick={() => {
                                setPickedCategoryId(c._id);
                                setCatDropdownOpen(false);
                                setCatSearch("");
                              }}
                              className={`block w-full text-left px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                                isSelected
                                  ? "bg-[#E9E5EC] dark:bg-neutral-600"
                                  : ""
                              }`}
                            >
                              <span className="text-neutral-400 dark:text-neutral-500">
                                {mainCategoryName(c)} →{" "}
                              </span>
                              <span>{c.name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!pickedCategoryId && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  The uploaded model is saved under this category. You can't
                  upload without picking one.
                </p>
              )}
              {pickedCategoryId && (
                <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                  Will be saved under{" "}
                  <span className="font-semibold">
                    {(() => {
                      const c = allCategories.find(
                        (x) => x._id === pickedCategoryId
                      );
                      if (!c) return "?";
                      const m =
                        allCategories.find((x) => x._id === c.parentCategoryId)
                          ?.name || "";
                      return m ? `${m} → ${c.name}` : c.name;
                    })()}
                  </span>
                  .
                </p>
              )}
            </div>
          )}

          {/* File picker */}
          <label className="block">
            <div className="border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg p-6 text-center cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                Click to choose one or more <code>.glb</code> files
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                Multiple files supported. Max 25 MB each.
              </p>
              <input
                type="file"
                accept=".glb,model/gltf-binary"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          </label>

          {/* Dimensions (mm) — auto-measured from the GLB, all editable. */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-300">
                Dimensions (mm)
              </span>
              {measuring ? (
                <span className="text-xs text-blue-500">measuring…</span>
              ) : measured ? (
                <span className="text-xs text-green-600 dark:text-green-400">
                  ✓ auto-filled from your model — edit if needed
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  Width
                </span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                  value={width === 0 ? "" : width}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      setWidth(0);
                      return;
                    }
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) setWidth(n);
                  }}
                  onBlur={() => {
                    if (!width) setWidth(450);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  Height
                </span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                  value={height === 0 ? "" : height}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      setHeight(0);
                      return;
                    }
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) setHeight(n);
                  }}
                  onBlur={() => {
                    if (!height) setHeight(600);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  Depth
                </span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                  value={depth === 0 ? "" : depth}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      setDepth(0);
                      return;
                    }
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) setDepth(n);
                  }}
                  onBlur={() => {
                    if (!depth) setDepth(600);
                  }}
                  disabled={busy}
                />
              </label>
            </div>
          </div>

          {/* Placement type + price */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">Type</span>
              <select
                className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                value={type}
                onChange={(e) => setType(Number(e.target.value))}
                disabled={busy}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">
                Price (₹)
              </span>
              <input
                type="number"
                min={0}
                className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                value={price === 0 ? "" : price}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setPrice(0);
                    return;
                  }
                  const n = Number(v);
                  if (Number.isFinite(n) && n >= 0) setPrice(n);
                }}
                disabled={busy}
              />
            </label>
          </div>

          {/* File list */}
          {items.length > 0 && (
            <div className="border rounded divide-y divide-neutral-200 dark:divide-neutral-700">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <input
                    className="flex-1 min-w-0 border rounded px-2 py-1 text-sm dark:bg-neutral-800 dark:text-white"
                    value={it.name}
                    onChange={(e) => renameItem(idx, e.target.value)}
                    disabled={busy || it.status !== "queued"}
                  />
                  <div className="w-28 text-xs text-neutral-500">
                    {(it.file.size / 1024).toFixed(0)} KB
                  </div>
                  <div className="w-40">
                    {it.status === "queued" && (
                      <span className="text-neutral-400 text-xs">queued</span>
                    )}
                    {it.status === "uploading" && (
                      <div className="w-full h-2 bg-neutral-200 rounded">
                        <div
                          className="h-2 bg-blue-500 rounded transition-all"
                          style={{ width: `${it.progress}%` }}
                        />
                      </div>
                    )}
                    {it.status === "done" && (
                      <span className="text-green-600 text-xs">✓ done</span>
                    )}
                    {it.status === "error" && (
                      <span className="text-red-600 text-xs" title={it.error}>
                        ✗ {it.error?.slice(0, 30) || "failed"}
                      </span>
                    )}
                  </div>
                  {!busy && it.status === "queued" && (
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-neutral-400 hover:text-red-500 text-xs"
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {summary && (
            <div className="text-sm text-neutral-600 dark:text-neutral-300">
              {summary}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-sm border rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            Close
          </button>
          <button
            onClick={uploadAll}
            disabled={busy || !canUpload}
            className="px-4 py-1.5 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
            title={
              !effectiveCategoryId
                ? "Select a target category first"
                : queued === 0
                ? "Add at least one .glb file"
                : ""
            }
          >
            {busy
              ? "Uploading…"
              : queued > 0
              ? `Upload ${queued} file${queued === 1 ? "" : "s"}`
              : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UploadModelModal;
