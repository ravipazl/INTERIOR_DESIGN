import {
  Blending,
  Box3,
  Vector3,
  Raycaster,
  Vector2,
  Mesh,
  RingGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Group,
} from "three";
import { v4 as uuidv4 } from "uuid";
import BlueprintInterface from "./blueprint-interface";
import { ParametricsInterface } from "../src/scripts/ParametricsInterface.js";
import { ModelsService } from "@pazl/services/ModelsService";
import { MODEL_TYPES } from "@pazl/entities/Model";
import { SnapManager } from "../src/scripts/snap/SnapEngine.js";

// ---------------------------------------------------------------------------
// GLB cache — load each model file only ONCE (Coohom-style). The drag ghost and
// the real drop both go through this, so after the ghost has loaded a model,
// dropping it reuses the already-parsed data → the item appears INSTANTLY (no
// second download + parse). Each caller gets its OWN cloned scene + materials,
// so instances never share/mutate each other (same independence as loading
// fresh). Falls back to a normal load on any error.
// ---------------------------------------------------------------------------
const __gltfCache = {};

function __cloneLoadedScene(gltf) {
  // clone(true) shares geometries (fast, read-only) but we clone materials so
  // each placed item can be recoloured/textured independently.
  const scene = gltf.scene.clone(true);
  scene.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
    }
  });
  return { ...gltf, scene };
}

function __loadGltfCached(url, onLoad, onError) {
  try {
    if (url && __gltfCache[url]) {
      // Already loaded once → reuse instantly with a fresh clone.
      onLoad(__cloneLoadedScene(__gltfCache[url]));
      return;
    }
  } catch (e) {
    // fall through to a normal load
  }
  BlueprintInterface.GLTFLoader.load(
    url,
    (gltf) => {
      try {
        if (url) __gltfCache[url] = gltf; // cache the ORIGINAL (unmutated)
        onLoad(__cloneLoadedScene(gltf));
      } catch (e) {
        onLoad(gltf); // worst case, use the original
      }
    },
    undefined,
    onError
  );
}

// Expose the cached loader so the in-scene render step (Physical3DItem) can
// reuse the SAME already-parsed GLB that the drag/drop just warmed, instead of
// downloading + parsing the file a SECOND time. This is what makes a dropped
// item appear (near-)instantly instead of after a second network round-trip.
try {
  if (BlueprintInterface) BlueprintInterface.loadGltfCached = __loadGltfCached;
} catch (e) {
  /* non-fatal — Physical3DItem falls back to a direct load */
}

