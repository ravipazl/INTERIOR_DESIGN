import BlueprintInterface from "@pazl/blueprint-interface";
import {
  LocalDBManager,
  LocalDBObjectStores,
} from "../services/LocalDBManager";
import { Finishing } from "@pazl/entities/Finishing";

export interface FurnishedModelComponentType {
  _id: string;
  furnishedModelId: string;
  parentComponentId: string;
  /** Part role shown to the user, e.g. "Shutter". Safe to rename. */
  name: string;
  /**
   * The 3D mesh this component paints ("Mesh_0", "Mesh_1", …). This is the
   * identity used to find the live mesh, so it must NEVER change — which is why
   * it is kept separate from `name`, which the user renames to a part role.
   */
  meshName?: string;
  position: number[];
  scale: number[];
  rotation: number[];
  baseMaterialProperties: string;
  componentProperties?: any;
  visible: boolean;
  exposed: boolean;
  locationWithinParent: string;
  coreMaterialTypeId: string;
  coreMaterialType?: any;
  coreMaterialGrade: string;
  coreMaterialBrandId: string;
  coreMaterialBrand?: any;
  coreMaterialThickness: number;
  externalFinishClassification: string;
  externalFinishBrandId: string;
  externalFinishBrand?: any;
  externalFinishFinishing?: Finishing;
  externalFinishFinishingId: string;
  externalFinishGrainDirection: string;
  internalFinishClassification: string;
  internalFinishBrandId: string;
  internalFinishBrand?: any;
  internalFinishFinishing?: Finishing;
  internalFinishFinishingId: string;
  internalFinishGrainDirection: string;
  edgeBandThickness: number;
  edgeBandColor: string;
  dimensions: number[];
  height: string;
  width: string;
  textureId: string;
}

export class FurnishedModelComponent extends LocalDBManager {
  _id: string;
  furnishedModelId: string;
  parentComponentId: string;
  name: string;
  /** Immutable 3D mesh identity — see the interface comment. */
  meshName?: string;
  position: number[];
  scale: number[];
  rotation: number[];
  baseMaterialProperties: string;
  componentProperties?: any;
  visible: boolean;
  exposed: boolean;
  locationWithinParent: string;
  coreMaterialTypeId: string;
  coreMaterialType?: any;
  coreMaterialGrade: string;
  coreMaterialBrandId: string;
  coreMaterialBrand?: any;
  coreMaterialThickness: number;
  externalFinishClassification: string;
  externalFinishBrandId: string;
  externalFinishBrand: any;
  externalFinishFinishing?: Finishing;
  externalFinishFinishingId: string;
  externalFinishGrainDirection: string;
  internalFinishClassification: string;
  internalFinishBrandId: string;
  internalFinishBrand?: any;
  internalFinishFinishing?: Finishing;
  internalFinishFinishingId: string;
  internalFinishGrainDirection: string;
  edgeBandThickness: number;
  edgeBandColor: string;
  dimensions: number[];
  width: string;
  height: string;
  textureId: string;

  constructor(props: FurnishedModelComponentType) {
    super();
    this._id = props._id;
    this.furnishedModelId = props.furnishedModelId;
    this.parentComponentId = props.parentComponentId;
    this.name = props.name;
    // Older rows have no meshName — back then `name` still WAS the mesh id
    // ("Mesh_3"), so it is the correct fallback.
    this.meshName = props.meshName || props.name;
    this.position = props.position;
    this.scale = props.scale;
    this.rotation = props.rotation;
    this.baseMaterialProperties = props.baseMaterialProperties;
    this.componentProperties = props.componentProperties;
    this.visible = props.visible;
    this.exposed = props.exposed;
    this.locationWithinParent = props.locationWithinParent;
    this.coreMaterialTypeId = props.coreMaterialTypeId;
    this.coreMaterialType = props.coreMaterialType;
    this.coreMaterialGrade = props.coreMaterialGrade;
    this.coreMaterialBrandId = props.coreMaterialBrandId;
    this.coreMaterialBrand = props.coreMaterialBrand;
    this.coreMaterialThickness = props.coreMaterialThickness;
    this.externalFinishClassification = props.externalFinishClassification;
    this.externalFinishBrandId = props.externalFinishBrandId;
    this.externalFinishBrand = props.externalFinishBrand;
    this.externalFinishFinishing = props.externalFinishFinishing;
    this.externalFinishFinishingId = props.externalFinishFinishingId;
    this.externalFinishGrainDirection = props.externalFinishGrainDirection;
    this.internalFinishClassification = props.internalFinishClassification;
    this.internalFinishBrandId = props.internalFinishBrandId;
    this.internalFinishBrand = props.internalFinishBrand;
    this.internalFinishFinishing = props.internalFinishFinishing;
    this.internalFinishFinishingId = props.internalFinishFinishingId;
    this.internalFinishGrainDirection = props.internalFinishGrainDirection;
    this.edgeBandThickness = props.edgeBandThickness;
    this.edgeBandColor = props.edgeBandColor;
    this.dimensions = props.dimensions;
    this.width = props.width;
    this.height = props.height;
    this.textureId = props.textureId;
  }

