import React, { useEffect, useState } from "react";
import { Finishing } from "@pazl/entities/Finishing";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import "./objectComponents.css";

interface propsType {
  finishings: Finishing[] | null;
  selectedStyle: Finishing | null;
  onFinishingTextureSelection: (finishing: Finishing) => void;
  variantsContainerRef?: any;
}

const ObjectFinishingVariants = React.memo(
  ({
    finishings,
    selectedStyle,
    onFinishingTextureSelection,
    variantsContainerRef,
  }: propsType) => {
    const [selectedVariant, setSelectedVariant] = useState("");
    const [filteredFinishings, setFilteredFinishings] = useState<any[]>([]);

    useEffect(() => {
      if (selectedStyle) {
        const list = finishings?.filter(
          (finishing: Finishing) => finishing.categoryId === selectedStyle?._id
        );
        if (list?.length) {
          setFilteredFinishings(list);
        } else {
          setFilteredFinishings([]);
        }
      } else if (finishings?.length) {
        setFilteredFinishings(finishings);
      }
    }, [selectedStyle, finishings]);

    const handleSelectedVariant = (event: any) => {
      const newValue = event?.target?.value || "";
      setSelectedVariant(newValue);
    };

    return (
      <>
        {filteredFinishings?.length ? (
          <div
            className="flex flex-wrap justify-center pb-12"
            ref={variantsContainerRef}
          >
            {filteredFinishings.map((finishing: Finishing) => {
              return (
                <div className="p-2.5" key={finishing?._id}>
                  <div
                    className="finishing-texture-container"
                    onClick={() => onFinishingTextureSelection(finishing)}
                  >
                    <img
                      src={finishing?.texture?.fileUrl}
                      className="w-[97px] h-[93px]"
                    />
                    <div>
                      <p className="text-xs font-normal truncate">
                        {capitalizeText(finishing?.name)}
                      </p>
                    </div>
                  </div>
                  {/* Per-texture variant picker — only shown when the finishing
                      actually defines variants (finish_texture). Hidden by
                      default since the data isn't populated and it's not wired
                      to apply/price anything. */}
                  {finishing?.finish_texture?.length ? (
                    <div>
                      <select
                        id="dropdown"
                        value={selectedVariant}
                        onChange={handleSelectedVariant}
                        className="type-pattern-dropdown bg-[#F9F9FA] h-[28px] w-[95px]"
                      >
                        {finishing.finish_texture.map((prop: string) => (
                          <option key={prop} value={prop}>
                            {prop}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <h1 className="my-8 flex text-[#414063] dark:text-[#ffffff] text-xs text-center align-center justify-center font-semibold leading-tight">
            {selectedStyle
              ? `Sorry, no finishings available for ${selectedStyle.name}.`
              : ""}
          </h1>
        )}
      </>
    );
  }
);

export default ObjectFinishingVariants;
