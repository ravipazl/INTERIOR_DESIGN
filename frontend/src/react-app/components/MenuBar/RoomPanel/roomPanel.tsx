import React, { useEffect, useState, useCallback } from "react";
import Tree, { useTreeState, treeHandlers } from "react-hyper-tree";
import RoomPanelModalCard from "./roomPanelModalCard";
import RoomPanelModal from "./roomPanelModal";
import { Category } from "@pazl/entities/Category";
import { Model } from "@pazl/entities/Model";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import { ModelsService } from "@pazl/services/ModelsService";
import { generateAndUploadThumbnail } from "@pazl/helpers/generateThumbnail";
import { CategoriesService } from "@pazl/services/categoriesService";
import { TreeNode } from "@pazl/helpers/Types";
import { handleAddItemsToScene } from "@pazl/viewer3d-state-interface";
import RoomPanelSkeleton from "./roomPanelSkeleton";
import { MODEL_TYPES } from "@pazl/entities/Model";
import UploadModelModal from "@pazl/components/UploadModelModal";
import AddCategoryModal from "@pazl/components/AddCategoryModal";
import EditCategoryModal from "@pazl/components/EditCategoryModal";
import useDockTop from "@pazl/react-app/hooks/useDockTop";

interface RoomPanelTypeProps {
  onHideRoomPanel: () => void;
  onHideObjectPanel: () => void;
  isOnlyWallItems: boolean;
  isOnlyFloorItems: boolean;
  /** The three ways to bring a model in. They were toolbar buttons; the
   *  modals they open still live in furnishMenu, which renders this panel,
   *  so plain callbacks are enough — no portal or event bus needed. */
  onUpload?: () => void;
  onGenerate?: () => void;
  onSearchModels?: () => void;
  /** Auto-furnish: fill the selected room from a room template. */
  onAutoFurnish?: () => void;
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

// Panel geometry. The item grid's offset is DERIVED from the category panel's
// width — they were separate literals, so widening the category panel to match
// the Floor plan panel left the grid starting 56px underneath it.
const CAT_INSET = 4;   // gap between the nav rail and the category panel
// 200 -> 260. The deepest rows carry the longest names ("3 Drawer system along
// profile handles" under Below Counter Storage > 3 Drawer system) and lose 20px
// of width to indent at every level, so at 200 a leaf had ~82px — enough for a
// dozen characters. The item grid follows automatically, ITEMS_LEFT being
// derived from this.
const CAT_W = 260;     // category panel width
// 320 -> 250. Two 147px cards (135 + 12 margin) fitted the old 304px of usable
// width, so models came two-up and small. One per row, at 250, lets the card
// grow to 210px — see roomPanelModal.tsx. It cannot go much below this: the
// header row (Select / + Upload GLB / x) needs ~224px and the bulk-delete
// toolbar ~250px, so a narrower panel breaks those onto extra lines.
const ITEMS_W = 250;   // item grid width (1 card per row)
const ITEMS_LEFT = CAT_INSET + CAT_W;

/**
 * The "Previews" / "Retake all" buttons in the item panel header.
 *
 * Off. Flip to true to show them again — nothing else needs changing.
 *
 * They render a catalogue picture for models that already have none, by
 * running the same offscreen renderer the app uses after every upload. Kept
 * behind a switch rather than deleted because there is no other way to do it:
 * package.json's `thumbnails:generate` points at scripts/generate-thumbnails.js,
 * which has never existed in this repository — it belongs to the other Pazl
 * project and renders through a local Blender install.
 */
const SHOW_PREVIEW_TOOLS = false;

/** Collapsible section, matching the Floor plan panel's sections. `action`
 *  renders on the header row (used for the Category "+"), and stops its own
 *  click from toggling the section. */
function PanelSection({
  id,
  title,
  open,
  onToggle,
  action,
  grow,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  action?: React.ReactNode;
  /** Take the leftover height and scroll inside. For the category tree, which
   *  is the only section long enough to need it. */
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`border-b border-[color:var(--pz-panel-border)] ${
        grow && open ? "flex-1 min-h-0 flex flex-col" : "shrink-0"
      }`}
    >
      <div className="w-full flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span
            className={`material-symbols-outlined text-[18px] text-[color:var(--pz-panel-muted)] transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            chevron_right
          </span>
          <span className="text-[13px] font-semibold text-[color:var(--pz-text)] truncate">
            {title}
          </span>
        </button>
        {action}
      </div>
      {open ? (
        <div
          className={`px-3 pb-3 ${
            grow ? "flex-1 min-h-0 overflow-y-auto" : ""
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Tool card, same treatment as Walls / Select in the Floor plan panel. */
function ToolCard({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[color:var(--pz-panel-border)] bg-white dark:bg-[#3a3a3a] p-2 h-[62px] transition hover:border-[color:var(--pz-accent)]"
    >
      <span className="material-symbols-outlined text-[20px] text-[color:var(--pz-accent)]">
        {icon}
      </span>
      <span className="text-[10.5px] leading-tight text-neutral-600 dark:text-neutral-200 text-center truncate w-full">
        {label}
      </span>
    </button>
  );
}

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
  onUpload,
  onGenerate,
  onSearchModels,
  onAutoFurnish,
}: RoomPanelTypeProps) {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedTreeNode, setSelectedTreeNode] = useState({} as TreeNode);
  const [showRoomPanelModal, setShowRoomPanelModal] = useState<boolean>(false);
  const [selectedModels, setSelectedModels] = useState<Model[]>([]);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  // Deleting several models at once (header: Select → tick cards → Delete (N)).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  // Re-taking the catalogue preview pictures for the selected branch.
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewProgress, setPreviewProgress] = useState("");
  const previewStop = React.useRef(false);
  const [roomPanelData, setRoomPanelData] = useState<Category[]>([]);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showAddCategoryModal, setShowAddCategoryModal] =
    useState<boolean>(false);
  const [showEditCategoryModal, setShowEditCategoryModal] =
    useState<boolean>(false);
  const [editingCategoryNode, setEditingCategoryNode] = useState<{
    id: string;
    name: string;
    parentCategoryId?: string | null;
  } | null>(null);
  // The category the delete button is asking about, with what it holds. Set
  // only when the category is empty — see whatCategoryHolds.
  const [deletingCategory, setDeletingCategory] = useState<{
    id: string;
    name: string;
    node: any;
  } | null>(null);
  // Typed back by the user before a large branch is removed.
  const [deleteTyped, setDeleteTyped] = useState<string>("");
  const [deleteBusy, setDeleteBusy] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  // null = create main; string = preset parent (sub-category creation)
  // Both sections start open — the panel is the reason you are on this step.
  const dockTop = useDockTop();
  const [openSections, setOpenSections] = useState<string[]>([
    "addmodel",
    "category",
  ]);
  const toggleSection = (id: string) =>
    setOpenSections((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id]
    );
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
    // A finished-preview message belongs to the branch it ran on; carrying it
    // to the next category would claim work that never happened there.
    setPreviewProgress("");
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

