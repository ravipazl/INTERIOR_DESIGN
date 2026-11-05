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
        // An unnamed upright surface counts as a wall only when at least this wide.
        const float MinWallWidthM = 0.4f;
        const float FallbackEyeHeightM = 1.6f;
        // A level surface counts as the floor only this far below your eyes.
        const float FloorBelowEyesM = 1.2f;
        // A wall reaches down to (about) the floor and up past this height.
        const float NamedWallBottomM = 1.0f;
        const float WallBottomM = 0.5f;
        const float WallTopM = 1.6f;
        float floorGuess = -1.6f;

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

        /// <summary>
        /// A real wall of the room: upright, from (near) the floor to above head
        /// height. A desk's side or a glass partition between desks is upright
        /// too, but stands on the desk and stops low: not a wall.
        /// </summary>
        public bool IsWall(ARPlane p)
        {
            bool named = p.classification == PlaneClassification.Wall;
            // Where the scan does not name surfaces, a big upright one may be a wall.
            if (!named && (p.classification != PlaneClassification.None || p.alignment != PlaneAlignment.Vertical ||
                           p.size.x < MinWallWidthM)) return false;
            Reach(p, out float bottom, out float top);
            return named
                ? bottom <= floorGuess + NamedWallBottomM && top >= floorGuess + WallTopM
                : bottom <= floorGuess + WallBottomM && top >= floorGuess + WallTopM + 0.2f;
        }

        // How low and how high a surface reaches.
        static void Reach(ARPlane p, out float bottom, out float top)
        {
            var outline = p.boundary;
            if (outline.Length < 3)
            {
                float h = Mathf.Max(p.size.x, p.size.y) / 2f;
                bottom = p.center.y - h;
                top = p.center.y + h;
                return;
            }
            bottom = float.MaxValue;
            top = float.MinValue;
            for (int i = 0; i < outline.Length; i++)
            {
                float y = p.transform.TransformPoint(new Vector3(outline[i].x, 0, outline[i].y)).y;
                bottom = Mathf.Min(bottom, y);
                top = Mathf.Max(top, y);
            }
        }

        /// <summary>
        /// The real floor's height: the lowest surface the scan calls floor; else
        /// the lowest level surface well below your eyes (a desk top is not
        /// that low); else below your eyes.
        /// </summary>
        public float FloorY(Transform head)
        {
            float named = float.MaxValue, level = float.MaxValue;
            if (planes != null)
            {
                foreach (var p in planes.trackables)
                {
                    float y = p.center.y;
                    if (p.classification == PlaneClassification.Floor && y < head.position.y - 0.8f)
                        named = Mathf.Min(named, y);
                    else if (p.classification == PlaneClassification.None && p.alignment == PlaneAlignment.HorizontalUp &&
                             y < head.position.y - FloorBelowEyesM)
                        level = Mathf.Min(level, y);
                }
            }
            floorGuess = named < float.MaxValue ? named
                : level < float.MaxValue ? level
                : head.position.y - FallbackEyeHeightM;
            return floorGuess;
        }

        /// <summary>
        /// The real wall a ray lands on, and where. The wall lights up (unless
        /// `light` is false). Returns false when the ray meets no wall.
        /// </summary>
        public bool Aim(Ray ray, Transform head, out WallInfo wall, out Vector3 point, bool light = true)
        {
            wall = null;
            point = Vector3.zero;
            ARPlane found = null;
            float bestDist = float.MaxValue;
            FloorY(head); // walls are told from partitions by how they meet the floor
            foreach (var hit in Physics.RaycastAll(ray, 10f))
            {
                var p = hit.collider.GetComponent<ARPlane>();
                if (p == null || !IsWall(p) || hit.distance >= bestDist) continue;
                bestDist = hit.distance;
                found = p;
                point = hit.point;
            }
            if (light) Light(found);
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
