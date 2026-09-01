"""
Pazl photorealistic render worker (Phase 1 - manual proof).

Runs headless inside Blender to turn an exported room (.glb) into a single
photorealistic PNG with Cycles. No GPU required (CPU render).

Usage (on the Ubuntu server, after installing Blender):

    blender -b -P render.py -- INPUT.glb OUTPUT.png [HDRI.hdr] [CAMERA.json]

  INPUT.glb    the file exported by the app's "Gltf" button
  OUTPUT.png   where to write the rendered image
  HDRI.hdr     optional environment map for realistic lighting (Poly Haven .hdr).
               If omitted, a simple sun + sky is used so it still renders.
  CAMERA.json  optional camera from the app so the render matches the on-screen
               view. Shape (Three.js world coords, Y-up):
                   {"position":[x,y,z], "target":[x,y,z], "fov":50, "aspect":1.77}
               If omitted, the camera is auto-framed to the room.

  The two optional args are detected by extension (.json -> camera, otherwise
  HDRI), so order between them doesn't matter.

Notes
- The room is exported in the app's scene units (centimetres) and has no
  ceiling (open-top walls), so the camera is auto-framed from an elevated 3/4
  angle that looks down into the room. Later phases will pass the app's actual
  camera instead of auto-framing.
- Quality knobs (SAMPLES, RES_X, RES_Y) are near the top - raise SAMPLES for a
  cleaner image at the cost of time.
"""

import bpy
import sys
import os
import json
import math
from mathutils import Vector

# --- quality / output settings -------------------------------------------
# Defaults; the backend can override via env (PAZL_SAMPLES / PAZL_RES_X/Y).
# Engine: EEVEE (fast — seconds) or CYCLES (photorealistic — minutes).
ENGINE = os.environ.get("PAZL_ENGINE", "EEVEE").upper()
SAMPLES = int(os.environ.get("PAZL_SAMPLES", "128"))  # cleaner = slower
RES_X = int(os.environ.get("PAZL_RES_X", "1280"))
RES_Y = int(os.environ.get("PAZL_RES_Y", "720"))
# Did the app explicitly ask for a resolution? If so that choice WINS over the
# browser canvas's aspect. Without this, a short/wide canvas (e.g. DevTools
# open) silently squashed the render into a thin strip and the app's Aspect
# dropdown was ignored.
RES_X_EXPLICIT = "PAZL_RES_X" in os.environ
# Phase-2 render controls (backend overrides via env).
FORMAT = os.environ.get("PAZL_FORMAT", "PNG").upper()       # PNG | JPEG
try:
    EXPOSURE = float(os.environ.get("PAZL_EXPOSURE", "0") or 0)  # brightness -/+
except ValueError:
    EXPOSURE = 0.0
DENOISE = os.environ.get("PAZL_DENOISE", "1") != "0"        # Cycles denoise on/off

# --- interior-realism settings -------------------------------------------
# The app's walls are one-sided and open-topped, and Three.js MeshPhongMaterial
# can't carry PBR values through glTF. These four knobs repair that at RENDER
# time only — the app, the 3D view and saved designs are never touched. Set any
# of them to the "off" value to render exactly as before.
#
# The glTF exporter hard-codes metallic=0.5 on every non-MeshStandardMaterial,
# so every surface arrives in Blender as half-metal (dark, plastic-looking).
# Nothing in the room is really metal, so we reset it. PAZL_FIX_PBR=0 disables.
FIX_PBR = os.environ.get("PAZL_FIX_PBR", "1") != "0"
try:
    PBR_ROUGHNESS = float(os.environ.get("PAZL_PBR_ROUGHNESS", "0.65"))
except ValueError:
    PBR_ROUGHNESS = 0.65
# Cap the open-topped room so light bounces back down instead of escaping to
# the sky (this is what makes a real interior look bright). PAZL_CEILING=0 off.
CEILING = os.environ.get("PAZL_CEILING", "1") != "0"
# Soft ceiling fill light — the sun only reaches what a window can see, so the
# rest of the room falls dark. This is a FILL light: the HDRI sun should stay
# the main source and this only lifts the shadows.
#
# Watts per square metre of floor. The light panel covers ~36% of the floor
# (0.6 x 0.6), so a 5x4m room gets 15*20 = 300W over 7.2m^2 = ~42 W/m^2, which
# sits in the normal 40-80 W/m^2 range for an interior ceiling panel. The
# original 60 gave ~167 W/m^2 — 2-4x too strong, which flattened every shadow
# and washed the colours out. PAZL_LIGHT_POWER=0 turns it off entirely.
# Lighting stack (HDRI + ceiling bounce + fill + bounces). These were dropped
# hard at one point because pale rooms were blowing out to white — but the real
# cause of that was elsewhere, and the low values left every render flat and
# grey instead. They are back to a normal photographic level: the HDRI lights
# the room at roughly its true strength, and the exposure is no longer pulled
# down on top. Every one is still overridable per render.
try:
    WORLD_STRENGTH = float(os.environ.get("PAZL_WORLD_STRENGTH", "1.0"))
except ValueError:
    WORLD_STRENGTH = 1.0
try:
    LIGHT_POWER = float(os.environ.get("PAZL_LIGHT_POWER", "6"))
except ValueError:
    LIGHT_POWER = 6.0
# Baseline exposure offset applied on top of the user's Brightness slider.
# Zero by default: the world strength above already sets a sane level, and
# stacking a pull-down on it only crushed the highlights and made renders look
# washed out. Set PAZL_EXPOSURE_BIAS negative if a scene runs hot.
try:
    EXPOSURE_BIAS = float(os.environ.get("PAZL_EXPOSURE_BIAS", "0"))
except ValueError:
    EXPOSURE_BIAS = 0.0
# Floor sheen. 0 = mirror, 1 = fully matte (i.e. leave the floor untouched).
try:
    FLOOR_GLOSS = float(os.environ.get("PAZL_FLOOR_GLOSS", "0.25"))
except ValueError:
    FLOOR_GLOSS = 0.25
# Bloom: the soft glow real camera lenses give bright areas (sunlit floor,
# windows, lamps). Cycles has no built-in bloom, so it's done in the
# compositor. PAZL_BLOOM=0 turns it off; higher mix = stronger glow.
BLOOM = os.environ.get("PAZL_BLOOM", "1") != "0"
# Light bounces. Cycles defaults to 4 diffuse bounces, which suits an outdoor
# shot but is too few indoors: in a closed room light has to bounce off several
# walls before it reaches a dark corner, so it dies early and the room renders
# darker and flatter than it should. Interiors want more. PAZL_DIFFUSE_BOUNCES=4
# restores Blender's default.
try:
    DIFFUSE_BOUNCES = int(os.environ.get("PAZL_DIFFUSE_BOUNCES", "8"))