function handleAddItemsToScene(
  currentUnitItem,
  furnishModelId,
  isExistingModel
) {
  console.debug("viewer3d-state-interface.js ~ handleAddItemsToScene", {
    currentUnitItem,
    furnishModelId,
  });
  currentUnitItem = currentUnitItem?.model
    ? currentUnitItem.model
    : currentUnitItem;
  let size1 = [];
  let meshde = [];
  let meshmap = [];
  if (currentUnitItem) {
    __loadGltfCached(
      currentUnitItem.modelFileUrl,
      async function (gltf) {
        try {
          // Collect actual meshes via recursive traversal (NOT scene.children
          // — many GLBs are nested under Group nodes). Rename each mesh to
          // Mesh_<i> so the meshmap matches both the seed naming
          // (model_components.name = "Mesh_<i>") and the in-scene
          // Physical3DItem rename done after this preview pass.
          const meshes = [];
          gltf.scene.traverse((o) => {
            if (o.isMesh) meshes.push(o);
          });
          await Promise.all(
            meshes.map(async (mesh, i) => {
              const meshName = `Mesh_${i}`;
              mesh.name = meshName;
              const texture =
                await ModelsService.getModelComponentTexture(meshName);
              meshmap.push({
                name: meshName,
                texture: texture ? `${texture}` : "",
                color: "",
                shininess: 10,
                size: [],
              });
              meshde.push(meshName);
            })
          );
          let box = new Box3().setFromObject(gltf.scene);
          let size = box.getSize(new Vector3());
          size1[0] = size.x;
          size1[1] = size.y;
          size1[2] = size.z;

          // Auto-scale generated/scraped GLBs to pazl's declared bounds.
          // pazl reads `dimensions` as [HEIGHT, WIDTH, DEPTH] in mm.
          // Engine works in cm (1 unit = 1 cm) with Y as up.
          //
          // Old strategy (broken for scraped imports): match Y to declared
          // height. That assumes Y-is-up and units are reasonable. Scraped
          // GLBs frequently break BOTH assumptions — Sketchfab models often
          // ship Z-up or in meters, so a 0.05-unit Y extent scales by 16,000×
          // and the model fills the room.
          //
          // New strategy (axis-agnostic): match the LARGEST of the GLB's
          // bounding-box extents to the LARGEST of the catalog dimensions.
          // Scale uniformly by that ratio. Works regardless of axis
          // convention or native units. Catalog dimension guesses are
          // approximate — they constrain the model to a plausible furniture
          // envelope rather than dictating exact proportions.
          // FIT-TO-SLOT (used by Swap — Coohom method): stretch the model
          // PER-AXIS to fill the door's opening slot exactly (Width × Height ×
          // Depth), with AXIS DETECTION so it never mis-stretches, plus a 90°
          // turn when the model's width sits on the other flat axis. This makes
          // any door model fill the opening and sit flush in the wall. Only taken
          // when `__slot` is present — every normal add still uses the uniform
          // auto-scale below.
          let heightFitDone = false;
          let fitScaleVec = null; // per-axis [x,y,z] engine scale ÷ 100
          let fitInnerTurn = false; // needs a 90° Y turn (width on Z)
          const slot = currentUnitItem.__slot;
          if (
            slot &&
            Number(slot.w) > 0 &&
            Number(slot.h) > 0 &&
            Number(slot.d) > 0 &&
            size.x > 0 &&
            size.y > 0 &&
            size.z > 0
          ) {
            // Target sizes in cm (engine units).
            const targetHcm = Number(slot.h) / 10;
            const targetWcm = Number(slot.w) / 10;
            const targetDcm = Number(slot.d) / 10;
            // AXIS DETECTION: Y is the vertical (height) axis. Of the two flat
            // axes (X, Z), the LARGER is the door's WIDTH, the smaller its DEPTH.
            const xIsWidth = size.x >= size.z;
            const nativeWidth = xIsWidth ? size.x : size.z;
            const nativeDepth = xIsWidth ? size.z : size.x;
            const sHeight = targetHcm / size.y;
            const sWidth = targetWcm / nativeWidth;
            const sDepth = targetDcm / nativeDepth;
            if (sHeight > 0 && sWidth > 0 && sDepth > 0) {
              // Map width/depth scale back onto the real X/Z axes.
              const sceneScaleX = xIsWidth ? sWidth : sDepth;
              const sceneScaleZ = xIsWidth ? sDepth : sWidth;
              gltf.scene.scale.set(sceneScaleX, sHeight, sceneScaleZ);
              box.setFromObject(gltf.scene);
              size = box.getSize(new Vector3());
              size1[0] = size.x;
              size1[1] = size.y;
              size1[2] = size.z;
              heightFitDone = true;
              // Per-axis scale (Physical3DItem multiplies by 100).
              fitScaleVec = [
                sceneScaleX / 100,
                sHeight / 100,
                sceneScaleZ / 100,
              ];
              // If the model's WIDTH is on Z, add a 90° Y turn (as innerRotation,
              // which persists) so the width runs ALONG the wall after wall-snap.
              fitInnerTurn = !xIsWidth;
              currentUnitItem.dimensions = [
                Math.round(size.y * 10),
                Math.round(size.x * 10),
                Math.round(size.z * 10),
              ];
            }
          }

          const declared = Array.isArray(currentUnitItem.dimensions)
            ? currentUnitItem.dimensions
            : null;
          if (
            !heightFitDone &&
            declared &&
            declared.length >= 3 &&
            size.x > 0 &&
            size.y > 0 &&
            size.z > 0
          ) {
            const declaredCm = declared.map((mm) => Number(mm) / 10);
            const maxDeclaredCm = Math.max(...declaredCm);
            const maxActual = Math.max(size.x, size.y, size.z);

            if (maxDeclaredCm > 0 && maxActual > 0) {
              const ratio = maxDeclaredCm / maxActual;
              gltf.scene.scale.setScalar(ratio);
              box.setFromObject(gltf.scene);
              size = box.getSize(new Vector3());
              size1[0] = size.x;
              size1[1] = size.y;
              size1[2] = size.z;

              // Sanity clamp: if the scaled model is still implausibly large
              // (> 5 m on any axis) something is very wrong — likely a GLB
              // wrapped in an oversized container node. Force-fit into a
              // 2 m × 2 m × 2 m envelope so the user can at least see and
              // delete it.
              const MAX_ANY_AXIS_CM = 500;
              const FALLBACK_ENVELOPE_CM = 200;
              const worstExtent = Math.max(size.x, size.y, size.z);
              if (worstExtent > MAX_ANY_AXIS_CM) {
                const fallback = FALLBACK_ENVELOPE_CM / worstExtent;
                gltf.scene.scale.multiplyScalar(fallback);
                box.setFromObject(gltf.scene);
                size = box.getSize(new Vector3());
                size1[0] = size.x;
                size1[1] = size.y;
                size1[2] = size.z;
                console.warn(
                  "viewer3d-state-interface.js ~ auto-scale fallback engaged for",
                  currentUnitItem?.name,
                  "— GLB appears to contain oversized container geometry."
                );
              }

              currentUnitItem.dimensions = [
                Math.round(size.y * 10), // H mm
                Math.round(size.x * 10), // W mm
                Math.round(size.z * 10), // D mm
              ];
              console.debug(
                "viewer3d-state-interface.js ~ scaled by",
                ratio.toFixed(4),
                "(maxDeclared",
                maxDeclaredCm,
                "cm / maxActual",
                maxActual.toFixed(3),
                ") → final [H,W,D] mm =",
                currentUnitItem.dimensions
              );
            }
          }

          let modelId = furnishModelId ? furnishModelId : uuidv4();
          // currentUnitItem.price may be a plain number (uploads) or
          // { unitPrice: number } object (legacy). Handle both.
          const rawPrice = currentUnitItem.price;
          const price =
            rawPrice && typeof rawPrice === "object"
              ? rawPrice.unitPrice
              : rawPrice;
          // Bridge the inspector's auto-scale into the in-scene
          // Physical3DItem. Physical3DItem.__initializeChildItem does:
          //   loadedItem.scale = 100 * itemModel.__scale
          // The 100 is a "metres → cm" assumption that's wrong for scraped
          // GLBs in other units. We propagate the effective inspector scale
          // (gltf.scene.scale.x, already includes any fallback clamp) as
          // metadata.scale ÷ 100 so the final on-screen size matches the
          // size the inspector reported as size1.
          const effectiveScale = gltf.scene.scale.x || 1;
          const metaScale = effectiveScale / 100;
          let metadata = {
            url: currentUnitItem.modelFileUrl,
            dbid: modelId,
            image: currentUnitItem.name,
            name: currentUnitItem.name,
            type: currentUnitItem.type ? currentUnitItem.type : 1,
            size: size1,
            // Per-axis scale when a fit-to-slot ran (Swap); else uniform.
            scale: fitScaleVec
              ? fitScaleVec
              : [metaScale, metaScale, metaScale],
            price,
            description: currentUnitItem.description,
            mesh: meshde,
            rotation: [0, 0, 0],
            // A 90° intrinsic turn (persists) when the door model's width was on
            // the Z axis, so the width runs along the wall after wall-snap.
            innerRotation: fitInnerTurn ? [0, Math.PI / 2, 0] : [0, 0, 0],
            meshmap,
          };
          console.debug(
            "viewer3d-state-interface.js ~ handleAddItemsToScene ~ metadata",
            metadata
          );
          if (parseInt(metadata.type) == MODEL_TYPES.FLOOR_UNIT) {
            BlueprintInterface.roomplanningHelper.addFloorItem(metadata);
          } else if (
            parseInt(metadata.type) == MODEL_TYPES.WALL_UNIT ||
            parseInt(metadata.type) == MODEL_TYPES.IN_WALL_FLOOR_UNIT ||
            parseInt(metadata.type) == MODEL_TYPES.IN_WALL_UNIT
          ) {
            BlueprintInterface.roomplanningHelper.addWallItems(metadata);
          } else if (parseInt(metadata.type) == 4) {
            // 4 = ROOF / Ceiling-mounted (not in the TS MODEL_TYPES enum).
            // Hangs fans, chandeliers, downlights under the ceiling.
            BlueprintInterface.roomplanningHelper.addRoofItem(metadata);
          } else {
            console.warn(
              "viewer3d-state-interface.js ~ unknown model type",
              metadata.type,
              "— defaulting to FLOOR_UNIT placement"
            );
            BlueprintInterface.roomplanningHelper.addFloorItem(metadata);
          }
          BlueprintInterface.setWallSelected(false);
          if (!isExistingModel) {
            BlueprintInterface.ProjectManagerService.createSceneElements(
              currentUnitItem,
              modelId
            );
          }
        } catch (innerErr) {
          console.error(
            "viewer3d-state-interface.js ~ post-load placement failed",
            currentUnitItem?.modelFileUrl,
            innerErr
          );
          // eslint-disable-next-line no-alert
          alert(
            `Loaded "${currentUnitItem?.name}" but failed to place it in the scene.\n\n${
              innerErr?.message || innerErr
            }`
          );
        }
      },
      function (err) {
        console.error(
          "viewer3d-state-interface.js ~ GLTFLoader.load failed",
          currentUnitItem?.modelFileUrl,
          err
        );
        // eslint-disable-next-line no-alert
        alert(
          `Failed to load "${currentUnitItem?.name}".\n\nThe GLB file could not be parsed by the 3D engine (Three.js v0.118).\n\nDetails: ${
            err?.message || err
          }`
        );
      }
    );
  }
}

