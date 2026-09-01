import axios from "./apiService";
import { AuthService } from "./authService";

/** Raw shape returned by the backend /floorplan-ai endpoint. */
export interface AiWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface AiRoom {
  name: string;
  cx: number;
  cy: number;
}
export interface AiOpening {
  type: "door" | "window";
  cx: number;
  cy: number;
  width: number;
}
export interface AiFloorplanRaw {
  units: "mm" | "cm";
  walls: AiWall[];
  rooms: AiRoom[];
  openings?: AiOpening[];
}

/** Floorplan in the engine's loadSerialized shape. */
export interface BuiltFloorplan {
  units: "mm" | "cm";
  corners: Record<string, { x: number; y: number }>;
  walls: Array<{ corner1: string; corner2: string }>;
  /**
   * Room metadata keyed by the engine's roomByCornersId. The engine populates
   * this as it computes rooms from the walls — but loadFloorplan assigns it
   * directly to `metaroomsdata` WITHOUT a null-guard, so it must be present
   * (an empty object) or the first edit crashes reading metaroomsdata[id].
   */
  rooms: Record<string, unknown>;
}

/** AI-detected door, centre + width already converted to cm (engine units). */
export interface DoorPlacement {
  cxCm: number;
  cyCm: number;
  widthCm: number;
}
/** AI-detected room label, centre converted to cm. */
export interface RoomLabel {
  name: string;
  cxCm: number;
  cyCm: number;
}

export interface FloorPlanAiResult {
  floorplan: BuiltFloorplan;
  wallCount: number;
  roomCount: number;
  /** Doors to place after the plan loads. */
  openings: DoorPlacement[];
  /** Windows to place after the plan loads (same shape as doors). */
  windows: DoorPlacement[];
  /** Room names to apply by matching the label point to a room. */
  rooms: RoomLabel[];
}

/**
 * Turn the AI's list of wall segments into the corners+walls graph the editor
 * expects. Endpoints that fall within `tol` of each other are SNAPPED to one
 * shared corner so walls connect and rooms close (the AI is asked to share
 * endpoints, but snapping makes it robust to small coordinate drift).
 */
export function buildFloorplan(ai: AiFloorplanRaw): BuiltFloorplan {
  const units = ai.units === "cm" ? "cm" : "mm";
  // Snap tolerance in the AI's own units: ~5 cm.
  const tol = units === "mm" ? 50 : 5;

  const corners: Record<string, { x: number; y: number }> = {};
  const known: Array<{ x: number; y: number; id: string }> = [];
  let n = 0;

  const cornerIdFor = (x: number, y: number): string => {
    for (const c of known) {
      if (Math.abs(c.x - x) <= tol && Math.abs(c.y - y) <= tol) return c.id;
    }
    const id = `ai-${n++}`;
    corners[id] = { x, y };
    known.push({ x, y, id });
    return id;
  };

  const walls = (ai.walls || [])
    .map((w) => ({
      corner1: cornerIdFor(w.x1, w.y1),
      corner2: cornerIdFor(w.x2, w.y2),
    }))
    // Drop zero-length / collapsed segments.
    .filter((w) => w.corner1 !== w.corner2);

  // `rooms` must exist (even empty): loadFloorplan assigns it to metaroomsdata
  // without a null-guard, and editing a wall later indexes into it.
  return { units, corners, walls, rooms: {} };
}

/**
 * AI floor-plan import (pairs with the backend /floorplan-ai service).
 * Uploads a plan (PDF or image), gets back wall segments, and builds an
 * editable floorplan graph. Applying it to the editor is left to the caller
 * (so it can mirror the existing template flow: history + persistence).
 */
export const FloorPlanAiService = {
  fetchFloorplan: async (file: File): Promise<FloorPlanAiResult> => {
    const fd = new FormData();
    fd.append("plan", file, file.name);

    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/floorplan-ai", fd, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/form-data",
      },
      // Vision + reasoning over a full plan can take a while.
      timeout: 180000,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          `HTTP ${response.status}`
      );
    }

    const ai = response.data as AiFloorplanRaw;
    if (!ai || !Array.isArray(ai.walls) || ai.walls.length === 0) {
      throw new Error("No walls were detected in this plan.");
    }

    const floorplan = buildFloorplan(ai);

    // Engine internals are centimetres; AI coords are in `units`. Convert once.
    const toCm = ai.units === "cm" ? 1 : 0.1; // mm -> cm

    // Doors and windows are placed separately (doors floor-seated, windows at
    // sill height). Split the AI openings by type.
    const openings: DoorPlacement[] = (ai.openings || [])
      .filter((o) => o && o.type === "door")
      .map((o) => ({
        cxCm: o.cx * toCm,
        cyCm: o.cy * toCm,
        widthCm: (o.width || 900) * toCm,
      }));

    const windows: DoorPlacement[] = (ai.openings || [])
      .filter((o) => o && o.type === "window")
      .map((o) => ({
        cxCm: o.cx * toCm,
        cyCm: o.cy * toCm,
        widthCm: (o.width || 1200) * toCm,
      }));

    const rooms: RoomLabel[] = (ai.rooms || [])
      .filter((r) => r && r.name)
      .map((r) => ({ name: r.name, cxCm: r.cx * toCm, cyCm: r.cy * toCm }));

    return {
      floorplan,
      wallCount: floorplan.walls.length,
      roomCount: Array.isArray(ai.rooms) ? ai.rooms.length : 0,
      openings,
      windows,
      rooms,
    };
  },

  buildFloorplan,
};
