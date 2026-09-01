import {
  capitalizeText,
  convertToSentenceCase,
  convertToTitleCase,
} from "@pazl/utils/genericFunctions";
import React from "react";
import { Finishing_Types } from "./objectComponents";
import { TERipple } from "tw-elements-react";
import { SketchPicker } from "react-color";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";
import BlueprintInterface from "@pazl/blueprint-interface";

interface ComponentProps {
  comp: FurnishedModelComponent;
  selectedComponentGroup: any;
  selectedChildComponent: FurnishedModelComponent | null;
  handleChildNodeSelection: (component: any) => Promise<void>;
  setShowCoreMaterialsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowObjectComponentsModal: React.Dispatch<React.SetStateAction<boolean>>;
  finishingCategories: any[];
  selectedFinishingType: string;
  handleFinishingTypeSelection: (type: string) => void;
  getComponentExternalFinishingImage: () => string;
  getComponentInternalFinishingImage: () => string;
  componentAdditionalProps: any[];
  isEdgeBandPropAvailable: boolean;
  isEdgeBandExpanded: boolean;
  setIsEdgeBandExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setComponentAdditionalProps: React.Dispatch<React.SetStateAction<any[]>>;
  toggleColorPicker: (index: number) => void;
  colorPickerVisible: boolean;
  handleColorChange: (color: any) => void;
  handleExposureChange: (
    isExposed: boolean,
    furnishedModelComponentId: string
  ) => Promise<void>;
  onRemoveFromGroup?: (comp: any) => void;
}

