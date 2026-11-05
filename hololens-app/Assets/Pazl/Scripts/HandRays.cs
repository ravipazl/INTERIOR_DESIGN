// The hand rays of the MRTK3 rig: where each tracked hand points, and an
// air-tap (a pinch let go). Pinches on the menu are the menu's, not a tap.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit;

namespace Pazl
{
    public struct HandRay
    {
        public Ray Ray;
        public bool Tapped;  // a pinch let go this frame
        public bool OverMenu;
    }

    public class HandRays
    {
        readonly List<XRRayInteractor> rays = new List<XRRayInteractor>();
        readonly Dictionary<XRRayInteractor, bool> wasDown = new Dictionary<XRRayInteractor, bool>();
        readonly List<HandRay> now = new List<HandRay>();
        float lastLook = -10f;

        /// <summary>The rays of the hands tracked now.</summary>
        public List<HandRay> Poll()
        {
            // The rig can add or swap interactors; look again now and then.
            if (Time.unscaledTime - lastLook > 2f)
            {
                rays.Clear();
                rays.AddRange(Object.FindObjectsOfType<XRRayInteractor>());
                lastLook = Time.unscaledTime;
            }
            now.Clear();
            foreach (var r in rays)
            {
                if (r == null || !r.isActiveAndEnabled) continue;
                if (!Tracked(r)) { wasDown[r] = false; continue; }
                bool down = r.isSelectActive;
                wasDown.TryGetValue(r, out bool was);
                wasDown[r] = down;
                var from = r.rayOriginTransform != null ? r.rayOriginTransform : r.transform;
                now.Add(new HandRay
                {
                    Ray = new Ray(from.position, from.forward),
                    Tapped = was && !down,
                    OverMenu = r.IsOverUIGameObject(),
                });
            }
            return now;
        }

        static bool Tracked(XRRayInteractor r)
        {
            var c = r.xrController;
            if (c == null) return true;
            var state = c.currentControllerState;
            return state == null || state.inputTrackingState != InputTrackingState.None;
        }
    }
}
