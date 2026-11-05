// A unit, or the whole run of units on its wall, ready to stand against a
// real wall: the models loaded (glTFast), sized to the unit's real size, and
// laid out as in the design. The run's own frame: its back on z = 0, its
// front along +z, its middle (along the wall) at x = 0, the floor at y = 0.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace Pazl
{
    public class UnitRun
    {
        // Units count as one run when they face the same way (within this many
        // degrees) and their backs are this close to the same wall line.
        const float SameFacingDeg = 10f;
        const float SameBackM = 0.2f;

        public GameObject Root;
        public float WidthM;
        public float HeightM;
        public List<PazlUnit> Units = new List<PazlUnit>();
        public int Missing; // units shown as a size box: their model could not be loaded

        public int WidthMm => Mathf.RoundToInt(WidthM * 1000f);

        public string Title; // set by the app ("Wall 2 · Kitchen"); else made from the units
        public string Name => Title ?? (Units.Count == 1 ? Units[0].Name : Units.Count + " modules on one wall");

        /// <summary>
        /// Turn every model 180° inside its own box: for a model that came in
        /// facing the wall. The boxes stay where they are, backs on the wall.
        /// </summary>
        public void SetTurned(bool turned)
        {
            if (Root == null) return;
            foreach (Transform unit in Root.transform)
            {
                var t = unit.Find("turn");
                if (t != null) t.localRotation = turned ? Quaternion.Euler(0f, 180f, 0f) : Quaternion.identity;
            }
        }

        public void Destroy()
        {
            if (Root != null) UnityEngine.Object.Destroy(Root);
            Root = null;
        }

        // --- the design's space → Unity's -------------------------------------
        // The 3D view is right-handed (three.js), Unity left-handed; glTFast
        // brings models across by mirroring x, so positions mirror x too, and
        // a turn about up turns the other way.
        static Vector3 ToUnity(Vector3 cm) => new Vector3(-cm.x, cm.y, cm.z) * 0.01f;
        static Quaternion TurnOf(PazlUnit u) => Quaternion.Euler(0f, -u.TurnDeg, 0f);

        /// <summary>The chosen unit, and with `wholeRun` every unit on the same wall.</summary>
        public static List<PazlUnit> Pick(List<PazlUnit> all, PazlUnit chosen, bool wholeRun)
        {
            var list = new List<PazlUnit> { chosen };
            if (!wholeRun) return list;
            var f = TurnOf(chosen) * Vector3.forward;
            float back = BackOf(chosen, f);
            foreach (var u in all)
            {
                if (u == chosen || u.RoomName != chosen.RoomName) continue;
                var fu = TurnOf(u) * Vector3.forward;
                if (Vector3.Angle(fu, f) > SameFacingDeg) continue;
                if (Mathf.Abs(BackOf(u, f) - back) > SameBackM) continue;
                list.Add(u);
            }
            return list;
        }

        static float BackOf(PazlUnit u, Vector3 f) => Vector3.Dot(ToUnity(u.PositionCm), f) - u.DepthMm * 0.0005f;

        /// <summary>
        /// A wall of the design: the modules that stand against it (facing the
        /// same way, backs on one line, in one room), left to right, and its length.
        /// </summary>
        public class DesignWall
        {
            public List<PazlUnit> Units;
            public string Room;
            public float LengthM;
            public int LengthMm => Mathf.RoundToInt(LengthM * 1000f);
        }

        /// <summary>The design's walls, from where its modules stand: most modules first, room by room.</summary>
        public static List<DesignWall> Walls(List<PazlUnit> all)
        {
            var left = new List<PazlUnit>(all);
            var walls = new List<DesignWall>();
            while (left.Count > 0)
            {
                var group = Pick(left, left[0], true);
                foreach (var u in group) left.Remove(u);
                var fr = Frame(group);
                // Left to right as you face the wall: along the run's right, reversed.
                group = group.OrderByDescending(u => Vector3.Dot(ToUnity(u.PositionCm), fr.right)).ToList();
                walls.Add(new DesignWall { Units = group, Room = group[0].RoomName, LengthM = fr.maxA - fr.minA });
            }
            return walls.OrderBy(w => w.Room).ThenByDescending(w => w.Units.Count).ThenByDescending(w => w.LengthM).ToList();
        }

        // Where a set of units stands: its facing, its right, how far it reaches
        // along its right, and its back line.
        struct RunFrame
        {
            public Vector3 facing, right;
            public float minA, maxA, back;
        }

        static RunFrame Frame(List<PazlUnit> units)
        {
            var f = TurnOf(units[0]) * Vector3.forward;
            var r = new RunFrame { facing = f, right = Vector3.Cross(Vector3.up, f).normalized, minA = float.MaxValue, maxA = float.MinValue, back = float.MaxValue };
            foreach (var u in units)
            {
                var p = ToUnity(u.PositionCm);
                float halfW = u.WidthMm * 0.0005f;
                r.minA = Mathf.Min(r.minA, Vector3.Dot(p, r.right) - halfW);
                r.maxA = Mathf.Max(r.maxA, Vector3.Dot(p, r.right) + halfW);
                r.back = Mathf.Min(r.back, BackOf(u, f));
            }
            return r;
        }

        /// <summary>
        /// Load and lay out the units, in the frame of `lineUp` (the units the
        /// real wall takes: by default all of them). For the whole room, `units`
        /// is every module and `lineUp` one wall's: the rest of the design
        /// stands where it does around that wall.
        /// </summary>
        public static async Task<UnitRun> Build(PazlApi api, ModelCache cache, List<PazlUnit> units, List<PazlUnit> lineUp = null)
        {
            var run = new UnitRun { Units = units };
            var fr = Frame(lineUp ?? units);
            var f = fr.facing;
            var a = fr.right;
            float top = 0f;
            foreach (var u in units) top = Mathf.Max(top, ToUnity(u.PositionCm).y + u.HeightMm * 0.0005f);
            run.WidthM = fr.maxA - fr.minA;
            run.HeightM = top;

            var origin = a * ((fr.minA + fr.maxA) / 2f) + f * fr.back;
            origin.y = 0f;
            var frame = Quaternion.Inverse(Quaternion.LookRotation(f, Vector3.up));

            run.Root = new GameObject("Pazl Run");
            run.Root.SetActive(false); // shown once placed
            foreach (var u in units)
            {
                // A model that cannot be had stands in as a box of the unit's
                // real size, so the fit on the wall can still be checked.
                var unit = await cache.Make(api, u);
                if (unit == null)
                {
                    unit = ModelCache.SizeBox(u);
                    run.Missing++;
                }
                unit.transform.SetParent(run.Root.transform, false);
                unit.transform.localPosition = frame * (ToUnity(u.PositionCm) - origin);
                unit.transform.localRotation = frame * TurnOf(u);
            }
            return run;
        }
    }

    /// <summary>Each model file downloaded once, then copied for every unit that uses it.</summary>
    public class ModelCache : IDisposable
    {
        readonly Dictionary<string, GltfImport> loaded = new Dictionary<string, GltfImport>();
        readonly Dictionary<string, Task<GltfImport>> loading = new Dictionary<string, Task<GltfImport>>();

        public async Task<GameObject> Make(PazlApi api, PazlUnit u)
        {
            if (string.IsNullOrEmpty(u.ModelUrl))
            {
                LastProblem = "its model was removed from the catalogue";
                return null;
            }
            var gltf = await Get(api, u.ModelUrl);
            if (gltf == null) return null;

            // unit (its box) → turn (for "Turn 180°", about the box's middle) → model
            var unit = new GameObject(u.Name);
            unit.SetActive(false);
            var turn = new GameObject("turn");
            turn.transform.SetParent(unit.transform, false);
            var model = new GameObject("model");
            model.transform.SetParent(turn.transform, false);
            if (!await gltf.InstantiateMainSceneAsync(model.transform))
            {
                UnityEngine.Object.Destroy(unit);
                return null;
            }
            FitToSize(model.transform, new Vector3(u.WidthMm, u.HeightMm, u.DepthMm) * 0.001f);
            unit.SetActive(true);
            LastLoaded = model.GetComponentsInChildren<Renderer>(true).Length + " parts";
            return unit;
        }

        async Task<GltfImport> Get(PazlApi api, string file)
        {
            if (loaded.TryGetValue(file, out var done)) return done;
            if (!loading.TryGetValue(file, out var task))
            {
                task = Load(api, file);
                loading[file] = task;
            }
            var gltf = await task;
            loaded[file] = gltf;
            return gltf;
        }

        /// <summary>Why the last model could not be loaded, for the menu (empty when all is well).</summary>
        public string LastProblem { get; private set; } = "";
        /// <summary>What the last model that did load holds ("12 parts"), for the menu.</summary>
        public string LastLoaded { get; private set; } = "";

        async Task<GltfImport> Load(PazlApi api, string file)
        {
            var tried = new List<string>();
            foreach (var url in api.ModelAddresses(file))
            {
                // Ask first: a missing file comes back as a 404, or as the
                // website's own page (HTML) — neither is a model.
                var check = await Probe(url);
                if (check != null)
                {
                    tried.Add(check);
                    continue;
                }
                var gltf = new GltfImport();
                if (await gltf.Load(url)) return gltf;
                gltf.Dispose();
                tried.Add("not a readable model");
            }
            var name = file.Substring(file.LastIndexOf('/') + 1);
            LastProblem = name + " · " + string.Join(" / ", tried);
            Debug.LogWarning("Pazl: could not load model " + file + " · " + string.Join(" / ", tried));
            return null;
        }

        /// <summary>Null when the address holds a model; else what it holds instead.</summary>
        static async Task<string> Probe(string url)
        {
            using (var req = UnityEngine.Networking.UnityWebRequest.Head(url))
            {
                req.timeout = 20;
                var op = req.SendWebRequest();
                while (!op.isDone) await Task.Yield();
                if (req.responseCode == 404) return "not found (404)";
                if (req.result == UnityEngine.Networking.UnityWebRequest.Result.ConnectionError)
                    return "no connection";
                if (req.responseCode >= 400) return "error " + req.responseCode;
                var type = req.GetResponseHeader("Content-Type") ?? "";
                if (type.Contains("text/html")) return "not found (web page)";
                return null;
            }
        }

        static Material boxMaterial;

        /// <summary>A box of the unit's real size (width × height × depth), for a model that is missing.</summary>
        public static GameObject SizeBox(PazlUnit u)
        {
            var unit = new GameObject(u.Name + " (size box)");
            var turn = new GameObject("turn");
            turn.transform.SetParent(unit.transform, false);
            var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            UnityEngine.Object.Destroy(box.GetComponent<Collider>()); // the hand ray is for walls
            box.transform.SetParent(turn.transform, false);
            box.transform.localScale = new Vector3(u.WidthMm, u.HeightMm, u.DepthMm) * 0.001f;
            if (boxMaterial == null)
            {
                boxMaterial = new Material(Resources.Load<Shader>("PazlBox"));
                boxMaterial.color = new Color(0.78f, 0.62f, 0.42f, 1f); // a wood tone
            }
            box.GetComponent<MeshRenderer>().sharedMaterial = boxMaterial;
            return unit;
        }

        /// <summary>
        /// Scale a model to the unit's real size (width × height × depth, m) and
        /// centre it, as the 3D view does: the unit's position is its middle.
        /// </summary>
        static void FitToSize(Transform model, Vector3 sizeM)
        {
            var b = MeshBounds(model);
            if (b.size.x < 1e-5f || b.size.y < 1e-5f || b.size.z < 1e-5f) return;
            var s = new Vector3(sizeM.x / b.size.x, sizeM.y / b.size.y, sizeM.z / b.size.z);
            model.localScale = s;
            model.localPosition = -Vector3.Scale(b.center, s);
        }

        // Bounds of every mesh under `root`, in root's own space (works while hidden).
        static Bounds MeshBounds(Transform root)
        {
            var toRoot = root.worldToLocalMatrix;
            bool any = false;
            var bounds = new Bounds();
            void Add(Mesh mesh, Transform t)
            {
                if (mesh == null) return;
                var m = toRoot * t.localToWorldMatrix;
                var mb = mesh.bounds;
                for (int i = 0; i < 8; i++)
                {
                    var c = mb.center + Vector3.Scale(mb.extents,
                        new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    var p = m.MultiplyPoint3x4(c);
                    if (!any) { bounds = new Bounds(p, Vector3.zero); any = true; }
                    else bounds.Encapsulate(p);
                }
            }
            foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true)) Add(mf.sharedMesh, mf.transform);
            foreach (var sm in root.GetComponentsInChildren<SkinnedMeshRenderer>(true)) Add(sm.sharedMesh, sm.transform);
            return bounds;
        }

        public void Dispose()
        {
            foreach (var g in loaded.Values) g?.Dispose();
            loaded.Clear();
            loading.Clear();
        }
    }
}
