import axios from "./apiService";
import { AuthService } from "./authService";
import BlueprintInterface from "@pazl/blueprint-interface";

export interface RenderSettings {
  samples?: number;
  width?: number;
  height?: number;
  /** Auto-frame view angle: corner | front | back | left | right | top. */
  view?: string;
  /** Blender engine: "EEVEE" (fast) or "CYCLES" (photorealistic). */
  engine?: string;
  /** Output file format: "PNG" or "JPEG". */
  format?: string;
  /** Exposure / brightness (-, 0, +). */
  exposure?: number;
  /** Denoise the render (Cycles): true/false. */
  denoise?: boolean;
  /**
   * Lighting environment — the sky the room is lit by. One of:
   * daylight | sunset | night | forest | overcast | studio.
   * Omitted -> the backend's default HDRI.
   */
  environment?: string;
  /**
   * Per-material overrides from the Materials panel, keyed by material NAME
   * (the only handle that survives the glTF export into Blender):
   *   { "Sofa surface": { type: "fabric" } }
   * `type` maps to a preset in render.py; roughness/metallic override it.
   */
  materials?: Record<string, MaterialOverride>;

  // --- post-processing "finish" (Enscape-style Image/Camera/Sky knobs) ---
  // Applied on top of the render; every one is neutral by default so omitting
  // it renders exactly as before.
  /** White balance in Kelvin. 6500 = neutral, lower = warmer, higher = cooler. */
  temperature?: number;
  /** Colour intensity. 1 = unchanged, 0 = greyscale, up to 2 = vivid. */
  saturation?: number;
  /** Brighten(+) / darken(-) the bright areas. -1..1, 0 = off. */
  highlights?: number;
  /** Lift(+) / deepen(-) the dark areas. -1..1, 0 = off. */
  shadows?: number;
  /** Darken the corners (photographic vignette). 0..1, 0 = off. */
  vignette?: number;
  /** Depth of field — background blur like a real lens. 0..1, 0 = off. */
  dof?: number;
  /** Spin the sky/HDRI so the sun falls from a new angle. Degrees, 0 = off. */
  skyRotation?: number;
  /** Contrast. -100..100, 0 = off (punchier at +, flatter at -). */
  contrast?: number;
  /** Auto-contrast — stretch the histogram to full range. true/false. */
  autoContrast?: boolean;
  /** Render the room on a plain white backdrop (room still HDRI-lit). */
  whiteBackground?: boolean;
  /** Time-of-day sun: 0..100 (50 = noon). -1 = off. Adds a directional sun. */
  sunTime?: number;
  /** Compass direction the sun comes from, 0..360 degrees. */
  sunDir?: number;
  /** Room (artificial) light multiplier. 1 = default, 0 = off, 2 = brighter. */
  artificialLight?: number;
}

/** A material's look. `type` is the simple choice; the rest are fine-tuning. */
export interface MaterialOverride {
  type?: string;
  /** Albedo / base colour as a "#rrggbb" hex string. */
  color?: string;
  roughness?: number;
  metallic?: number;
  transmission?: number;
}

/** One distinct material in the scene, as listed by the viewer. */
export interface SceneMaterial {
  /** The material's real name — the key Blender matches on. */
  name: string;
  /** Human label: the owning item(s), e.g. "Sofa" or "Sofa +2 more". */
  label: string;
  /** The raw material name, shown only when it adds information. */
  detail: string;
  color: string;
  /** True when a picture, not `color`, defines the surface's look. */
  hasTexture: boolean;
  itemNames: string[];
  meshCount: number;
}

/** The material types the render understands (must match render.py). */
export const MATERIAL_TYPES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Fabric", value: "fabric" },
  { label: "Wood", value: "wood" },
  { label: "Paint", value: "paint" },
  { label: "Leather", value: "leather" },
  { label: "Plastic", value: "plastic" },
  { label: "Stone", value: "stone" },
  { label: "Marble", value: "marble" },
  { label: "Tile", value: "tile" },
  { label: "Carpet", value: "carpet" },
  { label: "Metal", value: "metal" },
  { label: "Glass", value: "glass" },
  { label: "Mirror", value: "mirror" },
];

export interface RenderJob {
  id: string;
  stage: "queued" | "rendering" | "done" | "error";
  progress: number | null;
  result: { imageUrl: string } | null;
  error: string | null;
  queuePosition?: number | null;
}

/** Same shape as RenderJob, but the payload is an .mp4. */
export interface VideoJob {
  id: string;
  stage: "queued" | "rendering" | "done" | "error";
  progress: number | null;
  result: { videoUrl: string } | null;
  error: string | null;
  queuePosition?: number | null;
}

/**
 * Photorealistic render API (pairs with the backend /render service).
 * Exports the current room to a .glb, captures the camera, uploads both, and
 * polls for the finished image.
 */
export const RenderService = {
  /** Backend origin — rendered images are served relative to it. */
  imageBaseUrl: (process.env.REACT_APP_API_BASE_URL || "").replace(/\/$/, ""),

  /**
   * Every distinct material in the current room, for the Materials panel.
   * Read straight from the live 3D scene, so it always matches what will be
   * exported. Returns [] if the viewer isn't ready.
   */
  listMaterials: (): SceneMaterial[] => {
    try {
      const viewer = (BlueprintInterface as any)?.blueprint3d?.roomplanner;
      if (!viewer || typeof viewer.listMaterials !== "function") return [];
      return viewer.listMaterials();
    } catch (e) {
      console.warn("RenderService.listMaterials failed", e);
      return [];
    }
  },

  startRender: async (
    settings?: RenderSettings,
    options?: { autoFrame?: boolean }
  ) => {
    const viewer = (BlueprintInterface as any).blueprint3d.roomplanner;
    // Self-contained .glb (geometry + materials + embedded textures).
    const glbBuffer: ArrayBuffer = await viewer.exportSceneAsGLBBuffer();

    const fd = new FormData();
    fd.append(
      "model",
      new Blob([glbBuffer], { type: "model/gltf-binary" }),
      "room.glb"
    );
    // Auto-frame: omit the camera so the render engine composes the whole room.
    // Otherwise send the current view so the render matches the screen.
    if (!options?.autoFrame) {
      fd.append("camera", JSON.stringify(viewer.getCameraView()));
    }
    if (settings) fd.append("settings", JSON.stringify(settings));

    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/render", fd, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/form-data",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status}`
      );
    }
    return response.data as { jobId: string; status: string };
  },

  pollRenderStatus: async (jobId: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get(`/render/status/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} polling render status`
      );
    }
    return response.data as RenderJob;
  },

  /**
   * Start a 12-second orbit video of the current room.
   *
   * Unlike startRender this takes no camera and no settings: the composition
   * places itself inside the room and spins all the way round, so there is no
   * view to pass. Takes about a minute — poll with pollVideoStatus.
   */
  startVideo: async () => {
    const viewer = (BlueprintInterface as any).blueprint3d.roomplanner;
    const glbBuffer: ArrayBuffer = await viewer.exportSceneAsGLBBuffer();

    const fd = new FormData();
    fd.append(
      "model",
      new Blob([glbBuffer], { type: "model/gltf-binary" }),
      "room.glb"
    );

    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/video", fd, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/form-data",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status}`
      );
    }
    return response.data as { jobId: string; status: string };
  },

  pollVideoStatus: async (jobId: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get(`/video/status/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} polling video status`
      );
    }
    return response.data as VideoJob;
  },

  /** Absolute URL for a rendered image returned by the backend. */
  resolveImageUrl: (imageUrl: string) =>
    `${RenderService.imageBaseUrl}${imageUrl}`,
};
