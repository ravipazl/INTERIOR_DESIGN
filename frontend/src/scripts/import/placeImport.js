import { Vector2 } from "three";
import BlueprintInterface from "@pazl/blueprint-interface";
import { HISTORY_TITLES } from "../../react-app/services/ProjectManager";
import axios from "../../react-app/services/apiService";
import { AuthService } from "../../react-app/services/authService";
import { ROOM_LABEL_RANK } from "../model/dxfImport";
import { userError } from "./fileCheck";

/**
 * PUTTING AN IMPORT INTO THE EDITOR.
 *
 * The background (an image, or a drawing's lines) is uploaded with the
 * project's files and laid in the floor plan's background slot
 * (viewer2d/PlanImage2D.js). When walls were built from the drawing, they are
 * loaded the way AI Import loads its result — as a template, doors and
 * windows placed on their walls, rooms named — with the background in the
 * same plan, lined up with them; otherwise the plan is left as it is and the
 * background is put in the middle of the view.
 */

/** Lines kept in a background at most: a whole drawing set can hold far more. */
const MAX_BACKGROUND_LINES = 200000;
/** The upload limit is 50 MB; a background stays well under it. */
const MAX_BACKGROUND_BYTES = 45 * 1024 * 1024;
/** A large background over a slow connection. */
const UPLOAD_TIMEOUT_MS = 120000;

export const planImage = () =>
  BlueprintInterface?.blueprint3d?.floorplanner?.__planImage || null;

const projectId = () => BlueprintInterface?.ProjectManagerService?.project?._id || null;

/**
 * Store a file with the project's files (the same route ProjectWorkspaceService
 * uses) and return its url. Made here, not through that service, because it
 * answers a failure with nothing — and the reason matters: a server that
 * refuses the file's type needs updating, which "check your connection"
 * would hide.
 */
const upload = async (blob, name, type) => {
  const id = projectId();
  if (!id) throw userError("Open a project's floor plan first, then import.");
  const fd = new FormData();
  fd.append("file", new File([blob], name, { type }));
  fd.append("projectId", id);
  let res;
  try {
    // No Content-Type here: the browser adds the multipart boundary.
    res = await axios.post("/project-file-upload", fd, {
      headers: { Authorization: `${AuthService.getAccessToken()}` },
      timeout: UPLOAD_TIMEOUT_MS,
    });
  } catch (err) {
    console.error("Floor plan import: saving the background failed", err);
    const status = err && err.response && err.response.status;
    const code = err && err.response && err.response.data && err.response.data.error;
    if (code === "wrong_extension") {
      throw userError(
        "The server doesn't accept this plan background yet. It needs updating and restarting. Ask whoever runs the server, then import again."
      );
    }
    if (status === 413) {
      throw userError("The plan background is too large for the server. Crop it to just the floor plan and try again.");
    }
    if (status === 401 || status === 403) {
      throw userError("Your session has expired. Sign in again, then import the plan again.");
    }
    if (!err || !err.response) {
      throw userError("Couldn't reach the server. Check your connection and try again.");
    }
    throw userError("The server couldn't save the plan background. Please try again.");
  }
  const url = res && res.data && res.data.fileUrl;
  if (!url) throw userError("The server couldn't save the plan background. Please try again.");
  return url;
};

/** Drawing units (y up) → plan centimetres (y down), as dxfImport maps walls. */
export const toPlanOf = (frame) => (x, y) => [(x - frame.minX) * frame.k, (frame.maxY - y) * frame.k];

const roleGroup = (role) => (role === "wall" || role === "door" || role === "window" ? role : "other");

/**
 * A drawing's chosen layers as a background: their lines in plan centimetres
 * around their own centre. Returns { blob, centre, w, h, lines } or null when
 * nothing is left to show.
 *
 *   lines   { [layer]: Float64Array [x1, y1, x2, y2, …] } in drawing units
 *   layers  [{ name, role, shown }]
 *   toPlan  drawing units → plan cm
 *   region  only what lies inside (drawing units), or null for all
 */
