# Run by claude-blender.js:
#   blender -b --factory-startup -P build.py -- <script.py> <out.glb> <info.json> <W_mm> <D_mm> <H_mm>
#
# <script.py> is Python WRITTEN BY THE AI. It is never run as-is: it is parsed
# first and rejected unless it is made only of plain geometry calls, then run
# with a tiny set of names (bpy, math, mathutils, and the helpers below) and no
# real builtins. Whatever it builds is then scaled to the requested overall size
# and exported as a GLB.
#
# Units: metres. The FRONT of the piece faces -Y in Blender (= +Z in glTF).
import ast
import json
import math
import os
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
script_path, out_glb, out_json = [os.path.abspath(a) for a in argv[:3]]
TARGET = tuple(float(v) / 1000.0 for v in argv[3:6])  # W, D, H in metres

MAX_TRIANGLES = 200000
MAX_OBJECTS = 150


def fail(msg):
    json.dump({"ok": False, "error": msg}, open(out_json, "w"))
    print("BUILD_FAILED", msg)
    sys.exit(0)


# ───────────────────────── 1. safety check of the AI script ─────────────────────────
BANNED_NAMES = {
    "open", "exec", "eval", "compile", "input", "__import__", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "dir", "breakpoint", "exit", "quit", "help", "memoryview",
    "os", "sys", "subprocess", "socket", "shutil", "pathlib", "ctypes", "importlib", "builtins",
    "urllib", "requests", "http", "io", "pickle", "marshal", "inspect", "types",
}
# attributes on bpy that read/write files, load code, or reach the application itself
BANNED_BPY_PREFIXES = (
    "bpy.ops.wm", "bpy.ops.script", "bpy.ops.preferences", "bpy.ops.file", "bpy.ops.export",
    "bpy.ops.import", "bpy.ops.image", "bpy.ops.render", "bpy.ops.sound", "bpy.ops.text",
    "bpy.ops.scene.new", "bpy.ops.outliner", "bpy.ops.ed", "bpy.app", "bpy.utils", "bpy.path",
    "bpy.data.libraries", "bpy.data.texts", "bpy.data.filepath", "bpy.data.images", "bpy.data.sounds",
    "bpy.data.fonts", "bpy.data.movieclips", "bpy.context.preferences", "bpy.types",
)
BANNED_ATTRS = {"filepath", "filepath_raw", "save", "save_render", "load", "write", "libraries",
                "texts", "app", "utils", "preferences", "driver_add", "run", "popen", "system"}


def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def check_script(src):
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return "syntax error on line %s: %s" % (e.lineno, e.msg)
    for n in ast.walk(tree):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            return "line %s: imports are not allowed (bpy, math, mathutils and the helpers are already available)" % n.lineno
        if isinstance(n, (ast.Global, ast.Nonlocal, ast.AsyncFunctionDef, ast.Await, ast.Yield, ast.YieldFrom)):
            return "line %s: not allowed" % n.lineno
        if isinstance(n, ast.Name) and (n.id in BANNED_NAMES or (n.id.startswith("__") and n.id != "__name__")):
            return "line %s: the name '%s' is not allowed" % (n.lineno, n.id)
        if isinstance(n, ast.Attribute):
            if n.attr.startswith("_"):
                return "line %s: attribute '%s' is not allowed" % (n.lineno, n.attr)
            if n.attr in BANNED_ATTRS:
                return "line %s: attribute '%s' is not allowed" % (n.lineno, n.attr)
            d = dotted(n)
            if d and d.startswith("bpy") and any(d == p or d.startswith(p + ".") for p in BANNED_BPY_PREFIXES):
                return "line %s: '%s' is not allowed" % (n.lineno, d)
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and ("__" in n.value):
            return "line %s: strings containing '__' are not allowed" % n.lineno
    return None


# ───────────────────────── 2. helpers the AI script builds with ─────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)


def _clean(name):
    out = "".join(c if (c.isalnum() or c == "_") else "_" for c in str(name).lower()).strip("_")
    return out or "part"


def _unique(name):
    base = _clean(name)
    taken = {o.name for o in bpy.data.objects}
    if base not in taken:
        return base
    i = 2
    while "%s_%d" % (base, i) in taken:
        i += 1
    return "%s_%d" % (base, i)


def _finish(o, name, material, smooth):
    o.name = _unique(name)
    o.data.name = o.name
    if material is not None:
        o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = bool(smooth)
    return o


def mat(name, rgb, rough=0.5, metal=0.0):
    """A simple PBR material: base colour (r, g, b in 0..1), roughness, metallic."""
    m = bpy.data.materials.new(_clean(name))
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (float(rgb[0]), float(rgb[1]), float(rgb[2]), 1)
    b.inputs["Roughness"].default_value = float(rough)
    b.inputs["Metallic"].default_value = float(metal)
    return m


