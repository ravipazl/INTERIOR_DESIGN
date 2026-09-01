import React, { useEffect, useState, useCallback } from "react";
import Tree, { useTreeState, treeHandlers } from "react-hyper-tree";
import RoomPanelModalCard from "./roomPanelModalCard";
import RoomPanelModal from "./roomPanelModal";
import { Category } from "@pazl/entities/Category";
import { Model } from "@pazl/entities/Model";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import { ModelsService } from "@pazl/services/ModelsService";
import { CategoriesService } from "@pazl/services/categoriesService";
import { TreeNode } from "@pazl/helpers/Types";
import { handleAddItemsToScene } from "@pazl/viewer3d-state-interface";
import RoomPanelSkeleton from "./roomPanelSkeleton";
import { MODEL_TYPES } from "@pazl/entities/Model";
import UploadModelModal from "@pazl/components/UploadModelModal";
import AddCategoryModal from "@pazl/components/AddCategoryModal";

interface RoomPanelTypeProps {
  onHideRoomPanel: () => void;
  onHideObjectPanel: () => void;
  isOnlyWallItems: boolean;
  isOnlyFloorItems: boolean;
}

// Placement-type pill tabs for the Explore panel. Each pill filters the
// currently-shown (category-filtered) models by placement type. `types: null`
// means "no filter" (show everything). Ceiling = literal 4 (ROOF) which the
// TS MODEL_TYPES enum doesn't declare. "In-wall" groups embedded types 3 & 7.
const PLACEMENT_FILTERS: {
  key: string;
  label: string;
  types: number[] | null;
}[] = [
  { key: "all", label: "All", types: null },
  { key: "floor", label: "Floor", types: [MODEL_TYPES.FLOOR_UNIT] },
  { key: "wall", label: "Wall", types: [MODEL_TYPES.WALL_UNIT] },
  { key: "ceiling", label: "Ceiling", types: [4] },
  {
    key: "inwall",
    label: "In-wall",
    types: [MODEL_TYPES.IN_WALL_UNIT, MODEL_TYPES.IN_WALL_FLOOR_UNIT],
  },
];

// Coohom-style Sort dropdown options. Purely client-side reordering of the
// models already shown — additive, changes nothing about how they load.
const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "name-asc", label: "Name (A–Z)" },
  { key: "name-desc", label: "Name (Z–A)" },
  { key: "price-asc", label: "Price (Low–High)" },
  { key: "price-desc", label: "Price (High–Low)" },
];

// Coohom-style pagination — how many item/sub-category cards per page.
const PAGE_SIZE = 12;

// Coohom-style monochrome line icons (SVG). Each category name maps to a set
// of stroke paths drawn in a single grey color (inherits text color via
// `currentColor`) — matching Coohom's clean, minimal look. Matching is
// case-insensitive and by keyword ("Living Room", "livingroom", "LIVINGROOM"
// all match). Purely cosmetic + additive: unknown names fall back to a neutral
// box. No image files, no imports, works in light + dark mode.
type CatIcon = { keys: string[]; d: string[] };

