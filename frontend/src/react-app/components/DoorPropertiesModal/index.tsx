import React, { useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import { TexturesService } from "@pazl/services/texturesService";
import { ModelsService } from "@pazl/services/ModelsService";
import { CategoriesService } from "@pazl/services/categoriesService";
import { handleSwapSelectedObject } from "@pazl/viewer3d-state-interface";
import { Finishing } from "@pazl/entities/Finishing";
import { convertToTitleCase } from "@pazl/utils/genericFunctions";
import WallFinishingsModal from "../WallPropertiesModal/WallFinishingsModal";
// Reuse the Wall Properties panel styling so the two panels look identical.
import "../WallPropertiesModal/index.css";

interface DoorPropertiesModalProps {
  // The parametric door class (itemModel.parametricClass).
  doorClass: any;
  onClose: () => void;
}

const LABELS: { [key: string]: string } = {
  frameColor: "Frame color",
  doorColor: "Door color",
  doorHandleColor: "Handle color",
  doorGlassColor: "Glass color",
  glassColor: "Glass color",
  frameWidth: "Width (mm)",
  frameHeight: "Height (mm)",
  frameSize: "Frame size (mm)",
  frameThickness: "Frame thickness (mm)",
  doorRatio: "Door ratio",
  openDirection: "Open direction",
  handleType: "Handle type",
};

// Colour parameters -> the door surface they paint (uses the wall swatch grid).
const COLOR_CHANNELS: { [key: string]: "frame" | "door" | "handle" | "glass" } =
  {
    frameColor: "frame",
    doorColor: "door",
    doorHandleColor: "handle",
    doorGlassColor: "glass",
    glassColor: "glass",
  };

// The real "Default" colour of each surface (matches what the 3D engine renders)
// so the swatch preview isn't the old greenish wall texture.
const DEFAULT_CHANNEL_COLOR: { [key: string]: string } = {
  frame: "#1A1A1A",
  door: "#3D3D3D",
  handle: "#F0F0F0",
  glass: "#DCE6EC",
};

// Length parameters stored internally in CENTIMETRES but shown to the user in
// MILLIMETRES. We convert only at the UI layer (display ×10, input ÷10) so the
// underlying door/window class — and the 3D geometry — stay in cm, unchanged.
const MM_FIELDS = new Set(["frameWidth", "frameHeight", "frameThickness", "frameSize"]);
const isMmField = (key: string) => MM_FIELDS.has(key);
const cmToMm = (key: string, v: number) => (isMmField(key) ? v * 10 : v);
const mmToCm = (key: string, v: number) => (isMmField(key) ? v / 10 : v);

function DoorPropertiesModal({ doorClass, onClose }: DoorPropertiesModalProps) {
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;

  const [params, setParams] = useState<{ [k: string]: any }>({});
  const [values, setValues] = useState<{ [k: string]: any }>({});

  const [allFinishings, setAllFinishings] = useState<Finishing[] | null>(null);
  const [finishingCategories, setFinishingCategories] = useState<any[]>([]);
  const [filteredFinishings, setFilteredFinishings] = useState<
    Finishing[] | null
  >(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [selectedByChannel, setSelectedByChannel] = useState<{
    [k: string]: Finishing;
  }>({});

  // SWAP tab: the door-category catalog models the user can swap this door for.
  // Loaded dynamically from the same catalog the left panel uses — never static.
  const [activeTab, setActiveTab] = useState<"properties" | "swap">(
    "properties"
  );
  const [swapModels, setSwapModels] = useState<any[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  useEffect(() => {
    if (!doorClass) return;
    try {
      const p = doorClass.parameters || {};
      const init: { [k: string]: any } = {};
      Object.keys(p).forEach((k) => {
        init[k] = doorClass[k];
      });
      setParams(p);
      setValues(init);
    } catch (e) {
      console.error("DoorPropertiesModal init failed", e);
    }
  }, [doorClass]);

  useEffect(() => {
    getAllFinishings();
  }, []);

  // After reload the door keeps its applied finishings in `__surfaceMaps`
  // (frame/door/handle/glass -> texture URL), but this panel's selection state
  // starts empty, so every dropdown wrongly showed "Default". Once the door and
  // the finishings list are both ready, match each saved texture URL back to its
  // finishing and pre-select it, so the panel shows the REAL saved finishing
  // (name + swatch) — matching what's rendered on the door. Read-only: this
  // never changes the door, only what the panel displays.
  useEffect(() => {
    if (!doorClass || !allFinishings?.length) return;
    try {
      const maps = (doorClass as any).__surfaceMaps || {};
      const preselected: { [k: string]: Finishing } = {};
      Object.keys(maps).forEach((channel) => {
        const url = maps[channel];
        if (!url) return;
        const match = allFinishings.find(
          (f) => f?.texture?.fileUrl === url
        );
        if (match) preselected[channel] = match;
      });
      if (Object.keys(preselected).length) {
        // In-session picks (prev) win over the saved ones.
        setSelectedByChannel((prev) => ({ ...preselected, ...prev }));
      }
    } catch (e) {
      console.error("DoorPropertiesModal preselect from saved maps failed", e);
    }
  }, [doorClass, allFinishings]);

  const getAllFinishings = async () => {
    try {
      let categoriesList =
        await TexturesService.getFinishingCategoriesFromLocalStorage();
      let finishingsList =
        await TexturesService.getFinishingsFromLocalStorage();
      if (categoriesList?.length && finishingsList?.length) {
        const laminateId = categoriesList.find((c: any) =>
          c.name.toLowerCase().includes("laminates")
        )?._id;
        categoriesList = categoriesList.filter(
          (c: any) => c.parentCategoryId === laminateId
        );
        setFinishingCategories(categoriesList);
        finishingsList = finishingsList.filter(
          (f: Finishing) => f.type === "wall"
        );
        setAllFinishings(finishingsList);
        const firstCat = categoriesList[0]?._id;
        setFilteredFinishings(
          finishingsList.filter((f: Finishing) => f.categoryId === firstCat)
        );
      }
    } catch (e) {
      console.error("DoorPropertiesModal getAllFinishings failed", e);
    }
  };

  const handleTextureCategorySelection = (e: any) => {
    const id = e.target.value;
    setFilteredFinishings(
      allFinishings?.filter((f) => f.categoryId === id) ?? []
    );
  };

  // Save the change so it survives reload (writes the item's data to storage —
  // same save the wall picker uses). Without this, door/window colour + finish
  // changes are only on-screen and are lost on refresh.
  const persistChange = () => {
    try {
      (BlueprintInterface as any)?.ProjectManagerService?.updateFloorPlan?.(
        "Door/Window appearance changed"
      );
    } catch (e) {
      console.error("DoorPropertiesModal persist failed", e);
    }
  };

  const applyValue = (key: string, value: any) => {
    try {
      doorClass[key] = value;
      const rp =
        BlueprintInterface.blueprint3d &&
        BlueprintInterface.blueprint3d.roomplanner;
      if (rp) rp.needsUpdate = true;
    } catch (e) {
      console.error("DoorPropertiesModal applyValue failed for", key, e);
    }
    setValues((prev) => ({ ...prev, [key]: value }));
    persistChange();
  };

  const applyFinishing = (channel: string, finishing: Finishing) => {
    try {
      doorClass.setSurfaceMap(channel, finishing?.texture?.fileUrl);
      const rp =
        BlueprintInterface.blueprint3d &&
        BlueprintInterface.blueprint3d.roomplanner;
      if (rp) rp.needsUpdate = true;
    } catch (e) {
      console.error("DoorPropertiesModal applyFinishing failed", channel, e);
    }
    setSelectedByChannel((prev) => ({ ...prev, [channel]: finishing }));
    setActiveChannel(null);
    persistChange();
  };

  // Load the DOOR-category catalog models for the Swap grid. Dynamic: it reads
  // the same cached catalog the left panel uses, finds the "Door" category, and
  // lists every model in it (and its sub-categories) — so new doors appear
  // automatically, nothing is hardcoded.
  const loadSwapModels = async () => {
    setSwapLoading(true);
    setSwapError(null);
    try {
      const categories =
        (await CategoriesService.getCategoriesFromLocalStorage()) || [];
      const allModels =
        (await ModelsService.getModelsFromLocalStorage()) || [];
      // The selected door's own category if it has one; otherwise the catalog
      // category literally named "Door".
      const doorCats = categories.filter((c: any) =>
        String(c?.name || "")
          .toLowerCase()
          .includes("door")
      );
      const doorCatIds = new Set(doorCats.map((c: any) => c._id));
      const models = allModels.filter(
        (m: any) =>
          doorCatIds.has(m.categoryId) ||
          doorCats.some((c: any) => c._id === m.parentCategoryId)
      );
      setSwapModels(models);
      if (!models.length) {
        setSwapError("No door models found in the catalog.");
      }
    } catch (e) {
      console.error("DoorPropertiesModal loadSwapModels failed", e);
      setSwapError("Could not load door models.");
    } finally {
      setSwapLoading(false);
    }
  };

  // Fetch the swap models the first time the Swap tab is opened.
  useEffect(() => {
    if (activeTab === "swap" && !swapModels.length && !swapLoading) {
      loadSwapModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Replace the currently selected door with the chosen catalog model, in place.
  const handleSwapClick = async (model: any) => {
    try {
      await handleSwapSelectedObject(model);
      // The old door (and this panel's door) is gone — close the now-stale panel.
      onClose();
    } catch (e) {
      console.error("DoorPropertiesModal handleSwapClick failed", e);
    }
  };

  if (!doorClass) return null;

  // Doors and windows share this panel — show the right title for each.
  const isWindow =
    (doorClass as any)?.__windowType !== undefined ||
    (doorClass as any)?.__name === "Window";
  const panelTitle = isWindow ? "Window Properties" : "Door Properties";

  // Read the surface's REAL current colour straight from the door/window engine
  // (its getters return "#rrggbb"), so the swatch ALWAYS matches what's rendered
  // in 3D — instead of a separate hardcoded default that can drift out of sync
  // (the panel-says-one-colour-but-the-door-shows-another bug). Falls back to
  // the default map only if the engine has no colour for that surface.
  const CHANNEL_TO_PROP: { [k: string]: string } = {
    frame: "frameColor",
    door: "doorColor",
    handle: "doorHandleColor",
    glass: "glassColor",
  };
  const actualChannelColor = (channel: string): string => {
    try {
      const prop = CHANNEL_TO_PROP[channel];
      const c = prop && (doorClass as any)[prop];
      if (typeof c === "string" && c.trim()) return c;
    } catch (e) {
      /* fall through to default */
    }
    return DEFAULT_CHANNEL_COLOR[channel] || "#cccccc";
  };

  return (
    <>
      <div
        className="box absolute top-36 right-3 z-10 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)]"
        style={{ width: "16em" }}
      >
        <div className="wall-modal-title-container">
          <div className="wall-modal-title">{panelTitle}</div>
          <img
            className="finishing-modal-close-icon"
            src={require("../../images/close.svg")}
            onClick={onClose}
          />
        </div>
        {/* Tabs: Properties (colours/size) | Swap (replace with another
            door model from the catalog, in place). */}
        <div className="flex border-b border-[#eee] bg-[#fff]">
          <button
            type="button"
            className="flex-1 py-2 text-sm font-semibold"
            style={{
              color: activeTab === "properties" ? "#000" : "#999",
              borderBottom:
                activeTab === "properties"
                  ? "2px solid #000"
                  : "2px solid transparent",
            }}
            onClick={() => setActiveTab("properties")}
          >
            Properties
          </button>
          <button
            type="button"
            className="flex-1 py-2 text-sm font-semibold"
            style={{
              color: activeTab === "swap" ? "#000" : "#999",
              borderBottom:
                activeTab === "swap"
                  ? "2px solid #000"
                  : "2px solid transparent",
            }}
            onClick={() => setActiveTab("swap")}
          >
            Swap
          </button>
        </div>

        {activeTab === "properties" && (
        <div
          className="px-4 py-2 bg-[#fff]"
          style={{ maxHeight: "60vh", overflowY: "auto" }}
        >
          {Object.keys(params).map((key) => {
            const p = params[key];
            const label = LABELS[key] || key;

            if (COLOR_CHANNELS[key]) {
              const channel = COLOR_CHANNELS[key];
              const chosen = selectedByChannel[channel];
              return (
                <div className="py-1" key={key}>
                  <div className="wall-title">{label}</div>
                  <div className="wall-selected-container">
                    <select
                      style={{ width: "8em" }}
                      className="h-8 pb-1 pl-1 mr-2 font-semibold text-base focus:outline-none bg-[#eee] dark:text-white hover:bg-[#E9E5EC] dark:hover:bg-[#666666] dark:bg-[#4E4E4E]"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        e.preventDefault();
                        setActiveChannel(channel);
                      }}
                    >
                      <option className="wall-option-container">
                        {chosen ? convertToTitleCase(chosen.name) : "Default"}
                      </option>
                    </select>
                    <div onClick={() => setActiveChannel(channel)}>
                      {chosen ? (
                        <img
                          src={chosen.texture?.fileUrl}
                          height={40}
                          width={40}
                          style={{ cursor: "pointer" }}
                        />
                      ) : (
                        // No texture picked → show the surface's REAL default
                        // colour (black frame / clear glass / charcoal door),
                        // not the old greenish wall texture.
                        <div
                          style={{
                            height: 40,
                            width: 40,
                            cursor: "pointer",
                            border: "1px solid #ddd",
                            backgroundColor: actualChannelColor(channel),
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div className="py-1" key={key}>
                <div className="wall-title">{label}</div>

                {p.type === "number" && (
                  <input
                    type="number"
                    className="oh-input w-full h-8 pl-2 border border-[#ddd] focus:outline-none"
                    value={cmToMm(key, values[key] ?? 0)}
                    onChange={(e) =>
                      applyValue(key, mmToCm(key, Number(e.target.value)))
                    }
                  />
                )}

                {p.type === "range" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      className="w-full"
                      min={cmToMm(key, p.min)}
                      max={cmToMm(key, p.max)}
                      step={isMmField(key) ? p.step * 10 : p.step}
                      value={cmToMm(key, values[key] ?? p.min)}
                      onChange={(e) =>
                        applyValue(key, mmToCm(key, Number(e.target.value)))
                      }
                    />
                    <span className="text-xs w-10 text-right">
                      {isMmField(key)
                        ? cmToMm(key, Number(values[key] ?? p.min)).toFixed(0)
                        : Number(values[key] ?? p.min).toFixed(2)}
                    </span>
                  </div>
                )}

                {p.type === "choice" && (
                  <select
                    className="w-full h-8 pl-1 bg-[#eee] focus:outline-none"
                    value={values[key] || ""}
                    onChange={(e) => applyValue(key, e.target.value)}
                  >
                    {(p.value || []).map((opt: string) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
        )}

        {activeTab === "swap" && (
          <div
            className="px-4 py-3 bg-[#fff]"
            style={{ maxHeight: "60vh", overflowY: "auto" }}
          >
            <div className="text-xs text-[#666] mb-2">
              Select a different door — it replaces this one in the same place.
            </div>
            {swapLoading && (
              <div className="text-sm text-[#999] py-4 text-center">
                Loading door models…
              </div>
            )}
            {!swapLoading && swapError && (
              <div className="text-sm text-[#c00] py-4 text-center">
                {swapError}
              </div>
            )}
            {!swapLoading && !swapError && (
              <div className="grid grid-cols-2 gap-2">
                {swapModels.map((m: any) => (
                  <div
                    key={m._id}
                    onClick={() => handleSwapClick(m)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid #e5e5e5",
                      borderRadius: 6,
                      overflow: "hidden",
                      background: "#fafafa",
                    }}
                    title={m.name}
                  >
                    <div
                      style={{
                        height: 90,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#f2f2f2",
                      }}
                    >
                      {m.thumbnails || m.thumbnail ? (
                        <img
                          src={m.thumbnails || m.thumbnail}
                          alt={m.name}
                          style={{
                            maxHeight: "100%",
                            maxWidth: "100%",
                            objectFit: "contain",
                          }}
                        />
                      ) : (
                        <span className="text-xs text-[#aaa]">No image</span>
                      )}
                    </div>
                    <div
                      className="px-2 py-1 text-xs font-medium truncate"
                      style={{ color: "#333" }}
                    >
                      {m.name || "Door"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activeChannel && allFinishings?.length ? (
        <WallFinishingsModal
          isDarkMode={isDarkMode}
          title="Door color"
          selectedFinishing={selectedByChannel[activeChannel] || null}
          finishingCategories={finishingCategories}
          filteredFinishings={filteredFinishings}
          setSelectedFinishing={(f: Finishing) =>
            applyFinishing(activeChannel, f)
          }
          setShowTextureMenu={(v: boolean) => {
            if (!v) setActiveChannel(null);
          }}
          handleTextureCategorySelection={handleTextureCategorySelection}
        />
      ) : null}
    </>
  );
}

export default DoorPropertiesModal;
