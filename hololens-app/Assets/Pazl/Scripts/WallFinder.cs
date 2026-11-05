// The real room as the HoloLens sees it: its walls and floor, found by the
// headset's room scan (Scene Understanding, through AR Foundation planes).
// The wall you point at lights up. With "Hide behind walls" on, every found
// surface also hides what is behind it (real walls stay in front of
// holograms); it is off by default, as a rough scan can hide the units too.
using System.Collections.Generic;
using Unity.XR.CoreUtils;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Pazl
{
    /// <summary>A real wall: its face, and how far it reaches (world metres).</summary>
    public class WallInfo
    {
        public ARPlane Plane;
        public Vector3 Centre;  // on the wall's face
        public Vector3 Normal;  // level, out of the wall towards you
        public Vector3 Along;   // level, along the wall: your LEFT as you face it
        public float Min, Max;  // along the wall from Centre
        public float Bottom, Top;
        public float Width => Max - Min;

        /// <summary>A point brought onto the wall's face.</summary>
        public Vector3 OnFace(Vector3 p) => p - Normal * Vector3.Dot(p - Centre, Normal);
        public float AlongOf(Vector3 p) => Vector3.Dot(p - Centre, Along);
    }

    public class WallFinder : MonoBehaviour
    {
        // A vertical surface counts as a wall when it is at least this big.
        const float MinWallWidthM = 0.4f;
        const float MinWallHeightM = 0.8f;
        const float FallbackEyeHeightM = 1.6f;

        ARPlaneManager planes;
        Material hideMaterial;
        Material litMaterial;
        ARPlane lit;
        bool showSurfaces;
        bool hideBehind;

        // How a surface looks when it is not the lit one, and whether it is drawn at all.
        Material Rest => showSurfaces ? litMaterial : hideMaterial;
        bool Drawn(ARPlane p) => p == lit || showSurfaces || hideBehind;

        public bool Ready => planes != null;
        public int WallCount { get; private set; }

        /// <summary>Start the room scan: an AR session, and planes on the rig.</summary>
        public void Begin()
        {
            hideMaterial = new Material(Resources.Load<Shader>("PazlOcclusion"));
            litMaterial = new Material(Resources.Load<Shader>("PazlHighlight"));
            litMaterial.color = new Color(0.2f, 0.8f, 1f, 0.28f);

            if (FindObjectOfType<ARSession>() == null)
                new GameObject("AR Session").AddComponent<ARSession>();

            var origin = FindObjectOfType<XROrigin>();
            if (origin == null)
            {
                Debug.LogError("Pazl: no XR Origin in the scene. Add the MRTK XR Rig.");
                return;
            }
            planes = origin.GetComponent<ARPlaneManager>();
            if (planes == null) planes = origin.gameObject.AddComponent<ARPlaneManager>();
            planes.requestedDetectionMode = PlaneDetectionMode.Horizontal | PlaneDetectionMode.Vertical;
            planes.enabled = true;
            planes.planesChanged += OnPlanesChanged;
            foreach (var p in planes.trackables) Dress(p);
        }

        void OnDestroy()
        {
            if (planes != null) planes.planesChanged -= OnPlanesChanged;
        }

        // AR Foundation's plane visualizer hides a surface whenever the headset
        // calls it "not fully tracked" — on HoloLens that is often, so the
        // walls never lit up. Draw exactly the surfaces that should be drawn.
        void LateUpdate()
        {
            if (planes == null) return;
            foreach (var p in planes.trackables)
            {
                var r = p.GetComponent<MeshRenderer>();
                if (r == null) continue;
                bool want = Drawn(p);
                if (r.enabled != want) r.enabled = want;
            }
        }

        void OnPlanesChanged(ARPlanesChangedEventArgs e)
        {
            foreach (var p in e.added) Dress(p);
            int n = 0;
            foreach (var p in planes.trackables) if (IsWall(p)) n++;
            WallCount = n;
        }

        // Each surface gets a mesh (made from its outline), a collider for the
        // hand ray to land on, and the see-through "hide what is behind" look.
        void Dress(ARPlane p)
        {
            if (p.GetComponent<MeshFilter>() == null) p.gameObject.AddComponent<MeshFilter>();
            var r = p.GetComponent<MeshRenderer>();
            if (r == null) r = p.gameObject.AddComponent<MeshRenderer>();
            r.sharedMaterial = Rest;
            r.enabled = Drawn(p);
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            if (p.GetComponent<MeshCollider>() == null) p.gameObject.AddComponent<MeshCollider>();
            if (p.GetComponent<ARPlaneMeshVisualizer>() == null) p.gameObject.AddComponent<ARPlaneMeshVisualizer>();
        }

        /// <summary>Show every found surface faintly (to see what the scan found).</summary>
        public void ShowSurfaces(bool on)
        {
            showSurfaces = on;
            if (planes == null) return;
            foreach (var p in planes.trackables)
            {
                var r = p.GetComponent<MeshRenderer>();
                if (r != null && p != lit) r.sharedMaterial = Rest;
            }
        }

        /// <summary>Let found surfaces hide the holograms behind them (off by default).</summary>
        public void HideBehind(bool on) => hideBehind = on;

        public static bool IsWall(ARPlane p)
        {
            if (p.classification == PlaneClassification.Wall) return true;
            // Where the scan does not name surfaces, a big upright one is a wall.
            if (p.classification != PlaneClassification.None) return false;
            return p.alignment == PlaneAlignment.Vertical && p.size.x >= MinWallWidthM && p.size.y >= MinWallHeightM;
        }

        /// <summary>The real floor's height: the lowest floor found, else below your eyes.</summary>
        public float FloorY(Transform head)
        {
            float best = float.MaxValue;
            if (planes != null)
            {
                foreach (var p in planes.trackables)
                {
                    bool floor = p.classification == PlaneClassification.Floor ||
                                 (p.classification == PlaneClassification.None && p.alignment == PlaneAlignment.HorizontalUp);
                    if (!floor || p.center.y > head.position.y - 0.8f) continue;
                    best = Mathf.Min(best, p.center.y);
                }
            }
            return best < float.MaxValue ? best : head.position.y - FallbackEyeHeightM;
        }

        /// <summary>
        /// The real wall a ray lands on, and where. The wall lights up. Returns
        /// false (and lights nothing) when the ray meets no wall.
        /// </summary>
        public bool Aim(Ray ray, Transform head, out WallInfo wall, out Vector3 point)
        {
            wall = null;
            point = Vector3.zero;
            ARPlane found = null;
            float bestDist = float.MaxValue;
            foreach (var hit in Physics.RaycastAll(ray, 10f))
            {
                var p = hit.collider.GetComponent<ARPlane>();
                if (p == null || !IsWall(p) || hit.distance >= bestDist) continue;
                bestDist = hit.distance;
                found = p;
                point = hit.point;
            }
            Light(found);
            if (found == null) return false;
            wall = Describe(found, head);
            return true;
        }

        public void Light(ARPlane p)
        {
            if (p == lit) return;
            if (lit != null)
            {
                var old = lit.GetComponent<MeshRenderer>();
                if (old != null) old.sharedMaterial = Rest;
            }
            lit = p;
            if (lit != null)
            {
                var r = lit.GetComponent<MeshRenderer>();
                if (r != null) r.sharedMaterial = litMaterial;
            }
        }

        /// <summary>A wall's face, its way out towards you, and its reach.</summary>
        public static WallInfo Describe(ARPlane p, Transform head)
        {
            var n = p.normal;
            n.y = 0;
            if (n.sqrMagnitude < 1e-4f) n = -head.forward;
            n.Normalize();
            if (Vector3.Dot(head.position - p.center, n) < 0) n = -n;
            var info = new WallInfo
            {
                Plane = p,
                Centre = p.center,
                Normal = n,
                Along = Vector3.Cross(Vector3.up, n).normalized, // with n towards you: your left
                Min = float.MaxValue,
                Max = float.MinValue,
                Bottom = float.MaxValue,
                Top = float.MinValue,
            };
            var outline = p.boundary;
            if (outline.Length < 3)
            {
                info.Min = -p.size.x / 2;
                info.Max = p.size.x / 2;
                info.Bottom = p.center.y - p.size.y / 2;
                info.Top = p.center.y + p.size.y / 2;
                return info;
            }
            for (int i = 0; i < outline.Length; i++)
            {
                var w = p.transform.TransformPoint(new Vector3(outline[i].x, 0, outline[i].y));
                float a = info.AlongOf(w);
                info.Min = Mathf.Min(info.Min, a);
                info.Max = Mathf.Max(info.Max, a);
                info.Bottom = Mathf.Min(info.Bottom, w.y);
                info.Top = Mathf.Max(info.Top, w.y);
            }
            return info;
        }
    }
}