const CATEGORY_ICON_DEFS: CatIcon[] = [
  // Kitchen — cooking pot with lid, side handles and steam.
  { keys: ["kitchen"], d: ["M4 10h16v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z", "M3 10h18", "M4 12H2M20 12h2", "M9 7c0-1 1-1 1-2M14 7c0-1 1-1 1-2"] },
  // Living room — sofa with cushioned back, arms and legs.
  { keys: ["living"], d: ["M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3", "M3 10a2 2 0 0 1 2 2v3h14v-3a2 2 0 0 1 4 0v6H3z", "M6 18v2M18 18v2"] },
  // Bedroom — bed with headboard, mattress, pillow and legs.
  { keys: ["bedroom", "bed"], d: ["M2 19V8", "M2 12h16a4 4 0 0 1 4 4v3", "M2 15h20", "M5 12v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2", "M2 19v2M22 19v2"] },
  // Dining — plate with fork and knife.
  { keys: ["dining"], d: ["M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z", "M4 3v6M6 3v6M5 9v12", "M20 3c-1 0-1.5 2.5-1.5 4.5S19 11 20 11v10"] },
  // Bath — bathtub with faucet and feet.
  { keys: ["bath", "toilet"], d: ["M4 11V6a2 2 0 0 1 4 0v1", "M2 11h20v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z", "M6 18l-1 2M18 18l1 2"] },
  // Construction / building — house with roof and door.
  { keys: ["construction", "structure", "building"], d: ["M3 10.5 12 3l9 7.5", "M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9", "M10 21v-6h4v6"] },
  // Finishes — paint roller with handle.
  { keys: ["finish", "material", "paint"], d: ["M4 4h11v5H4z", "M15 6h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5", "M10 12h1v3M9 15h3v6H9z"] },
  // Office — briefcase.
  { keys: ["office", "study", "work"], d: ["M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z", "M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M3 13h18"] },
  // Outdoor — tree / plant.
  { keys: ["outdoor", "garden", "balcony"], d: ["M12 2l4 6h-2.5l3 5H7.5l3-5H8z", "M12 13v8"] },
  // Doors / hallway — door with handle.
  { keys: ["hallway", "entry", "corridor", "door"], d: ["M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17", "M4 21h14", "M13 12v1"] },
  // Baby & kids — stacked toy blocks.
  { keys: ["baby", "kid", "child", "nursery"], d: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M9 14h6v6H9z"] },
  // Entertainment — TV / monitor on a stand.
  { keys: ["entertain", "media", "tv"], d: ["M3 5h18v11H3z", "M9 20h6", "M12 16v4"] },
  // Decor — framed picture with sun and mountain.
  { keys: ["decor", "décor", "art", "picture"], d: ["M4 4h16v16H4z", "M8 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3", "M20 15l-4-4-6 6-2-2-4 4"] },
  // Lighting — light bulb.
  { keys: ["light", "lamp"], d: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.2 1 2v.5h6v-.5c0-.8.4-1.4 1-2A6 6 0 0 0 12 3z"] },
  // Windows — window with cross frame.
  { keys: ["window"], d: ["M4 4h16v16H4z", "M12 4v16M4 12h16"] },
  // Storage / wardrobe / tall units — two-door cabinet with handles.
  { keys: ["storage", "wardrobe", "closet", "cabinet", "tall", "unit"], d: ["M4 3h16v18H4z", "M12 3v18", "M9.5 10v3M14.5 10v3"] },

  // — Kitchen items — (checked AFTER room types; "teapot" MUST come before
  // "pot" so "Teapot" doesn't match the pot icon by substring.)
  { keys: ["bottle"], d: ["M10 2h4v3l1 2v12a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V7l1-2z", "M9 13h6"] },
  { keys: ["bowl"], d: ["M3 11h18a9 9 0 0 1-9 8 9 9 0 0 1-9-8z", "M2 11h20"] },
  { keys: ["teapot"], d: ["M4 11h12v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z", "M16 12c2 .5 3 1.5 4 3", "M9 8h2", "M16 13h2a2 2 0 0 1 0 4"] },
  { keys: ["cup"], d: ["M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z", "M16 9h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2", "M4 21h14"] },
  { keys: ["mug"], d: ["M5 5h10v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z", "M15 7h2a3 3 0 0 1 0 6h-2"] },
  { keys: ["fork"], d: ["M6 3v6M9 3v6M12 3v6", "M6 9h6", "M9 9v12"] },
  { keys: ["knife"], d: ["M4 18 14 8a2 2 0 0 1 3 3L7 21z", "M14.5 8.5l2 2"] },
  { keys: ["spoon"], d: ["M12 3a3 4 0 1 0 0 8 3 4 0 0 0 0-8z", "M12 11v10"] },
  { keys: ["glass"], d: ["M7 3h10l-1.5 18h-7z", "M8 9h8"] },
  { keys: ["jar"], d: ["M6 4h12v3H6z", "M7 7h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"] },
  { keys: ["plate"], d: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"] },
  { keys: ["pan"], d: ["M4 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0z", "M16 12h6"] },
  { keys: ["pot"], d: ["M5 9h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z", "M4 9h16", "M5 11H3M19 11h2"] },

  // — Living-room & bedroom items — (Door/Window/Lamp/Lights/Tv Stand/Wardrobe
  // already match the room-type/keyword icons above; these fill the rest.)
  { keys: ["armchair", "chair"], d: ["M6 11V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4", "M5 11a1.5 1.5 0 0 1 1.5 1.5V16h11v-2.5A1.5 1.5 0 0 1 19 11", "M6 16v3M18 16v3"] },
  { keys: ["sofa", "couch"], d: ["M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3", "M3 10a2 2 0 0 1 2 2v3h14v-3a2 2 0 0 1 4 0v6H3z", "M6 18v2M18 18v2"] },
  { keys: ["bookshelf", "shelf", "book"], d: ["M4 3h16v18H4z", "M4 9h16M4 15h16", "M7 4v4M9 4v4M11 5v3"] },
  { keys: ["table"], d: ["M3 8h18", "M6 8v11M18 8v11", "M6 15h12"] },
  { keys: ["curtain", "drape", "blind"], d: ["M4 4h16", "M6 4v14M10 4v14M14 4v14M18 4v14", "M5 18q3.5 2 6.5 0t6.5 0"] },
  { keys: ["cushion", "pillow"], d: ["M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M6 7l2.5 2.5M18 7l-2.5 2.5M6 17l2.5-2.5M18 17l-2.5-2.5"] },
  { keys: ["rug", "carpet"], d: ["M4 7h16v10H4z", "M6 9h12v6H6z", "M9 9v6M12 9v6M15 9v6"] },
  { keys: ["cot", "crib"], d: ["M2 19V9", "M2 13h16a4 4 0 0 1 4 4v3", "M2 16h20", "M5 13v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2", "M2 19v2M22 19v2"] },
];

const DEFAULT_ICON_D = [
  "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  "M3.27 6.96 12 12.01l8.73-5.05",
  "M12 22.08V12",
];

function CategoryIcon({ name }: { name: string }) {
  const n = String(name || "").toLowerCase();
  const def = CATEGORY_ICON_DEFS.find((entry) =>
    entry.keys.some((k) => n.includes(k))
  );
  const paths = def ? def.d : DEFAULT_ICON_D;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden="true"
    >
      {paths.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

function RoomPanel({
  onHideRoomPanel,
  onHideObjectPanel,
  isOnlyWallItems,
  isOnlyFloorItems,
}: RoomPanelTypeProps) {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedTreeNode, setSelectedTreeNode] = useState({} as TreeNode);
  const [showRoomPanelModal, setShowRoomPanelModal] = useState<boolean>(false);
  const [selectedModels, setSelectedModels] = useState<Model[]>([]);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [roomPanelData, setRoomPanelData] = useState<Category[]>([]);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showAddCategoryModal, setShowAddCategoryModal] =
    useState<boolean>(false);
  // null = create main; string = preset parent (sub-category creation)
  const [addCategoryParentId, setAddCategoryParentId] =
    useState<string | null>(null);
  // Active placement-type pill (Explore filter). Resets to "all" whenever a
  // new category is opened, so the filter is scoped to the current category.
  const [placementFilter, setPlacementFilter] = useState<string>("all");
  // Coohom-style Sort dropdown selection (client-side reorder of shown models).
  const [sortBy, setSortBy] = useState<string>("default");
  // Coohom-style search box — filters the shown items/sub-categories by name.
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Coohom-style pagination — current page (1-based) of the shown grid.
  const [page, setPage] = useState<number>(1);
  // Full catalog cache — used so a placement-type pill can gather models from
  // the selected category AND all its sub-categories (not just the leaf).
  const [allModelsCache, setAllModelsCache] = useState<any[]>([]);
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;
  const { required, handlers } = useTreeState({
    data: treeData,
    id: "tree",
  });

  useEffect(() => {
    getRoomPanelData();
  }, []);

  useEffect(() => {
    if (roomPanelData.length) {
      handleAddTreeData();
    }
  }, [roomPanelData]);

  // Reset the placement-type pill to "All" and refresh the full catalog cache
  // each time a different category is opened.
  useEffect(() => {
    setPlacementFilter("all");
    setSearchQuery("");
    (async () => {
      try {
        const all = await ModelsService.getModelsFromLocalStorage();
        setAllModelsCache(Array.isArray(all) ? all : []);
      } catch (_) {
        /* non-fatal */
      }
    })();
  }, [selectedTreeNode]);

  // Whenever the shown set changes (category / search / sort / placement),
  // jump back to page 1 so the user isn't stranded on an empty page.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortBy, placementFilter, selectedTreeNode]);

  const activePlacementFilter = PLACEMENT_FILTERS.find(
    (f) => f.key === placementFilter
  );

  // Slice a shown list down to the current page.
  const pageSlice = (list: any[]): any[] =>
    Array.isArray(list)
      ? list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      : [];

  // Prev / "page N of M" / Next controls. Renders nothing for a single page.
  const renderPagination = (total: number) => {
    const totalPages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-3 mt-4 mb-1 text-xs text-[#414063] dark:text-neutral-200">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-2.5 py-1 rounded border border-[#C2C1DB] disabled:opacity-40 hover:bg-[#E9E5EC] dark:hover:bg-neutral-600"
        >
          ‹
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="px-2.5 py-1 rounded border border-[#C2C1DB] disabled:opacity-40 hover:bg-[#E9E5EC] dark:hover:bg-neutral-600"
        >
          ›
        </button>
      </div>
    );
  };

  // Client-side sort of the models currently shown in the grid. Never mutates
  // the source array (copies first). "default" leaves the original order.
  const sortModels = (list: any[]): any[] => {
    if (!Array.isArray(list) || sortBy === "default") return list;
    const arr = [...list];
    switch (sortBy) {
      case "name-asc":
        arr.sort((a, b) =>
          String(a?.name || "").localeCompare(String(b?.name || ""))
        );
        break;
      case "name-desc":
        arr.sort((a, b) =>
          String(b?.name || "").localeCompare(String(a?.name || ""))
        );
        break;
      case "price-asc":
        arr.sort((a, b) => (Number(a?.price) || 0) - (Number(b?.price) || 0));
        break;
      case "price-desc":
        arr.sort((a, b) => (Number(b?.price) || 0) - (Number(a?.price) || 0));
        break;
    }
    return arr;
  };

  // Collect a category id plus ALL its descendant category ids, so a
  // placement filter at a parent (e.g. KITCHEN) reaches models stored under
  // its sub-categories (Pan, Mug, …).
  const collectCategoryIds = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      roomPanelData.forEach((c: any) => {
        if (
          c?._id &&
          c?.parentCategoryId &&
          ids.has(c.parentCategoryId) &&
          !ids.has(c._id)
        ) {
          ids.add(c._id);
          grew = true;
        }
      });
    }
    return ids;
  };

  // When a specific placement pill is active, gather every model in the
  // selected category's subtree whose type matches. ("All" uses the normal
  // category browsing below instead.)
  const rootCategoryId = selectedTreeNode?.data?.id;
  const subtreeFilteredModels =
    activePlacementFilter?.types && rootCategoryId
      ? (() => {
          const ids = collectCategoryIds(rootCategoryId);
          const types = activePlacementFilter.types!;
          return allModelsCache.filter(
            (m: any) =>
              ids.has(m.categoryId) && types.includes(Number(m.type))
          );
        })()
      : [];

  // Coohom-style name search. Empty query = no filtering (everything shows).
  const searchQ = searchQuery.trim().toLowerCase();
  const matchName = (name: any) =>
    !searchQ || String(name || "").toLowerCase().includes(searchQ);

  // Final lists shown in the grid = search-filtered, then sorted. Sub-category
  // cards are filtered by their name too so search works at parent level.
  const shownSubtreeModels = sortModels(
    subtreeFilteredModels.filter((m: any) => matchName(m?.name))
  );
  const shownLeafModels = sortModels(
    (selectedModels || []).filter((m: any) => matchName(m?.name))
  );
  const shownChildren = (selectedTreeNode?.children || []).filter((c: any) =>
    matchName(c?.data?.name ?? c?.name)
  );

  const handleAddTreeData = async () => {
    const nodeMap = new Map();
    await Promise.all(
      roomPanelData.map((node) => {
        if (node._id) {
          nodeMap.set(node._id, {
            id: node._id,
            name: node.name,
            url: node.thumbnail,
            parentCategoryId: node.parentCategoryId,
            children: [],
          });
        }
      })
    );
    await Promise.all(
      roomPanelData.map((node) => {
        if (node.parentCategoryId && node._id) {
          const parentNode = nodeMap.get(node.parentCategoryId);
          if (parentNode) {
            parentNode.children.push(nodeMap.get(node._id));
          }
        }
      })
    );

    // Set the root nodes of the tree
    const rootNodes = roomPanelData
      .filter((node) => !node.parentCategoryId)
      .map((node) => nodeMap.get(node._id));
    setTreeData(rootNodes);
  };

  const getRoomPanelData = async () => {
    const response = await CategoriesService.getCategoriesFromLocalStorage();
    if (response?.length) {
      const list = response.filter((category: Category) => !category.invisible);
      setRoomPanelData(list);
    }
  };

  const onRoomPanelTreeViewClick = async (node: any) => {
    console.debug(
      "DEBUG: roomPanel.tsx:70 ~ onRoomPanelTreeViewClick ~ node:",
      node
    );
    treeHandlers.trees.tree.handlers.setSelected(node, !node.options.opened);
    treeHandlers.trees.tree.handlers.setOpen(node, node.options.opened);
    if (!node.isSelected()) {
      const parent = node.getParent();
      if (parent) {
        setSelectedTreeNode(parent);
        treeHandlers.trees.tree.handlers.setSelected(
          parent,
          !node.options.opened
        );
        node.options.opened = false;
      } else {
        setShowRoomPanelModal(false);
      }
    }
    const allModels = await ModelsService.getModelsFromLocalStorage();
    if (allModels?.length) {
      /* node.data.children = node.data.children.filter((childNode: any) =>
        allModels.find((model: Model) => model.categoryId === childNode.id)
      );
      node.children = node.children.filter((childNode: any) =>
        allModels.find((model: Model) => model.categoryId === childNode.id)
      ); */
      setSelectedTreeNode(node);
      setShowRoomPanelModal(true);
      if (isOnlyWallItems) {
        let models = allModels.filter(
          (model: Model) =>
            model.type === MODEL_TYPES.WALL_UNIT ||
            model.type === MODEL_TYPES.IN_WALL_FLOOR_UNIT ||
            model.type === MODEL_TYPES.IN_WALL_UNIT
        );
        const filteredModels = models.filter(
          (model: any) =>
            model.categoryId === node.data.parentCategoryId ||
            model.categoryId === node.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else if (isOnlyFloorItems) {
        let models = allModels.filter(
          (model: Model) => model.type === MODEL_TYPES.FLOOR_UNIT
        );
        const filteredModels = models.filter(
          (model: any) =>
            model.categoryId === node.data.parentCategoryId ||
            model.categoryId === node.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else {
        const filteredModels = allModels.filter(
          (model: any) =>
            model.categoryId === node.data.parentCategoryId ||
            model.categoryId === node.data.id
        );
        setSelectedModels(filteredModels ?? []);
      }
    }
  };

  const onAddItemToSceneClick = (model: Model | FurnishedModel) => {
    console.debug("roomPanel.tsx ~ onAddItemToSceneClick ~ model", model);
    handleAddItemsToScene(model);
    setShowRoomPanelModal(false);
    onHideRoomPanel();
    onHideObjectPanel();
  };

  /**
   * Delete a user-created catalog model (Sketchfab / Tripo / upload). The
   * backend refuses if the model is part of the seeded catalog or still in
   * use; we surface those reasons via alert(). On success, we remove the
   * model from the open grid immediately AND refresh the cached catalog so
   * other parts of the UI see the change.
   */
  const handleDeleteCatalogModel = async (model: Model | any) => {
    const id = String(model?._id || "");
    if (!id) return;
    setDeletingModelId(id);
    try {
      await ModelsService.deleteCatalogModel(id);
      // Drop from the current grid right away so the card disappears.
      setSelectedModels((prev) => prev.filter((m) => m._id !== id));
      // Refresh the full models cache so the catalog tree + other panels
      // pick up the removal on next render.
      try {
        const resp = await ModelsService.getAllModels();
        const data: any = (resp as any)?.data ?? resp;
        if (Array.isArray(data)) {
          ModelsService.saveModelsToLocalStorage(data);
        }
      } catch (e) {
        console.warn(
          "handleDeleteCatalogModel: catalog refresh failed",
          e
        );
      }
    } catch (e: any) {
      if (e?.inUseCount != null) {
        alert(
          `Cannot delete — this model is placed in ${e.inUseCount} furnished item(s). Remove those placements first, then try again.`
        );
      } else if (e?.code === "protected") {
        alert(
          "This model is part of the seeded factory catalog and cannot be deleted from the UI."
        );
      } else {
        alert(e?.message || "Failed to delete model.");
      }
    } finally {
      setDeletingModelId(null);
    }
  };

  const refreshCategoriesTree = async () => {
    // Pull fresh from API (createCategory already updated the localStorage),
    // then rebuild the tree.
    const cats = await CategoriesService.getCategoriesFromLocalStorage();
    if (cats?.length) {
      const list = cats.filter((c: Category) => !c.invisible);
      setRoomPanelData(list);
    }
  };

  const refreshModelsForSelectedCategory = async () => {
    // 1. Fetch all models from backend (bypasses the localStorage cache).
    // 2. Persist them to localStorage so the rest of the catalog UI sees them.
    // 3. Re-filter for the currently-selected category and update the grid.
    try {
      const resp = await ModelsService.getAllModels();
      const data = resp?.data ?? resp;
      if (Array.isArray(data) && data.length) {
        ModelsService.saveModelsToLocalStorage(data);
      }
    } catch (e) {
      console.warn("refreshModelsForSelectedCategory: API refresh failed", e);
    }
    const allModels = await ModelsService.getModelsFromLocalStorage();
    if (!allModels?.length || !selectedTreeNode?.data) return;
    const filteredModels = allModels.filter(
      (model: any) =>
        model.categoryId === selectedTreeNode.data.parentCategoryId ||
        model.categoryId === selectedTreeNode.data.id
    );
    setSelectedModels(filteredModels ?? []);
  };

  const onSelectedTreeNodeChildren = async (child: any) => {
    console.debug(
      "DEBUG: roomPanel.tsx:88 ~ onSelectedTreeNodeChildren ~ child:",
      child
    );
    treeHandlers.trees.tree.handlers.setSelected(child, !child.options.opened);
    treeHandlers.trees.tree.handlers.setOpen(child, child.options.opened);
    setSelectedTreeNode(child);
    if (!child.isSelected()) {
      const parent = child.getParent();
      if (parent) {
        setSelectedTreeNode(parent);
        treeHandlers.trees.tree.handlers.setSelected(
          parent,
          !child.options.opened
        );
        child.options.opened = false;
      } else {
        setShowRoomPanelModal(false);
      }
    }
    const allModels = await ModelsService.getModelsFromLocalStorage();
    if (allModels?.length) {
      /* node.data.children = node.data.children.filter((childNode: any) =>
        allModels.find((model: Model) => model.categoryId === childNode.id)
      );
      node.children = node.children.filter((childNode: any) =>
        allModels.find((model: Model) => model.categoryId === childNode.id)
      ); */
      setSelectedTreeNode(child);
      setShowRoomPanelModal(true);
      if (isOnlyWallItems) {
        let models = allModels.filter(
          (model: Model) =>
            model.type === MODEL_TYPES.WALL_UNIT ||
            model.type === MODEL_TYPES.IN_WALL_FLOOR_UNIT ||
            model.type === MODEL_TYPES.IN_WALL_UNIT
        );
        const filteredModels = models.filter(
          (model: any) =>
            model.categoryId === child.data.parentCategoryId ||
            model.categoryId === child.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else if (isOnlyFloorItems) {
        let models = allModels.filter(
          (model: Model) => model.type === MODEL_TYPES.FLOOR_UNIT
        );
        const filteredModels = models.filter(
          (model: any) =>
            model.categoryId === child.data.parentCategoryId ||
            model.categoryId === child.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else {
        const filteredModels = allModels.filter(
          (model: any) =>
            model.categoryId === child.data.parentCategoryId ||
            model.categoryId === child.data.id
        );
        setSelectedModels(filteredModels ?? []);
      }
    }
  };

  const renderNode = useCallback(
    ({ node }: any) => (
      <div
        className={`group flex items-start min-h-[24px] py-1`}
        key={node.data.id}
      >
        <div
          onClick={() => onRoomPanelTreeViewClick(node)}
          className={`self-center cursor-pointer mt-1
                ${
                  !node.hasChildren()
                    ? ""
                    : node.hasChildren() && node.options.opened
                    ? "bg-[url('/public/assets/icons/down.png')] bg-no-repeat bg-contain w-[20px] h-[20px]"
                    : "bg-[url('/public/assets/icons/next.png')] bg-no-repeat bg-contain w-[20px] h-[20px]"
                }
          `}
        />
        <div
          className={`cursor-pointer w-full mr-1 cursor-pointer bg-no-repeat ${
            node.isSelected() ? "bg-[#E9E5EC]" : ""
          }`}
          onClick={() => onRoomPanelTreeViewClick(node)}
        >
          <div
            className={`font-normal text-sm py-1 flex items-center gap-1.5 ${
              node.isSelected()
                ? "text-primary dark:text-[#333333]"
                : "text-primary dark:text-neutral-50"
            }`}
          >
            <CategoryIcon name={node.data.name} />
            <span>{node.data.name}</span>
          </div>
        </div>
        {/* Hover "+" for main categories only — quick sub-category add */}
        {!node.data.parentCategoryId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAddCategoryParentId(node.data.id);
              setShowAddCategoryModal(true);
            }}
            className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 mr-1 rounded bg-[#414063] text-white hover:opacity-100"
            title={`Add a sub-category under "${node.data.name}"`}
          >
            +
          </button>
        )}
      </div>
    ),
    [isDarkMode]
  );

  return (
    <>
      {showRoomPanelModal && (
        <div className="fixed top-48 block left-[260px] z-10 h-full w-[320px] scrollbar shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700">
          <div className="h-screen mb-10px">
            <div className="bg-[#E9E5EC] dark:bg-[#333333] flex items-center justify-between px-4">
              <h5 className="p-2 text-sm text-center font-semibold leading-tight text-neutral-600 dark:text-neutral-50">
                {selectedTreeNode.data.name}
              </h5>
              <div className="flex items-center gap-3">
                <button
                  className="text-xs px-3 py-1 rounded bg-[#414063] text-white hover:opacity-90"
                  title="Upload your own .glb files into this category"
                  onClick={() => setShowUploadModal(true)}
                >
                  + Upload GLB
                </button>
                <img
                  className="finishing-modal-close-icon"
                  src={require("../../../images/close.svg")}
                  onClick={() => {
                    setShowRoomPanelModal(false);
                  }}
                />
              </div>
            </div>
            <div className="p-2 pb-[225px] max-h-full overflow-y-auto">
              {/* Coohom-style search box — type to filter the items /
                  sub-categories below by name. */}
              <div className="relative mb-3 px-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search items…"
                  className="w-full text-xs pl-8 pr-7 py-2 rounded-md border border-[#C2C1DB] bg-white dark:bg-neutral-600 dark:text-neutral-100 dark:border-neutral-500 focus:outline-none focus:border-[#414063]"
                />
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4-4" />
                </svg>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    title="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-100 leading-none"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Placement-type pill tabs — ALWAYS visible while the Explore
                  panel is open. "All" browses categories normally; a specific
                  pill (Floor/Wall/Ceiling/In-wall) shows every matching model
                  in the selected category AND its sub-categories. */}
              <div className="flex flex-wrap gap-1.5 mb-3 px-1">
                {PLACEMENT_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setPlacementFilter(f.key)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      placementFilter === f.key
                        ? "bg-[#414063] text-white border-[#414063]"
                        : "bg-transparent text-[#414063] dark:text-neutral-200 border-[#C2C1DB] hover:bg-[#E9E5EC] dark:hover:bg-neutral-600"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Coohom-style Sort dropdown — reorders the models shown below. */}
              <div className="flex items-center justify-end gap-2 mb-3 px-1">
                <label className="text-xs text-neutral-500 dark:text-neutral-300">
                  Sort
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="text-xs px-2 py-1 rounded border border-[#C2C1DB] bg-white dark:bg-neutral-600 dark:text-neutral-100 focus:outline-none"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {placementFilter !== "all" ? (
                /* A specific placement pill is active → show matching models
                   gathered from this category's whole subtree. */
                shownSubtreeModels.length ? (
                  <>
                  <div className="flex flex-wrap justify-start align-middle">
                    {pageSlice(shownSubtreeModels).map((model: any) => {
                      const m: any = model;
                      const canDelete = !!(
                        m.isUserUploaded ||
                        m.isFromSketchfab ||
                        m.isAiGenerated
                      );
                      return (
                        <RoomPanelModal
                          modalData={model}
                          key={model._id}
                          onAddItemToSceneClick={() =>
                            onAddItemToSceneClick(model)
                          }
                          canDelete={canDelete}
                          isDeleting={deletingModelId === model._id}
                          onDelete={() => handleDeleteCatalogModel(model)}
                        />
                      );
                    })}
                  </div>
                  {renderPagination(shownSubtreeModels.length)}
                  </>
                ) : (
                  <h1 className="my-24 flex text-[#414063] dark:text-[#ffffff] text-sm text-center align-center justify-center font-semibold leading-tight">
                    No {activePlacementFilter?.label} items in{" "}
                    {selectedTreeNode.data?.name
                      ? '"' + selectedTreeNode.data.name + '"'
                      : "this category"}
                    .
                  </h1>
                )
              ) : selectedTreeNode?.children?.length > 0 ? (
                /* "All" + a parent category → browse its sub-categories. */
                shownChildren.length ? (
                  <>
                  <div className="flex flex-wrap justify-start align-middle">
                    {pageSlice(shownChildren).map((child: any) => (
                      <RoomPanelModalCard
                        childItem={child}
                        key={child.id}
                        onSelectedChildrenNode={() =>
                          onSelectedTreeNodeChildren(child)
                        }
                      />
                    ))}
                  </div>
                  {renderPagination(shownChildren.length)}
                  </>
                ) : (
                  <h1 className="my-24 flex text-[#414063] dark:text-[#ffffff] text-sm text-center align-center justify-center font-semibold leading-tight">
                    No matches for “{searchQuery}”.
                  </h1>
                )
              ) : selectedModels?.length ? (
                /* "All" + a leaf category → its models. */
                shownLeafModels.length ? (
                <>
                <div className="flex flex-wrap justify-start align-middle">
                  {pageSlice(shownLeafModels).map((model) => {
                    const m: any = model;
                    const canDelete = !!(
                      m.isUserUploaded ||
                      m.isFromSketchfab ||
                      m.isAiGenerated
                    );
                    return (
                      <RoomPanelModal
                        modalData={model}
                        key={model._id}
                        onAddItemToSceneClick={() =>
                          onAddItemToSceneClick(model)
                        }
                        canDelete={canDelete}
                        isDeleting={deletingModelId === model._id}
                        onDelete={() => handleDeleteCatalogModel(model)}
                      />
                    );
                  })}
                </div>
                {renderPagination(shownLeafModels.length)}
                </>
                ) : (
                  <h1 className="my-24 flex text-[#414063] dark:text-[#ffffff] text-sm text-center align-center justify-center font-semibold leading-tight">
                    No matches for “{searchQuery}”.
                  </h1>
                )
              ) : (
                <h1 className="my-24 flex text-[#414063] dark:text-[#ffffff] text-sm text-center align-center justify-center font-semibold leading-tight">
                  Sorry, no objects available for{" "}
                  {selectedTreeNode.data?.name
                    ? '"' + selectedTreeNode.data.name + '"'
                    : ""}
                  .
                </h1>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="fixed top-48 block left-1 z-10 w-64 h-screen scrollbar shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700">
        <div className="h-screen">
          <div className="bg-[#E9E5EC] dark:bg-[#333333] flex items-center justify-between px-2 py-1">
            <h5 className="text-sm font-semibold leading-tight text-neutral-600 dark:text-neutral-50">
              Selected Room Type
            </h5>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setAddCategoryParentId(null);
                  setShowAddCategoryModal(true);
                }}
                className="text-xs px-2 py-0.5 rounded bg-[#414063] text-white hover:opacity-90"
                title="Add a new top-level category (or pick a parent inside the modal)"
              >
                + Category
              </button>
              <button
                type="button"
                onClick={() => onHideRoomPanel()}
                className="text-neutral-500 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-white leading-none text-lg px-1"
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
          <div className="p-2 pb-[225px] max-h-full overflow-y-auto">
            {treeData?.length ? (
              <Tree {...required} {...handlers} renderNode={renderNode} />
            ) : (
              <RoomPanelSkeleton />
            )}
          </div>
        </div>
      </div>
      <UploadModelModal
        show={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={refreshModelsForSelectedCategory}
        categoryId={selectedTreeNode?.data?.id ?? ""}
        categoryName={selectedTreeNode?.data?.name}
        defaultType={1}
      />
      <AddCategoryModal
        show={showAddCategoryModal}
        onClose={() => setShowAddCategoryModal(false)}
        onSuccess={refreshCategoriesTree}
        presetParentId={addCategoryParentId}
      />
    </>
  );
}

export default RoomPanel;
