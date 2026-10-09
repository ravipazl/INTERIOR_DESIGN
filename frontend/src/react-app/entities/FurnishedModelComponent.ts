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

      /**
       * WHICH LIVE MESH THIS PART IS — AND IT MUST NOT QUIETLY MISS.
       *
       * The finish is saved above, always. The 3D is repainted here, but only
       * if the mesh can be found, and the two are different stores: the panel
       * and the BOQ read the saved component, the 3D paints from the scene's
       * meshmap. So a miss here does not fail — it DRIFTS. The database says
       * Wood 10012, the cabinet goes on showing Wood 10002, and nothing
       * reports it because the save genuinely succeeded. That is exactly what
       * was happening: a part whose stored name no longer matched any live
       * mesh could never be repainted again.
       *
       * Matched on the name first, then on the index — Mesh_0…N, the position
       * this part sits at — which is the same fallback resetMeshesToDefault
       * uses a few lines below for the same mismatch. Still nothing: say so,
       * rather than leave the two stores disagreeing in silence.
       */
      const meshmap: any[] =
        BlueprintInterface?.blueprint3d?.model?.__roomItems?.find(
          (item: any) => item.__id === this.furnishedModelId
        )?.__meshmap || [];
      // Match on meshName, NOT name: the user can rename a part to its role
      // ("Shutter"), but the live mesh is still called "Mesh_3".
      const wanted = String(this.meshName || this.name || "");
      const byIndex = /^Mesh_(\d+)$/.exec(wanted);
      const selectedMeshComponentName =
        meshmap.find((comp: any) => comp?.name === wanted)?.name ??
        (byIndex ? meshmap[Number(byIndex[1])]?.name : undefined);

      if (!selectedMeshComponentName) {
        console.warn(
          "updateExternalFinishing: no live mesh matches",
          wanted,
          "— the finish is saved but the 3D view cannot be repainted.",
          "Meshes available:",
          meshmap.map((m: any) => m?.name)
        );
      }
      if (selectedMeshComponentName && selectedExternalFinishing.texture) {
        await BlueprintInterface?.blueprint3d?.model?.itemTextureColor(
          BlueprintInterface.selectedModels.find(
            (model) => model.itemModel.id === this.furnishedModelId
          ),
          {
            name: selectedMeshComponentName,
            texture: selectedExternalFinishing.texture.fileUrl,
            size: [1, 1, 1],
            // How big one copy of this picture is, in centimetres. Set on
            // materials whose image is a close photograph of a sample rather
            // than a door-scale tile — without it such a picture is stretched
            // across the whole panel and the grain flattens to a plain colour.
            // Absent on every material that predates this, which keeps their
            // appearance exactly as it was.
            tileCm: (selectedExternalFinishing as any)?.tileCm,
            // The part keeps whichever way its grain was set to run when a new
            // material is chosen — picking a different wood is not a reason to
            // silently straighten a door the designer deliberately turned.
            grain: this.externalFinishGrainDirection,
          }
        );
      }
    }
  }

  /**
   * Turn this part's wood grain, without changing the material on it.
   *
   * Separate from updateExternalFinishing because the two are independent
   * choices: the panel lets a part's direction be changed while it keeps the
   * finish it already has, and that repaint has no new Finishing to hand over.
   *
   * Exterior and interior each keep their own direction, because the panel
   * offers the control on both tabs. Only exterior is repainted — interior is
   * the inner lining and is never drawn on the visible mesh, exactly as in
   * updateInternalFinishing below.
   *
   * Persist first, repaint second, same as every other finish change — the
   * saved component and the scene's meshmap are different stores, so a repaint
   * that cannot find its mesh must still leave the choice recorded rather than
   * drop it silently.
   */
  async updateFinishGrainDirection(direction: string, isExterior: boolean) {
    console.debug(
      "FurnishedModelComponent.ts ~ updateFinishGrainDirection ~",
      this.meshName || this.name,
      direction,
      isExterior ? "exterior" : "interior"
    );
    if (isExterior) {
      this.externalFinishGrainDirection = direction;
    } else {
      this.internalFinishGrainDirection = direction;
    }
    await this.update();
    if (!isExterior) return;

    /**
     * WHAT IS CURRENTLY PAINTED ON THIS MESH — read from the scene, not from
     * the component.
     *
     * The obvious source is this.externalFinishFinishing, and it is the wrong
     * one: the stored row often carries only externalFinishFinishingId, with
     * the Finishing object populated at read time and not always present on
     * the copy in hand. Keyed off that, the method returned early and did
     * nothing at all — the dropdown moved, the direction saved, and the
     * cabinet never changed. No error, because not finding a finish is a
     * legitimate outcome for a part that has none.
     *
     * The scene's meshmap is the store the 3D actually paints from, and for a
     * painted part it already holds both the texture and its tile size. Asking
     * it means this can only disagree with what is on screen if what is on
     * screen is itself wrong.
     */
    const meshmap: any[] =
      BlueprintInterface?.blueprint3d?.model?.__roomItems?.find(
        (item: any) => item.__id === this.furnishedModelId
      )?.__meshmap || [];
    const wanted = String(this.meshName || this.name || "");
    const byIndex = /^Mesh_(\d+)$/.exec(wanted);
    const painted =
      meshmap.find((comp: any) => comp?.name === wanted) ??
      (byIndex ? meshmap[Number(byIndex[1])] : undefined);
    if (!painted?.name) {
      console.warn(
        "updateFinishGrainDirection: no live mesh matches",
        wanted,
        "— the direction is saved but the 3D view cannot be repainted."
      );
      return;
    }

    const finishing: any = this.externalFinishFinishing;
    const texture = painted.texture || finishing?.texture?.fileUrl;
    const tileCm = painted.tileCm ?? finishing?.tileCm;
    // Nothing to turn yet: the part has no finish on it. The direction is
    // saved above and takes effect as soon as one is applied.
    if (!texture) {
      console.debug(
        "updateFinishGrainDirection:",
        wanted,
        "has no texture yet — direction saved, nothing to repaint."
      );
      return;
    }

    await BlueprintInterface?.blueprint3d?.model?.itemTextureColor(
      BlueprintInterface.selectedModels.find(
        (model) => model.itemModel.id === this.furnishedModelId
      ),
      {
        name: painted.name,
        texture,
        size: [1, 1, 1],
        tileCm,
        grain: direction,
      }
    );
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
      // Interior brand — was wrongly written to the exterior brand field.
      this.internalFinishBrandId = selectedInternalFinishingBrandId;
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