function handleAddFurnishedModelToScene(furnishedModel) {
  console.debug(
    "viewer3d-state-interface.js ~ handleAddaFurnishedModelToScene",
    furnishedModel
  );
  let model = furnishedModel?.model;
  let size1 = [];
  let meshde = [];
  let meshmap = [];
  if (model) {
    BlueprintInterface.GLTFLoader.load(
      model.modelFileUrl,
      async function (gltf) {
        // Same recursive-traverse + Mesh_<i> rename as new placements (see
        // handleAddItemsToScene). Without this, nested-hierarchy GLBs build
        // meshmap from top-level Group nodes and per-mesh texture pick never
        // applies visually.
        const meshes = [];
        gltf.scene.traverse((o) => {
          if (o.isMesh) meshes.push(o);
        });
        await Promise.all(
          meshes.map(async (mesh, i) => {
            const meshName = `Mesh_${i}`;
            mesh.name = meshName;
            const furnsihedModelComponent =
              await BlueprintInterface.ProjectManagerService.getFurnishedModelCompByFurnishedModelIdAndName(
                furnishedModel._id,
                meshName
              );
            const texture =
              furnsihedModelComponent?.externalFinishFinishing?.texture
                ?.fileUrl;
            meshmap.push({
              name: meshName,
              texture: texture ? `${texture}` : "",
              color: "",
              shininess: 10,
              size: [],
            });
            meshde.push(meshName);
          })
        );
        let box = new Box3().setFromObject(gltf.scene);
        let size = box.getSize(new Vector3());
        // Reload-path scaling. Two cases:
        //
        //  (a) Placement NOT customised (furnishedModel.scale == [1,1,1]) —
        //      uniform auto-scale: match the largest GLB extent to the
        //      largest catalog dimension. Preserves GLB proportions.
        //
        //  (b) Placement customised — the user resized it. furnishedModel
        //      .scale holds the EXACT per-axis engine scale (saved by the
        //      W/H/D handlers as the full [x,y,z] vector). Restore it
        //      directly: gltf.scene.scale = scale × 100 (the engine's
        //      Physical3DItem applies loadedItem.scale = 100 × __scale, so
        //      the inspector pass must match). This is deterministic — no
        //      recompute-from-dimensions drift, no cross-axis corruption.
        const catalogDims = Array.isArray(model.dimensions)
          ? model.dimensions
          : null;
        const placementScale = Array.isArray(furnishedModel.scale)
          ? furnishedModel.scale
          : null;
        const isCustomised =
          placementScale &&
          (Number(placementScale[0]) !== 1 ||
            Number(placementScale[1]) !== 1 ||
            Number(placementScale[2]) !== 1);

        if (isCustomised) {
          // Restore the saved per-axis scale verbatim.
          gltf.scene.scale.set(
            Number(placementScale[0]) * 100,
            Number(placementScale[1]) * 100,
            Number(placementScale[2]) * 100
          );
          box.setFromObject(gltf.scene);
          size = box.getSize(new Vector3());
        } else if (
          catalogDims &&
          catalogDims.length >= 3 &&
          size.x > 0 &&
          size.y > 0 &&
          size.z > 0
        ) {
          // Uniform auto-scale — preserve GLB proportions.
          const declaredCm = catalogDims.map((mm) => Number(mm) / 10);
          const maxDeclaredCm = Math.max(...declaredCm);
          const maxActual = Math.max(size.x, size.y, size.z);
          if (maxDeclaredCm > 0 && maxActual > 0) {
            gltf.scene.scale.setScalar(maxDeclaredCm / maxActual);
          }
          box.setFromObject(gltf.scene);
          size = box.getSize(new Vector3());
        }
        size1[0] = size.x;
        size1[1] = size.y;
        size1[2] = size.z;
        // Per-axis metadata.scale — Physical3DItem multiplies by 100, so
        // divide the inspector's effective scale by 100. Customised
        // placements carry distinct x/y/z; uniform placements carry equal.
        const metadataScale = [
          (gltf.scene.scale.x || 1) / 100,
          (gltf.scene.scale.y || 1) / 100,
          (gltf.scene.scale.z || 1) / 100,
        ];
        console.log("[resize v2] reload", model?.name, {
          isCustomised,
          savedScale: placementScale,
          metadataScale,
        });
        let modelId = uuidv4();
        let metadata = {
          url: model.modelFileUrl,
          dbid: modelId,
          image: model.name,
          name: model.name,
          type: model.type ? model.type : 1,
          size: size1,
          scale: metadataScale,
          price: model.price.unitPrice,
          description: model.description,
          mesh: meshde,
          rotation: [
            furnishedModel.rotation[0],
            furnishedModel.rotation[1],
            furnishedModel.rotation[2],
          ],
          meshmap,
        };
        console.debug(
          "viewer3d-state-interface.js ~ handleAddItemsToScene ~ metadata",
          metadata
        );
        if (parseInt(metadata.type) == MODEL_TYPES.FLOOR_UNIT) {
          BlueprintInterface.roomplanningHelper.addFloorItem(metadata);
        } else if (
          parseInt(metadata.type) == MODEL_TYPES.WALL_UNIT ||
          parseInt(metadata.type) == MODEL_TYPES.IN_WALL_FLOOR_UNIT ||
          parseInt(metadata.type) == MODEL_TYPES.IN_WALL_UNIT
        ) {
          BlueprintInterface.roomplanningHelper.addWallItems(metadata);
        } else if (parseInt(metadata.type) == 4) {
          // 4 = ROOF / Ceiling-mounted. Without this branch a saved fan
          // would silently fail to re-appear on project reload / paste.
          BlueprintInterface.roomplanningHelper.addRoofItem(metadata);
        }
        BlueprintInterface.setWallSelected(false);
        BlueprintInterface.ProjectManagerService.createSceneElements(
          model,
          modelId,
          metadata.rotation
        );
      }
    );
  }
}

