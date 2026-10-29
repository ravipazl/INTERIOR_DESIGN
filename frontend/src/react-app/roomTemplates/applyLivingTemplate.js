/**
 * Auto-furnish a LIVING ROOM — livingEngine's plan turned into placed items.
 *
 * The same path as the bedroom (applyBedroomTemplate): this server's own
 * catalogue by category name and path, the plan for the preview, and the
 * shared placer, which hangs the wall items (the TV unit 300 mm off the floor
 * by the app's TV-unit rule, everything else by its top at 7 ft), pulls floor
 * items flush to their wall by their real size, turns the armchair to the
 * table and stands the lamp on its side table.
 */

import { describeRoom } from "./applyRoomTemplate";
import { pickRoomModules, applyFurnishPlan } from "./applyBedroomTemplate";
import { planLiving, LIVING_DEFAULTS } from "./livingEngine";
import livingTemplate from "./livingroom.json";

/**
 * Describe the room and plan it. `choice` is { tvWallIndex?, extras?, seed?,
 * tvUnitStyle?, panelStyle? } (see planLiving). Returns { room, catalogue, plan }.
 */
export function planLivingRoom(room, choice = {}) {
  const described = describeRoom(room);
  if (!described || !described.walls.length) return { error: "no walls in this room" };
  const catalogue = pickRoomModules(livingTemplate);
  const plan = planLiving(described, catalogue, choice, {
    ...LIVING_DEFAULTS,
    ...(livingTemplate.rules || {}),
  });
  return { room: described, catalogue, plan };
}

export const applyLivingPlan = applyFurnishPlan;
export { livingTemplate };
