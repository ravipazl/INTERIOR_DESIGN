import React, { useEffect, useRef } from "react";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  sRGBEncoding,
  WebGLRenderer,
} from "three";
import { buildRegionMeshes } from "@pazl/main/viewer3d/wallRegionMeshes";

/**
 * THE WALL IN 3D, live, beside the drawing.
 *
 * It is this one wall face and nothing else — not the room. What matters
 * while setting a wall out is whether a band is the right height and whether
 * a panel reads as standing proud of the wall, and that is easier to judge
 * with nothing in front of it.
 *
 * The panels are built by wallRegionMeshes — the same code that draws them on
 * the real wall after Save — so the preview cannot disagree with the result.
 *
 * `regions` and `openings` arrive already in the page's left-to-right, so the
 * preview matches the drawing whichever side of the wall is being edited.
 */
interface Preview3DProps {
  width: number;
  height: number;
  regions: any[];
  openings: { x: number; y: number; w: number; h: number }[];
  size: number;
}

const Preview3D: React.FC<Preview3DProps> = ({
  width,
  height,
  regions,
  openings,
  size,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<any>(null);

  // The renderer, the wall and the camera: made once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      // No WebGL to spare: the drawing still works without its preview.
      return;
    }
    renderer.outputEncoding = sRGBEncoding;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size);
    host.appendChild(renderer.domElement);

    const scene: any = new Scene();
    scene.background = new Color(0x000000);
    scene.add(new AmbientLight(0xffffff, 0.85));
    const sun = new DirectionalLight(0xffffff, 0.55);
    sun.position.set(width * 0.2, height * 1.6, Math.max(width, height) * 1.5);
    scene.add(sun);

    const wall = new Mesh(
      new PlaneGeometry(width, height),
      new MeshPhongMaterial({ color: 0xe4e4e4 })
    );
    wall.position.set(width / 2, height / 2, 0);
    scene.add(wall);

    // Far enough back to hold the whole wall, a little to one side and above
    // so anything standing out from it shows its edge.
    const reach = Math.max(width, height * 1.25);
    const camera = new PerspectiveCamera(38, 1, 1, reach * 20);
    camera.position.set(width * 0.5 - reach * 0.6, height * 0.75, reach * 2.05);
    camera.lookAt(width / 2, height / 2, 0);

    const state = {
      renderer,
      scene,
      camera,
      cache: new Map(),
      meshes: [] as Mesh[],
      geometries: [] as any[],
      holes: [] as Mesh[],
    };
    stateRef.current = state;

    // Pictures arrive after the panels are made, so it is redrawn on a slow
    // tick rather than once — a few frames a second is plenty for a still.
    const timer = window.setInterval(
      () => renderer.render(scene, camera),
      200
    );
    return () => {
      window.clearInterval(timer);
      state.geometries.forEach((g) => g.dispose());
      state.cache.forEach((m: any) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, size]);

  // The panels and the openings: rebuilt whenever the drawing changes.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.meshes.forEach((m: Mesh) => state.scene.remove(m));
    state.holes.forEach((m: Mesh) => {
      state.scene.remove(m);
      m.geometry.dispose();
    });
    state.geometries.forEach((g: any) => g.dispose());

    state.holes = (openings || []).map((o) => {
      const hole = new Mesh(
        new PlaneGeometry(o.w, o.h),
        new MeshBasicMaterial({ color: 0x2a2d33 })
      );
      hole.position.set(o.x + o.w / 2, o.y + o.h / 2, 0.05);
      state.scene.add(hole);
      return hole;
    });

    try {
      const built = buildRegionMeshes({
        regions,
        openings,
        frame: {
          origin: { x: 0, z: 0 },
          along: { x: 1, z: 0 },
          normal: { x: 0, z: 1 },
        },
        side: FrontSide,
        scene: state.scene,
        cache: state.cache,
      });
      state.meshes = built.meshes;
      state.geometries = built.geometries;
      built.meshes.forEach((m: Mesh) => state.scene.add(m));
    } catch (e) {
      console.warn("WallEditor preview could not be built", e);
      state.meshes = [];
      state.geometries = [];
    }
    state.renderer.render(state.scene, state.camera);
  }, [regions, openings]);

  return <div ref={hostRef} className="we-preview-canvas" />;
};

export default Preview3D;
