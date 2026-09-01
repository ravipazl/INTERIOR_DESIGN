import { Model } from "../entities";
import axios from "./apiService";
import { AuthService } from "./authService";

// Memoize component-texture lookups. Mesh names are generic ("Mesh_0", "Mesh_1",
// …) and shared across ALL models, so the same lookup repeats for every item
// placed. Placing an item used to fire one network request PER mesh and wait for
// them all before the item appeared — a big part of the "white box" delay.
// Caching the promise per name means each unique name is fetched at most once
// for the whole session; every later placement reuses it instantly. Caching the
// PROMISE (not just the value) also dedupes the concurrent Promise.all calls a
// single multi-mesh model fires.
const __componentTextureCache = new Map<string, Promise<string | null>>();

/** One trimmed search hit — the same shape from Sketchfab and Poly Haven. */
export interface SketchfabSearchResult {
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
}

export interface UploadGlbInput {
  file: File;
  name?: string;
  categoryId: string;
  type?: number;
  width?: number;
  height?: number;
  depth?: number;
  meshCount?: number;
  price?: number;
  description?: string;
  onProgress?: (percent: number) => void;
}

export const ModelsService = {
  uploadGlb: async (input: UploadGlbInput) => {
    const fd = new FormData();
    fd.append("file", input.file);
    if (input.name) fd.append("name", input.name);
    fd.append("categoryId", input.categoryId);
    if (input.type != null) fd.append("type", String(input.type));
    if (input.width != null) fd.append("width", String(input.width));
    if (input.height != null) fd.append("height", String(input.height));
    if (input.depth != null) fd.append("depth", String(input.depth));
    if (input.meshCount != null)
      fd.append("meshCount", String(input.meshCount));
    if (input.price != null) fd.append("price", String(input.price));
    if (input.description) fd.append("description", input.description);

    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/model-upload", fd, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/form-data",
      },
      onUploadProgress: (e) => {
        if (input.onProgress && e.total) {
          input.onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
    // The project-wide axios is configured with validateStatus: status<500,
    // which means 4xx responses do NOT throw automatically. We must check
    // ourselves so the upload modal reflects real success vs failure.
    if (response.status < 200 || response.status >= 300) {
      const msg =
        (response.data && (response.data.message || response.data.error)) ||
        `HTTP ${response.status} from /model-upload`;
      throw new Error(msg);
    }
    return response.data;
  },

  /**
   * Submit an image to the backend for Tripo-based 3D generation.
   * Returns a jobId immediately (HTTP 202). Caller polls
   * pollImageTo3dStatus(jobId) until stage === "done" or "error".
   */
  startImageTo3d: async (input: {
    image: File;
    categoryId: string;
    name?: string;
    faceLimit?: number;
    /** Default false — no PBR texture, smaller GLB, mesh-only. */
    texture?: boolean;
    /**
     * Placement type for the new model — 1 Floor, 2 Wall, 3 InWall,
     * 4 Roof, 7 InWallFloor. Defaults to 1 server-side if omitted.
     */
    type?: number;
  }) => {
    const fd = new FormData();
    fd.append("image", input.image);
    fd.append("categoryId", input.categoryId);
    if (input.name) fd.append("name", input.name);
    if (input.faceLimit != null) fd.append("faceLimit", String(input.faceLimit));
    if (input.texture) fd.append("texture", "true");
    if (input.type != null) fd.append("type", String(input.type));
    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/image-to-3d", fd, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/form-data",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      const msg =
        response.data?.message ||
        response.data?.error ||
        `HTTP ${response.status}`;
      throw new Error(msg);
    }
    return response.data as { jobId: string; status: string };
  },

  pollImageTo3dStatus: async (jobId: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get(`/image-to-3d/status/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} polling status`
      );
    }
    return response.data;
  },

  /**
   * Search the Sketchfab catalog through the backend proxy.
   * Returns an array of trimmed result objects (uid, name, thumbnail, author,
   * license, faceCount, ...). The backend holds the SKETCHFAB_TOKEN.
   */
  searchSketchfab: async (input: {
    query: string;
    count?: number;
    license?: string;
    /** "Next page" URL from a previous search, for the Load-more button. */
    cursor?: string | null;
  }) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get("/sketchfab/search", {
      params: {
        q: input.query,
        count: input.count,
        license: input.license,
        cursor: input.cursor || undefined,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /sketchfab/search`
      );
    }
    // Returns { results, next } — `next` is an opaque cursor for Load more
    // (null when there are no more pages).
    return {
      results: (response.data?.results || []) as SketchfabSearchResult[],
      next: (response.data?.next as string | null) || null,
    };
  },

  /**
   * Start an async import of a Sketchfab model. The backend downloads the
   * GLB, decodes EXT_meshopt_compression with gltf-transform, optionally
   * strips textures, saves the file, and inserts a `models` row.
   * Returns a jobId; poll pollSketchfabImportStatus(jobId).
   */
  startSketchfabImport: async (input: {
    uid: string;
    categoryId: string;
    name?: string;
    stripTextures?: boolean;
    /**
     * Placement type for the new model — 1 Floor, 2 Wall, 3 InWall,
     * 4 Roof, 7 InWallFloor. Defaults to 1 server-side if omitted.
     */
    type?: number;
    credit?: {
      author?: string;
      authorProfile?: string;
      viewerUrl?: string;
      license?: string;
      licenseUrl?: string;
    };
  }) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.post(
      "/sketchfab/import",
      {
        uid: input.uid,
        categoryId: input.categoryId,
        name: input.name,
        stripTextures: !!input.stripTextures,
        type: input.type,
        credit: input.credit || undefined,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /sketchfab/import`
      );
    }
    return response.data as { jobId: string; status: string };
  },

  pollSketchfabImportStatus: async (jobId: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get(`/sketchfab/status/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} polling status`
      );
    }
    return response.data;
  },

  /**
   * Search the Poly Haven catalog through the backend proxy. Poly Haven is a
   * free, CC0 library (no attribution needed, no API key). Returns the same
   * trimmed shape as searchSketchfab so the search modal can render both.
   */
  searchPolyHaven: async (input: { query: string; count?: number }) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get("/polyhaven/search", {
      params: { q: input.query, count: input.count },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /polyhaven/search`
      );
    }
    // Poly Haven returns everything for a search in one go, so there is no
    // "next page" — always null, and the modal simply won't show Load more.
    return {
      results: (response.data?.results || []) as SketchfabSearchResult[],
      next: null as string | null,
    };
  },

  /**
   * Start an async import of a Poly Haven model. The backend downloads the
   * multi-file glTF, packs it into a single GLB, sanitises it for three.js
   * r0.118, saves it, and inserts a `models` row. Returns a jobId; poll with
   * pollPolyHavenImportStatus(jobId).
   */
  startPolyHavenImport: async (input: {
    id: string;
    categoryId: string;
    name?: string;
    stripTextures?: boolean;
    type?: number;
    credit?: {
      author?: string;
      viewerUrl?: string;
      dimensions?: number[] | null;
    };
  }) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.post(
      "/polyhaven/import",
      {
        id: input.id,
        categoryId: input.categoryId,
        name: input.name,
        stripTextures: !!input.stripTextures,
        type: input.type,
        credit: input.credit || undefined,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /polyhaven/import`
      );
    }
    return response.data as { jobId: string; status: string };
  },

  pollPolyHavenImportStatus: async (jobId: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get(`/polyhaven/status/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} polling status`
      );
    }
    return response.data;
  },

  /**
   * Objaverse (CC-BY / CC0 furniture) is served from a pre-built backend index,
   * so there is no keyword search — you browse by CATEGORY. Returns the list of
   * furniture categories + counts for the dropdown.
   */
  getObjaverseCategories: async () => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get("/objaverse/categories", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} from /objaverse/categories`
      );
    }
    return (response.data?.categories || []) as {
      category: string;
      label: string;
      count: number;
    }[];
  },

  /**
   * Browse one Objaverse furniture category. Paginated by a numeric start
   * offset. Results share the SketchfabSearchResult shape so the modal renders
   * them the same way; import is keyed by `uid`.
   */
  browseObjaverse: async (input: {
    category: string;
    start?: number | string | null;
  }) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get("/objaverse/browse", {
      params: { category: input.category, start: input.start || undefined },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /objaverse/browse`
      );
    }
    return {
      results: (response.data?.results || []) as SketchfabSearchResult[],
      next: (response.data?.next as string | null) ?? null,
      total: (response.data?.total as number) ?? 0,
    };
  },

  /**
   * Import an Objaverse model by uid. The backend resolves the GLB url from its
   * index (so credit + licence come from the trusted server, not the client),
   * downloads + sanitises for r0.118, and inserts a `models` row.
   */
  startObjaverseImport: async (input: {
    uid: string;
    categoryId: string;
    name?: string;
    stripTextures?: boolean;
    type?: number;
  }) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.post(
      "/objaverse/import",
      {
        uid: input.uid,
        categoryId: input.categoryId,
        name: input.name,
        stripTextures: !!input.stripTextures,
        type: input.type,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /objaverse/import`
      );
    }
    return response.data as { jobId: string; status: string };
  },

  pollObjaverseImportStatus: async (jobId: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.get(`/objaverse/status/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message || `HTTP ${response.status} polling status`
      );
    }
    return response.data;
  },

  getModelsByCategoryId: async (categoryId: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/models", {
        params: {
          "$and[0][categoryId]": categoryId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "modelsService.ts ~ getModelsByCategoryId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: modelsService.js:32 ~ getModelsByCategoryId ~ err:",
        err
      );
      return null;
    }
  },

  getAllModels: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/models", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug("modelsService.ts ~ getAllModels ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: modelsService.js:32 ~ getAllModels ~ err:",
        err
      );
      return null;
    }
  },

  getModelById: async (id: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get(`/models/${id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug("modelsService.ts ~ getModelById ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: modelsService.js:32 ~ getModelById ~ err:",
        err
      );
      return null;
    }
  },

  getModelComponentsByModelId: async (modelId: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/modelcomponents", {
        params: {
          "$and[0][modelId]": modelId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "modelsService.ts ~ getModelComponentsByModelId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: modelsService.js:32 ~ getModelComponentsByModelId ~ err:",
        err
      );
      return null;
    }
  },

  getModelComponentsById: async (id: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get(`/modelcomponents/${id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "modelsService.ts ~ getModelComponentsByModelId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: modelsService.js:32 ~ getModelComponentsByModelId ~ err:",
        err
      );
      return null;
    }
  },

  getModelComponentByName: async (name: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/modelcomponents", {
        params: {
          "$and[0][name]": name,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "modelsService.ts ~ getModelComponentsByModelId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: modelsService.js:32 ~ getModelComponentsByModelId ~ err:",
        err
      );
      return null;
    }
  },

  getModelComponentTexture: async (modelComponentName: string) => {
    // Reuse an in-flight or completed lookup for this component name.
    const cached = __componentTextureCache.get(modelComponentName);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const getModelComponentResponse =
          await ModelsService.getModelComponentByName(modelComponentName);
        const modelComponent = getModelComponentResponse?.data?.length
          ? getModelComponentResponse.data[0]
          : null;
        const textureDefaultValues = modelComponent?.modelDefaultValues?.length
          ? modelComponent.modelDefaultValues.find(
              (item: any) => item.propertyName === "externalFinishFinishingId"
            )
          : null;
        const texture = textureDefaultValues?.property?.texture?.fileUrl
          ? textureDefaultValues?.property?.texture?.fileUrl
          : null;
        return texture as string | null;
      } catch (e) {
        // On failure don't poison the cache — allow a later retry.
        __componentTextureCache.delete(modelComponentName);
        return null;
      }
    })();
    __componentTextureCache.set(modelComponentName, promise);
    return promise;
  },

  /**
   * Patch fields on an existing model (Feathers PATCH /models/:id).
   * Used by the Object panel's placement-type editor — change a model's
   * `type` after import so future drops use the right placement class
   * (Floor / Wall / InWall / Roof / …). Already-placed instances keep
   * their original class until they're deleted and re-added.
   */
  patchModel: async (id: string, patch: Partial<{ type: number; name: string; description: string }>) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.patch(`/models/${id}`, patch, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from PATCH /models/${id}`
      );
    }
    return response.data;
  },

  /**
   * Cascade-delete a user-created catalog model (Sketchfab / Tripo / upload).
   * Backend refuses if the model is part of the seeded factory catalog OR
   * is still placed in any furnished_models row — in which case the response
   * carries `inUseCount`. Caller should refresh the catalog cache on success.
   */
  deleteCatalogModel: async (id: string) => {
    const accessToken = AuthService.getAccessToken();
    const response = await axios.delete(`/catalog-model/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      const err: any = new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /catalog-model`
      );
      err.code = response.data?.error;
      err.inUseCount = response.data?.inUseCount;
      err.status = response.status;
      throw err;
    }
    return response.data as {
      id: string;
      modelDeleted: number;
      componentsDeleted: number;
      fileDeleted: boolean;
      fileError: string | null;
    };
  },

  /**
   * Method 1 — set / change a model's preview image (thumbnail).
   * Sends one image to POST /thumbnail-upload; the backend saves it under
   * /assets/models/thumbnails/ and updates the model's `thumbnail` field.
   * Works for any model (old or new): SETS when empty, REPLACES when present.
   * Returns { _id, thumbnail }.
   */
  uploadThumbnail: async (modelId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("modelId", modelId);
    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/thumbnail-upload", fd, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/form-data",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status} from /thumbnail-upload`
      );
    }
    return response.data as { _id: string; thumbnail: string };
  },

  saveModelsToLocalStorage: (data: Model[]) => {
    localStorage.setItem("pazl-models", JSON.stringify(data));
  },
  getModelsFromLocalStorage: () => {
    const data = localStorage.getItem("pazl-models");
    if (data) {
      return JSON.parse(data);
    }
  },
};