  async save() {
    const data = {
      _id: this._id,
      furnishedModelId: this.furnishedModelId,
      parentComponentId: this.parentComponentId,
      name: this.name,
      // Must be saved too, or renaming a part would lose its 3D mesh identity
      // and its material could never be repainted again.
      meshName: this.meshName,
      position: this.position,
      scale: this.scale,
      rotation: this.rotation,
      baseMaterialProperties: this.baseMaterialProperties,
      visible: this.visible,
      exposed: this.exposed,
      locationWithinParent: this.locationWithinParent,
      coreMaterialTypeId: this.coreMaterialTypeId,
      coreMaterialGrade: this.coreMaterialGrade,
      coreMaterialBrandId: this.coreMaterialBrandId,
      coreMaterialThickness: this.coreMaterialThickness,
      externalFinishClassification: this.externalFinishClassification,
      externalFinishBrandId: this.externalFinishBrandId,
      externalFinishFinishingId: this.externalFinishFinishingId,
      externalFinishGrainDirection: this.externalFinishGrainDirection,
      internalFinishClassification: this.internalFinishClassification,
      internalFinishBrandId: this.internalFinishBrandId,
      internalFinishFinishingId: this.internalFinishFinishingId,
      internalFinishGrainDirection: this.internalFinishGrainDirection,
      edgeBandThickness: this.edgeBandThickness,
      edgeBandColor: this.edgeBandColor,
      dimensions: this.dimensions,
      width: this.width,
      height: this.height,
    };
    if (!this._id) {
      delete data._id;
    }
    const savedEntityId = await this.saveToLocalDB(
      data,
      LocalDBObjectStores.FURNINSHED_MODEL_COMPONENT
    );
    return savedEntityId;
  }

  async update() {
    const data = {
      _id: this._id,
      furnishedModelId: this.furnishedModelId,
      parentComponentId: this.parentComponentId,
      name: this.name,
      // Must be saved too, or renaming a part would lose its 3D mesh identity
      // and its material could never be repainted again.
      meshName: this.meshName,
      position: this.position,
      scale: this.scale,
      rotation: this.rotation,
      baseMaterialProperties: this.baseMaterialProperties,
      visible: this.visible,
      exposed: this.exposed,
      locationWithinParent: this.locationWithinParent,
      coreMaterialTypeId: this.coreMaterialTypeId,
      coreMaterialGrade: this.coreMaterialGrade,
      coreMaterialBrandId: this.coreMaterialBrandId,
      coreMaterialThickness: this.coreMaterialThickness,
      externalFinishClassification: this.externalFinishClassification,
      externalFinishBrandId: this.externalFinishBrandId,
      externalFinishFinishingId: this.externalFinishFinishingId,
      externalFinishGrainDirection: this.externalFinishGrainDirection,
      internalFinishClassification: this.internalFinishClassification,
      internalFinishBrandId: this.internalFinishBrandId,
      internalFinishFinishingId: this.internalFinishFinishingId,
      internalFinishGrainDirection: this.internalFinishGrainDirection,
      edgeBandThickness: this.edgeBandThickness,
      edgeBandColor: this.edgeBandColor,
      dimensions: this.dimensions,
      width: this.width,
      height: this.height,
    };
    const savedEntityId = await this.updateToLocalDB(
      data,
      LocalDBObjectStores.FURNINSHED_MODEL_COMPONENT
    );
    return savedEntityId;
  }

