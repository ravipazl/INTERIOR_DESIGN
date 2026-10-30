import { ModelsService } from "@pazl/services/ModelsService";
import { CategoriesService } from "@pazl/services/categoriesService";
import BlueprintInterface from "@pazl/blueprint-interface.js";

/**
 * WHAT AN ITEM CAN BE SWAPPED FOR.
 *
 * The Door/Window Properties panel's Swap tab lists a door's or a window's
 * models; the 3D toolbar's Swap button opens the left catalogue panel at the
 * selected item's category. Both read the same cached catalogue the left panel
 * uses, so new models appear by themselves.
 *
 *   a door   — Interior Elements › Door;
 *   a window — Interior Elements › Window;
 *              each with its sub-categories (see categoryIdsFor);
 *   anything else — its own category.
 */

export type SwapKind = "door" | "window";

/** Fired by the 3D toolbar's Swap button: open the left panel to swap. */
export const OPEN_SWAP_EVENT = "pazl-open-swap";

const nameOf = (c: any) => String(c?.name || "").trim().toLowerCase();

const catalogue = () => ({
  categories: (CategoriesService.getCategoriesFromLocalStorage() || []) as any[],
  models: (ModelsService.getModelsFromLocalStorage() || []) as any[],
});

/** These categories' ids, and every category filed under them. */
function withSubcategories(picked: any[], categories: any[], visibleOnly: boolean): Set<string> {
  const ids = new Set(picked.map((c: any) => String(c._id)));
  let grew = true;
  while (grew) {
    grew = false;
    categories.forEach((c: any) => {
      if (visibleOnly && c.invisible) return;
      if (!ids.has(String(c._id)) && ids.has(String(c.parentCategoryId))) {
        ids.add(String(c._id));
        grew = true;
      }
    });
  }
  return ids;
}

/**
 * The categories a door's or a window's swap list comes from — the ones the
 * left panel can SHOW: Interior Elements › Door / › Window. Hidden categories
 * are never offered (a hidden LIVINGROOM › Door left the panel unable to open
 * it, so the last category viewed — Plant — stayed on screen). Without an
 * Interior Elements one, any visible category of that name; a door then also
 * any visible category with "door" in its name.
 */
function categoryIdsFor(kind: SwapKind, categories: any[]): Set<string> {
  const byId = new Map(categories.map((c: any) => [String(c._id), c]));
  const rootOf = (c: any) => {
    let x = c;
    for (let i = 0; i < 20 && x && x.parentCategoryId; i++) {
      const up = byId.get(String(x.parentCategoryId));
      if (!up) break;
      x = up;
    }
    return x;
  };
  const visible = categories.filter((c: any) => !c.invisible);
  const names = kind === "window" ? ["window", "windows"] : ["door", "doors"];
  const named = visible.filter((c: any) => names.includes(nameOf(c)));
  const underElements = named.filter(
    (c: any) => nameOf(rootOf(c)) === "interior elements"
  );
  let picked = underElements.length ? underElements : named;
  if (!picked.length && kind === "door") {
    picked = visible.filter((c: any) => nameOf(c).includes("door"));
  }
  return withSubcategories(picked, categories, true);
}

/**
 * Every category an item counts as a door or a window by — hidden ones too,
 * so a door placed from a hidden category is still known to be a door.
 */
function kindCategoryIds(kind: SwapKind, categories: any[]): Set<string> {
  const picked =
    kind === "window"
      ? categories.filter((c: any) => ["window", "windows"].includes(nameOf(c)))
      : categories.filter((c: any) => nameOf(c).includes("door"));
  return withSubcategories(picked, categories, false);
}

const inCategories = (m: any, ids: Set<string>) =>
  !!m && (ids.has(String(m.categoryId)) || ids.has(String(m.parentCategoryId)));

/** The catalogue models a door or a window can be swapped for. */
export function swapModelsFor(kind: SwapKind): any[] {
  const { categories, models } = catalogue();
  const ids = categoryIdsFor(kind, categories);
  return models.filter((m: any) => inCategories(m, ids));
}

const itemOf = (selected: any) => selected?.itemModel || selected?.__itemModel || null;

/** The catalogue model a placed (non-parametric) item was made from, or null. */
function catalogueModelOf(selected: any, models: any[]): any | null {
  const item = itemOf(selected);
  if (!item || item.isParametric || item.parametricClass) return null;
  const record = (BlueprintInterface as any)?.ProjectManagerService?.getFurnishedModelById?.(
    item.__id
  );
  const modelId = record?.modelId || record?.model?._id || null;
  if (record?.model?.categoryId != null) return record.model;
  return models.find((m: any) => modelId && String(m._id) === String(modelId)) || null;
}

/**
 * Is the item selected in 3D a door or a window? A built-in (parametric) one
 * says so itself; a catalogue model is known by its category. Doors and
 * windows swap through their own path, which keeps them in their wall.
 */
export function swapKindOf(selected: any): SwapKind | null {
  const item = itemOf(selected);
  if (!item) return null;
  const pc = item.parametricClass;
  if (item.isParametric || pc) {
    if (!pc) return null;
    return pc.__windowType !== undefined || pc.__name === "Window" ? "window" : "door";
  }
  try {
    const { categories, models } = catalogue();
    const model = catalogueModelOf(selected, models);
    if (!model) return null;
    for (const kind of ["window", "door"] as SwapKind[]) {
      if (inCategories(model, kindCategoryIds(kind, categories))) return kind;
    }
  } catch (e) {
    /* not a door or a window */
  }
  return null;
}

/**
 * The catalogue category the left panel opens at when the item is swapped: a
 * window's Interior Elements › Window, a door's Interior Elements › Door,
 * anything else its own category. The one (of a door's or window's) that
 * actually has models wins. Null when the item has nothing to swap for.
 */
export function swapCategoryOf(selected: any): { id: string; name: string } | null {
  try {
    const { categories, models } = catalogue();
    const byId = new Map(categories.map((c: any) => [String(c._id), c]));
    const kind = swapKindOf(selected);
    let id: string | null = null;
    if (kind) {
      // Of the kind's categories, the first that holds models directly.
      const ids = Array.from(categoryIdsFor(kind, categories));
      id = ids.find((cid) => models.some((m: any) => String(m.categoryId) === cid)) || null;
    } else {
      const model = catalogueModelOf(selected, models);
      id = model && model.categoryId != null ? String(model.categoryId) : null;
    }
    const cat = id ? byId.get(id) : null;
    return cat ? { id: String(cat._id), name: String(cat.name || "") } : null;
  } catch (e) {
    return null;
  }
}