except ValueError:
    DIFFUSE_BOUNCES = 8
try:
    BLOOM_MIX = float(os.environ.get("PAZL_BLOOM_MIX", "-0.75"))
except ValueError:
    BLOOM_MIX = -0.75
try:
    BLOOM_THRESHOLD = float(os.environ.get("PAZL_BLOOM_THRESHOLD", "1.0"))
except ValueError:
    BLOOM_THRESHOLD = 1.0
# Auto-frame view presets — direction FROM the room centre TO the camera, in
# Blender Z-up space (room depth along Y, width along X, height Z). Chosen via
# PAZL_VIEW. Each has a little height so you see into the open-top room.
VIEW = os.environ.get("PAZL_VIEW", "corner").lower()
VIEW_DIRS = {
    "corner": Vector((0.75, -0.9, 0.7)),  # 3/4 diagonal, elevated (default)
    "front": Vector((0.0, -1.0, 0.4)),
    "back": Vector((0.0, 1.0, 0.4)),
    "left": Vector((-1.0, 0.0, 0.4)),
    "right": Vector((1.0, 0.0, 0.4)),
    "top": Vector((0.0, -0.25, 1.0)),
}
FRAME_MARGIN = 1.25    # >1 leaves padding around the room in frame

# --- 3D "finish" effects that must live in Blender ------------------------
# Only the effects that depend on the 3D scene are done here: depth of field
# (a real camera lens) and sky rotation (moving the light source). The flat
# colour grades — temperature, saturation, highlights, shadows, vignette — are
# applied to the finished PNG in the Node backend (render.js) with sharp, which
# is stable across Blender versions where the compositor node API is not. Both
# default to OFF, so an untouched render is unchanged.
#
#   DOF          depth of field — blur the background like a real lens. 0..1.
#   SkyRotation  spin the sky/HDRI so the sun falls from a new angle. degrees.
def _envf(name, default):
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default

DOF = _envf("PAZL_DOF", 0.0)                        # 0..1
SKY_ROTATION = _envf("PAZL_SKY_ROTATION", 0.0)     # degrees
# White background (Enscape's Sky > White Background): the camera sees a plain
# white backdrop through the windows, while the HDRI still lights the room. Off
# by default. Good for clean catalog/product shots.
WHITE_BG = os.environ.get("PAZL_WHITE_BG", "0") != "0"
# --- lighting controls (Enscape's Atmosphere tab) -------------------------
#   SUN_TIME    time of day 0..100 (0/100 = low warm sunrise/sunset, 50 = high
#               white noon). A controllable key sun is added on TOP of the HDRI
#               for directional shadows. -1 (default) = OFF (HDRI light only).
#   SUN_DIR     compass direction the sun comes from, 0..360 degrees.
#   SUN_ENERGY  strength of that sun.
#   LIGHT_SCALE multiplier on the room's soft ceiling/fill light. 1 = default,
#               0 = off, 2 = twice as bright.
SUN_TIME = _envf("PAZL_SUN_TIME", -1.0)            # -1 = off
SUN_DIR = _envf("PAZL_SUN_DIR", 0.0)               # degrees
SUN_ENERGY = _envf("PAZL_SUN_ENERGY", 3.5)
LIGHT_SCALE = _envf("PAZL_LIGHT_SCALE", 1.0)


def parse_args():
    """Read args after the `--` separator Blender passes through.

    Returns (glb_path, out_path, hdri_path, camera_path). The two optional
    trailing args are sorted by extension so their order doesn't matter.
    """
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit(
            "Expected: blender -b -P render.py -- IN.glb OUT.png [HDRI.hdr] [CAMERA.json]"
        )
    args = argv[argv.index("--") + 1:]
    if len(args) < 2:
        raise SystemExit(
            "Expected: IN.glb OUT.png [HDRI.hdr] [CAMERA.json] [MATERIALS.json]"
        )
    glb_path = args[0]
    out_path = args[1]
    hdri_path = None
    camera_path = None
    materials_path = None
    # Optional args are identified by name, not position, so their order never
    # matters: *materials*.json is the overrides file, any other .json is the
    # camera, anything else is the HDRI.
    for extra in args[2:]:
        low = extra.lower()
        if low.endswith(".json"):
            if "material" in os.path.basename(low):
                materials_path = extra
            else:
                camera_path = extra
        else:
            hdri_path = extra
    return glb_path, out_path, hdri_path, camera_path, materials_path


