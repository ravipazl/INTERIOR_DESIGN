import React, { useCallback, useEffect, useRef, useState } from "react";
import "material-symbols";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import "./cameraControls3D.css";

/**
 * The camera controls of the 3D view, modelled on Coohom's:
 *
 *   bottom-left   the CAMERA ANGLE: a compass dial with a wedge showing which
 *                 way the lens points and how wide it sees, plus the heading
 *                 and the up/down tilt in degrees.
 *   bottom-right  a ZOOM BAR (- 130 % +, fit) and the CAMERA SETTINGS button,
 *                 which opens: zoom centre, rotation centre, lock rotation,
 *                 movement speed, field of view and camera height.
 *
 * It only talks to the 3D engine through Viewer3D's camera methods
 * (getCameraState / setCameraSettings / setCameraFov / setCameraHeightMm /
 * zoomStep / fitView). Nothing here touches the scene, the floor plan or the
 * saved project.
 */

type CamState = {
  perspective: boolean;
  heading: number;
  tilt: number;
  fov: number;
  heightMm: number;
  zoomPercent: number;
  inside: boolean;
};

type CamSettings = {
  zoomCenter: "canvas" | "mouse";
  rotationCenter: "canvas" | "mouse";
  lockRotation: boolean;
  speed: number;
};

const viewer = () => (BlueprintInterface as any)?.blueprint3d?.roomplanner || null;

const DEFAULT_SETTINGS: CamSettings = {
  zoomCenter: "canvas",
  rotationCenter: "canvas",
  lockRotation: false,
  speed: 100,
};

// The tilt, in words — what the number means for someone looking at the dial.
const tiltWords = (tilt: number) => {
  if (tilt > 12) return "Looking up";
  if (tilt < -12) return "Looking down";
  return "Level";
};

const AngleDial: React.FC<{ s: CamState }> = ({ s }) => {
  // A wedge as wide as the lens's FIELD OF VIEW, pointing along the heading.
  // (The vertical FOV is what the camera stores; the dial shows it as a
  // plan-view cone, which is how Coohom marks the camera on its mini plan.)
  const R = 26;
  const half = (Math.min(Math.max(s.fov || 45, 20), 110) * Math.PI) / 360;
  const rad = (s.heading * Math.PI) / 180;
  const pt = (a: number) =>
    `${30 + R * Math.sin(a)},${30 - R * Math.cos(a)}`;
  const wedge = `M30,30 L${pt(rad - half)} A${R},${R} 0 0 1 ${pt(rad + half)} Z`;
  return (
    <svg className="pz-cam-dial" viewBox="0 0 60 60" aria-hidden>
      <circle cx="30" cy="30" r="28" className="pz-cam-dial-ring" />
      <path d="M30,3 L27.5,8.5 L32.5,8.5 Z" className="pz-cam-dial-top" />
      <path d={wedge} className="pz-cam-dial-wedge" />
      <circle cx="30" cy="30" r="3" className="pz-cam-dial-dot" />
    </svg>
  );
};

const Slider: React.FC<{
  label: string;
  unit: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ label, unit, min, max, step = 1, value, disabled, onChange }) => {
  // The number box is typed into, so it keeps its own text and only commits on
  // Enter / blur — committing every keystroke would move the camera as you type.
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  const commit = () => {
    editing.current = false;
    const n = Number(text);
    if (Number.isFinite(n)) onChange(Math.min(Math.max(n, min), max));
    else setText(String(value));
  };
  return (
    <div className="pz-cam-row">
      <div className="pz-cam-label">{label}</div>
      <div className="pz-cam-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(Math.max(value, min), max)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <label className="pz-cam-num">
          <input
            type="number"
            value={text}
            disabled={disabled}
            onFocus={() => (editing.current = true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label={`${label} (${unit})`}
          />
          <span>{unit}</span>
        </label>
      </div>
    </div>
  );
};

const Choice: React.FC<{
  label: string;
  value: string;
  options: Array<[string, string]>;
  disabled?: boolean;
  onChange: (v: string) => void;
}> = ({ label, value, options, disabled, onChange }) => (
  <div className="pz-cam-row">
    <div className="pz-cam-label">{label}</div>
    <div className="pz-cam-choice" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          className={value === v ? "is-on" : ""}
          onClick={() => onChange(v)}
        >
          <span className="pz-cam-dot" />
          {text}
        </button>
      ))}
    </div>
  </div>
);

