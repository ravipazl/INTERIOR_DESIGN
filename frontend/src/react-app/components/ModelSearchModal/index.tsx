import React, { useEffect, useMemo, useRef, useState } from "react";
import { ModelsService } from "@pazl/services/ModelsService";
import { generateAndUploadThumbnail } from "@pazl/helpers/generateThumbnail";
import { CategoriesService } from "@pazl/services/categoriesService";
import { Category } from "@pazl/entities/Category";
import SearchableSelect from "@pazl/components/SearchableSelect";
import {
  PLACEMENT_OPTIONS,
  PLACEMENT_TYPE,
  guessPlacementType,
} from "@pazl/helpers/guessModelType";

/**
 * ModelSearchModal — Search the Sketchfab catalog from inside the app,
 * pick a model, choose a target category, and import it. The backend
 * downloads the GLB, decodes EXT_meshopt_compression with gltf-transform
 * (three.js r0.118 cannot read meshopt), optionally strips textures, saves
 * the file, and inserts a `models` row. We poll the status endpoint and
 * call onSuccess() once the imported model lands in the catalog.
 *
 * Modelled on GenerateFromPhotoModal so the UX feels consistent with the
 * other "add a model" entry points (Upload, Generate, Search).
 */

interface ModelSearchModalProps {
  show: boolean;
  onClose: () => void;
  onSuccess: (newModelId: string) => void;
}

// User-facing names for the three model providers. The providers themselves
// are deliberately not named in the UI — every visible label goes through this
// map. The KEYS are the real `source` identifiers and must never change: they
// drive the ModelsService calls (searchSketchfab / browseObjaverse / ...) and
// the per-source behaviour below. Only the VALUES are display text, so these
// can be re-worded freely without touching any logic.
const CATALOG_LABEL = {
  sketchfab: "Catalog A",
  polyhaven: "Catalog B",
  objaverse: "Catalog C",
} as const;

type SketchfabResult = {
  uid: string;
  name: string;
  thumbnail: string;
  author: string;
  authorProfile: string;
  viewerUrl: string;
  license: string;
  licenseUrl: string;
  faceCount: number;
  animationCount: number;
  sizeBytes: number | null;
};

type Stage =
  | "idle"
  | "searching"
  | "searched"
  | "submitting"
  | "queued"
  | "fetching_url"
  | "downloading_glb"
  | "decoding"
  | "saving"
  | "done"
  | "error";

const POLL_MS = 2000;