  /**
   * Every model in the selected category and below it — what the preview job
   * works on, so picking "Tall Units" covers the whole branch rather than the
   * one leaf that happens to be open.
   */
  const modelsInSelectedBranch = (): any[] => {
    const rootId = selectedTreeNode?.data?.id;
    if (!rootId) return [];
    const ids = collectCategoryIds(rootId);
    const all = allModelsCache.length ? allModelsCache : selectedModels;
    return (all || []).filter((m: any) => ids.has(String(m.categoryId)));
  };

  /**
   * Take the catalogue preview pictures again for this branch.
   *
   * There is no script for this. package.json carries `thumbnails:generate`,
   * but it points at scripts/generate-thumbnails.js, which has never existed in
   * this repository — it belongs to the other Pazl project and renders with a
   * local Blender install, so it can neither be pushed here nor run on the
   * server. What DOES work is the renderer this app already uses on every
   * upload: it draws the .glb in an offscreen canvas and posts the image to
   * /thumbnail-upload. This simply runs that over models that already exist.
   *
   * `redoAll` matters more than it looks. A tall unit whose GLB was grey when
   * its picture was taken HAS a thumbnail — a photograph of a grey cabinet — so
   * a "only the missing ones" pass would skip exactly the cards that are wrong.
   * After a wood bake you want every picture taken again.
   *
   * One at a time on purpose: each render builds a WebGL context and uploads a
   * file, and a hundred at once would exhaust the browser's context limit and
   * fail in a way that looks like a bug in the models.
   */
  const generatePreviews = async (redoAll: boolean) => {
    const all = modelsInSelectedBranch();
    const todo = redoAll ? all : all.filter((m: any) => !m?.thumbnail);
    if (!todo.length) {
      setPreviewProgress(
        all.length ? "Every model here already has a picture." : "No models here."
      );
      return;
    }
    previewStop.current = false;
    setPreviewBusy(true);
    let done = 0;
    let failed = 0;
    for (const m of todo) {
      if (previewStop.current) break;
      setPreviewProgress(`Rendering ${done + failed + 1} of ${todo.length}…`);
      // One bad model must not end the run — it is reported at the end.
      const ok = await generateAndUploadThumbnail(
        String(m._id),
        String(m.modelFileUrl || "")
      );
      if (ok) done += 1;
      else failed += 1;
    }
    setPreviewBusy(false);
    setPreviewProgress(
      `${done} picture(s) updated` +
        (failed ? ` · ${failed} failed` : "") +
        (previewStop.current ? " · stopped" : "") +
        ". Reload to see them."
    );
    // The cards read their image once, from the thumbnail the model carried
    // when the panel opened, so they do not change under you — hence "Reload".
    // Nothing is refreshed here on purpose: the pictures are already saved on
    // the server, and a half-refreshed panel would be harder to trust than a
    // plain reload.
  };
  /**
   * What a category holds: its sub-categories and its models, counting every
   * level below it, not just the first.
   *
   * A category may only be deleted when this is empty. The server will remove
   * one regardless, which would orphan whatever was inside — the models would
   * keep a categoryId pointing at a category that no longer exists and vanish
   * from the tree without being deleted. So the guard lives here, where the
   * counts are, and the message can say what to clear first.
   */
  const whatCategoryHolds = useCallback(
    (node: any) => {
      const ids: string[] = [];
      const walk = (n: any) => {
        ids.push(String(n?.data?.id ?? n?.id));
        (n?.children || []).forEach(walk);
      };
      (node?.children || []).forEach(walk);
      const subCategories = ids.length;
      const self = String(node?.data?.id ?? node?.id);
      const models = (allModelsCache || []).filter((m: any) =>
        [self, ...ids].includes(String(m?.categoryId))
      ).length;
      return { subCategories, models, empty: subCategories === 0 && models === 0 };
    },
    [allModelsCache]
  );