function handleDeleteSelectedModel() {
  BlueprintInterface.selectedModels.map((item) => {
    BlueprintInterface.blueprint3d.model.removeItemByMetaData(item);
  });
}

/**
 * SWAP the currently selected object with a different catalog model, IN PLACE.
 * Removes the selected item and re-adds `newModel` at the SAME wall + position
 * (wall / in-wall items) or the same floor position (floor items) — so the
 * replacement lands exactly where the old one was, matching kitchenplanner's
 * "Swap selected object". Purely ADDITIVE: it reuses removeFurnishedModel +
 * handleAddItemsToScene and changes no existing flow.
 */
async function handleSwapSelectedObject(newModel) {
  try {
    const sel =
      BlueprintInterface.selectedModels &&
      BlueprintInterface.selectedModels[0];
    if (!sel) {
      console.warn("[SWAP] nothing selected");
      return;
    }
    const item = sel.__itemModel || sel;
    const helper = BlueprintInterface.roomplanningHelper;
    const furnishedId = item && item.__id;

    // Capture the OLD placement BEFORE removal.
    const oldPos =
      item && item.position && typeof item.position.clone === "function"
        ? item.position.clone()
        : null;
    let wallEdge = item && item.__currentWallEdge;
    const wallNormal = item && item.__currentWallNormal;
    const snapPoint =
      item && item.__currentWallSnapPoint
        ? item.__currentWallSnapPoint.clone()
        : oldPos;

    // A door ALWAYS lives in a wall. If the direct wall reference is missing
    // (some parametric doors don't expose __currentWallEdge), find the wall
    // edge nearest the old door's position so it still docks to the right wall
    // instead of falling to the floor / room centre.
    const floorplan =
      (BlueprintInterface.blueprint3d &&
        BlueprintInterface.blueprint3d.model &&
        BlueprintInterface.blueprint3d.model.__floorplan) ||
      (helper && helper.__model && helper.__model.__floorplan);
    if (!wallEdge && oldPos && floorplan && Array.isArray(floorplan.walls)) {
      let bestD = Infinity;
      floorplan.walls.forEach((w) => {
        [w.frontEdge, w.backEdge, w.__frontEdge, w.__backEdge].forEach((e) => {
          if (e && e.center) {
            const c = e.center;
            const d =
              (c.x - oldPos.x) * (c.x - oldPos.x) +
              (c.z - oldPos.z) * (c.z - oldPos.z);
            if (d < bestD) {
              bestD = d;
              wallEdge = e;
            }
          }
        });
      });
    }
    // This swap is invoked only from the Door panel — the item is always a door
    // (in-wall). Treat it as a wall door whenever we have any wall to dock to.
    const wasWallDoor = !!wallEdge;

    // Capture the OLD dimensions [H, W, D] in mm so the new door is sized to
    // match. Prefer the parametric door's own frame size (its frameWidth/Height
    // are in cm — ×10 to mm); else the furnished model's dimensions; else the
    // live 3D bounding box.
    let oldDims = null;
    const dc = item && item.parametricClass;
    const fw = dc && Number(dc.frameWidth);
    const fh = dc && Number(dc.frameHeight);
    if (fw && fh) {
      const t = Number(
        dc.frameThickness != null ? dc.frameThickness : dc.frameSize
      );
      oldDims = [fh * 10, fw * 10, (t || 4) * 10]; // cm -> mm, [H, W, D]
    }
    if (!oldDims) {
      try {
        const fm =
          BlueprintInterface.ProjectManagerService.getFurnishedModelById(
            furnishedId
          );
        if (fm && Array.isArray(fm.dimensions) && fm.dimensions.length >= 3) {
          oldDims = fm.dimensions.slice();
        }
      } catch (_) {}
    }
    if (!oldDims && sel.__size) {
      // Engine size is in cm — ×10 to mm. __size is (x=W, y=H, z=D).
      oldDims = [
        Math.round(sel.__size.y * 10),
        Math.round(sel.__size.x * 10),
        Math.round(sel.__size.z * 10),
      ];
    }

    // A door lives IN a wall. Force the replacement to be an in-wall item on
    // that SAME wall — regardless of the catalog model's own type — so it always
    // docks where the old door was (some door models are typed floor/other and
    // would otherwise fall to the floor or a random wall).
    const swapModel = { ...(newModel.model ? newModel.model : newModel) };
    if (wasWallDoor) {
      swapModel.type = 7; // IN_WALL_FLOOR_UNIT
    }
    if (oldDims) {
      swapModel.dimensions = oldDims;
      // FIT-TO-SLOT (Coohom method): tell the add flow the door's opening slot —
      // Width × Height × Depth(=wall thickness) in mm — so it stretches the new
      // model PER-AXIS (with axis detection) to fill the opening and sit flush in
      // the wall, regardless of the GLB's native proportions/orientation.
      const wallForThickness =
        (wallEdge && wallEdge.wall) || (item && item.__currentWall) || null;
      const wallThicknessMm =
        wallForThickness && Number(wallForThickness.thickness)
          ? Number(wallForThickness.thickness) * 10 // cm -> mm
          : oldDims[2] || 100;
      swapModel.__slot = {
        w: oldDims[1], // Width mm
        h: oldDims[0], // Height mm
        d: wallThicknessMm, // Depth mm = wall thickness (flush embed)
      };
    }

    // Pre-seat the placement the add flow reads, so the new item docks exactly
    // where the old one was.
    if (wasWallDoor) {
      helper.__selectedEdge = wallEdge;
      helper.__selectedEdgePoint = snapPoint || wallEdge.center || null;
      helper.__selectedEdgeNormal =
        wallNormal || wallEdge.normal || { x: 0, y: 0, z: 1 };
      helper.__selectedRoom =
        (wallEdge && wallEdge.room) || helper.__selectedRoom || null;
      if (helper.__selectedRoom) {
        helper.__roomName = helper.__selectedRoom.name;
      }
    } else if (oldPos) {
      helper.__selectedEdgePoint = oldPos;
      helper.__hasExplicitDropPoint = true;
    }

    console.log(
      "[SWAP] furnishedId=", furnishedId,
      " wasWallDoor=", wasWallDoor,
      " swapType=", swapModel.type,
      " oldDims=", oldDims,
      " existingFM=",
      !!(furnishedId &&
        BlueprintInterface.ProjectManagerService.getFurnishedModelById(
          furnishedId
        ))
    );

    // Remove the old (currently selected) door — scene + backend list.
    if (
      furnishedId &&
      BlueprintInterface.ProjectManagerService.getFurnishedModelById(
        furnishedId
      )
    ) {
      await BlueprintInterface.ProjectManagerService.removeFurnishedModel(
        furnishedId
      );
    } else {
      // No matching furnished record (some parametric doors) — remove the exact
      // selected 3D item from the scene/model directly so it can't linger.
      try {
        BlueprintInterface.blueprint3d.model.removeItemByMetaData(sel);
      } catch (e) {
        console.warn("[SWAP] direct remove failed", e);
      }
    }

    // Add the replacement at the seated placement.
    handleAddItemsToScene(swapModel);
  } catch (e) {
    console.error("[SWAP] handleSwapSelectedObject failed", e);
  }
}

