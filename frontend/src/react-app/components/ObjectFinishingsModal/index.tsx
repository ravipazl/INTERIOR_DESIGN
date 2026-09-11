import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TETabs, TETabsContent, TETabsPane } from "tw-elements-react";
import ObjectFinishingVariants from "../MenuBar/ObjectPanel/objectFinishingVariants";
import { Finishing, FinishingBrand } from "@pazl/entities/Finishing";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import "./index.css";

// Height of the swatch area: two rows of swatches (a row is ~130px — a 93px
// tile, its name, and padding), ending just below the second row. The panel
// is always this tall; the rest of the swatches scroll inside it.
const SWATCH_AREA_PX = 262;

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
  // Optional: when given, an Exterior | Interior switch is shown under the
  // title. Absent (any other caller), the panel is exactly as before.
  onSwitchFinishingType,
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

  // Two rows tall — unless the window is too short for that, in which case
  // the area shrinks to what is actually left below the dropdowns (never below
  // one row). Measured, not guessed: a fixed "100vh - 530px" cut the second
  // row in half on a browser zoomed to 125%, where there is less room.
  const swatchTopRef = useRef<HTMLDivElement>(null);
  const [swatchAreaPx, setSwatchAreaPx] = useState(SWATCH_AREA_PX);
  useLayoutEffect(() => {
    const fitToWindow = () => {
      const top = swatchTopRef.current?.getBoundingClientRect().top;
      if (top == null) return;
      const room = Math.floor(window.innerHeight - top - 12);
      setSwatchAreaPx(Math.min(SWATCH_AREA_PX, Math.max(140, room)));
    };
    fitToWindow();
    window.addEventListener("resize", fitToWindow);
    return () => window.removeEventListener("resize", fitToWindow);
  }, [styles?.length, selectedStyle?._id, selectedFinishingType, isContentVisible]);

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

  // (Removed) Scrolling the swatches used to hide Type / Style / Brand /
  // Grain behind a "Properties" button. With a fixed-height panel the top part
  // stays put and only the swatches scroll, so nothing needs hiding. The
  // listener also re-attached on every scroll without ever being removed (it
  // added "scroll" but removed "wheel").

  return (
    <div className="fixed w-[260px] h-auto block right-[386px] top-[168px] z-10 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700">
      <div className="h-auto bg-white dark:bg-neutral-700">
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
          {onSwitchFinishingType ? (
            <div className="flex gap-1.5 px-3 py-2 bg-white dark:bg-neutral-700">
              {(["exterior", "interior"] as const).map((t) => {
                const on = selectedFinishingType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (!on) onSwitchFinishingType(t);
                    }}
                    style={{
                      flex: 1,
                      borderRadius: 6,
                      padding: "6px 0",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: on ? "default" : "pointer",
                      border: on ? "1px solid #5b3df5" : "1px solid #dfe2ea",
                      background: on ? "rgba(91,61,245,0.08)" : "#fff",
                      color: on ? "#4b30dc" : "#394055",
                    }}
                  >
                    {t === "exterior" ? "Exterior" : "Interior"}
                  </button>
                );
              })}
            </div>
          ) : null}
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
                      {/* Type · Style / Brand · Grain as a 2 × 2 grid: half the
                          height of four stacked rows, so more swatches show
                          without scrolling. Same selects, same handlers. */}
                      <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-3 mb-2.5">
                        <div className="min-w-0">
                          <h6 className="type-pattern-title text-[12px] mb-1">
                            Type
                          </h6>
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
                            className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-full h-[28px]"
                          >
                            {finishingCategories?.map((category: any) => (
                              <option key={category._id} value={category.name}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        {styles?.length ? (
                          <div className="min-w-0">
                            <h6 className="type-pattern-title text-[12px] mb-1">
                              Style
                            </h6>
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
                              className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-full h-[28px]"
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
                        ) : (
                          // Keeps Brand / Grain on the second line when a type
                          // has no styles.
                          <div />
                        )}
                        <div className="min-w-0">
                          <h6 className="type-pattern-title text-[12px] mb-1">
                            Brand
                          </h6>
                          <select
                            id="dropdown"
                            value={
                              (selectedFinishingType === "exterior"
                                ? externalFinishBrand?._id
                                : internalFinishBrand?._id) || ""
                            }
                            onChange={handleSelectedBrand}
                            className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-full h-[28px]"
                          >
                            <option value="">Select…</option>
                            {finishingBrands?.map((brand: FinishingBrand) => (
                              <option key={brand._id} value={brand._id}>
                                {brand.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0">
                          <h6 className="type-pattern-title text-[12px] mb-1">
                            Grain Direction
                          </h6>
                          <select
                            id="dropdown"
                            value={capitalizeText(
                              selectedFinishingType === "exterior"
                                ? externalFinishGrainDirection
                                : internalFinishGrainDirection
                            )}
                            onChange={handleSelectedGrainDirection}
                            className="type-pattern-dropdown bg-[#F9F9FA] border-0 w-full h-[28px]"
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
                    </>
                  )}
                </div>
                {selectedStyle ? (
                  <>
                  {/* Zero-height marker: where the swatch area starts. */}
                  <div ref={swatchTopRef} aria-hidden="true" />
                  <div
                    className="overflow-y-auto scroll-smooth"
                    // Fixed: two rows tall (see swatchAreaPx), so the panel
                    // ends at the same place for every part. Was
                    // .smooth-transition, i.e. the full screen height minus
                    // 166px — starting half-way down the screen, it ran past the
                    // bottom and the lower swatches were cut off.
                    style={{ height: swatchAreaPx }}
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
                  </>
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
