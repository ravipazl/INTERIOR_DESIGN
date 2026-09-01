import React, { useState } from "react";
import {
  capitalizeText,
  convertToSentenceCase,
  convertToTitleCase,
} from "@pazl/utils/genericFunctions";
import { Finishing_Types } from "./objectComponents";
import { TERipple } from "tw-elements-react";
import { SketchPicker } from "react-color";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";
import BlueprintInterface from "@pazl/blueprint-interface";
import Component from "./component";
import { Category } from "@pazl/entities/Category";
import "../index.css";

interface ComponentsGroupProps {
  componentProps: any;
  coreMaterialBrands: any[];
  coreMaterialTypeList?: any[];
  groupedModelComponents: any[];
  selectedComponentGroup: any;
  handleNodeSelection: (componentGroup: any) => Promise<void>;
  handleChildNodeSelection: (component: any) => Promise<void>;
  handleNodeHover: (componentGroup: any) => void;
  handleNodeHoverEnd: () => void;
  finishingCategories: any[];
  setShowCoreMaterialsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowObjectComponentsModal: React.Dispatch<React.SetStateAction<boolean>>;
  selectedFinishingType: string;
  handleFinishingTypeSelection: (type: string) => void;
  getExternalFinishingImage: () => string;
  getInternalFinishingImage: () => string;
  componentAdditionalProps: any[];
  isEdgeBandPropAvailable: boolean;
  isEdgeBandExpanded: boolean;
  setIsEdgeBandExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setComponentAdditionalProps: React.Dispatch<React.SetStateAction<any[]>>;
  toggleColorPicker: (index: number) => void;
  colorPickerVisible: boolean;
  handleColorChange: (color: any) => void;
  selectedChildComponent: FurnishedModelComponent | null;
  getComponentExternalFinishingImage: () => string;
  getComponentInternalFinishingImage: () => string;
  handleShutterVisible: (visible: boolean) => Promise<void>;
  selectedHandleType: Category | null;
  handleTypes: Category[];
  handleSelectedHandleType: (typeName: string) => Promise<void>;
  handleExposureChange: (
    isExposed: boolean,
    furnishedModelComponentId: string
  ) => Promise<void>;
  isMultiSelectMode: boolean;
  showLoader: boolean;
}

