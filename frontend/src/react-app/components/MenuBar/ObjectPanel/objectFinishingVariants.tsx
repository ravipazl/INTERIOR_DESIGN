import React, { useEffect, useState } from "react";
import { Finishing } from "@pazl/entities/Finishing";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import "./objectComponents.css";

/**
 * Each finish once. The finish catalog was imported twice (18 May 2026): every
 * finish has an identical twin — same name, same style, same texture — with a
 * different _id, so the picker showed "Wood 10002" twice.
 *
 * Display only. Saved finishes point at either copy and are looked up by _id
 * in the FULL list elsewhere, so they are unaffected. The OLDER record
 * (smaller _id) is the one shown, so new picks land on the copy a later
 * database clean-up would keep. Order is preserved.
 */
const uniqueFinishings = (list: Finishing[]): Finishing[] => {
  const keyOf = (f: any) =>
    `${String(f?.name || "").trim().toLowerCase()}|${f?.texture?.fileUrl || ""}`;
  const kept = new Map<string, Finishing>();
  for (const f of list) {
    const k = keyOf(f);
    const prev = kept.get(k);
    if (!prev || String(f?._id) < String(prev?._id)) kept.set(k, f);
  }
  return list.filter((f) => kept.get(keyOf(f)) === f);
};

interface propsType {
  finishings: Finishing[] | null;
  selectedStyle: Finishing | null;
  onFinishingTextureSelection: (finishing: Finishing) => void;
  variantsContainerRef?: any;
  // All optional, so any other caller of this grid behaves exactly as before.
  /** What is typed in the panel's search box. Empty = no search. */
  query?: string;
  /** The part's brand; a search stays inside it. Empty = any brand. */
  brandId?: string;
  /** The grades on offer for this type and brand — the search's reach, and
   *  where a result's style name is read from. */
  styles?: any[];
  /** Move the Style dropdown to a search result's own style. */
  onPickStyle?: (styleId: string) => void;
  /**
   * Lay the swatches out in exactly this many columns.
   *
   * Without it the tiles are a fixed 117px and simply wrap, so the count per
   * row is whatever happens to fit — three in the Material panel, but only by
   * a few pixels: when the panel gained a scrollbar the third tile dropped to
   * the next row and the grid became two wide with gaps either side. Given a
   * number, the row is divided into that many equal columns and the tiles
   * size to them, so a scrollbar narrows the tiles slightly instead of
   * changing how many there are.
   */
  columns?: number;
}

const ObjectFinishingVariants = React.memo(
  ({
    finishings,
    selectedStyle,
    onFinishingTextureSelection,
    variantsContainerRef,
    query = "",
    brandId = "",
    styles,
    onPickStyle,
    columns,
  }: propsType) => {
    const fixed = Number(columns) > 0;
    const [selectedVariant, setSelectedVariant] = useState("");
    const [filteredFinishings, setFilteredFinishings] = useState<any[]>([]);
    const needle = query.trim().toLowerCase();
    const searching = !!needle;
    const styleName = (f: any) =>
      (styles || []).find((s: any) => String(s?._id) === String(f?.categoryId))
        ?.name || "";

    useEffect(() => {
      /**
       * A SEARCH REACHES ACROSS THE WHOLE BRAND, not only the open style.
       *
       * Someone holding a décor number does not know which style it is filed
       * under — that is what they are trying to find. Searching only the open
       * style means "21024" finds nothing until you have already guessed
       * Solids, which is the BOQ dialog's search bug in a second place.
       *
       * It still stays inside the part's brand and inside the grades this
       * panel offers, so a result can never be one the dropdowns above could
       * not have reached, and the brand recorded on the part stays true.
       */
      if (searching) {
        const offered = new Set((styles || []).map((s: any) => String(s?._id)));
        const list = (finishings || []).filter((f: any) => {
          if (brandId && String(f?.brandId || "") !== String(brandId)) return false;
          if (offered.size && !offered.has(String(f?.categoryId))) return false;
          if (!f?.texture?.fileUrl) return false;
          return `${f?.name || ""} ${f?.decorCode || ""}`
            .toLowerCase()
            .includes(needle);
        });
        setFilteredFinishings(uniqueFinishings(list));
        return;
      }
      if (selectedStyle) {
        const list = finishings?.filter(
          (finishing: Finishing) => finishing.categoryId === selectedStyle?._id
        );
        if (list?.length) {
          setFilteredFinishings(uniqueFinishings(list));
        } else {
          setFilteredFinishings([]);
        }
      } else if (finishings?.length) {
        setFilteredFinishings(uniqueFinishings(finishings));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStyle, finishings, needle, brandId, styles]);

    const pick = (finishing: Finishing) => {
      // A search result may live in another style. The dropdown is moved to
      // it first, so the panel never shows a material under a style it does
      // not belong to; from the open style this changes nothing.
      const styleId = String((finishing as any)?.categoryId || "");
      if (searching && styleId && styleId !== String(selectedStyle?._id || "")) {
        onPickStyle?.(styleId);
      }
      onFinishingTextureSelection(finishing);
    };

    const handleSelectedVariant = (event: any) => {
      const newValue = event?.target?.value || "";
      setSelectedVariant(newValue);
    };

    return (
      <>
        {filteredFinishings?.length ? (
          <div
            className={fixed ? "grid pb-12" : "flex flex-wrap justify-center pb-12"}
            style={
              fixed
                ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
                : undefined
            }
            ref={variantsContainerRef}
          >
            {filteredFinishings.map((finishing: Finishing) => {
              return (
                <div className={fixed ? "p-2 min-w-0" : "p-2.5"} key={finishing?._id}>
                  <div
                    className="finishing-texture-container"
                    onClick={() => pick(finishing)}
                  >
                    <img
                      src={finishing?.texture?.fileUrl}
                      alt=""
                      loading="lazy"
                      // Same 97:93 shape as the fixed tile, at whatever width
                      // the column gives it.
                      className={
                        fixed
                          ? "block w-full aspect-[97/93] object-cover"
                          : "w-[97px] h-[93px]"
                      }
                    />
                    <div className={fixed ? "w-full min-w-0" : "w-[97px]"}>
                      <p className="text-xs font-normal truncate">
                        {capitalizeText(finishing?.name)}
                      </p>
                      {/* THE MAKER'S SURFACE CODES — RH, HGL, MR+, VNR.
                          The same design is sold in several surfaces, and the
                          catalogue says which on every entry. Shown here
                          rather than used to sort the materials: a décor
                          carrying two of them belongs in two places at once,
                          which no single dropdown can express. As a line of
                          text it simply tells you what you are looking at. */}
                      {/* While searching, results come from several styles;
                          this says which one each belongs to. */}
                      {searching && styleName(finishing) ? (
                        <p className="text-[10px] font-normal text-[#5b4bd6] truncate">
                          {styleName(finishing)}
                        </p>
                      ) : null}
                      {(finishing as any)?.finishCodes?.length ? (
                        <p className="text-[10px] font-normal text-[#8b89a3] truncate">
                          {(finishing as any).finishCodes.join(" · ")}
                        </p>
                      ) : null}
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
            {searching
              ? `Nothing in this brand matches “${query.trim()}”.`
              : selectedStyle
              ? `Sorry, no finishings available for ${selectedStyle.name}.`
              : ""}
          </h1>
        )}
      </>
    );
  }
);

export default ObjectFinishingVariants;