const Component = ({
  comp,
  selectedComponentGroup,
  selectedChildComponent,
  handleChildNodeSelection,
  setShowCoreMaterialsModal,
  setShowObjectComponentsModal,
  finishingCategories,
  selectedFinishingType,
  handleFinishingTypeSelection,
  getComponentExternalFinishingImage,
  getComponentInternalFinishingImage,
  componentAdditionalProps,
  isEdgeBandPropAvailable,
  isEdgeBandExpanded,
  setIsEdgeBandExpanded,
  setComponentAdditionalProps,
  toggleColorPicker,
  colorPickerVisible,
  handleColorChange,
  handleExposureChange,
  onRemoveFromGroup,
}: ComponentProps) => {
  const externalStyle = selectedChildComponent?.externalFinishFinishing;
  const internalStyle = selectedChildComponent?.internalFinishFinishing;
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
    selectedChildComponent?.externalFinishGrainDirection;
  const internalFinishGrainDirection =
    selectedChildComponent?.internalFinishGrainDirection;
  const externalFinishBrand = selectedChildComponent?.externalFinishBrand;
  const internalFinishBrand = selectedChildComponent?.internalFinishBrand;
  // Show Core Material / Exposed for handle parts too (was hidden as hardware) —
  // the user wants those options available on the handle as well.
  const notHandleComponent = (_comp: any) => true;

  return (
    <div className="font-semibold text-xs text-neutral-800 dark:text-neutral-50">
      <div className="flex align-center items-center">
        <div
          onClick={() => handleChildNodeSelection(comp)}
          className={`${
            // Match by unique _id, NOT name: grouped parts share one name
            // ("carcass"), so a name check opened/closed ALL of them together.
            (selectedChildComponent as any)?._id === (comp as any)?._id
              ? "bg-no-repeat bg-contain w-[18px] h-[18px] cursor-pointer down-arrow"
              : "bg-no-repeat bg-contain w-[18px] h-[18px] cursor-pointer next-arrow"
          }`}
        />
        <span
          className="font-normal cursor-pointer text-sm py-1 text-primary dark:text-neutral-50"
          onClick={() => {
            handleChildNodeSelection(comp);
          }}
        >
          {/* Show the individual MESH name (Mesh 2, Mesh 4 …) — the real 3D
              identity — not the combined part name, so the two parts are
              distinguishable inside a combined group. Falls back to the part
              name if a mesh has no meshName. */}
          {convertToTitleCase((comp as any).meshName || comp.name)}
        </span>
        {/* Remove this mesh from the combined group — splits it back out into
            its own row. Only shown when the group actually has >1 part. */}
        {onRemoveFromGroup &&
        (selectedComponentGroup?.components?.length ?? 0) > 1 ? (
          <button
            type="button"
            title="Remove this mesh from the group"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFromGroup(comp);
            }}
            className="ml-auto mr-1 text-[13px] leading-none text-[#b42318] hover:bg-[#fee4e2] rounded px-1.5 py-0.5"
          >
            ✕
          </button>
        ) : null}
      </div>
      {(selectedChildComponent as any)?._id === (comp as any)?._id && (
        <ul className="border-l border-l-gray-400 ml-2.5">
          {/* Part name — naming a part "Shutter", "Side panel", "Leg" … is what
              lets the app group Carcass / Shutter and lets the BOQ + working
              drawing tell them apart. The 3D mesh identity is stored separately
              (meshName), so renaming never affects materials. */}
          <li className="pr-4 pb-2.5 pl-2">
            <div className="text-xs font-semibold text-[#414063]">
              -- Part name
            </div>
            <input
              type="text"
              defaultValue={comp.name}
              placeholder="e.g. Shutter, Side panel, Leg"
              title="Name this part by its role so it groups under Carcass / Shutter"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onBlur={async (e) => {
                const next = e.target.value.trim();
                if (!next || next === comp.name) return;
                try {
                  await (
                    BlueprintInterface as any
                  )?.ProjectManagerService?.updateFurnishedModelComponentName(
                    (comp as any)._id,
                    next
                  );
                } catch (err) {
                  console.error("component.tsx ~ rename part failed", err);
                }
              }}
              className="mt-1 w-full text-[11px] font-normal px-1.5 py-1 border border-gray-300 rounded text-[#414063] dark:bg-neutral-800 dark:text-neutral-50"
            />
          </li>
          {notHandleComponent(comp) ? (
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
                      selectedChildComponent?.coreMaterialType
                        ? selectedChildComponent.coreMaterialType.type
                        : ""
                    )}
                  </p>
                  <p className="text-[10px] pt-1 pl-1">|</p>
                  <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                    {selectedChildComponent?.coreMaterialThickness + "mm"
                      ? selectedChildComponent.coreMaterialThickness
                      : ""}
                  </p>
                  <p className="text-[10px] pt-1 pl-1">|</p>
                  <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                    {capitalizeText(
                      selectedChildComponent?.coreMaterialBrand
                        ? selectedChildComponent.coreMaterialBrand.name
                        : ""
                    )}
                  </p>
                  <p className="text-[10px] pt-1 pl-1">|</p>
                  <p className="text-[10px] pt-1 font-normal text-[#414063] pl-1">
                    {capitalizeText(
                      selectedChildComponent?.coreMaterialGrade
                        ? selectedChildComponent.coreMaterialGrade
                        : ""
                    )}
                  </p>
                </div>
              </li>
              {/* Exterior & Interior removed from the inner part: they were a
                  broken duplicate of the group-level finish controls (clicking
                  applied nothing). Set finishes on the outer Mesh group instead.
                  Core Material (above) and Unexposed (below) remain. */}
              {componentAdditionalProps?.length && isEdgeBandPropAvailable ? (
                <li
                  className={`pr-4 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]`}
                  onClick={() => {
                    setIsEdgeBandExpanded(true);
                  }}
                >
                  -- Edge Band
                  {isEdgeBandExpanded && (
                    <ul className="border-l border-l-gray-400 ml-2.5">
                      {componentAdditionalProps.map(
                        (componentProp: any, index: number) => {
                          return (
                            <li key={index}>
                              {Object.entries(componentProp).map(
                                ([key, value]: any) => (
                                  <div
                                    key={key}
                                    className="flex align-center items-center py-1"
                                  >
                                    <span className="pr-4 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]">
                                      {`--${
                                        key === "edge_band_presence"
                                          ? value === "true"
                                            ? "Edge band presence"
                                            : "Edge band unpresence"
                                          : convertToSentenceCase(key)
                                      }`}
                                    </span>
                                    {key === "edge_band_presence" ? (
                                      <TERipple rippleColor="Secondary">
                                        <button
                                          className={`rounded ${
                                            value === "true" ? "snap-icon" : ""
                                          }`}
                                          onClick={() => {
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
                                                          [key]:
                                                            value === "true"
                                                              ? "false"
                                                              : "true",
                                                        }
                                                      : prevComponent
                                                )
                                            );
                                          }}
                                        >
                                          <span className="material-symbols-outlined">
                                            {value === "true"
                                              ? "toggle_on"
                                              : "toggle_off"}
                                          </span>
                                        </button>
                                      </TERipple>
                                    ) : key === "edge_band_color" ? (
                                      <div className="relative">
                                        <button
                                          className="w-12 h-6 text-xs p-0 border"
                                          onClick={() => {
                                            toggleColorPicker(index);
                                          }}
                                        >
                                          {value}
                                        </button>
                                        {colorPickerVisible && (
                                          <div className="absolute top-6">
                                            <SketchPicker
                                              color={value}
                                              onChange={handleColorChange}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <>
                                        <input
                                          className="w-20 h-6 border text-xs p-0 pl-1"
                                          value={value as any}
                                          onChange={(e) => {
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
                                                          [key]: e.target.value,
                                                        }
                                                      : prevComponent
                                                )
                                            );
                                          }}
                                        />
                                        <span className="h-auto p-1 text-xs bg-[#E9E5EC] dark:bg-[#333333] text-center font-semibold">
                                          m
                                        </span>
                                      </>
                                    )}
                                  </div>
                                )
                              )}
                            </li>
                          );
                        }
                      )}
                    </ul>
                  )}
                </li>
              ) : null}
              {selectedChildComponent ? (
                <li>
                  <div className="flex items-center">
                    <span className="pr-2 pt-1 pb-2.5 text-xs font-semibold text-[#414063] cursor-pointer active:bg-[#E9E5EC]">
                      {`-- ${
                        selectedChildComponent.exposed ? "Exposed" : "Unexposed"
                      }`}
                    </span>
                    <TERipple rippleColor="Secondary">
                      <button
                        className={`rounded ${
                          selectedChildComponent.exposed ? "snap-icon" : ""
                        }`}
                        onClick={() => {
                          handleExposureChange(
                            selectedChildComponent.exposed,
                            selectedChildComponent._id
                          );
                        }}
                      >
                        <span className="material-symbols-outlined">
                          {selectedChildComponent.exposed
                            ? "toggle_on"
                            : "toggle_off"}
                        </span>
                      </button>
                    </TERipple>
                  </div>
                </li>
              ) : null}
              {componentAdditionalProps.map(
                (componentProp: any, index: number) => {
                  return (
                    <li key={index}>
                      {Object.entries(componentProp).map(([key, value]) => (
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
                                  let val = e.target.value.includes(",")
                                    ? e.target.value.split(",")
                                    : e.target.value;
                                  setComponentAdditionalProps((prev: any) =>
                                    prev.map((prevComponent: any, i: number) =>
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
                      ))}
                    </li>
                  );
                }
              )}
            </>
          ) : null}
        </ul>
      )}
    </div>
  );
};

export default Component;
