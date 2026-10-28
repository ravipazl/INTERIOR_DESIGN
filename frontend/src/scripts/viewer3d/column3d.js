import { Mesh, BoxGeometry, MeshStandardMaterial } from "three";

/** Colour of a column's faces: a light concrete, a little apart from the walls round it. */
const COLUMN_COLOR = 0xd9d9d9;
/** How far (cm) a column is made larger than its box, so its faces never share a plane with a wall's. */
const COLUMN_GROW_CM = 0.2;

/**
 * A STRUCTURAL COLUMN in 3D: a box, the floorplan's { x0, y0, x1, y1 } wide
 * and deep, from the floor to `height`. A box of its own — not a wall piece,
 * whose footprint the editor works out from the walls beside it — so it stands
 * exactly where, and as large as, the plan has it. In the scene's own axes a
 * plan point (x, y) is (x, ·, y).
 */
export class Column3D {
  constructor(scene, column, height) {
    this.__scene = scene;
    const w = Math.abs(column.x1 - column.x0) + COLUMN_GROW_CM;
    const d = Math.abs(column.y1 - column.y0) + COLUMN_GROW_CM;
    const h = height + COLUMN_GROW_CM;
    this.__geometry = new BoxGeometry(w, h, d);
    this.__material = new MeshStandardMaterial({
      color: COLUMN_COLOR,
      roughness: 0.9,
      metalness: 0,
      // Wins a tie in depth with a wall's face that is flush with the column's.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.__mesh = new Mesh(this.__geometry, this.__material);
    this.__mesh.position.set((column.x0 + column.x1) / 2, h / 2 - COLUMN_GROW_CM / 2, (column.y0 + column.y1) / 2);
    this.__mesh.castShadow = true;
    this.__mesh.receiveShadow = true;
    // Never the target of a click or a drag meant for what is beyond it.
    this.__mesh.raycast = () => {};
    this.__mesh.name = "column";
    scene.add(this.__mesh);
  }

  remove() {
    if (this.__mesh && this.__scene) this.__scene.remove(this.__mesh);
    if (this.__geometry) this.__geometry.dispose();
    if (this.__material) this.__material.dispose();
    this.__mesh = null;
    this.__scene = null;
  }
}
