import { capitalizeText } from "@pazl/utils/genericFunctions";
import React from "react";
import {
  TETabs,
  TETabsContent,
  TETabsItem,
  TETabsPane,
} from "tw-elements-react";

const ObjectMaterialModal = ({
  onHideObjectPanel,
  isDarkMode,
  showCoreMaterialsModal,
  setShowCoreMaterialsModal,
  componentProps,
  selectedComponentGroup,
  handleSelectedCoreMaterialType,
  handleSelectedCoreMaterialThickness,
  handleSelectedCoreMaterialBrand,
  handleSelectedCoreMaterialGrade,
  coreMaterialBrands,
  coreMaterialTypeList,
  coreMaterialThicknessList,
}: any) => {
  // Current thickness stored on the component (for showing the selected value).
  const currentThickness =
    selectedComponentGroup?.components?.[0]?.coreMaterialThickness ??
    selectedComponentGroup?.coreMaterialThickness ??
    "";
  const onHideObjectProperties = () => {
    setShowCoreMaterialsModal(false);
  };

  // Resolve the component's current core-material type id, then derive its
  // grade list from the master (core_material_types.grades[]) — so Type and
  // Grade match the Rate Card instead of using hardcoded values.
  const selectedTypeId =
    selectedComponentGroup?.components?.[0]?.coreMaterialTypeId ??
    selectedComponentGroup?.coreMaterialTypeId ??
    coreMaterialTypeList?.[0]?._id ??
    "";
  const selectedType = (coreMaterialTypeList || []).find(
    (t: any) => t._id === selectedTypeId
  );
  // Grades come from the selected master type. A type with no grades (e.g. WPC)
  // shows a neutral "NA". Only fall back to the legacy list if the master hasn't
  // loaded at all (no selectedType).
  const gradeOptions: string[] = selectedType
    ? selectedType.grades?.length
      ? selectedType.grades
      : ["NA"]
    : ["BWP", "MR", "Commercial"];
  const storedGrade =
    selectedComponentGroup?.components?.[0]?.coreMaterialGrade ??
    selectedComponentGroup?.coreMaterialGrade;
  const currentGrade =
    storedGrade && gradeOptions.includes(storedGrade)
      ? storedGrade
      : gradeOptions[0];
  return (
    <div className="fixed w-[251px] h-[200px] block right-[386px] bottom-0 top-[168px] z-10 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700">
      <div className="h-screen mb-10px bg-white dark:bg-neutral-700">
        <div className=" bg-[#E9E5EC] dark:bg-[#333333] text-l text-center font-medium leading-tight text-neutral-800 dark:text-neutral-50">
          <TETabs className="mb-0 items-center justify-between">
            <TETabsItem
              active={true}
              tag="button"
              className="p-3 mt-0 bg-[#F9F9FA] border-t border-r border-l border-b-0 border-inherit"
            >
              <span className="font-bold">Core Material</span>
            </TETabsItem>
            <img
              className="finishing-modal-close-icon"
              src={require("../../images/close.svg")}
              onClick={onHideObjectProperties}
            />
          </TETabs>
          <TETabsContent className="bg-white m-0 pb-2">
            <TETabsPane show={showCoreMaterialsModal}>
              <div>
                <div className=" px-3 flex flex-col text-justify">
                  {coreMaterialTypeList?.length ? (
                    <div className="mt-3">
                      <div>
                        <h6 className="type-pattern-title">Type</h6>
                      </div>
                      <div>
                        <select
                          id="dropdown"
                          value={selectedTypeId}
                          onChange={handleSelectedCoreMaterialType}
                          className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                        >
                          {coreMaterialTypeList.map((t: any) => (
                            <option key={t._id} value={t._id}>
                              {capitalizeText(t.type)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : componentProps?.coreMaterialTypes?.length ? (
                    <div className="mt-3">
                      <div>
                        <h6 className="type-pattern-title">Type</h6>
                      </div>
                      <div>
                        <select
                          id="dropdown"
                          value={capitalizeText(
                            selectedComponentGroup?.components
                              ? selectedComponentGroup.components[0]
                                  ?.coreMaterialType?.type
                              : selectedComponentGroup?.coreMaterialType
                              ? selectedComponentGroup.coreMaterialType?.type
                              : componentProps?.coreMaterialTypes[0]
                          )}
                          onChange={handleSelectedCoreMaterialType}
                          className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                        >
                          {componentProps?.coreMaterialTypes?.map(
                            (item: any, index: any) => (
                              <option key={index} value={item}>
                                {capitalizeText(item)}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>
                  ) : null}
                  {coreMaterialThicknessList?.length ? (
                    <div className="mt-3 mb-2.5">
                      <div>
                        <h6 className="type-pattern-title">Thickness</h6>
                      </div>
                      <div>
                        <select
                          id="dropdown"
                          value={currentThickness ? String(currentThickness) : ""}
                          onChange={handleSelectedCoreMaterialThickness}
                          className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                        >
                          <option value="">Select…</option>
                          {coreMaterialThicknessList.map((t: number) => (
                            <option key={t} value={t}>
                              {t} mm
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : componentProps?.coreMaterialThickness?.length ? (
                    <div className="mt-3 mb-2.5">
                      <div>
                        <h6 className="type-pattern-title">Thickness</h6>
                      </div>
                      <div>
                        <select
                          id="dropdown"
                          value={
                            selectedComponentGroup?.components
                              ? selectedComponentGroup.components[0]
                                  ?.coreMaterialThickness + "mm"
                              : selectedComponentGroup?.coreMaterialThickness
                              ? selectedComponentGroup.coreMaterialThickness +
                                "mm"
                              : componentProps?.coreMaterialThickness[0]
                          }
                          onChange={handleSelectedCoreMaterialThickness}
                          className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                        >
                          {componentProps?.coreMaterialThickness?.map(
                            (item: any, index: any) => (
                              <option key={index} value={item}>
                                {item}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-col items-center">
                    {coreMaterialBrands?.length ? (
                      <div className="pt-3 mb-2.5">
                        <div>
                          <h6 className="type-pattern-title">Brand</h6>
                        </div>
                        <div>
                          <select
                            id="dropdown"
                            value={capitalizeText(
                              selectedComponentGroup?.components
                                ? selectedComponentGroup.components[0]
                                    ?.coreMaterialBrand?.name
                                : selectedComponentGroup?.coreMaterialBrand
                                ? selectedComponentGroup.coreMaterialBrand.name
                                : coreMaterialBrands[0]
                            )}
                            onChange={handleSelectedCoreMaterialBrand}
                            className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                          >
                            {coreMaterialBrands?.map(
                              (brand: any, index: number) => (
                                <option key={index} value={brand._id}>
                                  {capitalizeText(brand.name)}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 mb-2.5">
                      <div>
                        <h6 className="type-pattern-title">Grade</h6>
                      </div>
                      <div>
                        <select
                          id="dropdown"
                          value={currentGrade}
                          onChange={handleSelectedCoreMaterialGrade}
                          className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                        >
                          {gradeOptions.map((g: string) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TETabsPane>
          </TETabsContent>
        </div>
      </div>
    </div>
  );
};

export default ObjectMaterialModal;