function handleRotateSelectedModel(type) {
  let deg = 1.57; // Deg 90
  if (BlueprintInterface.selectedModels.length) {
    BlueprintInterface.selectedModels.map((item) => {
      if (item.__itemModel.itemType == 1) {
        let y = item.__itemModel.__metadata.rotation[1];
        y = y > 6.28 ? 0 : y;
        if (type == "left") {
          y = y - deg;
        } else {
          y = y + deg;
        }
        BlueprintInterface.blueprint3d.model.rotateItem(
          item.itemModel,
          0,
          y,
          0
        );
      } else {
        let z = item.__itemModel.__metadata.rotation[2];
        z = z > 6.28 ? 0 : z;
        if (type == "left") {
          z = z - deg;
        } else {
          z = z + deg;
        }
        BlueprintInterface.blueprint3d.model.rotateItem(
          item.itemModel,
          0,
          0,
          z
        );
      }
    });
  }
}

function handleLockSelectedModel(mode) {
  BlueprintInterface.selectedModels.map((item) => {
    BlueprintInterface.blueprint3d.model.itemFixed(item, mode);
  });
}

function getParticularItemToScene(mode) {
  if (mode == "floor") {
    return BlueprintInterface.modelDataList.floor;
  } else if (mode == "doors") {
    return BlueprintInterface.modelDataList.doors;
  } else if (mode == "tall") {
    return BlueprintInterface.modelDataList.tall;
  } else if (mode == "wall") {
    return BlueprintInterface.modelDataList.wall;
  } else if (mode == "windows") {
    return BlueprintInterface.modelDataList.windows;
  }
}

function getParticularModelOfItem(itemName, itemUnit, itemUnitName) {
  const items = getParticularItemToScene(itemName);
  const currentItemUnit = items.find((item) => item.name == itemUnit);
  if (currentItemUnit) {
    const currentUnitName = getParticularUnitInsideTheModel(
      currentItemUnit.models,
      itemUnitName
    );
    return currentUnitName;
  }
}

function getParticularUnitInsideTheModel(models, itemUnitName) {
  const currentItemUnitModel = models.find(
    (item) => item.fullname == itemUnitName
  );
  return currentItemUnitModel;
}

