// A unit, or the whole run of units on its wall, ready to stand against a
// real wall: the models loaded (glTFast), sized to the unit's real size, and
// laid out as in the design. The run's own frame: its back on z = 0, its
// front along +z, its middle (along the wall) at x = 0, the floor at y = 0.
using System;
using System.Collections.Generic;
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

        public int WidthMm => Mathf.RoundToInt(WidthM * 1000f);

        public string Name => Units.Count == 1 ? Units[0].Name : Units.Count + " units on one wall";

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

        /// <summary>Load and lay out the units, in the run's own frame.</summary>
        public static async Task<UnitRun> Build(PazlApi api, ModelCache cache, List<PazlUnit> units)
        {
            var run = new UnitRun { Units = units };
            var first = units[0];
            var f = TurnOf(first) * Vector3.forward;
            var a = Vector3.Cross(Vector3.up, f).normalized; // the run's right
            float minA = float.MaxValue, maxA = float.MinValue, back = float.MaxValue, top = 0f;
            foreach (var u in units)
            {
                var p = ToUnity(u.PositionCm);
                float halfW = u.WidthMm * 0.0005f;
                minA = Mathf.Min(minA, Vector3.Dot(p, a) - halfW);
                maxA = Mathf.Max(maxA, Vector3.Dot(p, a) + halfW);
                back = Mathf.Min(back, BackOf(u, f));
                top = Mathf.Max(top, p.y + u.HeightMm * 0.0005f);
            }
            run.WidthM = maxA - minA;
            run.HeightM = top;

            var origin = a * ((minA + maxA) / 2f) + f * back;
            origin.y = 0f;
            var frame = Quaternion.Inverse(Quaternion.LookRotation(f, Vector3.up));

            run.Root = new GameObject("Pazl Run");
            run.Root.SetActive(false); // shown once placed
            foreach (var u in units)
            {
                var unit = await cache.Make(api, u);
                if (unit == null) continue;
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

        static async Task<GltfImport> Load(PazlApi api, string file)
        {
            foreach (var url in api.ModelAddresses(file))
            {
                var gltf = new GltfImport();
                if (await gltf.Load(url)) return gltf;
                gltf.Dispose();
            }
            Debug.LogWarning("Pazl: could not load model " + file);
            return null;
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
