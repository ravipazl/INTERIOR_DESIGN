import React, { useCallback, useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import { AuthService } from "@pazl/services/authService";
import CameraFraming, { FramedCapture } from "./CameraFraming";
import RenderStudio, { RenderSource } from "./RenderStudio";
import { Aspect } from "./options";

// The AI render (MyArchitectAI), replacing the old render pop-up.
//
//   Render (rail) → Step 1  CameraFraming  frame the shot on the live 3D view
//                 → Step 2  RenderStudio   render, edit, enhance, animate
//
// Opened and closed with the same counter signals the old RenderViewModal used,
// so the rail / MenuBar wiring is unchanged. Leaving puts the editor camera
// back exactly as it was (Viewer3d.endRenderFraming).

const viewer = () => (BlueprintInterface as any)?.blueprint3d?.roomplanner || null;

const AiRenderStudio: React.FC<{ openSignal?: number; closeSignal?: number }> = ({ openSignal, closeSignal }) => {
  const [step, setStep] = useState<"closed" | "frame" | "studio">("closed");
  const [source, setSource] = useState<RenderSource | null>(null);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [projectId, setProjectId] = useState("");

  const close = useCallback(() => {
    try {
      viewer()?.endRenderFraming?.();
    } catch (e) {
      console.warn("endRenderFraming failed (non-fatal)", e);
    }
    setStep("closed");
  }, []);

  useEffect(() => {
    if (!openSignal) return;
    const id = AuthService.getCurrentProjectId() || "";
    // A different project starts a fresh session.
    if (id !== projectId) setSource(null);
    setProjectId(id);
    setStep("frame");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  useEffect(() => {
    if (closeSignal) close();
  }, [closeSignal, close]);

  // Never leave the editor camera pinned if this unmounts mid-session.
  useEffect(() => () => viewer()?.endRenderFraming?.(), []);

  if (step === "frame") {
    return (
      <CameraFraming
        projectId={projectId}
        initialAspect={aspect}
        onCancel={() => (source ? setStep("studio") : close())}
        onUse={(c: FramedCapture) => {
          setAspect(c.aspect);
          setSource({ dataUrl: c.dataUrl, label: c.viewName ? `3D view · ${c.viewName}` : "3D view", capturedAt: c.capturedAt });
          setStep("studio");
        }}
      />
    );
  }
  if (step === "studio" && source) {
    return (
      <RenderStudio
        projectId={projectId}
        source={source}
        onSourceChange={setSource}
        onRecapture={() => setStep("frame")}
        onClose={close}
      />
    );
  }
  return null;
};

export default AiRenderStudio;
