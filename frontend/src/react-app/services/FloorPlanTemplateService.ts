import apiService from "./apiService";
import { AuthService } from "./authService";

/** A saved floor-plan template (shared / global library). */
export interface SavedTemplate {
  _id: string;
  title: string;
  size?: string;
  /** Full serialized design — the shape loadSerialized() consumes. */
  scene: { floorplan: any; items: any[] };
  coverImageUrl?: string;
  createdAt?: string;
}

/**
 * Saved floor-plan templates (pairs with the backend /floorplan-templates
 * Feathers service). Lets a generated/drawn plan be persisted permanently and
 * re-applied from the Templates gallery without re-importing.
 */
export const FloorPlanTemplateService = {
  /** All saved templates, newest first. */
  list: async (): Promise<SavedTemplate[]> => {
    const token = AuthService.getAccessToken();
    const res = await apiService.get("/floorplan-templates", {
      headers: { Authorization: `Bearer ${token}` },
      params: { "$sort[createdAt]": -1, $limit: 200 },
    });
    const body = res?.data;
    // Feathers find may be paginated ({ data: [...] }) or a raw array.
    const data = Array.isArray(body) ? body : body?.data ?? [];
    return data as SavedTemplate[];
  },

  /**
   * Persist a plan. `sceneJson` is the string from model.exportSerialized();
   * it's parsed and stored as an object so the gallery can apply it directly.
   * `coverImageUrl` is a base64 data-URL preview embedded in the document, so
   * it travels with the template (no separate file / static path to sync).
   */
  save: async (
    title: string,
    sceneJson: string,
    opts: { coverImageUrl?: string; size?: string } = {}
  ): Promise<SavedTemplate> => {
    const token = AuthService.getAccessToken();
    const scene = JSON.parse(sceneJson);
    const res = await apiService.post(
      "/floorplan-templates",
      {
        title,
        size: opts.size || "",
        scene,
        coverImageUrl: opts.coverImageUrl || "",
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res?.data || res.status < 200 || res.status >= 300) {
      throw new Error(res?.data?.message || `HTTP ${res?.status}`);
    }
    return res.data as SavedTemplate;
  },

  /** Delete a saved template by its id (backend: DELETE /floorplan-templates/:id). */
  remove: async (id: string): Promise<void> => {
    const token = AuthService.getAccessToken();
    await apiService.delete(`/floorplan-templates/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};