function formatFaceCount(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(b: number | null): string {
  if (!b) return "";
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

function ModelSearchModal({
  show,
  onClose,
  onSuccess,
}: ModelSearchModalProps) {
  // search
  const [source, setSource] = useState<
    "sketchfab" | "polyhaven" | "objaverse"
  >("sketchfab");
  const [query, setQuery] = useState("");
  // Objaverse has no keyword search — it browses by category. These hold the
  // category list (loaded on first switch) and the currently-picked one.
  const [objaverseCats, setObjaverseCats] = useState<
    { category: string; label: string; count: number }[]
  >([]);
  const [objaverseCat, setObjaverseCat] = useState("");
  const [results, setResults] = useState<SketchfabResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Pagination for the Load-more button (Sketchfab). `nextCursor` is an opaque
  // next-page token; null means no more pages.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // selection / import form
  const [selected, setSelected] = useState<SketchfabResult | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [stripTextures, setStripTextures] = useState(true);
  const [placementType, setPlacementType] = useState<number>(
    PLACEMENT_TYPE.FLOOR
  );

  // categories (for the dropdown)
  const [allCategories, setAllCategories] = useState<Category[]>([]);

  // job tracking
  const [stage, setStage] = useState<Stage>("idle");
  const [stageDetail, setStageDetail] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollTimer = useRef<any>(null);
  const startedAt = useRef<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const tickTimer = useRef<any>(null);

  // reset whenever the modal opens
  useEffect(() => {
    if (!show) return;
    const cats = CategoriesService.getCategoriesFromLocalStorage() || [];
    setAllCategories(cats);
    setSource("sketchfab");
    setQuery("");
    setObjaverseCat("");
    setResults([]);
    setSearchError(null);
    setSelected(null);
    setDisplayName("");
    setCategoryId("");
    setStripTextures(true);
    setPlacementType(PLACEMENT_TYPE.FLOOR);
    setStage("idle");
    setStageDetail("");
    setError(null);
    setJobId(null);
    setElapsedSec(0);
  }, [show]);

  // cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (tickTimer.current) clearInterval(tickTimer.current);
    };
  }, []);

  const subCategories = useMemo(
    () => allCategories.filter((c) => !!c.parentCategoryId),
    [allCategories]
  );
  const mainName = (sub: Category) =>
    allCategories.find((c) => c._id === sub.parentCategoryId)?.name || "";

  const isSearching = stage === "searching";
  const isImporting =
    stage === "submitting" ||
    stage === "queued" ||
    stage === "fetching_url" ||
    stage === "downloading_glb" ||
    stage === "decoding" ||
    stage === "saving";

  if (!show) return null;

  const startTicker = () => {
    startedAt.current = Date.now();
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
  };
  const stopTicker = () => {
    if (tickTimer.current) {
      clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearchError(null);
    setResults([]);
    setSelected(null);
    setNextCursor(null);
    setStage("searching");
    try {
      const { results, next } =
        source === "polyhaven"
          ? await ModelsService.searchPolyHaven({ query: q, count: 24 })
          : await ModelsService.searchSketchfab({ query: q, count: 24 });
      setResults(results);
      setNextCursor(next);
      setStage("searched");
      if (!results.length) setSearchError("No downloadable models found.");
    } catch (e: any) {
      setStage("error");
      setSearchError(e?.message || "Search failed");
    }
  };

  // Objaverse: load the category list (once) when the user switches to it.
  const ensureObjaverseCategories = async () => {
    if (objaverseCats.length) return;
    try {
      const cats = await ModelsService.getObjaverseCategories();
      setObjaverseCats(cats);
    } catch (e: any) {
      setSearchError(
        e?.message || `Could not load ${CATALOG_LABEL.objaverse} categories`
      );
    }
  };

  // Objaverse: browse one category (replaces keyword search).
  const runBrowse = async (category: string) => {
    if (!category) return;
    setSearchError(null);
    setResults([]);
    setSelected(null);
    setNextCursor(null);
    setStage("searching");
    try {
      const { results, next } = await ModelsService.browseObjaverse({ category });
      setResults(results);
      setNextCursor(next);
      setStage("searched");
      if (!results.length) setSearchError("No models in this category.");
    } catch (e: any) {
      setStage("error");
      setSearchError(e?.message || "Browse failed");
    }
  };

  // Load-more: fetch the next page (Sketchfab cursor / Objaverse start offset —
  // Poly Haven returns all at once, so nextCursor stays null there) and append.
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { results, next } =
        source === "objaverse"
          ? await ModelsService.browseObjaverse({
              category: objaverseCat,
              start: nextCursor,
            })
          : await ModelsService.searchSketchfab({
              query: query.trim(),
              count: 24,
              cursor: nextCursor,
            });
      setResults((prev) => [...prev, ...results]);
      setNextCursor(next);
    } catch (e: any) {
      setSearchError(e?.message || "Could not load more results");
    } finally {
      setLoadingMore(false);
    }
  };

  const beginPoll = (id: string) => {
    const tick = async () => {
      try {
        const data: any =
          source === "polyhaven"
            ? await ModelsService.pollPolyHavenImportStatus(id)
            : source === "objaverse"
            ? await ModelsService.pollObjaverseImportStatus(id)
            : await ModelsService.pollSketchfabImportStatus(id);
        const s: string = data?.stage || "queued";
        setStageDetail(s);
        if (
          s === "fetching_url" ||
          s === "downloading_glb" ||
          s === "decoding" ||
          s === "saving" ||
          s === "queued"
        ) {
          setStage(s as Stage);
        } else if (s === "done") {
          setStage("done");
          stopTicker();
          const newId: string = data.result?.modelId;
          const fileUrl: string = data.result?.modelFileUrl;
          if (newId) onSuccess(newId);
          // Auto-generate the catalog preview from the imported GLB, then
          // refresh again so the thumbnail appears without a manual upload.
          if (newId && fileUrl) {
            generateAndUploadThumbnail(newId, fileUrl)
              .then((ok) => {
                if (ok) onSuccess(newId);
              })
              .catch(() => {});
          }
          return;
        } else if (s === "error") {
          setStage("error");
          setError(data?.error || "Unknown error");
          stopTicker();
          return;
        }
        pollTimer.current = setTimeout(tick, POLL_MS);
      } catch (e: any) {
        setStage("error");
        setError(e?.message || "Polling failed");
        stopTicker();
      }
    };
    tick();
  };

  const runImport = async () => {
    if (!selected) {
      setError("Pick a model from the results first.");
      return;
    }
    if (!categoryId) {
      setError("Pick a target category.");
      return;
    }
    setError(null);
    setStage("submitting");
    startTicker();
    try {
      const resp =
        source === "polyhaven"
          ? await ModelsService.startPolyHavenImport({
              id: selected.uid,
              categoryId,
              name: displayName.trim() || selected.name || undefined,
              stripTextures,
              type: placementType,
              credit: {
                author: selected.author,
                viewerUrl: selected.viewerUrl,
              },
            })
          : source === "objaverse"
          ? await ModelsService.startObjaverseImport({
              uid: selected.uid,
              categoryId,
              name: displayName.trim() || selected.name || undefined,
              stripTextures,
              type: placementType,
            })
          : await ModelsService.startSketchfabImport({
              uid: selected.uid,
              categoryId,
              name: displayName.trim() || selected.name || undefined,
              stripTextures,
              type: placementType,
              credit: {
                author: selected.author,
                authorProfile: selected.authorProfile,
                viewerUrl: selected.viewerUrl,
                license: selected.license,
                licenseUrl: selected.licenseUrl,
              },
            });
      setJobId(resp.jobId);
      setStage("queued");
      setStageDetail("queued");
      beginPoll(resp.jobId);
    } catch (e: any) {
      setStage("error");
      setError(e?.message || "Failed to start import");
      stopTicker();
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  };

  const onResultClick = (r: SketchfabResult) => {
    if (isImporting) return;
    setSelected(r);
    setDisplayName(r.name || "");
    // Auto-guess placement type from the model name (e.g. "AC" → Wall).
    // The user can override before clicking Add to catalog.
    setPlacementType(guessPlacementType(r.name || query));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={isImporting ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-[#333333] rounded-lg shadow-xl w-[820px] max-w-[96vw] max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="font-semibold text-base text-[#414063] dark:text-white">
            {/* The providers are shown as neutral catalog names — see
                CATALOG_LABEL below. Only the visible text is renamed; the
                `source` values and every ModelsService call still use the real
                provider identifiers. */}
            {source === "polyhaven"
              ? `Search ${CATALOG_LABEL.polyhaven}`
              : source === "objaverse"
              ? `Browse ${CATALOG_LABEL.objaverse}`
              : `Search ${CATALOG_LABEL.sketchfab}`}
          </h3>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="text-2xl leading-none text-neutral-500 hover:text-neutral-800 disabled:opacity-30"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* source toggle — pick which library to search */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-300">
              Source
            </span>
            <div className="inline-flex rounded border border-neutral-300 dark:border-neutral-600 overflow-hidden">
              <button
                type="button"
                disabled={isImporting}
                onClick={() => {
                  setSource("sketchfab");
                  setResults([]);
                  setSelected(null);
                  setSearchError(null);
                  setStripTextures(true);
                }}
                className={`px-3 py-1 text-xs disabled:opacity-40 ${
                  source === "sketchfab"
                    ? "bg-[#414063] text-white"
                    : "bg-transparent text-neutral-600 dark:text-neutral-300"
                }`}
              >
                {CATALOG_LABEL.sketchfab}
              </button>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => {
                  setSource("polyhaven");
                  setResults([]);
                  setSelected(null);
                  setSearchError(null);
                  // Poly Haven's value is its CC0 textures — keep them.
                  setStripTextures(false);
                }}
                className={`px-3 py-1 text-xs border-l border-neutral-300 dark:border-neutral-600 disabled:opacity-40 ${
                  source === "polyhaven"
                    ? "bg-[#414063] text-white"
                    : "bg-transparent text-neutral-600 dark:text-neutral-300"
                }`}
              >
                {CATALOG_LABEL.polyhaven}
              </button>
              <button
                type="button"
                disabled={isImporting}
                onClick={async () => {
                  setSource("objaverse");
                  setResults([]);
                  setSelected(null);
                  setSearchError(null);
                  setNextCursor(null);
                  setStripTextures(false);
                  await ensureObjaverseCategories();
                }}
                className={`px-3 py-1 text-xs border-l border-neutral-300 dark:border-neutral-600 disabled:opacity-40 ${
                  source === "objaverse"
                    ? "bg-[#414063] text-white"
                    : "bg-transparent text-neutral-600 dark:text-neutral-300"
                }`}
              >
                {CATALOG_LABEL.objaverse}
              </button>
            </div>
          </div>

          {/* The per-source licence notices (Sketchfab / Poly Haven /
              Objaverse) were removed from this dialog. Nothing behind them
              changed: each source still applies its own licence filter, and
              author + model URL are still captured on import. */}

          {/* search row — Objaverse browses by category; others keyword-search */}
          {source === "objaverse" ? (
            <div className="flex gap-2">
              <select
                className="flex-1 border rounded px-3 py-2 text-sm dark:bg-neutral-800 dark:text-white"
                value={objaverseCat}
                disabled={isImporting || !objaverseCats.length}
                onChange={(e) => {
                  const c = e.target.value;
                  setObjaverseCat(c);
                  if (c) runBrowse(c);
                }}
              >
                <option value="">
                  {objaverseCats.length
                    ? "— pick a furniture category —"
                    : "Loading categories…"}
                </option>
                {objaverseCats.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.label} ({c.count})
                  </option>
                ))}
              </select>
              <button
                onClick={() => runBrowse(objaverseCat)}
                disabled={isSearching || isImporting || !objaverseCat}
                className="px-4 py-2 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
              >
                {isSearching ? "Loading…" : "Browse"}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border rounded px-3 py-2 text-sm dark:bg-neutral-800 dark:text-white"
                placeholder='Search e.g. "wooden chair", "ceiling lamp", "rug"'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isSearching && !isImporting) {
                    runSearch();
                  }
                }}
                disabled={isImporting}
              />
              <button
                onClick={runSearch}
                disabled={isSearching || isImporting || !query.trim()}
                className="px-4 py-2 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
              >
                {isSearching ? "Searching…" : "Search"}
              </button>
            </div>
          )}

          {/* search error / empty */}
          {searchError && (
            <div className="px-3 py-2 text-sm rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200">
              {searchError}
            </div>
          )}

          {/* results grid */}
          {results.length > 0 && (
            <div className="grid grid-cols-3 gap-3 max-h-[320px] overflow-y-auto p-1">
              {results.map((r) => {
                const isSel = selected?.uid === r.uid;
                return (
                  <button
                    type="button"
                    key={r.uid}
                    onClick={() => onResultClick(r)}
                    disabled={isImporting}
                    className={`text-left border rounded overflow-hidden transition ${
                      isSel
                        ? "border-[#414063] ring-2 ring-[#414063]"
                        : "border-neutral-200 dark:border-neutral-700 hover:border-[#414063]"
                    } disabled:opacity-50`}
                  >
                    <div className="aspect-square bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      {r.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail}
                          alt={r.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
                          no preview
                        </div>
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div
                        className="text-xs font-medium text-neutral-800 dark:text-neutral-100 truncate"
                        title={r.name}
                      >
                        {r.name || "(unnamed)"}
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">
                        by {r.author || "?"} · {r.license || "?"}
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        {formatFaceCount(r.faceCount)} faces
                        {r.animationCount > 0 ? " · anim" : ""}
                        {r.sizeBytes ? ` · ${formatBytes(r.sizeBytes)}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* load more — Sketchfab paginates, so append the next page. Hidden
              for Poly Haven (it returns everything at once → nextCursor null). */}
          {nextCursor && results.length > 0 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore || isImporting}
                className="px-4 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-40"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {/* selected / import form — only when a result is picked */}
          {selected && (
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4 space-y-3">
              <div className="text-xs text-neutral-500">
                Selected:{" "}
                <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                  {selected.name}
                </span>{" "}
                by{" "}
                {selected.authorProfile ? (
                  <a
                    href={selected.authorProfile}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {selected.author}
                  </a>
                ) : (
                  selected.author
                )}{" "}
                ({selected.license || "?"})
              </div>

              {/* Target category */}
              <div className="block text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-neutral-700 dark:text-neutral-200 font-semibold">
                    Target category{" "}
                    <span className="text-red-500" title="Required">
                      *
                    </span>
                  </span>
                  {categoryId ? (
                    <span className="text-xs text-green-700 dark:text-green-300">
                      ✓ selected
                    </span>
                  ) : (
                    <span className="text-xs text-red-500">Required</span>
                  )}
                </div>
                <div
                  className={
                    categoryId
                      ? ""
                      : "ring-2 ring-red-400 dark:ring-red-500 rounded"
                  }
                >
                  <SearchableSelect
                    value={categoryId}
                    onChange={setCategoryId}
                    disabled={isImporting}
                    placeholder="— pick a category to store the model in —"
                    showSearch
                    options={subCategories
                      .slice()
                      .sort((a, b) => {
                        const am = mainName(a);
                        const bm = mainName(b);
                        if (am !== bm) return am.localeCompare(bm);
                        return (a.name || "").localeCompare(b.name || "");
                      })
                      .map((c) => ({
                        value: c._id,
                        label: c.name,
                        group: mainName(c),
                      }))}
                  />
                </div>
              </div>

              {/* Display name */}
              <label className="block text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">
                  Display name (optional)
                </span>
                <input
                  type="text"
                  className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={selected.name || "Imported model"}
                  disabled={isImporting}
                />
              </label>

              {/* Strip textures toggle — default ON for smaller files */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripTextures}
                  onChange={(e) => setStripTextures(e.target.checked)}
                  disabled={isImporting}
                  className="cursor-pointer"
                />
                <span className="text-neutral-700 dark:text-neutral-200">
                  Strip embedded textures
                </span>
                <span className="text-xs text-neutral-400">
                  {stripTextures
                    ? "ON — much smaller file (mesh only)"
                    : "OFF — keep author's PBR textures"}
                </span>
              </label>

              {/* Placement type — controls which Item subclass pazl uses
                  when this model is dragged into a room. Auto-guessed from
                  the model name; user can override. */}
              <label className="block text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">
                  Placement type
                </span>
                <select
                  className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                  value={placementType}
                  onChange={(e) =>
                    setPlacementType(Number(e.target.value))
                  }
                  disabled={isImporting}
                >
                  {PLACEMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} — {o.hint}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* progress / status */}
          {(isImporting || stage === "done" || stage === "error") && (
            <div
              className={`mt-2 px-3 py-2 rounded text-sm ${
                stage === "error"
                  ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200"
                  : stage === "done"
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
                    : "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
              }`}
            >
              {stage === "done" ? (
                <span>
                  ✓ Imported. The model is now in your catalog under the
                  selected category.
                </span>
              ) : stage === "error" ? (
                <span>✗ {error}</span>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span>
                      <span className="inline-block w-3 h-3 mr-2 rounded-full bg-blue-500 animate-pulse" />
                      {stageDetail || stage}
                    </span>
                    <span className="text-xs text-neutral-500">
                      elapsed {fmtTime(elapsedSec)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-blue-100 dark:bg-blue-900/40 rounded overflow-hidden">
                    <div
                      className="h-2 bg-blue-500 transition-all"
                      style={{
                        width: `${Math.min(95, (elapsedSec / 30) * 100)}%`,
                      }}
                    />
                  </div>
                  {jobId && (
                    <div className="text-xs text-neutral-400 mt-1.5">
                      Job {jobId.substring(0, 8)}…
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-1.5 text-sm border rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            {stage === "done" ? "Close" : "Cancel"}
          </button>
          {stage !== "done" && (
            <button
              onClick={runImport}
              disabled={isImporting || !selected || !categoryId}
              className="px-4 py-1.5 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
            >
              {isImporting ? "Importing…" : "Add to catalog"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModelSearchModal;
