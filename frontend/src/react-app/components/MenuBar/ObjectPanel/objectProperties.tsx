import React, { useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import { EVENT_ITEM_SELECTED } from "@pazl/main/core/events";
import { RenderService } from "../../../services/RenderService";
import { ROTATION_MODES } from "@pazl/entities/FurnishedModel";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import { MODEL_TYPES } from "@pazl/entities/Model";
import { ModelsService } from "@pazl/services/ModelsService";
import { TexturesService } from "@pazl/services/texturesService";
import { CategoriesService } from "@pazl/services/categoriesService";
import {
  PLACEMENT_OPTIONS,
  placementTypeLabel,
  isRetiredPlacementType,
} from "@pazl/helpers/guessModelType";
import { handleAddItemsToScene } from "@pazl/viewer3d-state-interface";
import ObjectComponents from "./objectComponents";
import "../index.css";
import { config } from "@pazl/main/core/configuration";
import Drawing2DModal from "../../Drawing2DModal";

interface ObjectPropertiesProps {
  selectedModel: any;
  isDarkMode: boolean;
  onHideObjectPanel: () => void;
  isMultiSelectMode: boolean;
}

function ObjectProperties({
  selectedModel,
  isDarkMode,
  onHideObjectPanel,
  isMultiSelectMode,
}: ObjectPropertiesProps) {
  const [modelObject, setModelObject] = useState<any>(null);
  const [showCustomWidthInput, setShowCustomWidthInput] = useState(false);
  const [show2DDrawing, setShow2DDrawing] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  // Split-parts popup: opens on Split click, asks how many parts to cut into.
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [typeSaveMessage, setTypeSaveMessage] = useState<string | null>(null);
  // Kitchen backsplash (a textured panel on the wall behind a base cabinet).
  // `bsHeight` is the panel height above the worktop, in millimetres.
  const [bsOn, setBsOn] = useState(false);
  const [bsHeight, setBsHeight] = useState(480);
  // Which wall to attach to: "auto" (nearest), "left", "right".
  const [bsAttach, setBsAttach] = useState<"auto" | "left" | "right">("auto");
  // Chosen finish (a wall-finishing texture URL) + label, and the swatch grid.
  const [bsMaterialUrl, setBsMaterialUrl] = useState<string | null>(null);
  const [bsMaterialName, setBsMaterialName] = useState<string>("Default");
  const [bsMaterials, setBsMaterials] = useState<any[]>([]);
  const [showBsMaterials, setShowBsMaterials] = useState(false);
  // Model categories (cached) — used to show Backsplash ONLY for the
  // "Below Counter Storage" category, not every floor-standing item.
  const [bsCategories, setBsCategories] = useState<any[]>([]);

  useEffect(() => {
    console.debug("objectProperties.tsx ~ selectedModel", selectedModel);
    if (selectedModel && BlueprintInterface.selectedModels.length === 1) {
      setModelObject({
        thumbnail: selectedModel?.thumbnail
          ? selectedModel?.thumbnail
          : selectedModel?.model?.thumbnail
          ? selectedModel?.model?.thumbnail
          : "",
        name: selectedModel?.name
          ? selectedModel?.name
          : selectedModel?.model?.name
          ? selectedModel?.model?.name
          : "",
        dimensions: {
          height: selectedModel?.dimensions?.length
            ? selectedModel?.dimensions[0]
            : 0,
          width: selectedModel?.dimensions?.length
            ? selectedModel?.dimensions[1]
            : 0,
          depth: selectedModel?.dimensions?.length
            ? selectedModel?.dimensions[2]
            : 0,
        },
        position: selectedModel?.position ? selectedModel?.position : [0, 0, 0],
        scale: selectedModel?.scale ? selectedModel?.scale : [1, 1, 1],
        rotation: selectedModel?.rotation ? selectedModel?.rotation : [0, 0, 0],
        // Coerce to a Number so the placement-type <select> value (numeric)
        // matches the numeric <option value> entries. If model.type arrives
        // as a string ("2") from the DB/cache, a string value can fail to
        // match and the dropdown falls back to showing the FIRST option.
        type:
          selectedModel?.model?.type != null
            ? Number(selectedModel.model.type)
            : 1,
        standardWidth: selectedModel?.model?.standardWidth
          ? selectedModel?.model?.standardWidth
          : [],
      });
    }
    return () => {
      setModelObject(null);
      setShowCustomWidthInput(false);
    };
  }, [selectedModel]);

  useEffect(() => {
    // NOTE: the height-forcing block that used to live here (forcing wall /
    // in-wall items to getMinHeight()) was removed. Because a drag re-selects
    // the item, `modelObject` changes after every drag, so that effect fired
    // post-drag and snapped the item back to a fixed height — making vertical
    // wall-drag impossible for both WALL_UNIT (mounted) and IN_WALL_UNIT
    // (embedded). Both should be freely positionable vertically on the wall.
    //
    // The DEPTH constraint below is kept: in-wall / in-wall-floor items must
    // be pushed into the wall to at least the wall thickness (this is about
    // depth, not height, so it doesn't interfere with vertical dragging).
    if (
      modelObject &&
      (modelObject.type === MODEL_TYPES.IN_WALL_UNIT ||
        modelObject.type === MODEL_TYPES.IN_WALL_FLOOR_UNIT) &&
      modelObject.dimensions.depth &&
      modelObject.dimensions.depth < config.wallThickness * 10
    ) {
      const depth = config.wallThickness * 10 + 10;
      onDepthChange(depth);
    }
  }, [modelObject]);

  // Load the wall-finish catalogue once — reused as backsplash material swatches.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await TexturesService.getFinishingsFromLocalStorage();
        const walls = (Array.isArray(list) ? list : []).filter(
          (f: any) => f?.type === "wall" && f?.texture?.fileUrl
        );
        if (alive) setBsMaterials(walls);
      } catch (_) {
        if (alive) setBsMaterials([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load the model-category catalogue once (for the Below-Counter-Storage gate).
  useEffect(() => {
    try {
      const cats = CategoriesService.getCategoriesFromLocalStorage();
      setBsCategories(Array.isArray(cats) ? cats : []);
    } catch (_) {
      setBsCategories([]);
    }
  }, []);

  // (The default cabinet finish is now applied in objectComponents — it writes
  // the finish RECORD so it shows in 3D, Properties, AND the BOQ. The earlier
  // visual-only default here was removed to avoid double-applying.)

  // Reflect the selected item's existing backsplash config in the controls.
  useEffect(() => {
    try {
      const viewer: any = (BlueprintInterface as any)?.blueprint3d?.roomplanner;
      const cfg = viewer?.getBacksplash?.();
      setBsOn(!!cfg?.on);
      setBsHeight(cfg?.height ? Number(cfg.height) : 480);
      setBsAttach(cfg?.attach === "left" || cfg?.attach === "right" ? cfg.attach : "auto");
      setBsMaterialUrl(cfg?.materialUrl || null);
      const match = bsMaterials.find((m: any) => m?.texture?.fileUrl === cfg?.materialUrl);
      setBsMaterialName(match?.name || (cfg?.materialUrl ? "Custom" : "Default"));
      setShowBsMaterials(false);
    } catch (_) {
      setBsOn(false);
      setBsHeight(480);
      setBsAttach("auto");
      setBsMaterialUrl(null);
      setBsMaterialName("Default");
    }
  }, [selectedModel, bsMaterials]);

  // Build/update the panel on the wall behind the selected cabinet, then persist
  // (updateFloorPlan serializes each item's metadata — which now carries
  // `backsplash` — and saves the scene).
  const applyBacksplash = (next: {
    on?: boolean;
    height?: number;
    attach?: "auto" | "left" | "right";
    materialUrl?: string | null;
    finishingCategoryId?: string | null;
  }) => {
    try {
      const viewer: any = (BlueprintInterface as any)?.blueprint3d?.roomplanner;
      if (!viewer?.setBacksplash) return;
      viewer.setBacksplash({
        on: next.on != null ? next.on : bsOn,
        height: next.height != null ? next.height : bsHeight,
        attach: next.attach != null ? next.attach : bsAttach,
        materialUrl:
          next.materialUrl !== undefined ? next.materialUrl : bsMaterialUrl,
        // Pass the finish's category id only when it changes; setBacksplash
        // keeps the previous value otherwise. The BOQ prices the exterior finish
        // from this id.
        finishingCategoryId: next.finishingCategoryId,
      });
      // Saving the floor plan writes the backsplash into the SCENE metadata,
      // which is where the backend BOQ reads it from — so no extra DB call is
      // needed (the furnished-model record may not exist yet for a fresh item).
      BlueprintInterface.ProjectManagerService?.updateFloorPlan?.(
        "Backsplash updated"
      );
    } catch (_) {
      /* best-effort */
    }
  };

  const onPositionChange = async (minHeight?: string, position?: any[]) => {
    if (modelObject?.position?.length) {
      await BlueprintInterface.ProjectManagerService.onFurnishedModelPositionChange(
        selectedModel._id,
        position
          ? position
          : [
              minHeight
                ? Number(modelObject.position[0] + 100)
                : Number(modelObject.position[0]),
              minHeight ? Number(minHeight) : Number(modelObject.position[1]),
              Number(modelObject.position[2]),
            ]
      );
    }
  };

  const onRemoveItem = async () => {
    const engineSel: any = (BlueprintInterface as any)?.selectedModels?.[0];
    const targetId =
      engineSel?.itemModel?.__id ||
      engineSel?.__itemModel?.__id ||
      selectedModel?._id;
    if (!targetId) return;
    await BlueprintInterface.ProjectManagerService.removeFurnishedModel(
      targetId
    );
    onHideObjectPanel();
  };

  const onRotationChange = async (mode: ROTATION_MODES, angle?: number) => {
    await BlueprintInterface.ProjectManagerService.onFurnishedModelRotationChange(
      selectedModel._id,
      mode,
      angle
    );
  };

  const onWidthChange = async (width: string | number) => {
    const updatedWidth = width ? width : modelObject?.dimensions?.width;
    if (updatedWidth) {
      await BlueprintInterface.ProjectManagerService.onFurnishedModelWidthChange(
        selectedModel._id,
        parseFloat(updatedWidth)
      );
    }
  };

  const onHeightChange = async (height: string | number) => {
    const updatedHeight = height ? height : modelObject?.dimensions?.height;
    if (updatedHeight) {
      await BlueprintInterface.ProjectManagerService.onFurnishedModelHeightChange(
        selectedModel._id,
        parseFloat(updatedHeight)
      );
    }
  };

  const onDepthChange = async (depth: string | number) => {
    const updatedDepth = depth ? depth : modelObject?.dimensions?.depth;
    if (updatedDepth) {
      await BlueprintInterface.ProjectManagerService.onFurnishedModelDepthChange(
        selectedModel._id,
        parseFloat(updatedDepth)
      );
    }
  };

  const getMaxWidth = () => {
    return modelObject?.standardWidth?.length
      ? modelObject?.standardWidth?.reduce((prev: number, curr: number) =>
          prev > curr ? prev : curr
        )
      : 0;
  };

  const getMinWidth = () => {
    return modelObject?.standardWidth?.length
      ? modelObject.standardWidth.reduce((prev: number, curr: number) =>
          prev < curr ? prev : curr
        )
      : 0;
  };

  // Does this model genuinely come in a set of fixed widths?
  //
  // The width field is a DROPDOWN of presets, unlike Height and Depth which are
  // plain inputs. That is right for a cabinet range sold at 600 / 900 / 1200,
  // and wrong for everything else — yet imported models are written with
  // `standardWidth: [1, 500, 9999]`, a placeholder from the importer. Because
  // that array is non-empty, the old `!standardWidth?.length` test treated it as
  // a real range and showed a dropdown offering 1 mm and 9999 mm. Typing a width
  // on an imported sofa then took three clicks via "Custom Width".
  //
  // So judge the CONTENT, not just the length: drop values outside a plausible
  // furniture range, and require at least two distinct ones left. A single
  // preset is not a choice either — an uploaded model ships with exactly one
  // (see the note below), and a one-option dropdown is worse than an input.
  const PRESET_MIN_MM = 100;
  const PRESET_MAX_MM = 4000;
  const hasWidthPresets = () => {
    const list = modelObject?.standardWidth;
    if (!Array.isArray(list)) return false;
    const usable = new Set(
      list
        .map((v: any) => Number(v))
        .filter((v: number) => Number.isFinite(v) && v >= PRESET_MIN_MM && v <= PRESET_MAX_MM)
    );
    return usable.size >= 2;
  };

  // "Custom Width" means ANY sensible width, not one of the presets. Uploaded
  // models ship with a single standardWidth (min === max), which used to freeze
  // the custom input to that one number. So in custom mode we validate against a
  // broad furniture range instead — and never tighter than the model's existing
  // max, so built-in models with a wide standardWidth keep their full range.
  const CUSTOM_WIDTH_FLOOR = 10;
  const CUSTOM_WIDTH_CEIL = 5000;
  const getCustomMinWidth = () => CUSTOM_WIDTH_FLOOR;
  const getCustomMaxWidth = () =>
    Math.max(CUSTOM_WIDTH_CEIL, Number(getMaxWidth()) || 0);

  const getMinHeight = () => {
    return (
      (config.lintelLevelHeight * 10 - modelObject.dimensions.height) /
      10
    ).toFixed(0);
  };

  const getMaxHeight = () => {
    return (
      (config.wallHeight * 10 - modelObject.dimensions.height) /
      10
    ).toFixed(0);
  };

  const handleKeyPress = (direction: any) => {
    const currentAngle = modelObject.rotation[1] ?? 0;
    const newAngle = currentAngle + direction;
    setModelObject({
      ...modelObject,
      rotation: [
        modelObject.rotation[0] ?? 0,
        newAngle,
        modelObject.rotation[2] ?? 0,
      ],
    });
    onRotationChange(
      direction > 0 ? ROTATION_MODES.ROTATE_RIGHT : ROTATION_MODES.ROTATE_LEFT,
      newAngle
    );
  };

  // Runs the actual in-place split once the user confirms the part count in
  // the popup. Cuts the selected item's mesh into `n` pieces, then rebuilds the
  // components so each part is selectable and paintable.
  const runSplit = async (n: number) => {
    setShowSplitModal(false);
    setIsSplitting(true);
    try {
      const item: any =
        (BlueprintInterface as any)?.selectedModels?.[0] ||
        (BlueprintInterface as any)?.blueprint3d?.roomplanner?.dragcontrols
          ?.__selected;
      if (!item || typeof item.splitIntoParts !== "function") {
        throw new Error("No model selected");
      }
      // 1) Cut the mesh into exactly `n` parts IN PLACE.
      const count = item.splitIntoParts(n);
      if (!count || count <= 1) {
        window.alert("This mesh could not be split.");
        return;
      }
      // 2) Collect the new mesh names.
      const meshNames: string[] = [];
      item.__loadedItem?.traverse((o: any) => {
        if (o.isMesh) meshNames.push(o.name);
      });
      // 3) Rebuild the item's components (one per split part).
      await BlueprintInterface.ProjectManagerService.createComponentsForSplit(
        item.__itemModel.__id,
        meshNames
      );
      // 4) Refresh the panel by re-selecting the item.
      try {
        (
          BlueprintInterface as any
        )?.blueprint3d?.roomplanner?.__roomItemSelected?.({
          type: EVENT_ITEM_SELECTED,
          item,
        });
      } catch (_) {
        /* refresh best-effort */
      }
    } catch (e: any) {
      window.alert("Split failed: " + (e?.message || String(e)));
    } finally {
      setIsSplitting(false);
    }
  };

  // AI split: render the item side-on, ask Claude for its real parts, then cut
  // the mesh at those boundaries and name each part.
  const runAISplit = async () => {
    setShowSplitModal(false);
    setIsSplitting(true);
    try {
      const viewer = (BlueprintInterface as any)?.blueprint3d?.roomplanner;
      const item: any =
        (BlueprintInterface as any)?.selectedModels?.[0] ||
        viewer?.dragcontrols?.__selected;
      if (!item || typeof item.splitAtFractions !== "function") {
        throw new Error("No model selected");
      }
      const snap = viewer?.captureSelectedItemImage?.();
      if (!snap || !snap.dataUrl) {
        throw new Error("Could not capture the item image");
      }
      const itemName =
        item?.__itemModel?.__metadata?.itemName ||
        modelObject?.name ||
        selectedModel?.model?.name ||
        "";
      const res = await RenderService.aiSplit(snap.dataUrl, itemName);
      let parts = (res?.parts || []).filter(
        (p: any) => typeof p.start === "number" && p.end > p.start
      );
      if (!parts.length) {
        throw new Error("AI could not identify parts");
      }
      if (snap.flip) {
        parts = parts
          .map((p: any) => ({
            name: p.name,
            start: 1 - p.end,
            end: 1 - p.start,
          }))
          .reverse();
      }
      const cuts = parts.slice(0, -1).map((p: any) => p.end);
      const names = parts.map((p: any) => p.name);
      const count = item.splitAtFractions(cuts, snap.axis);
      if (!count || count <= 1) {
        window.alert("AI split produced only one part.");
        return;
      }
      const meshNames: string[] = [];
      item.__loadedItem?.traverse((o: any) => {
        if (o.isMesh) meshNames.push(o.name);
      });
      const displayNames =
        meshNames.length === names.length ? names : undefined;
      await BlueprintInterface.ProjectManagerService.createComponentsForSplit(
        item.__itemModel.__id,
        meshNames,
        displayNames
      );
      try {
        viewer?.__roomItemSelected?.({ type: EVENT_ITEM_SELECTED, item });
      } catch (_) {
        /* refresh best-effort */
      }
    } catch (e: any) {
      window.alert("AI split failed: " + (e?.message || String(e)));
    } finally {
      setIsSplitting(false);
    }
  };

  // Geometry split: separate the model into its physically-connected pieces
  // (loose parts). Real parts on models built from separate pieces; on a fused
  // single mesh it produces 1 (nothing to split) or many tiny fragments.
  const runGeometrySplit = async () => {
    setShowSplitModal(false);
    setIsSplitting(true);
    try {
      const viewer = (BlueprintInterface as any)?.blueprint3d?.roomplanner;
      const item: any =
        (BlueprintInterface as any)?.selectedModels?.[0] ||
        viewer?.dragcontrols?.__selected;
      if (!item || typeof item.splitLooseParts !== "function") {
        throw new Error("No model selected");
      }
      const count = item.splitLooseParts();
      if (!count || count <= 1) {
        window.alert(
          "This model is one fused piece — it has no separate parts to split. Try AI split or the equal cut instead."
        );
        return;
      }
      const meshNames: string[] = [];
      item.__loadedItem?.traverse((o: any) => {
        if (o.isMesh) meshNames.push(o.name);
      });
      await BlueprintInterface.ProjectManagerService.createComponentsForSplit(
        item.__itemModel.__id,
        meshNames
      );
      try {
        viewer?.__roomItemSelected?.({ type: EVENT_ITEM_SELECTED, item });
      } catch (_) {
        /* refresh best-effort */
      }
    } catch (e: any) {
      window.alert("Geometry split failed: " + (e?.message || String(e)));
    } finally {
      setIsSplitting(false);
    }
  };

  const maxHeight = isMultiSelectMode
    ? "calc(100vh - 230px)"
    : "calc(100vh - 160px)";

  return (
    <>
      {modelObject ||
      (selectedModel &&
        isMultiSelectMode &&
        BlueprintInterface.selectedModels.length > 1) ? (
        <div style={{ maxHeight }}>
          {modelObject ? (
            <div className="py-2 max-h-full flex">
              <div className="flex justify-between w-2/4 flex-col">
                <figure className="inline-block max-w-sm h-full">
                  <img
                    src={modelObject.thumbnail}
                    className="h-full max-h-44 align-middle leading-none shadow-lg"
                    alt={modelObject.name ?? "_"}
                  />
                </figure>
                <div className="flex flex-col">
                  <button
                    type="button"
                    id="generate2DDrawingButton"
                    className="flex flex-row items-center justify-center text-[#1e88e5] p-2.5"
                    title="Generate an AutoCAD-style 2D drawing of this item"
                    onClick={(evt) => {
                      evt.preventDefault();
                      setShow2DDrawing(true);
                    }}
                  >
                    <span className="material-symbols-outlined font-extralight">
                      architecture
                    </span>
                    <p className="font-normal text-xs self-center">
                      2D Drawing
                    </p>
                  </button>
                  {/* Download THIS model as its own .glb (geometry + materials
                      + embedded textures). The item is already selected here, so
                      it always exports the right one. */}
                  <button
                    type="button"
                    id="exportItemGlbButton"
                    className="flex flex-row items-center justify-center text-[#059669] p-2.5"
                    title="Download this model as a .glb file"
                    onClick={(evt) => {
                      evt.preventDefault();
                      BlueprintInterface.blueprint3d.roomplanner.exportSelectedItemAsGLB(
                        (err: any) =>
                          console.warn("single-model export:", err?.message)
                      );
                    }}
                  >
                    <span className="material-symbols-outlined font-extralight">
                      download
                    </span>
                    <p className="font-normal text-xs self-center">Export GLB</p>
                  </button>
                  {/* IN-PLACE split: split THIS item's mesh into loose parts in
                      the browser (Three.js) — same item, instant, no new model,
                      no size/position change. Then rebuild the components. */}
                  <button
                    type="button"
                    id="splitItemButton"
                    className="flex flex-row items-center justify-center text-[#7c3aed] p-2.5 disabled:opacity-40"
                    title="Split this model into separate parts (in place)"
                    disabled={isSplitting}
                    onClick={(evt) => {
                      evt.preventDefault();
                      // Split directly by geometry (loose parts) — no popup.
                      runGeometrySplit();
                    }}
                  >
                    <span className="material-symbols-outlined font-extralight">
                      {isSplitting ? "hourglass_top" : "call_split"}
                    </span>
                    <p className="font-normal text-xs self-center">
                      {isSplitting ? "Splitting…" : "Split parts"}
                    </p>
                  </button>
                  <button
                    type="button"
                    id="removeItemButton"
                    className="flex flex-row items-center justify-center text-red-400 p-2.5"
                    onClick={(evt) => {
                      evt.preventDefault();
                      onRemoveItem();
                    }}
                  >
                    <span className="material-symbols-outlined font-extralight">
                      delete
                    </span>
                    <p className="font-normal text-xs self-center">Delete</p>
                  </button>
                </div>
              </div>
              <div className="block w-full px-2 dark:bg-neutral-700">
                <form>
                  <div className="flex flex-col mb-2">
                    <h6 className="text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                      Name
                    </h6>
                    <p className="font-normal bg-[color:var(--pz-input-bg)] text-xs text-primary h-7 flex items-center pl-1.5 dark:text-neutral-200">
                      {capitalizeText(modelObject.name)}
                    </p>
                  </div>
                  <div className="flex flex-col max-w-sm mb-2">
                    <h6 className="text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                      Dimensions{" "}
                      <span style={{ fontSize: "10px" }}>(in mm)</span>
                    </h6>
                    <div className="flex items-center justify-between">
                      <div className="relative flex w-full flex-wrap items-stretch">
                        <button
                          className="relative flex items-center bg-[color:var(--pz-input-bg)] px-2 py-2 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                          type="button"
                          id="button-addon1"
                          disabled
                        >
                          W
                        </button>
                        {showCustomWidthInput || !hasWidthPresets() ? (
                          <input
                            type="number"
                            className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                            id="widthFormControlInput"
                            placeholder="Width"
                            value={
                              modelObject.dimensions?.width
                                ? Number(modelObject.dimensions.width).toFixed(
                                    0
                                  )
                                : 0
                            }
                            /* onChange updates the displayed value only.
                               The resize fires on blur / Enter — per-
                               keystroke firing races the async engine
                               update and corrupts the scale. */
                            onChange={(e) => {
                              setModelObject({
                                ...modelObject,
                                dimensions: {
                                  ...modelObject.dimensions,
                                  width: e.target.value
                                    ? Number(e.target.value).toFixed(0)
                                    : 0,
                                },
                              });
                            }}
                            onBlur={(e) => {
                              const val = Number(e.target.value);
                              if (
                                e.target.value &&
                                Number.isFinite(val) &&
                                val >= getCustomMinWidth() &&
                                val <= getCustomMaxWidth()
                              ) {
                                onWidthChange(val.toFixed(0));
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />
                        ) : (
                          <select
                            value={
                              modelObject.dimensions?.width
                                ? Number(modelObject.dimensions.width).toFixed(
                                    0
                                  )
                                : 0
                            }
                            onChange={(e) => {
                              if (
                                e.target.value.toLowerCase() === "custom width"
                              ) {
                                setShowCustomWidthInput(true);
                                return;
                              }
                              setModelObject({
                                ...modelObject,
                                dimensions: {
                                  ...modelObject.dimensions,
                                  width: e.target.value
                                    ? Number(e.target.value).toFixed(0)
                                    : 0,
                                },
                              });
                              onWidthChange(
                                e.target.value
                                  ? Number(e.target.value).toFixed(0)
                                  : 0
                              );
                            }}
                            className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                          >
                            {modelObject.dimensions?.width ? (
                              <option>
                                {Number(modelObject.dimensions.width).toFixed(
                                  0
                                )}
                              </option>
                            ) : null}
                            {modelObject.standardWidth.map((value: number) =>
                              modelObject.dimensions?.width != value ? (
                                <option key={value}>{value}</option>
                              ) : null
                            )}
                            <option>Custom Width </option>
                          </select>
                        )}
                      </div>
                      <div className="relative flex w-full flex-wrap items-stretch">
                        <button
                          className="relative flex items-center bg-[color:var(--pz-input-bg)] px-2 py-2 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                          type="button"
                          id="button-addon1"
                          disabled
                        >
                          H
                        </button>
                        <input
                          type="number"
                          className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                          id="heightFormControlInput"
                          placeholder="Height"
                          /* Height editable for all item types. The original
                             rule locked H to wall units only (modular-
                             furniture convention). Opened up so scraped-GLB
                             catalog items with guessed dimensions can be
                             corrected per placement. */
                          disabled={false}
                          value={
                            modelObject.dimensions?.height
                              ? Number(modelObject.dimensions.height).toFixed(0)
                              : 0
                          }
                          /* onChange only updates the displayed value.
                             The actual resize fires on blur / Enter — NOT
                             per keystroke. Per-keystroke firing sent
                             handleHeightChange(8) → (81) → (810) in rapid
                             succession; each is async and races the
                             engine's __initializeChildItem, producing
                             garbage scale (the "sliver" bug). Blur fires
                             exactly once with the final value. */
                          onChange={(e) => {
                            setModelObject({
                              ...modelObject,
                              dimensions: {
                                ...modelObject.dimensions,
                                height: e.target.value
                                  ? Number(e.target.value).toFixed(0)
                                  : 0,
                              },
                            });
                          }}
                          onBlur={(e) => {
                            if (e.target.value) {
                              onHeightChange(Number(e.target.value).toFixed(0));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </div>
                      <div className="relative flex w-full flex-wrap items-stretch">
                        <button
                          className="relative flex items-center bg-[color:var(--pz-input-bg)] px-2 py-2 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                          type="button"
                          id="button-addon1"
                          disabled
                        >
                          D
                        </button>
                        <input
                          type="number"
                          className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                          id="depthFormControlInput"
                          placeholder="Depth"
                          /* Depth editable for all item types — see the
                             Height field comment above for rationale. */
                          value={
                            modelObject.dimensions?.depth
                              ? Number(modelObject.dimensions.depth).toFixed(0)
                              : 0
                          }
                          /* Resize on blur / Enter only — see Height
                             field above for why per-keystroke firing
                             breaks. */
                          onChange={(e) => {
                            setModelObject({
                              ...modelObject,
                              dimensions: {
                                ...modelObject.dimensions,
                                depth: e.target.value
                                  ? Number(e.target.value).toFixed(0)
                                  : 0,
                              },
                            });
                          }}
                          onBlur={(e) => {
                            if (e.target.value) {
                              onDepthChange(Number(e.target.value).toFixed(0));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </div>
                    </div>
                    {showCustomWidthInput || !hasWidthPresets() ? (
                      <div className="text-xs font-normal text-primary dark:text-neutral-200">
                        <span>min: {getCustomMinWidth()}</span>
                        <span className="px-2">max: {getCustomMaxWidth()}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col max-w-sm mb-2">
                    <h6 className="text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                      Position
                    </h6>
                    <div className="flex items-center justify-between">
                      <div className="relative flex w-full flex-wrap items-stretch">
                        <button
                          className="relative flex items-center bg-[color:var(--pz-input-bg)] px-2.5 py-2 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                          type="button"
                          id="button-addon1"
                          disabled
                        >
                          X
                        </button>
                        <input
                          type="text"
                          className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                          aria-label="0"
                          aria-describedby="button-addon1"
                          value={
                            modelObject.position[0]
                              ? Number(modelObject.position[0]).toFixed(0)
                              : 0
                          }
                          onChange={(e) => {
                            if (!Number.isNaN(Number(e.target.value)))
                              setModelObject({
                                ...modelObject,
                                position: [
                                  e.target.value
                                    ? Number(e.target.value).toFixed(0)
                                    : 0,
                                  modelObject?.position[1] ?? 0,
                                  modelObject?.position[2] ?? 0,
                                ],
                              });
                            if (!Number.isNaN(Number(e.target.value))) {
                              onPositionChange("", [
                                e.target.value
                                  ? Number(e.target.value).toFixed(0)
                                  : 0,
                                modelObject?.position[1] ?? 0,
                                modelObject?.position[2] ?? 0,
                              ]);
                            }
                          }}
                        />
                      </div>
                      <div className="relative m-1 flex w-full flex-wrap items-stretch">
                        <button
                          className="relative flex items-center bg-[color:var(--pz-input-bg)] px-2.5 py-2 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                          type="button"
                          id="button-addon1"
                          disabled
                        >
                          Y
                        </button>
                        {/* Y is now a free number box (same as X and Z) for all
                            items — wall units can type any height instead of the
                            old min/max-only dropdown. Floor items keep Y locked
                            to the floor (disabled). */}
                        <input
                          type="text"
                          className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                          aria-label="0"
                          aria-describedby="button-addon1"
                          disabled={
                            modelObject.type === MODEL_TYPES.FLOOR_UNIT ||
                            modelObject.type ===
                              MODEL_TYPES.IN_WALL_FLOOR_UNIT
                          }
                          value={
                            modelObject.position[1]
                              ? Number(modelObject.position[1]).toFixed(0)
                              : 0
                          }
                          onChange={(e) => {
                            if (!Number.isNaN(Number(e.target.value)))
                              setModelObject({
                                ...modelObject,
                                position: [
                                  modelObject.position[0] ?? 0,
                                  e.target.value
                                    ? Number(e.target.value).toFixed(0)
                                    : 0,
                                  modelObject.position[2] ?? 0,
                                ],
                              });
                            if (!Number.isNaN(Number(e.target.value))) {
                              onPositionChange("", [
                                modelObject.position[0] ?? 0,
                                e.target.value
                                  ? Number(e.target.value).toFixed(0)
                                  : 0,
                                modelObject.position[2] ?? 0,
                              ]);
                            }
                          }}
                        />
                      </div>
                      <div className="relative m-1 flex w-full flex-wrap items-stretch">
                        <button
                          className="relative flex items-center bg-[color:var(--pz-input-bg)] px-2.5 py-2 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                          type="button"
                          id="button-addon1"
                          disabled
                        >
                          Z
                        </button>
                        <input
                          type="text"
                          className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-1 py-[0.25rem] text-xs text-center font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                          aria-label="0"
                          aria-describedby="button-addon1"
                          value={
                            modelObject.position[2]
                              ? Number(modelObject.position[2]).toFixed(0)
                              : 0
                          }
                          onChange={(e) => {
                            if (!Number.isNaN(Number(e.target.value)))
                              setModelObject({
                                ...modelObject,
                                position: [
                                  modelObject.position[0] ?? 0,
                                  modelObject.position[1] ?? 0,
                                  e.target.value
                                    ? Number(e.target.value).toFixed(0)
                                    : 0,
                                ],
                              });
                            if (!Number.isNaN(Number(e.target.value))) {
                              onPositionChange("", [
                                modelObject.position[0] ?? 0,
                                modelObject.position[1] ?? 0,
                                e.target.value
                                  ? Number(e.target.value).toFixed(0)
                                  : 0,
                              ]);
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  {/*  <div className="flex flex-col max-w-sm mb-3">
                <h6 className="mb-1 mt-0 text-sm font-semibold leading-tight text-primary dark:text-neutral-200">
                  Scale
                </h6>
                <div className="flex items-center justify-between gap-2">
                  <div className="relative m-1 flex w-full flex-wrap items-stretch">
                    <button
                      className="relative flex items-center bg-[color:var(--pz-input-bg)] px-3 py-2.5 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                      type="button"
                      id="button-addon1"
                      disabled
                    >
                      X
                    </button>
                    <input
                      type="text"
                      className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-transparent bg-clip-padding px-2 py-[0.25rem]  text-base font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                      aria-label="0"
                      aria-describedby="button-addon1"
                      value={
                        modelObject ? modelObject?.scale[0] : 1
                      }
                      onChange={(e) =>
                        console.log("Scale X onChange", e.target.value)
                      }
                    />
                  </div>
                  <div className="relative m-1 flex w-full flex-wrap items-stretch">
                    <button
                      className="relative flex items-center bg-[color:var(--pz-input-bg)] px-3 py-2.5 text-xs font-semibold uppercase leading-tight text-black dark:text-neutral-200"
                      type="button"
                      id="button-addon1"
                      disabled
                    >
                      Y
                    </button>
                    <input
                      type="text"
                      className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-2 py-[0.25rem]  text-sm font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                      aria-label="0"
                      aria-describedby="button-addon1"
                      value={
                        modelObject ? modelObject?.scale[1] : 1
                      }
                      onChange={(e) =>
                        console.log("Scale Y onChange", e.target.value)
                      }
                    />
                  </div>
                  <div className="relative m-1 flex w-full flex-wrap items-stretch">
                    <button
                      className="relative flex items-center bg-[color:var(--pz-input-bg)] px-3 py-2.5 text-xs font-semibold uppercase leading-tight text-black dark:text-neutral-200"
                      type="button"
                      id="button-addon1"
                      disabled
                    >
                      Z
                    </button>
                    <input
                      type="text"
                      className="relative m-0 -mr-0.5 block w-[1px] min-w-0 flex-auto border-neutral-300 bg-[color:var(--pz-input-bg)] bg-clip-padding px-2 py-[0.25rem]  text-sm font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                      aria-label="0"
                      aria-describedby="button-addon1"
                      value={
                        modelObject ? modelObject?.scale[2] : 1
                      }
                      onChange={(e) =>
                        console.log("Scale Z onChange", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div> */}
                  {(() => {
                    // Placement-type editor. Shown for EVERY placed GLB that
                    // has a catalog modelId — including Pazl-supplied seeded
                    // models (e.g. storage units). After a reload
                    // selectedModel.model may NOT be hydrated (blank Name), so
                    // fall back to the raw modelId and resolve the catalog row
                    // synchronously from the local cache. Changing the type
                    // patches model.type on the catalog template and live
                    // re-docks the placed instance to the new surface.
                    let m: any = selectedModel?.model || {};
                    const modelId = selectedModel?.modelId || m?._id;
                    if (!modelId) return null;
                    if (!m?._id) {
                      try {
                        const cached: any[] =
                          ModelsService.getModelsFromLocalStorage() || [];
                        const found = cached.find(
                          (x: any) => String(x._id) === String(modelId)
                        );
                        m = found || { ...m, _id: modelId };
                      } catch (_) {
                        m = { ...m, _id: modelId };
                      }
                    }
                    return (
                      <div className="flex flex-col max-w-sm mb-2">
                        <h6 className="text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                          Placement type
                        </h6>
                        <select
                          className="mt-1 block w-full border rounded px-2 py-1 text-xs bg-[color:var(--pz-input-bg)] dark:bg-neutral-800 dark:text-white"
                          value={Number(m?.type ?? modelObject.type) || 1}
                          disabled={savingType}
                          onChange={async (e) => {
                            const newType = Number(e.target.value);
                            const prevType =
                              Number(m?.type ?? modelObject.type) || 1;
                            if (newType === prevType) return;
                            setSavingType(true);
                            setTypeSaveMessage(null);
                            try {
                              // 1. Persist the new placement type on the
                              //    catalog template. This affects ALL future
                              //    placements of this model AND the Explore
                              //    panel's wall/floor filter, which keys off
                              //    model.type (isOnlyWallItems / isOnlyFloorItems).
                              await ModelsService.patchModel(m._id, {
                                type: newType,
                              });

                              // 2. Refresh the local model cache so Explore
                              //    and the re-add below both read the new type.
                              try {
                                const resp =
                                  await ModelsService.getAllModels();
                                const data: any =
                                  (resp as any)?.data ?? resp;
                                if (Array.isArray(data) && data.length) {
                                  ModelsService.saveModelsToLocalStorage(
                                    data
                                  );
                                }
                              } catch (_) {
                                /* cache refresh non-fatal */
                              }

                              // 3. Live re-dock the placed instance to the new
                              //    surface. Remove the current placement, then
                              //    re-add through the standard add flow with the
                              //    updated type — addFloorItem / addWallItems
                              //    docks it to the correct surface (floor /
                              //    nearest wall / embedded). The old object is
                              //    gone and a fresh one is created, so we close
                              //    this (now-stale) panel afterwards.
                              const furnishedId = selectedModel?._id;
                              const updatedModel = { ...m, type: newType };
                              if (furnishedId) {
                                await BlueprintInterface.ProjectManagerService.removeFurnishedModel(
                                  furnishedId
                                );
                              }
                              handleAddItemsToScene(updatedModel);

                              setTypeSaveMessage(
                                `Re-docked as "${placementTypeLabel(
                                  newType
                                )}".`
                              );
                              onHideObjectPanel();
                            } catch (err: any) {
                              setTypeSaveMessage(
                                err?.message ||
                                  "Failed to change placement type."
                              );
                            } finally {
                              setSavingType(false);
                            }
                          }}
                        >
                          {/* A model saved with a placement type that has since
                              been retired still needs an <option> matching its
                              value, or the <select> renders BLANK. Show it as
                              disabled: the user sees what it really is and can
                              move it to a current type, but cannot pick it. */}
                          {isRetiredPlacementType(
                            Number(m?.type ?? modelObject.type)
                          ) && (
                            <option
                              value={Number(m?.type ?? modelObject.type)}
                              disabled
                            >
                              {placementTypeLabel(
                                Number(m?.type ?? modelObject.type)
                              )}{" "}
                              (no longer available)
                            </option>
                          )}
                          {PLACEMENT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label} — {o.hint}
                            </option>
                          ))}
                        </select>
                        {typeSaveMessage && (
                          <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                            {typeSaveMessage}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {modelObject.type != MODEL_TYPES.WALL_UNIT &&
                  modelObject.type != MODEL_TYPES.IN_WALL_UNIT &&
                  modelObject.type != MODEL_TYPES.IN_WALL_FLOOR_UNIT ? (
                    <div className="flex flex-col max-w-sm mb-2">
                      <h6 className="text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                        Rotate
                      </h6>
                      <div className="flex items-center justify-between gap-[2px]">
                        <div className="flex flex-row items-center gap-2">
                          <button
                            className="relative min-h-[auto] rounded border border-[color:var(--pz-panel-border)] flex items-center px-1.5 py-1.5 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                            type="button"
                            id="rotateRight"
                            data-te-toggle="tooltip"
                            data-te-placement="top"
                            data-te-ripple-init
                            data-te-ripple-color="light"
                            title="Rotate 90° Right"
                            onClick={() => {
                              onRotationChange(ROTATION_MODES.ROTATE_RIGHT);
                            }}
                          >
                            <img
                              src={require("/public/assets/icons/rotate_90_degrees_right.svg")}
                              alt="rotateRight"
                              className="h-[18px] w-[18px]"
                            />
                          </button>
                          <button
                            className="relative min-h-[auto] rounded border border-[color:var(--pz-panel-border)] flex items-center px-1.5 py-1.5 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                            type="button"
                            id="rotateLeft"
                            data-te-toggle="tooltip"
                            data-te-placement="top"
                            data-te-ripple-init
                            data-te-ripple-color="light"
                            title="Rotate 90° Left"
                            onClick={() => {
                              onRotationChange(ROTATION_MODES.ROTATE_LEFT);
                            }}
                          >
                            <img
                              src={require("/public/assets/icons/rotate_90_degrees_left.svg")}
                              alt="rotateLeft"
                              className="h-[18px] w-[18px]"
                            />
                          </button>
                          <div className="flex flex-row items-center">
                            <button
                              className="relative min-h-[auto] rounded-l flex items-center bg-[color:var(--pz-input-bg)] px-1.5 py-1.5 text-xs font-medium uppercase leading-tight text-black dark:text-neutral-200"
                              type="button"
                              id="angleImage"
                              disabled
                            >
                              <img
                                src={require("/public/assets/icons/angle.svg")}
                                alt="angleImage"
                                className="h-[18px] w-[18px]"
                              />
                            </button>
                            <input
                              type="text"
                              id="angleFormControlInput"
                              placeholder=""
                              className="peer block h-[30px] min-h-[auto] w-[116px] text-right bg-[color:var(--pz-input-bg)] m-l-1 bg-clip-padding px-2 py-[0.25rem]  text-xs font-normal leading-[1.6] text-neutral-700 outline-none transition duration-200 ease-in-out focus:z-[3] focus:border-primary focus:text-neutral-700 focus:shadow-[inset_0_0_0_1px_rgb(59,113,202)] focus:outline-none dark:border-neutral-600 dark:text-neutral-200 dark:placeholder:text-neutral-200 dark:focus:border-primary"
                              value={`${
                                modelObject.rotation[1]
                                  ? modelObject.rotation[1]
                                  : 0
                              }°`}
                              onChange={(e) => {
                                const angle = e.target.value.replace("°", "");
                                setModelObject({
                                  ...modelObject,
                                  rotation: [
                                    modelObject.rotation[0] ?? 0,
                                    angle ? Number(angle) : 0,
                                    modelObject.rotation[2] ?? 0,
                                  ],
                                });
                                if (!Number.isNaN(Number(angle))) {
                                  if (angle && Number(angle) === 0) {
                                    onRotationChange(ROTATION_MODES.RESET);
                                  } else if (angle && Number(angle) < 0) {
                                    onRotationChange(
                                      ROTATION_MODES.ROTATE_LEFT,
                                      Number(angle)
                                    );
                                  } else if (angle && Number(angle) > 0) {
                                    onRotationChange(
                                      ROTATION_MODES.ROTATE_RIGHT,
                                      Number(angle)
                                    );
                                  }
                                }
                              }}
                              onKeyUp={(e) => {
                                if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  handleKeyPress(1); // Increase value
                                } else if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  handleKeyPress(-1); // Decrease value
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                } else if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                }
                              }}
                              /* onBlur={(e) => {
                              const angle = e.target.value.replace("°", "");
                              if (!Number.isNaN(Number(angle))) {
                                if (angle && Number(angle) === 0) {
                                  onRotationChange(ROTATION_MODES.RESET);
                                } else if (angle && Number(angle) < 0) {
                                  onRotationChange(
                                    ROTATION_MODES.ROTATE_LEFT,
                                    Number(angle)
                                  );
                                } else if (angle && Number(angle) > 0) {
                                  onRotationChange(
                                    ROTATION_MODES.ROTATE_RIGHT,
                                    Number(angle)
                                  );
                                }
                              }
                            }} */
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {/* Kitchen backsplash — shown ONLY for models in the
                      "Below Counter Storage" category (resolved from the model's
                      categoryId). Falls back to a name check if the category
                      cache isn't loaded yet. Adds a textured panel on the wall
                      behind the cabinet, from the worktop up. */}
                  {(() => {
                    const bsName = String(modelObject?.name || "").toLowerCase();
                    const catId = selectedModel?.model?.categoryId;
                    const cat = bsCategories.find(
                      (c: any) => c?._id === catId
                    );
                    let catName = String(cat?.name || "").toLowerCase();
                    if (cat?.parentCategoryId) {
                      const parent = bsCategories.find(
                        (c: any) => c?._id === cat.parentCategoryId
                      );
                      if (parent?.name)
                        catName += " " + String(parent.name).toLowerCase();
                    }
                    const isBelowCounter = bsCategories.length
                      ? catName.includes("below counter")
                      : bsName.includes("below counter") ||
                        bsName.startsWith("bc ") ||
                        /\bbc\b/.test(bsName);
                    if (!isBelowCounter) return null;
                    return (
                      <div className="flex flex-col max-w-sm mt-3 mb-2 border-t border-[color:var(--pz-panel-border)] pt-3">
                        <div className="flex items-center justify-between">
                          <h6 className="text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                            Backsplash
                          </h6>
                          <label className="inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={bsOn}
                              onChange={(e) => {
                                const on = e.target.checked;
                                setBsOn(on);
                                applyBacksplash({ on });
                              }}
                            />
                            <div className="relative w-9 h-5 bg-neutral-300 rounded-full peer peer-checked:bg-primary peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all dark:bg-neutral-600"></div>
                          </label>
                        </div>
                        <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                          A panel on the wall behind this cabinet, from the
                          worktop up.
                        </p>
                        {bsOn ? (
                          <div className="mt-2 flex flex-col gap-3">
                            {/* Attach to which wall */}
                            <div>
                              <label className="text-[11px] text-neutral-600 dark:text-neutral-300">
                                Attach to
                              </label>
                              <select
                                value={bsAttach}
                                className="mt-1 block w-full h-[30px] text-xs bg-[color:var(--pz-input-bg)] px-2 rounded text-neutral-700 dark:text-neutral-200 outline-none"
                                onChange={(e) => {
                                  const a = e.target.value as
                                    | "auto"
                                    | "left"
                                    | "right";
                                  setBsAttach(a);
                                  applyBacksplash({ on: true, attach: a });
                                }}
                              >
                                <option value="auto">Back wall (auto)</option>
                                <option value="left">Left wall</option>
                                <option value="right">Right wall</option>
                              </select>
                            </div>

                            {/* Height above worktop */}
                            <div>
                              <label className="text-[11px] text-neutral-600 dark:text-neutral-300">
                                Height above worktop: {bsHeight} mm
                              </label>
                              <input
                                type="range"
                                min={150}
                                max={900}
                                step={10}
                                value={bsHeight}
                                className="w-full accent-[color:var(--pz-primary,#0F6E56)]"
                                onChange={(e) => {
                                  const h = Number(e.target.value);
                                  setBsHeight(h);
                                  applyBacksplash({ on: true, height: h });
                                }}
                              />
                              <div className="flex justify-between text-[9px] text-neutral-400">
                                <span>150</span>
                                <span>900</span>
                              </div>
                            </div>

                            {/* Material swatch */}
                            <div>
                              <label className="text-[11px] text-neutral-600 dark:text-neutral-300">
                                Material
                              </label>
                              <button
                                type="button"
                                className="mt-1 flex items-center gap-2 w-full h-[34px] px-2 rounded border border-[color:var(--pz-panel-border)] bg-[color:var(--pz-input-bg)]"
                                onClick={() =>
                                  setShowBsMaterials((s) => !s)
                                }
                              >
                                <span
                                  className="h-5 w-5 rounded border border-neutral-300 bg-cover bg-center shrink-0"
                                  style={{
                                    backgroundImage: bsMaterialUrl
                                      ? `url(${bsMaterialUrl})`
                                      : undefined,
                                    backgroundColor: bsMaterialUrl
                                      ? undefined
                                      : "#e8e4dc",
                                  }}
                                />
                                <span className="text-xs text-neutral-700 dark:text-neutral-200 truncate">
                                  {bsMaterialName}
                                </span>
                                <span className="ml-auto text-[10px] text-neutral-400">
                                  {showBsMaterials ? "▲" : "▼"}
                                </span>
                              </button>
                              {showBsMaterials ? (
                                <div className="mt-2 grid grid-cols-4 gap-2 max-h-[168px] overflow-y-auto p-1 rounded bg-[color:var(--pz-input-bg)]">
                                  {/* Default (plain cream) */}
                                  <button
                                    type="button"
                                    title="Default"
                                    className={`h-12 w-full rounded border ${
                                      !bsMaterialUrl
                                        ? "border-primary border-2"
                                        : "border-neutral-300"
                                    }`}
                                    style={{ backgroundColor: "#e8e4dc" }}
                                    onClick={() => {
                                      setBsMaterialUrl(null);
                                      setBsMaterialName("Default");
                                      setShowBsMaterials(false);
                                      applyBacksplash({
                                        on: true,
                                        materialUrl: null,
                                        finishingCategoryId: null,
                                      });
                                    }}
                                  />
                                  {bsMaterials.map((m: any) => {
                                    const url = m?.texture?.fileUrl;
                                    const selected = url === bsMaterialUrl;
                                    return (
                                      <button
                                        key={m._id || url}
                                        type="button"
                                        title={m?.name}
                                        className={`h-12 w-full rounded border bg-cover bg-center ${
                                          selected
                                            ? "border-primary border-2"
                                            : "border-neutral-300"
                                        }`}
                                        style={{
                                          backgroundImage: `url(${url})`,
                                        }}
                                        onClick={() => {
                                          setBsMaterialUrl(url);
                                          setBsMaterialName(m?.name || "Custom");
                                          setShowBsMaterials(false);
                                          applyBacksplash({
                                            on: true,
                                            materialUrl: url,
                                            finishingCategoryId:
                                              m?.categoryId ?? null,
                                          });
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </form>
              </div>
            </div>
          ) : null}
          <ObjectComponents
            isDarkMode={isDarkMode}
            selectedModel={selectedModel}
            onHideObjectPanel={onHideObjectPanel}
            isMultiSelectMode={isMultiSelectMode}
          />
        </div>
      ) : null}
      <Drawing2DModal
        show={show2DDrawing}
        onClose={() => setShow2DDrawing(false)}
        selectedModel={selectedModel}
      />
    </>
  );
}

export default ObjectProperties;
