import { v4 as uuidv4 } from "uuid";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";
import { Model, MODEL_TYPES } from "@pazl/entities/Model";
import { ModelComponent } from "@pazl/entities/ModelComponent";
import { Project } from "@pazl/entities/Project";
import { FloorPlan } from "@pazl/entities/FloorPlan";
import { handleDeleteSelectedModel } from "@pazl/viewer3d-state-interface";
import { AuthService } from "@pazl/services/authService";
import { ModelsService } from "@pazl/services/ModelsService";
import { FurnishedModelsService } from "@pazl/services/furnishedModelsService";
import { FloorPlanService } from "@pazl/services/floorPlanService";
import BlueprintInterface from "@pazl/blueprint-interface";
import { ProjectsService } from "./projectsService";
import { FurnishedModel, ROTATION_MODES } from "@pazl/entities/FurnishedModel";
import { convertEulersUnitToAngle } from "@pazl/utils/unitsUtils";
import { EVENT_ITEM_SELECTED } from "@pazl/main/core/events";
import { Finishing } from "@pazl/entities/Finishing";
import { TexturesService } from "./texturesService";

interface ProjectManagerProps {
  project: Project;
  floorPlan: FloorPlan;
  furnishedModels: FurnishedModel[];
  furnishedModelComponents: FurnishedModelComponent[];
  floorPlanHistory: FloorPlan[];
  selectedFloorPlan: FloorPlan;
}

export enum HISTORY_TITLES {
  FLOORPLAN_LOADED = "Floorplan loaded",
  FLOORPLAN_RESET = "Floorplan reset",
  FLOORPLAN_UPDATED = "Floorplan updated",
  ROOM_NAME_UPDATED = "Room name updated",
  FLOOR_ITEM_ADDED = "Floor item added",
  FLOOR_ITEM_UPDATED = "Floor item updated",
  FLOOR_ITEM_REMOVED = "Floor item removed",
  FLOOR_ITEM_POSITION_CHANGED = "Floor item position changed",
  FLOOR_ITEM_ROTATED = "Floor item rotated",
  FLOOR_ITEM_DIMENSION_CHANGED = "Floor item dimension changed",
  FLOOR_ITEM_TEXTURE_CHANGED = "Floor item texture changed",
  FLOOR_TEXTURE_CHANGED = "Floor texture changed",
  WALL_ITEM_ADDED = "Wall item added",
  WALL_ITEM_UPDATED = "Wall item updated",
  WALL_ITEM_REMOVED = "Wall item removed",
  WALL_ITEM_POSITION_CHANGED = "Wall item position changed",
  WALL_ITEM_ROTATED = "Wall item rotated",
  WALL_ITEM_DIMENSION_CHANGED = "Wall item dimension changed",
  WALL_ITEM_TEXTURE_CHANGED = "Wall item texture changed",
  WALL_TEXTURE_CHANGED = "Wall texture changed",
}

export class ProjectManager {
  project: Project;
  floorPlan: FloorPlan;
  furnishedModels: FurnishedModel[];
  furnishedModelComponents: FurnishedModelComponent[];
  floorPlanHistory: any[];
  selectedFloorPlan: any;

  // Tracks furnishedModelIds whose components are currently being created,
  // so two concurrent createFurnishedModelComponents calls (e.g. a React
  // double-render firing the panel self-heal twice) don't both insert a
  // full set of rows and produce duplicates.
  private __fmcCreationInFlight: Set<string> = new Set();

  constructor(props: ProjectManagerProps) {
    this.project = props?.project ?? {};
    this.floorPlan = props?.floorPlan ?? {};
    this.furnishedModels = props?.furnishedModels ?? [];
    this.furnishedModelComponents = props?.furnishedModelComponents ?? [];
    this.floorPlanHistory = props?.floorPlanHistory ?? [];
    this.selectedFloorPlan = props?.selectedFloorPlan ?? {};
  }

  async createSceneElements(
    model: Model,
    furnishedModelId: string,
    rotation?: any[]
  ) {
    console.debug("ProjectManager.ts ~ createSceneElements ~ model", model);
    const projectId = AuthService.getCurrentProjectId();
    const roomId = BlueprintInterface.roomplanningHelper?.__selectedRoom
      ? BlueprintInterface.roomplanningHelper?.__selectedRoom?.uuid
      : BlueprintInterface.roomplanningHelper?.__floorplan?.rooms?.length
      ? BlueprintInterface.roomplanningHelper?.__floorplan?.rooms[0]?.uuid
      : "";
    const roomName = BlueprintInterface.roomplanningHelper?.__selectedRoom
      ? BlueprintInterface.roomplanningHelper?.__selectedRoom?.name
      : BlueprintInterface.roomplanningHelper?.__floorplan?.rooms?.length
      ? BlueprintInterface.roomplanningHelper?.__floorplan?.rooms[0]?.name
      : "";
    console.debug("ProjectManager.ts ~ createSceneElements", {
      model,
      furnishedModelId,
      roomId,
      projectId,
    });
    if (model && furnishedModelId && roomId && projectId) {
      const floorPlanId = this.floorPlan ? this.floorPlan._id : uuidv4();
      await this.createFurnishedModelComponents(model._id, furnishedModelId);
      await this.createFurnishedModel(
        furnishedModelId,
        model,
        projectId,
        model.dimensions,
        roomId,
        roomName,
        floorPlanId,
        rotation
      );

      // PERSIST THE SCENE NOW.
      //
      // Creating the furnished_models row is only half the job. Until the floor
      // plan itself is saved, the item exists in the database but NOT in
      // `scene.items` — and on the next load, loadSceneInitially() treats a row
      // that the scene does not reference as an ORPHAN and sets isActive:false.
      // The BOQ prices only active models, so an item the user added and could
      // see in the viewport silently vanished from the Bill of Quantity.
      //
      // Pressing Save afterwards does NOT rescue it: Save writes the scene, but
      // the deactivation has already happened. That is why the same item can end
      // up in the scene AND marked inactive at once — visible in Furnish,
      // missing from Production.
      //
      // Only imported/decor models were hit, because catalog units get edited
      // afterwards (material, size, position) and every one of those actions
      // already calls updateFloorPlan().
      //
      // Runs inside the guard and after createFurnishedModel, so the scene is
      // written only once the row it points at exists. Best-effort: a failed
      // save must not throw out of "add item".
      try {
        await this.updateFloorPlan(HISTORY_TITLES.FLOOR_ITEM_ADDED);
      } catch (e) {
        console.error(
          "ProjectManager ~ createSceneElements ~ scene save failed; this item may be dropped from the BOQ on reload",
          e
        );
      }
    }
  }

