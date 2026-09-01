// Placement type constants and a name-based auto-guess.
//
// The numeric values match pazl's items/factory.js dispatch table — when a
// model with `type: N` is dragged into the scene, the engine instantiates
// the matching subclass (FloorItem / WallItem / InWallItem / RoofItem / …),
// which determines how the item behaves: which surface it docks against,
// whether it auto-rotates, where it can be moved, etc.
//
// `MODEL_TYPES` in entities/Model.ts is a TypeScript enum that only
// declares a subset (0, 1, 2, 3, 7). The factory also supports 4 (Roof),
// 8 (InFloor) and 9 (WallFloor). We use literals for those here rather
// than extending the shared enum, to avoid affecting other code paths
// that pattern-match on the enum members.

import { MODEL_TYPES } from "@pazl/entities/Model";

export const PLACEMENT_TYPE = {
  FLOOR: MODEL_TYPES.FLOOR_UNIT, // 1 — chair, table, sofa
  WALL: MODEL_TYPES.WALL_UNIT, // 2 — AC, wall lamp, TV, mirror
  IN_WALL: MODEL_TYPES.IN_WALL_UNIT, // 3 — sliding door, in-wall AC
  ROOF: 4, // ceiling fan, downlight (not in the TS enum)
  IN_WALL_FLOOR: MODEL_TYPES.IN_WALL_FLOOR_UNIT, // 7 — built-in wardrobe
} as const;

export interface PlacementOption {
  value: number;
  label: string;
  hint: string;
}

// EVERY placement type the engine can instantiate. Kept complete — never trim
// this list — so `placementTypeLabel` can still name a model that was saved
// with a type that has since been retired from the pickers.
export const ALL_PLACEMENT_OPTIONS: PlacementOption[] = [
  {
    value: PLACEMENT_TYPE.FLOOR,
    label: "Floor",
    hint: "Chair, table, sofa, free-standing items",
  },
  {
    value: PLACEMENT_TYPE.WALL,
    label: "Wall-mounted",
    hint: "AC, lamp, TV, mirror, painting, switch",
  },
  {
    value: PLACEMENT_TYPE.IN_WALL,
    label: "In-wall (embedded)",
    hint: "Sliding door, in-wall AC, niche unit",
  },
  {
    value: PLACEMENT_TYPE.ROOF,
    label: "Ceiling-mounted",
    hint: "Ceiling fan, downlight, chandelier",
  },
  {
    value: PLACEMENT_TYPE.IN_WALL_FLOOR,
    label: "Floor-to-ceiling (embedded)",
    hint: "Built-in wardrobe, full-height cupboard",
  },
];

// Placement types withdrawn from the pickers. The engine still supports them
// and models already saved with one keep working — they simply can no longer
// be CHOSEN, and the name-based guess below never assigns one.
const RETIRED_PLACEMENT_TYPES: number[] = [
  PLACEMENT_TYPE.IN_WALL, // 3 — In-wall (embedded)
  PLACEMENT_TYPE.IN_WALL_FLOOR, // 7 — Floor-to-ceiling (embedded)
];

// Nearest still-selectable type for each retired one, used by the guesser so a
// wardrobe or a sliding door lands somewhere sensible instead of falling
// through to the generic default.
const RETIRED_FALLBACK: Record<number, number> = {
  [PLACEMENT_TYPE.IN_WALL]: PLACEMENT_TYPE.WALL,
  [PLACEMENT_TYPE.IN_WALL_FLOOR]: PLACEMENT_TYPE.FLOOR,
};

/** True when `typeValue` is a placement type that pickers must not offer. */
export function isRetiredPlacementType(typeValue: number | undefined): boolean {
  return typeValue != null && RETIRED_PLACEMENT_TYPES.includes(typeValue);
}

/** Map a retired placement type onto the nearest selectable one. */
export function coercePlacementType(typeValue: number): number {
  return RETIRED_FALLBACK[typeValue] ?? typeValue;
}

// What every placement picker offers. Derived from the full list so the two
// stay in sync — add a type above and it appears here unless it is retired.
export const PLACEMENT_OPTIONS: PlacementOption[] =
  ALL_PLACEMENT_OPTIONS.filter((o) => !RETIRED_PLACEMENT_TYPES.includes(o.value));

/**
 * Heuristic — pick a placement type from a model's name / search query.
 * Returns FLOOR_UNIT (1) for anything not obviously wall / ceiling / niche.
 *
 * The result is passed through `coercePlacementType`, so it never returns a
 * retired type. Without that, a name like "wardrobe" would auto-select type 7,
 * which no picker lists — leaving the dropdown rendered blank because
 * `<select value={7}>` has no matching `<option>`.
 */
export function guessPlacementType(name: string): number {
  return coercePlacementType(guessPlacementTypeRaw(name));
}

/** The raw name match, before retired types are mapped away. */
function guessPlacementTypeRaw(name: string): number {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ");

  // In-wall / embedded first — beats plain wall mounted (more specific).
  if (
    /\b(in[\s-]?wall|niche|alcove|sliding[\s-]?door|wall[\s-]?niche)\b/.test(n)
  ) {
    return PLACEMENT_TYPE.IN_WALL;
  }

  // Floor-to-ceiling fitments — wardrobes, full-height cupboards.
  if (
    /\b(wardrobe|cupboard|book[\s-]?shelf|bookcase|tv[\s-]?stand|tall[\s-]?unit|full[\s-]?height)\b/.test(
      n
    )
  ) {
    return PLACEMENT_TYPE.IN_WALL_FLOOR;
  }

  // Ceiling mounts — fans and downlights.
  if (
    /\b(ceiling[\s-]?(fan|light|lamp)|chandelier|pendant[\s-]?light|downlight|spot[\s-]?light)\b/.test(
      n
    ) ||
    /^fan\b/.test(n)
  ) {
    return PLACEMENT_TYPE.ROOF;
  }

  // Wall-mounted — ACs, lamps, TVs, mirrors, paintings, switches.
  if (
    /\b(a[\s-]?c|ac\s*unit|aircon|air[\s-]?conditioner|split[\s-]?ac|window[\s-]?ac|wall[\s-]?(lamp|light|mounted|art|panel)|sconce|tv\b|television|mirror|painting|portrait|frame|wall[\s-]?clock|switch|socket|outlet|art[\s-]?work|wall[\s-]?decor)\b/.test(
      n
    )
  ) {
    return PLACEMENT_TYPE.WALL;
  }

  return PLACEMENT_TYPE.FLOOR;
}

/**
 * Friendly label lookup. Reads the FULL list, not the picker list — a model
 * saved with a retired type must still show its real name rather than falling
 * back to "Floor".
 */
export function placementTypeLabel(typeValue: number | undefined): string {
  if (typeValue == null) return "Floor";
  const m = ALL_PLACEMENT_OPTIONS.find((o) => o.value === typeValue);
  return m ? m.label : "Floor";
}