def default_hdri():
    """Find an HDRI (.hdr/.exr) sitting next to this script, if any, so dropping
    a file into the render/ folder enables realistic lighting with no config."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        return None
    for name in sorted(os.listdir(here)):
        if name.lower().endswith((".hdr", ".exr")):
            return os.path.join(here, name)
    return None


def y_up_to_z_up(v):
    """Convert a Three.js / glTF (Y-up) point to Blender (Z-up).

    Blender's glTF importer maps a glTF point (x, y, z) to (x, -z, y); the app's
    camera lives in the same Y-up space as the exported glTF, so we apply the
    same mapping to make the camera line up with the imported room.
    """
    return Vector((v[0], -v[2], v[1]))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def scene_bounds(mesh_objects):
    """World-space bounding box (min, max) over all imported meshes."""
    mins = Vector((float("inf"),) * 3)
    maxs = Vector((float("-inf"),) * 3)
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], world[i])
                maxs[i] = max(maxs[i], world[i])
    return mins, maxs


def cull_backfaces(material):
    """Make a single-sided material cull its back faces in Cycles.

    The app's walls/floor use Three.js FrontSide (glTF doubleSided=false), so
    their exterior is invisible and the camera sees THROUGH the near wall into
    the room. Cycles renders both sides by default, so the wall's solid (dark)
    exterior blocks the view. We replicate FrontSide by making back faces
    transparent: Mix(Fac=Geometry.Backfacing) between the original shader (front)
    and a Transparent BSDF (back).
    """
    if not material.use_nodes or not material.node_tree:
        return False
    nt = material.node_tree
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if not out or not out.inputs["Surface"].is_linked:
        return False
    src = out.inputs["Surface"].links[0].from_socket
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(src, mix.inputs[1])           # Fac=0 (front) -> original
    nt.links.new(transp.outputs["BSDF"], mix.inputs[2])  # Fac=1 (back) -> clear
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return True


def apply_backface_culling(aggressive=True):
    """Cull single-sided materials so the camera sees into the room.

    Materials the glTF importer flagged single-sided (use_backface_culling) are
    always culled — that is exactly what the app intended for its walls.

    `aggressive` additionally culls EVERYTHING when nothing was flagged. That is
    only safe for an OUTSIDE (auto-framed) shot, where a solid near wall would
    otherwise hide the whole room. For an interior shot it is actively harmful:
    it makes the back face of every door and sofa transparent, so Cycles renders
    see-through artifacts on them. EEVEE hides this because it culls natively,
    which is why a preview can look fine while the Cycles render does not.

    EEVEE culls via material.use_backface_culling; Cycles ignores that flag, so
    there we inject a transparent-backface shader instead.
    """
    if not aggressive:
        # Interior shot: the camera is inside, so it already faces the front of
        # every wall and nothing needs opening up. Skip culling ENTIRELY.
        #
        # This matters because the Cycles trick is not true culling: it makes
        # back faces TRANSPARENT, so light passes through them and the camera
        # sees a mesh's inner faces. On a solid object like a door that reads as
        # black/white geometric artifacts — which is exactly why the door looks
        # right in EEVEE (which culls natively) and wrong in Cycles.
        print("[PAZL RENDER] interior shot - backface culling skipped")
        return

    # Only the WALLS need opening up. They are what stands between an outside
    # camera and the room, and the app already draws them single-sided so you
    # can see straight through the near one.
    #
    # Culling everything else does real damage: the Cycles trick is not true
    # culling but a transparent back face, so a door or a sofa becomes partly
    # see-through and renders as black/white wedges. Doors are the obvious
    # casualty — solid objects whose interior suddenly shows.
    #
    # The app names wall meshes "wall", "wall.001", ... so target their
    # materials specifically, and fall back to the old flagged-material
    # behaviour if a scene has no recognisable walls.
    wall_materials = set()
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if not obj.name.split(".")[0].lower().startswith("wall"):
            continue
        for slot in obj.material_slots:
            if slot.material:
                wall_materials.add(slot.material.name)

    if wall_materials:
        targets = [m for m in bpy.data.materials if m.name in wall_materials]
        print(
            "[PAZL RENDER] culling walls only (%d material(s) on wall meshes)"
            % len(targets)
        )
    else:
        flagged = [
            m for m in bpy.data.materials if getattr(m, "use_backface_culling", False)
        ]
        targets = flagged if flagged else list(bpy.data.materials)
        print("[PAZL RENDER] no wall meshes found - falling back to flagged materials")
    if ENGINE == "CYCLES":
        culled = 0
        for mat in targets:
            if cull_backfaces(mat):
                culled += 1
        print(
            "[PAZL RENDER] Cycles backface-culled %d of %d target material(s)"
            % (culled, len(targets))
        )
    else:
        for mat in targets:
            mat.use_backface_culling = True
        print(
            "[PAZL RENDER] EEVEE backface culling on %d target material(s)"
            % len(targets)
        )


def _principled(material):
    """The Principled BSDF of a material, or None if it isn't node-based."""
    if not material or not material.use_nodes or not material.node_tree:
        return None
    return next(
        (n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None
    )


def _set_input(bsdf, name, value):
    """Set a BSDF input, unless a texture already drives it.

    A linked socket means the model shipped a real map for that channel, and the
    artist's map always wins over our blanket default.
    """
    if not bsdf or name not in bsdf.inputs:
        return False
    if bsdf.inputs[name].is_linked:
        return False
    bsdf.inputs[name].default_value = value
    return True


def _world_bbox(obj):
    """(min, max) corners of one object's bounding box, in world space."""
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (
        Vector((min(p[i] for p in pts) for i in range(3))),
        Vector((max(p[i] for p in pts) for i in range(3))),
    )


def fix_alpha_blend_modes():
    """Mark fully-opaque materials as opaque.

    Three.js sets `transparent` / `alphaTest` on materials it has no real need
    to blend, and its glTF exporter turns that into `alphaMode: BLEND / MASK`.
    Blender's importer maps those onto `blend_method = BLEND / HASHED`, so a
    solid wall arrives flagged as see-through even though its alpha is exactly
    1.0.

    EEVEE rasterises and a HASHED surface at alpha 1 still covers the pixel, so
    the preview looks correct. Cycles resolves HASHED *stochastically* — each
    ray independently decides whether to hit the surface — and with the alpha
    socket driven by a texture that decision goes against the wall often enough
    that most rays sail straight through the building into the world. The frame
    fills with speckled background instead of a room, which reads as a broken
    renderer rather than a material flag.

    Only materials whose alpha is genuinely 1 and unconnected are touched, so
    real glass keeps its transparency.
    """
    fixed = 0
    glass = 0
    for mat in bpy.data.materials:
        if not getattr(mat, "use_nodes", False):
            continue
        bsdf = _principled(mat)
        if bsdf is None:
            continue
        alpha = bsdf.inputs.get("Alpha")
        if alpha is None:
            continue
        if alpha.is_linked or alpha.default_value < 0.999:
            glass += 1  # genuinely transparent - leave it alone
            continue
        if getattr(mat, "blend_method", "OPAQUE") != "OPAQUE":
            try:
                mat.blend_method = "OPAQUE"
                fixed += 1
            except Exception:
                pass
    print(
        "[PAZL RENDER] alpha fix: %d opaque material(s) un-flagged, %d left "
        "transparent" % (fixed, glass)
    )


def fix_pbr_materials():
    """Undo the glTF exporter's metallic=0.5 on every material.

    The app's Material3D extends MeshPhongMaterial, not MeshStandardMaterial.
    Three.js's GLTFExporter can't express Phong in glTF's PBR model, so for any
    non-standard material it writes a fixed `metallicFactor = 0.5`. Every wall,
    sofa and floor therefore arrives in Blender as 50% metal — and metal absorbs
    diffuse colour, which is exactly why the room renders dark and plastic.

    Almost nothing in an interior is truly metal, so metalness is reset to 0 and
    roughness to a sensible cloth/paint default. Materials whose name says metal
    are left alone, and any channel driven by a real texture is never touched.
    """
    if not FIX_PBR:
        return 0
    metal_words = ("metal", "steel", "chrome", "aluminium", "aluminum", "brass",
                   "copper", "gold", "silver", "iron")
    fixed = 0
    kept = 0
    for mat in bpy.data.materials:
        bsdf = _principled(mat)
        if not bsdf:
            continue
        if any(w in mat.name.lower() for w in metal_words):
            kept += 1
            continue
        changed = _set_input(bsdf, "Metallic", 0.0)
        _set_input(bsdf, "Roughness", PBR_ROUGHNESS)
        if changed:
            fixed += 1
    print(
        "[PAZL RENDER] pbr fix: metallic->0 on %d material(s), %d kept as metal"
        % (fixed, kept)
    )
    return fixed


# Material type presets. Nobody can reason about "metallic 0.35", so the app
# offers a TYPE and we translate it into physically sensible values here — the
# same shortcut Enscape's Type dropdown provides. Values follow Enscape's own
# defaults (fabric: metallic 0, roughness ~0.9).
MATERIAL_TYPES = {
    "fabric":  {"metallic": 0.0, "roughness": 0.90},
    "wood":    {"metallic": 0.0, "roughness": 0.60},
    "paint":   {"metallic": 0.0, "roughness": 0.85},
    "plastic": {"metallic": 0.0, "roughness": 0.40},
    "leather": {"metallic": 0.0, "roughness": 0.55},
    "stone":   {"metallic": 0.0, "roughness": 0.70},
    "marble":  {"metallic": 0.0, "roughness": 0.15},  # polished, reflective
    "tile":    {"metallic": 0.0, "roughness": 0.20},  # glazed ceramic
    "carpet":  {"metallic": 0.0, "roughness": 0.95},  # very matte, soft
    "metal":   {"metallic": 1.0, "roughness": 0.30},
    "glass":   {"metallic": 0.0, "roughness": 0.05, "transmission": 1.0},
    "mirror":  {"metallic": 1.0, "roughness": 0.02},
}


def structural_material_names(mins, maxs):
    """Names of the materials that make up the shell of the building.

    Walls are named by the app ("wall", "wall.001", ...). The floor is not, so
    it is found by shape with the same test make_floor_glossy uses: flat, at the
    bottom of the room, and covering a good part of its footprint.

    Used to stop a see-through material being applied to the structure itself.
    """
    names = set()
    height = max(maxs[2] - mins[2], 1e-6)
    span = max(maxs[0] - mins[0], maxs[1] - mins[1], 1e-6)
    z_tol = height * 0.05

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.materials:
            continue

        is_wall = obj.name.split(".")[0].lower().startswith("wall")
        is_floor = False
        if not is_wall:
            lo, hi = _world_bbox(obj)
            is_floor = (
                (hi[2] - lo[2]) <= z_tol
                and lo[2] <= mins[2] + z_tol
                and (hi[0] - lo[0]) >= span * 0.3
                and (hi[1] - lo[1]) >= span * 0.3
            )
        if not (is_wall or is_floor):
            continue

        for mat in obj.data.materials:
            if mat:
                names.add(mat.name)
    return names


def apply_material_overrides(path, structural=frozenset()):
    """Apply the per-material choices made in the app's Materials panel.

    `path` is a JSON file the backend wrote:
        { "Seat fabric": {"type": "fabric"},
          "Legs":        {"type": "wood", "roughness": 0.5} }

    Materials are matched by NAME, which is what survives the glTF round-trip
    (uuids do not). An explicit roughness/metallic wins over the type preset, so
    the app can offer both a Type dropdown and fine sliders. Runs AFTER
    fix_pbr_materials so a deliberate choice always beats the blanket default.

    `structural` names the materials that form the walls and floor. Full
    transmission is refused on those: "glass" sets transmission to 1.0, which
    means rays pass straight through, so choosing it for a wall makes Cycles
    look through the building into the sky and the render comes back as a flat
    grey rectangle. EEVEE approximates transmission and still draws the wall, so
    the 3D view gives no warning — the first sign is a ruined render.
    """
    if not path or not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            overrides = json.load(f)
    except Exception as e:
        print("[PAZL RENDER] could not read material overrides (%r)" % e)
        return 0
    if not isinstance(overrides, dict) or not overrides:
        return 0

    applied = 0
    refused = []
    missing = []
    for name, spec in overrides.items():
        mat = bpy.data.materials.get(name)
        if not mat:
            missing.append(name)
            continue
        bsdf = _principled(mat)
        if not bsdf or not isinstance(spec, dict):
            continue

        # Albedo colour. The picker gives an sRGB hex; Blender's Base Color is
        # LINEAR, so convert or the colour comes out too bright/wrong.
        col = spec.get("color")
        if isinstance(col, str) and len(col) == 7 and col.startswith("#"):
            try:
                srgb = [int(col[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
                lin = [
                    (c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
                    for c in srgb
                ]
                _set_input(bsdf, "Base Color", (lin[0], lin[1], lin[2], 1.0))
            except Exception:
                pass

        values = dict(MATERIAL_TYPES.get(str(spec.get("type", "")).lower(), {}))
        # Explicit slider values override the type preset.
        for key in ("metallic", "roughness", "transmission"):
            if spec.get(key) is not None:
                values[key] = float(spec[key])
        if not values:
            continue

        # A wall or floor must never become see-through. Picking "Glass" for one
        # is easy to do by accident and the result is not a glass wall — it is a
        # hole, and the whole render comes back grey.
        if values.get("transmission", 0.0) > 0.5 and name in structural:
            values["transmission"] = 0.0
            refused.append(name)

        _set_input(bsdf, "Metallic", values.get("metallic", 0.0))
        if "roughness" in values:
            _set_input(bsdf, "Roughness", values["roughness"])
        if "transmission" in values:
            # Blender 4.x renamed this socket; try both.
            for socket in ("Transmission Weight", "Transmission"):
                if _set_input(bsdf, socket, values["transmission"]):
                    break
        applied += 1

    print(
        "[PAZL RENDER] material overrides applied to %d material(s)%s"
        % (applied, (" (not found: %s)" % ", ".join(missing[:5])) if missing else "")
    )
    if refused:
        print(
            "[PAZL RENDER] refused see-through on %d structural material(s): %s "
            "- a wall or floor set to glass renders as a hole, not a window"
            % (len(refused), ", ".join(refused[:5]))
        )
    return applied


def add_ceiling(mins, maxs, cam_z):
    """Cap the open-topped room so light bounces back down.

    The app exports walls with no roof (you look into the room from above), so
    in Cycles every ray that hits the floor escapes straight out to the sky and
    the room renders dark and flat. Real interiors are bright because light
    bounces off the ceiling; this adds that missing surface at wall height.

    Skipped when the camera is above the walls — for an auto-framed overhead
    shot a ceiling would simply hide the room.
    """
    if not CEILING:
        return False
    ceiling_z = maxs[2]
    # Leave headroom. A camera sitting just under wall height is at eye level
    # in the room, and capping it there puts an opaque surface centimetres in
    # front of the lens: the frame fills with ceiling and the render comes back
    # as a flat rectangle. The ceiling only earns its keep when the camera is
    # well below it, where it does its actual job of bouncing light down.
    headroom = max(0.4, (maxs[2] - mins[2]) * 0.15)
    if cam_z >= ceiling_z - headroom:
        print(
            "[PAZL RENDER] camera is at/near wall height (%.2f vs ceiling %.2f) "
            "- no ceiling added" % (cam_z, ceiling_z)
        )
        return False

    pad = 0.02 * max(maxs[0] - mins[0], maxs[1] - mins[1])
    verts = [
        (mins[0] - pad, mins[1] - pad, ceiling_z),
        (maxs[0] + pad, mins[1] - pad, ceiling_z),
        (maxs[0] + pad, maxs[1] + pad, ceiling_z),
        (mins[0] - pad, maxs[1] + pad, ceiling_z),
    ]
    mesh = bpy.data.meshes.new("PazlCeiling")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("PazlCeiling", mesh)
    bpy.context.collection.objects.link(obj)

    mat = bpy.data.materials.new("PazlCeilingMat")
    mat.use_nodes = True
    bsdf = _principled(mat)
    _set_input(bsdf, "Base Color", (0.9, 0.9, 0.88, 1.0))  # matte near-white
    _set_input(bsdf, "Roughness", 0.9)
    _set_input(bsdf, "Metallic", 0.0)
    obj.data.materials.append(mat)
    print("[PAZL RENDER] ceiling added at z=%.1f" % ceiling_z)
    return True


def add_ceiling_lights(mins, maxs, cam_z):
    """A soft area light under the ceiling, like a real room's lighting.

    The HDRI sun only reaches what a window can see, so the rest of the room
    falls dark. A broad, low-power area light pointing straight down fills it
    evenly without washing out the sun's shadows. Interior shots only.
    """
    if LIGHT_POWER <= 0:
        return False
    ceiling_z = maxs[2]
    if cam_z >= ceiling_z:
        return False

    w = maxs[0] - mins[0]
    d = maxs[1] - mins[1]
    data = bpy.data.lights.new("PazlCeilingLight", type="AREA")
    data.shape = "RECTANGLE"
    data.size = max(w * 0.6, 0.1)
    data.size_y = max(d * 0.6, 0.1)
    # Scale with floor area so small and large rooms look alike. LIGHT_SCALE is
    # the user's "Room lights" slider (1 = default, 0 = off, 2 = twice as bright).
    data.energy = LIGHT_POWER * max(w * d, 1.0) * LIGHT_SCALE
    data.color = (1.0, 0.96, 0.9)  # slightly warm, like an indoor bulb

    obj = bpy.data.objects.new("PazlCeilingLight", data)
    bpy.context.collection.objects.link(obj)
    obj.location = (
        (mins[0] + maxs[0]) * 0.5,
        (mins[1] + maxs[1]) * 0.5,
        ceiling_z - max((maxs[2] - mins[2]) * 0.03, 0.01),
    )
    # Area lights emit along -Z by default, so no rotation is needed.
    print("[PAZL RENDER] ceiling light added (%.0f W)" % data.energy)
    return True


def make_floor_glossy(mins, maxs):
    """Give the floor a soft sheen so it reflects the room.

    The app doesn't name its floor mesh, so it's found by SHAPE: a flat object
    sitting at the bottom of the room that covers a good part of its footprint.
    The height test excludes the ceiling; the footprint test excludes props
    resting on the floor.
    """
    if FLOOR_GLOSS >= 1.0:
        return 0
    height = max(maxs[2] - mins[2], 1e-6)
    span = max(maxs[0] - mins[0], maxs[1] - mins[1], 1e-6)
    z_tol = height * 0.05
    seen = set()
    count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.materials:
            continue
        lo, hi = _world_bbox(obj)
        if (hi[2] - lo[2]) > z_tol:        # must be flat
            continue
        if lo[2] > mins[2] + z_tol:        # must sit at the bottom
            continue
        if (hi[0] - lo[0]) < span * 0.3:   # must be big enough to be a floor
            continue
        if (hi[1] - lo[1]) < span * 0.3:
            continue
        for mat in obj.data.materials:
            if not mat or mat.name in seen:
                continue
            seen.add(mat.name)
            if _set_input(_principled(mat), "Roughness", FLOOR_GLOSS):
                count += 1
    print(
        "[PAZL RENDER] floor gloss %.2f applied to %d material(s)"
        % (FLOOR_GLOSS, count)
    )
    return count


def add_bloom():
    """Add lens bloom via the compositor — the soft glow around bright areas.

    Real camera lenses scatter bright light, so sunlit floors, windows and lamps
    bleed a gentle halo. It's a large part of why a render reads as photographic
    rather than computer-generated. Cycles has no bloom of its own (and Blender
    4.2 removed EEVEE's), so the standard route is a Glare node between Render
    Layers and Composite.

    Fully guarded: any Blender version difference just skips bloom rather than
    failing the render.
    """
    if not BLOOM:
        return False
    try:
        scene = bpy.context.scene
        scene.use_nodes = True
        tree = scene.node_tree
        render_layers = next(
            (n for n in tree.nodes if n.type == "R_LAYERS"), None
        )
        composite = next(
            (n for n in tree.nodes if n.type == "COMPOSITE"), None
        )
        if not render_layers or not composite:
            return False

        glare = tree.nodes.new("CompositorNodeGlare")
        # "BLOOM" is the dedicated type on newer Blender; FOG_GLOW is the
        # long-standing equivalent. Take whichever this build offers.
        for gtype in ("BLOOM", "FOG_GLOW"):
            try:
                glare.glare_type = gtype
                break
            except (TypeError, ValueError):
                continue
        glare.quality = "HIGH"
        try:
            glare.threshold = BLOOM_THRESHOLD  # only light ABOVE this glows
        except Exception:
            pass
        try:
            glare.mix = BLOOM_MIX  # -1 = original only, 0 = 50/50 glow
        except Exception:
            pass

        tree.links.new(render_layers.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], composite.inputs["Image"])
        print(
            "[PAZL RENDER] bloom on (%s, threshold=%.2f mix=%.2f)"
            % (glare.glare_type, BLOOM_THRESHOLD, BLOOM_MIX)
        )
        return True
    except Exception as e:
        print("[PAZL RENDER] bloom skipped (%r)" % e)
        return False


def apply_depth_of_field(center):
    """Blur the background with a real camera depth of field (Enscape's DoF).

    Focuses on the room centre and opens the aperture as the slider rises. Off
    by default; works in both Cycles and EEVEE.
    """
    if DOF <= 0.0:
        return False
    try:
        cam = bpy.context.scene.camera
        if not cam:
            return False
        dist = (cam.location - center).length
        cam.data.dof.use_dof = True
        cam.data.dof.focus_distance = max(dist, 0.1)
        # Strength 0..1 -> f/16 (barely there) down to ~f/1.4 (strong blur).
        cam.data.dof.aperture_fstop = max(1.4, 16.0 - DOF * 14.6)
        print(
            "[PAZL RENDER] depth of field on (f/%.1f, focus %.2f m)"
            % (cam.data.dof.aperture_fstop, dist)
        )
        return True
    except Exception as e:
        print("[PAZL RENDER] depth of field skipped (%r)" % e)
        return False


def setup_world(hdri_path):
    """Realistic ambient light: HDRI if given, else a neutral sky."""
    world = bpy.data.worlds.new("PazlWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    bg = nodes.new("ShaderNodeBackground")
    # The Background node's OUTPUT socket is "Background" (its inputs are
    # "Color"/"Strength"). Using "Color" here raised a KeyError and aborted
    # the render before it started.
    links.new(bg.outputs["Background"], out.inputs["Surface"])
    if hdri_path:
        env = nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdri_path)
        links.new(env.outputs["Color"], bg.inputs["Color"])
        # Spin the sky so the sun/reflections come from a new angle (Enscape's
        # Sky > Rotation). Neutral at 0; fully guarded.
        if abs(SKY_ROTATION) > 0.01:
            try:
                texco = nodes.new("ShaderNodeTexCoord")
                mapping = nodes.new("ShaderNodeMapping")
                mapping.inputs["Rotation"].default_value[2] = math.radians(
                    SKY_ROTATION
                )
                links.new(texco.outputs["Generated"], mapping.inputs["Vector"])
                links.new(mapping.outputs["Vector"], env.inputs["Vector"])
                print("[PAZL RENDER] sky rotated %.0f deg" % SKY_ROTATION)
            except Exception as e:
                print("[PAZL RENDER] sky rotation skipped (%r)" % e)
        # The HDRI is the MAIN light. It stacks with the ceiling bounce, the
        # fill light and the raised bounce count, so it must stay modest or the
        # room blows out to white. PAZL_WORLD_STRENGTH overrides it.
        bg.inputs["Strength"].default_value = WORLD_STRENGTH
    else:
        bg.inputs["Color"].default_value = (0.7, 0.78, 0.9, 1.0)
        bg.inputs["Strength"].default_value = WORLD_STRENGTH * 2.0

    # White background: the camera sees plain white, but the room stays lit by
    # the HDRI/sky. A Light Path node splits the two — camera rays get white,
    # every other (lighting/GI) ray still samples the real background. So the
    # backdrop behind the windows is clean white without darkening the room.
    if WHITE_BG:
        try:
            white_bg = nodes.new("ShaderNodeBackground")
            white_bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
            white_bg.inputs["Strength"].default_value = 1.0
            lp = nodes.new("ShaderNodeLightPath")
            mix = nodes.new("ShaderNodeMixShader")
            # Fac = Is Camera Ray: 1 for what the camera sees, 0 for GI samples.
            links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
            links.new(bg.outputs["Background"], mix.inputs[1])        # GI -> real sky
            links.new(white_bg.outputs["Background"], mix.inputs[2])  # camera -> white
            # Re-point the world output at the mix (replaces the direct link).
            links.new(mix.outputs["Shader"], out.inputs["Surface"])
            print("[PAZL RENDER] white background on (camera sees white, HDRI still lights)")
        except Exception as e:
            print("[PAZL RENDER] white background skipped (%r)" % e)


def add_sun(center, radius):
    """A key sun so shadows/forms read even without an HDRI."""
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 4.0
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.location = center + Vector((radius, -radius, radius * 1.5))
    # aim the sun at the room centre
    direction = (center - sun.location).normalized()
    sun.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_controllable_sun(center, radius):
    """A user-positioned key sun for time-of-day light (Enscape's sun).

    Added ON TOP of the HDRI: the HDRI gives soft ambient + reflections, this
    sun gives a clear direction, warm/cool colour, and crisp soft shadows. OFF
    by default (SUN_TIME < 0) so nothing changes unless the user asks for it.

    SUN_TIME 0..100 maps to the sun's height and warmth: 50 = high, white noon;
    0/100 = low, warm sunrise/sunset. SUN_DIR is the compass direction it comes
    from. If the room ends up too bright, lower the Brightness slider.
    """
    if SUN_TIME < 0:
        return False
    try:
        t = max(0.0, min(100.0, SUN_TIME))
        # Elevation: low at the ends (sunrise/sunset), high at noon.
        elev_deg = 8.0 + 72.0 * math.sin(math.pi * t / 100.0)
        elev = math.radians(elev_deg)
        az = math.radians(SUN_DIR % 360.0)
        # Unit vector from the room toward the sun in the sky.
        sun_dirvec = Vector((
            math.cos(elev) * math.sin(az),
            math.cos(elev) * math.cos(az),
            math.sin(elev),
        ))
        sun_data = bpy.data.lights.new("PazlKeySun", type="SUN")
        # Warmth: neutral at noon, warm orange toward the horizon.
        w = abs(t - 50.0) / 50.0  # 0 at noon -> 1 at the ends
        sun_data.color = (1.0, 0.98 - 0.28 * w, 0.95 - 0.55 * w)
        sun_data.energy = SUN_ENERGY
        try:
            sun_data.angle = 0.06  # soft shadow edge
        except Exception:
            pass
        sun = bpy.data.objects.new("PazlKeySun", sun_data)
        bpy.context.collection.objects.link(sun)
        sun.location = center + sun_dirvec.normalized() * (radius * 3.0 + 5.0)
        direction = (center - sun.location).normalized()
        sun.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        print(
            "[PAZL RENDER] key sun: time=%.0f elev=%.0f az=%.0f energy=%.1f"
            % (t, elev_deg, SUN_DIR % 360.0, SUN_ENERGY)
        )
        return True
    except Exception as e:
        print("[PAZL RENDER] key sun skipped (%r)" % e)
        return False


def add_camera(center, radius):
    cam_data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    # frame a sphere of `radius` for the camera's vertical FOV
    fov = cam_data.angle
    distance = (radius / math.sin(fov / 2.0)) * FRAME_MARGIN
    view_dir = VIEW_DIRS.get(VIEW, VIEW_DIRS["corner"])
    cam.location = center + view_dir.normalized() * distance
    direction = (center - cam.location).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    # generous clipping so a large (cm-scale) scene isn't culled
    cam_data.clip_start = radius * 0.001
    cam_data.clip_end = radius * 100.0


def clear_camera_of_geometry(cam, direction, radius):
    """Slide the camera back until it is not inside a surface.

    The app lets you push the viewport camera right up to — and through — a
    wall. On screen that looks fine, because the viewer clips and back-face
    culls; Blender does neither, so the lens ends up embedded in solid
    geometry and the render returns a flat rectangle of whatever colour that
    surface is. It reads as a crash, but it is the renderer faithfully drawing
    the inside of a wall.

    Moving straight back along the view axis keeps the framing the user set up
    and only changes how far away they are standing.

    Returns the distance pulled back, in metres.
    """
    scene = bpy.context.scene
    try:
        deps = bpy.context.evaluated_depsgraph_get()
    except Exception:
        return 0.0

    # Enough clearance that the near clip plane cannot bite into the surface.
    clearance = max(radius * 0.04, 0.30)
    limit = max(radius * 2.0, 2.0)
    pulled = 0.0

    # Bounded loop: each pass either escapes the surface or gives up, so a
    # camera sealed inside a closed solid cannot spin here forever.
    for _ in range(40):
        try:
            hit = scene.ray_cast(deps, cam.location, direction, distance=clearance)[0]
        except Exception:
            break
        if not hit or pulled >= limit:
            break
        cam.location = cam.location - direction * clearance
        pulled += clearance

    if pulled:
        print(
            "[PAZL RENDER] camera was inside geometry - pulled back %.2f m "
            "along the view axis" % pulled
        )
        if pulled >= limit:
            print(
                "[PAZL RENDER] WARNING: could not find clear space within %.1f m. "
                "The camera may be sealed inside a closed volume - try "
                "'Auto-frame the whole room'." % limit
            )
    return pulled


def add_camera_from_view(cam_json, radius, center=None):
    """Place the camera to match the app's on-screen view."""
    cam_data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    location = y_up_to_z_up(cam_json["position"])
    target = y_up_to_z_up(cam_json.get("target", [0, 0, 0]))
    cam.location = location
    direction = (target - location).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    # Rescue a camera that the user pushed through a wall before rendering.
    # Done before the clip planes below, which are derived from the position.
    clear_camera_of_geometry(cam, direction, radius)
    location = cam.location

    # Three.js PerspectiveCamera.fov is the VERTICAL field of view in degrees.
    fov = cam_json.get("fov")
    if fov:
        cam_data.sensor_fit = "VERTICAL"
        cam_data.angle = math.radians(float(fov))

    aspect = cam_json.get("aspect")
    if aspect and not RES_X_EXPLICIT:
        # Nothing was asked for -> match the app's canvas so framing is 1:1.
        global RES_X
        RES_X = int(round(RES_Y * float(aspect)))
    elif aspect:
        # A resolution WAS requested: honour it. The vertical FOV set above
        # keeps the eye-line identical, so this only changes the horizontal
        # crop -- no more thin-strip renders when the canvas is short and wide.
        print(
            "[PAZL RENDER] using requested %dx%d (canvas aspect %.2f ignored)"
            % (RES_X, RES_Y, float(aspect))
        )

    cam_data.clip_start = max(radius * 0.0005, 0.01)
    cam_data.clip_end = radius * 100.0

    # Report where the supplied camera actually landed relative to the model.
    # A render that comes back as flat background almost always means these two
    # are nowhere near each other -- the geometry sits outside the frustum, or
    # beyond the far clip -- and that is impossible to tell from the image
    # alone, since an empty frame and a correct frame look identical in every
    # way except content.
    to_centre = (center - location).length if center is not None else -1.0
    print(
        "[PAZL RENDER] user camera at (%.2f, %.2f, %.2f) looking at (%.2f, %.2f, %.2f)"
        % (location.x, location.y, location.z, target.x, target.y, target.z)
    )
    print(
        "[PAZL RENDER] distance to model centre = %.2f, model radius = %.2f, "
        "clip %.3f..%.1f" % (to_centre, radius, cam_data.clip_start, cam_data.clip_end)
    )
    if to_centre > cam_data.clip_end:
        print(
            "[PAZL RENDER] WARNING: model is BEYOND the far clip - frame will be empty"
        )
    elif to_centre > radius * 50:
        print(
            "[PAZL RENDER] WARNING: camera is %.0fx the model radius away - model "
            "may be a speck or off-frame" % (to_centre / max(radius, 1e-6))
        )


def setup_render(out_path):
    scene = bpy.context.scene
    if ENGINE == "CYCLES":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = SAMPLES
        scene.cycles.use_denoising = DENOISE
        # Caustics are the sparkly light patterns from glossy/refractive surfaces.
        # They are the single most expensive and noisiest thing in Cycles, and a
        # reflective floor makes them explode — this is what turned a few-minute
        # render into 30-60 minutes. Interiors almost never need them, so switch
        # them off, and clamp very bright indirect samples so the floor
        # reflections converge with far fewer samples. Fully guarded.
        try:
            scene.cycles.caustics_reflective = False
            scene.cycles.caustics_refractive = False
            if scene.cycles.sample_clamp_indirect <= 0:
                scene.cycles.sample_clamp_indirect = 10.0
            scene.cycles.blur_glossy = 1.0
            print("[PAZL RENDER] caustics off, indirect clamp 10, glossy blur 1.0")
        except Exception:
            pass
        # Indoors, light must bounce off several surfaces to fill the room.
        # Cycles' default of 4 diffuse bounces cuts that short and leaves
        # corners dark, so raise it (and keep max_bounces above it, or it
        # silently caps the diffuse count).
        try:
            scene.cycles.diffuse_bounces = DIFFUSE_BOUNCES
            if scene.cycles.max_bounces < DIFFUSE_BOUNCES:
                scene.cycles.max_bounces = DIFFUSE_BOUNCES
            print(
                "[PAZL RENDER] diffuse bounces = %d (max %d)"
                % (scene.cycles.diffuse_bounces, scene.cycles.max_bounces)
            )
        except Exception:
            pass
    else:
        # EEVEE — rasterizer, renders in seconds. Uses the same world/HDRI.
        # Blender 4.2 renamed EEVEE to EEVEE-Next ("BLENDER_EEVEE_NEXT"); older
        # builds use "BLENDER_EEVEE". Pick whichever the installed Blender has.
        _engines = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
        scene.render.engine = next(
            (e for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE") if e in _engines),
            "BLENDER_EEVEE_NEXT",
        )
        scene.eevee.taa_render_samples = SAMPLES
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    # Output format (PNG or JPEG). use_file_extension=False so Blender writes
    # EXACTLY to out_path (whose extension the backend already set to match).
    scene.render.image_settings.file_format = (
        "JPEG" if FORMAT in ("JPEG", "JPG") else "PNG"
    )
    scene.render.use_file_extension = False
    scene.render.filepath = out_path
    # Tone mapping. This is the single biggest reason a render can look duller
    # than the 3D view: the viewport draws raw material colours, while AgX —
    # Blender's default — deliberately desaturates and compresses to imitate
    # film. On a bright interior that reads as washed out, and the contrast
    # "looks" that normally compensate are not present in every Blender build.
    #
    # "Standard" applies no such curve, so colours land closer to what the app
    # shows on screen — but measured on a real room it moved saturation only
    # 0.181 -> 0.186, so it is NOT the cause of a dull render and is not worth
    # changing the default for. Left configurable because it is the right knob
    # if a scene ever does need it.
    preferred = os.environ.get("PAZL_VIEW_TRANSFORM", "AgX")
    for vt in (preferred, "AgX", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = vt
            print("[PAZL RENDER] tone mapping = %s" % vt)
            break
        except Exception:
            continue
    # A contrast curve on top, where the build provides one. Absent in some
    # OCIO configs (Blender 5.1 exposes only "None"), hence the guard.
    look = os.environ.get("PAZL_LOOK", "")
    if look:
        try:
            scene.view_settings.look = look
            print("[PAZL RENDER] look = %s" % look)
        except Exception as exc:
            print("[PAZL RENDER] look %r unavailable (%s)" % (look, exc))
    # Brightness / exposure. The user's slider sits on top of a baseline
    # pull-down, because the stacked interior lighting runs hot.
    try:
        scene.view_settings.exposure = EXPOSURE + EXPOSURE_BIAS
        print(
            "[PAZL RENDER] exposure = %.2f (slider %.2f + bias %.2f)"
            % (EXPOSURE + EXPOSURE_BIAS, EXPOSURE, EXPOSURE_BIAS)
        )
    except Exception:
        pass


def main():
    glb_path, out_path, hdri_path, camera_path, materials_path = parse_args()
    if not hdri_path:
        hdri_path = default_hdri()  # auto-use an HDRI dropped in render/
    print("[PAZL RENDER] input  =", glb_path)
    print("[PAZL RENDER] output =", out_path)
    print("[PAZL RENDER] hdri   =", hdri_path or "(none - using default sky+sun)")
    print("[PAZL RENDER] camera =", camera_path or "(none - auto-framing)")
    print("[PAZL RENDER] mats   =", materials_path or "(none - defaults)")

    clear_scene()
    meshes = import_glb(glb_path)
    if not meshes:
        raise SystemExit("No meshes found in the .glb - export looks empty.")

    # Measured first: the override step needs to know which materials form the
    # walls and floor, and that is decided partly by shape.
    mins, maxs = scene_bounds(meshes)
    center = (mins + maxs) * 0.5

    # Repair the exporter's metallic=0.5 before anything is lit or measured,
    # then let any deliberate per-material choice from the app win over it.
    fix_alpha_blend_modes()
    fix_pbr_materials()
    apply_material_overrides(materials_path, structural_material_names(mins, maxs))

    # Replicate the app's FrontSide walls so a camera OUTSIDE the building sees
    # into the room instead of hitting the solid exterior of the near wall.
    #
    # This used to key off "did the user supply a camera", assuming a supplied
    # camera meant an interior shot. It does not: the app happily lets you orbit
    # outside the walls, and on screen you still see the room because Three.js
    # renders walls single-sided (FrontSide) — you look straight through the
    # near one. glTF carries no such notion, so in Blender that wall is solid
    # and fills the frame. The render came back as a flat rectangle of wall
    # while the viewport showed a perfectly good room.
    #
    # So decide on the camera's actual position instead. Inside the building,
    # culling would eat doors and furniture, so it stays off.
    has_user_camera = bool(camera_path and os.path.exists(camera_path))
    cam_outside = True
    if has_user_camera:
        try:
            with open(camera_path) as fh:
                pos = y_up_to_z_up(json.load(fh)["position"])
            margin = 0.05 * max(maxs[i] - mins[i] for i in range(3))
            cam_outside = any(
                pos[i] < mins[i] - margin or pos[i] > maxs[i] + margin
                for i in range(3)
            )
            print(
                "[PAZL RENDER] camera is %s the building bounds"
                % ("OUTSIDE" if cam_outside else "inside")
            )
        except Exception as exc:
            print("[PAZL RENDER] could not test camera position (%s)" % exc)
    apply_backface_culling(aggressive=cam_outside)
    radius = (maxs - mins).length * 0.5
    print("[PAZL RENDER] center =", tuple(round(c, 1) for c in center))
    print("[PAZL RENDER] radius =", round(radius, 1))

    setup_world(hdri_path)
    # The HDRI already lights the scene; only add the default sun when there's
    # no HDRI. The user's time-of-day sun (if enabled) is added on top of either.
    if not hdri_path:
        add_sun(center, radius)
    add_controllable_sun(center, radius)

    cam_json = None
    if camera_path and os.path.exists(camera_path):
        with open(camera_path, "r") as f:
            cam_json = json.load(f)
    if cam_json and cam_json.get("position"):
        add_camera_from_view(cam_json, radius, center)  # render what the user sees
    else:
        add_camera(center, radius)              # fallback: auto-frame

    # These depend on where the camera ended up: an interior shot wants a
    # ceiling to bounce light, an overhead shot must stay open to see in.
    cam_z = bpy.context.scene.camera.location.z
    add_ceiling(mins, maxs, cam_z)
    add_ceiling_lights(mins, maxs, cam_z)
    make_floor_glossy(mins, maxs)

    # Depth of field focuses on the room centre — needs the placed camera.
    apply_depth_of_field(center)

    setup_render(out_path)
    add_bloom()  # after setup_render: the compositor needs the final engine

    print("[PAZL RENDER] rendering... (CPU, this can take minutes)")
    bpy.ops.render.render(write_still=True)
    print("[PAZL RENDER] done ->", out_path)


if __name__ == "__main__":
    main()
