import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { useMaterialTab } from "./materialTabContext";
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

// Whether the full parts list was left open. Remembered while the page stays
// open, so someone who works from the list is not made to reopen it on every
// item. Starts closed: the default is the one-part card.
let rememberedShowAllParts = false;

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

  // Card mode (the default): the panel shows only the part picked in 3D, as
  // one card, with the full list behind "All parts". showAllParts = the old
  // always-open list, unchanged. Declared before the auto-open effect below,
  // which reads it in its dependency list.
  const [showAllParts, setShowAllPartsState] = useState(rememberedShowAllParts);
  const setShowAllParts = (v: boolean) => {
    rememberedShowAllParts = v;
    setShowAllPartsState(v);
  };

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
      groupedModelComponents.length > 0 &&
      // Card mode never opens a part on its own: a card for "Mesh 0" that the
      // user never clicked would look like a choice they made. It shows the
      // "click a part" hint instead. The full list keeps the old behaviour.
      (showAllParts || isMultiSelectMode)
    ) {
      autoOpenedGroupRef.current = true;
      setSelectedComponentGroup(groupedModelComponents[0]);
    }
  }, [
    groupedModelComponents,
    selectedComponentGroup,
    selectedModel?._id,
    showAllParts,
    isMultiSelectMode,
  ]);

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

  // No automatic default finish: selecting an item never writes a finish or
  // brand on its parts. Each part keeps the look of its own 3D file until the
  // user picks a finish.

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

  /**
   * CACHE FIRST FOR SPEED, THEN ALWAYS ASK THE SERVER.
   *
   * The materials used to come from localStorage and stop there. That cache is
   * written in ONE place — fetchRequiredData, when the drawing page loads — so
   * anything added or changed in the master data afterwards was invisible
   * here, indefinitely and silently: the picker showed a copy of the catalogue
   * from some earlier session while the database had moved on.
   *
   * It cost a whole afternoon. Tile sizes were written to all 626 materials,
   * every check against the database confirmed them, and the 3D went on
   * drawing untiled textures because its copy of each material predated the
   * change and carried no tile size at all. Nothing failed; the console was
   * clean; the data was simply old.
   *
   * So the cache now only decides how fast the panel paints: it renders at
   * once from whatever is stored, the server is asked every time regardless,
   * and the fresh list replaces it and is written back for next time.
   */
  const getFinishings = async () => {
    let shown: any[] = [];
    try {
      const cached = await TexturesService.getFinishingsFromLocalStorage();
      if (cached?.length) {
        setFinishingsList(cached);
        shown = cached;
      }
    } catch (error) {
      console.error(error);
    }
    try {
      const resp = await TexturesService.getAllFinishings();
      const fresh = Array.isArray(resp) ? resp : resp?.data;
      if (!fresh?.length) return;
      TexturesService.saveFinishingsToLocalStorage(fresh);
      // Replacing the list re-runs the grouping that watches it, so an
      // unchanged catalogue is left alone. Compared by id AND by tile size:
      // the ids do not change when a material is merely re-scaled, and that
      // is exactly the change this needs to notice.
      const sig = (l: any[]) =>
        l.map((f: any) => `${f?._id}:${f?.tileCm ?? ""}`).join("|");
      if (sig(shown) !== sig(fresh)) setFinishingsList(fresh);
    } catch (error) {
      console.error(error);
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

  /**
   * Looked up by id, and FIRST among the grades actually on offer.
   *
   * By name it could not tell Merino's Patterns from Greenlam's, and
   * resolved to whichever came first in the master list. Searching the
   * offered list first also means the choice can only ever be something the
   * dropdown was showing — a stale id from elsewhere cannot slip in.
   */
  const handleSelectedStyle = (event: any) => {
    const id = event.target.value;
    const style =
      gradesForPicker.find((g: any) => g._id === id) ??
      allFinishingCategories?.find((c: any) => c._id === id);
    if (style) setSelectedStyle(style);
    else console.warn("handleSelectedStyle: no grade with id", id);
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

    // Show the choice first, then save — the dropdown must not sit on the old
    // value while the save runs.
    if (selectedChildComponent) {
      setSelectedChildComponent({
        ...selectedChildComponent,
        [idField]: brandId,
        [objField]: brand,
      });
      await save(selectedChildComponent);
      return;
    }
    if (selectedComponentGroup?.components?.length) {
      const list = selectedComponentGroup.components.map((c: any) => ({
        ...c,
        [idField]: brandId,
        [objField]: brand,
      }));
      const toSave = selectedComponentGroup.components;
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
      for (const c of toSave) await save(c);
    }
  };

  /**
   * Grain Direction.
   *
   * This used to set a local state variable and stop. Nothing else read that
   * variable: the dropdown's value is bound to the part's SAVED direction, so
   * the choice was never written, never repainted, and the control snapped
   * straight back to Horizontal. It looked like only Vertical was broken —
   * in fact neither option did anything; Horizontal just happened to be what
   * it was already showing.
   *
   * Now it saves and repaints, like every other control in this panel: one
   * part when a part is open, otherwise every part in the group, which is how
   * the material swatches above it already behave.
   */
  const handleSelectedGrainDirection = async (event: any) => {
    const direction = event?.target?.value;
    console.debug(
      "objectComponents.tsx ~ handleSelectedGrainDirection ~",
      direction
    );
    if (!direction) return;
    setSelectedGrainDirection(direction);

    const isExterior = selectedFinishingType === Finishing_Types.EXTERIOR;
    const field = isExterior
      ? "externalFinishGrainDirection"
      : "internalFinishGrainDirection";

    const targets: any[] = selectedChildComponent
      ? [selectedChildComponent]
      : selectedComponentGroup?.components ?? [];
    if (!targets.length) return;

    // Repaint the panel from the new value immediately — awaiting the save
    // first leaves the dropdown showing the old direction for as long as the
    // write takes, which reads as the control having ignored the click.
    if (selectedChildComponent) {
      setSelectedChildComponent({
        ...selectedChildComponent,
        [field]: direction,
      } as FurnishedModelComponent);
    }
    const updated = targets.map((c: any) => ({ ...c, [field]: direction }));
    if (selectedComponentGroup?.components?.length) {
      setGroupedModelComponents(
        groupedModelComponents.map((item) =>
          item.name === selectedComponentGroup?.name
            ? { ...item, components: updated }
            : item
        )
      );
      setSelectedComponentGroup({
        ...selectedComponentGroup,
        components: updated,
      });
    }

    await BlueprintInterface.ProjectManagerService.onFurnishModelComponentGrainDirectionChange(
      targets,
      direction,
      isExterior
    );
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
  /**
   * THE GRADES WORTH OFFERING — two tests, both about not wasting a click.
   *
   * 1. IT MUST CONTAIN SOMETHING. A grade with no materials is a dead end:
   *    choosing it only produces "Sorry, no finishings available", which tells
   *    a designer nothing they can act on. Fourteen grades are empty today —
   *    the finish-type ones added by hand, and the paint and glass ones that
   *    have always been so. They stay in the database and in the Rate Card,
   *    where they can be filled; they simply stop being offered until they
   *    are. Materials with no picture do not count: they cannot be applied.
   *
   * 2. IT MUST HAVE A RATE, as before — a grade priced at nothing would be
   *    applied and then billed at ₹0.
   */
  /**
   * The brand the part currently carries — derived here exactly as the panel
   * derives it for its own dropdown, so the two can never disagree about what
   * is selected. The id is what is stored; the brand object is not always
   * attached (a part picked in 3D arrives without it).
   */
  const pickedBrandId = (() => {
    const side =
      selectedFinishingType === Finishing_Types.EXTERIOR
        ? "external"
        : "internal";
    const of = (c: any) =>
      c?.[`${side}FinishBrandId`] || c?.[`${side}FinishBrand`]?._id || "";
    return (
      of(selectedChildComponent) ||
      of(selectedComponentGroup?.components?.[0]) ||
      ""
    );
  })();

  const gradesForPicker = (() => {
    const pictured = (finishingsList || []).filter(
      (f: any) => f?.texture?.fileUrl
    );
    /**
     * THE GRADE MUST CONTAIN SOMETHING *FROM THIS BRAND*.
     *
     * Grades belong to brands. Merino's catalogue is Woodgrains, Metalam,
     * Patterns and the rest; Greenlam's is its own. Offering the whole list
     * whatever the brand let a designer pick a combination that does not
     * exist and land on "Sorry, no finishings available" — a dead end they
     * had to back out of themselves. Narrowing to the chosen brand makes that
     * combination unreachable rather than merely discouraged.
     *
     * Derived from the materials, not from a list written here: add a brand,
     * a grade or a material tomorrow and this follows with no code change.
     */
    /**
     * STRICT: no widening when a brand owns nothing.
     *
     * This first fell back to every pictured material, so that a brand with
     * no catalogue still had something to show. It showed the wrong thing.
     * Three of the four brands own no materials at all — the original
     * catalogue carries no brand — so picking Greenlam listed the brandless
     * originals' styles, and applying one recorded the part as Greenlam while
     * the material was a generic. The BOQ would then price it as Greenlam.
     *
     * An empty list is the truthful answer, and the panel says which brand is
     * empty rather than leaving a blank space.
     */
    const source = pickedBrandId
      ? pictured.filter((f: any) => String(f.brandId) === String(pickedBrandId))
      : pictured;
    const stocked = new Set(source.map((f: any) => String(f.categoryId)));

    const withStock = (styles || []).filter((s: any) => stocked.has(String(s._id)));
    /**
     * "NOTHING LOADED YET" AND "THIS BRAND OWNS NOTHING" ARE DIFFERENT, and
     * the empty set alone cannot tell them apart. Judged on whether ANY
     * pictured material exists: none at all means the list is still arriving,
     * and showing nothing then would look like the catalogue had vanished;
     * some, but none for this brand, is a real and final answer.
     */
    const loaded = pictured.length > 0;
    const base = loaded ? withStock : styles || [];
    if (!loaded || !pricedCoatingCatIds.length) return base;
    const priced = base.filter((s: any) => pricedCoatingCatIds.includes(s._id));
    // The pricing fallback stays: a grade this brand really has, but which
    // nobody has priced yet, is still the brand's own grade — unlike the
    // widening above, this cannot offer another brand's styles.
    return priced.length ? priced : base;
  })();

  /**
   * Keep Style on something the chosen brand actually has.
   *
   * Switching brand can strand the current style — "Glossy laminate" selected,
   * brand switched to Merino, which has no such grade. Left alone the picker
   * shows a style that is no longer in its own list and a grid with nothing in
   * it. A style still valid for the new brand is deliberately kept, so merely
   * re-picking the same brand does not throw away the designer's choice.
   */
  const gradeSignature = gradesForPicker.map((g: any) => g._id).join("|");
  useEffect(() => {
    if (!gradesForPicker.length) {
      // The brand owns nothing. Leaving the previous style selected would
      // leave the previous brand's swatches on screen under the new brand's
      // name — a part could then be applied from a catalogue the designer is
      // no longer looking at.
      if (selectedStyle) setSelectedStyle(null);
      return;
    }
    if (selectedStyle && gradesForPicker.some((g: any) => g._id === selectedStyle._id))
      return;
    setSelectedStyle(gradesForPicker[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeSignature, selectedStyle?._id]);

  /**
   * The brands worth offering for the chosen TYPE — in one place, so the
   * auto-default picks exactly what the dropdown shows.
   *
   * It used to narrow by the chosen STYLE, which only made sense while Style
   * came first. The order is Type → Brand → Style now, because a grade
   * belongs to a brand and not the other way round, so narrowing by style
   * here would make each dropdown wait on the other.
   *
   * The type's grades are `styles`; a brand is offered if it is priced for
   * any of them. Fallbacks widen rather than empty: any priced brand, then
   * the full master list.
   */
  const getBrandListForPicker = () => {
    if (coatingRates.length && finishingBrandsMaster.length) {
      const gradeIds = new Set((styles || []).map((s: any) => String(s._id)));
      const forType = gradeIds.size
        ? finishingBrandsMaster.filter((b: any) =>
            coatingRates.some(
              (r: any) =>
                gradeIds.has(String(r.finishingCategoryId)) &&
                r.finishingBrandId === b._id
            )
          )
        : [];
      if (forType.length) return forType;
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
  // splits out into its own row again. Its finish is left as it is — no default
  // finish is applied.
  const handleRemoveFromGroup = async (comp: any) => {
    if (!comp?._id) return;
    const standalone =
      (comp.meshName && String(comp.meshName).trim()) ||
      `Mesh ${String(comp._id).slice(-4)}`;
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      await pm?.updateFurnishedModelComponentName?.(comp._id, standalone);
      await getModelComponents(isMultiSelectMode);
    } catch (e) {
      console.error("objectComponents.tsx ~ handleRemoveFromGroup failed", e);
    }
  };

  // Ungroup an ENTIRE group: rename every part back to its own mesh name. Each
  // part keeps its current finish — no default finish is applied.
  const handleUngroupGroup = async (group: any) => {
    const comps = group?.components || [];
    if (!comps.length) return;
    try {
      const pm: any = (BlueprintInterface as any)?.ProjectManagerService;
      for (const c of comps) {
        const standalone =
          (c.meshName && String(c.meshName).trim()) ||
          `Mesh ${String(c._id).slice(-4)}`;
        await pm?.updateFurnishedModelComponentName?.(c._id, standalone);
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

  // ── Click-to-select parts ─────────────────────────────────────────────────
  // The 3D view announces what a click picked ("pazl:part-pick" — see
  // CLICK_SELECTS_PART in DragRoomItemsControl3D).
  //   part  → open its row with the SAME handleNodeSelection a click on the row
  //           runs (the outline effect near the top draws it) and open its
  //           finish panel on Exterior.
  //   whole → close the rows and the finish panels: the whole object has no
  //           single finish. (No popup — it was removed as not needed; rotate
  //           and delete are in the panel above.)
  //
  // Everything is read through refs because the listener is registered once,
  // and because the click that FIRST selects an item lands before this panel
  // has loaded its rows — the pick waits in pendingPickRef until they arrive.
  const [quickFinish, setQuickFinish] = useState<{
    type: string;
    groupName: string;
    n: number;
  } | null>(null);
  const pendingPickRef = useRef<any>(null);
  const quickLatest = useRef<any>({});
  quickLatest.current = {
    model: selectedModel,
    groups: groupedModelComponents,
    selectedGroup: selectedComponentGroup,
    open: handleNodeSelection,
    multi: isMultiSelectMode,
  };

  const findGroupRow = (name: string) =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-pz-group]")
    ).find((r) => r.dataset.pzGroup === name) || null;

  const applyPick = (pick: any) => {
    const { groups, selectedGroup, open } = quickLatest.current;
    // Nearest name first: the mesh that was hit, then its parents.
    let group: any = null;
    for (const n of pick.names || []) {
      group = (groups || []).find((g: any) =>
        (g?.components || []).some(
          (c: any) => c?.meshName === n || c?.name === n
        )
      );
      if (group) break;
    }
    // A pick outranks the one-time "open the first row" for this item.
    autoOpenedGroupRef.current = true;
    if (pick.mode === "part" && group) {
      if (selectedGroup?.name !== group.name) open(group);
      // One click on a part goes straight to its finish panel, on Exterior.
      // Interior is on the switch at the top of that panel. Goes through the
      // group's own "-- Exterior" row handler (quickFinish in ComponentsGroup),
      // so the panel opens exactly as it does from the list.
      setQuickFinish({
        type: Finishing_Types.EXTERIOR,
        groupName: group.name,
        n: Date.now(),
      });
      setTimeout(() => {
        findGroupRow(group.name)?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }, 60);
    } else {
      if (selectedGroup) {
        setSelectedComponentGroup(null);
        setSelectedChildComponent(null);
      }
      // Cancel any "open Exterior" still pending. A double-click arrives as two
      // clicks first; the second one queues the finish panel for the part, and
      // left alone it re-opened the panel after this closed it — titled just
      // ": Exterior", with no part selected.
      setQuickFinish(null);
      setShowObjectComponentsModal(false);
      setShowCoreMaterialsModal(false);
    }
  };

  const tryApplyPickRef = useRef<() => void>(() => {});
  tryApplyPickRef.current = () => {
    const pick = pendingPickRef.current;
    if (!pick) return;
    if (Date.now() - pick.t > 5000) {
      pendingPickRef.current = null;
      return;
    }
    const { model, groups, multi } = quickLatest.current;
    if (multi) {
      // Multi-select is building a selection, not editing one item.
      pendingPickRef.current = null;
      return;
    }
    // Wait until this panel shows the item that was clicked, rows loaded.
    if (!model?._id || pick.itemId !== model._id || !groups?.length) return;
    pendingPickRef.current = null;
    if ((window as any).__pazlLastPartPick === pick) {
      (window as any).__pazlLastPartPick = null;
    }
    applyPick(pick);
  };

  useEffect(() => {
    const onPick = (e: any) => {
      pendingPickRef.current = e?.detail || null;
      tryApplyPickRef.current();
    };
    window.addEventListener("pazl:part-pick", onPick);
    const last = (window as any).__pazlLastPartPick;
    if (last && Date.now() - last.t < 5000) pendingPickRef.current = last;
    tryApplyPickRef.current();
    return () => window.removeEventListener("pazl:part-pick", onPick);
  }, []);

  useEffect(() => {
    tryApplyPickRef.current();
  }, [groupedModelComponents, selectedModel?._id]);

  // The finish panel opens on every part click, so it gets a quick way out
  // besides its ✕.
  useEffect(() => {
    if (!showObjectComponentsModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowObjectComponentsModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showObjectComponentsModal]);

  // ── Material tab ─────────────────────────────────────────────────────────
  // The finish panel used to float over the canvas. When ObjectPanel offers a
  // Material tab, render it in there instead (same component, same props, same
  // state — only its DOM parent changes) and tell the panel when it is open so
  // the tab can switch to it. Outside ObjectPanel there is no context, so the
  // panel keeps floating exactly as before.
  const materialTab = useMaterialTab();
  const isDockedInMaterialTab = !!materialTab?.container;

  // Through a ref so this fires on open/close only, not on every render.
  const setMaterialOpenRef = useRef(materialTab?.setMaterialOpen);
  setMaterialOpenRef.current = materialTab?.setMaterialOpen;

  useEffect(() => {
    setMaterialOpenRef.current?.(showObjectComponentsModal);
  }, [showObjectComponentsModal]);

  useEffect(() => {
    return () => setMaterialOpenRef.current?.(false);
  }, []);

  const renderFinishPanel = (panel: React.ReactNode) =>
    materialTab?.container ? createPortal(panel, materialTab.container) : panel;

  return (
    <>
      {showObjectComponentsModal && renderFinishPanel(
        <ObjectFinishingsModal
          docked={isDockedInMaterialTab}
          onHideObjectPanel={onHideObjectPanel}
          isDarkMode={isDarkMode}
          showObjectComponentsModal={showObjectComponentsModal}
          finishingCategories={finishingCategories}
          handleSelectedType={handleSelectedType}
          selectedStyle={selectedStyle}
          selectedType={selectedType}
          styles={gradesForPicker}
          handleSelectedStyle={handleSelectedStyle}
          handleSelectedBrand={handleSelectedBrand}
          // The helper, not a second copy of its logic. The copy that used to
          // sit here had already drifted from it, which is how the dropdown
          // and the auto-default could disagree about which brands exist.
          finishingBrands={getBrandListForPicker()}
          allFinishingBrands={finishingBrandsMaster}
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
          // Exterior | Interior switch inside the panel: the same row handler a
          // click on the group's "-- Exterior" / "-- Interior" line runs.
          onSwitchFinishingType={(t: string) => {
            const name = selectedComponentGroup?.name;
            if (name) {
              setQuickFinish({ type: t, groupName: name, n: Date.now() });
            } else {
              handleFinishingTypeSelection(t);
            }
          }}
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
        quickFinish={quickFinish}
        showAllParts={showAllParts}
        onToggleAllParts={() => setShowAllParts(!showAllParts)}
      />
    </>
  );
}

export default ObjectComponents;
