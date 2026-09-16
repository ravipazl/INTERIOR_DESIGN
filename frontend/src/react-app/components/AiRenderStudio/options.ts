// Choices for the AI render screen. Every `value` is an exact MyArchitectAI API
// enum (see backend/src/services/ai-render/ai-render.js); anything the API has
// no value for is sent as prompt words instead, at no extra cost.

export type Aspect = "16:9" | "4:3" | "1:1";
export const ASPECTS: { id: Aspect; ratio: number }[] = [
  { id: "16:9", ratio: 16 / 9 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "1:1", ratio: 1 },
];

export const EYE_HEIGHTS = [
  { cm: 120, label: "Seated · 1.2 m" },
  { cm: 150, label: "Eye level · 1.5 m" },
  { cm: 170, label: "Standing · 1.7 m" },
];

/**
 * Words added to the prompt when nothing should change but the realism. The
 * render call is generative — it repaints the picture and happily invents a hob,
 * an extractor hood or a marble backsplash — and the API has no negative-prompt
 * field for it, so the only lever is the prompt itself.
 */
export const STRICT_WORDS =
  "Keep every existing object, cabinet, door, handle, appliance, material and colour exactly as in the image. Do not add, remove, move or replace anything — no new appliances, no hob, no extractor hood, no furniture, no decor, no plants. Change only lighting, shading and realism.";

/** The instruction for the light-touch mode (edit-by-prompt). */
export const KEEP_WORDS =
  "Make this 3D view look like a real photograph of the same room: realistic lighting, soft shadows, real material texture. " +
  STRICT_WORDS;

export interface LightingOption {
  id: string;
  label: string;
  /** Material Symbols icon name. */
  icon: string;
  /** Plain words for the prompt, used when no relight call is made. */
  words?: string;
  /** /set-atmosphere interior lighting value — a paid relight step. */
  lighting?: string;
  /** /set-atmosphere exterior timeOfDay value — the same relight step. */
  timeOfDay?: string;
  /** Added to the prompt instead (no API value exists). */
  promptWords?: string;
}

export const LIGHTING: LightingOption[] = [
  { id: "none", label: "None", icon: "block" },
  { id: "natural", label: "Natural daylight", icon: "light_mode", lighting: "midday_light", words: "soft natural daylight" },
  { id: "airy", label: "Bright and airy", icon: "window", promptWords: "bright and airy interior, soft even daylight" },
  // (Interior keeps "Bright and airy"; the exterior list has no prompt-only option.)
  { id: "warm", label: "Warm ambient", icon: "table_lamp", lighting: "warm_lamps", words: "warm lamp lighting" },
  { id: "cool", label: "Cool ambient", icon: "emoji_objects", lighting: "ambient_light", words: "cool ambient lighting" },
  { id: "golden", label: "Golden hour", icon: "wb_twilight", lighting: "golden_light", words: "golden hour light" },
  { id: "blue", label: "Blue hour", icon: "dark_mode", lighting: "blue_hour_light", words: "blue hour light" },
  { id: "dimmed", label: "Dimmed mood", icon: "nightlight", lighting: "dimmed_mood", words: "dim moody lighting" },
];

/** Exterior lighting: every option is a real API `timeOfDay` value. */
export const EXTERIOR_LIGHTING: LightingOption[] = [
  { id: "none", label: "None", icon: "block" },
  { id: "sunrise", label: "Sunrise", icon: "wb_sunny", timeOfDay: "early_morning", words: "sunrise light" },
  { id: "midday", label: "Midday", icon: "light_mode", timeOfDay: "midday", words: "midday sun" },
  { id: "overcast", label: "Overcast", icon: "cloud", timeOfDay: "overcast_day", words: "overcast daylight" },
  { id: "golden", label: "Golden hour", icon: "wb_twilight", timeOfDay: "golden_hour", words: "golden hour light" },
  { id: "dusk", label: "Dusk", icon: "brightness_3", timeOfDay: "sunset", words: "dusk light" },
  { id: "blue", label: "Blue hour", icon: "dark_mode", timeOfDay: "blue_hour", words: "blue hour light" },
  { id: "night", label: "Night", icon: "nightlight", timeOfDay: "night", words: "night, dark sky" },
  { id: "starry", label: "Starry night", icon: "star", timeOfDay: "starry_night", words: "starry night sky" },
  { id: "northern", label: "Northern lights", icon: "auto_awesome", timeOfDay: "northern_lights", words: "northern lights in the sky" },
  { id: "southern", label: "Southern lights", icon: "auto_awesome", timeOfDay: "southern_lights", words: "southern lights in the sky" },
];

/**
 * The surroundings of an exterior shot. The API has no landscape field, so the
 * choice is written into the prompt — no extra call and no extra cost.
 */
export const LANDSCAPE: LightingOption[] = [
  { id: "none", label: "None", icon: "block" },
  { id: "urban", label: "Urban", icon: "location_city", promptWords: "urban setting, city street surroundings" },
  { id: "suburban", label: "Suburban", icon: "home", promptWords: "suburban neighbourhood surroundings" },
  { id: "countryside", label: "Countryside", icon: "cottage", promptWords: "countryside surroundings, open fields" },
  { id: "forest", label: "Forest", icon: "forest", promptWords: "forest surroundings, tall trees" },
  { id: "lakefront", label: "Lakefront", icon: "water", promptWords: "lakefront surroundings, calm water" },
  { id: "garden", label: "Garden", icon: "local_florist", promptWords: "landscaped garden surroundings, planting" },
  { id: "mountains", label: "Mountains", icon: "landscape", promptWords: "mountain surroundings, distant peaks" },
  { id: "industrial", label: "Industrial", icon: "factory", promptWords: "industrial surroundings, warehouses" },
  { id: "tropical", label: "Tropical", icon: "park", promptWords: "tropical surroundings, palm trees" },
  { id: "beachfront", label: "Beachfront", icon: "beach_access", promptWords: "beachfront surroundings, sand and sea" },
  { id: "coastal", label: "Coastal", icon: "sailing", promptWords: "coastal surroundings, sea view" },
  { id: "cliffside", label: "Cliffside", icon: "terrain", promptWords: "cliffside surroundings, rocky cliffs" },
  { id: "riverside", label: "Riverside", icon: "kayaking", promptWords: "riverside surroundings, river bank" },
  { id: "mediterranean", label: "Mediterranean", icon: "villa", promptWords: "mediterranean surroundings, olive trees and stone" },
  { id: "savanna", label: "Savanna", icon: "grass", promptWords: "savanna surroundings, dry grassland" },
];

/** USD per request, from the MyArchitectAI billing page. */
export const PRICE = {
  render: 0.03,
  atmosphere: 0.03,
  style: 0.03,
  autoPrompt: 0.01,
  upscale: 0.03,
  edit: 0.03,
  animate: 0.25,
};

export const money = (usd: number) => `$${usd.toFixed(2)}`;
