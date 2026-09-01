import React, { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import { Finishing } from "@pazl/entities/Finishing";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";
import { ModelsService } from "@pazl/services/ModelsService";
import BlueprintInterface from "@pazl/blueprint-interface";
import { TexturesService } from "@pazl/services/texturesService";
import { RatesService } from "@pazl/services/RatesService";
import ObjectMaterialModal from "@pazl/components/ObjectMaterialModal";
import ObjectFinishingsModal from "@pazl/components/ObjectFinishingsModal";
import ComponentsGroup from "./componentsGroup";
import "./objectComponents.css";
import "@pazl/components/MenuBar/index.css";
import HandleTypesModal from "@pazl/components/HandleTypesModal";
import { CategoriesService } from "@pazl/services/categoriesService";
import { Model } from "@pazl/entities/Model";
import { Category } from "@pazl/entities/Category";

interface ObjectComponentsProp {
  selectedModel: FurnishedModel;
  isDarkMode: boolean;
  onHideObjectPanel: () => void;
  isMultiSelectMode: boolean;
}

export enum Finishing_Types {
  EXTERIOR = "exterior",
  INTERIOR = "interior",
}

export const grainDirections = [
  { _id: uuidv4(), name: "Horizontal" },
  { _id: uuidv4(), name: "Vertical" },
];

function ObjectComponents({
  selectedModel,
  isDarkMode,
  onHideObjectPanel,
  isMultiSelectMode,
}: ObjectComponentsProp) {
  const [groupedModelComponents, setGroupedModelComponents] = useState<any[]>(
    []
  );
  const [handleModels, setHandleModels] = useState<Model[]>([]);
  const [handleTypes, setHandleTypes] = useState<Category[]>([]);
  const [selectedHandleType, setSelectedHandleType] = useState<Category | null>(
    null
  );
  const [selectedHandleModels, setSelectedHandleModels] = useState<Model[]>([]);
  const [showObjectComponentsModal, setShowObjectComponentsModal] =
    useState(false);
  const [showHandleTypesModal, setShowHandleTypesModal] = useState(false);
  const [selectedComponentGroup, setSelectedComponentGroup] =
    useState<any>(null);
  const [selectedChildComponent, setSelectedChildComponent] =
    useState<FurnishedModelComponent | null>(null);
  const [selectedGrainDirection, setSelectedGrainDirection] = useState("");
  const [selectedMaterialBrand, setSelectedMaterialBrand] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<Finishing | null>(null);
  const [selectedCategoryType, setSelectedCategoryType] = useState("");
  const [selectedFinishingType, setSelectedFinishingType] = useState("");
  const [allFinishingCategories, setAllFinishingCategories] = useState<any[]>();
  const [finishingCategories, setFinishingCategories] = useState<any[]>([]);
  const [finishingsList, setFinishingsList] = useState<Finishing[]>([]);
  // Cabinets whose default finish has already been auto-applied (once each).
  const autoFinishAppliedRef = useRef<Set<string>>(new Set());
  const [isEdgeBandPropAvailable, setIsEdgeBandPropAvailable] = useState(false);
  const [isEdgeBandExpanded, setIsEdgeBandExpanded] = useState(false);
  const [coreMaterialBrands, setCoreMaterialBrands] = useState<any[]>([]);
  // Master core-material types (with their grades[]) — single source of truth,
  // shared with the Rate Card. Drives the Type + Grade dropdowns so the 3D
  // picker matches the master and the BOQ can find the rate.
  const [coreMaterialTypeList, setCoreMaterialTypeList] = useState<any[]>([]);
  // Distinct thickness values defined on the master material rates — shown in
  // the 3D Core Material dropdown (reference only; does not affect BOQ price).
  const [coreMaterialThicknessList, setCoreMaterialThicknessList] = useState<
    number[]
  >([]);
  // Finishing categories (coating sub-categories) that have a rate in the Rate
  // Card — the finish picker offers only these, so every coating is priced.
  const [pricedCoatingCatIds, setPricedCoatingCatIds] = useState<string[]>([]);
  // Coating rate rows + finishing-brand master — used to offer, in the finish
  // picker's Brand dropdown, only the brands that have a rate for the chosen
  // style's category (so coatings price correctly in the BOQ).
  const [coatingRates, setCoatingRates] = useState<any[]>([]);
  const [finishingBrandsMaster, setFinishingBrandsMaster] = useState<any[]>([]);
  const [selectedComponentIndex, setSelectedComponentIndex] = useState<
    number | null
  >(null);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [componentAdditionalProps, setComponentAdditionalProps] = useState<
    any[]
  >([]);
  const [componentProps, setComponentProps] = useState<any>({});
  const [showCoreMaterialsModal, setShowCoreMaterialsModal] = useState(false);
  const [styles, setStyles] = useState<any[]>([]);
  const [selectedType, setSelectedType] = useState<any>(null);
  const [showLoader, setShowLoader] = useState(true);
  //const [isUpdatingFinishing, setIsUpdatingFinishing] = useState(false);
  const isFinishingUpdateRef = useRef(false);
  const [componentGroup, setComponentGroup] = useState(selectedComponentGroup);
  const prevSelectedModelId = useRef<string | null>(null);

  useEffect(() => {
    getFinishingCategories();
    loadPricedCoreMaterials();
    loadPricedCoatings();
    return () => {
      setShowCoreMaterialsModal(false);
      setShowObjectComponentsModal(false);
      setIsEdgeBandPropAvailable(false);
      setIsEdgeBandExpanded(false);
      setColorPickerVisible(false);
    };
  }, []);

  // Auto-open the first group ONCE per item, not every time the selection
  // becomes null. Previously closing a group (selection → null) instantly
  // re-opened the first one, so the Carcass group could never be closed.
  const autoOpenedGroupRef = useRef(false);
  useEffect(() => {
    autoOpenedGroupRef.current = false; // new item → allow one auto-open
  }, [selectedModel?._id]);
  useEffect(() => {
    if (
      !autoOpenedGroupRef.current &&
      !selectedComponentGroup &&
      groupedModelComponents.length > 0
    ) {
      autoOpenedGroupRef.current = true;
      setSelectedComponentGroup(groupedModelComponents[0]);
    }
  }, [groupedModelComponents, selectedComponentGroup, selectedModel?._id]);

  // Clear any per-mesh outline when this panel goes away (item deselected,
  // panel closed, or tab change). Without this the BoxHelper sticks around
  // pointing at a mesh whose owner is no longer relevant.
  useEffect(() => {
    return () => {
      BlueprintInterface.clearMeshHighlight();
    };
  }, []);

  // Also drop the outline whenever the user clicks a different placed item.
  useEffect(() => {
    BlueprintInterface.clearMeshHighlight();
  }, [selectedModel?._id]);

  // Outline the meshes covered by the currently focused row. A child-component
  // pick (single mesh) wins over the group; otherwise outline every mesh in
  // the group. Fires on the initial auto-select too, so the user sees which
  // part the first row controls without clicking.
  useEffect(() => {
    // Highlight by meshName (the real 3D mesh, e.g. "Mesh_0"), not the part
    // name — grouped parts are all named "carcass", so a name-based highlight
    // lit the wrong/all meshes.
    if (selectedChildComponent) {
      const mn =
        (selectedChildComponent as any)?.meshName ||
        selectedChildComponent?.name;
      if (mn) {
        BlueprintInterface.highlightMeshes([mn]);
        return;
      }
    }
    const meshNames = (selectedComponentGroup?.components ?? [])
      .map((c: any) => c?.meshName || c?.name)
      .filter(Boolean);
    if (meshNames.length) {
      BlueprintInterface.highlightMeshes(meshNames);
    } else {
      BlueprintInterface.clearMeshHighlight();
    }
  }, [selectedComponentGroup, selectedChildComponent]);

  useEffect(() => {
    if (selectedModel) {
      getModelComponents(isMultiSelectMode);
    }
    setComponentGroup(selectedComponentGroup);
    if (selectedModel && selectedModel._id !== prevSelectedModelId.current) {
      setSelectedComponentGroup(null);
      prevSelectedModelId.current = selectedModel._id;
    }
  }, [selectedModel, isMultiSelectMode, selectedComponentGroup]);

  useEffect(() => {
    if (componentAdditionalProps?.length) {
      handleComponentAdditionalPropsChange();
    }
  }, [componentAdditionalProps]);

  useEffect(() => {
    if (selectedStyle && selectedFinishingType) {
      getFinishings();
    }
  }, [selectedStyle, selectedFinishingType]);

  // Load the full finishings list on mount too — the sidebar needs it to
  // resolve a component's saved externalFinishFinishingId into the finish
  // object (name + texture). Previously it only loaded when the finish modal
  // was open, so an already-applied finish showed only its brand on reload.
  useEffect(() => {
    getFinishings();
  }, []);

  // When the finishings list arrives after the components were already grouped,
  // re-run the enrichment so the saved finish resolves (name + color swatch).
  useEffect(() => {
    if (finishingsList.length && selectedModel) {
      getModelComponents(isMultiSelectMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishingsList]);

  // AUTO DEFAULT FINISH (full): when an item that loaded GREY (auto-coloured
  // wood in 3D) has NO exterior finish on any part, apply a default wood finish
  // to ALL its parts — writing the finish RECORD via the SAME call the manual
  // picker uses. This makes the default show in the Properties Exterior swatch
  // AND the BOQ (not just the 3D mesh). Applies to ANY grey item (matching the
  // 3D paint), not just cabinets. Guarded: grey-only, once per model, never
  // overrides an existing finish, fully try/caught.
  useEffect(() => {
    (async () => {
      try {
        const model: any = selectedModel;
        if (!model || !finishingsList.length || !groupedModelComponents.length)
          return;
        // Wait for the priced-brand data too, so the default finish AND its
        // default brand are applied together (never a finish with an empty
        // brand because the brand list hadn't loaded yet).
        if (!coatingRates.length || !finishingBrandsMaster.length) return;
        const id = model?._id;
        if (!id || autoFinishAppliedRef.current.has(id)) return;
        // Only items the 3D layer auto-coloured grey→wood. Physical3DItem sets
        // __autoDefaultColored on the placed item when it painted a grey mesh.
        // Items that came in with their own colour/texture (sofa, chair, ...)
        // leave the flag false and are skipped — so their Components stay as-is,
        // exactly like their 3D look. Cabinet names kept as a safe fallback for
        // any item whose 3D flag isn't reachable yet.
        const placed: any = (BlueprintInterface as any)?.selectedModels?.find(
          (m: any) => m?.itemModel?.id === id
        );
        const nm = String(model?.model?.name || model?.name || "").toLowerCase();
        const isCabinet =
          /\bbc\b|below counter|tall unit|wardrobe|cabinet|storage/.test(nm);
        const isGreyAutoColored = placed?.__autoDefaultColored === true;
        if (!isGreyAutoColored && !isCabinet) return;
        // Skip if ANY part already has an exterior finish (don't override).
        const hasFinish = groupedModelComponents.some((g: any) =>
          (g?.components || []).some((c: any) => c?.externalFinishFinishingId)
        );
        if (hasFinish) {
          autoFinishAppliedRef.current.add(id);
          return;
        }
        // ITEM-WISE default finish: pick the finishing that matches the item's
        // kind (set by the 3D layer). The catalog names finishings by style
        // prefix — Wood…, Solid…, Pattern…, Contemporary…. For sofas & chairs we
        // PREFER a specific warm-cream colour (Solid 21054) so upholstery looks
        // like a real fabric sofa (matches the reference), not a random first
        // colour; wood items → Wood Grain; lights → Contemporary (modern/metal).
        // Shows the right material in Components + 3D + BOQ, per item type.
        const kind: string =
          placed?.__autoDefaultKind || (isCabinet ? "wood" : "wood");
        // Preferred EXACT default material per kind (chosen to look good by
        // default). Falls back to the style prefix if that exact one is missing.
        const KIND_PREFERRED: Record<string, RegExp> = {
          fabric: /^solid\s*21054$/i, // warm cream/beige — sofas & chairs
        };
        const KIND_PREFIX: Record<string, RegExp> = {
          wood: /^wood/i,
          fabric: /^solid/i,
          metal: /^contemporary/i,
        };
        const preferred = KIND_PREFERRED[kind];
        const prefix = KIND_PREFIX[kind] || /^wood/i;
        const withTex = (f: any) => f?.texture?.fileUrl;
        const finishing: any =
          (preferred &&
            finishingsList.find(
              (f: any) => preferred.test(String(f?.name || "").trim()) && withTex(f)
            )) ||
          finishingsList.find((f: any) => prefix.test(f?.name || "") && withTex(f)) ||
          // fall back to wood, then to any textured finishing.
          finishingsList.find((f: any) => /^wood/i.test(f?.name || "") && withTex(f)) ||
          finishingsList.find((f: any) => withTex(f));
        if (!finishing) return;
        const allComps = groupedModelComponents.flatMap(
          (g: any) => g?.components || []
        );
        if (!allComps.length) return;
        autoFinishAppliedRef.current.add(id);
        // Write the finish record + paint + persist (same as the manual picker).
        await BlueprintInterface.ProjectManagerService.onFurnishModelComponentsExtFinishChange(
          allComps,
          finishing
        );
        // DEFAULT BRAND: also pick the FIRST brand so the Brand dropdown isn't
        // left on "Select…". Prefer a brand PRICED for this finish's
        // category (same rule the Brand dropdown uses, so the BOQ prices it);
        // fall back to the first priced brand overall. The user can still
        // change it afterwards — this only fills the empty default.
        const finishCatId = (finishing as any)?.finishingCategoryId;
        const defBrandId =
          (coatingRates.find(
            (r: any) =>
              r.finishingCategoryId === finishCatId && r.finishingBrandId
          )?.finishingBrandId ||
            coatingRates.find((r: any) => r.finishingBrandId)
              ?.finishingBrandId) ??
          null;
        const defBrand = defBrandId
          ? (finishingBrandsMaster || []).find(
              (b: any) => b._id === defBrandId
            )
          : null;
        if (defBrandId) {
          for (const c of allComps) {
            try {
              await BlueprintInterface.ProjectManagerService.onFurnisheModelComponentExtBrandChange(
                c,
                defBrandId
              );
            } catch (be) {
              console.warn("[auto-finish] brand set failed", be);
            }
          }
        }
        // Reflect finish + brand in the panel so both swatches show the default.
        const withFinish = (g: any) => ({
          ...g,
          externalFinishFinishingId: finishing._id,
          externalFinishFinishing: finishing,
          ...(defBrandId
            ? { externalFinishBrandId: defBrandId, externalFinishBrand: defBrand }
            : {}),
          components: (g?.components || []).map((c: any) => ({
            ...c,
            externalFinishFinishingId: finishing._id,
            externalFinishFinishing: finishing,
            ...(defBrandId
              ? {
                  externalFinishBrandId: defBrandId,
                  externalFinishBrand: defBrand,
                }
              : {}),
          })),
        });
        setGroupedModelComponents((prev: any[]) => prev.map(withFinish));
        // ALSO refresh the currently-open group — the Exterior swatch reads
        // from `selectedComponentGroup`, not the full list.
        setSelectedComponentGroup((prev: any) => (prev ? withFinish(prev) : prev));
      } catch (e) {
        console.warn("[auto-finish] failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    groupedModelComponents,
    finishingsList,
    selectedModel,
    coatingRates,
    finishingBrandsMaster,
  ]);

  useEffect(() => {
    const handleFinishing = async (finishing: Finishing) => {
      await handleFinishingTextureSelection(finishing);
    };
  }, []);

  const handleComponentAdditionalPropsChange = useCallback(async () => {
    if (selectedComponentGroup?.components?.length) {
      await Promise.all(
        selectedComponentGroup.components.map(
          async (component: FurnishedModelComponent) => {
            await BlueprintInterface.ProjectManagerService.onFurnishModelComponenetAdditionalPropsChange(
              component,
              JSON.stringify(componentAdditionalProps)
            );
          }
        )
      );
    } else if (selectedComponentGroup?.componentProperties) {
      await BlueprintInterface.ProjectManagerService.onFurnishModelComponenetAdditionalPropsChange(
        selectedComponentGroup,
        JSON.stringify(componentAdditionalProps)
      );
    }
  }, [selectedComponentGroup, componentAdditionalProps]);

  const getCoreMaterialBrands = async () => {
    const resp = await TexturesService.getCoreMaterialBrandsFromLocalStorage();
    if (resp?.length) {
      setCoreMaterialBrands(resp);
    } else {
      const resp = await TexturesService.getAllCoreMaterialBrands();
      if (resp?.data?.length) {
        setCoreMaterialBrands(resp.data);
      }
    }
  };

  // Build the Core Material dropdowns from PRICED Rate Card entries only — a
  // material/grade/brand is offered in the editor only if it has a rate. This
  // guarantees every selectable core material already has a cost for the BOQ.
  // The catalog (types/brands) is used only to resolve ids -> readable names.
  const loadPricedCoreMaterials = async () => {
    const [rates, typesResp, brandsResp] = await Promise.all([
      RatesService.listMaterialRates(),
      TexturesService.getAllCoreMaterialTypes(),
      TexturesService.getAllCoreMaterialBrands(),
    ]);
    const catalogTypes = Array.isArray(typesResp)
      ? typesResp
      : typesResp?.data ?? [];
    const catalogBrands = Array.isArray(brandsResp)
      ? brandsResp
      : brandsResp?.data ?? [];

    // distinct priced type ids, grades-per-type, and brand ids from the rates
    const pricedTypeIds = new Set<string>();
    const gradesByType: Record<string, Set<string>> = {};
    const pricedBrandIds = new Set<string>();
    (rates || []).forEach((r: any) => {
      if (r.coreMaterialTypeId) {
        pricedTypeIds.add(r.coreMaterialTypeId);
        if (!gradesByType[r.coreMaterialTypeId])
          gradesByType[r.coreMaterialTypeId] = new Set();
        if (r.grade) gradesByType[r.coreMaterialTypeId].add(r.grade);
      }
      if (r.brandId) pricedBrandIds.add(r.brandId);
    });

    // priced types (grades restricted to those that have a rate)
    const pricedTypes = catalogTypes
      .filter((t: any) => pricedTypeIds.has(t._id))
      .map((t: any) => ({
        ...t,
        grades: Array.from(gradesByType[t._id] || []),
      }));
    const pricedBrands = catalogBrands.filter((b: any) =>
      pricedBrandIds.has(b._id)
    );

    // Distinct thicknesses across the priced rates (sorted), for the 3D
    // Core Material dropdown. Reference only — no effect on the BOQ price.
    const thicknesses = Array.from(
      new Set(
        (rates || [])
          .map((r: any) => Number(r.thickness))
          .filter((v: number) => Number.isFinite(v) && v > 0)
      )
    ).sort((a, b) => a - b);

    setCoreMaterialTypeList(pricedTypes);
    setCoreMaterialBrands(pricedBrands);
    setCoreMaterialThicknessList(thicknesses);
  };

  // Collect the finishing categories that have a coating rate, so the finish
  // picker can offer only priced coatings (mirrors the core-material rule).
  const loadPricedCoatings = async () => {
    const [rates, brands] = await Promise.all([
      RatesService.listCoatingRates(),
      RatesService.getFinishingBrands(),
    ]);
    const ids = Array.from(
      new Set(
        (rates || [])
          .map((r: any) => r.finishingCategoryId)
          .filter(Boolean)
      )
    );
    setPricedCoatingCatIds(ids as string[]);
    setCoatingRates(rates || []);
    setFinishingBrandsMaster(brands || []);
  };

  const getFinishingCategories = async () => {
    try {
      const response =
        await TexturesService.getFinishingCategoriesFromLocalStorage();
      if (response?.length) {
        setAllFinishingCategories(response);
        const list = response.filter((item: any) => !item.parentCategoryId);
        setFinishingCategories(list);
        const parentCategory = response?.[0];
        setSelectedType(parentCategory ?? null);
        const list2 = response?.filter(
          (item: any) => item.parentCategoryId === parentCategory?._id
        );
        if (list2?.length) {
          setStyles(list2);
          setSelectedStyle(list2?.[0] ?? null);
        } else {
          setStyles([]);
          setSelectedStyle(null);
        }
      } else {
        try {
          const resp = await TexturesService.getAllFinishingCategories();
          if (resp?.data?.length) {
            setAllFinishingCategories(resp.data);
            const list = resp.data.filter(
              (item: any) => !item.parentCategoryId
            );
            setFinishingCategories(list);
            const parentCategory = resp.data?.[0];
            setSelectedType(parentCategory ?? null);
            const list2 = resp.data?.filter(
              (item: any) => item.parentCategoryId === parentCategory?._id
            );
            if (list2?.length) {
              setStyles(list2);
              setSelectedStyle(list2?.[0] ?? null);
            } else {
              setStyles([]);
              setSelectedStyle(null);
            }
          }
        } catch (error) {
          console.error(error);
          setFinishingCategories([]);
          setSelectedType(null);
          setStyles([]);
          setSelectedStyle(null);
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const getFinishings = async () => {
    const list = await TexturesService.getFinishingsFromLocalStorage();
    if (list?.length) {
      setFinishingsList(list);
    } else {
      setFinishingsList([]);
    }
  };

  const getModelComponents = async (isMultiSelectMode: boolean) => {
    if (isMultiSelectMode && BlueprintInterface.selectedModels.length > 1) {
      let list: FurnishedModelComponent[] = [];
      BlueprintInterface.selectedModels.map((model) => {
        const furnishedModel =
          BlueprintInterface.ProjectManagerService.getFurnishedModelById(
            model.itemModel.id
          );
        if (furnishedModel) {
          const furnishedModelComps =
            BlueprintInterface.ProjectManagerService.getFurnishedModelComponents(
              furnishedModel._id
            );
          if (furnishedModelComps?.length) {
            list = list.concat(furnishedModelComps);
          }
        }
      });
      await getGroupedModelComponents(list);
    } else {
      let furnishedModelComps =
        BlueprintInterface.ProjectManagerService.getFurnishedModelComponents(
          selectedModel?._id
        );
      // Self-heal: a placement with no per-mesh component rows can happen
      // when createSceneElements lost the createFurnishedModelComponents
      // step (race, missing roomId, stale cache) OR when reload didn't
      // re-hydrate the join. Lazy-create from the catalog using the raw
      // modelId — works whether or not selectedModel.model is hydrated.
      const modelIdForHeal =
        selectedModel?.modelId || selectedModel?.model?._id;
      if (
        (!furnishedModelComps || furnishedModelComps.length === 0) &&
        modelIdForHeal &&
        selectedModel?._id
      ) {
        console.warn(
          "objectComponents.tsx ~ getModelComponents ~ no furnished_model_components " +
            `for placement ${selectedModel?._id} (modelId=${modelIdForHeal}) — lazy-creating from catalog`
        );
        await BlueprintInterface.ProjectManagerService.createFurnishedModelComponents(
          modelIdForHeal,
          selectedModel._id
        );
        furnishedModelComps =
          BlueprintInterface.ProjectManagerService.getFurnishedModelComponents(
            selectedModel?._id
          );
      }
      if (furnishedModelComps?.length) {
        await getGroupedModelComponents(furnishedModelComps);
      }
      const response = await CategoriesService.getCategoriesFromLocalStorage();
      const allModels = await ModelsService.getModelsFromLocalStorage();
      if (response?.length && allModels?.length) {
        const handleParentCategory = response.find(
          (item: any) => item.name?.toLowerCase() === "handle"
        );
        if (handleParentCategory) {
          const handleCategories = response.filter(
            (item: any) => item.parentCategoryId === handleParentCategory._id
          );
          let handleModels: any[] = [];
          await Promise.all(
            handleCategories.map((category: any) => {
              handleModels = handleModels.concat(
                allModels.filter(
                  (model: Model) => model.categoryId === category._id
                )
              );
            })
          );
          setHandleTypes(handleCategories);
          setSelectedHandleType(handleCategories[0]);
          setHandleModels(handleModels);
        }
      }
      // show all shutters if hiden
      BlueprintInterface?.selectedModels?.map((item) => {
        const components = item.children?.find((child: any) =>
          child?.name?.toLowerCase()?.includes("scene")
        )?.children;
        const shuttersAndHandles = components?.filter(
          (comp: any) =>
            comp.name.toLowerCase().includes("shutter") ||
            comp.name.toLowerCase().includes("handle")
        );
        shuttersAndHandles?.map((comp: any) => {
          comp.visible = true;
        });
      });
    }
    setShowLoader(false);
  };

  const getGroupedModelComponents = async (
    furnishedModelComponents: FurnishedModelComponent[]
  ) => {
    // The backend returns only the saved IDs (externalFinishFinishingId, etc.),
    // not the resolved objects the panel displays. Resolve them here from the
    // already-loaded lists so a reopened panel shows the applied finish/brand/
    // material (fixes the empty panel + the brand dropdown not reflecting it).
    const pickById = (list: any[], id: any) =>
      id ? list?.find((x: any) => x._id === id) : undefined;
    furnishedModelComponents = ((furnishedModelComponents || []) as any[]).map(
      (comp: any) => ({
        ...comp,
        externalFinishFinishing:
          comp.externalFinishFinishing ??
          pickById(finishingsList, comp.externalFinishFinishingId),
        internalFinishFinishing:
          comp.internalFinishFinishing ??
          pickById(finishingsList, comp.internalFinishFinishingId),
        externalFinishBrand:
          comp.externalFinishBrand ??
          pickById(finishingBrandsMaster, comp.externalFinishBrandId),
        internalFinishBrand:
          comp.internalFinishBrand ??
          pickById(finishingBrandsMaster, comp.internalFinishBrandId),
        coreMaterialType:
          comp.coreMaterialType ??
          pickById(coreMaterialTypeList, comp.coreMaterialTypeId),
        coreMaterialBrand:
          comp.coreMaterialBrand ??
          pickById(coreMaterialBrands, comp.coreMaterialBrandId),
      })
    ) as any;
    const carcassComponents = furnishedModelComponents.filter((item) =>
      item.name.toLowerCase().includes("panel")
    );
    const skirtingComponents = furnishedModelComponents.filter(
      (item) =>
        item.name.toLowerCase().includes("skirting") ||
        item.name.toLowerCase().includes("leg")
    );
    const shutterComponents = furnishedModelComponents.filter((item) =>
      item.name.toLowerCase().includes("shutter")
    );
    const handleComponents = furnishedModelComponents.filter((item) =>
      item.name.toLowerCase().includes("handle")
    );
    const trayComponents = furnishedModelComponents.filter((item) =>
      item.name.toLowerCase().includes("tray")
    );
    const hangerComponents = furnishedModelComponents.filter((item) =>
      item.name.toLowerCase().includes("hanger")
    );
    const counterTopComponents = furnishedModelComponents.filter(
      (item) =>
        item.name.toLowerCase().includes("counter") &&
        item.name.toLowerCase().includes("top")
    );
    const otherComponents = furnishedModelComponents.filter(
      (item) =>
        !item.name.toLowerCase().includes("leg") &&
        !item.name.toLowerCase().includes("panel") &&
        !item.name.toLowerCase().includes("skirting") &&
        !item.name.toLowerCase().includes("shutter") &&
        !item.name.toLowerCase().includes("handle") &&
        !item.name.toLowerCase().includes("tray") &&
        !item.name.toLowerCase().includes("hanger") &&
        !(
          item.name.toLowerCase().includes("counter") &&
          item.name.toLowerCase().includes("top")
        )
    );
    let group: any[] = [];
    if (carcassComponents?.length) {
      group.push({
        name: "Carcass",
        components: carcassComponents,
      });
    }
    if (shutterComponents?.length) {
      group.push({ name: "Shutter", components: shutterComponents });
    }
    if (handleComponents?.length) {
      group.push({
        name: "Handle",
        components: handleComponents,
      });
      const handleModel = await ModelsService.getModelById(
        handleComponents[0]?.parentComponentId
      );
      if (handleModel?.category?._id)
        setSelectedHandleType(handleModel.category);
    }
    if (skirtingComponents?.length) {
      group.push({ name: "Skirting", components: skirtingComponents });
    }
    if (trayComponents?.length) {
      group.push({ name: "Tray", components: trayComponents });
    }
    if (hangerComponents?.length) {
      group.push({ name: "Hanger", components: hangerComponents });
    }
    if (counterTopComponents?.length) {
      group.push({ name: "CounterTop", components: counterTopComponents });
    }
    if (otherComponents?.length) {
      // Merge same-named "other" parts into ONE group so that, in multi-select,
      // editing e.g. "Mesh 0" applies to that part across EVERY selected model
      // (previously each model's part became its own single-item group, so a
      // change hit only one object). Isolated to its own array so a stray part
      // can never merge into the named groups (Carcass/Shutter/...). In
      // single-select each name is unique, so output is identical to before.
      const otherGroups: any[] = [];
      otherComponents.forEach((comp) => {
        const existingGroup = otherGroups.find((g) => g.name === comp.name);
        if (existingGroup) {
          existingGroup.components.push(comp);
        } else {
          otherGroups.push({ name: comp.name, components: [comp] });
        }
      });
      otherGroups.forEach((g) => group.push(g));
    }
    setGroupedModelComponents(group);

    // Keep the currently-selected group pointing at the freshly ENRICHED data
    // (finish / brand / material objects resolved via finishingsList etc.).
    // Without this, re-enrichment updated groupedModelComponents but the sidebar
    // (which reads selectedComponentGroup) kept showing only the brand and no
    // applied finish/texture. Only replace when the resolved objects actually
    // changed — returning the same reference otherwise prevents a render loop.
    setSelectedComponentGroup((prev: any) => {
      if (!prev) return prev;
      const enriched = group.find((g: any) => g.name === prev.name);
      if (!enriched) return prev;
      const sig = (grp: any) =>
        (grp.components || [])
          .map((c: any) =>
            [
              c.externalFinishFinishing?._id,
              c.internalFinishFinishing?._id,
              c.externalFinishBrand?._id,
              c.internalFinishBrand?._id,
              c.coreMaterialType?._id,
            ].join(",")
          )
          .join("|");
      return sig(enriched) !== sig(prev) ? enriched : prev;
    });

    // if (!selectedComponentGroup) {
    //   setSelectedComponentGroup(group[0]);
    // }
    await Promise.all(
      group[0]?.components?.map((furnishedComp: FurnishedModelComponent) => {
        const additionalProperties = furnishedComp?.componentProperties
          ?.additionalProperties
          ? JSON.parse(furnishedComp.componentProperties.additionalProperties)
          : [];
        if (additionalProperties?.length) {
          setComponentProps({
            coreMaterialTypes:
              furnishedComp?.componentProperties?.coreMaterialTypes,
            coreMaterialThickness:
              furnishedComp?.componentProperties?.coreMaterialThickness,
            exteriorFinishTypes:
              furnishedComp?.componentProperties?.exteriorFinishTypes,
            interiorFinishTypes:
              furnishedComp?.componentProperties?.interiorFinishTypes,
          });
          let isEdgeBandPropAvailable = false;
          const list = additionalProperties.map((component: any) => {
            if (
              Object.keys(component).some((item) =>
                item.toLowerCase().includes("edge")
              )
            ) {
              isEdgeBandPropAvailable = true;
            }
            return Object.fromEntries(
              Object.entries(component).map(([key, value]) => [
                key,
                String(value),
              ])
            );
          });
          setComponentAdditionalProps(list);
          setIsEdgeBandPropAvailable(isEdgeBandPropAvailable);
        }
      }) ?? []
    );
    setShowLoader(false);
  };

  const handleSelectedType = (event: any) => {
    const selectedValue = event.target.value;
    const parentCategory = allFinishingCategories?.find(
      (item) => item?.name === selectedValue
    );

    if (parentCategory) {
      setSelectedCategoryType(selectedValue);
      setSelectedType(parentCategory);

      const list = allFinishingCategories?.filter(
        (item) => item.parentCategoryId === parentCategory?._id
      );

      if (list?.length) {
        setStyles(list);
        setSelectedStyle(list[0]);
      } else {
        setStyles([parentCategory]);
        setSelectedStyle(parentCategory);
      }
    } else {
      console.warn(
        "Parent category not found for selected value:",
        selectedValue
      );
    }
  };

  const handleSelectedStyle = (event: any) => {
    const style = allFinishingCategories?.find(
      (category) => category.name === event.target.value
    );
    if (style) setSelectedStyle(style);
  };

  const handleSelectedBrand = async (event: any) => {
    const brandId = event.target.value;
    setSelectedMaterialBrand(brandId);
    const isExt = selectedFinishingType === Finishing_Types.EXTERIOR;
    // Resolve the brand object so the dropdown reflects the choice (the select
    // value reads externalFinishBrand?._id / internalFinishBrand?._id).
    const brand = (finishingBrandsMaster || []).find(
      (b: any) => b._id === brandId
    );
    const idField = isExt ? "externalFinishBrandId" : "internalFinishBrandId";
    const objField = isExt ? "externalFinishBrand" : "internalFinishBrand";
    const save = async (comp: any) => {
      if (isExt)
        await BlueprintInterface.ProjectManagerService.onFurnisheModelComponentExtBrandChange(
          comp,
          brandId
        );
      else
        await BlueprintInterface.ProjectManagerService.onFurnisheModelComponentIntBrandChange(
          comp,
          brandId
        );
    };

    if (selectedChildComponent) {
      await save(selectedChildComponent);
      setSelectedChildComponent({
        ...selectedChildComponent,
        [idField]: brandId,
        [objField]: brand,
      });
      return;
    }
    if (selectedComponentGroup?.components?.length) {
      const list = selectedComponentGroup.components.map((c: any) => ({
        ...c,
        [idField]: brandId,
        [objField]: brand,
      }));
      for (const c of selectedComponentGroup.components) await save(c);
      setSelectedComponentGroup({
        name: selectedComponentGroup.name,
        components: list,
      });
      setGroupedModelComponents((prev: any[]) =>
        prev.map((g: any) =>
          g.name === selectedComponentGroup.name
            ? { name: selectedComponentGroup.name, components: list }
            : g
        )
      );
    }
  };

  const handleSelectedGrainDirection = (event: any) => {
    console.debug(
      "objectComponents.tsx ~ handleSelectedGrainDirection ~ event",
      event
    );
    setSelectedGrainDirection(event.target.value);
  };

  const handleNodeSelection = async (componentGroup: any) => {
    console.debug(
      "objectComponents.tsx ~ handleNodeSelection ~ componentGroup",
      componentGroup
    );

    // If the incoming componentGroup is the same as the currently selected one, reset the selected states
    if (componentGroup?.name === selectedComponentGroup?.name) {
      setSelectedComponentGroup(null);
      setSelectedChildComponent(null);
      return;
    }

    // Update selectedComponentGroup with the new componentGroup
    setSelectedComponentGroup((prevSelectedComponentGroup: any) => {
      return {
        ...prevSelectedComponentGroup,
        ...componentGroup,
      };
    });

    // Reset selectedChildComponent
    setSelectedChildComponent(null);

    // If the componentGroup has components, update componentProps and componentAdditionalProps
    if (componentGroup?.components?.length) {
      await Promise.all(
        componentGroup.components.map(
          (furnishedComp: FurnishedModelComponent) => {
            // Update componentProps
            setComponentProps({
              coreMaterialTypes:
                furnishedComp?.componentProperties?.coreMaterialTypes,
              coreMaterialThickness:
                furnishedComp?.componentProperties?.coreMaterialThickness,
              exteriorFinishTypes:
                furnishedComp?.componentProperties?.exteriorFinishTypes,
              interiorFinishTypes:
                furnishedComp?.componentProperties?.interiorFinishTypes,
            });

            // Update componentAdditionalProps
            const additionalProperties = furnishedComp?.componentProperties
              ?.additionalProperties
              ? JSON.parse(
                  furnishedComp.componentProperties.additionalProperties
                )
              : [];
            if (additionalProperties?.length) {
              let isEdgeBandPropAvailable = false;
              const list = additionalProperties.map((component: any) => {
                if (
                  Object.keys(component).some((item) =>
                    item.toLowerCase().includes("edge")
                  )
                ) {
                  isEdgeBandPropAvailable = true;
                }
                return Object.fromEntries(
                  Object.entries(component).map(([key, value]) => [
                    key,
                    String(value),
                  ])
                );
              });
              setComponentAdditionalProps(list);
              setIsEdgeBandPropAvailable(isEdgeBandPropAvailable);
            }
          }
        )
      );
    } else if (componentGroup?.componentProperties) {
      // If the componentGroup doesn't have components but has componentProperties, update componentProps and componentAdditionalProps
      setComponentProps({
        coreMaterialTypes:
          componentGroup?.componentProperties?.coreMaterialTypes,
        coreMaterialThickness:
          componentGroup?.componentProperties?.coreMaterialThickness,
        exteriorFinishTypes:
          componentGroup?.componentProperties?.exteriorFinishTypes,
        interiorFinishTypes:
          componentGroup?.componentProperties?.interiorFinishTypes,
      });
      const additionalProperties = componentGroup?.componentProperties
        ?.additionalProperties
        ? JSON.parse(componentGroup.componentProperties.additionalProperties)
        : [];
      if (additionalProperties?.length) {
        const list = additionalProperties.map((component: any) =>
          Object.fromEntries(
            Object.entries(component).map(([key, value]) => [
              key,
              String(value),
            ])
          )
        );
        setComponentAdditionalProps(list);
      }
    }
  };

  // Option C — preview-on-hover. Mouseover a row in the Components panel and
  // the matching mesh(es) outline temporarily so the user can scan parts
  // without committing a click. On mouseout we restore whatever the user
  // *has* committed (selected child component first, else selected group,
  // else nothing).
  const handleNodeHover = (componentGroup: any) => {
    const meshNames = (componentGroup?.components ?? [])
      .map((c: any) => c?.name)
      .filter(Boolean);
    if (meshNames.length) {
      BlueprintInterface.highlightMeshes(meshNames);
    }
  };

  const handleNodeHoverEnd = () => {
    if (selectedChildComponent?.name) {
      BlueprintInterface.highlightMeshes([selectedChildComponent.name]);
      return;
    }
    const meshNames = (selectedComponentGroup?.components ?? [])
      .map((c: any) => c?.name)
      .filter(Boolean);
    if (meshNames.length) {
      BlueprintInterface.highlightMeshes(meshNames);
    } else {
      BlueprintInterface.clearMeshHighlight();
    }
  };

  const handleChildNodeSelection = async (component: any) => {
    console.debug(
      "objectComponents.tsx ~ handleChildNodeSelection ~ component",
      component
    );
    if (component) {
      // Toggle: clicking the already-open part closes it. Compare by unique
      // _id (grouped parts share one name, so a name check would never toggle).
      if (
        (selectedChildComponent as any)?._id === (component as any)?._id
      ) {
        setSelectedChildComponent(null);
        return;
      }
      setSelectedChildComponent(component);
      const additionalProperties = component?.componentProperties
        ?.additionalProperties
        ? JSON.parse(component.componentProperties.additionalProperties)
        : [];
      if (additionalProperties?.length) {
        const list = additionalProperties.map((component: any) => {
          return Object.fromEntries(
            Object.entries(component).map(([key, value]) => [
              key,
              String(value),
            ])
          );
        });
        await BlueprintInterface.ProjectManagerService.onFurnishModelComponenetAdditionalPropsChange(
          component,
          JSON.stringify(list)
        );
      }
    }
  };

  const handleFinishingTypeSelection = (type: string) => {
    console.debug(
      "objectComponents.tsx ~ handleFinishingTypeSelection ~ type",
      type
    );
    setSelectedFinishingType(type);
    setShowObjectComponentsModal(true);
    setShowCoreMaterialsModal(false);
    setIsEdgeBandExpanded(false);
  };

  const handleFinishingTextureSelection = async (finishing: Finishing) => {
    console.debug(
      "objectComponents.tsx ~ handleFinishingTextureSelection ~ selected finishing",
      finishing
    );
    if (selectedChildComponent) {
      if (
        selectedChildComponent?.externalFinishFinishingId &&
        selectedFinishingType === Finishing_Types.EXTERIOR
      ) {
        setSelectedChildComponent({
          ...selectedChildComponent,
          externalFinishFinishingId: finishing._id,
          externalFinishFinishing: finishing,
        });
        await BlueprintInterface.ProjectManagerService.onFurnishModelComponentExtFinishChange(
          selectedChildComponent,
          finishing
        );
      } else if (
        selectedChildComponent?.internalFinishFinishingId &&
        selectedFinishingType === Finishing_Types.INTERIOR
      ) {
        setSelectedChildComponent({
          ...selectedChildComponent,
          internalFinishFinishingId: finishing._id,
          internalFinishFinishing: finishing,
        });
        await BlueprintInterface.ProjectManagerService.onFurnishModelComponentIntFinishChange(
          selectedChildComponent,
          finishing,
          finishing._id
        );
      }
    } else {
      if (selectedComponentGroup?.components?.length && finishing?.texture) {
        if (selectedFinishingType === Finishing_Types.EXTERIOR) {
          let list: any[] = [];
          selectedComponentGroup?.components.map((comp: any) => {
            list.push({
              ...comp,
              externalFinishFinishingId: finishing._id,
              externalFinishFinishing: finishing,
            });
          });
          const items = groupedModelComponents.map((item) =>
            item.name === selectedComponentGroup?.name
              ? {
                  name: item.name,
                  components: list,
                }
              : item
          );
          setGroupedModelComponents(items);
          setSelectedComponentGroup({
            name: selectedComponentGroup?.name,
            components: list,
          });
          await BlueprintInterface.ProjectManagerService.onFurnishModelComponentsExtFinishChange(
            selectedComponentGroup?.components,
            finishing
          );
        } else if (selectedFinishingType === Finishing_Types.INTERIOR) {
          let list: any[] = [];
          selectedComponentGroup?.components.map((comp: any) => {
            list.push({
              ...comp,
              internalFinishFinishingId: finishing._id,
              internalFinishFinishing: finishing,
            });
          });
          const items = groupedModelComponents.map((item) =>
            item.name === selectedComponentGroup?.name
              ? {
                  ...selectedComponentGroup,
                  components: list,
                }
              : item
          );
          setGroupedModelComponents(items);
          setSelectedComponentGroup({
            name: selectedComponentGroup?.name,
            components: list,
          });
          await BlueprintInterface.ProjectManagerService.onFurnishModelComponentsIntFinishChange(
            selectedComponentGroup?.components,
            finishing
          );
        }
      } else if (
        selectedComponentGroup?.externalFinishFinishingId &&
        selectedFinishingType === Finishing_Types.EXTERIOR
      ) {
        const list = groupedModelComponents.map((item) =>
          item.name === selectedComponentGroup?.name
            ? {
                ...selectedComponentGroup,
                externalFinishFinishingId: finishing._id,
                externalFinishFinishing: finishing,
              }
            : item
        );
        setGroupedModelComponents(list);
        setSelectedComponentGroup({
          ...selectedComponentGroup,
          externalFinishFinishingId: finishing._id,
          externalFinishFinishing: finishing,
        });
        await BlueprintInterface.ProjectManagerService.onFurnishModelComponentExtFinishChange(
          selectedComponentGroup,
          finishing
        );
      } else if (
        selectedComponentGroup?.internalFinishFinishingId &&
        selectedFinishingType === Finishing_Types.INTERIOR
      ) {
        const list = groupedModelComponents.map((item) =>
          item.name === selectedComponentGroup?.name
            ? {
                ...selectedComponentGroup,
                internalFinishFinishingId: finishing._id,
                internalFinishFinishing: finishing,
              }
            : item
        );
        setGroupedModelComponents(list);
        setSelectedComponentGroup({
          ...selectedComponentGroup,
          internalFinishFinishingId: finishing._id,
          internalFinishFinishing: finishing,
        });
        await BlueprintInterface.ProjectManagerService.onFurnishModelComponentIntFinishChange(
          selectedComponentGroup,
          finishing
        );
      }
    }
  };

  const toggleColorPicker = (index: number) => {
    console.debug("objectComponents.tsx ~ toggleColorPicker ~ index", index);
    setColorPickerVisible(!colorPickerVisible);
    setSelectedComponentIndex(index);
  };

  const handleColorChange = (color: any) => {
    console.debug("objectComponents.tsx ~ handleColorChange ~ color", color);
    setComponentAdditionalProps((prev) =>
      prev.map((prevComponent, i) =>
        i === selectedComponentIndex
          ? {
              ...prevComponent,
              edge_band_color: color.hex, // Use color.hex as the new color value
            }
          : prevComponent
      )
    );
  };

  const getComponentPropertiesTitle = (name: string) => {
    if (name === "coreMaterialTypes") {
      return "Core Material Types";
    }
    if (name === "coreMaterialThickness") {
      return "Core Material Thickness";
    }
    if (name === "exteriorFinishTypes") {
      return "Exterior Finish Types";
    }
    if (name === "interiorFinishTypes") {
      return "Interior Finish Types";
    }
  };

  const getExternalFinishingImage = () => {
    if (selectedComponentGroup?.externalFinishFinishing?.texture) {
      return selectedComponentGroup.externalFinishFinishing.texture.fileUrl;
    } else if (
      selectedComponentGroup?.components?.length &&
      selectedComponentGroup?.components[0]?.externalFinishFinishing?.texture
    ) {
      return selectedComponentGroup.components[0].externalFinishFinishing
        .texture.fileUrl;
    }
  };

  const getInternalFinishingImage = () => {
    if (selectedComponentGroup?.internalFinishFinishing?.texture) {
      return selectedComponentGroup.internalFinishFinishing.texture.fileUrl;
    } else if (
      selectedComponentGroup?.components?.length &&
      selectedComponentGroup?.components[0]?.internalFinishFinishing?.texture
    ) {
      return selectedComponentGroup.components[0].internalFinishFinishing
        .texture.fileUrl;
    }
  };

  const getComponentExternalFinishingImage = () => {
    if (selectedChildComponent?.externalFinishFinishing?.texture) {
      return selectedChildComponent.externalFinishFinishing.texture.fileUrl;
    }
    return "";
  };

  const getComponentInternalFinishingImage = () => {
    if (selectedChildComponent?.internalFinishFinishing?.texture) {
      return selectedChildComponent.internalFinishFinishing.texture.fileUrl;
    }
    return "";
  };

  // When the Core Material popup opens for a part with no material yet, apply
  // the first priced type/grade/brand as the default — so the defaults the popup
  // shows become real: saved, shown in the sidebar, and priced in the BOQ.
  const applyDefaultCoreMaterialIfEmpty = async () => {
    const comps = selectedComponentGroup?.components;
    if (!comps?.length || !coreMaterialTypeList?.length) return;
    const first = comps[0];

    // Resolve the type — the part's own if already assigned, else the first
    // priced type. Then fill in ANY missing piece (type / grade / brand) with
    // the value the popup already shows, so a shown default becomes a REAL saved
    // value that persists after reload — exactly like the exterior finish/brand.
    // Previously this bailed out whenever a type existed, leaving a part with a
    // type but no saved grade (the reported issue).
    const hasType = !!first?.coreMaterialTypeId;
    const type = hasType
      ? first?.coreMaterialType ||
        coreMaterialTypeList.find(
          (t: any) => t?._id === first.coreMaterialTypeId
        ) ||
        coreMaterialTypeList[0]
      : coreMaterialTypeList[0];
    const grade =
      String(first?.coreMaterialGrade || "").trim() || type?.grades?.[0] || "";
    const brand = first?.coreMaterialBrand || coreMaterialBrands?.[0];

    // Nothing missing → leave the user's real choices untouched.
    if (
      hasType &&
      String(first?.coreMaterialGrade || "").trim() &&
      first?.coreMaterialBrandId
    ) {
      return;
    }

    const enriched = comps.map((c: any) => ({
      ...c,
      coreMaterialTypeId: c?.coreMaterialTypeId || type?._id,
      coreMaterialType: c?.coreMaterialType || type,
      coreMaterialGrade: String(c?.coreMaterialGrade || "").trim() || grade,
      coreMaterialBrandId: c?.coreMaterialBrandId || brand?._id,
      coreMaterialBrand: c?.coreMaterialBrand || brand,
    }));
    setSelectedComponentGroup({
      name: selectedComponentGroup.name,
      components: enriched,
    });
    setGroupedModelComponents((prev: any[]) =>
      prev.map((g: any) =>
        g.name === selectedComponentGroup.name
          ? { name: selectedComponentGroup.name, components: enriched }
          : g
      )
    );
    for (const c of comps) {
      try {
        if (!c?.coreMaterialTypeId && type?._id)
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialTypeChange(
            c,
            type._id
          );
        if (!String(c?.coreMaterialGrade || "").trim() && grade)
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialGradeChange(
            c,
            grade
          );
        if (!c?.coreMaterialBrandId && brand?._id)
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialBrandChange(
            c,
            brand._id
          );
      } catch (e) {
        console.error("applyDefaultCoreMaterialIfEmpty save failed", e);
      }
    }
  };

  useEffect(() => {
    if (showCoreMaterialsModal) {
      applyDefaultCoreMaterialIfEmpty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCoreMaterialsModal]);

  // Same brand list the popup's Brand dropdown builds: brands priced for the
  // selected style, else any priced brand, else the full master. Keeping this
  // in one place so the auto-default picks EXACTLY what the dropdown shows.
  const getBrandListForPicker = () => {
    if (coatingRates.length && finishingBrandsMaster.length) {
      const forStyle = selectedStyle
        ? finishingBrandsMaster.filter((b: any) =>
            coatingRates.some(
              (r: any) =>
                r.finishingCategoryId === selectedStyle._id &&
                r.finishingBrandId === b._id
            )
          )
        : [];
      if (forStyle.length) return forStyle;
      return finishingBrandsMaster.filter((b: any) =>
        coatingRates.some((r: any) => r.finishingBrandId === b._id)
      );
    }
    return finishingBrandsMaster || [];
  };

  // When the EXTERIOR finish popup opens and no Brand is picked yet, fill in the
  // FIRST brand — mirrors applyDefaultCoreMaterialIfEmpty so a shown default
  // becomes a real saved value (sidebar + BOQ). Covers items that already had a
  // finish (so the auto-finish effect skipped them). Never overwrites a brand
  // the user already chose; the user can still change it in the dropdown.
  const applyDefaultExtBrandIfEmpty = async () => {
    if (selectedFinishingType !== Finishing_Types.EXTERIOR) return;
    const brands = getBrandListForPicker();
    const first = brands?.[0];
    if (!first) return;
    const save = async (comp: any) =>
      BlueprintInterface.ProjectManagerService.onFurnisheModelComponentExtBrandChange(
        comp,
        first._id
      );

    if (selectedChildComponent) {
      if (selectedChildComponent.externalFinishBrandId) return;
      await save(selectedChildComponent);
      setSelectedChildComponent({
        ...selectedChildComponent,
        externalFinishBrandId: first._id,
        externalFinishBrand: first,
      });
      return;
    }
    const comps = selectedComponentGroup?.components;
    if (!comps?.length) return;
    // All parts already branded → nothing to default.
    if (comps.every((c: any) => c?.externalFinishBrandId)) return;
    const list = comps.map((c: any) => ({
      ...c,
      externalFinishBrandId: c?.externalFinishBrandId || first._id,
      externalFinishBrand: c?.externalFinishBrand || first,
    }));
    for (const c of comps) {
      if (!c?.externalFinishBrandId) {
        try {
          await save(c);
        } catch (e) {
          console.warn("applyDefaultExtBrandIfEmpty save failed", e);
        }
      }
    }
    setSelectedComponentGroup({
      name: selectedComponentGroup.name,
      components: list,
    });
    setGroupedModelComponents((prev: any[]) =>
      prev.map((g: any) =>
        g.name === selectedComponentGroup.name
          ? { name: selectedComponentGroup.name, components: list }
          : g
      )
    );
  };

  useEffect(() => {
    if (showObjectComponentsModal) {
      applyDefaultExtBrandIfEmpty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showObjectComponentsModal, selectedFinishingType, selectedStyle]);

  const handleSelectedCoreMaterialType = async (e: any) => {
    const coreMaterialTypeId = e.target.value;
    // Resolve the object too, so the sidebar (which reads coreMaterialType.type)
    // reflects the change immediately, not just the saved id.
    const coreMaterialType = (coreMaterialTypeList || []).find(
      (t: any) => t._id === coreMaterialTypeId
    );
    if (selectedChildComponent?.coreMaterialTypeId) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialTypeChange(
        selectedComponentGroup,
        coreMaterialTypeId
      );
      setSelectedChildComponent({
        ...selectedChildComponent,
        coreMaterialTypeId,
        coreMaterialType,
      });
    } else if (selectedComponentGroup?.components?.length) {
      let list: any[] = [];
      selectedComponentGroup.components.map(
        async (component: FurnishedModelComponent) => {
          list.push({ ...component, coreMaterialTypeId, coreMaterialType });
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialTypeChange(
            component,
            coreMaterialTypeId
          );
        }
      );
      setSelectedComponentGroup({
        name: selectedComponentGroup?.name,
        components: list,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup?.name
          ? {
              name: selectedComponentGroup?.name,
              components: list,
            }
          : group
      );
      setGroupedModelComponents(comps);
    } else if (selectedComponentGroup?.coreMaterialTypeId) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialTypeChange(
        selectedComponentGroup,
        coreMaterialTypeId
      );
      setSelectedComponentGroup({
        ...selectedComponentGroup,
        coreMaterialTypeId,
        coreMaterialType,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup?.name
          ? {
              ...selectedComponentGroup,
              coreMaterialTypeId,
              coreMaterialType,
            }
          : group
      );
      setGroupedModelComponents(comps);
    }
  };

  const handleSelectedCoreMaterialBrand = async (e: any) => {
    const coreMaterialBrandId = e.target.value;
    // Resolve the brand object too, so the sidebar (coreMaterialBrand.name)
    // reflects the change immediately, not just the saved id.
    const coreMaterialBrand = (coreMaterialBrands || []).find(
      (b: any) => b._id === coreMaterialBrandId
    );
    if (selectedChildComponent) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialBrandChange(
        selectedChildComponent,
        coreMaterialBrandId
      );
      setSelectedChildComponent({
        ...selectedChildComponent,
        coreMaterialBrandId,
        coreMaterialBrand,
      });
    } else if (selectedComponentGroup?.components?.length) {
      let list: any[] = [];
      selectedComponentGroup?.components?.map(
        async (component: FurnishedModelComponent) => {
          list.push({ ...component, coreMaterialBrandId, coreMaterialBrand });
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialBrandChange(
            component,
            coreMaterialBrandId
          );
        }
      );
      setSelectedComponentGroup({
        name: selectedComponentGroup?.name,
        components: list,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup?.name
          ? {
              name: selectedComponentGroup?.name,
              components: list,
            }
          : group
      );
      setGroupedModelComponents(comps);
    } else if (selectedComponentGroup?.coreMaterialBrandId) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialBrandChange(
        selectedComponentGroup,
        coreMaterialBrandId
      );
      setSelectedComponentGroup({
        ...selectedComponentGroup,
        coreMaterialBrandId,
        coreMaterialBrand,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup?.name
          ? {
              ...selectedComponentGroup,
              coreMaterialBrandId,
              coreMaterialBrand,
            }
          : group
      );
      setGroupedModelComponents(comps);
    }
  };

  const handleSelectedCoreMaterialGrade = async (e: any) => {
    const coreMaterialGrade = e.target.value;
    if (selectedChildComponent) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialGradeChange(
        selectedChildComponent,
        coreMaterialGrade
      );
      setSelectedChildComponent({
        ...selectedChildComponent,
        coreMaterialGrade,
      });
    } else if (selectedComponentGroup?.components?.length) {
      let list: any[] = [];
      selectedComponentGroup?.components?.map(
        async (component: FurnishedModelComponent) => {
          list.push({ ...component, coreMaterialGrade });
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialGradeChange(
            component,
            coreMaterialGrade
          );
        }
      );
      setSelectedComponentGroup({
        name: selectedComponentGroup?.name,
        components: list,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup
          ? {
              name: selectedComponentGroup?.name,
              components: list,
            }
          : group
      );
      setGroupedModelComponents(comps);
    } else if (selectedComponentGroup?.coreMaterialGrade) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialGradeChange(
        selectedComponentGroup,
        coreMaterialGrade
      );
      setSelectedComponentGroup({
        ...selectedComponentGroup,
        coreMaterialGrade,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup
          ? {
              ...selectedComponentGroup,
              coreMaterialGrade,
            }
          : group
      );
      setGroupedModelComponents(comps);
    }
  };

  const handleSelectedCoreMaterialThickness = async (e: any) => {
    const coreMaterialThickness = e.target.value;
    if (selectedChildComponent) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialThicknessChange(
        selectedChildComponent,
        coreMaterialThickness
      );
      setSelectedChildComponent({
        ...selectedChildComponent,
        coreMaterialThickness,
      });
    } else if (selectedComponentGroup?.components?.length) {
      let list: any[] = [];
      selectedComponentGroup?.components?.map(
        async (component: FurnishedModelComponent) => {
          list.push({ ...component, coreMaterialThickness });
          await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialThicknessChange(
            component,
            coreMaterialThickness
          );
        }
      );
      setSelectedComponentGroup({
        name: selectedComponentGroup?.name,
        components: list,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup
          ? {
              name: selectedComponentGroup?.name,
              components: list,
            }
          : group
      );
      setGroupedModelComponents(comps);
    } else if (selectedComponentGroup?.coreMaterialThickness) {
      await BlueprintInterface.ProjectManagerService.onFurnisheModelCompCoreMaterialThicknessChange(
        selectedComponentGroup,
        coreMaterialThickness
      );
      setSelectedComponentGroup({
        ...selectedComponentGroup,
        coreMaterialThickness,
      });
      const comps = groupedModelComponents.map((group: any) =>
        group.name === selectedComponentGroup
          ? {
              ...selectedComponentGroup,
              coreMaterialThickness,
            }
          : group
      );
      setGroupedModelComponents(comps);
    }
  };

  const handleShutterVisible = async (visible: boolean) => {
    if (selectedComponentGroup?.name?.toLowerCase() === "shutter") {
      BlueprintInterface?.selectedModels?.map((item) => {
        const components = item?.children?.find((child: any) =>
          child?.name?.toLowerCase()?.includes("scene")
        )?.children;
        const shuttersAndHandles = components.filter(
          (comp: any) =>
            comp.name.toLowerCase().includes("shutter") ||
            comp.name.toLowerCase().includes("handle")
        );
        let list: any[] = [];
        selectedComponentGroup?.components?.map(
          async (component: FurnishedModelComponent) =>
            list.push({ ...component, visible })
        );
        setSelectedComponentGroup({
          name: selectedComponentGroup?.name,
          components: list,
        });
        const comps = groupedModelComponents.map((group: any) =>
          group.name === selectedComponentGroup
            ? {
                name: selectedComponentGroup?.name,
                components: list,
              }
            : group
        );
        setGroupedModelComponents(comps);
        shuttersAndHandles?.map((comp: any) => {
          comp.visible = visible;
        });
      });
    }
  };

  const handleSelectedHandleType = async (typeName: string) => {
    const type = handleTypes.find((handleType) => handleType.name === typeName);
    if (type) {
      const models = handleModels.filter(
        (model) => model.categoryId === type._id
      );
      setSelectedHandleType(type);
      setSelectedHandleModels(models);
      setShowHandleTypesModal(true);
    }
  };

  // Bulk group-by-name: rename the selected mesh components to one part name so
  // they combine into that group, then refresh + re-group the panel.
  const handleBulkRename = async (
    componentIds: string[],
    partName: string
  ) => {
    if (!partName?.trim() || !componentIds?.length) return;
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      for (const id of componentIds) {
        await pm?.updateFurnishedModelComponentName?.(id, partName.trim());
      }
      await getModelComponents(isMultiSelectMode);
    } catch (e) {
      console.error("objectComponents.tsx ~ handleBulkRename failed", e);
    }
  };

  // Remove ONE mesh from a combined group: give it back its own mesh name so it
  // splits out into its own row again, AND reset its colour to the item default
  // — same logic as Ungroup, applied to just this one mesh.
  const handleRemoveFromGroup = async (comp: any) => {
    if (!comp?._id) return;
    const standalone =
      (comp.meshName && String(comp.meshName).trim()) ||
      `Mesh ${String(comp._id).slice(-4)}`;
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      await pm?.updateFurnishedModelComponentName?.(comp._id, standalone);
      // Reset the combine colour on this mesh (same as Ungroup): re-apply the
      // item's default finish so the 3D AND the panel show the default.
      const defFin = computeDefaultFinishing();
      if (defFin) {
        await pm?.onFurnishModelComponentsExtFinishChange?.([comp], defFin);
      } else {
        try {
          const item =
            (BlueprintInterface as any)?.selectedModels?.[0] || selectedModel;
          if (comp.meshName)
            (item as any)?.resetMeshesToDefault?.([String(comp.meshName)]);
        } catch (e) {
          /* visual repaint is best-effort */
        }
      }
      await getModelComponents(isMultiSelectMode);
    } catch (e) {
      console.error("objectComponents.tsx ~ handleRemoveFromGroup failed", e);
    }
  };

  // Pick the item's DEFAULT finishing (wood grain, etc.) the same way the
  // auto-finish effect does — so ungroup can RESET to that default finish (shown
  // in both the 3D view AND the Components panel), not blank it out.
  const computeDefaultFinishing = (): any => {
    const id = selectedModel?._id;
    const placed: any = (BlueprintInterface as any)?.selectedModels?.find(
      (m: any) => m?.itemModel?.id === id
    );
    const kind: string = placed?.__autoDefaultKind || "wood";
    const KIND_PREFERRED: Record<string, RegExp> = {
      fabric: /^solid\s*21054$/i,
    };
    const KIND_PREFIX: Record<string, RegExp> = {
      wood: /^wood/i,
      fabric: /^solid/i,
      metal: /^contemporary/i,
    };
    const preferred = KIND_PREFERRED[kind];
    const prefix = KIND_PREFIX[kind] || /^wood/i;
    const withTex = (f: any) => f?.texture?.fileUrl;
    return (
      (preferred &&
        finishingsList.find(
          (f: any) =>
            preferred.test(String(f?.name || "").trim()) && withTex(f)
        )) ||
      finishingsList.find((f: any) => prefix.test(f?.name || "") && withTex(f)) ||
      finishingsList.find(
        (f: any) => /^wood/i.test(f?.name || "") && withTex(f)
      ) ||
      finishingsList.find((f: any) => withTex(f))
    );
  };

  // Ungroup an ENTIRE group: rename every part back to its own mesh name AND
  // reset the combine colour to the item's DEFAULT finish — so 3D and the
  // Components panel both show the default wood finish (not an empty swatch).
  const handleUngroupGroup = async (group: any) => {
    const comps = group?.components || [];
    if (!comps.length) return;
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      const meshNames: string[] = [];
      for (const c of comps) {
        const standalone =
          (c.meshName && String(c.meshName).trim()) ||
          `Mesh ${String(c._id).slice(-4)}`;
        await pm?.updateFurnishedModelComponentName?.(c._id, standalone);
        if (c.meshName) meshNames.push(String(c.meshName));
      }
      // Re-apply the DEFAULT finish (wood) so the panel shows it too — this both
      // paints the 3D and writes the finish record. Fall back to a flat default
      // repaint only if no default finishing exists.
      const defFin = computeDefaultFinishing();
      if (defFin) {
        await pm?.onFurnishModelComponentsExtFinishChange?.(comps, defFin);
      } else {
        try {
          const item =
            (BlueprintInterface as any)?.selectedModels?.[0] || selectedModel;
          (item as any)?.resetMeshesToDefault?.(meshNames);
        } catch (e) {
          /* visual repaint is best-effort */
        }
      }
      await getModelComponents(isMultiSelectMode);
    } catch (e) {
      console.error("objectComponents.tsx ~ handleUngroupGroup failed", e);
    }
  };

  const handleExposureChange = async (
    isExposed: boolean,
    furnishedModelComponentId: string
  ) => {
    const newExposed = !isExposed;
    await BlueprintInterface.ProjectManagerService.updateFurnisheModelCompExposure(
      isExposed,
      furnishedModelComponentId
    );
    // Reflect the flip in the panel immediately. getModelComponents rebuilds
    // groupedModelComponents but leaves selectedComponentGroup untouched (its
    // useEffect only fills it when null), so the toggle would otherwise show
    // the stale value until the panel is reopened.
    setSelectedComponentGroup((prev: any) =>
      prev
        ? {
            ...prev,
            components: (prev.components ?? []).map((c: any) =>
              c._id === furnishedModelComponentId
                ? { ...c, exposed: newExposed }
                : c
            ),
          }
        : prev
    );
    setGroupedModelComponents((prev: any[]) =>
      (prev ?? []).map((g: any) => ({
        ...g,
        components: (g.components ?? []).map((c: any) =>
          c._id === furnishedModelComponentId
            ? { ...c, exposed: newExposed }
            : c
        ),
      }))
    );
    await getModelComponents(false);
  };

  return (
    <>
      {showObjectComponentsModal && (
        <ObjectFinishingsModal
          onHideObjectPanel={onHideObjectPanel}
          isDarkMode={isDarkMode}
          showObjectComponentsModal={showObjectComponentsModal}
          finishingCategories={finishingCategories}
          handleSelectedType={handleSelectedType}
          selectedStyle={selectedStyle}
          selectedType={selectedType}
          styles={
            pricedCoatingCatIds.length
              ? styles.filter((s: any) =>
                  pricedCoatingCatIds.includes(s._id)
                )
              : styles
          }
          handleSelectedStyle={handleSelectedStyle}
          handleSelectedBrand={handleSelectedBrand}
          finishingBrands={
            coatingRates.length && finishingBrandsMaster.length
              ? // Show every brand that has a coating rate (priced), and — when
                // a style is selected — prefer brands priced for that style, but
                // never fall back to an empty list (the style-match depends on
                // LocalStorage category ids that can lag/mismatch).
                (() => {
                  const forStyle = selectedStyle
                    ? finishingBrandsMaster.filter((b: any) =>
                        coatingRates.some(
                          (r: any) =>
                            r.finishingCategoryId === selectedStyle._id &&
                            r.finishingBrandId === b._id
                        )
                      )
                    : [];
                  if (forStyle.length) return forStyle;
                  return finishingBrandsMaster.filter((b: any) =>
                    coatingRates.some((r: any) => r.finishingBrandId === b._id)
                  );
                })()
              : finishingBrandsMaster
          }
          finishingsList={finishingsList}
          handleSelectedGrainDirection={handleSelectedGrainDirection}
          handleFinishingTextureSelection={handleFinishingTextureSelection}
          grainDirections={grainDirections}
          setShowObjectComponentsModal={setShowObjectComponentsModal}
          selectedComponentGroup={selectedComponentGroup}
          selectedChildComponent={selectedChildComponent}
          selectedFinishingType={selectedFinishingType}
          setSelectedChildComponent={setSelectedChildComponent}
          setSelectedComponentGroup={setSelectedComponentGroup}
          componentGroup={componentGroup}
        />
      )}
      {showHandleTypesModal && (
        <HandleTypesModal
          onHideObjectPanel={onHideObjectPanel}
          isDarkMode={isDarkMode}
          showHandleTypesModal={showHandleTypesModal}
          setShowHandleTypesModal={setShowHandleTypesModal}
          selectedHandleType={selectedHandleType}
          handles={selectedHandleModels}
          selectedComponentGroup={selectedComponentGroup}
        />
      )}
      {showCoreMaterialsModal && componentProps && selectedComponentGroup && (
        <ObjectMaterialModal
          onHideObjectPanel={onHideObjectPanel}
          isDarkMode={isDarkMode}
          showCoreMaterialsModal={showCoreMaterialsModal}
          setShowCoreMaterialsModal={setShowCoreMaterialsModal}
          componentProps={componentProps}
          selectedComponentGroup={selectedComponentGroup}
          selectedChildComponent={selectedChildComponent}
          handleSelectedCoreMaterialType={handleSelectedCoreMaterialType}
          handleSelectedCoreMaterialThickness={
            handleSelectedCoreMaterialThickness
          }
          handleSelectedCoreMaterialBrand={handleSelectedCoreMaterialBrand}
          handleSelectedCoreMaterialGrade={handleSelectedCoreMaterialGrade}
          coreMaterialBrands={coreMaterialBrands}
          coreMaterialTypeList={coreMaterialTypeList}
          coreMaterialThicknessList={coreMaterialThicknessList}
        />
      )}
      <ComponentsGroup
        componentProps={componentProps}
        coreMaterialBrands={coreMaterialBrands}
        coreMaterialTypeList={coreMaterialTypeList}
        groupedModelComponents={groupedModelComponents}
        selectedComponentGroup={selectedComponentGroup}
        handleNodeSelection={handleNodeSelection}
        handleChildNodeSelection={handleChildNodeSelection}
        handleNodeHover={handleNodeHover}
        handleNodeHoverEnd={handleNodeHoverEnd}
        finishingCategories={finishingCategories}
        setShowCoreMaterialsModal={setShowCoreMaterialsModal}
        setShowObjectComponentsModal={setShowObjectComponentsModal}
        selectedFinishingType={selectedFinishingType}
        handleFinishingTypeSelection={handleFinishingTypeSelection}
        getExternalFinishingImage={getExternalFinishingImage}
        getInternalFinishingImage={getInternalFinishingImage}
        componentAdditionalProps={componentAdditionalProps}
        isEdgeBandPropAvailable={isEdgeBandPropAvailable}
        isEdgeBandExpanded={isEdgeBandExpanded}
        setIsEdgeBandExpanded={setIsEdgeBandExpanded}
        setComponentAdditionalProps={setComponentAdditionalProps}
        toggleColorPicker={toggleColorPicker}
        colorPickerVisible={colorPickerVisible}
        handleColorChange={handleColorChange}
        selectedChildComponent={selectedChildComponent}
        getComponentExternalFinishingImage={getComponentExternalFinishingImage}
        getComponentInternalFinishingImage={getComponentInternalFinishingImage}
        handleShutterVisible={handleShutterVisible}
        selectedHandleType={selectedHandleType}
        handleTypes={handleTypes}
        handleSelectedHandleType={handleSelectedHandleType}
        handleExposureChange={handleExposureChange}
        onBulkRename={handleBulkRename}
        onRemoveFromGroup={handleRemoveFromGroup}
        onUngroupGroup={handleUngroupGroup}
        isMultiSelectMode={isMultiSelectMode}
        showLoader={showLoader}
      />
    </>
  );
}

export default ObjectComponents;
