import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RenderService, AiRunBody } from "@pazl/services/RenderService";
import { ProjectWorkspaceService, ProjectItem, resolveFileUrl } from "@pazl/services/ProjectWorkspaceService";
import { AuthService } from "@pazl/services/authService";
import { LIGHTING, EXTERIOR_LIGHTING, LANDSCAPE, PRICE } from "./options";

// Step 2 of the AI render: the render screen (MyArchitectAI session layout).
//
//   left    Recapture view · render source · History (this project's renders)
//   centre  the image, zoom / pan, before–after compare, download, 4K
//   right   Render: scene type, rendering mode, prompt, scene context
//           Edit / Enhance / Animate: tools on the image in the centre
//
// The app has global CSS on <section> (100vw × 100vh) and <header> (absolute),
// so this screen deliberately uses plain <div>s for its cards and top bar.
//
// Every run goes through our backend (/ai-render/run); the API key never
// reaches the browser. Finished results are saved to the project's render
// history (projectitems, kind render / video, status draft) — the same rows
// the Production page lists — with the settings in `note` as JSON.

export interface RenderSource {
  /** A fresh capture from the camera step … */
  dataUrl?: string;
  /** … or a render already on the server (/uploads/renders/…). */
  fileUrl?: string;
  label: string;
  capturedAt: number;
}

interface HistoryItem {
  id: string;
  kind: "render" | "video";
  url: string;
  title: string;
  createdAt: string;
  meta: any;
  fav: boolean;
  saved: boolean;
  raw?: ProjectItem;
}

type Tab = "render" | "edit" | "enhance" | "animate";
type Balance = { configured: boolean; ok?: boolean; balance?: number; message?: string } | null;

const parseNote = (note?: string): { ai?: any; fav?: boolean; text?: string } => {
  if (!note) return {};
  try {
    const v = JSON.parse(note);
    return v && typeof v === "object" ? v : { text: note };
  } catch (e) {
    return { text: note };
  }
};

// Only results made with this AI render screen (their note carries the AI
// settings). Older renders stay in the database and on the Production page;
// they are just not listed here.
const toHistory = (it: ProjectItem): HistoryItem | null => {
  if (!it._id || !it.fileUrl) return null;
  const n = parseNote(it.note);
  if (!n.ai) return null;
  return {
    id: it._id,
    kind: it.kind === "video" ? "video" : "render",
    url: it.fileUrl,
    title: it.title || (it.kind === "video" ? "Render video" : "Render"),
    createdAt: it.createdAt || "",
    meta: n.ai || {},
    fav: !!n.fav,
    saved: true,
    raw: it,
  };
};

const stamp = (d = new Date()) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const timeOf = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};

