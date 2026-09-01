import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RenderService,
  RenderJob,
  SceneMaterial,
  MaterialOverride,
  MATERIAL_TYPES,
} from "../../services/RenderService";
import { ProjectWorkspaceService } from "../../services/ProjectWorkspaceService";
import { AuthService } from "../../services/authService";

/**
 * RenderViewModal — photorealistic "Render" view.
 *
 * A self-contained floating button + panel. Clicking "Render" exports the
 * current room to a .glb, captures the camera, uploads to the backend /render
 * service (headless Blender), polls for progress, and shows the finished image
 * with a download link. Styling is inline so it's robust to Tailwind purge.
 */

type Status =
  | "idle"
  | "starting"
  | "queued"
  | "rendering"
  | "done"
  | "error";

const QUALITY: { label: string; samples: number }[] = [
  { label: "Draft (fast)", samples: 64 },
  { label: "Standard", samples: 128 },
  { label: "High (slow)", samples: 256 },
];

const VIEWS: { label: string; value: string }[] = [
  { label: "Corner (3/4)", value: "corner" },
  { label: "Front", value: "front" },
  { label: "Back", value: "back" },
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
  { label: "Top", value: "top" },
];

// Blender engine: EEVEE is fast (rasterizer), Cycles is photorealistic (ray
// tracing). render.py reads PAZL_ENGINE.
const ENGINES: { label: string; value: string }[] = [
  { label: "Fast (EEVEE)", value: "EEVEE" },
  { label: "Photoreal (Cycles)", value: "CYCLES" },
];

// Output resolution. render.py reads PAZL_RES_X / PAZL_RES_Y.
const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: "HD (720p)", w: 1280, h: 720 },
  { label: "Full HD (1080p)", w: 1920, h: 1080 },
  { label: "4K (Ultra HD)", w: 3840, h: 2160 },
];

// Aspect ratio (width / height), applied to the resolution's long edge.
const ASPECTS: { label: string; ratio: number }[] = [
  { label: "16:9 (wide)", ratio: 16 / 9 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "Square (1:1)", ratio: 1 },
  { label: "Portrait (3:4)", ratio: 3 / 4 },
];

// Output file format. render.py reads PAZL_FORMAT.
const FORMATS: { label: string; value: string }[] = [
  { label: "PNG (sharp)", value: "PNG" },
  { label: "JPG (smaller)", value: "JPEG" },
];

// What each material type looks like, mirrored from MATERIAL_TYPES in
// render.py. Only used to show the preset's value on the sliders before the
// user drags one — render.py remains the single source of truth.
const TYPE_PRESETS: Record<string, { roughness: number; metallic: number }> = {
  fabric: { roughness: 0.9, metallic: 0 },
  wood: { roughness: 0.6, metallic: 0 },
  paint: { roughness: 0.85, metallic: 0 },
  plastic: { roughness: 0.4, metallic: 0 },
  leather: { roughness: 0.55, metallic: 0 },
  stone: { roughness: 0.7, metallic: 0 },
  marble: { roughness: 0.15, metallic: 0 },
  tile: { roughness: 0.2, metallic: 0 },
  carpet: { roughness: 0.95, metallic: 0 },
  metal: { roughness: 0.3, metallic: 1 },
  glass: { roughness: 0.05, metallic: 0 },
  mirror: { roughness: 0.02, metallic: 1 },
};

// Lighting environment — the sky the room is lit by, and by far the biggest
// influence on the mood of a render. Each value maps to a file the backend
// keeps at render/environments/<value>.hdr. `swatch` is only an approximation
// of that sky's colour, so the grid reads at a glance (nobody can picture what
// "kloofendal_43d_clear" looks like).
const ENVIRONMENTS: { label: string; value: string; swatch: string }[] = [
  { label: "Daylight", value: "daylight", swatch: "#7fb2e5" },
  { label: "Sunset", value: "sunset", swatch: "#e8a765" },
  { label: "Night", value: "night", swatch: "#1e2a44" },
  { label: "Forest", value: "forest", swatch: "#6f8f5a" },
  { label: "Overcast", value: "overcast", swatch: "#c3c7cc" },
  { label: "Studio", value: "studio", swatch: "#eeeeea" },
];

const POLL_MS = 3000;

/**
 * Guess a sensible material type from an item's name, so "Auto-assign" can give
 * every piece a real material in one click instead of leaving them flat.
 * Returns "" when nothing matches — better to leave the default than guess wrong
 * (e.g. "Room" = walls/floor, which we must NOT turn into fabric).
 */
const guessMaterialType = (name: string): string => {
  const n = (name || "").toLowerCase();
  if (/leather/.test(n)) return "leather";
  if (/marble|granite/.test(n)) return "marble";
  if (/tile|ceramic/.test(n)) return "tile";
  if (/\bstone\b|counter|slab/.test(n)) return "stone";
  if (/carpet|\brug\b/.test(n)) return "carpet";
  if (/glass|mirror|window/.test(n)) return "glass";
  if (/metal|steel|iron|brass|chrome|alumin/.test(n)) return "metal";
  if (/table|desk|shelf|stand|cabinet|drawer|\bdoor\b|wood|coffee/.test(n))
    return "wood";
  if (
    /sofa|couch|armchair|chair|cushion|pillow|curtain|mattress|bed|fabric|seat|ottoman/.test(
      n
    )
  )
    return "fabric";
  return "";
};

const RenderViewModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every finished render/video is auto-saved to the project's render history (a
  // `projectitems` draft), so the team can browse all renders on the project page
  // and choose which to send. This ref dedupes the save per job id — the status
  // poll can report "done" more than once before the timer is cleared.
  const savedJobs = useRef<Set<string>>(new Set());
  // "" = not saved yet, "saved" = filed to render history, "error" = save failed.
  // Surfacing the error tells us a render was made but didn't reach the history
  // (vs. never rendered), which is exactly what we need to diagnose a missing one.
  type SaveState = "" | "saved" | "error";
  const [imgSave, setImgSave] = useState<SaveState>("");
  const [vidSave, setVidSave] = useState<SaveState>("");
  const [samples, setSamples] = useState(128);
  // Default OFF: an interior shot from the user's own camera is what people
  // want. Auto-frame pulls the camera outside for an overhead "doll-house"
  // view — useful occasionally, but the wrong default.
  const [autoFrame, setAutoFrame] = useState(false);
  const [view, setView] = useState("corner");
  const [engine, setEngine] = useState("EEVEE");
  const [resIdx, setResIdx] = useState(0); // index into RESOLUTIONS (default 720p)
  const [aspectIdx, setAspectIdx] = useState(0); // index into ASPECTS (default 16:9)
  const [format, setFormat] = useState("PNG");
  const [exposure, setExposure] = useState(0); // brightness -/+
  const [denoise, setDenoise] = useState(true);
  const [environment, setEnvironment] = useState("daylight");
  // Post-processing "finish" — the Enscape-style knobs applied on top of the
  // render. Every default is NEUTRAL, so an untouched render is unchanged.
  const [temperature, setTemperature] = useState(6500); // Kelvin (6500 = neutral)
  const [saturation, setSaturation] = useState(100); // % (100 = unchanged)
  const [highlights, setHighlights] = useState(0); // -100..100
  const [shadows, setShadows] = useState(0); // -100..100
  const [vignette, setVignette] = useState(0); // 0..100 %
  const [dof, setDof] = useState(0); // 0..100 %
  const [skyRotation, setSkyRotation] = useState(0); // degrees
  const [contrast, setContrast] = useState(0); // -100..100
  const [autoContrast, setAutoContrast] = useState(false);
  const [whiteBackground, setWhiteBackground] = useState(false);
  // Lighting (Enscape's Atmosphere): a time-of-day sun + room-light brightness.
  const [useSun, setUseSun] = useState(false);
  const [sunTime, setSunTime] = useState(50); // 0..100 (50 = noon)
  const [sunDir, setSunDir] = useState(0); // degrees
  const [roomLights, setRoomLights] = useState(100); // % of default
  const [showAdjust, setShowAdjust] = useState(false); // collapse the extra knobs
  const [showLight, setShowLight] = useState(false); // collapse the lighting knobs
  const [tab, setTab] = useState<"render" | "materials">("render");
  // The scene's materials, refreshed each time the panel opens (the room can
  // change while the panel is closed).
  const [materials, setMaterials] = useState<SceneMaterial[]>([]);
  // Only the materials the user actually changed, keyed by name. Anything not
  // in here is left to render.py's defaults.
  const [overrides, setOverrides] = useState<Record<string, MaterialOverride>>(
    {}
  );
  const [selected, setSelected] = useState<string | null>(null);
  // True while the current job is a fast EEVEE preview, so the UI can label it.
  const [isPreview, setIsPreview] = useState(false);
  // Orbit video — a separate job from the still render, with its own state so
  // one can be running while the other's result is still on screen.
  const [videoStatus, setVideoStatus] = useState<Status>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoElapsed, setVideoElapsed] = useState(0);

  // Collapse the per-surface material list into ONE row per item. The Materials
  // tab used to show every distinct material (e.g. a TV has 5: screen, body,
  // buttons, stand), which didn't match the 8 items in the left panel and read
  // as confusing. Here each item becomes a single row that carries ALL its
  // underlying material names in `memberNames`; editing the row applies the
  // change to every one of those surfaces at once. The render still receives
  // per-material overrides (the only key that survives the glTF export).
  type MatGroup = {
    name: string; // group key — the owning item's name
    label: string;
    detail: string;
    color: string;
    hasTexture: boolean;
    itemNames: string[];
    meshCount: number;
    memberNames: string[]; // every real material name under this item
  };
  const itemGroups: MatGroup[] = (() => {
    const map = new Map<string, MatGroup>();
    for (const m of materials) {
      const owner = m.itemNames[0] || m.label || m.name;
      let g = map.get(owner);
      if (!g) {
        g = {
          name: owner,
          label: owner,
          detail: "",
          color: m.color,
          hasTexture: m.hasTexture,
          itemNames: m.itemNames.slice(),
          meshCount: 0,
          memberNames: [],
        };
        map.set(owner, g);
      }
      g.memberNames.push(m.name);
      g.meshCount += m.meshCount;
    }
    return Array.from(map.values());
  })();

  const selMat = itemGroups.find((g) => g.name === selected) || null;
  // Show the current override using the item's first surface as representative —
  // all its surfaces are edited together, so they stay in sync.
  const selOv: MaterialOverride =
    (selMat && overrides[selMat.memberNames[0]]) || {};

  /** Choose the type for EVERY surface of an item. "" clears the overrides. */
  const setType = useCallback((names: string[], type: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const name of names) {
        if (!type) delete next[name];
        // Changing type drops hand-tuned sliders so the preset shows through.
        else next[name] = { type };
      }
      return next;
    });
  }, []);

  /** Set the albedo colour on every surface of an item. "" clears it. */
  const setColor = useCallback((names: string[], color: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const name of names) {
        const entry = { ...next[name] };
        if (!color) delete entry.color;
        else entry.color = color;
        if (Object.keys(entry).length === 0) delete next[name];
        else next[name] = entry;
      }
      return next;
    });
  }, []);

  /** Hand-tune one value across every surface of an item. */
  const setNum = useCallback(
    (names: string[], key: "roughness" | "metallic", value: number) => {
      setOverrides((prev) => {
        const next = { ...prev };
        for (const name of names) {
          next[name] = { ...next[name], [key]: value };
        }
        return next;
      });
    },
    []
  );

  /**
   * One click: give every item a guessed material type, so nothing renders as
   * flat "clay". Items you already set are left alone; items we can't guess
   * (e.g. the Room = walls/floor) are left at default.
   */
  const autoAssignMaterials = () => {
    setOverrides((prev) => {
      const next = { ...prev };
      let changed = 0;
      for (const g of itemGroups) {
        const t = guessMaterialType(g.label || g.name);
        if (!t) continue;
        for (const nm of g.memberNames) {
          if (next[nm]?.type) continue; // keep an existing choice
          next[nm] = { ...next[nm], type: t };
          changed += 1;
        }
      }
      return changed ? next : prev;
    });
  };

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimers = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    pollTimer.current = null;
    elapsedTimer.current = null;
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const apply = useCallback((job: RenderJob) => {
    setProgress(job.progress ?? null);
    setQueuePos(job.queuePosition ?? null);
    if (job.stage === "done" && job.result?.imageUrl) {
      setImageUrl(RenderService.resolveImageUrl(job.result.imageUrl));
      setStatus("done");
    } else if (job.stage === "error") {
      setError(job.error || "Render failed");
      setStatus("error");
    } else {
      setStatus(job.stage === "rendering" ? "rendering" : "queued");
    }
  }, []);

  // Auto-save a finished render/video to the project's render history as a
  // `draft` projectitem, pointing at the file already on the backend (no
  // re-upload). Deduped per job id. Draft = saved but NOT sent: it shows only in
  // the team's render history on the project page until someone selects it and
  // sends it to the admin / publishes it to the client.
  const saveDraft = useCallback(
    async (
      kind: "render" | "video",
      path: string | null,
      jobId: string,
      setSave: (v: SaveState) => void
    ) => {
      if (savedJobs.current.has(jobId)) return;
      if (!path) {
        console.error("saveDraft: no file url for", kind);
        setSave("error");
        return;
      }
      const projectId = AuthService.getCurrentProjectId();
      if (!projectId) {
        console.error("saveDraft: no current project id");
        setSave("error");
        return;
      }
      savedJobs.current.add(jobId);
      try {
        const mimeType =
          kind === "video"
            ? "video/mp4"
            : /\.jpe?g$/i.test(path)
            ? "image/jpeg"
            : "image/png";
        const stamp = new Date().toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const res = await ProjectWorkspaceService.create({
          projectId,
          kind,
          fileUrl: path,
          mimeType,
          status: "draft",
          title: `${kind === "video" ? "Render video" : "Render"} — ${stamp}`,
          createdBy: (AuthService.getCurrentUser() as any)?.name || undefined,
        });
        if (res) {
          setSave("saved");
          // Tell the Production page's render history to refresh immediately, so
          // a render/video saved while that tab is already open still appears
          // (the tab-switch reload only covers switching INTO Production).
          try {
            window.dispatchEvent(new CustomEvent("pazl:render-saved"));
          } catch (_) {
            /* CustomEvent unsupported — the tab-switch reload still covers it */
          }
        } else {
          savedJobs.current.delete(jobId);
          setSave("error");
        }
      } catch (e) {
        console.error("saveDraft failed", e);
        savedJobs.current.delete(jobId);
        setSave("error");
      }
    },
    []
  );

  // preview = a fast, throwaway EEVEE pass at low quality to check the look
  // before committing to the ~20-minute Cycles render. Same scene, same
  // camera, same materials — only the engine and quality differ.
  const startRender = useCallback(async (preview = false) => {
    stopTimers();
    setStatus("starting");
    setError(null);
    setImageUrl(null);
    // The old clip belongs to the room as it was, so drop it alongside the
    // image — otherwise a stale video sits under a freshly rendered picture.
    setVideoUrl(null);
    setVidSave("");
    setImgSave("");
    setVideoError(null);
    setVideoStatus("idle");
    setProgress(null);
    setQueuePos(null);
    setElapsed(0);
    setIsPreview(preview);
    elapsedTimer.current = setInterval(() => setElapsed((e) => e + 1), 1000);

    // Preview renders small + fast; the final uses the chosen resolution.
    const base = preview ? 960 : RESOLUTIONS[resIdx].w;
    const ratio = ASPECTS[aspectIdx].ratio;
    const dims =
      ratio >= 1
        ? { width: base, height: Math.round(base / ratio) }
        : { width: Math.round(base * ratio), height: base };

    try {
      const { jobId } = await RenderService.startRender(
        {
          // EEVEE + few samples = seconds; Cycles + full samples = minutes.
          samples: preview ? 24 : samples,
          view,
          engine: preview ? "EEVEE" : engine,
          width: dims.width,
          height: dims.height,
          format,
          exposure,
          denoise,
          environment,
          // Post-processing "finish" — sent as the values render.py expects
          // (percent -> 0..1, etc.). Neutral values render exactly as before.
          temperature,
          saturation: saturation / 100,
          highlights: highlights / 100,
          shadows: shadows / 100,
          vignette: vignette / 100,
          dof: dof / 100,
          skyRotation,
          contrast,
          autoContrast,
          whiteBackground,
          // Lighting: sun off = -1; room lights as a 0..2 multiplier.
          sunTime: useSun ? sunTime : -1,
          sunDir,
          artificialLight: roomLights / 100,
          materials: Object.keys(overrides).length ? overrides : undefined,
        },
        { autoFrame }
      );
      setStatus("queued");
      pollTimer.current = setInterval(async () => {
        try {
          const job = await RenderService.pollRenderStatus(jobId);
          apply(job);
          if (job.stage === "done") {
            saveDraft("render", job.result?.imageUrl || null, jobId, setImgSave);
            stopTimers();
          } else if (job.stage === "error") {
            stopTimers();
          }
        } catch (e: any) {
          setError(e?.message || "Lost connection to render job");
          setStatus("error");
          stopTimers();
        }
      }, POLL_MS);
    } catch (e: any) {
      setError(e?.message || "Could not start render");
      setStatus("error");
      stopTimers();
    }
  }, [
    samples,
    view,
    engine,
    resIdx,
    aspectIdx,
    format,
    exposure,
    denoise,
    environment,
    temperature,
    saturation,
    highlights,
    shadows,
    vignette,
    dof,
    skyRotation,
    contrast,
    autoContrast,
    whiteBackground,
    useSun,
    sunTime,
    sunDir,
    roomLights,
    overrides,
    autoFrame,
    apply,
    stopTimers,
    saveDraft,
  ]);

  // Force a real download. The <a download> attribute is ignored for
  // cross-origin URLs (the image is served from the backend origin), so the
  // browser would just navigate to it. Fetching it as a blob and downloading
  // the object URL works (backend sends CORS headers).
  const downloadImage = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pazl-render-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      // Fallback: open in a new tab so the user can right-click → save.
      window.open(imageUrl, "_blank");
    }
  }, [imageUrl]);

  const videoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoElapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopVideoTimers = useCallback(() => {
    if (videoTimer.current) clearInterval(videoTimer.current);
    if (videoElapsedTimer.current) clearInterval(videoElapsedTimer.current);
    videoTimer.current = null;
    videoElapsedTimer.current = null;
  }, []);

  useEffect(() => () => stopVideoTimers(), [stopVideoTimers]);

  /**
   * Render a 12-second orbit of the room to MP4.
   *
   * Drawn by Three.js in a headless browser — the same engine as the 3D view,
   * but lit by an environment map and tone-mapped, so it lands much closer to a
   * Blender render than the raw viewport does. Still not Cycles: a true
   * photoreal animation would be ~5 days for 12 seconds.
   */
  const startVideo = useCallback(async () => {
    stopVideoTimers();
    setVideoStatus("starting");
    setVideoError(null);
    setVideoUrl(null);
    setVideoElapsed(0);
    videoElapsedTimer.current = setInterval(
      () => setVideoElapsed((e) => e + 1),
      1000
    );

    try {
      const { jobId } = await RenderService.startVideo();
      setVideoStatus("queued");
      videoTimer.current = setInterval(async () => {
        try {
          const job = await RenderService.pollVideoStatus(jobId);
          if (job.stage === "done" && job.result?.videoUrl) {
            setVideoUrl(RenderService.resolveImageUrl(job.result.videoUrl));
            saveDraft("video", job.result.videoUrl, jobId, setVidSave);
            setVideoStatus("done");
            stopVideoTimers();
          } else if (job.stage === "error") {
            setVideoError(job.error || "Video failed");
            setVideoStatus("error");
            stopVideoTimers();
          } else {
            setVideoStatus(job.stage === "rendering" ? "rendering" : "queued");
          }
        } catch (e: any) {
          setVideoError(e?.message || "Lost connection to video job");
          setVideoStatus("error");
          stopVideoTimers();
        }
      }, POLL_MS);
    } catch (e: any) {
      setVideoError(e?.message || "Could not start video");
      setVideoStatus("error");
      stopVideoTimers();
    }
  }, [stopVideoTimers, saveDraft]);

  // Same blob dance as downloadImage, and for the same reason: the <a download>
  // attribute is ignored cross-origin, so a plain link would navigate to the
  // .mp4 instead of saving it.
  const downloadVideo = useCallback(async () => {
    if (!videoUrl) return;
    try {
      const res = await fetch(videoUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pazl-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.open(videoUrl, "_blank");
    }
  }, [videoUrl]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const busy = status === "starting" || status === "queued" || status === "rendering";
  const videoBusy =
    videoStatus === "starting" ||
    videoStatus === "queued" ||
    videoStatus === "rendering";

  // One labelled slider row for the "Image adjustments" section, so the seven
  // knobs stay compact and consistent.
  const adjustRow = (
    label: string,
    value: number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
    display: string
  ) => (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
    >
      <span style={{ fontSize: 11.5, color: "#374151", width: 96 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={busy}
        onChange={(e) => set(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span
        style={{ fontSize: 11, color: "#6b7280", width: 52, textAlign: "right" }}
      >
        {display}
      </span>
    </div>
  );

  // True when any finish knob is off its neutral default.
  const adjustDirty =
    temperature !== 6500 ||
    saturation !== 100 ||
    highlights !== 0 ||
    shadows !== 0 ||
    vignette !== 0 ||
    dof !== 0 ||
    skyRotation !== 0 ||
    contrast !== 0 ||
    autoContrast;

  const resetAdjust = () => {
    setTemperature(6500);
    setSaturation(100);
    setHighlights(0);
    setShadows(0);
    setVignette(0);
    setDof(0);
    setSkyRotation(0);
    setContrast(0);
    setAutoContrast(false);
  };

  // --- collapsed pill ------------------------------------------------------
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          // Re-read the scene each time: the room may have changed while the
          // panel was closed. Overrides are kept, keyed by name.
          setMaterials(RenderService.listMaterials());
          setOpen(true);
        }}
        title="Photorealistic render"
        style={{
          position: "fixed",
          // Inline on the LEFT, in one row with Snap (left:16) and AI Inspiration
          // (left:116) — sits to the right of the AI Inspiration pill.
          left: 278,
          bottom: 16,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 20,
          border: "none",
          background: "var(--pz-accent-grad, #059669)",
          color: "#fff",
          boxShadow: "0 4px 14px rgba(5,150,105,0.4)",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 15 }}>✦</span> Render
      </button>
    );
  }

  // --- expanded panel ------------------------------------------------------
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        top: 90,
        bottom: 16,
        zIndex: 50,
        width: 340,
        maxHeight: "calc(100vh - 106px)",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        overflow: "hidden",
        color: "#1f2937",
        fontFamily: "inherit",
        // The header + tabs stay put; only the content below them scrolls, so
        // the tabs are always reachable no matter how tall the result image is.
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "#111827",
          color: "#fff",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700 }}>✦ Photorealistic render</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            border: "none",
            background: "transparent",
            color: "#cbd5e1",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Render / Materials tabs — keeps the tweak-and-re-render loop in one
          place: look at the image, fix a material, render again. Pinned above
          the scroll region so a tall preview image can never hide them. */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        {(["render", "materials"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 0",
              border: "none",
              borderBottom:
                tab === t ? "2px solid #2563eb" : "2px solid transparent",
              background: "transparent",
              color: tab === t ? "#2563eb" : "#9ca3af",
              fontWeight: tab === t ? 600 : 400,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            {t === "render"
              ? "Render"
              : `Materials${
                  Object.keys(overrides).length
                    ? ` (${Object.keys(overrides).length})`
                    : ""
                }`}
          </button>
        ))}
      </div>

      {/* Everything below the tabs scrolls as one region, so the header/tabs
          stay pinned and the panel never grows past the screen. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

      {tab === "materials" && (
        <div style={{ padding: 14 }}>
          {materials.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              No materials found — add some furniture to the room first.
            </div>
          ) : (
            <>
              <div
                style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}
              >
                {itemGroups.length} item(s) in this room. Set what each is made
                of — the render applies it to all of that item's surfaces.
              </div>
              <button
                type="button"
                onClick={autoAssignMaterials}
                title="Give every item a sensible material in one click (leaves your own choices untouched)"
                style={{
                  width: "100%",
                  marginBottom: 8,
                  height: 30,
                  borderRadius: 6,
                  border: "1px solid #2563eb",
                  background: "#eff6ff",
                  color: "#2563eb",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ✨ Auto-assign materials
              </button>
              <div
                style={{
                  maxHeight: 190,
                  overflowY: "auto",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                }}
              >
                {itemGroups.map((m, i) => {
                  const ov = overrides[m.memberNames[0]];
                  const isSel = selected === m.name;
                  return (
                    <div
                      key={m.name}
                      onClick={() => setSelected(m.name)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        borderTop: i ? "1px solid #f3f4f6" : "none",
                        borderLeft: isSel
                          ? "3px solid #2563eb"
                          : "3px solid transparent",
                        background: isSel ? "#eff6ff" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {/* m.color is the surface's real look — a textured
                          material's average colour, or its flat colour. An
                          override colour takes precedence. */}
                      <span
                        title={
                          m.hasTexture
                            ? `${m.color} (textured surface)`
                            : m.color
                        }
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: ov?.color || m.color,
                          border: "1px solid #cbd5e1",
                          boxShadow: m.hasTexture
                            ? "inset 0 0 0 2px rgba(255,255,255,0.5)"
                            : "none",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 11.5,
                          color: isSel ? "#1e40af" : "#374151",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={m.detail ? `${m.label} — ${m.detail}` : m.label}
                      >
                        {m.label}
                      </span>
                      {ov?.type && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "#2563eb",
                            background: "#dbeafe",
                            borderRadius: 4,
                            padding: "1px 6px",
                            flexShrink: 0,
                          }}
                        >
                          {ov.type}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* detail panel for the selected material */}
              {selMat && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid #f3f4f6",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 2,
                    }}
                  >
                    {selMat.label}
                  </div>
                  <div
                    style={{ fontSize: 10, color: "#9ca3af", marginBottom: 8 }}
                  >
                    {selMat.detail || selMat.name}
                    {selMat.itemNames.length > 1 &&
                      ` · shared by ${selMat.itemNames.length} items`}
                  </div>

                  {/* ── Albedo ── the surface's base colour. Enscape names this
                      section "Albedo"; it's what most people call "colour". */}
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "#111827",
                      marginBottom: 6,
                    }}
                  >
                    Albedo
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#6b7280", width: 58 }}>
                      Color
                    </span>
                    {/* The native colour input IS the RGB picker — clicking the
                        swatch opens the OS palette; the value is a #rrggbb hex. */}
                    <input
                      type="color"
                      value={selOv.color || selMat.color || "#cccccc"}
                      disabled={busy}
                      onChange={(e) => setColor(selMat.memberNames, e.target.value)}
                      title="Pick a colour"
                      style={{
                        width: 34,
                        height: 26,
                        padding: 0,
                        border: "1px solid #d1d5db",
                        borderRadius: 5,
                        background: "none",
                        cursor: busy ? "default" : "pointer",
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: "#374151",
                        fontFamily: "monospace",
                      }}
                    >
                      {(selOv.color || selMat.color || "#cccccc").toUpperCase()}
                    </span>
                    {selOv.color && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setColor(selMat.memberNames, "")}
                        title="Back to the model's own colour"
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#9ca3af",
                          fontSize: 11,
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        reset
                      </button>
                    )}
                  </div>
                  {selMat.hasTexture && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "#9ca3af",
                        marginTop: -8,
                        marginBottom: 10,
                      }}
                    >
                      This surface uses a texture — a colour tints it.
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "#6b7280" }}>Type</div>
                  <select
                    value={selOv.type || ""}
                    disabled={busy}
                    onChange={(e) => setType(selMat.memberNames, e.target.value)}
                    style={{
                      width: "100%",
                      height: 30,
                      borderRadius: 5,
                      border: "1px solid #d1d5db",
                      fontSize: 12,
                      marginBottom: 12,
                      background: busy ? "#f3f4f6" : "#fff",
                    }}
                  >
                    {MATERIAL_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>

                  {/* ── Reflections ── how shiny / metal the surface is. */}
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "#111827",
                      marginBottom: 6,
                    }}
                  >
                    Reflections
                  </div>

                  {/* Sliders show the preset's value until you move one, then
                      yours wins (render.py applies explicit values last). */}
                  {(
                    [
                      // [key, label, value when no type is chosen] — these are
                      // render.py's own defaults for an unclassified surface,
                      // so the sliders show what WILL be rendered. Metallic
                      // must fall back to 0: almost nothing indoors is metal.
                      ["roughness", "Roughness", 0.65],
                      ["metallic", "Metallic", 0],
                    ] as const
                  ).map(([key, label, fallback]) => {
                    const preset = TYPE_PRESETS[selOv.type || ""] || {};
                    const val = selOv[key] ?? preset[key] ?? fallback;
                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{ fontSize: 11, color: "#6b7280", width: 58 }}
                        >
                          {label}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(val * 100)}
                          disabled={busy}
                          onChange={(e) =>
                            setNum(selMat.memberNames, key, Number(e.target.value) / 100)
                          }
                          style={{ flex: 1 }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: "#374151",
                            width: 32,
                            textAlign: "right",
                          }}
                        >
                          {Math.round(val * 100)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6 }}
              >
                Applied at render time — the 3D view above won't change.
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  // Apply the material choices and run the full render.
                  setTab("render");
                  startRender(false);
                }}
                style={{
                  width: "100%",
                  marginTop: 10,
                  height: 34,
                  borderRadius: 6,
                  border: "none",
                  background: busy ? "#9ca3af" : "#111827",
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                ✦ Apply + Render
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ padding: 14, display: tab === "render" ? "block" : "none" }}>
        {/* result image */}
        {status === "done" && imageUrl && (
          <div style={{ marginBottom: 12, position: "relative" }}>
            <img
              src={imageUrl}
              alt="Render"
              style={{
                width: "100%",
                maxHeight: 200,
                objectFit: "contain",
                borderRadius: 8,
                display: "block",
                background: "#f3f4f6",
              }}
            />
            {isPreview && (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  background: "rgba(37,99,235,0.9)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                👁 Fast preview — press ✦ Render for the final
              </span>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <button
                type="button"
                onClick={downloadImage}
                style={{
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#2563eb",
                  cursor: "pointer",
                }}
              >
                ⬇ Download image
              </button>
              <button
                type="button"
                onClick={startVideo}
                disabled={videoBusy}
                title="Render a 12-second 360° orbit from inside the room (about a minute)"
                style={{
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  fontSize: 13,
                  fontWeight: 600,
                  color: videoBusy ? "#9ca3af" : "#2563eb",
                  cursor: videoBusy ? "default" : "pointer",
                }}
              >
                {videoBusy ? `▶ Making video… ${fmt(videoElapsed)}` : "▶ Play video"}
              </button>
            </div>
            {imgSave === "saved" && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  color: "#166534",
                  background: "#dcfce7",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
              >
                ✓ Saved to render history — open the Production page to select
                &amp; send it.
              </div>
            )}
            {imgSave === "error" && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  color: "#b91c1c",
                  background: "#fef2f2",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
              >
                Couldn't save this render to the history. Check your connection
                and try rendering again.
              </div>
            )}
          </div>
        )}

        {/* video result */}
        {videoStatus === "done" && videoUrl && (
          <div style={{ marginBottom: 12 }}>
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              muted
              playsInline
              style={{
                width: "100%",
                maxHeight: 200,
                borderRadius: 8,
                display: "block",
                background: "#11131a",
              }}
            />
            <button
              type="button"
              onClick={downloadVideo}
              style={{
                display: "inline-block",
                marginTop: 8,
                padding: 0,
                border: "none",
                background: "transparent",
                fontSize: 13,
                fontWeight: 600,
                color: "#2563eb",
                cursor: "pointer",
              }}
            >
              ⬇ Download video
            </button>
            {vidSave === "saved" && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  color: "#166534",
                  background: "#dcfce7",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
              >
                ✓ Video saved to render history — open the Production page to
                select &amp; send it.
              </div>
            )}
            {vidSave === "error" && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  color: "#b91c1c",
                  background: "#fef2f2",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
              >
                The video played but couldn't be saved to the render history.
                Check the browser console for “saveDraft” and tell me what it
                says.
              </div>
            )}
          </div>
        )}

        {videoStatus === "error" && videoError && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 6,
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: 12.5,
            }}
          >
            Video failed: {videoError}
          </div>
        )}

        {/* progress / status */}
        {busy && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {status === "starting" && "Preparing scene…"}
              {status === "queued" &&
                (queuePos && queuePos > 0
                  ? `Queued (position ${queuePos})…`
                  : "Queued…")}
              {status === "rendering" && "Rendering…"}{" "}
              <span style={{ color: "#6b7280", fontWeight: 400 }}>
                {fmt(elapsed)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: "#e5e7eb",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress ?? 0}%`,
                  background: "#2563eb",
                  transition: "width 0.3s",
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              CPU render — this can take a few minutes. You can keep working.
            </div>
          </div>
        )}

        {/* error */}
        {status === "error" && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              borderRadius: 6,
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: 12.5,
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        )}

        {/* auto-frame toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            fontSize: 12.5,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={autoFrame}
            disabled={busy}
            onChange={(e) => setAutoFrame(e.target.checked)}
          />
          Auto-frame the whole room
          <span style={{ color: "#6b7280" }}>
            {autoFrame ? "" : "(uses your current view)"}
          </span>
        </label>

        {/* view angle — only relevant when auto-framing */}
        {autoFrame && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 12.5, color: "#374151" }}>View angle</span>
            <select
              value={view}
              disabled={busy}
              onChange={(e) => setView(e.target.value)}
              style={{
                flex: 1,
                height: 32,
                borderRadius: 6,
                border: "1px solid #d1d5db",
                padding: "0 8px",
                fontSize: 13,
                background: busy ? "#f3f4f6" : "#fff",
              }}
            >
              {VIEWS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* lighting environment — the sky the room is lit by. Swatches rather
            than a dropdown: a colour tells you what the light will look like,
            an HDRI filename doesn't. */}
        <div style={{ marginBottom: 10 }}>
          <span
            style={{
              fontSize: 12.5,
              color: "#374151",
              display: "block",
              marginBottom: 6,
            }}
          >
            Environment
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
            }}
          >
            {ENVIRONMENTS.map((en) => {
              const active = environment === en.value;
              return (
                <button
                  key={en.value}
                  type="button"
                  disabled={busy}
                  onClick={() => setEnvironment(en.value)}
                  title={`Light the room with a ${en.label.toLowerCase()} sky`}
                  style={{
                    padding: 0,
                    border: active ? "2px solid #2563eb" : "1px solid #d1d5db",
                    borderRadius: 6,
                    background: "#fff",
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ height: 26, background: en.swatch }} />
                  <div
                    style={{
                      fontSize: 10.5,
                      color: active ? "#2563eb" : "#6b7280",
                      padding: "3px 0",
                      textAlign: "center",
                    }}
                  >
                    {en.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* engine */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: "#374151", minWidth: 62 }}>
            Engine
          </span>
          <select
            value={engine}
            disabled={busy}
            onChange={(e) => setEngine(e.target.value)}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: "0 8px",
              fontSize: 13,
              background: busy ? "#f3f4f6" : "#fff",
            }}
          >
            {ENGINES.map((en) => (
              <option key={en.value} value={en.value}>
                {en.label}
              </option>
            ))}
          </select>
        </div>

        {/* resolution */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: "#374151", minWidth: 62 }}>
            Resolution
          </span>
          <select
            value={resIdx}
            disabled={busy}
            onChange={(e) => setResIdx(Number(e.target.value))}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: "0 8px",
              fontSize: 13,
              background: busy ? "#f3f4f6" : "#fff",
            }}
          >
            {RESOLUTIONS.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* aspect */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: "#374151", minWidth: 62 }}>
            Aspect
          </span>
          <select
            value={aspectIdx}
            disabled={busy}
            onChange={(e) => setAspectIdx(Number(e.target.value))}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: "0 8px",
              fontSize: 13,
              background: busy ? "#f3f4f6" : "#fff",
            }}
          >
            {ASPECTS.map((a, i) => (
              <option key={a.label} value={i}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {/* format */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: "#374151", minWidth: 62 }}>
            Format
          </span>
          <select
            value={format}
            disabled={busy}
            onChange={(e) => setFormat(e.target.value)}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: "0 8px",
              fontSize: 13,
              background: busy ? "#f3f4f6" : "#fff",
            }}
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* brightness */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: "#374151", minWidth: 62 }}>
            Brightness
          </span>
          <input
            type="range"
            min={-3}
            max={3}
            step={0.25}
            value={exposure}
            disabled={busy}
            onChange={(e) => setExposure(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span
            style={{
              fontSize: 11,
              color: "#6b7280",
              minWidth: 30,
              textAlign: "right",
            }}
          >
            {exposure > 0 ? "+" : ""}
            {exposure}
          </span>
        </div>

        {/* denoise */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            fontSize: 12.5,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={denoise}
            disabled={busy}
            onChange={(e) => setDenoise(e.target.checked)}
          />
          Denoise (cleaner, Cycles)
        </label>

        {/* White background — camera sees a clean white backdrop, room still
            lit by the environment. Good for catalog/product shots. */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            fontSize: 12.5,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={whiteBackground}
            disabled={busy}
            onChange={(e) => setWhiteBackground(e.target.checked)}
          />
          White background
          <span style={{ color: "#6b7280" }}>(clean catalog look)</span>
        </label>

        {/* Image adjustments — the Enscape-style "finish" applied on top of the
            render. Collapsed by default so the panel stays simple; every value
            is neutral until moved, so it never changes a render on its own. */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => setShowAdjust((s) => !s)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              border: "none",
              background: "#f9fafb",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#374151",
            }}
          >
            <span>
              🎨 Image adjustments{" "}
              {adjustDirty && (
                <span style={{ color: "#059669", fontWeight: 400 }}>• on</span>
              )}
            </span>
            <span style={{ color: "#9ca3af" }}>{showAdjust ? "▲" : "▼"}</span>
          </button>

          {showAdjust && (
            <div style={{ padding: "10px 10px 4px" }}>
              {adjustRow(
                "Warm ↔ Cool",
                temperature,
                setTemperature,
                3000,
                9000,
                100,
                `${temperature}K`
              )}
              {adjustRow(
                "Saturation",
                saturation,
                setSaturation,
                0,
                200,
                5,
                `${saturation}%`
              )}
              {adjustRow(
                "Contrast",
                contrast,
                setContrast,
                -100,
                100,
                5,
                `${contrast > 0 ? "+" : ""}${contrast}`
              )}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "2px 0 10px",
                  fontSize: 11.5,
                  color: "#374151",
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={autoContrast}
                  disabled={busy}
                  onChange={(e) => setAutoContrast(e.target.checked)}
                />
                Auto-contrast (balance automatically)
              </label>
              {adjustRow(
                "Highlights",
                highlights,
                setHighlights,
                -100,
                100,
                5,
                `${highlights > 0 ? "+" : ""}${highlights}`
              )}
              {adjustRow(
                "Shadows",
                shadows,
                setShadows,
                -100,
                100,
                5,
                `${shadows > 0 ? "+" : ""}${shadows}`
              )}
              {adjustRow("Vignette", vignette, setVignette, 0, 100, 5, `${vignette}%`)}
              {adjustRow(
                "Background blur",
                dof,
                setDof,
                0,
                100,
                5,
                `${dof}%`
              )}
              {adjustRow(
                "Sky rotation",
                skyRotation,
                setSkyRotation,
                0,
                360,
                5,
                `${skyRotation}°`
              )}
              {adjustDirty && (
                <button
                  type="button"
                  onClick={resetAdjust}
                  disabled={busy}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#9ca3af",
                    fontSize: 11,
                    cursor: busy ? "default" : "pointer",
                    textDecoration: "underline",
                    padding: "2px 0 6px",
                  }}
                >
                  reset adjustments
                </button>
              )}
            </div>
          )}
        </div>

        {/* Lighting (Enscape's Atmosphere) — a time-of-day sun and room-light
            brightness. Collapsed by default; neutral until used. */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => setShowLight((s) => !s)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              border: "none",
              background: "#f9fafb",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#374151",
            }}
          >
            <span>
              ☀️ Lighting{" "}
              {(useSun || roomLights !== 100) && (
                <span style={{ color: "#059669", fontWeight: 400 }}>• on</span>
              )}
            </span>
            <span style={{ color: "#9ca3af" }}>{showLight ? "▲" : "▼"}</span>
          </button>

          {showLight && (
            <div style={{ padding: "10px 10px 4px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  fontSize: 11.5,
                  color: "#374151",
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={useSun}
                  disabled={busy}
                  onChange={(e) => setUseSun(e.target.checked)}
                />
                Use time-of-day sun
              </label>
              {useSun &&
                adjustRow(
                  "Time of day",
                  sunTime,
                  setSunTime,
                  0,
                  100,
                  5,
                  sunTime < 20
                    ? "Sunrise"
                    : sunTime < 45
                    ? "Morning"
                    : sunTime <= 55
                    ? "Noon"
                    : sunTime < 80
                    ? "Afternoon"
                    : "Sunset"
                )}
              {useSun &&
                adjustRow(
                  "Sun direction",
                  sunDir,
                  setSunDir,
                  0,
                  360,
                  5,
                  `${sunDir}°`
                )}
              {adjustRow(
                "Room lights",
                roomLights,
                setRoomLights,
                0,
                200,
                10,
                `${roomLights}%`
              )}
            </div>
          )}
        </div>

        {/* quality + action */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={samples}
            disabled={busy}
            onChange={(e) => setSamples(Number(e.target.value))}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: "0 8px",
              fontSize: 13,
              background: busy ? "#f3f4f6" : "#fff",
            }}
          >
            {QUALITY.map((q) => (
              <option key={q.samples} value={q.samples}>
                {q.label}
              </option>
            ))}
          </select>
        </div>

        {/* Full Cycles render. The fast EEVEE preview was removed — this runs
            the real photorealistic image directly. */}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => startRender(false)}
            disabled={busy}
            title="Full photorealistic Cycles render — takes minutes"
            style={{
              flex: 1,
              height: 38,
              borderRadius: 6,
              border: "none",
              background: busy ? "#9ca3af" : "#111827",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Rendering…" : "✦ Render"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default RenderViewModal;
