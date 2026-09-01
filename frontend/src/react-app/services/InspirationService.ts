import axios from "axios";
import BlueprintInterface from "@pazl/blueprint-interface";

/**
 * InspirationService — bridges the 3D designer to the AI Inspiration app.
 *
 * The AI Inspiration app (pazl-ai-frontend) styles an UPLOADED photo. This
 * service instead captures the user's live 3D design and uploads it as an
 * "input" image for the project — so when they open AI Inspiration, their
 * actual room is already there to style (no manual photo upload needed).
 *
 * Fully additive: it only calls the existing AI backend endpoints (/upload,
 * /images) that the AI app already uses; it changes nothing in the 3D editor.
 */

const INSPIRE_API = (
  process.env.REACT_APP_PAZL_INSPIRE_API_BASE_URL || ""
).replace(/\/$/, "");

function token(): string {
  return localStorage.getItem("pazl-access-token") || "";
}

/**
 * Capture the current 3D viewport as a JPEG Blob (preserveDrawingBuffer is on).
 * JPEG is used deliberately: a PNG from the canvas is RGBA (4 channels), which
 * the depth AI model rejects with "Unable to infer channel dimension format".
 * JPEG is plain RGB (3 channels), so the model reads it fine.
 */
async function captureSceneBlob(): Promise<Blob | null> {
  try {
    const viewer: any = (BlueprintInterface as any).blueprint3d?.roomplanner;
    const canvas: HTMLCanvasElement | undefined = viewer?.renderer?.domElement;
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch (e) {
    console.error("InspirationService.captureSceneBlob", e);
    return null;
  }
}

export const InspirationService = {
  /**
   * Capture the 3D design, upload it to the AI Inspiration backend as an
   * "input" image for this project. Returns { ok } so the caller can then
   * navigate to the AI app where the screenshot is ready to style.
   */
  sendDesignToInspiration: async (opts: {
    projectId: string;
    userId?: string;
    roomName?: string;
    roomType?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!INSPIRE_API) {
      return { ok: false, error: "Inspiration API URL is not configured (.env)" };
    }
    if (!opts.projectId) {
      return { ok: false, error: "No projectId in the URL" };
    }
    const blob = await captureSceneBlob();
    if (!blob) {
      return { ok: false, error: "Could not capture the 3D view" };
    }
    const auth = { Authorization: `Bearer ${token()}` };
    try {
      // 1) Upload the captured image file → returns { key, url, ... }.
      const fd = new FormData();
      fd.append("file", blob, `design-${Date.now()}.jpg`);
      const up = await axios.post(`${INSPIRE_API}/upload`, fd, {
        headers: { ...auth, "Content-Type": "multipart/form-data" },
      });
      const key = up?.data?.key;
      if (!key) return { ok: false, error: "Upload returned no key" };

      // 2) Register it as an "input" image so AI Inspiration lists it.
      await axios.post(
        `${INSPIRE_API}/images`,
        {
          url: key,
          imageType: "input",
          roomType: opts.roomType || "Living Room",
          roomName: opts.roomName || "A New Room",
          userId: opts.userId || "",
          projectID: opts.projectId,
        },
        { headers: auth }
      );
      return { ok: true };
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to send to AI Inspiration";
      console.error("InspirationService.sendDesignToInspiration", e);
      return { ok: false, error: msg };
    }
  },
};