  async updateFloorPlan(name: string) {
    console.debug(
      "ProjectManager.ts ~ updateFloorPlan ~ floorPlan",
      this.floorPlan
    );
    if (this.floorPlan && this.floorPlan._id) {
      await new FloorPlan({ ...this.floorPlan }).update(
        BlueprintInterface.blueprint3d.model.exportSerialized()
      );
      let floorplan = BlueprintInterface.blueprint3d.model.exportSerialized();
      floorplan = JSON.parse(floorplan);
      floorplan = JSON.stringify({
        id: uuidv4(),
        name: name,
        ...floorplan,
      });
      this.selectedFloorPlan = floorplan;
      this.floorPlanHistory = this.floorPlanHistory.concat([floorplan]);
    }
  }

  async updateRoomNameInFloorPlan(roomName: string, roomId: string) {
    console.debug(
      "ProjectManager.ts ~ updateRoomNameInFloorPlan ~ roomName",
      roomName
    );
    await new FloorPlan({ ...this.floorPlan }).update(
      BlueprintInterface.blueprint3d.model.exportSerialized()
    );
    this.floorPlan = {
      ...this.floorPlan,
      scene: BlueprintInterface.blueprint3d.model.exportSerialized(),
    };
    const roomFurnishedModels = this.furnishedModels.filter(
      (model) => model.roomId === roomId
    );
    console.debug("roomFurnishedModels", roomFurnishedModels);
    if (roomFurnishedModels?.length)
      await Promise.all(
        roomFurnishedModels.map(async (furnishedModel) => {
          await furnishedModel.onRoomNameChanged(roomName);
        })
      );
  }

  async undo(selectedFloorPlan?: any) {
    if (selectedFloorPlan) {
      const selectedFloorplanIndex = this.floorPlanHistory.findIndex(
        (item) => JSON.parse(item).id === selectedFloorPlan.id
      );
      const floorplan = this.floorPlanHistory[selectedFloorplanIndex];
      if (floorplan) {
        this.selectedFloorPlan = floorplan;
        const plan = JSON.parse(floorplan);
        const items = plan.items;
        const removedItem = items.find((item: any) =>
          this.furnishedModels.some((item2) => item2._id !== item.dbid)
        );
        if (removedItem) {
          const furnishedModel =
            await FurnishedModelsService.getFurnishedModelById(
              removedItem.dbid
            );
          if (furnishedModel) {
            furnishedModel.isActive = true;
            furnishedModel.update();
            this.furnishedModels.concat([furnishedModel]);
          }
        } else if (!this.furnishedModels.length && items?.length === 1) {
          const furnishedModel =
            await FurnishedModelsService.getFurnishedModelById(items[0]?.dbid);
          if (furnishedModel) {
            furnishedModel.isActive = true;
            furnishedModel.update();
            this.furnishedModels.concat([furnishedModel]);
          }
        }
        await BlueprintInterface.blueprint3d.model.loadSerialized(floorplan);
      }
    } else {
      const selectedFloorplanIndex = this.floorPlanHistory.findIndex(
        (item) => JSON.parse(item).id === JSON.parse(this.selectedFloorPlan).id
      );
      const floorplan = this.floorPlanHistory[selectedFloorplanIndex - 1];
      if (floorplan) {
        this.selectedFloorPlan = floorplan;
        const plan = JSON.parse(floorplan);
        const items = plan.items;
        const removedItems = items.filter((item: any) =>
          this.furnishedModels.some((item2) => item2._id !== item.dbid)
        );
        if (removedItems.length) {
          removedItems.map(async (removedItem: any) => {
            const furnishedModel =
              await FurnishedModelsService.getFurnishedModelById(
                removedItem.dbid
              );
            if (furnishedModel) {
              furnishedModel.isActive = true;
              furnishedModel.update();
              this.furnishedModels.concat([furnishedModel]);
            }
          });
        } else if (!this.furnishedModels.length && items?.length === 1) {
          const furnishedModel =
            await FurnishedModelsService.getFurnishedModelById(items[0]?.dbid);
          if (furnishedModel) {
            furnishedModel.isActive = true;
            furnishedModel.update();
            this.furnishedModels.concat([furnishedModel]);
          }
        }
        await Promise.all(
          items.map((item: any) => {
            let furnishedModel = this.furnishedModels.find(
              (model) => model._id === item.dbid
            );
            if (furnishedModel) {
              if (
                furnishedModel.position[0] !== item.position[0] ||
                furnishedModel.position[1] !== item.position[1] ||
                furnishedModel.position[2] !== item.position[2]
              ) {
                furnishedModel.position = item.position;
              }
              if (
                furnishedModel.rotation[0] !== item.rotation[0] ||
                furnishedModel.rotation[1] !== item.rotation[1] ||
                furnishedModel.rotation[2] !== item.rotation[2]
              ) {
                furnishedModel.rotation = [
                  convertEulersUnitToAngle(item.rotation[0]),
                  convertEulersUnitToAngle(item.rotation[1]),
                  convertEulersUnitToAngle(item.rotation[2]),
                ];
              }
              this.furnishedModels.map((model) =>
                model._id === furnishedModel?._id ? furnishedModel : model
              );
              furnishedModel.update();
            }
          })
        );
        await Promise.all(
          items.map((item: any) => {
            let furnishedModel = this.furnishedModels.find(
              (model) => model._id === item.dbid
            );
            if (furnishedModel) {
              item.meshmap.map(async (comp: any) => {
                let furnishedModelComponent =
                  this.getFurnishedModelCompByFurnishedModelIdAndName(
                    furnishedModel?._id,
                    comp.name
                  );
                if (
                  furnishedModelComponent &&
                  furnishedModelComponent.externalFinishFinishing?.texture
                    ?.fileUrl != comp.texture
                ) {
                  const allFinishings =
                    await TexturesService.getFinishingsFromLocalStorage();
                  const finishing = allFinishings.find(
                    (finish: Finishing) =>
                      finish.texture.fileUrl === comp.texture
                  );
                  if (finishing) {
                    furnishedModelComponent.externalFinishFinishingId =
                      finishing._id;
                    furnishedModelComponent.externalFinishFinishing = finishing;
                    this.furnishedModelComponents =
                      this.furnishedModelComponents.map(
                        (component: FurnishedModelComponent) =>
                          component._id === furnishedModelComponent?._id
                            ? furnishedModelComponent
                            : component
                      );
                  }
                }
              });
            }
          })
        );
        await BlueprintInterface.blueprint3d.model.loadSerialized(floorplan);
        await new FloorPlan({
          ...this.floorPlan,
          scene: floorplan,
        }).update(BlueprintInterface.blueprint3d.model.exportSerialized());
      }
    }
  }

