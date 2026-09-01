"""
Pazl model THUMBNAIL renderer (batch).

Renders many catalog models (.glb) into small square preview PNGs in a SINGLE
headless Blender process, so we pay Blender's startup cost only once instead of
per model.

Usage:
    blender -b -P thumbnail.py -- MANIFEST.json

  MANIFEST.json is an array of jobs:
    [ { "glb": "C:/abs/path/model.glb", "out": "C:/abs/path/<id>.png" }, ... ]

For each job it: clears the scene, imports the glb, frames the object from a
3/4 angle, adds neutral lighting, and renders a square PNG with EEVEE (fast).
A job that fails (bad glb / no meshes) is logged and skipped; the rest continue.

Quality knobs via env: PAZL_THUMB_RES (default 512), PAZL_THUMB_SAMPLES (16).
Reuses the same ideas as render.py but tuned for single objects (no room
backface-culling, square frame, tight margin).
"""

import bpy
import sys
import os
import json
import math
from mathutils import Vector

RES = int(os.environ.get("PAZL_THUMB_RES", "512"))
SAMPLES = int(os.environ.get("PAZL_THUMB_SAMPLES", "16"))
FRAME_MARGIN = 1.35  # padding around the object in frame
VIEW_DIR = Vector((0.75, -0.9, 0.6))  # 3/4 diagonal, slightly elevated


def parse_args():
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("Expected: blender -b -P thumbnail.py -- MANIFEST.json")
    args = argv[argv.index("--") + 1:]
    if len(args) < 1:
        raise SystemExit("Expected a manifest path after --")
    return args[0]


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def scene_bounds(mesh_objects):
    mins = Vector((float("inf"),) * 3)
    maxs = Vector((float("-inf"),) * 3)
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], world[i])
                maxs[i] = max(maxs[i], world[i])
    return mins, maxs


def setup_world():
    world = bpy.data.worlds.new("PazlThumbWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    bg = nodes.new("ShaderNodeBackground")
    links.new(bg.outputs["Background"], out.inputs["Surface"])
    # soft neutral studio grey so any object colour reads well
    bg.inputs["Color"].default_value = (0.85, 0.85, 0.88, 1.0)
    bg.inputs["Strength"].default_value = 1.2


def add_sun(center, radius):
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.5
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.location = center + Vector((radius, -radius, radius * 1.5))
    direction = (center - sun.location).normalized()
    sun.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(center, radius):
    cam_data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    fov = cam_data.angle
    safe_radius = radius if radius > 1e-6 else 1.0
    distance = (safe_radius / math.sin(fov / 2.0)) * FRAME_MARGIN
    cam.location = center + VIEW_DIR.normalized() * distance
    direction = (center - cam.location).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_start = max(safe_radius * 0.001, 0.001)
    cam_data.clip_end = safe_radius * 100.0


def setup_render(out_path):
    scene = bpy.context.scene
    engines = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    scene.render.engine = next(
        (e for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE") if e in engines),
        "BLENDER_EEVEE_NEXT",
    )
    try:
        scene.eevee.taa_render_samples = SAMPLES
    except Exception:
        pass
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.film_transparent = True  # transparent background
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = out_path
    for vt in ("AgX", "Filmic"):
        try:
            scene.view_settings.view_transform = vt
            break
        except Exception:
            continue


def render_one(glb, out):
    clear_scene()
    meshes = import_glb(glb)
    if not meshes:
        raise RuntimeError("no meshes in glb")
    mins, maxs = scene_bounds(meshes)
    center = (mins + maxs) * 0.5
    radius = (maxs - mins).length * 0.5
    setup_world()
    add_sun(center, radius)
    add_camera(center, radius)
    setup_render(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main():
    manifest_path = parse_args()
    with open(manifest_path, "r", encoding="utf-8") as f:
        jobs = json.load(f)
    total = len(jobs)
    print("[PAZL THUMB] %d job(s), res=%d samples=%d" % (total, RES, SAMPLES))
    ok = 0
    for i, job in enumerate(jobs):
        glb = job["glb"]
        out = job["out"]
        label = "[%d/%d] %s" % (i + 1, total, os.path.basename(glb))
        if not os.path.exists(glb):
            print("[PAZL THUMB] SKIP (missing glb)", label)
            continue
        try:
            render_one(glb, out)
            ok += 1
            print("[PAZL THUMB] OK  ", label)
        except Exception as e:  # keep going on any single failure
            print("[PAZL THUMB] FAIL", label, "->", repr(e))
    print("[PAZL THUMB] finished: %d/%d rendered" % (ok, total))


if __name__ == "__main__":
    main()