/** A photo from disk, shrunk so the request stays small. */
const fileToDataUrl = (file: File, maxEdge = 1280): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image."));
      img.onload = () => {
        const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Could not read the image."));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.88));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

const Icon: React.FC<{ name: string; className?: string }> = ({ name, className }) => (
  <span className={`material-symbols-outlined ${className || ""}`} style={{ fontSize: 20, lineHeight: "20px" }} aria-hidden="true">
    {name}
  </span>
);

const Seg: React.FC<{ value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string }> = ({
  value,
  options,
  onChange,
  label,
}) => (
  <div className="flex rounded-[10px] bg-gray-100 p-[3px]" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={`flex-1 rounded-lg py-2 text-[13.5px] font-medium ${value === o.value ? "bg-white text-gray-900 shadow" : "text-gray-500"}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** A picture list: icon, label and a ✓ on the chosen row (Coohom / MyArchitectAI style). */
const PickList: React.FC<{
  label: string;
  options: { id: string; label: string; icon: string }[];
  value: string;
  onChange: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}> = ({ label, options, value, onChange, open, onToggle }) => {
  const chosen = options.find((o) => o.id === value) || options[0];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-2 text-left"
      >
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-gray-200">
          <Icon name={chosen.icon} />
        </span>
        <span className="flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</span>
          <span className="block text-[14px] font-semibold">{chosen.id === "none" ? "Select…" : chosen.label}</span>
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} className="text-gray-500" />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[340px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => {
                  onChange(o.id);
                  onToggle();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[14px] hover:bg-gray-50"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-gray-200">
                  <Icon name={o.icon} />
                </span>
                <span className="flex-1">{o.label}</span>
                {o.id === value && <Icon name="check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const RenderStudio: React.FC<{
  projectId: string;
  source: RenderSource;
  onSourceChange: (s: RenderSource) => void;
  onRecapture: () => void;
  onClose: () => void;
}> = ({ projectId, source, onSourceChange, onRecapture, onClose }) => {
  const [tab, setTab] = useState<Tab>("render");
  const [balance, setBalance] = useState<Balance>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const [view, setView] = useState<string>("source"); // "source" | history id
  const [error, setError] = useState<string | null>(null);

  // render tab
  const [sceneType, setSceneType] = useState<"interior" | "exterior">("interior");
  const [mode, setMode] = useState<"preserve" | "style">("preserve");
  const [prompt, setPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [lightingId, setLightingId] = useState("none"); // interior lighting
  const [extLightId, setExtLightId] = useState("none"); // exterior lighting
  const [landscapeId, setLandscapeId] = useState("none"); // exterior surroundings
  const [openList, setOpenList] = useState<null | "light" | "extLight" | "land">(null);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.6);
  const [negPrompt, setNegPrompt] = useState("");
  // tools
  const [editPrompt, setEditPrompt] = useState("");
  const [editRef, setEditRef] = useState<string | null>(null);
  const [upRes, setUpRes] = useState<"4k" | "8k">("4k");
  const [upFormat, setUpFormat] = useState("jpg");
  const [motion, setMotion] = useState("");
  const [endFrameId, setEndFrameId] = useState("");

  // job
  const [job, setJob] = useState<{ id: string; label: string; meta: any; title: string; startedAt: number; usedCapture: boolean } | null>(null);
  const [jobStep, setJobStep] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);

  // viewer
  const [compare, setCompare] = useState(true);
  const [comparePos, setComparePos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const compareRef = useRef<HTMLDivElement | null>(null);
  // The picture is sized to fit the centre frame (not its natural size, which
  // pushed the frame wider than its column and over the right panel).
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  // Keyed by URL, so a new picture never borrows the previous picture's size.
  const [natural, setNatural] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStageSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sliding = useRef(false);
  /** Put the before/after divider under the pointer (clientX), 0–100 %. */
  const slideTo = (clientX: number) => {
    const el = compareRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    setComparePos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  const refreshBalance = useCallback(() => {
    RenderService.getAiBalance().then(setBalance);
  }, []);

  useEffect(() => {
    refreshBalance();
    if (!projectId) return;
    Promise.all([ProjectWorkspaceService.list(projectId, "render"), ProjectWorkspaceService.list(projectId, "video")]).then(([r, v]) => {
      const items = [...r, ...v].map(toHistory).filter(Boolean) as HistoryItem[];
      items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      setHistory(items);
    });
  }, [projectId, refreshBalance]);

  const current = view === "source" ? null : history.find((h) => h.id === view) || null;
  const sourcePicture = source.dataUrl || resolveFileUrl(source.fileUrl);
  const shown = useMemo(() => {
    if (current) {
      // What this result was made from. Older results (and any made before the
      // backend started recording it) fall back to the current render source,
      // which is what Compare is for: the 3D view against the render.
      const recorded = current.meta?.sourceUrl ? resolveFileUrl(current.meta.sourceUrl) : null;
      const fallback = resolveFileUrl(source.fileUrl) === resolveFileUrl(current.url) ? null : sourcePicture;
      return {
        kind: current.kind,
        url: resolveFileUrl(current.url),
        before: current.kind === "video" ? null : recorded || fallback,
        name: current.title,
      };
    }
    return { kind: "render" as const, url: source.dataUrl || resolveFileUrl(source.fileUrl), before: null, name: source.label };
  }, [current, source, sourcePicture]);

  const fitted = useMemo(() => {
    if (!natural || natural.url !== shown.url || !natural.w || !natural.h || !stageSize.w || !stageSize.h) return null;
    const pad = 24;
    const s = Math.min((stageSize.w - pad) / natural.w, (stageSize.h - pad) / natural.h);
    return s > 0 ? { w: Math.round(natural.w * s), h: Math.round(natural.h * s) } : null;
  }, [natural, stageSize, shown.url]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setComparePos(50);
  }, [view]);

  // The before/after divider is live (the pan tool drags the picture instead).
  const comparing = compare && !!shown.before && !panMode;

  // Out of credit counts as not OK: every tool costs at least $0.01.
  const outOfCredit = !!balance && balance.configured && balance.ok !== false && typeof balance.balance === "number" && balance.balance < PRICE.autoPrompt;
  const creditOk = !balance || (balance.configured && balance.ok !== false && !outOfCredit);
  const busy = !!job;

  // ── running a tool ────────────────────────────────────────────────────────
  const start = async (body: AiRunBody, meta: any, title: string, label: string) => {
    setError(null);
    try {
      const { jobId } = await RenderService.runAi(body);
      setJob({ id: jobId, meta, title, label, startedAt: Date.now(), usedCapture: !!body.image && body.image === source.dataUrl });
      setJobStep(label);
      setElapsed(0);
    } catch (e: any) {
      setError(e?.message || "Could not start.");
    }
  };

  const finish = useCallback(
    async (result: any, done: NonNullable<typeof job>) => {
      const kind: "render" | "video" = result.kind === "video" ? "video" : "render";
      const url = result.videoUrl || result.imageUrl;
      const meta = { ...done.meta, sourceUrl: result.sourceUrl || done.meta.sourceUrl || null, cost: result.cost, requestId: result.requestId };
      let item: HistoryItem = { id: `local-${done.id}`, kind, url, title: done.title, createdAt: new Date().toISOString(), meta, fav: false, saved: false };
      try {
        const res = await ProjectWorkspaceService.create({
          projectId,
          kind,
          fileUrl: url,
          mimeType: result.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"),
          status: "draft",
          title: done.title,
          note: JSON.stringify({ ai: meta, fav: false }),
          createdBy: (AuthService.getCurrentUser() as any)?.name || undefined,
        });
        if (res && res._id) {
          item = { ...item, id: res._id, saved: true, raw: res };
          try {
            window.dispatchEvent(new CustomEvent("pazl:render-saved"));
          } catch (_) {
            /* the Production tab reloads on open anyway */
          }
        }
      } catch (e) {
        console.error("AI render: saving to history failed", e);
      }
      if (!item.saved) setError("The result is shown here but could not be saved to the project's render history.");
      // A fresh capture was stored by the backend: reuse it, don't upload it again.
      if (done.usedCapture && result.sourceUrl && !source.fileUrl) onSourceChange({ ...source, fileUrl: result.sourceUrl });
      setHistory((h) => [item, ...h]);
      setView(item.id);
      setCompare(true);
      if (typeof result.balance === "number") setBalance({ configured: true, ok: true, balance: result.balance });
    },
    [projectId, source, onSourceChange]
  );

  useEffect(() => {
    if (!job) return;
    let stopped = false;
    const tick = async () => {
      try {
        const st = await RenderService.pollAiRenderStatus(job.id);
        if (stopped) return;
        if (st.step) setJobStep(st.step);
        if (st.stage === "done" && st.result) {
          stopped = true;
          const done = job;
          setJob(null);
          await finish(st.result, done);
        } else if (st.stage === "error") {
          stopped = true;
          setJob(null);
          setError(st.error || "The AI render failed.");
          if (typeof (st as any).balance === "number") setBalance({ configured: true, ok: true, balance: (st as any).balance });
        }
      } catch (e: any) {
        if (!stopped) {
          stopped = true;
          setJob(null);
          setError("Lost connection to the render job. It may still finish — check History in a minute.");
        }
      }
    };
    const t = setInterval(tick, 1500);
    const c = setInterval(() => setElapsed(Math.round((Date.now() - job.startedAt) / 1000)), 1000);
    return () => {
      stopped = true;
      clearInterval(t);
      clearInterval(c);
    };
  }, [job, finish]);

  const sourceRef = (): Pick<AiRunBody, "image" | "sourceUrl"> =>
    source.fileUrl ? { sourceUrl: source.fileUrl } : { image: source.dataUrl };
  const shownRef = (): Pick<AiRunBody, "image" | "sourceUrl"> | null => {
    if (current) return current.kind === "render" ? { sourceUrl: current.url } : null;
    return sourceRef();
  };

  const lighting = LIGHTING.find((l) => l.id === lightingId) || LIGHTING[0];
  const extLight = EXTERIOR_LIGHTING.find((l) => l.id === extLightId) || EXTERIOR_LIGHTING[0];
  const landscape = LANDSCAPE.find((l) => l.id === landscapeId) || LANDSCAPE[0];
  // A lighting choice runs a second call (relight); landscape is prompt words.
  const relight = sceneType === "interior" ? !!lighting.lighting : !!extLight.timeOfDay;

  const renderNow = () => {
    if (mode === "style") {
      if (!refImage) return setError("Add a reference photo for Apply style.");
      return start(
        { op: "style", sceneType, ...sourceRef(), referenceImage: refImage, strength, prompt: prompt || undefined, negativePrompt: negPrompt || undefined },
        { op: "style", sceneType, prompt, strength },
        `AI style · ${sceneType === "interior" ? "Interior" : "Exterior"} — ${stamp()}`,
        "Applying the style"
      );
    }
    const words = sceneType === "interior" ? lighting.promptWords : landscape.promptWords;
    const fullPrompt = [prompt.trim(), words].filter(Boolean).join(", ");
    const context = (
      sceneType === "interior"
        ? [lighting.id !== "none" ? lighting.label : ""]
        : [extLight.id !== "none" ? extLight.label : "", landscape.id !== "none" ? landscape.label : ""]
    )
      .filter(Boolean)
      .join(" · ");
    return start(
      {
        op: "render",
        sceneType,
        ...sourceRef(),
        prompt: fullPrompt || undefined,
        lighting: sceneType === "interior" ? lighting.lighting : undefined,
        timeOfDay: sceneType === "exterior" ? extLight.timeOfDay : undefined,
      },
      { op: "render", sceneType, prompt, context },
      `AI render · ${sceneType === "interior" ? "Interior" : "Exterior"}${context ? ` · ${context}` : ""} — ${stamp()}`,
      sceneType === "interior" ? "Rendering interior" : "Rendering exterior"
    );
  };

  const autoPrompt = async () => {
    setAutoBusy(true);
    setError(null);
    try {
      const res = await RenderService.autoPrompt(sourceRef());
      setPrompt(res.prompt || "");
      setPromptOpen(true);
      if (typeof res.balance === "number") setBalance({ configured: true, ok: true, balance: res.balance });
    } catch (e: any) {
      setError(e?.message || "Auto prompt failed.");
    } finally {
      setAutoBusy(false);
    }
  };

  const runTool = (op: "edit" | "upscale" | "animate", upscaleTo?: "4k" | "8k") => {
    const target = shownRef();
    if (!target) return setError("Pick an image (not a video) in History first.");
    const base = current ? current.title.replace(/ — .*$/, "") : "3D view";
    if (op === "edit") {
      if (!editPrompt.trim()) return setError("Describe the change first.");
      return start(
        { op, ...target, prompt: editPrompt.trim(), referenceImage: editRef || undefined },
        { op, prompt: editPrompt.trim(), sourceUrl: current?.url || source.fileUrl || null },
        `AI edit · ${editPrompt.trim().slice(0, 40)} — ${stamp()}`,
        "Applying the edit"
      );
    }
    if (op === "upscale") {
      const res = upscaleTo || upRes;
      const format = res === "8k" && upFormat === "png" ? "jpg" : upFormat;
      return start(
        { op, ...target, targetResolution: res, outputFormat: format },
        { op, targetResolution: res, sourceUrl: current?.url || source.fileUrl || null },
        `${res.toUpperCase()} · ${base} — ${stamp()}`,
        `Upscaling to ${res.toUpperCase()}`
      );
    }
    if (!motion.trim()) return setError("Describe the camera motion first.");
    const end = history.find((h) => h.id === endFrameId && h.kind === "render");
    return start(
      { op, ...target, prompt: motion.trim(), endFrameUrl: end ? end.url : undefined },
      { op, prompt: motion.trim(), sourceUrl: current?.url || source.fileUrl || null },
      `AI video · ${motion.trim().slice(0, 40)} — ${stamp()}`,
      "Animating (about a minute)"
    );
  };

  const toggleFav = async (it: HistoryItem) => {
    const fav = !it.fav;
    setHistory((h) => h.map((x) => (x.id === it.id ? { ...x, fav } : x)));
    if (!it.saved) return;
    const n = parseNote(it.raw?.note);
    await ProjectWorkspaceService.update(it.id, { note: JSON.stringify({ ...n, fav }) });
  };

  const download = async () => {
    const ext = (shown.url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1] || (shown.url.startsWith("data:") ? "jpg" : "jpg");
    const name = `${(shown.name || "render").replace(/[^\w.-]+/g, "-").slice(0, 60)}.${ext}`;
    try {
      let href = shown.url;
      if (!href.startsWith("data:")) {
        const res = await fetch(href);
        href = URL.createObjectURL(await res.blob());
      }
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (href.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(href), 3000);
    } catch (e) {
      setError("Download failed. Try again.");
    }
  };

  const list = history.filter((h) => !favOnly || h.fav);
  const order = ["source", ...list.map((h) => h.id)];
  const idx = order.indexOf(view);
  const images = history.filter((h) => h.kind === "render");


  // ── pieces ────────────────────────────────────────────────────────────────
  const thumb = (url: string, kind: "render" | "video") =>
    kind === "video" ? (
      <div className="grid h-[46px] w-[70px] flex-none place-items-center rounded-md bg-gray-900 text-white">
        <Icon name="play_circle" />
      </div>
    ) : (
      <img src={url} alt="" className="h-[46px] w-[70px] flex-none rounded-md object-cover" />
    );

  const primary = (label: string, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy || !creditOk}
      className="w-full rounded-xl bg-gray-900 py-3 text-[14.5px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
    >
      {busy ? "Working…" : label}
    </button>
  );

  const renderPanel = (
    <>
      <div className="rounded-2xl border border-gray-200 bg-white p-3">
        <div className="mb-2 text-[14px] font-semibold">Scene type</div>
        <Seg
          label="Scene type"
          value={sceneType}
          onChange={(v) => setSceneType(v as any)}
          options={[
            { value: "interior", label: "Interior" },
            { value: "exterior", label: "Exterior" },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2.5 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="text-[14px] font-semibold">Rendering mode</div>

        {/* Apply style is hidden: one mode, so this reads as a heading rather
            than a choice. The style-transfer code below and in the backend is
            untouched, so it can be shown again by restoring its card. */}
        <div className="rounded-xl border border-gray-200 p-3">
          <div>
            <b className="text-[14px]">Preserve existing textures</b>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-gray-500">Adds photorealism while keeping your colours and materials unchanged.</span>
          </div>
          {mode === "preserve" && (
            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-center justify-between text-[13px] text-gray-600">
                  <button type="button" className="flex items-center gap-1" onClick={() => setPromptOpen((o) => !o)} aria-expanded={promptOpen}>
                    Prompt (optional) <Icon name={promptOpen ? "remove" : "add"} className="!text-[18px]" />
                  </button>
                  <button type="button" disabled={autoBusy || busy || !creditOk} onClick={autoPrompt} className="font-semibold text-indigo-700 disabled:text-gray-400" title="Describe this view as a detailed prompt">
                    {autoBusy ? "Writing…" : "✨ Auto prompt"}
                  </button>
                </div>
                {promptOpen && (
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    placeholder="e.g. walnut cabinets, matte concrete floor, indoor plants"
                    className="mt-1.5 w-full resize-y rounded-lg border border-gray-300 p-2 text-[13px]"
                  />
                )}
              </div>
              <div>
                <div className="mb-1.5 text-[13px] text-gray-600">Scene context (optional)</div>
                {sceneType === "interior" ? (
                  <PickList
                    label="Lighting"
                    options={LIGHTING}
                    value={lightingId}
                    onChange={setLightingId}
                    open={openList === "light"}
                    onToggle={() => setOpenList((o) => (o === "light" ? null : "light"))}
                  />
                ) : (
                  <div className="grid gap-2">
                    <PickList
                      label="Lighting"
                      options={EXTERIOR_LIGHTING}
                      value={extLightId}
                      onChange={setExtLightId}
                      open={openList === "extLight"}
                      onToggle={() => setOpenList((o) => (o === "extLight" ? null : "extLight"))}
                    />
                    <PickList
                      label="Landscape"
                      options={LANDSCAPE}
                      value={landscapeId}
                      onChange={setLandscapeId}
                      open={openList === "land"}
                      onToggle={() => setOpenList((o) => (o === "land" ? null : "land"))}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
      <div className="sticky bottom-0 bg-[#f6f6f8] pb-1 pt-1">
        {primary("Render", renderNow)}
        <div className="mt-1.5 text-center text-[12px] text-gray-500">
          {relight ? "About 1–1½ min (render + lighting)" : "About 15–30 s"}
        </div>
      </div>
    </>
  );

  const toolTarget = current ? (current.kind === "video" ? "Pick an image, not a video" : current.title) : `Render source · ${source.label}`;

  const toolPanel = (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-3">
      <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-600">
        Works on: <b className="text-gray-800">{toolTarget}</b>
      </div>
      {tab === "edit" && (
        <>
          <label className="text-[13px] text-gray-600">
            Describe the change
            <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={3} placeholder="make the floor white marble" className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px] text-gray-900" />
          </label>
          <div className="flex items-center gap-2 text-[13px]">
            {editRef && <img src={editRef} alt="Material" className="h-12 w-16 rounded-lg object-cover" />}
            <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 font-medium">
              {editRef ? "Replace material photo" : "+ Material photo (optional)"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setEditRef(await fileToDataUrl(f).catch(() => null));
                }}
              />
            </label>
            {editRef && (
              <button type="button" className="text-gray-500" onClick={() => setEditRef(null)}>
                Remove
              </button>
            )}
          </div>
          {editRef && <div className="text-[12px] text-gray-500">Refer to it as "the attached image", e.g. "apply the attached material on the floor".</div>}
          {primary("Apply edit", () => runTool("edit"), !shownRef())}
          <div className="text-center text-[12px] text-gray-500">Usually 1–3 s</div>
        </>
      )}
      {tab === "enhance" && (
        <>
          <div className="text-[13px] text-gray-600">Size</div>
          <Seg
            label="Upscale size"
            value={upRes}
            onChange={(v) => {
              setUpRes(v as any);
              if (v === "8k" && upFormat === "png") setUpFormat("jpg");
            }}
            options={[
              { value: "4k", label: "4K · 3840 px" },
              { value: "8k", label: "8K · 7680 px" },
            ]}
          />
          <div className="text-[13px] text-gray-600">Format</div>
          <div className="flex gap-1.5">
            {["jpg", "webp", "png"].map((f) => (
              <button
                key={f}
                type="button"
                disabled={f === "png" && upRes === "8k"}
                onClick={() => setUpFormat(f)}
                className={`rounded-full border px-3 py-1 text-[12.5px] disabled:opacity-40 ${upFormat === f ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`}
              >
                {f.toUpperCase()}
                {f === "png" ? " (4K only)" : ""}
              </button>
            ))}
          </div>
          {primary("Upscale", () => runTool("upscale"), !shownRef())}
          {upRes === "8k" && <div className="text-center text-[12px] text-gray-500">8K files are large — they can't be used as a source again.</div>}
        </>
      )}
      {tab === "animate" && (
        <>
          <label className="text-[13px] text-gray-600">
            Camera motion
            <textarea value={motion} onChange={(e) => setMotion(e.target.value)} rows={3} placeholder="slow dolly in towards the cabinets" className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px] text-gray-900" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {["Slow dolly in", "Pan left to right", "Gentle orbit around the room", "Rise up slowly"].map((s) => (
              <button key={s} type="button" onClick={() => setMotion(s.toLowerCase())} className="rounded-full border border-gray-300 px-2.5 py-0.5 text-[12px]">
                {s}
              </button>
            ))}
          </div>
          <label className="text-[13px] text-gray-600">
            End frame (optional)
            <select value={endFrameId} onChange={(e) => setEndFrameId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px] text-gray-900">
              <option value="">None — one image</option>
              {images
                .filter((h) => h.id !== current?.id)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}
                  </option>
                ))}
            </select>
          </label>
          {primary("Create video", () => runTool("animate"), !shownRef())}
          <div className="text-center text-[12px] text-gray-500">Takes 60–90 s</div>
        </>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[1200] grid grid-rows-[58px_minmax(0,1fr)] bg-[#f6f6f8] text-gray-900" role="dialog" aria-label="AI render">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4">
        <div className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="photo_camera" className="text-indigo-700" /> Render
        </div>
        {/* The Render / Edit / Enhance / Animate tabs are hidden: this screen
            always shows the Render panel. Their panels stay in the code below
            (toolPanel) so they can be brought back by restoring this row.
            Enhance is still reachable from the 4K button in the toolbar. */}
        <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium">
          ← Back to design
        </button>
      </div>

      <main className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)_330px] gap-3.5 p-3.5">
        {/* left */}
        <aside className="flex min-h-0 flex-col gap-3">
          <button type="button" onClick={onRecapture} disabled={busy} className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14.5px] font-medium disabled:opacity-50">
            Recapture view <Icon name="arrow_forward" />
          </button>
          <div className="rounded-2xl border border-gray-200 bg-white p-3">
            <div className="text-[12.5px] text-gray-500">Session started {timeOf(new Date(source.capturedAt).toISOString())}</div>
            <div className="mt-3 text-[14px] font-semibold">Render source</div>
            <button
              type="button"
              onClick={() => setView("source")}
              className={`mt-2 flex w-full items-center gap-2.5 rounded-xl border-2 p-2 text-left ${view === "source" ? "border-emerald-500 bg-emerald-50" : "border-emerald-300 bg-white"}`}
            >
              <img src={source.dataUrl || resolveFileUrl(source.fileUrl)} alt="" className="h-[46px] w-[70px] rounded-md object-cover" />
              <span className="min-w-0">
                <b className="block truncate text-[13px]">{source.label}</b>
                <span className="text-[12px] text-gray-500">{timeOf(new Date(source.capturedAt).toISOString())}</span>
              </span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold">History</span>
              <button type="button" onClick={() => setFavOnly((f) => !f)} aria-pressed={favOnly} title={favOnly ? "Show all" : "Show favourites only"} className={favOnly ? "text-red-500" : "text-gray-600"}>
                <Icon name="favorite" />
              </button>
            </div>
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
              {list.length === 0 && <div className="py-6 text-center text-[13px] text-gray-500">{favOnly ? "No favourites yet." : "Renders you make appear here."}</div>}
              {list.map((h) => (
                <div
                  key={h.id}
                  className={`flex items-center gap-2 rounded-xl bg-white p-1.5 ${view === h.id ? "border-2 border-gray-900" : "border border-gray-200"}`}
                >
                  <button type="button" onClick={() => setView(h.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {thumb(resolveFileUrl(h.url), h.kind)}
                    <span className="min-w-0">
                      <b className="block truncate text-[12.5px]">{h.title.replace(/ — .*$/, "")}</b>
                      <span className="block text-[11.5px] text-gray-500">{timeOf(h.createdAt)}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => toggleFav(h)} aria-pressed={h.fav} aria-label={h.fav ? "Remove from favourites" : "Add to favourites"} className={h.fav ? "text-red-500" : "text-gray-300 hover:text-gray-500"}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: h.fav ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">
                      favorite
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* centre */}
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-2.5">
          <div
            ref={stageRef}
            className="relative grid min-h-0 min-w-0 place-items-center overflow-hidden rounded-2xl border border-gray-200 bg-white"
            onMouseDown={(e) => {
              if (!panMode) return;
              drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
            }}
            onMouseMove={(e) => {
              if (!drag.current) return;
              setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
            }}
            onMouseUp={() => (drag.current = null)}
            onMouseLeave={() => (drag.current = null)}
            style={{ cursor: panMode ? (drag.current ? "grabbing" : "grab") : "default" }}
          >
            <div className="relative max-h-full max-w-full" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: drag.current ? "none" : "transform .15s" }}>
              {shown.kind === "video" ? (
                <video
                  src={shown.url}
                  controls
                  onLoadedMetadata={(e) => setNatural({ url: shown.url, w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
                  className="block rounded"
                  style={fitted ? { width: fitted.w, height: fitted.h } : { maxWidth: "100%", maxHeight: "100%" }}
                />
              ) : (
                <div
                  ref={compareRef}
                  className="relative select-none"
                  // Before / after: press anywhere on the picture (or the knob)
                  // and drag — the divider follows the pointer exactly. Pointer
                  // capture keeps it following outside the picture too. The
                  // rect already includes the zoom, so this stays exact zoomed.
                  onPointerDown={(e) => {
                    if (!comparing) return;
                    e.preventDefault();
                    sliding.current = true;
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch (_) {
                      /* capture is best-effort */
                    }
                    slideTo(e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (sliding.current) slideTo(e.clientX);
                  }}
                  onPointerUp={(e) => {
                    sliding.current = false;
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch (_) {
                      /* already released */
                    }
                  }}
                  onPointerCancel={() => (sliding.current = false)}
                  style={{
                    width: fitted ? fitted.w : undefined,
                    height: fitted ? fitted.h : undefined,
                    visibility: fitted ? "visible" : "hidden",
                    ...(comparing ? { cursor: "ew-resize", touchAction: "none" } : {}),
                  }}
                >
                  <img
                    src={shown.url}
                    alt={shown.name}
                    onLoad={(e) => setNatural({ url: shown.url, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="block h-full w-full select-none rounded object-contain"
                    draggable={false}
                  />
                  {comparing && (
                    <>
                      <img
                        src={shown.before as string}
                        alt="Before"
                        className="pointer-events-none absolute inset-0 h-full w-full select-none rounded object-cover"
                        style={{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }}
                        draggable={false}
                      />
                      <div
                        className="pointer-events-none absolute bottom-0 top-0 bg-white shadow-[0_0_4px_rgba(0,0,0,0.45)]"
                        style={{ left: `${comparePos}%`, width: 2 / zoom, transform: "translateX(-50%)" }}
                      />
                      <div
                        role="slider"
                        tabIndex={0}
                        aria-label="Before and after divider"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(comparePos)}
                        onKeyDown={(e) => {
                          const step = e.shiftKey ? 10 : 2;
                          const next =
                            e.key === "ArrowLeft" ? comparePos - step : e.key === "ArrowRight" ? comparePos + step : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
                          if (next === null) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setComparePos(Math.min(100, Math.max(0, next)));
                        }}
                        className="absolute top-1/2 grid h-10 w-10 cursor-ew-resize place-items-center rounded-full border-2 border-white bg-gray-900/80 text-white shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-indigo-400"
                        style={{ left: `${comparePos}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden="true">
                          code
                        </span>
                      </div>
                      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white" style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top left" }}>
                        Before
                      </span>
                      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white" style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top right" }}>
                        After
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="absolute right-3 top-1/2 grid -translate-y-1/2 overflow-hidden rounded-lg bg-gray-500/90 text-white">
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="grid h-9 w-9 place-items-center">
                <Icon name="add" />
              </button>
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.25))} className="grid h-9 w-9 place-items-center border-t border-white/30">
                <Icon name="remove" />
              </button>
            </div>
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-[2px]" role="status" aria-live="polite">
                <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-xl">
                  <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-900" />
                  <div>
                    <div className="text-[14.5px] font-semibold">{jobStep || job?.label}…</div>
                    <div className="text-[12.5px] text-gray-500 tabular-nums">{elapsed} s · you can close this — it saves to History</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-center">
            <div className="flex items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 text-[13px]">
              <button type="button" title="Previous" disabled={idx <= 0} onClick={() => setView(order[idx - 1])} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-gray-100 disabled:opacity-30">
                <Icon name="undo" />
              </button>
              <button type="button" title="Next" disabled={idx < 0 || idx >= order.length - 1} onClick={() => setView(order[idx + 1])} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-gray-100 disabled:opacity-30">
                <Icon name="redo" />
              </button>
              <button type="button" title="Pan" aria-pressed={panMode} onClick={() => setPanMode((p) => !p)} className={`grid h-9 w-9 place-items-center rounded-lg ${panMode ? "bg-gray-900 text-white" : "hover:bg-gray-100"}`}>
                <Icon name="pan_tool" />
              </button>
              <span className="mx-1 h-6 w-px bg-gray-200" />
              <button
                type="button"
                disabled={!current || current.kind !== "render"}
                onClick={() => current && onSourceChange({ fileUrl: current.url, label: current.title.replace(/ — .*$/, ""), capturedAt: Date.now() })}
                className="flex h-9 items-center gap-1 rounded-lg border border-gray-200 px-2.5 hover:bg-gray-50 disabled:opacity-40"
                title="Render again from this image"
              >
                <Icon name="input" /> Use as source
              </button>
              <button type="button" onClick={download} className="flex h-9 items-center gap-1 rounded-lg border border-gray-200 px-2.5 hover:bg-gray-50">
                <Icon name="download" /> Download
              </button>
              <button
                type="button"
                disabled={busy || !creditOk || shown.kind === "video"}
                onClick={() => runTool("upscale", "4k")}
                className="h-9 rounded-lg border border-gray-200 px-2.5 font-semibold hover:bg-gray-50 disabled:opacity-40"
                title="Upscale to 4K"
              >
                4K
              </button>
              <button
                type="button"
                disabled={!shown.before}
                aria-pressed={compare}
                onClick={() => setCompare((c) => !c)}
                className={`flex h-9 items-center gap-1 rounded-lg px-2.5 disabled:opacity-40 ${compare && shown.before ? "bg-gray-900 text-white" : "border border-gray-200 hover:bg-gray-50"}`}
                title="Before / after"
              >
                <Icon name="compare" /> Compare
              </button>
            </div>
          </div>
        </div>

        {/* right */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[13px] text-red-800" role="alert">
              <Icon name="error" />
              <span className="flex-1">{error}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}
          {balance && !creditOk && (
            <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
              {outOfCredit
                ? "The MyArchitectAI balance is $0.00. Top up in the MyArchitectAI portal (Billing), then check again."
                : balance.message || "AI render is not available."}{" "}
              <button type="button" className="font-semibold underline" onClick={refreshBalance}>
                Check again
              </button>
            </div>
          )}
          {tab === "render" ? renderPanel : toolPanel}
        </aside>
      </main>
    </div>,
    document.body
  );
};

export default RenderStudio;