  async redo(selectedFloorPlan?: any) {
    if (selectedFloorPlan) {
      const selectedFloorplanIndex = this.floorPlanHistory.findIndex(
        (item) => JSON.parse(item).id === selectedFloorPlan.id
      );
      const floorplan = this.floorPlanHistory[selectedFloorplanIndex];
      if (floorplan) {
        this.selectedFloorPlan = floorplan;
        await BlueprintInterface.blueprint3d.model.loadSerialized(floorplan);
      }
    } else {
      const selectedFloorplanIndex = this.floorPlanHistory.findIndex(
        (item) => JSON.parse(item).id === JSON.parse(this.selectedFloorPlan).id
      );
      const floorplan = this.floorPlanHistory[selectedFloorplanIndex + 1];
      if (floorplan) {
        this.selectedFloorPlan = floorplan;
        await BlueprintInterface.blueprint3d.model.loadSerialized(floorplan);
        await new FloorPlan({ ...this.floorPlan, scene: floorplan }).update(
          BlueprintInterface.blueprint3d.model.exportSerialized()
        );
        const plan = JSON.parse(floorplan);
        const items = plan.items;
        await Promise.all(
          items.map((item: any) => {
            let furnishedModel = this.furnishedModels.find(
              (model) => model._id === item.dbid
            );
            if (furnishedModel) {
              if (
                furnishedModel.position[0] !== item.position[0] ||
                furnishedModel.position[1] !== item.position[1] ||
                furnishedModel.position[2] !== item.position[2]
              ) {
                furnishedModel.position = item.position;
              }
              if (
                furnishedModel.rotation[0] !== item.rotation[0] ||
                furnishedModel.rotation[1] !== item.rotation[1] ||
                furnishedModel.rotation[2] !== item.rotation[2]
              ) {
                furnishedModel.rotation = [
                  convertEulersUnitToAngle(item.rotation[0]),
                  convertEulersUnitToAngle(item.rotation[1]),
                  convertEulersUnitToAngle(item.rotation[2]),
                ];
              }
              this.furnishedModels.map((model) =>
                model._id === furnishedModel?._id ? furnishedModel : model
              );
              furnishedModel.update();
            }
          })
        );
        await Promise.all(
          items.map((item: any) => {
            let furnishedModel = this.furnishedModels.find(
              (model) => model._id === item.dbid
            );
            if (furnishedModel) {
              item.meshmap.map(async (comp: any) => {
                let furnishedModelComponent =
                  this.getFurnishedModelCompByFurnishedModelIdAndName(
                    furnishedModel?._id,
                    comp.name
                  );
                if (
                  furnishedModelComponent &&
                  furnishedModelComponent.externalFinishFinishing?.texture
                    ?.fileUrl != comp.texture
                ) {
                  const allFinishings =
                    await TexturesService.getFinishingsFromLocalStorage();
                  const finishing = allFinishings.find(
                    (finish: Finishing) =>
                      finish.texture.fileUrl === comp.texture
                  );
                  if (finishing) {
                    furnishedModelComponent.externalFinishFinishingId =
                      finishing._id;
                    furnishedModelComponent.externalFinishFinishing = finishing;
                    this.furnishedModelComponents =
                      this.furnishedModelComponents.map(
                        (component: FurnishedModelComponent) =>
                          component._id === furnishedModelComponent?._id
                            ? furnishedModelComponent
                            : component
                      );
                  }
                }
              });
            }
          })
        );
      }
    }
  }

  private async createFloorPlan(floorPlanId: string, projectId: string) {
    const floorPlan = new FloorPlan({
      _id: floorPlanId,
      projectId: projectId,
      scene: BlueprintInterface.blueprint3d.model.exportSerialized(),
    });
    this.floorPlan = floorPlan;
    console.debug(
      "ProjectManager.ts ~ createFloorPlan ~ saving floorPlan into localDB",
      floorPlan
    );
    await floorPlan.save();
  }

  private async createFurnishedModel(
    furnishedModelId: string,
    model: Model,
    projectId: string,
    dimensions: number[],
    roomId: string,
    roomName: string,
    floorPlanId: string,
    rotation?: any[]
  ) {
    // DRAG-DROP-AND-STAY (Coohom method): save the item's REAL placed position
    // so it reloads EXACTLY where it was dropped — not a placeholder. The item
    // just added is the newest in __roomItems; it's already at the drop point
    // (with its correct resting height from snapToPoint). Fall back to the
    // placement point, then to [1,1,1] so it can never crash.
    let realPosition: number[] = [1, 1, 1];
    try {
      const roomItems: any[] =
        (BlueprintInterface.blueprint3d as any)?.model?.__roomItems || [];
      const placed: any = roomItems.length
        ? roomItems[roomItems.length - 1]
        : null;
      const p: any = placed?.__itemModel?.position || placed?.position;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        realPosition = [
          Number(p.x),
          Number.isFinite(p.y) ? Number(p.y) : 0,
          Number(p.z),
        ];
      } else {
        const edge: any = (BlueprintInterface.roomplanningHelper as any)
          ?.__selectedEdgePoint;
        if (edge && Number.isFinite(edge.x) && Number.isFinite(edge.z)) {
          realPosition = [
            Number(edge.x),
            Number.isFinite(edge.y) ? Number(edge.y) : 0,
            Number(edge.z),
          ];
        }
      }
    } catch (e) {
      // keep the [1,1,1] fallback
    }

