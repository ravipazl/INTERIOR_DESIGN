import React, { useEffect, useMemo, useRef, useState } from "react";
import { ModelsService } from "@pazl/services/ModelsService";
import { CategoriesService } from "@pazl/services/categoriesService";
import { Category } from "@pazl/entities/Category";
import SearchableSelect from "@pazl/components/SearchableSelect";
import {
  PLACEMENT_OPTIONS,
  PLACEMENT_TYPE,
  guessPlacementType,
} from "@pazl/helpers/guessModelType";

interface GenerateFromPhotoModalProps {
  show: boolean;
  onClose: () => void;
  onSuccess: (newModelId: string) => void;
}

type Stage =
  | "idle"
  | "submitting"
  | "queued"
  | "uploading_image"
  | "base_creating"
  | "base_polling"
  | "retopo_creating"
  | "retopo_polling"
  | "downloading_glb"
  | "claude_running"
  | "preview_ready"
  | "accepting"
  | "done"
  | "error";

type Engine = "tripo" | "claude-blender";

const POLL_MS = 3000;

// Claude + Blender: what the user sees while it works, in order. The backend
// stage names map onto these (a "fixing" repair counts as building again).
const CLAUDE_STEPS: { keys: string[]; label: string }[] = [
  { keys: ["reading_photo"], label: "Reading your photo" },
  { keys: ["writing_script"], label: "Claude is designing the model" },
  { keys: ["building", "fixing"], label: "Building it in Blender" },
  { keys: ["rendering"], label: "Rendering a preview" },
  { keys: ["comparing"], label: "Checking it against your photo" },
];

interface ClaudePreview {
  previewUrl: string;
  sizeMm: { w: number; d: number; h: number };
  requestedSizeMm: { w: number; d: number; h: number };
  parts: string[];
  triangles: number;
  fixRounds: number;
  differences: string[];
  checks: { sizeWithin2Percent: boolean; namedParts: boolean; opens: boolean };
  seconds: number;
}

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "").replace(/\/$/, "");
const errText = (e: any, fallback: string) =>
  e?.response?.data?.message || e?.message || fallback;