export const vectorBackground = (lines, layers, toPlan, region) => {
  const inside = (x, y) =>
    !region || (x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY);
  const out = [];
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  layers.forEach((l) => {
    const src = lines[l.name];
    if (!l.shown || !src) return;
    const dst = [];
    for (let i = 0; i + 3 < src.length && count < MAX_BACKGROUND_LINES; i += 4) {
      if (!inside(src[i], src[i + 1]) || !inside(src[i + 2], src[i + 3])) continue;
      const a = toPlan(src[i], src[i + 1]);
      const b = toPlan(src[i + 2], src[i + 3]);
      dst.push(a[0], a[1], b[0], b[1]);
      count += 1;
      minX = Math.min(minX, a[0], b[0]);
      minY = Math.min(minY, a[1], b[1]);
      maxX = Math.max(maxX, a[0], b[0]);
      maxY = Math.max(maxY, a[1], b[1]);
    }
    if (dst.length) out.push({ name: l.name, role: roleGroup(l.role), lines: dst });
  });
  if (!count) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // To the millimetre: finer than any plan needs, and a third of the size.
  const r = (v) => Math.round(v * 10) / 10;
  const json = {
    v: 1,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
    layers: out.map((l) => ({
      name: l.name,
      role: l.role,
      lines: l.lines.map((v, i) => r(i % 2 === 0 ? v - cx : v - cy)),
    })),
  };
  return {
    blob: new Blob([JSON.stringify(json)], { type: "application/json" }),
    centre: { x: cx, y: cy },
    w: json.w,
    h: json.h,
    lines: count,
    truncated: count >= MAX_BACKGROUND_LINES,
  };
};

/** A canvas as an image file small enough to upload: PNG, else JPG. */
export const imageFile = async (canvas) => {
  const blob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
  const png = await blob("image/png");
  if (png && png.size <= MAX_BACKGROUND_BYTES) return { blob: png, ext: "png", type: "image/png" };
  const jpg = await blob("image/jpeg", 0.92);
  if (jpg && jpg.size <= MAX_BACKGROUND_BYTES) return { blob: jpg, ext: "jpg", type: "image/jpeg" };
  throw userError("This plan is too large to keep as a background. Crop it to just the floor plan and try again.");
};

/** Upload a background and return its sheet settings (without a place yet). */
export const uploadBackground = async (bg, baseName) => {
  const safe = String(baseName || "plan").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "plan";
  if (bg.kind === "vector") {
    const url = await upload(bg.blob, `${safe}-background.json`, "application/json");
    return { kind: "vector", url };
  }
  const url = await upload(bg.blob, `${safe}-background.${bg.ext}`, bg.type);
  return { kind: "image", url };
};

/** Short words that stay in capitals when a label is put into words. */
const KEEP_CAPS = /^(wc|tv|ac|dg|db|ups|hvac|lcd)$/i;
/** What plans abbreviate ("ATT. TOILET" is an attached toilet). */
const EXPANDED = { att: "Attached" };

/**
 * A room's label as it reads on a plan — "BEDROOM-1", "ATT. TOILET",
 * "LIVING +DINING" — put into words: "Bedroom 1", "Attached Toilet",
 * "Living & Dining". A label already in mixed case was written that way on
 * purpose and is left alone; so are the words that name the room (a catalog
 * and the room hints look for them).
 */
