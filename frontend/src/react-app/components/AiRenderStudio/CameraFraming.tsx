import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BlueprintInterface from "@pazl/blueprint-interface";
import { ASPECTS, Aspect, EYE_HEIGHTS } from "./options";

// Step 1 of the AI render: frame the shot on the live 3D view.
//
// The overlay sits exactly over the 3D canvas. Only the white frame is
// captured; everything outside it is dimmed. The viewer is put in framing mode
// (Viewer3d.beginRenderFraming): a level lens and turn-on-the-spot look-around,
// with W/A/S/D (or arrows / the mouse wheel) to walk and Q/E for height.

export interface FramedCapture {
  dataUrl: string;
  aspect: Aspect;
  capturedAt: number;
  viewName?: string;
}

interface SavedView {
  name: string;
  position: number[];
  target: number[];
  fov: number;
}

const viewer = () => (BlueprintInterface as any)?.blueprint3d?.roomplanner || null;

const viewsKey = (projectId: string) => `pazl-render-views:${projectId || "none"}`;
const loadViews = (projectId: string): SavedView[] => {
  try {
    const v = JSON.parse(localStorage.getItem(viewsKey(projectId)) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
};
const storeViews = (projectId: string, views: SavedView[]) => {
  try {
    localStorage.setItem(viewsKey(projectId), JSON.stringify(views.slice(0, 12)));
  } catch (e) {
    /* storage unavailable: views last for this session only */
  }
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
};

const CameraFraming: React.FC<{
  projectId: string;
  initialAspect?: Aspect;
  onCancel: () => void;
  onUse: (capture: FramedCapture) => void;
}> = ({ projectId, initialAspect, onCancel, onUse }) => {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [aspect, setAspect] = useState<Aspect>(initialAspect || "16:9");
  const [cam, setCam] = useState<any>(null);
  const [lens, setLens] = useState(24);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(projectId));
  const [naming, setNaming] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Enter framing mode once; the parent ends it when the render screen closes.
  useEffect(() => {
    const v = viewer();
    if (!v || !v.beginRenderFraming) {
      setError("The 3D view is not ready yet.");
      return;
    }
    v.beginRenderFraming();
    setLens(Math.round(v.getRenderLens()));
    canvasRef.current = v.renderer?.domElement || null;
  }, []);

  // Follow the canvas (sidebars, window resize) and the camera checks.
  useEffect(() => {
    const tick = () => {
      const v = viewer();
      const c = canvasRef.current || v?.renderer?.domElement;
      if (c) {
        const r = c.getBoundingClientRect();
        setRect((old) =>
          old && old.left === r.left && old.top === r.top && old.width === r.width && old.height === r.height
            ? old
            : { left: r.left, top: r.top, width: r.width, height: r.height }
        );
      }
      if (v?.getRenderCameraState) setCam(v.getRenderCameraState());
    };
    tick();
    const t = setInterval(tick, 250);
    window.addEventListener("resize", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", tick);
    };
  }, []);

  // Walk with the keyboard; the mouse wheel walks too (instead of zooming the
  // lens, which would silently change the framing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = viewer();
      if (!v?.walkRenderCamera) return;
      const step = e.shiftKey ? 60 : 20;
      const k = e.key.toLowerCase();
      const move: Record<string, [number, number, number]> = {
        w: [step, 0, 0],
        arrowup: [step, 0, 0],
        s: [-step, 0, 0],
        arrowdown: [-step, 0, 0],
        a: [0, -step, 0],
        arrowleft: [0, -step, 0],
        d: [0, step, 0],
        arrowright: [0, step, 0],
        e: [0, 0, 10],
        q: [0, 0, -10],
      };
      if (!move[k]) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveView(undefined);
      v.walkRenderCamera(...move[k]);
    };
    const onWheel = (e: WheelEvent) => {
      const v = viewer();
      const c = canvasRef.current;
      if (!v?.walkRenderCamera || !c || !(e.target instanceof Node) || !c.parentElement?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveView(undefined);
      v.walkRenderCamera(e.deltaY < 0 ? 25 : -25, 0, 0);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, []);

  // The frame: the largest box of the chosen shape inside the canvas, leaving
  // room for the bars and the saved views.
  const frame = useMemo(() => {
    if (!rect) return null;
    const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio || 16 / 9;
    const side = Math.min(150, Math.max(24, rect.width * 0.11));
    const top = 76;
    const bottom = 70;
    const availW = Math.max(80, rect.width - side * 2);
    const availH = Math.max(80, rect.height - top - bottom);
    let w = availW;
    let h = w / ratio;
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    return { x: (rect.width - w) / 2, y: top + (availH - h) / 2, width: w, height: h };
  }, [rect, aspect]);

  const eyeCm = cam ? Math.round(cam.heightCm) : 150;

  const fixCamera = () => {
    const v = viewer();
    if (v?.fixRenderCamera && !v.fixRenderCamera()) {
      setError("Draw a room first — there is no room to stand in.");
    } else {
      setError(null);
      setActiveView(undefined);
    }
  };

  const saveView = () => {
    const v = viewer();
    const name = (naming || "").trim();
    if (!v?.getRenderView || !name) return;
    const next = [{ name, ...v.getRenderView() }, ...views.filter((x) => x.name !== name)];
    setViews(next);
    storeViews(projectId, next);
    setNaming(null);
    setActiveView(name);
  };

  const captureView = useCallback(() => {
    const v = viewer();
    if (!v?.captureRegionAsDataUrl || !frame) return;
    const dataUrl = v.captureRegionAsDataUrl(frame, 1536, 0.9);
    if (!dataUrl) {
      setError("Could not capture the 3D view. Try again.");
      return;
    }
    onUse({ dataUrl, aspect, capturedAt: Date.now(), viewName: activeView });
  }, [frame, aspect, onUse, activeView]);

  // Nothing to frame while the 3D view is hidden (another page is showing).
  if (!rect || !frame || rect.width < 80 || rect.height < 80) return null;

  // No check pills on screen; the orange "Fix camera" button in the top bar
  // appears when the camera is outside the room or too close to a wall.
  const needsFix = cam && (!cam.inside || cam.nearWall) && cam.hasRoom;

  return createPortal(
    <div
      className="fixed z-[1150] pointer-events-none select-none"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-label="Frame your shot"
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute outline outline-2 outline-white"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            boxShadow: "0 0 0 9999px rgba(12,13,18,0.55)",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,.35) calc(33.33% - 0.5px), rgba(255,255,255,.35) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,.35) calc(66.66% - 0.5px), rgba(255,255,255,.35) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)), linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,.35) calc(33.33% - 0.5px), rgba(255,255,255,.35) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,.35) calc(66.66% - 0.5px), rgba(255,255,255,.35) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px))",
            }}
          />
        </div>
      </div>

      {/* top bar */}
      <div className="absolute left-1/2 top-3 -translate-x-1/2 pointer-events-auto flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] text-gray-800 shadow-lg">
        <b className="px-1">Frame your shot</b>
        <div className="flex gap-1" role="radiogroup" aria-label="Image shape">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={aspect === a.id}
              onClick={() => setAspect(a.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${aspect === a.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white"}`}
            >
              {a.id}
            </button>
          ))}
        </div>
        <span className="h-5 w-px bg-gray-200" />
        <label className="flex items-center gap-1.5 text-xs">
          Height
          <select
            className="rounded-md border border-gray-300 px-1.5 py-0.5 text-xs"
            value={EYE_HEIGHTS.some((h) => Math.abs(h.cm - eyeCm) < 3) ? EYE_HEIGHTS.find((h) => Math.abs(h.cm - eyeCm) < 3)!.cm : ""}
            onChange={(e) => {
              viewer()?.setRenderEyeHeight?.(Number(e.target.value));
              setActiveView(undefined);
            }}
          >
            {!EYE_HEIGHTS.some((h) => Math.abs(h.cm - eyeCm) < 3) && <option value="">{(eyeCm / 100).toFixed(2)} m</option>}
            {EYE_HEIGHTS.map((h) => (
              <option key={h.cm} value={h.cm}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          Lens
          <input
            type="range"
            min={14}
            max={50}
            step={1}
            value={lens}
            onChange={(e) => {
              const mm = Number(e.target.value);
              setLens(mm);
              viewer()?.setRenderLens?.(mm);
            }}
            aria-label="Lens width in millimetres"
            className="w-24 accent-gray-900"
          />
          <span className="w-11 tabular-nums">{lens} mm</span>
        </label>
        {needsFix && (
          <button type="button" onClick={fixCamera} className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white">
            Fix camera
          </button>
        )}
      </div>

      {/* saved views */}
      <div className="absolute right-3 top-[70px] pointer-events-auto grid w-[124px] gap-2">
        <div className="px-0.5 text-[11px] font-semibold text-white drop-shadow">Saved views</div>
        {views.map((v) => (
          <div key={v.name} className={`group relative rounded-lg bg-white p-1.5 text-[11.5px] shadow ${activeView === v.name ? "ring-2 ring-emerald-500" : ""}`}>
            <button
              type="button"
              className="block w-full truncate text-left font-medium"
              title={`Go to "${v.name}"`}
              onClick={() => {
                viewer()?.applyRenderView?.(v);
                setLens(Math.round(viewer()?.getRenderLens?.() || lens));
                setActiveView(v.name);
              }}
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              className="absolute right-1 top-1 hidden text-gray-400 hover:text-red-600 group-hover:block"
              onClick={() => {
                const next = views.filter((x) => x.name !== v.name);
                setViews(next);
                storeViews(projectId, next);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {naming === null ? (
          <button type="button" onClick={() => setNaming("")} className="rounded-lg bg-white p-1.5 text-[11.5px] font-medium text-indigo-700 shadow">
            + Save this view
          </button>
        ) : (
          <form
            className="rounded-lg bg-white p-1.5 shadow"
            onSubmit={(e) => {
              e.preventDefault();
              saveView();
            }}
          >
            <input
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              placeholder="Kitchen front"
              aria-label="Name for this view"
              className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-[11.5px]"
              onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
            />
            <div className="mt-1 flex justify-between text-[11px]">
              <button type="button" onClick={() => setNaming(null)} className="text-gray-500">
                Cancel
              </button>
              <button type="submit" className="font-semibold text-indigo-700">
                Save
              </button>
            </div>
          </form>
        )}
      </div>

      {/* error + actions */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-2 pointer-events-none">
          {error && (
            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="flex gap-2 pointer-events-auto">
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow">
            Cancel
          </button>
          <button type="button" onClick={captureView} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow">
            Use this view →
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CameraFraming;