  /**
   * Remove a category and everything beneath it, deepest first.
   *
   * Order matters: a model must go before the category holding it, and a
   * sub-category before its parent, or whatever is left points at something
   * that no longer exists — invisible in the tree but still in the database.
   *
   * The server refuses to delete a model that a project is using, so this can
   * legitimately half-finish. When that happens the categories still holding
   * those models are LEFT ALONE and the caller is told which and why; a partly
   * deleted branch that claimed success would be worse than one that stopped.
   */
  const deleteCategoryTree = useCallback(
    async (node: any, onProgress?: (msg: string) => void) => {
      const idOf = (n: any) => String(n?.data?.id ?? n?.id);
      // Deepest first: children before their parent.
      const order: any[] = [];
      const walk = (n: any) => {
        (n?.children || []).forEach(walk);
        order.push(n);
      };
      walk(node);

      const kept: string[] = [];
      // The categories that really went, so a parent is only removed once every
      // one of its children has been.
      const removed = new Set<string>();
      let models = 0;
      let categories = 0;

      for (const current of order) {
        const id = idOf(current);
        const mine = (allModelsCache || []).filter(
          (m: any) => String(m?.categoryId) === id
        );
        let blocked = false;
        for (const m of mine) {
          onProgress?.(`Deleting ${m.name}…`);
          try {
            await ModelsService.deleteCatalogModel(String(m._id));
            models += 1;
          } catch (e: any) {
            blocked = true;
            kept.push(`${m.name}: ${e?.message || "refused"}`);
          }
        }
        // Its own models could not all go, so this category has to stay.
        if (blocked) continue;
        // …and so does any category still holding a sub-category that stayed.
        // Children are visited first, so by now each one either got deleted or
        // did not; a parent may only go once ALL of its children have.
        const childrenGone = (current?.children || []).every((c: any) =>
          removed.has(idOf(c))
        );
        if (!childrenGone) continue;
        onProgress?.(`Deleting ${current?.data?.name ?? "category"}…`);
        try {
          await CategoriesService.deleteCategory(id);
          removed.add(id);
          categories += 1;
        } catch (e: any) {
          kept.push(`${current?.data?.name}: ${e?.message || "refused"}`);
        }
      }
      return { models, categories, kept };
    },
    [allModelsCache]
  );

  const shownChildren = (selectedTreeNode?.children || []).filter((c: any) =>
    matchName(c?.data?.name ?? c?.name)
  );

