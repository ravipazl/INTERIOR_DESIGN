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