function handleModelSelect(evt) {
  let rotatey = null;
  if (evt.itemModel.__metadata.itemType == 1) {
    rotatey = evt.itemModel.__metadata.rotation
      ? Array.isArray(evt.itemModel.__metadata.rotation)
        ? evt.itemModel.__metadata.rotation[1]
        : evt.itemModel.__metadata.rotation.y
      : 0;
  } else {
    rotatey = evt.itemModel.__metadata.rotation
      ? Array.isArray(evt.itemModel.__metadata.rotation)
        ? evt.itemModel.__metadata.rotation[2]
        : evt.itemModel.__metadata.rotation.z
      : 0;
  }
  MeshMapView(evt.itemModel.__metadata);
  let itemModel = evt.itemModel;
  BlueprintInterface.setSelectedModels(evt.item);
  // Parametric door editing now uses the docked React "Door Properties" panel
  // (DoorPropertiesModal in furnishMenu), driven off this same selection event.
  // We no longer open the old floating quicksettings popup — just tear down any
  // leftover one so nothing stays on screen.
  void itemModel;
  if (BlueprintInterface.parametricContextInterface) {
    BlueprintInterface.parametricContextInterface.destroy();
    BlueprintInterface.parametricContextInterface = null;
  }
}

function MeshMapView(metadata) {
  let mesh = metadata.meshmap;
  let meshlist = metadata.mesh;
  BlueprintInterface.setSelectedMeshList(meshlist);
  BlueprintInterface.setSelectedMeshWithObject(mesh);
  // Parametric / AI items (e.g. doors) have no meshmap — there are no sub-meshes
  // to texture-map. Bail out before indexing mesh[0] so selecting such an item
  // doesn't crash ("Cannot read properties of undefined (reading '0')").
  // Catalog models (which have a meshmap) continue normally.
  if (!mesh || !mesh.length) return;
  let size = [1, 1, 1];
  if (mesh[0]?.size != "") {
    size = mesh[0]?.size;
  }
  if (!BlueprintInterface.selectedMesh) {
    BlueprintInterface.selectedMesh = mesh[0]?.name;
    BlueprintInterface.selectedColors = mesh[0];
    size = mesh[0]?.size;
  } else {
    if (
      BlueprintInterface.selectedMeshList.indexOf(
        BlueprintInterface.selectedMesh
      ) === -1
    ) {
      BlueprintInterface.selectedMesh = mesh[0]?.name;
    }

    BlueprintInterface.selectedColors = mesh.find((o, i) => {
      if (o.name === BlueprintInterface.selectedMesh) {
        return o;
      }
    });
    size = BlueprintInterface.selectedColors.size;
  }
}

function handleAddItem() {
  console.debug(
    "🚀 ~ file: viewer3d-state-interface.js:169 ~ handleAddItem ~ handleAddItem:"
  );
}

/**
 * Coohom-style drag-to-place: add `model` to the scene at the FLOOR point under
 * the given screen coordinates (where the user dropped the catalog card).
 *
 * Purely ADDITIVE — it reuses handleAddItemsToScene UNCHANGED. We just pre-set
 * the RoomplannerHelper's placement point (the very fields addFloorItem already
 * reads) to the drop location, then delegate. If a floor point can't be
 * resolved, we fall back to the normal default placement, so a drop never fails
 * and the existing "+ Add" behaviour is never affected.
 */
function handleDropModelAtScreen(model, clientX, clientY) {
  try {
    const bp = BlueprintInterface.blueprint3d;
    const viewer = bp && (bp.roomplanner || bp.viewer3d);
    const helper = BlueprintInterface.roomplanningHelper;
    // Use the viewer's OWN floorplan (the same object the working drag-controls
    // raycast against), falling back to the model's floorplan.
    const floorplan =
      (viewer && viewer.floorplan) || (bp && bp.model && bp.model.__floorplan);
    if (viewer && helper && floorplan) {
      const camera = viewer.camera;
      const dom = viewer.renderer && viewer.renderer.domElement;
      const floors = floorplan.floorPlanesForIntersection || [];
      if (camera && dom && floors.length) {
        // Make sure the camera's world/projection matrices are current before
        // building the ray (a stale matrix would send the ray off the floor).
        camera.updateMatrixWorld();
        const rect = dom.getBoundingClientRect();
        const mouse = new Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        );
        const ray = new Raycaster();
        ray.setFromCamera(mouse, camera);
        // SURFACE-AWARE DROP: wall-mounted / in-wall / floor-to-ceiling items
        // belong on a WALL — drop them on the wall under the cursor. Floor
        // (and ceiling) items use the floor point (below).
        const dropType = Number(
          (model && model.type) ??
            (model && model.model && model.model.type) ??
            1
        );
        const isWallType =
          dropType === 2 || dropType === 3 || dropType === 7;
        let wallHandled = false;
        if (isWallType) {
          const wallPlanes = floorplan.wallPlanesForIntersection || [];
          const wallHits = wallPlanes.length
            ? ray.intersectObjects(wallPlanes, true)
            : [];
          if (
            wallHits.length &&
            wallHits[0].object &&
            wallHits[0].object.edge
          ) {
            const wh = wallHits[0];
            const edge = wh.object.edge;
            helper.__selectedEdge = edge;
            helper.__selectedEdgePoint = wh.point;
            helper.__selectedEdgeNormal =
              (wh.face && wh.face.normal) ||
              edge.normal || { x: 0, y: 0, z: 1 };
            const wallRoom =
              edge.room || (floorplan.rooms && floorplan.rooms[0]);
            if (wallRoom) {
              helper.__selectedRoom = wallRoom;
              helper.__roomName = wallRoom.name;
            }
            wallHandled = true;
          }
          // No wall under the cursor → fall through to addWallItems' own
          // fallback wall (leave placement as-is).
        }

        if (!wallHandled) {
        // recursive = TRUE: a room's floorPlane can be a Group whose geometry is
        // in a child mesh; a non-recursive test would miss it (that's what made
        // the drop fall back to the default centre).
        const hits = ray.intersectObjects(floors, true);
        console.debug(
          "handleDropModelAtScreen ~ floors:",
          floors.length,
          "hits:",
          hits.length,
          "point:",
          hits[0] && hits[0].point
        );
        const rooms = floorplan.rooms || [];
        // Prefer the SNAPPED point the ghost showed (flush to wall/corner/other
        // item) so the item lands exactly where the preview was. Fall back to
        // the raw cursor hit if there was no ghost snap this drag.
        const dropPoint =
          __lastGhostSnapPoint && Number.isFinite(__lastGhostSnapPoint.x)
            ? __lastGhostSnapPoint.clone()
            : hits.length
            ? hits[0].point
            : null;

        // Keep the item INSIDE a room — never outside the building. If the drop
        // point lands inside a room polygon, place it exactly there. Otherwise
        // (dropped on empty space, or the floor plane extends past the walls)
        // snap to the NEAREST room's centre so it always stays in the plan.
        let targetRoom = null;
        let targetPoint = null;
        if (dropPoint) {
          const p2 = new Vector2(dropPoint.x, dropPoint.z);
          targetRoom = rooms.find(
            (r) => r && r.pointInRoom && r.pointInRoom(p2)
          );
          if (targetRoom) targetPoint = dropPoint;
        }
        if (!targetRoom && rooms.length) {
          let bestD = Infinity;
          rooms.forEach((r) => {
            const c = r && r.center;
            if (!c) return;
            const d = dropPoint
              ? Math.hypot(dropPoint.x - c.x, dropPoint.z - c.z)
              : 0;
            if (d < bestD) {
              bestD = d;
              targetRoom = r;
            }
          });
          if (targetRoom) targetPoint = targetRoom.center;
        }
        console.debug(
          "handleDropModelAtScreen ~ inside-room:",
          !!(dropPoint && targetPoint === dropPoint),
          "room:",
          targetRoom && targetRoom.name
        );
        if (targetRoom && targetPoint) {
          helper.__selectedRoom = targetRoom;
          helper.__selectedEdgePoint = targetPoint;
          helper.__selectedEdgeNormal = { x: 0, y: 0, z: 1 };
          helper.__roomName = targetRoom.name;
          // Tell addFloorItem this is an EXPLICIT drop point — land the item
          // exactly here, don't recentre it in the room.
          helper.__hasExplicitDropPoint = true;
        }
        } // end if (!wallHandled)
      } else {
        console.debug(
          "handleDropModelAtScreen ~ missing refs — camera:",
          !!camera,
          "dom:",
          !!dom,
          "floors:",
          floors.length
        );
      }
    }
  } catch (e) {
    console.error(
      "viewer3d-state-interface.js ~ handleDropModelAtScreen ~ floor pick failed; using default placement",
      e
    );
  }
  // Delegate to the normal add flow (unchanged). If we set a placement point
  // above, addFloorItem uses it; otherwise it falls back to the room centre.
  handleAddItemsToScene(model);
}

