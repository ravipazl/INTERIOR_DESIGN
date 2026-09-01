import {
  FloorPlan,
  FurnishedModel,
  FurnishedModelComponent,
} from "../entities";
import axios from "./apiService";
import { AuthService } from "./authService";

interface FloorPlanSceneReturnType {
  floorplan: FloorPlan;
  furnishedModels: FurnishedModel[];
  furnishedModelComponents: FurnishedModelComponent[];
}

export const FloorPlanService = {
  getFloorPlanByProjectId: async (
    projectId: string
  ): Promise<FloorPlanSceneReturnType | null> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/floorplans", {
        params: {
          "$and[0][projectId]": projectId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "floorPlanService.ts ~ getFloorPlanByProjectId ~ response",
        response
      );
      if (
        response?.data?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        return {
          floorplan: new FloorPlan({
            _id: response?.data?.data[0]?._id,
            projectId: response?.data?.data[0]?.projectId,
            scene: response?.data?.data[0]?.scene,
          }),
          furnishedModels: response?.data?.data[0]?.furnishedModels?.map(
            (model: FurnishedModel) =>
              new FurnishedModel({
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
              })
          ),
          furnishedModelComponents:
            response?.data?.data[0]?.furnishedModelComponents?.map(
              (model: FurnishedModelComponent) =>
                new FurnishedModelComponent({
                  _id: model._id,
                  furnishedModelId: model.furnishedModelId,
                  parentComponentId: model.parentComponentId,
                  name: model.name,
                  // Restore the 3D mesh identity on reload. Without this the
                  // loader dropped meshName, so after a refresh every grouped
                  // part fell back to the group name ("Carcass") instead of its
                  // real mesh (Mesh 0, Mesh 2 …).
                  meshName: (model as any).meshName,
                  position: model.position,
                  scale: model.scale,
                  rotation: model.rotation,
                  baseMaterialProperties: model.baseMaterialProperties,
                  componentProperties: model.componentProperties,
                  visible: model.visible,
                  exposed: model.exposed,
                  locationWithinParent: model.locationWithinParent,
                  coreMaterialTypeId: model.coreMaterialTypeId,
                  coreMaterialType: model.coreMaterialType,
                  coreMaterialGrade: model.coreMaterialGrade,
                  coreMaterialBrandId: model.coreMaterialBrandId,
                  coreMaterialBrand: model.coreMaterialBrand,
                  coreMaterialThickness: model.coreMaterialThickness,
                  externalFinishClassification:
                    model.externalFinishClassification,
                  externalFinishBrandId: model.externalFinishBrandId,
                  externalFinishBrand: model.externalFinishBrand,
                  externalFinishFinishing: model.externalFinishFinishing,
                  externalFinishFinishingId: model.externalFinishFinishingId,
                  externalFinishGrainDirection:
                    model.externalFinishGrainDirection,
                  internalFinishClassification:
                    model.internalFinishClassification,
                  internalFinishBrandId: model.internalFinishBrandId,
                  internalFinishBrand: model.internalFinishBrand,
                  internalFinishFinishing: model.internalFinishFinishing,
                  internalFinishFinishingId: model.internalFinishFinishingId,
                  internalFinishGrainDirection:
                    model.internalFinishGrainDirection,
                  edgeBandThickness: model.edgeBandThickness,
                  edgeBandColor: model.edgeBandColor,
                  dimensions: model.dimensions,
                  width: model.width,
                  height: model.height,
                  textureId: model.textureId,
                })
            ),
        };
      }
      return null;
    } catch (err) {
      console.error(
        "floorPlanService.js ~ getFloorPlanByProjectId ~ err:",
        err
      );
      return null;
    }
  },
  getFloorPlanId: async (projectId: string): Promise<string | null> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/floorplans", {
        params: {
          "$and[0][projectId]": projectId,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "floorPlanService.ts ~ getFloorPlanId ~ response",
        response
      );
      if (
        response?.data?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        return response?.data?.data[0]?._id;
      }
      return null;
    } catch (err) {
      console.error("floorPlanService.js ~ getFloorPlanId ~ err:", err);
      return null;
    }
  },
  generateBOQ: async (floorPlanId: string): Promise<any[] | null> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.post(
        "/generateboq",
        {
          floorPlanId: floorPlanId,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.debug("floorPlanService.ts ~ generatedBOQ ~ response", response);
      if (
        response?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error("floorPlanService.js ~ generatedBOQ ~ err:", err);
      return null;
    }
  },
};
