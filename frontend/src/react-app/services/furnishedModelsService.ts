import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import axios from "./apiService";
import { AuthService } from "./authService";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";

export const FurnishedModelsService = {
  // Persist the backsplash config onto the object's DB record so the BACKEND
  // BOQ builder can price it (area × board rate). The 3D scene keeps its own
  // copy for rendering; this makes it visible to the server-side estimate.
  updateBacksplash: async (
    furnishedModelId: string,
    backsplash: {
      on: boolean;
      height?: number;
      attach?: string;
      materialUrl?: string | null;
      color?: string | null;
    }
  ): Promise<boolean> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.patch(
        `/furnishedmodels/${furnishedModelId}`,
        { backsplash },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      console.log(
        "%c[backsplash] SAVED to record",
        "color:#0F6E56;font-weight:bold",
        furnishedModelId,
        "status",
        response?.status,
        backsplash
      );
      return response?.status >= 200 && response?.status < 300;
    } catch (e: any) {
      console.error(
        "[backsplash] SAVE FAILED",
        furnishedModelId,
        e?.response?.status,
        e?.response?.data || e?.message
      );
      return false;
    }
  },

  // Save the per-object manual "other costs" rows. Objects use UUID ids, so a
  // direct patch is safe (no ObjectId conversion issue).
  updateOtherCosts: async (
    furnishedModelId: string,
    otherCosts: { label: string; amount: number }[]
  ): Promise<boolean> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.patch(
        `/furnishedmodels/${furnishedModelId}`,
        { otherCosts },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return response?.status >= 200 && response?.status < 300;
    } catch (e) {
      console.error("FurnishedModelsService.updateOtherCosts", e);
      return false;
    }
  },

  // Save the per-object hardware lines (name + unitPrice + qty).
  updateHardwareItems: async (
    furnishedModelId: string,
    hardwareItems: {
      name: string;
      unitPrice: number;
      qty: number;
      fromMaster?: boolean;
    }[]
  ): Promise<boolean> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.patch(
        `/furnishedmodels/${furnishedModelId}`,
        { hardwareItems },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return response?.status >= 200 && response?.status < 300;
    } catch (e) {
      console.error("FurnishedModelsService.updateHardwareItems", e);
      return false;
    }
  },

  // Include/exclude an object from installation (e.g. a lamp needs none).
  setInstallationExcluded: async (
    furnishedModelId: string,
    installationExcluded: boolean
  ): Promise<boolean> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.patch(
        `/furnishedmodels/${furnishedModelId}`,
        { installationExcluded },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return response?.status >= 200 && response?.status < 300;
    } catch (e) {
      console.error("FurnishedModelsService.setInstallationExcluded", e);
      return false;
    }
  },

  /**
   * Save a BOQ line override for one placed item — removed from the BOQ,
   * quantity, or rate (null = back to the calculated price). BOQ page only;
   * the design itself is not changed.
   */
  updateBoqLine: async (
    furnishedModelId: string,
    patch: {
      boqExcluded?: boolean;
      boqQty?: number;
      boqRate?: number | null;
      boqSqftRate?: number | null;
      boqWidthFt?: number | null;
      boqHeightFt?: number | null;
      boqDescription?: string;
    }
  ): Promise<boolean> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.patch(
        `/furnishedmodels/${furnishedModelId}`,
        patch,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return response?.status >= 200 && response?.status < 300;
    } catch (e) {
      console.error("FurnishedModelsService.updateBoqLine", e);
      return false;
    }
  },

  /**
   * CHANGE ONE ITEM'S FINISH FROM THE BOQ.
   *
   * A finish is stored per PART, not per item — a single unit has a dozen, and
   * the shutter can differ from the carcass on purpose. So "the material of
   * this row" has to be written somewhere specific, and `scope` is that
   * decision:
   *
   *   exposed — only the parts marked `exposed`, which are the ones you see.
   *             An inside/outside difference set in 3D survives.
   *   all     — every part. Simpler, and it flattens that difference.
   *
   * Each part is patched on its own rather than through one bulk call, because
   * the service patches by id and a partial failure must leave the parts that
   * did save alone. Returns how many were written, so the caller can say what
   * actually happened instead of claiming success.
   */
  /**
   * WRITE THE SAME FIELDS TO EVERY PART OF ONE ITEM.
   *
   * What the BOQ's room-level controls need: the board and the inner lamination
   * are properties of the whole unit, not of one panel, so there is nothing to
   * filter on. `updateItemFinish` below does the same job but returns only a
   * count; this returns the ids that saved, because the caller has to merge the
   * same change into the browser's own copy of those records. Without that the
   * editor's next sync writes its untouched copy back over this one and the
   * change disappears on reload, with no error anywhere.
   */
  /**
   * Patch ONE component.
   *
   * The narrowest write there is — used by the BOQ's per-mesh exterior editor,
   * where the whole point is to change a single panel and leave every other
   * part of the item exactly as it was.
   */
  updateOnePart: async (
    componentId: string,
    patch: Record<string, any>
  ): Promise<boolean> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const r = await axios.patch(
        `/furnishedmodelcomponents/${componentId}`,
        patch,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return r?.status >= 200 && r?.status < 300;
    } catch (e) {
      console.error("FurnishedModelsService.updateOnePart", e);
      return false;
    }
  },

  updateAllParts: async (
    furnishedModelId: string,
    patch: Record<string, any>
  ): Promise<{ matched: number; written: number; writtenIds: string[] }> => {
    const accessToken = AuthService.getAccessToken();
    const headers = { Authorization: `Bearer ${accessToken}` };
    let parts: any[] = [];
    try {
      const list = await axios.get("/furnishedmodelcomponents", {
        params: { furnishedModelId },
        headers,
      });
      // Paginated body is { data: [...] }; an unpaginated one is the array.
      const body = list?.data;
      parts = Array.isArray(body)
        ? body
        : Array.isArray(body?.data)
        ? body.data
        : [];
    } catch (e) {
      console.error("FurnishedModelsService.updateAllParts: load", e);
      return { matched: 0, written: 0, writtenIds: [] };
    }
    const targets = parts.filter((p) => p && p._id);
    let written = 0;
    const writtenIds: string[] = [];
    for (const part of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await axios.patch(
          `/furnishedmodelcomponents/${part._id}`,
          patch,
          { headers }
        );
        if (r?.status >= 200 && r?.status < 300) {
          written += 1;
          writtenIds.push(part._id);
        }
      } catch (pe) {
        console.error("updateAllParts: part failed", part._id, pe);
      }
    }
    return { matched: targets.length, written, writtenIds };
  },

  updateItemFinish: async (
    furnishedModelId: string,
    patch: {
      externalFinishFinishingId?: string | null;
      externalFinishBrandId?: string | null;
      externalFinishClassification?: string;
    },
    scope: "exposed" | "all" = "exposed"
  ): Promise<number> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const list = await axios.get("/furnishedmodelcomponents", {
        params: { furnishedModelId },
        headers,
      });
      // Paginated body is { data: [...] }; an unpaginated one is the array.
      // Checked rather than assumed — `a || b` would hand back the pagination
      // wrapper itself whenever `data` happened to be an empty array.
      const body = list?.data;
      const all: any[] = Array.isArray(body)
        ? body
        : Array.isArray(body?.data)
        ? body.data
        : [];
      const targets =
        scope === "all" ? all : all.filter((c: any) => c && c.exposed);
      // Nothing marked exposed — a model whose parts were never flagged. Fall
      // back to all of them rather than silently writing to nothing, which
      // would look exactly like a broken save.
      const parts = targets.length ? targets : all;
      let written = 0;
      for (const part of parts) {
        if (!part?._id) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await axios.patch(
            `/furnishedmodelcomponents/${part._id}`,
            patch,
            { headers }
          );
          if (r?.status >= 200 && r?.status < 300) written += 1;
        } catch (pe) {
          console.error("updateItemFinish: part failed", part._id, pe);
        }
      }
      return written;
    } catch (e) {
      console.error("FurnishedModelsService.updateItemFinish", e);
      return 0;
    }
  },

  /**
   * Set the BOARD on every part of one item — type, brand and grade.
   *
   * Always every part, never just the exposed ones: the carcass, the back and
   * the shelves are all the same sheet, and a cabinet built from two different
   * boards is not something anyone orders. That is the difference from a
   * finish, where the inside and the outside genuinely do differ.
   */
  updateItemCoreMaterial: async (
    furnishedModelId: string,
    patch: {
      coreMaterialTypeId?: string;
      coreMaterialBrandId?: string;
      coreMaterialGrade?: string;
    }
  ): Promise<number> =>
    FurnishedModelsService.updateItemFinish(
      furnishedModelId,
      patch as any,
      "all"
    ),

  getFurnishedModelsByProjectIdAndFloorPlanId: async (
    projectId: string,
    floorPlanId: string
  ): Promise<FurnishedModel[] | null> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/furnishedmodels", {
        params: {
          "$and[0][projectId]": projectId,
          "$and[1][floorPlanId]": floorPlanId,
          "$and[1][isActive]": true,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "furnishedModelsService.ts ~ getFurnishedModelsByProjectIdAndFloorPlanId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data.data.map((model: any) => {
          return new FurnishedModel({
            _id: model._id,
            projectId: model.projectId,
            modelId: model.modelId,
            model: model.model,
            position: model.position,
            scale: model.scale,
            rotation: model.rotation,
            dimensions: model.dimensions,
            roomId: model.roomId,
            floorPlanId: model.floorPlanId,
            isActive: model.isActive,
            isHandleChanged: model.isHandleChanged,
            roomName: model.roomName,
          });
        });
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: furnishedModelsService.js:32 ~ getFurnishedModelsByProjectIdAndFloorPlanId ~ err:",
        err
      );
      return null;
    }
  },

  getFurnishedModelsByModelId: async (modelId: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/furnishedmodels", {
        params: {
          "$and[0][modelId]": modelId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "furnishedModelsService.ts ~ getFurnishedModelsByModelId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: furnishedModelsService.js:32 ~ getFurnishedModelsByModelId ~ err:",
        err
      );
      return null;
    }
  },

  getFurnishedModelById: async (id: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get(`/furnishedmodels/${id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "furnishedModelsService.ts ~ getFurnishedModelById ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        const model = response?.data;
        return new FurnishedModel({
          _id: model._id,
          projectId: model.projectId,
          modelId: model.modelId,
          model: model.model,
          position: model.position,
          scale: model.scale,
          rotation: model.rotation,
          dimensions: model.dimensions,
          roomId: model.roomId,
          roomName: model.roomName,
          floorPlanId: model.floorPlanId,
          isActive: model.isActive,
          isHandleChanged: model.isHandleChanged,
        });
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: furnishedModelsService.js:32 ~ getFurnishedModelById ~ err:",
        err
      );
      return null;
    }
  },

  getFurnishedModelComponentByFurnishedModelId: async (
    furnishedModelId: string
  ): Promise<FurnishedModelComponent[] | null> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/furnishedmodelcomponents", {
        params: {
          "$and[0][furnishedModelId]": furnishedModelId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "furnishedModelsService.ts ~ getFurnishedModelComponentByFurnishedModelId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data.data.map((model: any) => {
          return new FurnishedModelComponent({
            _id: model._id,
            furnishedModelId: model.furnishedModelId,
            parentComponentId: model.parentComponentId,
            name: model.name,
            position: model.position,
            scale: model.scale,
            rotation: model.rotation,
            baseMaterialProperties: model.baseMaterialProperties,
            componentProperties: model.componentProperties,
            visible: model.visible,
            exposed: model.exposed,
            locationWithinParent: model.locationWithinParent,
            coreMaterialTypeId: model.coreMaterialTypeId,
            coreMaterialGrade: model.coreMaterialGrade,
            coreMaterialBrandId: model.coreMaterialBrandId,
            coreMaterialThickness: model.coreMaterialThickness,
            externalFinishClassification: model.externalFinishClassification,
            externalFinishBrandId: model.externalFinishBrandId,
            externalFinishFinishing: model.externalFinishFinishing,
            externalFinishFinishingId: model.externalFinishFinishingId,
            externalFinishGrainDirection: model.externalFinishGrainDirection,
            internalFinishClassification: model.internalFinishClassification,
            internalFinishBrandId: model.internalFinishBrandId,
            internalFinishFinishing: model.internalFinishFinishing,
            internalFinishFinishingId: model.internalFinishFinishingId,
            internalFinishGrainDirection: model.internalFinishGrainDirection,
            edgeBandThickness: model.edgeBandThickness,
            edgeBandColor: model.edgeBandColor,
            dimensions: model.dimensions,
            width: model.width,
            height: model.height,
            textureId: model.textureId,
          });
        });
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: furnishedModelsService.js:32 ~ getFurnishedModelComponentByFurnishedModelId ~ err:",
        err
      );
      return null;
    }
  },

  getFurnishedModelComponentById: async (id: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get(`/furnishedmodelcomponents/${id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "furnishedModelsService.ts ~ getFurnishedModelComponentById ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: furnishedModelsService.js:32 ~ getFurnishedModelComponentById ~ err:",
        err
      );
      return null;
    }
  },

  getComponentProperties: async (modelComponentName: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get(`/componentproperties`, {
        params: {
          "$and[0][componentName]": modelComponentName,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "furnishedModelsService.ts ~ getComponentProperties ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: furnishedModelsService.js:32 ~ getComponentProperties ~ err:",
        err
      );
      return null;
    }
  },
};
