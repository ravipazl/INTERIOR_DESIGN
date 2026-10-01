import React, { useEffect, useState } from "react";
import BlueprintInterface from "@pazl/blueprint-interface";
import {
  ROOM_FOCUS_CHANGED,
  currentProjectId,
  getLastRoom,
  resolveFocusedRoom,
  setFocusedRoom,
} from "@pazl/helpers/roomFocus";

/**
 * "ONE ROOM" / "ALL ROOMS" — a toolbar button, not a floating chip.
 *
 * It lives in the top navigation bar with the other tools, and it TOGGLES:
 * press it to design the last room you chose, press it again for the whole
 * house. The earlier version drew itself over the 3D canvas and existed only
 * while a room was focused, so clearing the focus made the control vanish and
 * the only way back was to return to the floor plan and pick the room again.
 *
 * It appears once a room has been designed at least once in this project.
 * Before that there is nothing to toggle to, so the toolbar is untouched.
 */
const RoomFocusChip: React.FC = () => {
  const [focusedName, setFocusedName] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        const projectId = currentProjectId();
        const rooms =
          (BlueprintInterface as any)?.blueprint3d?.model?.__floorplan?.rooms ||
          [];
        // resolveFocusedRoom drops a focus whose room no longer exists, so a
        // plan redrawn since the focus was set comes back as the whole house
        // instead of an empty view.
        const id = resolveFocusedRoom(projectId, rooms);
        const room = id
          ? rooms.find((r: any) => r && r.roomByCornersId === id) || null
          : null;
        setFocusedName(room ? room.name || "Room" : null);
        setLastId(getLastRoom(projectId));
        // This component already knows the focus AND runs after the scene
        // exists, so it drives the 3D filter too. Keeping both on the same read
        // means the label and what you see can never disagree.
        (BlueprintInterface as any).applyRoomFocus3D?.(id);
      } catch (e) {
        setFocusedName(null);
      }
    };
    read();
    window.addEventListener(ROOM_FOCUS_CHANGED, read);

    // KEEP TRYING UNTIL THE SCENE EXISTS.
    //
    // Switching to Furnish mounts this component before the 3D view has
    // finished building its rooms, so the first read finds none and the filter
    // has nothing to act on. A single delayed retry was a guess at how long
    // that takes — on a slow load it missed, and the room never isolated.
    //
    // So: poll until rooms appear, then stop. Gives up after ~10s rather than
    // running forever on a plan that genuinely has no rooms.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const ready =
        ((BlueprintInterface as any)?.blueprint3d?.model?.__floorplan?.rooms ||
          []).length > 0;
      if (ready || tries > 40) {
        read();
        clearInterval(timer);
      }
    }, 250);

    // NOTHING HERE MOVES THE USER'S FURNITURE ANY MORE.
    //
    // There was a guard on a timer that walked any floor item outside the
    // focused room back towards its centre. The intention was to stop an item
    // dragged through a wall from vanishing into a hidden room. The cost was
    // far higher than the benefit: it rewrote placements on a timer, behind the
    // user's back, with no undo — so whenever a cabinet came out in the wrong
    // place it could not be ruled out as the cause, and it genuinely could move
    // a unit off the wall it had just been snapped to.
    //
    // Items end up in the right room by being PLACED there (see the targeting
    // in viewer3d-state-interface), which is a fix at the cause rather than a
    // repair after the fact. Visibility is re-asserted by the renderer every
    // frame and moves nothing. BlueprintInterface.keepItemsInFocusedRoom is
    // still there to be called by hand if a plan ever needs tidying.

    return () => {
      window.removeEventListener(ROOM_FOCUS_CHANGED, read);
      clearInterval(timer);
    };
  }, []);

  // Nothing to offer until a room has been designed once in this project.
  if (!focusedName && !lastId) return null;

  const showingOneRoom = !!focusedName;

  return (
    <div className="pr-px">
      <button
        type="button"
        style={{
          backgroundColor: showingOneRoom
            ? "var(--pz-accent-soft)"
            : "transparent",
        }}
        className="min-w-[44px] h-[46px] px-1 rounded flex flex-col items-center justify-center gap-0.5 transition-colors hover:bg-[color:var(--pz-panel-hover)]"
        title={
          showingOneRoom
            ? `Designing "${focusedName}" on its own — show the whole house`
            : `Design "${focusedName || "the last room"}" on its own again`
        }
        onClick={() =>
          setFocusedRoom(
            currentProjectId(),
            showingOneRoom ? null : lastId
          )
        }
      >
        <span
          style={{ fontSize: 22, lineHeight: "22px" }}
          className={`material-symbols-outlined font-extralight dark:text-[#ffffff] ${
            showingOneRoom
              ? "text-[color:var(--pz-accent)] dark:text-[color:var(--pz-accent)]"
              : ""
          }`}
        >
          {showingOneRoom ? "center_focus_strong" : "home_work"}
        </span>
        <p
          style={{
            fontSize: 10.5,
            lineHeight: "12px",
            margin: 0,
            whiteSpace: "nowrap",
          }}
          className={`menu-button-text dark:text-[#ffffff] ${
            showingOneRoom
              ? "font-semibold text-[color:var(--pz-accent)] dark:text-[color:var(--pz-accent)]"
              : ""
          }`}
        >
          {showingOneRoom ? "All rooms" : "One room"}
        </p>
      </button>
    </div>
  );
};

export default RoomFocusChip;