export const tidyRoomName = (raw) => {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text || /[a-z]/.test(text)) return text;
  return text
    .replace(/\s*\+\s*/g, " & ")
    .replace(/([A-Za-z])-(?=\d)/g, "$1 ")
    .replace(/([A-Za-z])\.(?=\s|$)/g, "$1")
    .split(" ")
    .map((w) => {
      const key = w.toLowerCase();
      if (EXPANDED[key]) return EXPANDED[key];
      if (KEEP_CAPS.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
};

/**
 * Name each room from the label inside it — a label with a size first. Only
 * a label that reads as a room's names it; a room with none keeps its name.
 */
const applyRoomNames = (names) => {
  const fp = BlueprintInterface.blueprint3d?.model?.floorplan;
  const rooms = fp?.getRooms?.() || fp?.rooms || [];
  const roomLabels = (names || []).filter((n) => n.rank >= ROOM_LABEL_RANK);
  let named = 0;
  rooms.forEach((room) => {
    let best = null;
    roomLabels.forEach((n) => {
      try {
        if (room.pointInRoom(new Vector2(n.cxCm, n.cyCm)) && (!best || n.rank > best.rank)) best = n;
      } catch (e) {
        /* a room still being built */
      }
    });
    if (best) {
      room.name = tidyRoomName(best.name);
      named += 1;
    }
  });
  return named;
};

/** The name a room is given until it is named (model/room.js). */
const DEFAULT_ROOM_NAME = "A New Room";

/** The biggest a room can be and still be taken for each kind (square metres). */
const MAX_HINTED_AREA_M2 = { Bathroom: 10, Kitchen: 25, Bedroom: 30 };
/** How much of the fittings in a room must be of the one kind to name it. */
const HINT_DOMINANCE = 0.6;

/**
 * Name the rooms no label named from the fittings drawn in them — a bathroom
 * holds toilet fixtures, a kitchen its kitchen fixtures, a bedroom wardrobes.
 * A room is named only when one kind clearly dominates what is in it and the
 * room is a size that kind can be: where the drawing leaves a doorway open,
 * several rooms are one, holding every kind of fitting — it is left as it is,
 * not called by one of them. A room with none, or one already named, is also
 * left. Only a hint: it can be renamed.
 */
const applyRoomHints = (hints) => {
  const fp = BlueprintInterface.blueprint3d?.model?.floorplan;
  const rooms = fp?.getRooms?.() || fp?.rooms || [];
  let named = 0;
  rooms.forEach((room) => {
    if (room.name !== DEFAULT_ROOM_NAME) return;
    const score = {};
    let total = 0;
    (hints || []).forEach((h) => {
      try {
        if (room.pointInRoom(new Vector2(h.cxCm, h.cyCm))) {
          score[h.name] = (score[h.name] || 0) + h.weight;
          total += h.weight;
        }
      } catch (e) {
        /* a room still being built */
      }
    });
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < total * HINT_DOMINANCE) return;
    const m2 = (room.area || 0) / 10000;
    const max = MAX_HINTED_AREA_M2[best[0]];
    if (max && m2 > max) return;
    room.name = best[0];
    named += 1;
  });
  return named;
};

/**
 * What every imported wall is finished in: one plain white, on both sides. A
 * wall the editor loads without a texture takes one of two default colours by
 * its number — a cream and a grey-green — so one straight wall, in several
 * pieces, came out in alternating shades, as if it were patterned.
 */
const IMPORTED_WALL_TEXTURE = {
  color: "#FFFFFF",
  name: "Solid",
  colormap: "/assets/rooms/textures/library/solids/21941.jpg",
  reflective: 0.5,
  shininess: 0.5,
};

/**
 * Into the editor. `analysis` (from dxfImport) when walls were built — the
 * plan is then replaced, as AI Import does — else only the background is
 * added. Returns what was made, for the message.
 */
export const applyImport = ({ analysis, sheet }) => {
  if (!analysis) {
    const pi = planImage();
    if (!pi) throw userError("The 2D plan isn't ready yet. Wait a moment and try again.");
    pi.place(sheet);
    pi.fitView();
    return { walls: 0, doors: 0, windows: 0, named: 0 };
  }
  // Saved with every setting, as PlanImage2D.place gives a background — or
  // none: a plan of built walls keeps no original behind it.
  const carbonSheet = sheet
    ? {
        rotation: 0,
        transparency: 0.5,
        hidden: false,
        anchorX: 0.5,
        anchorY: 0.5,
        ...sheet,
      }
    : {};
  // Every wall in the one plain finish — never left for the editor's two
  // alternating defaults to colour.
  const walls = analysis.floorplan.walls.map((w) => ({
    ...w,
    frontTexture: { ...IMPORTED_WALL_TEXTURE },
    backTexture: { ...IMPORTED_WALL_TEXTURE },
  }));
  BlueprintInterface.handleTemplateUpdate(
    JSON.stringify({ floorplan: { ...analysis.floorplan, walls, carbonSheet }, items: [] })
  );
  // The walls arrive already split where others meet or cross them
  // (dxfImport), so the editor's own joining step is not run: on a large
  // drawing it can run for minutes.
  let doors = 0;
  let windows = 0;
  let named = 0;
  try {
    doors = BlueprintInterface.placeAiDoors?.(analysis.doors) || 0;
    windows = BlueprintInterface.placeAiWindows?.(analysis.windows) || 0;
    named = applyRoomNames(analysis.names);
    named += applyRoomHints(analysis.hints);
  } catch (e) {
    console.error("Floor plan import: doors, windows or room names failed", e);
  }
  // A length on every wall, once the plan is in — the way a plan imported into
  // another tool is shown. The Measurements card in the panel is told too.
  try {
    BlueprintInterface.setDimensionsMode2D?.("inner");
    window.dispatchEvent(new CustomEvent("pazl-dim-mode", { detail: "inner" }));
  } catch (e) {
    /* the plan is in; the lengths are a convenience */
  }
  BlueprintInterface.snapshot2D?.();
  BlueprintInterface.ProjectManagerService?.updateFloorPlan?.(HISTORY_TITLES.FLOORPLAN_UPDATED);
  return { walls: analysis.counts.walls, doors, windows, named, columns: analysis.counts.columns || 0 };
};
