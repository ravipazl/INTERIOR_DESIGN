/**
 * WHICH ROOM AM I DESIGNING?
 *
 * The whole house is hard to work in, so a room can be FOCUSED: 3D shows that
 * room's floor, walls and furniture normally, the neighbouring walls faintly,
 * and everything else not at all. Clearing the focus brings the house back with
 * every room's work in it — nothing is ever split or copied, so there is
 * nothing to merge back.
 *
 * KEPT PER BROWSER, NOT ON THE PROJECT, and that is deliberate rather than
 * cheap. Focus is a view setting, like a camera angle: if it lived on the
 * project record, two people working on the same house would keep dragging each
 * other into whichever room the other had opened. Stored here it survives a
 * reload — which is what was asked for — without one person's view becoming
 * everyone's.
 *
 * The id stored is the engine's `roomByCornersId`. That id is rebuilt whenever
 * the room's corners change, so a focus can go stale; every reader below must
 * check the id still names a real room and fall back to the whole house if not.
 * blueprint-interface's reassignOrphanRoomIds does the same for placed items.
 */

const KEY = "pazl-room-focus";

/**
 * The last room DESIGNED in a project, kept even after going back to the whole
 * house — so the toolbar can offer "back to that room" instead of sending you
 * to the floor plan to pick it again.
 *
 * A SEPARATE key rather than a richer value under KEY, because the engine reads
 * KEY directly (blueprint-interface's restoreRoomFocus3D) and expects a plain
 * id. Changing that shape would quietly break focus restoring on reload for
 * anyone whose browser still holds the old value.
 */
const LAST_KEY = "pazl-room-focus-last";

/**
 * The project being edited, read from the address bar (?projectId=…).
 *
 * Taken from the URL rather than threaded down through props: the 2D panel, the
 * 3D view and the catalogue all need it, and they sit in different branches of
 * the tree. The editor cannot be open without it, so there is a single place it
 * is always true.
 */
export function currentProjectId(): string {
  try {
    return new URLSearchParams(window.location.search).get("projectId") || "";
  } catch (e) {
    return "";
  }
}

/** Fired on `window` whenever the focus changes, so views can redraw. */
export const ROOM_FOCUS_CHANGED = "pazl-room-focus-changed";

/**
 * "Take me to the 3D view."
 *
 * Fired when you press "Design this room". Choosing a room to design and then
 * being left looking at the same 2D plan is why this read as broken — the work
 * had happened, just somewhere you could not see. The tab switch lives in
 * MenuBar, four levels above the button, so an event carries the request up
 * rather than threading a callback down through every panel in between.
 */
export const OPEN_3D_VIEW = "pazl-open-3d-view";

export function open3DView() {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_3D_VIEW));
  } catch (e) {
    /* no window (tests) */
  }
}

type FocusMap = Record<string, string>;

function readAll(key = KEY): FocusMap {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    // Private mode, cleared storage, or a value someone else corrupted —
    // an unreadable preference must never stop the editor opening.
    return {};
  }
}

function writeAll(map: FocusMap, key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch (e) {
    /* storage full or blocked — focus simply will not survive the reload */
  }
}

/**
 * The last room designed in this project, whether or not it is focused now.
 * Null until a room has been chosen at least once — the toolbar shows nothing
 * before that, because there is no room to go back to.
 */
export function getLastRoom(projectId: string): string | null {
  if (!projectId) return null;
  const value = readAll(LAST_KEY)[String(projectId)];
  return value ? String(value) : null;
}

/** The room being designed in this project, or null for the whole house. */
export function getFocusedRoom(projectId: string): string | null {
  if (!projectId) return null;
  const value = readAll()[String(projectId)];
  return value ? String(value) : null;
}

/**
 * Focus a room, or pass null to go back to the whole house. Always announces
 * the change, even when nothing was stored, so a view asked to "show
 * everything" refreshes rather than keeping a stale filter.
 */
export function setFocusedRoom(projectId: string, roomId: string | null) {
  if (!projectId) return;
  const map = readAll();
  const key = String(projectId);
  if (roomId) map[key] = String(roomId);
  else delete map[key];
  writeAll(map);
  // Remember it as the last room designed. Only ever written, never cleared by
  // "All rooms": that is exactly the moment the toolbar needs it, to offer the
  // way back in.
  if (roomId) {
    const last = readAll(LAST_KEY);
    last[key] = String(roomId);
    writeAll(last, LAST_KEY);
  }
  try {
    window.dispatchEvent(
      new CustomEvent(ROOM_FOCUS_CHANGED, {
        detail: { projectId: key, roomId: roomId ? String(roomId) : null },
      })
    );
  } catch (e) {
    /* no window (tests) */
  }
}

/** Convenience for the "All rooms" control. */
export function clearFocusedRoom(projectId: string) {
  setFocusedRoom(projectId, null);
}

/**
 * The focused room ONLY IF it still exists in the given list of live rooms.
 *
 * A stored focus outgrows the plan: redraw a wall and the room's corner list —
 * and so its id — changes, leaving a focus that names nothing. Showing an empty
 * 3D view in that case would look like the project had lost its furniture, so
 * a focus that no longer resolves is dropped and the whole house is shown.
 */
export function resolveFocusedRoom(
  projectId: string,
  rooms: any[]
): string | null {
  const wanted = getFocusedRoom(projectId);
  if (!wanted) return null;
  // NO ROOMS YET IS NOT THE SAME AS NO SUCH ROOM.
  //
  // The 3D scene builds its rooms after the plan loads, so a caller asking
  // early gets an empty list. Treating that as "stale" DELETED the focus the
  // user had just set — press "Design this room", switch to Furnish, and the
  // focus was already gone before the scene existed to apply it to. Only an
  // answer based on a real list can retire a focus.
  if (!rooms || !rooms.length) return wanted;
  const exists = rooms.some((r) => r && r.roomByCornersId === wanted);
  if (exists) return wanted;
  // Genuinely gone — forget it, so the next load starts clean.
  setFocusedRoom(projectId, null);
  return null;
}