  async remove() {
    const data = {
      _id: this._id,
      furnishedModelId: this.furnishedModelId,
      parentComponentId: this.parentComponentId,
      name: this.name,
      // Must be saved too, or renaming a part would lose its 3D mesh identity
      // and its material could never be repainted again.
      meshName: this.meshName,
      position: this.position,
      scale: this.scale,
      rotation: this.rotation,
      baseMaterialProperties: this.baseMaterialProperties,
      visible: this.visible,
      exposed: this.exposed,
      locationWithinParent: this.locationWithinParent,
      coreMaterialTypeId: this.coreMaterialTypeId,
      coreMaterialGrade: this.coreMaterialGrade,
      coreMaterialBrandId: this.coreMaterialBrandId,
      coreMaterialThickness: this.coreMaterialThickness,
      externalFinishClassification: this.externalFinishClassification,
      externalFinishBrandId: this.externalFinishBrandId,
      externalFinishFinishingId: this.externalFinishFinishingId,
      externalFinishGrainDirection: this.externalFinishGrainDirection,
      internalFinishClassification: this.internalFinishClassification,
      internalFinishBrandId: this.internalFinishBrandId,
      internalFinishFinishingId: this.internalFinishFinishingId,
      internalFinishGrainDirection: this.internalFinishGrainDirection,
      edgeBandThickness: this.edgeBandThickness,
      edgeBandColor: this.edgeBandColor,
      dimensions: this.dimensions,
      width: this.width,
      height: this.height,
    };
    await this.updateToLocalDB(
      { ...data, isDeleted: true },
      LocalDBObjectStores.FURNINSHED_MODEL_COMPONENT
    );
  }

  async updateExternalFinishing(selectedExternalFinishing: Finishing) {
    console.debug(
      "FurnishedModel.ts ~ updateExternalFinishing ~ selectedExternalFinishing",
      selectedExternalFinishing
    );
    if (selectedExternalFinishing) {
      // Persist the finish metadata FIRST — this must happen regardless of
      // whether the live mesh can be found (the 3D repaint is best-effort).
      // Previously the save was gated behind the mesh lookup, so if the mesh
      // name didn't match __meshmap the choice was silently dropped.
      this.externalFinishFinishing = selectedExternalFinishing;
      this.externalFinishFinishingId = selectedExternalFinishing._id;
      await this.update();

      const selectedMeshComponentName =
        BlueprintInterface?.blueprint3d?.model?.__roomItems
          ?.find((item: any) => item.__id === this.furnishedModelId)
          // Match on meshName, NOT name: the user can rename a part to its role
          // ("Shutter"), but the live mesh is still called "Mesh_3".
          ?.__meshmap.find(
            (comp: any) => comp.name === (this.meshName || this.name)
          )?.name;
      if (selectedMeshComponentName && selectedExternalFinishing.texture) {
        await BlueprintInterface?.blueprint3d?.model?.itemTextureColor(
          BlueprintInterface.selectedModels.find(
            (model) => model.itemModel.id === this.furnishedModelId
          ),
          {
            name: selectedMeshComponentName,
            texture: selectedExternalFinishing.texture.fileUrl,
            size: [1, 1, 1],
          }
        );
      }
    }
  }

  async updateInternalFinishing(selectedInternalFinishing: Finishing) {
    console.debug(
      "FurnishedModel.ts ~ updateInternalFinishing ~ selectedInternalFinishing",
      selectedInternalFinishing
    );
    if (selectedInternalFinishing) {
      // Persist first (see updateExternalFinishing); interior is never
      // repainted on the visible mesh, so persistence must not depend on the
      // live-mesh lookup at all.
      this.internalFinishFinishing = selectedInternalFinishing;
      this.internalFinishFinishingId = selectedInternalFinishing._id;
      await this.update();
      // Intentionally DO NOT repaint the live mesh here. Interior is the
      // inner-face lining (back of door, inside of drawer) — not visible
      // when the cabinet is closed. The choice is persisted for BOQ /
      // costing, but painting it on the single visible mesh would overwrite
      // the Exterior surface the customer actually sees.
      // (See updateExternalFinishing for the visual swap.)
    }
  }