    const furnishedModel = new FurnishedModel({
      _id: furnishedModelId,
      modelId: model._id,
      model: model,
      position: realPosition,
      projectId: projectId,
      rotation: rotation ? rotation : [0, 0, 0],
      scale: [1, 1, 1],
      dimensions: dimensions ?? [],
      roomId: roomId,
      roomName: roomName,
      floorPlanId: floorPlanId,
      isActive: true,
      isHandleChanged: false,
    });
    console.debug(
      "ProjectManager.ts ~ createFurnishedModel ~ furnishedModel",
      furnishedModel
    );
    if (!this.furnishedModels) {
      this.furnishedModels = [];
    }
    this.furnishedModels = [...this.furnishedModels, furnishedModel];
    await furnishedModel.save();
    const title =
      model.type === MODEL_TYPES.WALL_UNIT
        ? HISTORY_TITLES.WALL_ITEM_ADDED
        : HISTORY_TITLES.FLOOR_ITEM_ADDED;
    await this.updateFloorPlan(title);
    await BlueprintInterface.blueprint3d?.roomplanner?.__roomItemSelected({
      type: EVENT_ITEM_SELECTED,
      item: BlueprintInterface.selectedModels[
        BlueprintInterface.selectedModels.length - 1
      ],
    });
  }

  async createFurnishedModelComponents(
    modelId: string,
    furnishedModelId: string
  ) {
    // Idempotency guard 1 — already created. If this placement already has
    // component rows in memory, do nothing. Prevents the panel self-heal
    // from appending a second/third set on every re-render.
    const alreadyHave =
      this.getFurnishedModelComponents(furnishedModelId) || [];
    if (alreadyHave.length > 0) {
      console.debug(
        `ProjectManager.ts ~ createFurnishedModelComponents ~ placement ` +
          `${furnishedModelId} already has ${alreadyHave.length} components — skipping`
      );
      return;
    }
    // Idempotency guard 2 — concurrent call. If another call for this same
    // placement is mid-flight, bail so they don't both insert.
    if (this.__fmcCreationInFlight.has(furnishedModelId)) {
      console.debug(
        `ProjectManager.ts ~ createFurnishedModelComponents ~ placement ` +
          `${furnishedModelId} creation already in flight — skipping`
      );
      return;
    }
    this.__fmcCreationInFlight.add(furnishedModelId);
    try {
      await this.__createFurnishedModelComponentsImpl(modelId, furnishedModelId);
    } finally {
      this.__fmcCreationInFlight.delete(furnishedModelId);
    }
  }

  private async __createFurnishedModelComponentsImpl(
    modelId: string,
    furnishedModelId: string
  ) {
    const modelComponentsResponse =
      await ModelsService.getModelComponentsByModelId(modelId);
    console.debug(
      "ProjectManager.ts ~ createFurnishedModelComponents ~ modelComponentsResponse",
      modelComponentsResponse
    );
    // Visible warning when the catalog has no per-mesh rows for this model —
    // that's what produces the "empty Components panel" mystery on placement.
    // The seed script must have run for this model. See
    // pazl-design-backend/scripts/seed-model-components.cjs.
    if (!modelComponentsResponse?.data?.length) {
      console.warn(
        `ProjectManager.ts ~ createFurnishedModelComponents ~ NO model_components for modelId=${modelId}. ` +
          `Run \`node scripts/seed-model-components.cjs\` in pazl-design-backend so this model exposes its meshes.`
      );
    }
    if (modelComponentsResponse?.data?.length) {
      const modelComponents = modelComponentsResponse.data;
      console.debug(
        "ProjectManager.ts ~ createFurnishedModelComponents ~ modelComponents",
        modelComponents
      );
      const allFinishings =
        await TexturesService.getFinishingsFromLocalStorage();
      await Promise.all(
        modelComponents.map(async (modelComponent: ModelComponent) => {
          const externalFinishFinishingId = modelComponent?.modelDefaultValues
            ?.length
            ? modelComponent.modelDefaultValues?.find(
                (item: any) => item.propertyName === "externalFinishFinishingId"
              )?.propertyValue
            : "";
          const internalFinishFinishingId = modelComponent?.modelDefaultValues
            ?.length
            ? modelComponent.modelDefaultValues?.find(
                (item: any) => item.propertyName === "internalFinishFinishingId"
              )?.propertyValue
            : "";
          const furnishedModelComponent = new FurnishedModelComponent({
            _id: uuidv4(),
            furnishedModelId: furnishedModelId,
            parentComponentId: modelComponent.name
              ?.toLowerCase()
              ?.includes("handle")
              ? modelId
              : modelComponent.parentComponentId,
            name: modelComponent.name,
            position: modelComponent.position,
            scale: modelComponent.scale,
            rotation: modelComponent.rotation,
            baseMaterialProperties: modelComponent.baseMaterialProperties,
            textureId: modelComponent.textureId,
            visible: modelComponent.visible,
            // Panels are EXPOSED by default (visible surfaces get the exterior
            // finish and are charged in BOQ). The user toggles "Unexposed" only
            // for hidden faces. Defaulting to undefined made BOQ treat every
            // panel as unexposed and skip all exterior finish costs.
            exposed: modelComponent.exposed ?? true,
            locationWithinParent: modelComponent.locationWithinParent,
            coreMaterialTypeId: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "coreMaterialTypeId"
                )?.propertyValue
              : "",
            coreMaterialGrade: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "coreMaterialGrade"
                )?.propertyValue
              : "",
            coreMaterialBrandId: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "coreMaterialBrandId"
                )?.propertyValue
              : "",
            coreMaterialThickness: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "coreMaterialThickness"
                )?.propertyValue
              : "",
            externalFinishClassification: modelComponent?.modelDefaultValues
              ?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) =>
                    item.propertyName === "externalFinishClassification"
                )?.propertyValue
              : "",
            externalFinishBrandId: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "externalFinishBrandId"
                )?.propertyValue
              : "",
            externalFinishFinishingId: externalFinishFinishingId,
            externalFinishFinishing:
              allFinishings?.length && externalFinishFinishingId
                ? allFinishings.find(
                    (finishing: Finishing) =>
                      finishing._id === externalFinishFinishingId
                  )
                : null,
            externalFinishGrainDirection: modelComponent?.modelDefaultValues
              ?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) =>
                    item.propertyName === "externalFinishGrainDirection"
                )?.propertyValue
              : "",
            internalFinishClassification: modelComponent?.modelDefaultValues
              ?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) =>
                    item.propertyName === "internalFinishClassification"
                )?.propertyValue
              : "",
            internalFinishBrandId: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "internalFinishBrandId"
                )?.propertyValue
              : "",
            internalFinishFinishingId: internalFinishFinishingId,
            internalFinishFinishing:
              allFinishings?.length && internalFinishFinishingId
                ? allFinishings.find(
                    (finishing: Finishing) =>
                      finishing._id === internalFinishFinishingId
                  )
                : null,
            internalFinishGrainDirection: modelComponent?.modelDefaultValues
              ?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) =>
                    item.propertyName === "internalFinishGrainDirection"
                )?.propertyValue
              : "",
            edgeBandThickness: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "edgeBandThickness"
                )?.propertyValue
              : "",
            edgeBandColor: modelComponent?.modelDefaultValues?.length
              ? modelComponent.modelDefaultValues?.find(
                  (item: any) => item.propertyName === "edgeBandColor"
                )?.propertyValue
              : "",
            dimensions: modelComponent?.dimensions ?? [],
            // Carry the catalog panel size so BOQ can compute area. Falling back
            // to "1" (as before) makes area ~0 and every item prices at ₹0.
            width:
              (modelComponent as any)?.width != null
                ? String((modelComponent as any).width)
                : "1",
            height:
              (modelComponent as any)?.height != null
                ? String((modelComponent as any).height)
                : "1",
          });
          console.debug(
            "ProjectManager.ts ~ createFurnishedModelComponents ~ furnishedModelComponent",
            furnishedModelComponent
          );
          this.furnishedModelComponents = [
            ...this.furnishedModelComponents,
            furnishedModelComponent,
          ];
          await furnishedModelComponent.save();
        })
      );
    }
  }

  async loadSceneInitially(): Promise<boolean> {
    const currentProjectId = AuthService.getCurrentProjectId();
    console.debug(
      "ProjectManager.ts ~ loadSceneInitially ~ currentProjectId",
      currentProjectId
    );
    if (currentProjectId) {
      const project = await ProjectsService.getProjectById(currentProjectId);
      console.debug(
        "ProjectManager.ts ~ loadSceneInitially ~ project",
        project
      );
      if (project) {
        this.project = project;
        const floorPlanData = await FloorPlanService.getFloorPlanByProjectId(
          currentProjectId
        );
        console.debug(
          "ProjectManager.ts ~ loadSceneInitially ~ floorPlanData",
          floorPlanData
        );
        if (floorPlanData?.floorplan) {
          new FloorPlan({ ...floorPlanData.floorplan }).save();
          if (floorPlanData.furnishedModels?.length) {
            let itemsList: any[] = [];
            let scene = JSON.parse(floorPlanData.floorplan.scene);

            // The dbids the scene actually renders. Used below to drop orphaned
            // furnished-model records (left behind by a remove/reset that didn't
            // clean up) so the BOQ matches what's really in the scene.
            const sceneDbids = new Set<string>(
              (scene?.items || [])
                .map((it: any) => it?.dbid)
                .filter(Boolean)
            );

            scene?.items.map((item: any) => {
              const foundModel = floorPlanData.furnishedModels.find(
                (model) => model._id === item?.dbid
              );
              if (foundModel) {
                itemsList.push({
                  ...item,
                  position: foundModel.position,
                  rotation: [0, 0, 0],
                  scale: foundModel.scale,
                });
              } else {
                // Keep items that have NO matching furnished model. Doors &
                // windows (and other in-wall parametric items) are stored in the
                // scene itself, not as furnished models, so foundModel is never
                // found for them. Previously they were DROPPED here, which made
                // the scene load EMPTY on reload until the user clicked to force
                // a full re-load. Keeping the item as-is (it already carries its
                // own position/wall) fixes the disappearing doors/windows.
                itemsList.push(item);
              }
            });

            scene = { ...scene, items: itemsList };
            this.selectedFloorPlan = JSON.stringify({
              id: uuidv4(),
              name: HISTORY_TITLES.FLOORPLAN_LOADED,
              ...scene,
            });
            scene = JSON.stringify(scene);
            this.floorPlanHistory = this.floorPlanHistory.concat([
              this.selectedFloorPlan,
            ]);
            if (!this.furnishedModels) {
              this.furnishedModels = [];
            }
            // Keep only the models the scene references; deactivate orphans so
            // the BOQ (which counts active models) stays in sync with the scene.
            const inSceneModels: any[] = [];
            for (const model of floorPlanData.furnishedModels) {
              if (sceneDbids.has(model._id)) {
                inSceneModels.push(model);
              } else if (model.isActive) {
                // Orphan: in the DB but not in the scene. Remove it so the BOQ
                // (which counts active models) stays in sync. remove() writes
                // isActive:false + isDeleted:true, so the sync service deletes
                // it — save()/update() both hardcode isActive:true and could
                // never deactivate. Wrapped in the class because floorPlanData
                // rows are plain API objects, not FurnishedModel instances.
                try {
                  await new FurnishedModel({ ...model }).remove();
                } catch (e) {
                  console.error(
                    "ProjectManager ~ loadSceneInitially ~ deactivate orphan failed",
                    e
                  );
                }
              }
            }
            this.furnishedModels = this.furnishedModels.concat(inSceneModels);
            // Wrap: floorPlanData rows are plain API objects, not FurnishedModel
            // instances, so calling .save() directly throws "save is not a function".
            this.furnishedModels.map((model) => new FurnishedModel({ ...model }).save());
            if (floorPlanData.furnishedModelComponents?.length) {
              if (!this.furnishedModelComponents) {
                this.furnishedModelComponents = [];
              }
              this.furnishedModelComponents =
                this.furnishedModelComponents.concat(
                  floorPlanData.furnishedModelComponents
                );
              // Wrap: these are plain API objects, not FurnishedModelComponent
              // instances — calling .save() directly is the crash this fixes.
              this.furnishedModelComponents.map(
                (comp) => new FurnishedModelComponent({ ...comp }).save()
              );
            }
            this.floorPlan = floorPlanData.floorplan;
            await BlueprintInterface.blueprint3d.model.loadSerialized(scene);
            return true;
          } else {
            this.floorPlan = floorPlanData.floorplan;
            await BlueprintInterface.blueprint3d.model.loadSerialized(
              floorPlanData.floorplan.scene
            );
          }
          return true;
        } else {
          const floorPlanId = uuidv4();
          await this.createFloorPlan(floorPlanId, currentProjectId);
          return true;
        }
      }
      return true;
    }
    return true;
  }

  getFurnishedModelById(id: string): FurnishedModel | undefined {
    console.debug(
      "ProjectManager.ts ~ getFurnishedModelById ~ id",
      id,
      this.furnishedModels
    );
    return this.furnishedModels.find(
      (furnishedModel) => furnishedModel._id === id
    );
  }

  getFurnishedModelComponentById(
    id: string
  ): FurnishedModelComponent | undefined {
    console.debug(
      "ProjectManager.ts ~ getFurnishedModelComponentById ~ id",
      id,
      this.furnishedModelComponents
    );
    return this.furnishedModelComponents.find(
      (furnishedModelComponent) => furnishedModelComponent._id === id
    );
  }

  getFurnishedModelCompByFurnishedModelIdAndName(
    furnishedModelId: string,
    furnishedModelComponentName: string
  ): FurnishedModelComponent | undefined {
    console.debug(
      "ProjectManager.ts ~ getFurnishedModelComponentById ~ furnishedModelId",
      furnishedModelId,
      furnishedModelComponentName
    );
    return this.furnishedModelComponents.find(
      (furnishedModelComponent) =>
        furnishedModelComponent.furnishedModelId === furnishedModelId &&
        furnishedModelComponent.name === furnishedModelComponentName
    );
  }

  async removeFurnishedModelComponent(furnishedModelComponentId: string) {
    console.debug(
      "ProjectManager.ts ~ removeFurnishedModelComponent ~ furnishedModelComponentId",
      furnishedModelComponentId
    );
    const furnishedModelCompToRemove = this.furnishedModelComponents.find(
      (comp) => comp._id === furnishedModelComponentId
    );
    if (furnishedModelCompToRemove) {
      await new FurnishedModelComponent({
        ...furnishedModelCompToRemove,
      }).remove();
      this.furnishedModelComponents = this.furnishedModelComponents.filter(
        (comp) => comp._id !== furnishedModelComponentId
      );
    }
  }

  /**
   * Rename a component to its part role ("Shutter", "Side panel", "Leg" …).
   * The app groups Carcass / Shutter / Handle by this name, so naming the door
   * "Shutter" fixes the panel grouping, the BOQ and the working-drawing legend
   * at once. The 3D mesh identity lives in `meshName` and is left untouched.
   */
  async updateFurnishedModelComponentName(
    furnishedModelComponentId: string,
    newName: string
  ) {
    console.debug(
      "ProjectManager.ts ~ updateFurnishedModelComponentName",
      furnishedModelComponentId,
      newName
    );
    const target = this.furnishedModelComponents.find(
      (comp) => comp._id === furnishedModelComponentId
    );
    if (!target || !String(newName || "").trim()) return;
    const entity = new FurnishedModelComponent({ ...target });
    await entity.updatePartName(newName);
    // Keep the in-memory list in step so the panel re-groups immediately.
    this.furnishedModelComponents = this.furnishedModelComponents.map((comp) =>
      comp._id === furnishedModelComponentId
        ? ({ ...comp, name: entity.name, meshName: entity.meshName } as any)
        : comp
    );
  }

  /**
   * Rebuild a placed item's components AFTER an in-place mesh split — one
   * component per split mesh name (Mesh_0, Mesh_1, …), cloning the original
   * component's material/finish. Keeps the SAME item (no new model/item).
   */
  async createComponentsForSplit(
    furnishedModelId: string,
    meshNames: string[]
  ) {
    const existing = this.getFurnishedModelComponents(furnishedModelId) || [];
    const template: any = existing[0] || {};
    // Remove the old component(s) for this item.
    for (const c of existing) {
      try {
        await new FurnishedModelComponent({ ...(c as any) }).remove();
      } catch (e) {
        /* best-effort */
      }
    }
    this.furnishedModelComponents = this.furnishedModelComponents.filter(
      (c) => c.furnishedModelId !== furnishedModelId
    );
    // One new component per split mesh, cloning the finish/material.
    for (const name of meshNames) {
      const comp = new FurnishedModelComponent({
        _id: uuidv4(),
        furnishedModelId,
        parentComponentId: template?.parentComponentId || "",
        name,
        meshName: name,
        position: [],
        scale: [],
        rotation: [],
        baseMaterialProperties: template?.baseMaterialProperties || "",
        visible: true,
        exposed: true,
        locationWithinParent: "",
        coreMaterialTypeId: template?.coreMaterialTypeId || "",
        coreMaterialGrade: template?.coreMaterialGrade || "",
        coreMaterialBrandId: template?.coreMaterialBrandId || "",
        coreMaterialThickness: template?.coreMaterialThickness || 0,
        externalFinishClassification:
          template?.externalFinishClassification || "",
        externalFinishBrandId: template?.externalFinishBrandId || "",
        externalFinishFinishingId: template?.externalFinishFinishingId || "",
        externalFinishGrainDirection: "",
        internalFinishClassification: "",
        internalFinishBrandId: "",
        internalFinishFinishingId: template?.internalFinishFinishingId || "",
        internalFinishGrainDirection: "",
        edgeBandThickness: 0,
        edgeBandColor: "",
        dimensions: [],
        width: "1",
        height: "1",
        textureId: "",
      } as any);
      await comp.save();
      this.furnishedModelComponents = this.furnishedModelComponents.concat([
        comp as any,
      ]);
    }
  }

  /**
   * Clear a component's EXTERIOR + INTERIOR finish so it falls back to the item's
   * default colour. Used by Ungroup to also reset the combine colour. The core
   * material (the board) is left untouched — only the visible finish is cleared.
   */
  async resetFurnishedModelComponentFinish(furnishedModelComponentId: string) {
    const target = this.furnishedModelComponents.find(
      (comp) => comp._id === furnishedModelComponentId
    );
    if (!target) return;
    const cleared = {
      externalFinishFinishingId: "",
      externalFinishBrandId: "",
      externalFinishClassification: "",
      externalFinishFinishing: undefined,
      internalFinishFinishingId: "",
      internalFinishBrandId: "",
      internalFinishClassification: "",
      internalFinishFinishing: undefined,
    };
    const entity = new FurnishedModelComponent({ ...target, ...cleared } as any);
    await entity.update();
    this.furnishedModelComponents = this.furnishedModelComponents.map((comp) =>
      comp._id === furnishedModelComponentId
        ? ({ ...comp, ...cleared } as any)
        : comp
    );
  }

  async updateFurnishedModel(data: FurnishedModel) {
    console.debug("ProjectManager.ts ~ updateFurnishedModel ~ data", data);
    const list = this.furnishedModels.filter(
      (furnishedModel) => furnishedModel._id !== data._id
    );
    this.furnishedModels = list.concat([data]);
    const title =
      data?.model?.type === MODEL_TYPES.WALL_UNIT
        ? HISTORY_TITLES.WALL_ITEM_UPDATED
        : HISTORY_TITLES.FLOOR_ITEM_UPDATED;
    await this.updateFloorPlan(title);
  }

  async removeFurnishedModel(furnishedModelId: string) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ removeFurnishedModel ~ existingFurnishedModel",
      existingFurnishedModel
    );
    await handleDeleteSelectedModel();
    if (existingFurnishedModel) {
      this.furnishedModels = this.furnishedModels.filter(
        (model) => model._id !== existingFurnishedModel._id
      );
      await existingFurnishedModel.remove();
    }
    const title =
      existingFurnishedModel?.model?.type === MODEL_TYPES.WALL_UNIT
        ? HISTORY_TITLES.WALL_ITEM_REMOVED
        : HISTORY_TITLES.FLOOR_ITEM_REMOVED;
    await this.updateFloorPlan(title);
  }

  async removeAllFurnishedModels() {
    await Promise.all(
      BlueprintInterface.blueprint3d.roomplanner.physicalRoomItems.map(
        (physicalRoomItem: any) => {
          BlueprintInterface.blueprint3d.model.removeItemByMetaData(
            physicalRoomItem
          );
        }
      )
    );
    await Promise.all(
      this.furnishedModels.map(async (furnishedModel) => {
        const existingFurnishedModel = this.getFurnishedModelById(
          furnishedModel._id
        );
        console.debug(
          "DEBUG: ProjectManager.ts ~ removeAllFurnishedModels ~ existingFurnishedModel",
          existingFurnishedModel
        );
        if (existingFurnishedModel) {
          this.furnishedModels = this.furnishedModels.filter(
            (model) => model._id !== existingFurnishedModel._id
          );
          await existingFurnishedModel.remove();
        }
      })
    );
    const title = HISTORY_TITLES.FLOORPLAN_RESET;
    await this.updateFloorPlan(title);
  }

  async onFurnishedModelPositionChange(
    furnishedModelId: string,
    position: number[]
  ) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelPositionChange ~ existingFurnishedModel",
      existingFurnishedModel
    );
    if (
      existingFurnishedModel &&
      (existingFurnishedModel.position[0] !== position[0] ||
        existingFurnishedModel.position[1] !== position[1] ||
        existingFurnishedModel.position[2] !== position[2])
    ) {
      await existingFurnishedModel.handlePositionChange(position);
      const title =
        existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
          ? HISTORY_TITLES.FLOOR_ITEM_POSITION_CHANGED
          : HISTORY_TITLES.WALL_ITEM_POSITION_CHANGED;
      await this.updateFloorPlan(title);
    }
  }

  async onFurnishedModelRoomUpdated(
    furnishedModelId: string,
    roomId: string,
    roomName: string
  ) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelPositionChange ~ existingFurnishedModel",
      existingFurnishedModel
    );
    if (existingFurnishedModel) {
      await existingFurnishedModel.handleRoomChange(roomId, roomName);
    }
  }

  async onFurnishedModelRotationChange(
    furnishedModelId: string,
    mode: ROTATION_MODES,
    angle?: number
  ) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelRotationChange ~ existingFurnishedModel",
      existingFurnishedModel
    );
    if (existingFurnishedModel) {
      await existingFurnishedModel.handleRotationChange(mode, angle);
      const title =
        existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
          ? HISTORY_TITLES.FLOOR_ITEM_ROTATED
          : HISTORY_TITLES.WALL_ITEM_ROTATED;
      await this.updateFloorPlan(title);
    }
  }

  async onFurnishedModelHandleChanged(furnishedModelId: string) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelHandleChanged ~ existingFurnishedModel",
      existingFurnishedModel
    );
    if (existingFurnishedModel) {
      await existingFurnishedModel.onHandleChanged();
      const title =
        existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
          ? HISTORY_TITLES.FLOOR_ITEM_UPDATED
          : HISTORY_TITLES.WALL_ITEM_UPDATED;
      await this.updateFloorPlan(title);
    }
  }

  async onFurnishedModelWidthChange(furnishedModelId: string, width: number) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelWidthChange ~ existingFurnishedModel",
      existingFurnishedModel
    );
    if (existingFurnishedModel) {
      await existingFurnishedModel.handleWidthChange(width);
      const title =
        existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
          ? HISTORY_TITLES.FLOOR_ITEM_DIMENSION_CHANGED
          : HISTORY_TITLES.WALL_ITEM_DIMENSION_CHANGED;
      await this.updateFloorPlan(title);
    }
  }

  async onFurnishedModelHeightChange(furnishedModelId: string, height: number) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelHeightChange ~ existingFurnishedModel",
      existingFurnishedModel
    );
    if (existingFurnishedModel) {
      await existingFurnishedModel.handleHeightChange(height);
      const title =
        existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
          ? HISTORY_TITLES.FLOOR_ITEM_DIMENSION_CHANGED
          : HISTORY_TITLES.WALL_ITEM_DIMENSION_CHANGED;
      await this.updateFloorPlan(title);
    }
  }

  async onFurnishedModelDepthChange(furnishedModelId: string, depth: number) {
    const existingFurnishedModel = this.getFurnishedModelById(furnishedModelId);
    console.debug(
      "DEBUG: ProjectManager.ts ~ onFurnishedModelDepthChange ~ existingFurnishedModel",
      existingFurnishedModel,
      depth
    );
    if (existingFurnishedModel) {
      await existingFurnishedModel.handleDepthChange(depth);
      const title =
        existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
          ? HISTORY_TITLES.FLOOR_ITEM_DIMENSION_CHANGED
          : HISTORY_TITLES.WALL_ITEM_DIMENSION_CHANGED;
      await this.updateFloorPlan(title);
    }
  }

  async onFurnishModelComponentsExtFinishChange(
    furnishedModelComponents: FurnishedModelComponent[],
    selectedFinishing: Finishing
  ) {
    let title = "";
    await Promise.all(
      furnishedModelComponents.map(
        async (component: FurnishedModelComponent) => {
          const existingFurnishedModelComponent =
            this.getFurnishedModelComponentById(component._id);
          if (existingFurnishedModelComponent) {
            this.furnishedModelComponents = this.furnishedModelComponents.map(
              (furnishedModelComponent) =>
                furnishedModelComponent._id ===
                existingFurnishedModelComponent._id
                  ? {
                      ...furnishedModelComponent,
                      externalFinishFinishing: selectedFinishing,
                      externalFinishFinishingId: selectedFinishing._id,
                    }
                  : furnishedModelComponent
            );
            await new FurnishedModelComponent({
              ...existingFurnishedModelComponent,
            }).updateExternalFinishing(selectedFinishing);
            const existingFurnishedModel = this.getFurnishedModelById(
              existingFurnishedModelComponent.furnishedModelId
            );
            console.debug(
              "DEBUG: ProjectManager.ts ~ onFurnishedModelRotationChange ~ existingFurnishedModel",
              existingFurnishedModel
            );
            if (existingFurnishedModel) {
              title =
                existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
                  ? HISTORY_TITLES.FLOOR_ITEM_TEXTURE_CHANGED
                  : HISTORY_TITLES.WALL_ITEM_TEXTURE_CHANGED;
            }
          }
        }
      )
    );
    if (title) await this.updateFloorPlan(title);
  }

  async onFurnishModelComponentsIntFinishChange(
    furnishedModelComponents: FurnishedModelComponent[],
    selectedFinishing: Finishing
  ) {
    let title = "";
    await Promise.all(
      furnishedModelComponents.map(
        async (component: FurnishedModelComponent) => {
          const existingFurnishedModelComponent =
            this.getFurnishedModelComponentById(component._id);
          if (existingFurnishedModelComponent) {
            this.furnishedModelComponents = this.furnishedModelComponents.map(
              (furnishedModelComponent) =>
                furnishedModelComponent._id ===
                existingFurnishedModelComponent._id
                  ? {
                      ...furnishedModelComponent,
                      internalFinishFinishing: selectedFinishing,
                      internalFinishFinishingId: selectedFinishing._id,
                    }
                  : furnishedModelComponent
            );
            await new FurnishedModelComponent({
              ...existingFurnishedModelComponent,
            }).updateInternalFinishing(selectedFinishing);
            const existingFurnishedModel = this.getFurnishedModelById(
              existingFurnishedModelComponent.furnishedModelId
            );
            console.debug(
              "DEBUG: ProjectManager.ts ~ onFurnishedModelRotationChange ~ existingFurnishedModel",
              existingFurnishedModel
            );
            if (existingFurnishedModel) {
              title =
                existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
                  ? HISTORY_TITLES.FLOOR_ITEM_TEXTURE_CHANGED
                  : HISTORY_TITLES.WALL_ITEM_TEXTURE_CHANGED;
            }
          }
        }
      )
    );
    if (title) await this.updateFloorPlan(title);
  }

  async onFurnishModelComponentExtFinishChange(
    component: FurnishedModelComponent,
    selectedFinishing: Finishing
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                externalFinishFinishing: selectedFinishing,
                externalFinishFinishingId: selectedFinishing._id,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateExternalFinishing(selectedFinishing);
      const existingFurnishedModel = this.getFurnishedModelById(
        existingFurnishedModelComponent.furnishedModelId
      );
      console.debug(
        "DEBUG: ProjectManager.ts ~ onFurnishedModelRotationChange ~ existingFurnishedModel",
        existingFurnishedModel
      );
      if (existingFurnishedModel) {
        const title =
          existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
            ? HISTORY_TITLES.FLOOR_ITEM_TEXTURE_CHANGED
            : HISTORY_TITLES.WALL_ITEM_TEXTURE_CHANGED;
        await this.updateFloorPlan(title);
      }
    }
  }

  async onFurnishModelComponentIntFinishChange(
    component: FurnishedModelComponent,
    selectedFinishing: Finishing
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                internalFinishFinishing: selectedFinishing,
                internalFinishFinishingId: selectedFinishing._id,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateInternalFinishing(selectedFinishing);
      const existingFurnishedModel = this.getFurnishedModelById(
        existingFurnishedModelComponent.furnishedModelId
      );
      console.debug(
        "DEBUG: ProjectManager.ts ~ onFurnishedModelRotationChange ~ existingFurnishedModel",
        existingFurnishedModel
      );
      if (existingFurnishedModel) {
        const title =
          existingFurnishedModel?.model?.type === MODEL_TYPES.FLOOR_UNIT
            ? HISTORY_TITLES.FLOOR_ITEM_TEXTURE_CHANGED
            : HISTORY_TITLES.WALL_ITEM_TEXTURE_CHANGED;
        await this.updateFloorPlan(title);
      }
    }
  }

  async onFurnisheModelComponentExtBrandChange(
    component: FurnishedModelComponent,
    externalFinishBrandId: string
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                externalFinishBrandId: externalFinishBrandId,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateExternalFinishingBrand(externalFinishBrandId);
    }
  }

  async onFurnisheModelComponentIntBrandChange(
    component: FurnishedModelComponent,
    internalFinishBrandId: string
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                internalFinishBrandId: internalFinishBrandId,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateInternalFinishingBrand(internalFinishBrandId);
    }
  }

  async onFurnisheModelCompCoreMaterialTypeChange(
    component: FurnishedModelComponent,
    coreMaterialTypeId: string
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                coreMaterialTypeId: coreMaterialTypeId,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateCoreMaterialType(coreMaterialTypeId);
    }
  }

  async onFurnisheModelCompCoreMaterialBrandChange(
    component: FurnishedModelComponent,
    coreMaterialBrandId: string
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                coreMaterialBrandId: coreMaterialBrandId,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateCoreMaterialBrand(coreMaterialBrandId);
    }
  }

  async onFurnisheModelCompCoreMaterialGradeChange(
    component: FurnishedModelComponent,
    coreMaterialGrade: string
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                coreMaterialGrade: coreMaterialGrade,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateCoreMaterialGrade(coreMaterialGrade);
    }
  }

  async onFurnisheModelCompCoreMaterialThicknessChange(
    component: FurnishedModelComponent,
    coreMaterialThickness: number
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                coreMaterialThickness: coreMaterialThickness,
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateCoreMaterialThickness(coreMaterialThickness);
    }
  }

  async onFurnishModelComponenetAdditionalPropsChange(
    component: FurnishedModelComponent,
    additionalProperties: string
  ) {
    const existingFurnishedModelComponent = this.getFurnishedModelComponentById(
      component._id
    );
    if (existingFurnishedModelComponent) {
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (furnishedModelComponent) =>
          furnishedModelComponent._id === existingFurnishedModelComponent._id
            ? {
                ...furnishedModelComponent,
                componentProperties: {
                  ...furnishedModelComponent.componentProperties,
                  additionalProperties: additionalProperties,
                },
              }
            : furnishedModelComponent
      );
      await new FurnishedModelComponent({
        ...existingFurnishedModelComponent,
      }).updateComponentAdditionalProps(additionalProperties);
    }
  }

  async updateFurnisheModelExposureOnSnapped(
    furnishedModelId: string,
    snappedDirection: string
  ) {
    const furnishedModelComponents = this.furnishedModelComponents.filter(
      (comp) => comp.furnishedModelId === furnishedModelId
    );
    if (furnishedModelComponents?.length) {
      console.debug(
        "ProjectManager.ts ~ updateFurnisheModelExposureOnSnapped ~ furnishedModelComponents",
        furnishedModelComponents
      );
      await Promise.all(
        furnishedModelComponents.map((comp) => {
          new FurnishedModelComponent({ ...comp }).updateExposure(true);
        })
      );
      const shortDirection =
        snappedDirection === "left"
          ? "l"
          : snappedDirection === "right"
          ? "r"
          : null;
      let componentsToHide = furnishedModelComponents.filter(
        (comp) =>
          comp.name.toLowerCase().includes(snappedDirection) ||
          (shortDirection
            ? comp.name.toLowerCase().includes(`_${shortDirection}`) ||
              comp.name.toLowerCase().includes(` ${shortDirection}`)
            : false)
      );
      const shutterComponent = furnishedModelComponents.find((comp) =>
        comp.name.toLowerCase().includes("shutter")
      );
      if (snappedDirection === "front" && shutterComponent) {
        componentsToHide = [...componentsToHide, shutterComponent];
      }
      await Promise.all(
        componentsToHide.map((comp) => {
          new FurnishedModelComponent({ ...comp }).updateExposure(false);
        })
      );
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (comp) =>
          componentsToHide.find((compToHide) => comp._id === compToHide._id)
            ? { ...comp, exposed: false }
            : { ...comp, exposed: true }
      );
    }
  }

  async updateFurnisheModelCompExposure(
    currentExposed: boolean,
    furnishedModelComponentId: string
  ) {
    const furnishedModelComponent = this.furnishedModelComponents.find(
      (comp) => comp._id === furnishedModelComponentId
    );
    if (furnishedModelComponent) {
      // The caller passes the CURRENT exposure — flip it. Previously this set
      // the value to itself (no toggle) AND hardcoded the in-memory copy to
      // `false`, so the toggle never changed anything.
      const newExposed = !currentExposed;
      console.debug(
        "ProjectManager.ts ~ updateFurnisheModelCompExposure ~ toggle",
        { furnishedModelComponentId, currentExposed, newExposed }
      );
      await new FurnishedModelComponent({
        ...furnishedModelComponent,
      }).updateExposure(newExposed);
      this.furnishedModelComponents = this.furnishedModelComponents.map(
        (comp) =>
          comp._id === furnishedModelComponent._id
            ? { ...comp, exposed: newExposed }
            : comp
      );
    }
  }

  getFurnishedModelComponents(furnishedModelId: string) {
    console.debug(
      "ProjectManager.ts ~ getFurnishedModelComponents ~ furnishedModelId",
      furnishedModelId,
      this.furnishedModelComponents
    );
    return this.furnishedModelComponents?.filter(
      (comp) => comp.furnishedModelId === furnishedModelId
    );
  }

  async getFurnishedModelCompByNameAndFurnishedModelId(
    furnishedModelCompName: string,
    furnishedModelId: string
  ): Promise<FurnishedModelComponent | undefined> {
    console.debug(
      "ProjectManager.ts ~ getFurnishedModelComponents ~ furnishedModelId",
      furnishedModelId,
      this.furnishedModelComponents
    );
    return this.furnishedModelComponents?.find(
      (comp) =>
        comp.furnishedModelId === furnishedModelId &&
        // Match the 3D mesh identity FIRST (meshName = "Mesh_0"). A grouped part
        // is renamed (name = "Carcass"), so matching only on `name` missed it —
        // the panel then never got measured and priced at area 0 (₹0) in the
        // BOQ. Fall back to `name` for older rows that predate meshName.
        ((comp as any).meshName === furnishedModelCompName ||
          comp.name === furnishedModelCompName)
    );
  }
}
