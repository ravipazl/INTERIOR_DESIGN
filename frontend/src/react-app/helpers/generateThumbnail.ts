import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Box3,
  Vector3,
  Color,
  HemisphereLight,
  DirectionalLight,
  sRGBEncoding,
} from "three";
import BlueprintInterface from "@pazl/blueprint-interface";
import { ModelsService } from "@pazl/services/ModelsService";

/**
 * Auto-generate a catalog preview for a freshly-added model and store it.
 *
 * Any GLB added through the app (Sketchfab / Poly Haven / Objaverse / Tripo /
 * manual upload) is saved with an EMPTY `thumbnail`, so its catalog card shows
 * "No preview". This renders a quick lit snapshot of the GLB in an isolated
 * offscreen three.js scene, converts the canvas to a JPEG, and uploads it to
 * POST /thumbnail-upload — which stores it under /assets/models/thumbnails/ and
 * sets the model's `thumbnail`. Works for every source because it renders the
 * actual geometry, not a source image.
 *
 */
export async function generateAndUploadThumbnail(
  modelId: string,
  modelFileUrl: string,
  size = 512
): Promise<boolean> {
  if (!modelId || !modelFileUrl) return false;
  const loader: any = (BlueprintInterface as any)?.GLTFLoader;
  if (!loader) return false;

  let renderer: WebGLRenderer | null = null;
  try {
    const gltf: any = await new Promise((resolve, reject) => {
      loader.load(modelFileUrl, resolve, undefined, reject);
    });
    const root = gltf?.scene || gltf?.scenes?.[0];
    if (!root) return false;

    const scene = new Scene();
    scene.background = new Color(0xf3f3f4); // light neutral, matches the card bg
    scene.add(root);

    // Lighting — a soft fill + a key light so the snapshot reads as a lit photo.
    scene.add(new HemisphereLight(0xffffff, 0x555555, 1.0));
    const key = new DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 1.4, 1);
    scene.add(key);

    // Frame the model: fit the camera to its bounding box from a 3/4 angle.
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    const dims = box.getSize(new Vector3());
    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;

    const camera = new PerspectiveCamera(40, 1, maxDim / 1000, maxDim * 100);
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6; // 1.6 = a little margin
    const dir = new Vector3(1, 0.75, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true, // required so toDataURL captures the frame
    });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size);
    renderer.outputEncoding = sRGBEncoding;
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.85);
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `${modelId}.jpg`, { type: "image/jpeg" });

    await ModelsService.uploadThumbnail(modelId, file);
    return true;
  } catch (e) {
    console.warn("generateAndUploadThumbnail failed (non-fatal):", e);
    return false;
  } finally {
    try {
      renderer?.dispose();
      renderer?.forceContextLoss?.();
    } catch (_) {
      /* ignore */
    }
  }
}