// ---------------------------------------------------------------------------
// GHOST PREVIEW + WALL SNAP while dragging a catalog card over the 3D view.
//
// While the user drags a NEW item from the catalog, we show a TRANSLUCENT COPY
// of the real furniture (loaded from the same GLB the "+ Add" flow uses) that
// follows the cursor and SNAPS FLUSH to walls / corners / other furniture using
// the SAME SnapEngine the in-scene drag uses. Before the GLB finishes loading
// we fall back to a translucent ring so there's always feedback.
//
// Fully live-safe: the ghost is added to the viewer scene only while dragging,
// toggled visible/hidden, and disposed on drop/drag-end. It NEVER touches saved
// data. Every path is wrapped in try/catch so a preview glitch can't break the
// real drop.
// ---------------------------------------------------------------------------
let __dropPreviewMesh = null; // fallback ring (shown until the GLB ghost loads)
let __dropGhost = null; // Group holding the translucent real model
let __dropGhostModelId = null; // which catalog model the ghost was built for
let __dropGhostHalfSize = null; // Vector3 half-extents of the loaded ghost (cm)
let __dropSnapManager = null; // reuse the engine's SnapEngine for catalog drops
let __lastGhostSnapPoint = null; // last SNAPPED floor point → used by the drop

function __getDropSnapManager() {
  if (!__dropSnapManager) __dropSnapManager = new SnapManager();
  return __dropSnapManager;
}

function __getDropPreviewMesh(viewer) {
  if (!__dropPreviewMesh) {
    // Ring sized in cm (world units) so it's clearly visible in a room.
    const geo = new RingGeometry(25, 55, 40);
    const mat = new MeshBasicMaterial({
      color: 0x2f6fed,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      depthTest: false,
    });
    __dropPreviewMesh = new Mesh(geo, mat);
    __dropPreviewMesh.rotation.x = -Math.PI / 2; // lay flat on the floor
    __dropPreviewMesh.renderOrder = 9999;
    __dropPreviewMesh.visible = false;
    // Gentle pulse (Coohom-style) so the drop target reads as "live". Runs each
    // frame the ring is rendered — opacity + a slight breathing scale.
    __dropPreviewMesh.onBeforeRender = () => {
      try {
        const t = performance.now() * 0.004;
        const s = 0.5 + 0.5 * Math.sin(t); // 0..1
        mat.opacity = 0.35 + 0.3 * s;
        const scl = 0.9 + 0.12 * s;
        __dropPreviewMesh.scale.set(scl, scl, 1);
      } catch (e) {
        /* cosmetic only */
      }
    };
  }
  if (viewer && __dropPreviewMesh.parent !== viewer) {
    viewer.add(__dropPreviewMesh);
  }
  return __dropPreviewMesh;
}

// Half-extents (cm) guessed from the catalog dimensions [H, W, D] in mm. Used to
// snap the RING to walls before the real ghost GLB has loaded.
function __fallbackHalfSize(model) {
  const src = model && (model.dimensions || (model.model && model.model.dimensions));
  if (Array.isArray(src) && src.length >= 3) {
    const h = Number(src[0]) / 10;
    const w = Number(src[1]) / 10;
    const d = Number(src[2]) / 10;
    if (w > 0 && h > 0 && d > 0) {
      return new Vector3(w / 2, h / 2, d / 2);
    }
  }
  return null;
}

