/**
 * "+ Add" on a WALL UNIT hangs it on the wall at the studio's height.
 *
 * Which products are wall units is read from the catalogue's own category
 * tree — the category the kitchen template already uses for its wall units
 * (kitchen.json → modules.wallUnit.category), or any sub-category of it — not
 * from the product's placement type. A wall unit uploaded as a floor item
 * still belongs on the wall.
 *
 * How high is the template's rule too: `wallUnitTopMm`, the floor → TOP of
 * the unit, so the unit hangs down from it — 7 ft, whatever the unit's size.
 * It lives with the other kitchen rules so it is changed in one place, and
 * every way of placing a wall unit uses it: "+ Add", a drop from the
 * catalogue, a copy (which keeps its original's top) and auto-furnish.
 *
 * A wall unit can then be dragged in 3D along the wall and up and down; it
 * settles back at this height when brought within 5 cm of it
 * (DragRoomItemsControl3D). Typing Y sets it exactly.
 *
 * The Properties panel also uses the categories here: a wall unit's Y is the
 * height of its TOP; a below-counter or tall unit's Y is its BOTTOM (0).
 */

import { CategoriesService } from "@pazl/services/categoriesService";
import kitchenTemplate from "./kitchen.json";
import { KITCHEN_DEFAULTS } from "./placementEngine";

const lower = (s) => String(s || "").trim().toLowerCase();

const preset = () => (kitchenTemplate.presets || [])[0] || {};

/** The category path wall units live under, e.g. ["kitchen", "wall unit"]. */
function wallUnitPath() {
  return specPath(preset().modules?.wallUnit?.category);
}

/** ["kitchen", "wall unit", "glass"] for one category id, root first. */
function pathOfCategory(categoryId) {
  const cats = CategoriesService.getCategoriesFromLocalStorage() || [];
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const parts = [];
  const seen = new Set();
  let cur = byId.get(String(categoryId));
  // `seen` guards against a parent loop in the data.
  while (cur && !seen.has(String(cur._id))) {
    seen.add(String(cur._id));
    parts.unshift(lower(cur.name));
    cur = cur.parentCategoryId ? byId.get(String(cur.parentCategoryId)) : null;
  }
  return parts;
}

/** A template category spec ("KITCHEN > Tall Units") as a lower-case path. */
const specPath = (spec) =>
  String(spec || "").split(">").map(lower).filter(Boolean);

/**
 * Is this catalogue product a wall unit? True when its category is the wall
 * unit category, or sits anywhere below it. The names before the last one in
 * the template's path need only be ancestors in that order, the same way
 * auto-furnish matches categories, so an extra level in the tree is fine.
 */
export function isWallUnitModel(model) {
  return inCategory(model, wallUnitPath());
}

/**
 * Is this catalogue product one of the kitchen's cabinets — a wall unit, a
 * below-counter unit (base, sink, drawer, corner…) or a tall unit? The
 * categories are the ones the kitchen template's modules use, so a category
 * added to the template is picked up here without a code change.
 */
export function isKitchenCabinetModel(model) {
  const modules = preset().modules || {};
  const seen = new Set();
  return Object.values(modules).some((m) => {
    const want = specPath(m && m.category);
    const key = want.join(">");
    if (!want.length || seen.has(key)) return false;
    seen.add(key);
    return inCategory(model, want);
  });
}

/** True when the product's category is `want` (a path) or below it. */
function inCategory(model, want) {
  const categoryId = model?.categoryId;
  if (!categoryId) return false;
  if (!want.length) return false;
  const have = pathOfCategory(categoryId);
  const leaf = want[want.length - 1];
  for (let at = have.length - 1; at >= 0; at -= 1) {
    if (have[at] !== leaf) continue;
    // The category itself is at `at`; check its ancestors in order.
    let w = want.length - 2;
    for (let i = at - 1; i >= 0 && w >= 0; i -= 1) {
      if (have[i] === want[w]) w -= 1;
    }
    if (w < 0) return true;
  }
  return false;
}

/**
 * THE TV DRAWER UNIT HANGS LOW. Every other wall-mounted item goes up with its
 * top at 7 ft, but a TV unit at that height would be a shelf near the ceiling:
 * it hangs with its BOTTOM 300 mm off the floor instead, under the TV back
 * panel. A product counts when its category or any above it is the TV drawer
 * unit category (by name, ignoring case and spaces — "TV Draw Unit" here,
 * "TV Drawer Unit" elsewhere), so both its sub-categories are covered.
 */
const TV_UNIT_NAMES = new Set(["tvdrawunit", "tvdrawerunit", "tvdrawerunits", "tvdrawunits"]);
export const TV_UNIT_BOTTOM_MM = 300;

export function isTvUnitModel(model) {
  const categoryId = model?.categoryId;
  if (!categoryId) return false;
  return pathOfCategory(categoryId).some((name) => TV_UNIT_NAMES.has(name.replace(/[^a-z]/g, "")));
}

/**
 * THE TV HANGS AT WATCHING HEIGHT: its BOTTOM 900 mm off the floor (its middle
 * near eye level from the sofa), above the TV drawer unit and on the TV back
 * panel — not by its top at 7 ft like the other wall-mounted items. A product
 * counts when its category, or one above it, is called "TV" (only that: "Tv
 * Stand", "TV Draw Unit" and "Tv back panel" are other things).
 */
export const TV_BOTTOM_MM = 900;

export function isTvModel(model) {
  const categoryId = model?.categoryId;
  if (!categoryId) return false;
  return pathOfCategory(categoryId).some((name) => ["tv", "tvs", "television", "televisions"].includes(name.trim()));
}

/** Floor → TOP of a wall unit, in cm. */
export function wallUnitTopCm() {
  const mm = Number(preset().rules?.wallUnitTopMm ?? KITCHEN_DEFAULTS.wallUnitTopMm);
  return mm > 0 ? mm / 10 : 0;
}