const ComponentsGroup = ({
  componentProps,
  coreMaterialBrands,
  coreMaterialTypeList,
  groupedModelComponents,
  selectedComponentGroup,
  handleNodeSelection,
  handleChildNodeSelection,
  handleNodeHover,
  handleNodeHoverEnd,
  finishingCategories,
  setShowCoreMaterialsModal,
  setShowObjectComponentsModal,
  selectedFinishingType,
  handleFinishingTypeSelection,
  getExternalFinishingImage,
  getInternalFinishingImage,
  componentAdditionalProps,
  isEdgeBandPropAvailable,
  isEdgeBandExpanded,
  setIsEdgeBandExpanded,
  setComponentAdditionalProps,
  toggleColorPicker,
  colorPickerVisible,
  handleColorChange,
  selectedChildComponent,
  getComponentExternalFinishingImage,
  getComponentInternalFinishingImage,
  handleShutterVisible,
  selectedHandleType,
  handleTypes,
  handleSelectedHandleType,
  handleExposureChange,
  isMultiSelectMode,
  showLoader,
  onBulkRename,
  onRemoveFromGroup,
  onUngroupGroup,
}: ComponentsGroupProps & {
  onBulkRename?: (componentIds: string[], partName: string) => void;
  onRemoveFromGroup?: (comp: any) => void;
  onUngroupGroup?: (group: any) => void;
}) => {
  const [selectedExteriorMaterial, setSelectedExteriorMaterial] = useState<{
    [key: number]: boolean;
  }>({});
  const [selectedInteriorMaterial, setSelectedInteriorMaterial] = useState<{
    [key: number]: boolean;
  }>({});
  // Combined view: the per-mesh sub-rows are HIDDEN by default (editing the
  // group applies to all its meshes). Toggle on to fine-tune a single mesh.
  const [showIndividualParts, setShowIndividualParts] = useState(false);
  // "Group parts by name": tick the rows below (a checkbox on each row), give
  // them ONE part name → they combine into that group. No duplicate mesh list —
  // the checkbox lives on the row where the part already shows.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkName, setBulkName] = useState("");
  // In-panel name search for the group box — the combine names you create show
  // in a dropdown here so you reuse the SAME spelling (no mismatch).
  const [bulkNameFocused, setBulkNameFocused] = useState(false);
  // ONLY the combine names actually created in this item (the current groups) —
  // no static/hardcoded names. Raw mesh names (Mesh 0…) are excluded since those
  // aren't real group names.
  const nameSuggestions = (): string[] =>
    Array.from(
      new Set(
        (groupedModelComponents || [])
          .map((g: any) => String(g?.name || "").trim())
          .filter((n: string) => n && !/^mesh[\s_]*\d+$/i.test(n))
      )
    );
  const groupIds = (g: any): string[] =>
    (g?.components || []).map((c: any) => String(c?._id));
  // Show "Ungroup" when a group is a real combine (>1 part) OR a single mesh that
  // was RENAMED (name != its meshName, e.g. Shutter/Handle/Carcass with 1 part) —
  // so a renamed single mesh can be reverted back to its plain "Mesh N" name too.
  const canUngroup = (g: any): boolean => {
    const comps = g?.components || [];
    if (comps.length > 1) return true;
    if (comps.length === 1) {
      const c = comps[0];
      const mn = c?.meshName ? String(c.meshName) : "";
      return !!mn && String(c?.name) !== mn;
    }
    return false;
  };
  const isGroupChecked = (g: any): boolean => {
    const ids = groupIds(g);
    return ids.length > 0 && ids.every((id) => bulkSelected.has(id));
  };
  const toggleBulkGroup = (g: any) => {
    const ids = groupIds(g);
    setBulkSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
    try {
      const meshNames = (g?.components || [])
        .map((c: any) => c?.meshName || c?.name)
        .filter(Boolean);
      if (meshNames.length) BlueprintInterface.highlightMeshes(meshNames);
    } catch (e) {
      /* highlight is best-effort */
    }
  };
  const applyBulkRename = () => {
    const name = bulkName.trim();
    if (!name || bulkSelected.size === 0 || !onBulkRename) return;
    onBulkRename(Array.from(bulkSelected), name);
    setBulkSelected(new Set());
    setBulkName("");
  };

  const handleExteriorMaterialSelection = (groupIndex: number) => {
    setSelectedExteriorMaterial((prevState) => ({
      ...prevState,
      [groupIndex]: !prevState[groupIndex],
    }));
    handleFinishingTypeSelection(Finishing_Types.EXTERIOR);
  };

  const handleInteriorMaterialSelection = (groupIndex: number) => {
    setSelectedInteriorMaterial((prevState) => ({
      ...prevState,
      [groupIndex]: !prevState[groupIndex],
    }));
    handleFinishingTypeSelection(Finishing_Types.INTERIOR);
  };

  const externalStyle =
    selectedComponentGroup?.externalFinishFinishing ??
    selectedComponentGroup?.components[0]?.externalFinishFinishing;
  const internalStyle =
    selectedComponentGroup?.internalFinishFinishing ??
    selectedComponentGroup?.components[0]?.internalFinishFinishing;
  const externalType =
    finishingCategories?.find(
      (finishingCategory: any) =>
        finishingCategory._id === externalStyle?.categoryId
    ) ??
    finishingCategories?.find(
      (finishingCategory: any) =>
        finishingCategory._id === externalStyle?.category?.parentCategoryId
    );
  const internalType =
    finishingCategories?.find(
      (finishingCategory: any) =>
        finishingCategory._id === internalStyle?.categoryId
    ) ??
    finishingCategories?.find(
      (finishingCategory: any) =>
        finishingCategory._id === internalStyle?.category?.parentCategoryId
    );
  const externalFinishGrainDirection =
    selectedComponentGroup?.externalFinishGrainDirection ??
    selectedComponentGroup?.components[0]?.externalFinishGrainDirection;
  const internalFinishGrainDirection =
    selectedComponentGroup?.internalFinishGrainDirection ??
    selectedComponentGroup?.components[0]?.internalFinishGrainDirection;
  const externalFinishBrand =
    selectedComponentGroup?.externalFinishBrand ??
    selectedComponentGroup?.components[0]?.externalFinishBrand;
  const internalFinishBrand =
    selectedComponentGroup?.internalFinishBrand ??
    selectedComponentGroup?.components[0]?.internalFinishBrand;
  // Was: hide Core Material / Exterior / Interior / Exposed for handles (they
  // are hardware). The user wants those options on the handle too, so show them
  // for EVERY part now (handles included). The "Choose handle design" picker is
  // gated separately (name === "handle"), so it still appears only for handles.
  const notHandleComponent = (_comp: any) => true;

  return (
    <>
      <h5 className="p-1 bg-[#E9E5EC] dark:bg-[#333333] text-l text-center font-medium leading-tight text-neutral-800 dark:text-neutral-50">
        {isMultiSelectMode ? "Common " : ""}Components
      </h5>
      <div
        className="pl-2 pr-2 pt-2"
        style={{ paddingBottom: "16px" }}
        id="containerTop"
      >
        {/* GROUP PARTS BY NAME — a compact bar. Tick the rows below (checkbox on
            each row), type a part name, Apply → the ticked parts combine into
            that group. No duplicate mesh list. */}
        {!isMultiSelectMode &&
        onBulkRename &&
        (groupedModelComponents?.length ?? 0) > 1 ? (
          <div className="mb-2 flex items-center gap-2 bg-[#f2f4f7] dark:bg-[#2b2b2b] border border-[#e3e8ee] dark:border-[#444] rounded-lg px-2 py-1.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={bulkName}
                onChange={(e) => setBulkName(e.target.value)}
                onFocus={() => setBulkNameFocused(true)}
                onBlur={() => setTimeout(() => setBulkNameFocused(false), 150)}
                placeholder="Group ticked parts as… e.g. Carcass"
                className="w-full text-[11px] px-1.5 py-1 border border-gray-300 rounded text-[#414063] dark:bg-neutral-800 dark:text-neutral-50"
              />
              {/* In-panel dropdown of the combine names (created + common) —
                  filters as you type. Click one to reuse the exact spelling. */}
              {bulkNameFocused
                ? (() => {
                    const q = bulkName.trim().toLowerCase();
                    const list = nameSuggestions().filter((n) =>
                      q ? n.toLowerCase().includes(q) : true
                    );
                    if (!list.length) return null;
                    return (
                      <div className="absolute left-0 right-0 top-full mt-1 z-[60] max-h-40 overflow-y-auto bg-white dark:bg-neutral-800 border border-[#e3e8ee] dark:border-[#444] rounded-lg shadow-lg">
                        {list.map((name) => (
                          <div
                            key={name}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setBulkName(name);
                              setBulkNameFocused(false);
                            }}
                            className="px-2 py-1.5 text-[11px] text-[#414063] dark:text-neutral-50 hover:bg-[#f2f4f7] dark:hover:bg-[#333] cursor-pointer"
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    );
                  })()
                : null}
            </div>
            <button
              type="button"
              onClick={applyBulkRename}
              disabled={!bulkName.trim() || bulkSelected.size === 0}
              className="text-[11px] font-semibold text-white bg-[#26215C] rounded px-3 py-1 disabled:opacity-40 whitespace-nowrap"
            >
              Apply ({bulkSelected.size})
            </button>
          </div>
        ) : null}
        {groupedModelComponents?.length ? (
          groupedModelComponents.map((compGroup: any, groupIndex: number) => (
            <div
              key={groupIndex}
              className="font-semibold text-xs text-neutral-800 dark:text-neutral-50"
            >
              <div
                className="flex align-center items-center"
                onMouseEnter={() => handleNodeHover(compGroup)}
                onMouseLeave={() => handleNodeHoverEnd()}
              >
                {/* Row checkbox — tick rows that belong together, then use the
                    "Group ticked parts as…" bar at the top to combine them. */}
                {!isMultiSelectMode && onBulkRename ? (
                  <input
                    type="checkbox"
                    className="mr-1.5 cursor-pointer"
                    title="Select to group this part"
                    checked={isGroupChecked(compGroup)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleBulkGroup(compGroup)}
                  />
                ) : null}
                <div
                  onClick={(e) => {
                    handleNodeSelection(compGroup);
                  }}
                  className={`${
                    selectedComponentGroup?.name === compGroup.name
                      ? "bg-no-repeat bg-contain w-[18px] h-[18px] cursor-pointer down-arrow"
                      : "bg-no-repeat bg-contain w-[18px] h-[18px] cursor-pointer next-arrow"
                  }`}
                />
                <span
                  className="font-normal cursor-pointer text-sm py-1 text-primary dark:text-neutral-50"
                  onClick={(e) => {
                    handleNodeSelection(compGroup);
                  }}
                >
                  {convertToTitleCase(compGroup.name)}
                </span>
                {/* "N parts" badge — how many meshes this group combines, so the
                    count is visible without listing every mesh. */}
                {(compGroup?.components?.length ?? 0) > 1 ? (
                  <span className="ml-auto text-[10px] font-semibold text-[#414063] dark:text-neutral-300 bg-[#f2f4f7] dark:bg-[#333] border border-[#e3e8ee] dark:border-[#444] rounded-full px-2 py-0.5">
                    {compGroup.components.length} parts
                  </span>
                ) : null}
                {/* Ungroup — undo the combine: parts split back into their own
                    mesh rows. Shown for real combines (>1 part) AND for a single
                    RENAMED mesh (Shutter/Handle/Carcass) to revert its name. */}
                {onUngroupGroup && canUngroup(compGroup) ? (
                  <button
                    type="button"
                    title="Ungroup — revert to the plain mesh name(s)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUngroupGroup(compGroup);
                    }}
                    className={`${
                      (compGroup?.components?.length ?? 0) > 1
                        ? "ml-1.5"
                        : "ml-auto"
                    } flex items-center gap-0.5 text-[10px] font-semibold text-[#b42318] hover:bg-[#fee4e2] border border-[#f4c7c2] rounded-full px-2 py-0.5`}
                  >
                    <span className="material-symbols-outlined text-[12px] leading-none">
                      call_split
                    </span>
                    Ungroup
                  </button>
                ) : null}
              </div>
              {selectedComponentGroup?.name === compGroup.name && (
                <ul className="border-l border-l-gray-400 ml-2.5">
                  {/* Part name — naming a part "Shutter", "Side panel", "Leg" …
                      is what lets the app group Carcass / Shutter and lets the
                      BOQ + working drawing tell them apart. The 3D mesh identity
                      is stored separately (meshName), so renaming never affects
                      materials. */}
                  <li className="pr-4 pb-2.5 pl-2">
                    <div className="text-xs font-semibold text-[#414063]">
                      -- Part name
                    </div>
                    <input
                      type="text"
                      defaultValue={compGroup.name}
                      placeholder="e.g. Shutter, Side panel, Leg"
                      title="Name this part by its role so it groups under Carcass / Shutter"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={async (e) => {
                        const next = e.target.value.trim();
                        if (!next || next === compGroup.name) return;
                        try {
                          const pm: any = (BlueprintInterface as any)
                            ?.ProjectManagerService;
                          for (const c of compGroup?.components || []) {
                            await pm?.updateFurnishedModelComponentName(
                              (c as any)?._id,
                              next
                            );
                          }
                        } catch (err) {
                          console.error(
                            "componentsGroup.tsx ~ rename part failed",
                            err
                          );
                        }
                      }}
                      className="mt-1 w-full text-[11px] font-normal px-1.5 py-1 border border-gray-300 rounded text-[#414063] dark:bg-neutral-800 dark:text-neutral-50"
                    />
                  </li>
                  {notHandleComponent(compGroup) ? (
                    <>
                      <li
                        className="pr-4 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]"
                        onClick={() => {
                          setShowCoreMaterialsModal(true);
                          setShowObjectComponentsModal(false);
                        }}
                      >
                        -- Core Material
                        <div className="flex">
                          <p className="text-[10px] pt-1 font-normal text-[#414063] pl-2">
                            {capitalizeText(
                              selectedComponentGroup?.components?.[0]
                                ?.coreMaterialType?.type ||
                                coreMaterialTypeList?.[0]?.type ||
                                ""
                            )}
                          </p>
                          <p className="text-[10px] pt-1 pl-1">|</p>
                          <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                            {capitalizeText(
                              selectedComponentGroup?.components?.[0]
                                ?.coreMaterialBrand?.name ||
                                coreMaterialBrands?.[0]?.name ||
                                ""
                            )}
                          </p>
                          <p className="text-[10px] pt-1 pl-1">|</p>
                          <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                            {capitalizeText(
                              selectedComponentGroup?.components?.[0]
                                ?.coreMaterialGrade ||
                                coreMaterialTypeList?.[0]?.grades?.[0] ||
                                ""
                            )}
                          </p>
                        </div>
                      </li>
                      <li>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                          className={`pr-4 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC] ${
                            selectedFinishingType ===
                              Finishing_Types.EXTERIOR &&
                            selectedExteriorMaterial[groupIndex]
                              ? "bg-[#E9E5EC]"
                              : ""
                          }`}
                          onClick={() =>
                            handleExteriorMaterialSelection(groupIndex)
                          }
                        >
                          <div>
                            <span>-- Exterior</span>
                            <div className="flex">
                              {externalType ? (
                                <p className="text-[10px] pt-1 font-normal text-[#414063] pl-2">
                                  {capitalizeText(externalType.name)}
                                </p>
                              ) : null}
                              {externalStyle ? (
                                <>
                                  <p className="text-[10px] pt-1 pl-1">|</p>
                                  <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                                    {capitalizeText(externalStyle.name)}
                                  </p>
                                </>
                              ) : null}
                              {externalFinishBrand ? (
                                <>
                                  <p className="text-[10px] pt-1 pl-1">|</p>
                                  <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                                    {capitalizeText(externalFinishBrand.name)}
                                  </p>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <img
                              src={getExternalFinishingImage()}
                              height={32}
                              width={32}
                            />
                          </div>
                        </div>
                      </li>
                      <li>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                          className={`pr-4 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC] ${
                            selectedFinishingType ===
                              Finishing_Types.INTERIOR &&
                            selectedInteriorMaterial[groupIndex]
                              ? "bg-[#E9E5EC]"
                              : ""
                          }`}
                          onClick={() => {
                            handleInteriorMaterialSelection(groupIndex);
                          }}
                        >
                          <div>
                            <span>-- Interior</span>
                            <div className="flex">
                              {internalType ? (
                                <p className="text-[10px] pt-1 font-normal text-[#414063] pl-2">
                                  {capitalizeText(internalType.name)}
                                </p>
                              ) : null}
                              <p className="text-[10px] pt-1 pl-1">|</p>
                              {internalStyle ? (
                                <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                                  {capitalizeText(internalStyle.name)}
                                </p>
                              ) : null}
                              <p className="text-[10px] pt-1 pl-1">|</p>
                              {internalFinishBrand ? (
                                <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                                  {capitalizeText(internalFinishBrand.name)}
                                </p>
                              ) : null}
                              <p className="text-[10px] pt-1 pl-1">|</p>
                              {internalFinishGrainDirection ? (
                                <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                                  {capitalizeText(internalFinishGrainDirection)}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <img
                              src={getInternalFinishingImage()}
                              height={32}
                              width={32}
                            />
                          </div>
                        </div>
                      </li>
                    </>
                  ) : null}
                  {/* Unexposed moved up to the group: for single-part groups the
                      redundant inner part is hidden, so its exposure toggle
                      lives here instead. */}
                  {notHandleComponent(compGroup) &&
                  selectedComponentGroup?.components?.length === 1 &&
                  selectedComponentGroup?.components?.[0] ? (
                    <li>
                      <div className="flex items-center">
                        <span className="pr-2 pt-1 pb-2.5 text-xs font-semibold text-[#414063]">
                          {`-- ${
                            selectedComponentGroup.components[0].exposed
                              ? "Exposed"
                              : "Unexposed"
                          }`}
                        </span>
                        <TERipple rippleColor="Secondary">
                          <button
                            className={`rounded ${
                              selectedComponentGroup.components[0].exposed
                                ? "snap-icon"
                                : ""
                            }`}
                            onClick={() =>
                              handleExposureChange(
                                selectedComponentGroup.components[0].exposed,
                                selectedComponentGroup.components[0]._id
                              )
                            }
                          >
                            <span className="material-symbols-outlined">
                              {selectedComponentGroup.components[0].exposed
                                ? "toggle_on"
                                : "toggle_off"}
                            </span>
                          </button>
                        </TERipple>
                      </div>
                    </li>
                  ) : null}
                  {selectedComponentGroup?.name?.toLowerCase() === "shutter" ? (
                    <li>
                      <div className="flex items-center">
                        <span className="pr-2 pt-1 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]">
                          {`-- ${
                            selectedComponentGroup?.components[0]?.visible
                              ? "Hide"
                              : "Show"
                          }`}
                        </span>
                        <TERipple rippleColor="Secondary">
                          <button
                            className={`rounded`}
                            onClick={() => {
                              handleShutterVisible(
                                !selectedComponentGroup?.components[0]?.visible
                              );
                            }}
                          >
                            <span className="material-symbols-outlined">
                              {selectedComponentGroup?.components[0]?.visible
                                ? "visibility_off"
                                : "visibility"}
                            </span>
                          </button>
                        </TERipple>
                      </div>
                    </li>
                  ) : null}
                  {selectedComponentGroup?.name?.toLowerCase() === "handle" &&
                  selectedHandleType ? (
                    <li>
                      <div className="flex items-center">
                        <span className="pr-2 pt-1 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]">
                          -- Handle Types
                        </span>
                        <div>
                          <select
                            id="dropdown"
                            value={selectedHandleType.name}
                            onChange={(e) => {
                              handleSelectedHandleType(e.target.value);
                            }}
                            className="type-pattern-dropdown bg-[#ffffff] cursor-pointer w-[140px] h-[28px] pl-1"
                          >
                            {handleTypes?.map((handleType: Category) => (
                              <option
                                key={handleType._id}
                                value={handleType.name}
                              >
                                {handleType.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </li>
                  ) : null}
                  {notHandleComponent(compGroup) ? (
                    <>
                      {componentAdditionalProps.map(
                        (componentProp: any, index: number) => {
                          return (
                            <li key={index}>
                              {Object.entries(componentProp).map(
                                ([key, value]) => (
                                  <>
                                    {!key.toLowerCase().includes("edge") &&
                                    !key.toLowerCase().includes("exposed") ? (
                                      <div
                                        key={key}
                                        className="flex align-center items-center py-1"
                                      >
                                        <span className="pr-4 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]">
                                          {`--${convertToSentenceCase(key)}`}
                                        </span>
                                        <input
                                          className="w-30 h-6 border text-xs p-0 pl-1"
                                          value={value as any}
                                          onChange={(e) => {
                                            let val = e.target.value.includes(
                                              ","
                                            )
                                              ? e.target.value.split(",")
                                              : e.target.value;
                                            setComponentAdditionalProps(
                                              (prev: any) =>
                                                prev.map(
                                                  (
                                                    prevComponent: any,
                                                    i: number
                                                  ) =>
                                                    i === index
                                                      ? {
                                                          ...prevComponent,
                                                          [key]: val,
                                                        }
                                                      : prevComponent
                                                )
                                            );
                                          }}
                                        />
                                      </div>
                                    ) : null}
                                  </>
                                )
                              )}
                            </li>
                          );
                        }
                      )}
                    </>
                  ) : null}
                  {/* Advanced: reveal the individual meshes only when asked.
                      Editing the group above already applies to all of them. */}
                  {!isMultiSelectMode &&
                  (selectedComponentGroup?.components?.length ?? 0) > 1 ? (
                    <li className="pl-2 pb-1">
                      <label className="flex items-center gap-2 text-[11px] text-[#7b8794] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="cursor-pointer"
                          checked={showIndividualParts}
                          onChange={(e) =>
                            setShowIndividualParts(e.target.checked)
                          }
                        />
                        Show individual parts ({selectedComponentGroup.components.length})
                      </label>
                    </li>
                  ) : null}
                  {!isMultiSelectMode &&
                  showIndividualParts &&
                  (selectedComponentGroup?.components?.length ?? 0) > 1 ? (
                    <li>
                      {selectedComponentGroup?.components?.map(
                        (comp: FurnishedModelComponent, index: number) => {
                          if (notHandleComponent(comp)) {
                            return (
                              <Component
                                key={index}
                                comp={comp}
                                selectedChildComponent={selectedChildComponent}
                                selectedComponentGroup={selectedComponentGroup}
                                handleChildNodeSelection={
                                  handleChildNodeSelection
                                }
                                setShowCoreMaterialsModal={
                                  setShowCoreMaterialsModal
                                }
                                setShowObjectComponentsModal={
                                  setShowObjectComponentsModal
                                }
                                finishingCategories={finishingCategories}
                                selectedFinishingType={selectedFinishingType}
                                handleFinishingTypeSelection={
                                  handleFinishingTypeSelection
                                }
                                getComponentExternalFinishingImage={
                                  getComponentExternalFinishingImage
                                }
                                getComponentInternalFinishingImage={
                                  getComponentInternalFinishingImage
                                }
                                componentAdditionalProps={
                                  componentAdditionalProps
                                }
                                isEdgeBandPropAvailable={
                                  isEdgeBandPropAvailable
                                }
                                isEdgeBandExpanded={isEdgeBandExpanded}
                                setIsEdgeBandExpanded={setIsEdgeBandExpanded}
                                setComponentAdditionalProps={
                                  setComponentAdditionalProps
                                }
                                toggleColorPicker={toggleColorPicker}
                                colorPickerVisible={colorPickerVisible}
                                handleColorChange={handleColorChange}
                                handleExposureChange={handleExposureChange}
                                onRemoveFromGroup={onRemoveFromGroup}
                              />
                            );
                          }
                        }
                      )}
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          ))
        ) : (
          <div className="pt-10">
            {showLoader ? (
              <span className="animate-spin object-modal-spinner" />
            ) : (
              <h6 className="text-center text-xs font-semibold leading-tight text-primary dark:text-neutral-200">
                No modifiable components
              </h6>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default ComponentsGroup;