// WARM the GLB cache for `model` (once per dragged model) so the DROP places
// the item instantly. NO visual shadow/ghost is built — the translucent preview
// was removed per user request. `viewer` is unused now but kept for signature
// compatibility with the caller.
function __ensureGhost(model, viewer) {
  const id = model && (model._id || model.id);
  if (!id || __dropGhostModelId === id) return; // already warmed for this model
  __dropGhostModelId = id;
  const item = model.model ? model.model : model;
  const url = item && item.modelFileUrl;
  if (!url || !BlueprintInterface.GLTFLoader) return;

  // Load into the cache only (no-op onLoad) — the real drop reuses it instantly.
  __loadGltfCached(
    url,
    () => {},
    (err) => {
      console.warn("model preload failed (non-fatal) — ignoring", err);
    }
  );
}

// Pre-warm the GLB cache for a catalog model — call it on card hover / when the
// item list renders, so by the time the user clicks "+ Add" (or drops), the
// model is already downloaded + parsed and the item appears instantly (no white
// box wait). Safe to call repeatedly: __loadGltfCached no-ops on a cache hit.
function warmModelCache(model) {
  try {
    const item = model && (model.model ? model.model : model);
    const url = item && item.modelFileUrl;
    if (!url || !BlueprintInterface.GLTFLoader) return;
    __loadGltfCached(
      url,
      () => {},
      (err) => console.warn("warmModelCache failed (non-fatal)", err)
    );
  } catch (e) {
    /* non-fatal */
  }
}

// Snap a raw floor point to the nearest wall / corner / other item using the
// SAME SnapEngine as the in-scene drag. Returns the snapped Vector3 (or the raw
// point if nothing snaps). `halfSize` describes the dragged item's footprint.
function __snapFloorPoint(rawPoint, halfSize, floorplan) {
  try {
    const bp = BlueprintInterface.blueprint3d;
    const draggableItems =
      (bp && bp.model && bp.model.__roomItems) || [];
    const dragged = {
      __loadedItem: __dropGhost || null,
      itemModel: { halfSize: halfSize || new Vector3(25, 25, 25) },
    };
    const snap = __getDropSnapManager().query({
      dragged,
      candidate: rawPoint.clone(),
      candidateNormal: new Vector3(0, 1, 0),
      intersectingPlane: null,
      floorplan,
      draggableItems,
      shiftHeld: false,
    });
    if (snap && snap.position) return snap.position;
  } catch (e) {
    // Snap is optional — fall through to the raw point.
  }
  return rawPoint;
}

function showDropPreviewAtScreen(model, clientX, clientY) {
  try {
    const bp = BlueprintInterface.blueprint3d;
    const viewer = bp && (bp.roomplanner || bp.viewer3d);
    const floorplan =
      (viewer && viewer.floorplan) || (bp && bp.model && bp.model.__floorplan);
    if (!viewer || !floorplan) return;
    const camera = viewer.camera;
    const dom = viewer.renderer && viewer.renderer.domElement;
    const floors = floorplan.floorPlanesForIntersection || [];
    if (!camera || !dom || !floors.length) return;

    // Warm the model cache during drag so the DROP places the item instantly —
    // but show NO translucent shadow (removed per request).
    if (model) __ensureGhost(model, viewer);

    camera.updateMatrixWorld();
    const rect = dom.getBoundingClientRect();
    const mouse = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new Raycaster();
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(floors, true);

    if (!hits.length) {
      __lastGhostSnapPoint = null;
      return;
    }

    const raw = hits[0].point;
    // Still compute the snapped drop point so the item lands flush to
    // walls/corners on drop — just without drawing any visual preview.
    const halfSize = __fallbackHalfSize(model);
    const snapped = __snapFloorPoint(raw, halfSize, floorplan);
    __lastGhostSnapPoint = snapped.clone();
  } catch (e) {
    // Non-fatal: preview is purely cosmetic.
  }
}

function hideDropPreview() {
  try {
    if (__dropPreviewMesh) __dropPreviewMesh.visible = false;
    if (__dropGhost) __dropGhost.visible = false;
    const bp = BlueprintInterface.blueprint3d;
    const viewer = bp && (bp.roomplanner || bp.viewer3d);
    if (viewer && viewer.needsUpdate !== undefined) viewer.needsUpdate = true;
  } catch (e) {
    // Non-fatal.
  }
}

// Fully tear down the ghost when the drag ends (drop or cancel): remove from the
// scene, dispose GPU resources, and reset all ghost state so the next drag loads
// fresh. The snapped drop point is cleared here too.
function clearDropGhost() {
  try {
    if (__dropGhost) {
      if (__dropGhost.parent) __dropGhost.parent.remove(__dropGhost);
      __dropGhost.traverse((o) => {
        if (o.isMesh) {
          if (o.geometry && o.geometry.dispose) o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m && m.dispose && m.dispose());
        }
      });
    }
  } catch (e) {
    // Non-fatal.
  }
  __dropGhost = null;
  __dropGhostModelId = null;
  __dropGhostHalfSize = null;
  __lastGhostSnapPoint = null;
  if (__dropPreviewMesh) __dropPreviewMesh.visible = false;
  const bp = BlueprintInterface.blueprint3d;
  const viewer = bp && (bp.roomplanner || bp.viewer3d);
  if (viewer && viewer.needsUpdate !== undefined) viewer.needsUpdate = true;
}

export {
  handleAddItemsToScene,
  handleDropModelAtScreen,
  showDropPreviewAtScreen,
  hideDropPreview,
  clearDropGhost,
  getParticularModelOfItem,
  handleModelSelect,
  handleDeleteSelectedModel,
  handleSwapSelectedObject,
  handleRotateSelectedModel,
  handleLockSelectedModel,
  handleAddItem,
  handleAddFurnishedModelToScene,
  warmModelCache,
};
