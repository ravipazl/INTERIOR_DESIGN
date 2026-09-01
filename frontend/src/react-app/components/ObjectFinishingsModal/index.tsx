import React, { useEffect, useRef, useState } from "react";
import { TETabs, TETabsContent, TETabsPane } from "tw-elements-react";
import ObjectFinishingVariants from "../MenuBar/ObjectPanel/objectFinishingVariants";
import { Finishing, FinishingBrand } from "@pazl/entities/Finishing";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import "./index.css";

const ObjectFinishingsModal = ({
  onHideObjectPanel,
  isDarkMode,
  showObjectComponentsModal,
  finishingCategories,
  handleSelectedType,
  selectedStyle,
  selectedType,
  styles,
  handleSelectedStyle,
  handleSelectedBrand,
  finishingBrands,
  finishingsList,
  handleSelectedGrainDirection,
  handleFinishingTextureSelection,
  grainDirections,
  setShowObjectComponentsModal,
  selectedComponentGroup,
  selectedFinishingType,
  selectedChildComponent,
  componentGroup,
}: any) => {
  const externalStyle =
    selectedChildComponent?.externalFinishFinishing ??
    selectedComponentGroup?.components[0]?.externalFinishFinishing;
  const internalStyle =
    selectedChildComponent?.internalFinishFinishing ??
    selectedComponentGroup?.components[0]?.internalFinishFinishing;
  const externalType = finishingCategories?.find(
    (finishingCategory: any) =>
      finishingCategory._id === externalStyle?.categoryId
  );
  const internalType = finishingCategories?.find(
    (finishingCategory: any) =>
      finishingCategory._id === internalStyle?.categoryId
  );
  const externalFinishGrainDirection =
    selectedChildComponent?.externalFinishGrainDirection ??
    selectedComponentGroup?.components[0]?.externalFinishGrainDirection;
  const internalFinishGrainDirection =
    selectedChildComponent?.internalFinishGrainDirection ??
    selectedComponentGroup?.components[0]?.internalFinishGrainDirection;
  const externalFinishBrand =
    selectedChildComponent?.externalFinishBrand ??
    selectedComponentGroup?.components[0]?.externalFinishBrand;
  const internalFinishBrand =
    selectedChildComponent?.internalFinishBrand ??
    selectedComponentGroup?.components[0]?.internalFinishBrand;

  const onHideObjectProperties = () => {
    setShowObjectComponentsModal(false);
  };

  const [isContentVisible, setIsContentVisible] = useState(true);
  const [lastScrollTop, setLastScrollTop] = useState(0);
  const variantsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.debug(
      "ParentComponent ~ useEffect ~ selectedChildComponenttttttttttttttt",
      componentGroup
    );
  }, [componentGroup]);

  const onClickProperties = () => {
    setIsContentVisible(true);
  };

  const handleScroll = (event: MouseEvent | WheelEvent) => {
    if (
      variantsContainerRef.current &&
      event.type === "wheel" && // Check if the event is a WheelEvent
      (event as WheelEvent).deltaY >= 0 && // Type assertion to WheelEvent, then check deltaY
      variantsContainerRef.current.contains(event.target as Node)
    ) {
      event.preventDefault();
    }
    if (!variantsContainerRef.current) {
      console.error("variantsContainerRef.current is null");
      return;
    }

    try {
      const currentScrollTop = variantsContainerRef.current.scrollTop;
      setIsContentVisible(currentScrollTop < lastScrollTop);
      setLastScrollTop(currentScrollTop);
    } catch (error) {
      console.error("Error in handleScroll:", error);
    }
  };

  useEffect(() => {
    if (variantsContainerRef.current) {
      variantsContainerRef.current.addEventListener("scroll", handleScroll);
    }
    return () => {
      if (variantsContainerRef.current) {
        variantsContainerRef.current.removeEventListener("wheel", handleScroll);
      }
    };
  }, [lastScrollTop]);

  return (
    <div className="fixed w-[260px] h-[200px] block right-[386px] bottom-0 top-[168px] z-10 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700">
      <div className="h-screen mb-10px bg-white dark:bg-neutral-700">
        <div className=" bg-[#E9E5EC] dark:bg-[#333333] text-l text-center font-medium leading-tight text-neutral-800 dark:text-neutral-50">
          <TETabs className="mb-0 items-center justify-between">
            <div className="p-3 mt-0 bg-[#F9F9FA] border-t border-r border-l border-b-0 border-inherit">
              <span className="font-bold">
                {selectedChildComponent
                  ? capitalizeText(selectedChildComponent.name)
                  : capitalizeText(selectedComponentGroup?.name)
                  ? capitalizeText(selectedComponentGroup.name)
                  : ""}
                :{" "}
                {selectedFinishingType
                  ? capitalizeText(selectedFinishingType)
                  : ""}
              </span>
            </div>
            <img
              className="finishing-modal-close-icon"
              src={require("../../images/close.svg")}
              onClick={onHideObjectProperties}
            />
          </TETabs>
          <TETabsContent className="bg-white m-0 overflow-y-auto h-auto">
            <TETabsPane show={showObjectComponentsModal}>
              <div>
                <div className=" px-3 flex flex-col text-justify">
                  {!isContentVisible && (
                    <button
                      onClick={onClickProperties}
                      className="flex flex-row justify-between align-center py-2"
                    >
                      <p>Properties</p>
                      <img
                        src={require("../../images/down.svg")}
                        width={20}
                        height={20}
                      />
                    </button>
                  )}
                  {isContentVisible && (
                    <>
                      <div className="mt-3">
                        <div>
                          <h6 className="type-pattern-title">Type</h6>
                        </div>
                        <div>
                          <select
                            id="dropdown"
                            value={
                              selectedType
                                ? selectedType?.name // Optional chaining
                                : selectedFinishingType === "exterior"
                                ? externalType?.name // Optional chaining
                                : internalType?.name // Optional chaining
                            }
                            onChange={handleSelectedType}
                            className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                          >
                            {finishingCategories?.map((category: any) => (
                              <option key={category._id} value={category.name}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {styles?.length ? (
                        <div className="mt-3 mb-2.5">
                          <div>
                            <h6 className="type-pattern-title">Style</h6>
                          </div>
                          <div>
                            <select
                              id="dropdown"
                              value={
                                selectedStyle
                                  ? selectedStyle.name
                                  : selectedFinishingType === "exterior"
                                  ? externalStyle?.name
                                  : internalStyle?.name
                              }
                              onChange={handleSelectedStyle}
                              className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                            >
                              {styles?.map((finishing: Finishing) => (
                                <option
                                  key={finishing._id}
                                  value={finishing.name}
                                >
                                  {finishing.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : null}
                      <div className="flex flex-col items-center">
                        <div className="pt-3 mb-2.5">
                          <div>
                            <h6 className="type-pattern-title">Brand</h6>
                          </div>
                          <div>
                            <select
                              id="dropdown"
                              value={
                                (selectedFinishingType === "exterior"
                                  ? externalFinishBrand?._id
                                  : internalFinishBrand?._id) || ""
                              }
                              onChange={handleSelectedBrand}
                              className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                            >
                              <option value="">Select…</option>
                              {finishingBrands?.map((brand: FinishingBrand) => (
                                <option key={brand._id} value={brand._id}>
                                  {brand.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="mt-3 mb-2.5">
                          <div>
                            <h6 className="type-pattern-title">
                              Grain Direction
                            </h6>
                          </div>
                          <div>
                            <select
                              id="dropdown"
                              value={capitalizeText(
                                selectedFinishingType === "exterior"
                                  ? externalFinishGrainDirection
                                  : internalFinishGrainDirection
                              )}
                              onChange={handleSelectedGrainDirection}
                              className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-[225px] h-[28px]"
                            >
                              {grainDirections.map((grainDirection: any) => (
                                <option
                                  key={grainDirection._id}
                                  value={grainDirection.name}
                                >
                                  {grainDirection.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {selectedStyle ? (
                  <div
                    className={
                      "overflow-y-auto smooth-transition scroll-smooth"
                    }
                    ref={variantsContainerRef}
                  >
                    <ObjectFinishingVariants
                      selectedStyle={selectedStyle}
                      finishings={finishingsList}
                      onFinishingTextureSelection={
                        handleFinishingTextureSelection
                      }
                      variantsContainerRef={variantsContainerRef}
                    />
                  </div>
                ) : null}
              </div>
            </TETabsPane>
          </TETabsContent>
        </div>
      </div>
    </div>
  );
};

export default ObjectFinishingsModal;
