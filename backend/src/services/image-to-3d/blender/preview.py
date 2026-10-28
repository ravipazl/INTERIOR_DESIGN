# Run by claude-blender.js:
#   blender -b --factory-startup -P preview.py -- <in.glb> <out_prefix> <azimuth_deg,azimuth_deg,...>
# Renders the GLB (grey floor, soft sky, one sun) once per azimuth to <out_prefix>_<n>.png.
# Azimuth 0 looks at the FRONT (the -Y side in Blender, +Z in glTF).
import math
import os
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
src = os.path.abspath(argv[0])
prefix = os.path.abspath(argv[1])
azimuths = [float(a) for a in argv[2].split(",")]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mn = mathutils.Vector((1e9,) * 3)
mx = mathutils.Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector((min(mn[i], w[i]) for i in range(3)))
        mx = mathutils.Vector((max(mx[i], w[i]) for i in range(3)))
size = mx - mn
ctr = (mn + mx) / 2
r = max(size)

bpy.ops.mesh.primitive_plane_add(size=r * 12, location=(ctr.x, ctr.y, mn.z))
floor = bpy.context.active_object
fm = bpy.data.materials.new("floor")
fm.diffuse_color = (0.55, 0.57, 0.6, 1)
floor.data.materials.append(fm)

world = bpy.data.worlds.new("w")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.88, 0.92, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.55

bpy.ops.object.light_add(type="SUN", location=(ctr.x, ctr.y, mx.z + r * 3))
sun = bpy.context.active_object
sun.data.energy = 2.6
sun.rotation_euler = (math.radians(50), 0, math.radians(azimuths[0]))

bpy.ops.object.camera_add()
cam = bpy.context.active_object
cam.data.lens = 50
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 32
sc.cycles.device = "CPU"
sc.render.resolution_x = 640
sc.render.resolution_y = 640
sc.render.image_settings.file_format = "PNG"
sc.view_settings.view_transform = "Standard"

d = r * 2.1
for i, az_deg in enumerate(azimuths):
    az = math.radians(az_deg)
    sun.rotation_euler = (math.radians(50), 0, az)
    cam.location = (ctr.x + d * math.sin(az), ctr.y - d * math.cos(az), ctr.z + d * 0.55)
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = "%s_%d.png" % (prefix, i)
    bpy.ops.render.render(write_still=True)
print("PREVIEW_OK")