function GenerateFromPhotoModal({
  show,
  onClose,
  onSuccess,
}: GenerateFromPhotoModalProps) {
  const [image, setImage] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [faceLimit, setFaceLimit] = useState<number>(5000);
  const [includeTexture, setIncludeTexture] = useState<boolean>(false);
  const [placementType, setPlacementType] = useState<number>(
    PLACEMENT_TYPE.FLOOR
  );
  const [stage, setStage] = useState<Stage>("idle");
  const [stageDetail, setStageDetail] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [engine, setEngine] = useState<Engine>("tripo");
  const [widthMm, setWidthMm] = useState("");
  const [depthMm, setDepthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [hint, setHint] = useState("");
  const [claudeOptions, setClaudeOptions] = useState<{
    enabled: boolean;
    dailyLimit: number;
    usedToday: number;
  } | null>(null);
  const [claudeRound, setClaudeRound] = useState(0);
  const [preview, setPreview] = useState<ClaudePreview | null>(null);
  const pollTimer = useRef<any>(null);
  const startedAt = useRef<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const tickTimer = useRef<any>(null);

  useEffect(() => {
    if (!show) return;
    const cats = CategoriesService.getCategoriesFromLocalStorage() || [];
    setAllCategories(cats);
    setImage(null);
    setName("");
    setCategoryId("");
    setFaceLimit(5000);
    setStage("idle");
    setStageDetail("");
    setProgress(null);
    setError(null);
    setJobId(null);
    setElapsedSec(0);
    setIncludeTexture(false);
    setPlacementType(PLACEMENT_TYPE.FLOOR);
    setEngine("tripo");
    setWidthMm("");
    setDepthMm("");
    setHeightMm("");
    setHint("");
    setClaudeRound(0);
    setPreview(null);
    // Is Claude + Blender on, and how much of today's allowance is left?
    ModelsService.getImageTo3dOptions()
      .then((o) => setClaudeOptions(o?.claudeBlender || null))
      .catch(() => setClaudeOptions(null));
  }, [show]);

  // Clean up timers
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

  if (!show) return null;

  const isRunning =
    stage === "submitting" ||
    stage === "queued" ||
    stage === "uploading_image" ||
    stage === "base_creating" ||
    stage === "base_polling" ||
    stage === "retopo_creating" ||
    stage === "retopo_polling" ||
    stage === "downloading_glb" ||
    stage === "claude_running" ||
    stage === "accepting";

  const isClaude = engine === "claude-blender";
  // Preview panel replaces the form once Claude + Blender has a candidate.
  const inPreview =
    isClaude &&
    (stage === "preview_ready" || stage === "accepting" || stage === "done");
  const sizeMm = {
    w: Number(widthMm),
    d: Number(depthMm),
    h: Number(heightMm),
  };
  const sizeOk = [sizeMm.w, sizeMm.d, sizeMm.h].every(
    (v) => Number.isFinite(v) && v >= 30 && v <= 6000
  );
  const claudeAvailable = claudeOptions?.enabled !== false && !!claudeOptions;
  const claudeLeft = claudeOptions
    ? Math.max(0, claudeOptions.dailyLimit - claudeOptions.usedToday)
    : 0;

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

  const beginPoll = (id: string) => {
    const tick = async () => {
      try {
        const data: any = await ModelsService.pollImageTo3dStatus(id);
        // Map backend stage label to our local Stage enum (loosely)
        const s: string = data?.stage || "queued";
        setStageDetail(s);
        setProgress(
          typeof data?.progress === "number" ? data.progress : null
        );

        if (data?.engine === "claude-blender") {
          if (s === "preview_ready") {
            setPreview(data.result as ClaudePreview);
            setStage("preview_ready");
            stopTicker();
            return;
          }
          if (s === "error") {
            setStage("error");
            setError(data?.error || "Unknown error");
            stopTicker();
            return;
          }
          setClaudeRound(Number(data?.round) || 0);
          setStage("claude_running");
          pollTimer.current = setTimeout(tick, POLL_MS);
          return;
        }

        if (s.startsWith("base")) setStage("base_polling");
        else if (s.startsWith("retopo")) setStage("retopo_polling");
        else if (s === "downloading_glb") setStage("downloading_glb");
        else if (s === "uploading_image") setStage("uploading_image");
        else if (s === "done") {
          setStage("done");
          stopTicker();
          const newId: string = data.result?.modelId;
          if (newId) onSuccess(newId);
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

  const handleGenerate = async () => {
    setError(null);
    if (!image) {
      setError("Pick an image first.");
      return;
    }
    if (!categoryId) {
      setError("Pick a target category.");
      return;
    }
    if (isClaude && !sizeOk) {
      setError("Enter the real width, depth and height in mm (30–6000).");
      return;
    }
    setStage("submitting");
    setPreview(null);
    setClaudeRound(0);
    setElapsedSec(0);
    startTicker();
    try {
      const resp = await ModelsService.startImageTo3d({
        image,
        categoryId,
        name: name.trim() || undefined,
        faceLimit,
        texture: includeTexture,
        type: placementType,
        ...(isClaude
          ? {
              engine: "claude-blender" as const,
              widthMm: sizeMm.w,
              depthMm: sizeMm.d,
              heightMm: sizeMm.h,
              hint: hint.trim() || undefined,
            }
          : {}),
      });
      setJobId(resp.jobId);
      setStage("queued");
      setStageDetail("queued");
      if (isClaude && claudeOptions) {
        setClaudeOptions({
          ...claudeOptions,
          usedToday: (resp as any).usedToday ?? claudeOptions.usedToday + 1,
        });
      }
      beginPoll(resp.jobId);
    } catch (e: any) {
      setStage("error");
      setError(errText(e, "Failed to submit"));
      stopTicker();
    }
  };

  // The preview is only a candidate: nothing is in the catalogue until this runs.
  const handleAccept = async () => {
    if (!jobId) return;
    setStage("accepting");
    try {
      const saved = await ModelsService.acceptImageTo3d(jobId, {
        name: name.trim() || undefined,
        categoryId,
      });
      setStage("done");
      onSuccess(saved.modelId);
    } catch (e: any) {
      setStage("preview_ready");
      setError(errText(e, "Couldn't add the model to the catalogue."));
    }
  };

  // Throw the preview away and run again (the photo, size and category stay filled in).
  const handleTryAgain = () => {
    setPreview(null);
    setJobId(null);
    setError(null);
    setStage("idle");
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={isRunning ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-[#333333] rounded-lg shadow-xl w-[560px] max-w-[95vw] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="font-semibold text-base text-[#414063] dark:text-white">
            Generate 3D model from photo
          </h3>
          <button
            onClick={onClose}
            disabled={isRunning}
            className="text-2xl leading-none text-neutral-500 hover:text-neutral-800 disabled:opacity-30"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Engine — Tripo (as before) or Claude + Blender */}
          {!inPreview && (
            <div>
              <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-1">
                How should it be generated?
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: "tripo" as Engine,
                      title: "Tripo",
                      sub: "Quick AI mesh. Looks like the photo; one solid shape.",
                    },
                    {
                      id: "claude-blender" as Engine,
                      title: "Claude + Blender",
                      sub: "Built part by part (drawers, doors, legs) at your exact size.",
                    },
                  ] as const
                ).map((o) => {
                  const disabled =
                    isRunning || (o.id === "claude-blender" && !claudeAvailable);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setEngine(o.id)}
                      className={`text-left rounded border px-3 py-2 disabled:opacity-50 ${
                        engine === o.id
                          ? "border-[#414063] bg-[#414063]/5 ring-1 ring-[#414063]"
                          : "border-neutral-300 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                      }`}
                    >
                      <div className="text-sm font-semibold text-[#414063] dark:text-white">
                        {o.title}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">
                        {o.id === "claude-blender" && !claudeAvailable
                          ? "Not available on this server right now."
                          : o.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!inPreview && (
            <div className="text-xs px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-amber-800 dark:text-amber-200">
              {isClaude ? (
                <>
                  ⓘ Takes about 1–3 minutes. You see a preview first — nothing
                  is added to the catalogue until you press{" "}
                  <b>Add to catalogue</b>.
                  {claudeOptions && (
                    <span className="block mt-0.5">
                      Today: {claudeOptions.usedToday} of{" "}
                      {claudeOptions.dailyLimit} used ({claudeLeft} left).
                    </span>
                  )}
                </>
              ) : (
                "ⓘ Generation takes 45-180 seconds and consumes Tripo credits."
              )}
            </div>
          )}

          {inPreview && stage === "done" && (
            <div className="px-3 py-2 rounded text-sm bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200">
              ✓ Added. The new model is in your catalogue.
            </div>
          )}

          {inPreview && preview && (
            <div className="space-y-3">
              <img
                src={`${API_BASE}${preview.previewUrl}`}
                alt="Preview of the generated model"
                className="w-full rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-100"
              />
              <div className="text-sm text-neutral-700 dark:text-neutral-200">
                <span className="font-semibold">
                  {preview.sizeMm.w} × {preview.sizeMm.d} × {preview.sizeMm.h} mm
                </span>{" "}
                (W × D × H) · {preview.parts.length} parts ·{" "}
                {preview.triangles.toLocaleString()} triangles · built in{" "}
                {fmtTime(preview.seconds)}
                {preview.fixRounds > 0 &&
                  ` · improved ${preview.fixRounds}× after comparing with the photo`}
              </div>
              <ul className="text-xs space-y-0.5">
                {[
                  [preview.checks.sizeWithin2Percent, "Size matches what you entered (within 2%)"],
                  [preview.checks.namedParts, "Every part has its own name"],
                  [preview.checks.opens, "The 3D file opens correctly"],
                ].map(([ok, label]) => (
                  <li
                    key={label as string}
                    className={ok ? "text-green-700 dark:text-green-300" : "text-red-600"}
                  >
                    {ok ? "✓" : "✗"} {label as string}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1">
                {preview.parts.slice(0, 18).map((p) => (
                  <span
                    key={p}
                    className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-[11px] text-neutral-600 dark:text-neutral-300"
                  >
                    {p}
                  </span>
                ))}
                {preview.parts.length > 18 && (
                  <span className="text-[11px] text-neutral-400">
                    +{preview.parts.length - 18} more
                  </span>
                )}
              </div>
              {preview.differences.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Still differs from the photo: {preview.differences.join("; ")}.
                  You can try again.
                </p>
              )}
              {error && (
                <p className="text-xs text-red-600">✗ {error}</p>
              )}
            </div>
          )}

          {!inPreview && (
          <>
          {/* Target category — REQUIRED */}
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
                disabled={isRunning}
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
            {!categoryId && (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                The generated model is saved under this category. You can't
                generate without picking one.
              </p>
            )}
            {categoryId && (
              <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                Will be saved under{" "}
                <span className="font-semibold">
                  {(() => {
                    const c = allCategories.find((x) => x._id === categoryId);
                    if (!c) return "?";
                    const m = mainName(c);
                    return m ? `${m} → ${c.name}` : c.name;
                  })()}
                </span>
                .
              </p>
            )}
          </div>

          {/* Image picker */}
          <label className="block">
            <div className="border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg p-6 text-center cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
              {image ? (
                <div>
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200 truncate">
                    {image.name}
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    {(image.size / 1024).toFixed(0)} KB · click to change
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    Click to choose a photo (JPG, PNG, WebP)
                  </p>
                  <p className="text-xs text-neutral-400 mt-1">Max 10 MB.</p>
                </>
              )}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={isRunning}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setImage(f);
                }}
              />
            </div>
          </label>

          {/* Optional name */}
          <label className="block text-sm">
            <span className="text-neutral-600 dark:text-neutral-300">
              Name (optional)
            </span>
            <input
              type="text"
              className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                // Auto-guess placement type from the name (e.g. "wall AC"
                // → Wall). User can override below.
                if (e.target.value.trim()) {
                  setPlacementType(guessPlacementType(e.target.value));
                }
              }}
              placeholder={`AI generated ${new Date().toISOString().substring(0, 19)}`}
              disabled={isRunning}
            />
          </label>

          {/* Placement type — picks the Item subclass pazl uses on drag. */}
          <label className="block text-sm">
            <span className="text-neutral-600 dark:text-neutral-300">
              Placement type
            </span>
            <select
              className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
              value={placementType}
              onChange={(e) => setPlacementType(Number(e.target.value))}
              disabled={isRunning}
            >
              {PLACEMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} — {o.hint}
                </option>
              ))}
            </select>
          </label>

          {/* Claude + Blender: the real size is REQUIRED — the model is built to it. */}
          {isClaude && (
            <div className="block text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-neutral-700 dark:text-neutral-200 font-semibold">
                  Real size (mm){" "}
                  <span className="text-red-500" title="Required">
                    *
                  </span>
                </span>
                {sizeOk ? (
                  <span className="text-xs text-green-700 dark:text-green-300">
                    ✓ {sizeMm.w} × {sizeMm.d} × {sizeMm.h}
                  </span>
                ) : (
                  <span className="text-xs text-red-500">Required</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Width", widthMm, setWidthMm],
                    ["Depth", depthMm, setDepthMm],
                    ["Height", heightMm, setHeightMm],
                  ] as const
                ).map(([label, value, set]) => (
                  <label key={label} className="block">
                    <span className="text-xs text-neutral-500">{label}</span>
                    <input
                      type="number"
                      min={30}
                      max={6000}
                      inputMode="numeric"
                      className="mt-0.5 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      placeholder="mm"
                      disabled={isRunning}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Width is left–right as seen from the front. The finished model
                is exactly this size.
              </p>
              <label className="block mt-2">
                <span className="text-xs text-neutral-500">
                  Note for Claude (optional)
                </span>
                <input
                  type="text"
                  maxLength={300}
                  className="mt-0.5 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="e.g. 2 drawers, brushed-steel bar handles"
                  disabled={isRunning}
                />
              </label>
            </div>
          )}

          {/* Include texture toggle — default OFF (mesh-only) */}
          {!isClaude && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeTexture}
              onChange={(e) => setIncludeTexture(e.target.checked)}
              disabled={isRunning}
              className="cursor-pointer"
            />
            <span className="text-neutral-700 dark:text-neutral-200">
              Include texture (PBR maps)
            </span>
            <span className="text-xs text-neutral-400">
              {includeTexture
                ? "ON — slower generation, larger file"
                : "OFF — mesh only, faster"}
            </span>
          </label>
          )}

          {/* Face limit — editable, accepts any value 100-50000 */}
          {!isClaude && (
          <label className="block text-sm">
            <span className="text-neutral-600 dark:text-neutral-300">
              Face limit (mesh complexity)
            </span>
            <input
              type="number"
              min={100}
              max={50000}
              step={500}
              className="mt-1 block w-full border rounded px-2 py-1 dark:bg-neutral-800 dark:text-white"
              value={faceLimit === 0 ? "" : faceLimit}
              onChange={(e) => {
                // Allow the field to be empty briefly while user types a new
                // number. Treat empty as 0; we'll re-default on submit if 0.
                const v = e.target.value;
                if (v === "") {
                  setFaceLimit(0);
                  return;
                }
                const n = Number(v);
                if (Number.isFinite(n)) setFaceLimit(n);
              }}
              onBlur={() => {
                // Snap back to a sane value if the user left it empty/invalid.
                if (!faceLimit || faceLimit < 100) setFaceLimit(5000);
                else if (faceLimit > 50000) setFaceLimit(50000);
              }}
              disabled={isRunning}
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-neutral-400">
                Range 100–50000. Lower = simpler mesh (faster, less detail).
              </span>
              {/* Quick-pick presets */}
              {!isRunning && (
                <div className="flex gap-1">
                  {[1000, 2500, 5000, 10000, 20000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFaceLimit(preset)}
                      className={`px-1.5 py-0.5 rounded border ${
                        faceLimit === preset
                          ? "bg-[#414063] text-white border-[#414063]"
                          : "bg-white dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100"
                      }`}
                    >
                      {preset >= 1000 ? `${preset / 1000}k` : preset}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
          )}
          </>
          )}

          {/* Progress / status */}
          {!inPreview && (isRunning || stage === "done" || stage === "error") && (
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
                <span>✓ Generated. The new model is in your catalog.</span>
              ) : stage === "error" ? (
                <span>✗ {error}</span>
              ) : isClaude ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold">
                      Building your model
                      {claudeRound > 0 && ` · improvement round ${claudeRound} of 3`}
                    </span>
                    <span className="text-xs text-neutral-500">
                      elapsed {fmtTime(elapsedSec)}
                    </span>
                  </div>
                  <ol className="space-y-1">
                    {(() => {
                      const cur = CLAUDE_STEPS.findIndex((st) =>
                        st.keys.includes(stageDetail)
                      );
                      return CLAUDE_STEPS.map((st, i) => {
                        const done = cur > i;
                        const active = cur === i || (cur < 0 && i === 0);
                        return (
                          <li
                            key={st.label}
                            className={`flex items-center gap-2 text-sm ${
                              done
                                ? "text-green-700 dark:text-green-300"
                                : active
                                  ? "font-semibold"
                                  : "text-neutral-400"
                            }`}
                          >
                            <span className="w-4 text-center">
                              {done ? (
                                "✓"
                              ) : active ? (
                                <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                              ) : (
                                "·"
                              )}
                            </span>
                            {st.label}
                          </li>
                        );
                      });
                    })()}
                  </ol>
                  {jobId && (
                    <div className="text-xs text-neutral-400 mt-1.5">
                      Job {jobId.substring(0, 8)}…
                    </div>
                  )}
                </div>
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
                        width:
                          progress != null
                            ? `${Math.max(0, Math.min(100, progress))}%`
                            : `${Math.min(95, (elapsedSec / 120) * 100)}%`,
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

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={onClose}
            disabled={isRunning}
            className="px-4 py-1.5 text-sm border rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            {stage === "done" ? "Close" : stage === "preview_ready" ? "Discard" : "Cancel"}
          </button>
          {inPreview && stage !== "done" ? (
            <>
              <button
                onClick={handleTryAgain}
                disabled={isRunning || claudeLeft <= 0}
                title={
                  claudeLeft <= 0
                    ? "Daily limit reached"
                    : "Run again — counts toward today's limit"
                }
                className="px-4 py-1.5 text-sm border rounded text-[#414063] hover:bg-neutral-100 disabled:opacity-40"
              >
                Try again
              </button>
              <button
                onClick={handleAccept}
                disabled={isRunning || !preview}
                className="px-4 py-1.5 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
              >
                {stage === "accepting" ? "Adding…" : "Add to catalogue"}
              </button>
            </>
          ) : (
            stage !== "done" && (
              <button
                onClick={handleGenerate}
                disabled={
                  isRunning ||
                  !image ||
                  !categoryId ||
                  (isClaude && (!sizeOk || claudeLeft <= 0))
                }
                className="px-4 py-1.5 text-sm rounded bg-[#414063] text-white disabled:opacity-40"
              >
                {isRunning ? "Generating…" : "Generate"}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default GenerateFromPhotoModal;