def box(name, size, loc, material, bevel=0.0, soft=0):
    """A box `size` (x, y, z) metres centred at `loc`. bevel = rounded edge width;
    soft = 1..3 smooths it into a cushion (subdivision)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.dimensions = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = float(bevel)
        m.segments = 4 if soft else 2
        m.limit_method = "NONE" if soft else "ANGLE"
    if soft:
        s = o.modifiers.new("sub", "SUBSURF")
        s.levels = 1
        s.render_levels = min(int(soft), 3)
    return _finish(o, name, material, soft)


def cyl(name, radius, depth, loc, material, rot=(0, 0, 0), verts=24):
    """A cylinder along Z (rotate with rot = (rx, ry, rz) radians)."""
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, rotation=rot, vertices=min(int(verts), 48))
    return _finish(bpy.context.active_object, name, material, False)


def sphere(name, radius, loc, material, scale=(1, 1, 1)):
    """A smooth sphere / ellipsoid (scale stretches it)."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=24, ring_count=12)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, name, material, True)


# ───────────────────────── 3. run the script ─────────────────────────
src = open(script_path, encoding="utf-8").read()
problem = check_script(src)
if problem:
    fail("script rejected by the safety check: " + problem)

import builtins as _b

SAFE_BUILTINS = {k: getattr(_b, k) for k in (
    "abs", "min", "max", "sum", "len", "range", "enumerate", "zip", "round", "float", "int", "bool", "str",
    "list", "tuple", "dict", "set", "sorted", "reversed", "any", "all", "map", "filter", "isinstance",
    "print", "ValueError", "Exception")}
env = {"__builtins__": SAFE_BUILTINS, "bpy": bpy, "math": math, "mathutils": mathutils,
       "Vector": mathutils.Vector, "mat": mat, "box": box, "cyl": cyl, "sphere": sphere,
       # the stated overall size in metres, handy for proportions
       "W": TARGET[0], "D": TARGET[1], "H": TARGET[2]}
try:
    exec(compile(src, "ai_script", "exec"), env)
except Exception as e:  # noqa: BLE001 — any failure is reported back to the AI
    fail("script error: %s: %s" % (type(e).__name__, e))

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if len(meshes) < 3:
    fail("the model has %d parts — build one separate object per real part (at least 3)" % len(meshes))
if len(meshes) > MAX_OBJECTS:
    fail("too many parts (%d, limit %d) — merge tiny details" % (len(meshes), MAX_OBJECTS))
for o in bpy.context.scene.objects:
    if o.type not in ("MESH",):
        bpy.data.objects.remove(o, do_unlink=True)

# ───────────────────────── 4. fit to the stated size ─────────────────────────
dg = bpy.context.evaluated_depsgraph_get()


def bounds():
    mn = mathutils.Vector((1e9,) * 3)
    mx = mathutils.Vector((-1e9,) * 3)
    tris = 0
    for o in meshes:
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        e.to_mesh_clear()
        for c in e.bound_box:
            w = e.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector((min(mn[i], w[i]) for i in range(3)))
            mx = mathutils.Vector((max(mx[i], w[i]) for i in range(3)))
    return mn, mx, tris


mn, mx, tris = bounds()
size = mx - mn
if min(size) < 1e-4:
    fail("the model is flat or empty in one direction")
k = (TARGET[0] / size.x, TARGET[1] / size.y, TARGET[2] / size.z)
for o in meshes:
    o.location = mathutils.Vector((
        (o.location.x - (mn.x + mx.x) / 2) * k[0],
        (o.location.y - (mn.y + mx.y) / 2) * k[1],
        (o.location.z - mn.z) * k[2]))
    o.scale = mathutils.Vector((o.scale.x * k[0], o.scale.y * k[1], o.scale.z * k[2]))
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

dg = bpy.context.evaluated_depsgraph_get()
mn2, mx2, tris = bounds()
if tris > MAX_TRIANGLES:
    fail("too heavy (%d triangles, limit %d) — use fewer subdivisions" % (tris, MAX_TRIANGLES))

# ───────────────────────── 5. export ─────────────────────────
try:
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True, export_yup=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False)
except Exception as e:  # noqa: BLE001
    fail("export failed: %s" % e)

fit = [round(v, 3) for v in k]
json.dump({
    "ok": True,
    "size_mm": {"width": round((mx2.x - mn2.x) * 1000), "depth": round((mx2.y - mn2.y) * 1000), "height": round((mx2.z - mn2.z) * 1000)},
    # how much the script's own proportions were stretched to hit the stated size: ~1.0 is a faithful build
    "fit_factor": {"width": fit[0], "depth": fit[1], "height": fit[2]},
    "parts": sorted(o.name for o in meshes),
    "triangles": tris,
}, open(out_json, "w"))
print("BUILD_OK", out_glb)