  /** A model is deletable when YOU created it (upload / Sketchfab / AI). */
  const isDeletable = (m: any) =>
    !!(m?.isUserUploaded || m?.isFromSketchfab || m?.isAiGenerated);
  /** The deletable models currently on screen — what "Select all" ticks. */
  const deletableShownModels = () =>
    (placementFilter !== "all" ? shownSubtreeModels : shownLeafModels).filter(
      isDeletable
    );
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
          (model: any) => model.categoryId === node.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else if (isOnlyFloorItems) {
        let models = allModels.filter(
          (model: Model) => model.type === MODEL_TYPES.FLOOR_UNIT
        );
        const filteredModels = models.filter(
          (model: any) => model.categoryId === node.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else {
        const filteredModels = allModels.filter(
          (model: any) => model.categoryId === node.data.id
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

  /**
   * Delete SEVERAL catalog models at once (the header's Select mode). Each one
   * goes through the same single-model call as the × on a card, so the same
   * rules apply: a seeded catalog model, or one still used in a project, is
   * kept and reported instead of deleted.
   */
  const handleDeleteSelectedModels = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || bulkBusy) return;
    // No confirmation pop-up: ticking the models and pressing Delete (N) is
    // the confirmation. Models used in a project are refused by the backend
    // and reported in the summary line.
    setBulkBusy(true);
    let deleted = 0;
    const kept: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setBulkProgress(`Deleting ${i + 1} of ${ids.length}…`);
      try {
        await ModelsService.deleteCatalogModel(ids[i]);
        deleted++;
        setSelectedModels((prev) => prev.filter((m) => m._id !== ids[i]));
      } catch (e: any) {
        kept.push(
          e?.inUseCount != null
            ? "still used in a project"
            : e?.code === "protected"
            ? "part of the built-in catalogue"
            : e?.message || "failed"
        );
      }
    }
    // One refresh at the end, not one per model.
    try {
      const resp = await ModelsService.getAllModels();
      const data: any = (resp as any)?.data ?? resp;
      if (Array.isArray(data)) ModelsService.saveModelsToLocalStorage(data);
    } catch (e) {
      console.warn("handleDeleteSelectedModels: catalog refresh failed", e);
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    const reasons = Array.from(new Set(kept));
    setBulkProgress(
      `${deleted} deleted` +
        (kept.length ? ` · ${kept.length} kept: ${reasons.join(", ")}` : "")
    );
    setTimeout(() => setBulkProgress(""), 6000);
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
      (model: any) => model.categoryId === selectedTreeNode.data.id
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
          (model: any) => model.categoryId === child.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else if (isOnlyFloorItems) {
        let models = allModels.filter(
          (model: Model) => model.type === MODEL_TYPES.FLOOR_UNIT
        );
        const filteredModels = models.filter(
          (model: any) => model.categoryId === child.data.id
        );
        setSelectedModels(filteredModels ?? []);
      } else {
        const filteredModels = allModels.filter(
          (model: any) => model.categoryId === child.data.id
        );
        setSelectedModels(filteredModels ?? []);
      }
    }
  };

  /**
   * The models of one category, under whatever placement restriction the panel
   * is running with. The same three cases the two selection handlers above
   * apply inline; a third copy would be the one that drifts.
   */
  const modelsInCategory = (allModels: any[], categoryId: string) => {
    const byCategory = (m: any) => m.categoryId === categoryId;
    if (isOnlyWallItems) {
      return (allModels || [])
        .filter(
          (m: Model) =>
            m.type === MODEL_TYPES.WALL_UNIT ||
            m.type === MODEL_TYPES.IN_WALL_FLOOR_UNIT ||
            m.type === MODEL_TYPES.IN_WALL_UNIT
        )
        .filter(byCategory);
    }
    if (isOnlyFloorItems) {
      return (allModels || [])
        .filter((m: Model) => m.type === MODEL_TYPES.FLOOR_UNIT)
        .filter(byCategory);
    }
    return (allModels || []).filter(byCategory);
  };

  /** Is there a level above the one the panel is showing? */
  const parentOfShown = () => {
    try {
      return selectedTreeNode?.getParent?.() || null;
    } catch (e) {
      return null;
    }
  };

  /**
   * Back — up one level in the panel.
   *
   * The panel drills down (Below Counter Storage → 2 Drawer system → … along
   * basic handles) and each click replaced what it showed, with no way to
   * return: you had to find the parent yourself in the category tree. This
   * walks back up and keeps the tree in step, so both sides agree on where you
   * are.
   *
   * Deliberately NOT onRoomPanelTreeViewClick(parent): that handler toggles a
   * node, so on an already-open parent it would deselect it and jump to the
   * GRANDparent. Going up is its own move, not a click.
   */
  const goToParent = async () => {
    const parent = parentOfShown();
    if (!parent) return;
    treeHandlers.trees.tree.handlers.setSelected(parent, true);
    treeHandlers.trees.tree.handlers.setOpen(parent, true);
    setSelectedTreeNode(parent);
    setShowRoomPanelModal(true);
    // Leaving a level behind: its search, page and ticked cards do not belong
    // to the level we are arriving at.
    setSearchQuery("");
    setPage(1);
    setSelectMode(false);
    setSelectedIds(new Set());
    const allModels = await ModelsService.getModelsFromLocalStorage();
    setSelectedModels(modelsInCategory(allModels, parent.data.id));
  };

  const renderNode = useCallback(
    ({ node }: any) => {
      // Check if this node is a sub-title (depth 2 or below, i.e. its parent itself is a subcategory)
      const parentCat = node.data.parentCategoryId
        ? roomPanelData.find((c: any) => c._id === node.data.parentCategoryId)
        : null;
      const isLeafSubTitle = !!parentCat?.parentCategoryId;

      return (
        // `relative` anchors the hover actions, which are positioned OUT OF THE
        // FLOW on purpose — see the overlay at the end of this row.
        <div
          className={`group relative flex items-start min-h-[24px] py-1`}
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
            className={`cursor-pointer flex-1 min-w-0 mr-1 cursor-pointer bg-no-repeat ${
              node.isSelected() ? "bg-[#E9E5EC]" : ""
            }`}
            onClick={() => onRoomPanelTreeViewClick(node)}
          >
            <div
              className={`font-normal text-sm py-1 flex items-center gap-1.5 min-w-0 ${
                node.isSelected()
                  ? "text-primary dark:text-[#333333]"
                  : "text-primary dark:text-neutral-50"
              }`}
            >
              <CategoryIcon name={node.data.name} />
              <span className="truncate" title={node.data.name}>
                {node.data.name}
              </span>
            </div>
          </div>
          {/* HOVER ACTIONS — OUT OF THE FLOW, DELIBERATELY.
              These used to be flex children hidden with opacity-0, which hides
              the ink but keeps the space: 88px gone from EVERY row, hovered or
              not, on top of 20px of indent per level. In a 200px panel that
              left a depth-2 row nothing at all, so the tree read "Bel...",
              "3..", ":" instead of its names.

              Positioned absolutely, they reserve nothing. The name gets the
              whole row at rest, and these appear over its tail only while the
              pointer is on that one row — so the background below has to match
              whatever the row is painted with, or the panel shows through. */}
          <div
            className={`absolute right-0 top-0 bottom-0 hidden group-hover:flex items-center pl-3 pr-1 ${
              node.isSelected() ? "bg-[#E9E5EC]" : "bg-white dark:bg-neutral-700"
            }`}
          >
            {/* Edit (rename) category / sub-title name */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingCategoryNode({
                  id: node.data.id,
                  name: node.data.name,
                  parentCategoryId: node.data.parentCategoryId,
                });
                setShowEditCategoryModal(true);
              }}
              className="text-xs px-1 py-0.5 mr-1 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-600 dark:text-neutral-200 shrink-0 flex items-center justify-center"
              title={`Edit name of "${node.data.name}"`}
            >
              <span className="material-symbols-outlined text-[13px] leading-none">
                edit
              </span>
            </button>
            {/* Quick sub-category add (+) icon for all categories and sub-titles */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAddCategoryParentId(node.data.id);
                setShowAddCategoryModal(true);
              }}
              className="text-xs px-1.5 py-0.5 rounded bg-[color:var(--pz-accent)] text-white shrink-0"
              title={`Add a sub-category under "${node.data.name}"`}
            >
              +
            </button>
            {/* Delete — LAST, and after a gap (ml-2).
                "+" is pressed constantly while building the tree and this cannot
                be undone; side by side at this size, the two are a few pixels
                apart. Grey like rename until the pointer is on it, so a column of
                these does not read as a column of errors.

                ALWAYS ENABLED, like the rename button beside it. It used to be
                disabled whenever the category held anything, which said "no"
                without saying what to do about it. The guard now lives in the
                dialog, which can explain what is inside and ask for the name back
                before removing it all. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteError("");
                setDeleteTyped("");
                setDeletingCategory({
                  id: node.data.id,
                  name: node.data.name,
                  node,
                });
              }}
              className="text-xs px-1 py-0.5 ml-2 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-600 dark:text-neutral-200 shrink-0 flex items-center justify-center hover:border-[#E3B7B2] hover:bg-[#FDF4F3] hover:text-[#B4372F]"
              title={`Delete "${node.data.name}"`}
            >
              <span className="material-symbols-outlined text-[13px] leading-none">
                delete
              </span>
            </button>
          </div>
        </div>
      );
    },
    [isDarkMode, roomPanelData]
  );

  return (
    <>
      {showRoomPanelModal && (
        <div className="fixed block z-10 scrollbar shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700"
          style={{
            width: ITEMS_W,
            left: `calc(var(--pz-nav-w, 0px) + ${ITEMS_LEFT}px)`,
            top: dockTop,
            bottom: 0,
          }}>
          <div className="h-full flex flex-col mb-10px">
            {/* TITLE ON ITS OWN LINE, BUTTONS BENEATH.
                This was one row — name beside buttons — so a long category name
                had nowhere to go but downward: "Fluted Glass shutter with
                wooden frame along basic handle - left opening" wrapped onto
                five lines and pushed the whole header, and the models below it,
                down the panel, and the buttons with it.

                Now the name has the panel's full width to itself and the
                buttons sit on their own line underneath, so however long a
                category is called the buttons stay put. The name is shown in
                FULL — it wraps rather than being cut, because "Fluted Glass
                shutter with wooden frame along basic ha…" hides the very part
                that tells one of these apart from the next. */}
            <div className="bg-[#E9E5EC] dark:bg-[#333333] flex flex-col px-4 py-2 gap-1.5">
              {/* BACK, beside the title. Rendered only when there IS a level
                  above — an arrow that does nothing at the top of a branch
                  reads as broken.

                  The two numbers here are the whole alignment fix:

                  • The box is 20px, not 24, and carries no top margin. The
                    title is 14px on leading-snug, so its first line is ~19px
                    tall; a 16px glyph centred in a 20px box lands 2px down,
                    level with the text. Centred in a 24px box it sat 5px down
                    — low against a line that is shorter than the box.
                  • No negative left margin. The box now starts exactly on the
                    header's 16px gutter, the same left edge as the "Select"
                    button on the row below, so the two lines share a margin.

                  `items-start` keeps the arrow on the FIRST line of a name long
                  enough to wrap ("2 Drawer system along basic handles"), rather
                  than floating beside the middle of two. */}
              <div className="flex items-start gap-1.5">
                {parentOfShown() && (
                  <button
                    type="button"
                    onClick={goToParent}
                    title={`Back to "${parentOfShown()?.data?.name}"`}
                    aria-label="Back"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-neutral-600 dark:text-neutral-100 hover:bg-white/70 dark:hover:bg-white/10"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                )}
                <h5 className="text-sm font-semibold leading-snug text-neutral-600 dark:text-neutral-50">
                  {selectedTreeNode.data.name}
                </h5>
              </div>
              <div className="flex items-center gap-3">
                {/* Select several models and delete them in one go. Only your
                    own uploads can be deleted, so only those can be ticked. */}
                <button
                  className="text-xs px-3 py-1 rounded border border-neutral-400 text-neutral-700 dark:text-neutral-100 hover:bg-white/60 dark:hover:bg-white/10"
                  title="Select several models to delete"
                  onClick={() => {
                    setSelectMode((on) => !on);
                    setSelectedIds(new Set());
                    setBulkProgress("");
                  }}
                >
                  {selectMode ? "Done" : "Select"}
                </button>
                <button
                  className="text-xs px-3 py-1 rounded bg-[color:var(--pz-accent)] text-white hover:opacity-90"
                  title="Upload your own .glb files into this category"
                  onClick={() => setShowUploadModal(true)}
                >
                  + Upload GLB
                </button>
                {/* Held at the far end by an auto margin rather than by the
                    row's old justify-between, which no longer applies now that
                    the title has moved to its own line. */}
                <img
                  className="finishing-modal-close-icon ml-auto"
                  src={require("../../../images/close.svg")}
                  onClick={() => {
                    setShowRoomPanelModal(false);
                  }}
                />
              </div>
              {/* PREVIEW PICTURES for this branch.
                  On its own line under the buttons: the row above already needs
                  ~224px of the panel's 250 and cannot take a fourth control.
                  Hidden while ticking cards to delete, where it would only be
                  in the way.

                  HIDDEN ON PURPOSE — set SHOW_PREVIEW_TOOLS to true to bring
                  them back. The code is kept rather than deleted because it is
                  the only way to give a preview picture to a model that already
                  exists: `npm run thumbnails:generate` points at a script that
                  has never existed in this repository. */}
              {SHOW_PREVIEW_TOOLS && !selectMode && (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    className="text-xs px-2 py-1 rounded border border-neutral-400 text-neutral-700 dark:text-neutral-100 hover:bg-white/60 dark:hover:bg-white/10 disabled:opacity-40"
                    disabled={previewBusy}
                    title="Render a preview picture for every model here that has none"
                    onClick={() => generatePreviews(false)}
                  >
                    Previews
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded border border-neutral-400 text-neutral-700 dark:text-neutral-100 hover:bg-white/60 dark:hover:bg-white/10 disabled:opacity-40"
                    disabled={previewBusy}
                    title="Take every preview picture again — use after the wood finish changes, when the old pictures show grey cabinets"
                    onClick={() => generatePreviews(true)}
                  >
                    Retake all
                  </button>
                  {previewBusy && (
                    <button
                      className="text-xs px-2 py-1 rounded bg-red-500 text-white"
                      onClick={() => {
                        previewStop.current = true;
                      }}
                    >
                      Stop
                    </button>
                  )}
                </div>
              )}
              {SHOW_PREVIEW_TOOLS && previewProgress && !selectMode && (
                <p className="text-[11px] text-neutral-600 dark:text-neutral-200 leading-snug">
                  {previewProgress}
                </p>
              )}
            </div>
            {/* Selection bar — only while picking models to delete. */}
            {selectMode && (
              /* flex-wrap, because this bar wants ~286px and the panel is 250:
                 without it the buttons squeeze and "Delete (0)" breaks across
                 two lines inside its own border. Wrapped, the counts stay on
                 the first line and the two buttons drop to the second. */
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[color:var(--pz-accent-soft)] border-b border-neutral-200 dark:border-neutral-600">
                <button
                  className="text-xs text-[color:var(--pz-accent)] font-medium"
                  disabled={bulkBusy}
                  onClick={() => {
                    const deletable = deletableShownModels();
                    setSelectedIds((prev) =>
                      prev.size >= deletable.length
                        ? new Set()
                        : new Set(deletable.map((m: any) => String(m._id)))
                    );
                  }}
                >
                  {selectedIds.size >= deletableShownModels().length &&
                  deletableShownModels().length > 0
                    ? "Clear all"
                    : "Select all"}
                </button>
                <span className="text-xs text-[color:var(--pz-accent)]">
                  {bulkBusy
                    ? bulkProgress
                    : `${selectedIds.size} selected`}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    className="text-xs px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
                    disabled={!selectedIds.size || bulkBusy}
                    onClick={handleDeleteSelectedModels}
                  >
                    Delete ({selectedIds.size})
                  </button>
                  <button
                    className="text-xs px-3 py-1 rounded border border-neutral-400 text-neutral-700 dark:text-neutral-100 disabled:opacity-40"
                    disabled={bulkBusy}
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedIds(new Set());
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {/* What happened after a bulk delete, e.g. "2 deleted · 1 kept…". */}
            {!selectMode && bulkProgress && (
              <div className="px-3 py-2 text-xs text-neutral-600 dark:text-neutral-200 border-b border-neutral-200 dark:border-neutral-600">
                {bulkProgress}
              </div>
            )}
            <div className="p-2 pb-[225px] max-h-full overflow-y-auto">
              {/* Search box, placement pills and Sort removed — the category
                  tree already narrows the list, and the panel is narrow
                  (ITEMS_W), where three stacked filter rows cost more space
                  than they earned. The state behind them stays at its defaults
                  (placementFilter "all", empty query, default sort), so the
                  list below simply browses the selected category. */}
              {placementFilter !== "all" ? (
                /* A specific placement pill is active → show matching models
                   gathered from this category's whole subtree. */
                shownSubtreeModels.length ? (
                  <>
                  <div className="flex flex-wrap justify-center align-middle">
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
                          selectMode={selectMode}
                          selected={selectedIds.has(String(model._id))}
                          onToggleSelect={() => toggleSelected(String(model._id))}
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
                  <div className="flex flex-wrap justify-center align-middle">
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
                <div className="flex flex-wrap justify-center align-middle">
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
                        selectMode={selectMode}
                        selected={selectedIds.has(String(model._id))}
                        onToggleSelect={() => toggleSelected(String(model._id))}
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
      <div className="fixed block z-10 scrollbar shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-white dark:bg-neutral-700"
        style={{
          width: CAT_W,
          left: `calc(var(--pz-nav-w, 0px) + ${CAT_INSET}px)`,
          top: dockTop,
          bottom: 0,
        }}>
        <div className="h-full flex flex-col overflow-hidden">
          {/* Panel title, matching the Floor plan panel. */}
          <div className="shrink-0 bg-[color:var(--pz-panel-header)] flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[color:var(--pz-panel-border)]">
            <span className="text-[15px] font-semibold text-[color:var(--pz-text)]">
              3D model
            </span>
            <button
              type="button"
              onClick={() => onHideRoomPanel()}
              className="text-neutral-500 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-white leading-none text-lg px-1"
              title="Close"
            >
              ×
            </button>
          </div>

          {/* Section 1 — the three ways to bring a model in. These were toolbar
              buttons; the cards match the Floor plan panel's tool cards. */}
          <PanelSection
            id="addmodel"
            title="Add model"
            open={openSections.includes("addmodel")}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-3 gap-2">
              <ToolCard icon="upload" label="Upload" onClick={onUpload} />
              <ToolCard icon="auto_awesome" label="Generate" onClick={onGenerate} />
              <ToolCard icon="travel_explore" label="Search" onClick={onSearchModels} />
            </div>
          </PanelSection>

          {/* Section 2 — the category tree. Plus is icon-only: the old
              "+ Category" label wrapped onto two lines in this width. */}
          <PanelSection
            id="category"
            title="Category"
            grow
            open={openSections.includes("category")}
            onToggle={toggleSection}
            action={
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAddCategoryParentId(null);
                  setShowAddCategoryModal(true);
                }}
                className="w-6 h-6 grid place-items-center rounded bg-[color:var(--pz-accent)] text-white hover:opacity-90 shrink-0"
                title="Add a new top-level category (or pick a parent inside the modal)"
              >
                <span className="material-symbols-outlined text-[16px] leading-none">
                  add
                </span>
              </button>
            }
          >
            <div>
              {treeData?.length ? (
                <Tree {...required} {...handlers} renderNode={renderNode} />
              ) : (
                <RoomPanelSkeleton />
              )}
            </div>
          </PanelSection>
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
      {/* Confirm before deleting a category.
          Empty one: a short question. Holding something: it says exactly what
          goes, and for more than a handful asks for the name back — instant for
          a leaf, deliberate for a branch. */}
      {deletingCategory && (() => {
        const holds = whatCategoryHolds(deletingCategory.node);
        const total = holds.subCategories + holds.models;
        const mustType = total > 5;
        const ready = !mustType || deleteTyped.trim() === deletingCategory.name;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="w-[360px] rounded-xl bg-white dark:bg-neutral-800 p-5 shadow-xl">
              <h4 className="text-sm font-bold text-neutral-800 dark:text-neutral-50">
                Delete “{deletingCategory.name}”?
              </h4>
              {holds.empty ? (
                <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                  It is empty — no sub-categories and no models. This cannot be
                  undone.
                </p>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                  It holds{" "}
                  <b>
                    {holds.subCategories
                      ? `${holds.subCategories} sub-categor${holds.subCategories === 1 ? "y" : "ies"}`
                      : ""}
                    {holds.subCategories && holds.models ? " and " : ""}
                    {holds.models
                      ? `${holds.models} model${holds.models === 1 ? "" : "s"}`
                      : ""}
                  </b>
                  . Deleting it removes all of them. This cannot be undone.
                </p>
              )}
              {mustType && (
                <div className="mt-3">
                  <label className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                    Type <b>{deletingCategory.name}</b> to confirm
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-2 py-1.5 text-xs text-neutral-800 dark:text-neutral-100"
                    value={deleteTyped}
                    onChange={(e) => setDeleteTyped(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
              {deleteError && (
                <p className="mt-2 whitespace-pre-line text-xs text-[#B4372F]">
                  {deleteError}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200"
                  disabled={deleteBusy}
                  onClick={() => {
                    setDeletingCategory(null);
                    setDeleteError("");
                    setDeleteTyped("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-[#B4372F] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={deleteBusy || !ready}
                  onClick={async () => {
                    setDeleteBusy(true);
                    setDeleteError("");
                    try {
                      const out = await deleteCategoryTree(
                        deletingCategory.node,
                        (msg) => setBulkProgress(msg)
                      );
                      await CategoriesService.refreshCategoriesCache();
                      await refreshCategoriesTree();
                      if (selectedTreeNode?.data?.id === deletingCategory.id) {
                        setShowRoomPanelModal(false);
                        setSelectedTreeNode(null);
                      }
                      if (out.kept.length) {
                        // Say plainly what stayed behind rather than closing on
                        // a half-done job.
                        setDeleteError(
                          `Kept ${out.kept.length}:\n` + out.kept.join("\n")
                        );
                      } else {
                        setDeletingCategory(null);
                        setDeleteTyped("");
                      }
                    } catch (e: any) {
                      setDeleteError(e?.message || "Could not delete it.");
                    } finally {
                      setDeleteBusy(false);
                      setBulkProgress("");
                    }
                  }}
                >
                  {deleteBusy
                    ? "Deleting…"
                    : holds.empty
                    ? "Delete category"
                    : `Delete ${total} item${total === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <AddCategoryModal
        show={showAddCategoryModal}
        onClose={() => setShowAddCategoryModal(false)}
        onSuccess={refreshCategoriesTree}
        presetParentId={addCategoryParentId}
      />
      <EditCategoryModal
        show={showEditCategoryModal}
        category={editingCategoryNode}
        onClose={() => {
          setShowEditCategoryModal(false);
          setEditingCategoryNode(null);
        }}
        onSuccess={async () => {
          await refreshCategoriesTree();
          if (editingCategoryNode && selectedTreeNode?.data?.id === editingCategoryNode.id) {
            setSelectedTreeNode((prev: any) => ({
              ...prev,
              data: { ...prev.data, name: editingCategoryNode.name },
            }));
          }
        }}
      />
    </>
  );
}

export default RoomPanel;