  async updateExternalFinishingBrand(selectedExternalFinishingBrandId: string) {
    console.debug(
      "FurnishedModel.ts ~ updateExternalFinishingBrand ~ selectedExternalFinishing",
      selectedExternalFinishingBrandId
    );
    if (selectedExternalFinishingBrandId) {
      this.externalFinishBrandId = selectedExternalFinishingBrandId;
      await this.update();
    }
  }

  async updateInternalFinishingBrand(selectedInternalFinishingBrandId: string) {
    console.debug(
      "FurnishedModel.ts ~ updateInternalFinishingBrand ~ selectedExternalFinishing",
      selectedInternalFinishingBrandId
    );
    if (selectedInternalFinishingBrandId) {
      this.externalFinishBrandId = selectedInternalFinishingBrandId;
      await this.update();
    }
  }

  async updateCoreMaterialType(selectedCoreMaterialTypeId: string) {
    console.debug(
      "FurnishedModel.ts ~ updateCoreMaterialType ~ selectedCoreMaterialTypeId",
      selectedCoreMaterialTypeId
    );
    if (selectedCoreMaterialTypeId) {
      this.coreMaterialTypeId = selectedCoreMaterialTypeId;
      await this.update();
    }
  }

  async updateCoreMaterialBrand(selectedCoreMaterialBrandId: string) {
    console.debug(
      "FurnishedModel.ts ~ updateCoreMaterialType ~ selectedCoreMaterialBrand",
      selectedCoreMaterialBrandId
    );
    if (selectedCoreMaterialBrandId) {
      this.coreMaterialBrandId = selectedCoreMaterialBrandId;
      await this.update();
    }
  }

  async updateCoreMaterialGrade(selectedCoreMaterialGrade: string) {
    console.debug(
      "FurnishedModel.ts ~ updateCoreMaterialGrade ~ selectedCoreMaterialGrade",
      selectedCoreMaterialGrade
    );
    if (selectedCoreMaterialGrade) {
      this.coreMaterialGrade = selectedCoreMaterialGrade;
      await this.update();
    }
  }

  async updateCoreMaterialThickness(selectedCoreMaterialThickness: number) {
    console.debug(
      "FurnishedModel.ts ~ updateCoreMaterialThickness ~ selectedCoreMaterialThickness",
      selectedCoreMaterialThickness
    );
    if (selectedCoreMaterialThickness) {
      this.coreMaterialThickness = selectedCoreMaterialThickness;
      await this.update();
    }
  }

  async updateDimensions(height: number, width: number) {
    console.debug(
      "FurnishedModel.ts ~ updateDimensions ~ dimensions",
      height,
      width
    );
    if (height && width) {
      const h = height * 10; // convert cm to mm
      const w = width * 10; // convert cm to mm
      this.width = w.toFixed(2);
      this.height = h.toFixed(2);
      await this.update();
    }
  }

  async updateComponentAdditionalProps(additionalProperties: string) {
    console.debug(
      "FurnishedModel.ts ~ updateComponentAdditionalProps ~ additionalProperties",
      additionalProperties
    );
    if (additionalProperties) {
      this.componentProperties = {
        ...this.componentProperties,
        additionalProperties: additionalProperties,
      };
      await this.update();
    }
  }

  async updateExposure(isExposed: boolean) {
    console.debug("FurnishedModel.ts ~ updateExposure ~ isExposed", isExposed);
    this.exposed = isExposed;
    await this.update();
  }

  /**
   * Rename a part to its role — "Shutter", "Side panel", "Leg" … The app groups
   * Carcass / Shutter / Handle by this name, so naming the door "Shutter" is
   * what lets the BOQ and the working-drawing legend tell it from the carcass.
   *
   * The 3D identity is pinned into `meshName` first, so the part's material
   * keeps repainting correctly after the rename.
   */
  async updatePartName(newName: string) {
    const clean = String(newName || "").trim();
    console.debug("FurnishedModel.ts ~ updatePartName ~ newName", clean);
    if (!clean || clean === this.name) return;
    if (!this.meshName) this.meshName = this.name; // pin the 3D identity
    this.name = clean;
    await this.update();
  }
}
