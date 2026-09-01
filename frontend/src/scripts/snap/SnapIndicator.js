/**
 * SnapIndicator — Snap Engine, Phase 3
 *
 * Draws the line segments a SnapCandidate carries in its `guide` field so
 * the user can SEE what an item snapped to during a drag. Without this the
 * snap is silent — the item just "jumps" and the user can't tell why.
 *
 * One reusable LineSegments object is kept alive and re-used every drag
 * tick (its geometry is rewritten, not recreated) to avoid per-frame
 * allocation. It is parented to the same container the dragged item lives
 * in — that container is at identity transform, so the world-space guide
 * coordinates from SnapEngine render in the right place.
 *
 * Lifecycle:
 *   show(parent, snap) — called every move tick while dragging
 *   hide()             — called when there is no snap, or on drag release
 *   dispose()          — called when the drag control is torn down
 */

import {
  BufferGeometry,
  LineSegments,
  LineBasicMaterial,
  Float32BufferAttribute,
} from "three";

// Indicator colour per snap kind. Picked so each kind reads distinctly:
//   wall   — green   (a clean flat-wall snap)
//   corner — amber   (the stronger inside-corner snap)
//   edge   — blue    (item-to-item contact)
//   centre — purple  (item-to-item alignment)
//   grid   — grey
const KIND_COLOR = {
  wall: 0x21b35a,
  corner: 0xff9800,
  objectEdge: 0x1e88e5,
  objectCenter: 0x8e24aa,
  grid: 0x9e9e9e,
};

export class SnapIndicator {
  constructor() {
    this.__object = null;
    this.__parent = null;
  }

  // Lazily create the LineSegments and (re)parent it to `parent`.
  __ensure(parent) {
    if (this.__object && this.__parent === parent) return;
    // Parent changed (or first use) — drop the old object cleanly.
    this.dispose();
    const material = new LineBasicMaterial({
      color: 0xffffff,
      // Draw on top of the floor / meshes so the guide is never occluded.
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const object = new LineSegments(new BufferGeometry(), material);
    object.renderOrder = 1000;
    // The geometry is rewritten every tick; skip frustum culling so a
    // stale bounding sphere can never hide a valid guide.
    object.frustumCulled = false;
    object.visible = false;
    object.name = "__snapIndicator";
    parent.add(object);
    this.__object = object;
    this.__parent = parent;
  }

  /**
   * Render the guide for the current snap.
   * @param {Object3D} parent  container the dragged item lives in
   * @param {{kind:string, guide?:{lines:Array}}} snap
   */
  show(parent, snap) {
    // Snap guide LINES are hidden in the UI by request — the coloured wall /
    // corner / centre / edge / grid guides no longer draw. Only the visual is
    // suppressed: the SNAPPING BEHAVIOUR is untouched (that lives in
    // SnapManager), so items still line up neatly to walls/corners/other items,
    // just without a coloured line. Set HIDE_SNAP_GUIDES to false to bring the
    // guides back.
    const HIDE_SNAP_GUIDES = true;
    if (HIDE_SNAP_GUIDES) {
      this.hide();
      return;
    }
    if (!parent || !snap || !snap.guide || !snap.guide.lines?.length) {
      this.hide();
      return;
    }
    this.__ensure(parent);

    const positions = [];
    for (const seg of snap.guide.lines) {
      if (!seg || seg.length < 2 || !seg[0] || !seg[1]) continue;
      positions.push(seg[0].x, seg[0].y, seg[0].z);
      positions.push(seg[1].x, seg[1].y, seg[1].z);
    }
    if (!positions.length) {
      this.hide();
      return;
    }

    const geometry = this.__object.geometry;
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(positions, 3)
    );
    geometry.computeBoundingSphere();

    this.__object.material.color.setHex(
      KIND_COLOR[snap.kind] ?? 0xffffff
    );
    this.__object.visible = true;
  }

  hide() {
    if (this.__object) this.__object.visible = false;
  }

  dispose() {
    if (this.__object) {
      this.__parent?.remove(this.__object);
      this.__object.geometry?.dispose();
      this.__object.material?.dispose();
    }
    this.__object = null;
    this.__parent = null;
  }
}

export default SnapIndicator;