const CameraControls3D: React.FC = () => {
  const [state, setState] = useState<CamState | null>(null);
  const [settings, setSettings] = useState<CamSettings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState(false);
  // Where to sit so the controls clear the panels that overlay the canvas.
  const [inset, setInset] = useState({ left: 16, right: 16 });
  const rootRef = useRef<HTMLDivElement>(null);

  // --- follow the camera ----------------------------------------------------
  useEffect(() => {
    let last = "";
    const read = () => {
      const v = viewer();
      if (!v || !v.getCameraState) return;
      const s: CamState | null = v.getCameraState();
      if (!s) return;
      // Only re-render when something a person can see has changed.
      const key = [
        Math.round(s.heading),
        Math.round(s.tilt),
        Math.round(s.fov),
        Math.round(s.heightMm / 10),
        s.zoomPercent,
        s.perspective,
      ].join("|");
      if (key !== last) {
        last = key;
        setState(s);
      }
    };
    read();
    const t = window.setInterval(read, 120);
    return () => window.clearInterval(t);
  }, []);

  // --- the saved camera settings -------------------------------------------
  useEffect(() => {
    const v = viewer();
    if (v?.getCameraSettings) setSettings(v.getCameraSettings());
  }, []);

  const update = useCallback((patch: Partial<CamSettings>) => {
    const v = viewer();
    if (!v?.setCameraSettings) return;
    setSettings(v.setCameraSettings(patch));
  }, []);

  // --- stay clear of the panels that overlay the canvas ---------------------
  useEffect(() => {
    const measure = () => {
      const app = rootRef.current?.parentElement;
      if (!app) return;
      const a = app.getBoundingClientRect();
      let right = 16;
      document
        .querySelectorAll('[data-pz-canvas-overlay="right"]')
        .forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.left < a.right) {
            right = Math.max(right, a.right - r.left + 12);
          }
        });
      // The item library on the left is not marked. Look at what is on top of
      // the canvas's left edge, halfway down (clear of the little buttons that
      // sit in the corner), and walk up to the panel it belongs to: the widest
      // ancestor that is still clearly narrower than the canvas.
      let left = 16;
      const stack = document.elementsFromPoint(a.left + 24, a.top + a.height / 2);
      const probe = stack.find(
        (el) => !rootRef.current?.contains(el) && !app.contains(el)
      ) as HTMLElement | undefined;
      if (probe) {
        let panel: HTMLElement = probe;
        for (
          let el: HTMLElement | null = probe;
          el && el !== document.body;
          el = el.parentElement
        ) {
          if (el.getBoundingClientRect().width < a.width * 0.6) panel = el;
          else break;
        }
        const r = panel.getBoundingClientRect();
        // A wrapper as wide as the canvas is not a panel — nothing to avoid.
        if (r.width < a.width * 0.6 && r.right > a.left) {
          left = Math.max(left, r.right - a.left + 16);
        }
      }
      setInset((cur) =>
        cur.left === left && cur.right === right ? cur : { left, right }
      );
    };
    measure();
    const t = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Close the panel when you click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!state) return null;
  const v = viewer();
  const persp = state.perspective;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div ref={rootRef} className="pz-cam" onMouseDown={stop} onPointerDown={stop}>
      {/* CAMERA ANGLE — bottom-left */}
      <div
        className="pz-cam-angle"
        style={{ left: inset.left }}
        title="Which way the camera is looking"
      >
        <AngleDial s={state} />
        <div className="pz-cam-angle-text">
          <div>
            <b>{Math.round(state.heading)}°</b> heading
          </div>
          <div>
            <b>
              {state.tilt > 0 ? "+" : ""}
              {Math.round(state.tilt)}°
            </b>{" "}
            {tiltWords(state.tilt)}
          </div>
        </div>
      </div>

      {/* ZOOM BAR + CAMERA SETTINGS — bottom-right */}
      <div className="pz-cam-bar" style={{ right: inset.right }}>
        {open ? (
          <div className="pz-cam-panel" role="dialog" aria-label="Camera settings">
            <Choice
              label="Zoom center"
              value={settings.zoomCenter}
              disabled={!persp}
              options={[
                ["canvas", "Canvas"],
                ["mouse", "Mouse"],
              ]}
              onChange={(x) => update({ zoomCenter: x as CamSettings["zoomCenter"] })}
            />
            <Choice
              label="Rotation center"
              value={settings.rotationCenter}
              disabled={!persp}
              options={[
                ["canvas", "Canvas"],
                ["mouse", "Mouse"],
              ]}
              onChange={(x) =>
                update({ rotationCenter: x as CamSettings["rotationCenter"] })
              }
            />
            <div className="pz-cam-row pz-cam-row-switch">
              <div className="pz-cam-label">Lock camera rotation</div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.lockRotation}
                disabled={!persp}
                className={`pz-cam-switch${settings.lockRotation ? " is-on" : ""}`}
                onClick={() => update({ lockRotation: !settings.lockRotation })}
              >
                <span />
              </button>
            </div>
            <Slider
              label="Movement speed"
              unit="%"
              min={10}
              max={400}
              step={10}
              value={settings.speed}
              onChange={(n) => update({ speed: n })}
            />
            <Slider
              label="FOV"
              unit="°"
              min={20}
              max={110}
              value={Math.round(state.fov || 45)}
              disabled={!persp}
              onChange={(n) => v?.setCameraFov?.(n)}
            />
            <Slider
              label="Height"
              unit="mm"
              min={100}
              max={5000}
              step={50}
              value={state.heightMm}
              disabled={!persp}
              onChange={(n) => v?.setCameraHeightMm?.(n)}
            />
            <div className="pz-cam-hint">
              Arrow keys walk and step sideways · Page Up / Page Down change
              height · scroll to move in and out
            </div>
          </div>
        ) : null}
        <div className="pz-cam-buttons">
          <button
            type="button"
            className={`pz-cam-btn${open ? " is-on" : ""}`}
            title="Camera settings"
            aria-label="Camera settings"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="material-symbols-outlined">videocam</span>
          </button>
          <button
            type="button"
            className="pz-cam-btn"
            title="Fit the whole plan in view"
            aria-label="Fit the whole plan in view"
            disabled={!persp}
            onClick={() => v?.fitView?.(true)}
          >
            <span className="material-symbols-outlined">fit_screen</span>
          </button>
          <span className="pz-cam-sep" />
          <button
            type="button"
            className="pz-cam-btn"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => v?.zoomStep?.(-1)}
          >
            <span className="material-symbols-outlined">remove</span>
          </button>
          <span className="pz-cam-zoom" aria-live="polite">
            {/* Walking inside a room reaches huge numbers that mean nothing. */}
            {state.zoomPercent > 999 ? "999+" : state.zoomPercent}%
          </span>
          <button
            type="button"
            className="pz-cam-btn"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => v?.zoomStep?.(1)}
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CameraControls3D;
