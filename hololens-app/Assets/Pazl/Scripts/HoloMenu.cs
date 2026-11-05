// The floating menu: a title, a status line and big buttons on a small panel
// that stays in view a little below your eyes, catching up when you turn.
// Built in code (Unity UI on a world-space canvas), pressed with the hand ray
// and a pinch through MRTK3 / XR Interaction Toolkit.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using UnityEngine.XR.Interaction.Toolkit.UI;

namespace Pazl
{
    public class HoloMenu
    {
        // 42 cm wide panel; buttons about 13 × 8 cm, easy to land a ray on.
        const float PanelWidthM = 0.42f;
        const int W = 1024;
        const int PAD = 24;
        const int TOP = 150;
        const int BH = 170;
        const int COLS = 3;
        const float AheadM = 0.7f;
        const float BelowEyesM = 0.07f;

        static readonly Color Panel = new Color(0.08f, 0.10f, 0.15f, 0.92f);
        static readonly Color Btn = new Color(0.165f, 0.204f, 0.275f, 1f);
        static readonly Color BtnHover = new Color(0.231f, 0.510f, 0.965f, 1f);
        static readonly Color BtnPress = new Color(0.133f, 0.773f, 0.369f, 1f);
        static readonly Color BtnExit = new Color(0.498f, 0.114f, 0.114f, 1f);
        static readonly Color BtnOn = new Color(0.122f, 0.435f, 0.624f, 1f);
        static readonly Color StatusColour = new Color(0.62f, 0.85f, 1f, 1f);

        readonly GameObject root;
        readonly RectTransform rect;
        readonly Text title;
        readonly Text status;
        readonly RectTransform buttonArea;
        readonly Font font;
        readonly List<GameObject> buttons = new List<GameObject>();
        bool placed;
        bool moving;

        public Transform Transform => root.transform;

        /// <summary>One button: what it says, what it does, and how it looks.</summary>
        public struct Item
        {
            public string Label;
            public Action OnPress;
            public bool Danger; // red (Exit, Sign out)
            public bool On;     // lit (a setting that is on)
            public Item(string label, Action onPress, bool danger = false, bool on = false)
            {
                Label = label; OnPress = onPress; Danger = danger; On = on;
            }
        }

        public HoloMenu()
        {
            EnsureEventSystem();
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            root = new GameObject("Pazl Menu", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler),
                typeof(TrackedDeviceGraphicRaycaster));
            var canvas = root.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = Camera.main;
            canvas.sortingOrder = 10;
            rect = root.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(W, TOP + PAD + BH);
            root.transform.localScale = Vector3.one * (PanelWidthM / W);

            var bg = root.AddComponent<Image>();
            bg.color = Panel;

            title = MakeText("Title", root.transform, 44, FontStyle.Bold, Color.white);
            Place(title.rectTransform, PAD + 8, PAD, W - 2 * PAD - 16, 60);
            status = MakeText("Status", root.transform, 32, FontStyle.Normal, StatusColour);
            Place(status.rectTransform, PAD + 8, PAD + 64, W - 2 * PAD - 16, 64);

            var area = new GameObject("Buttons", typeof(RectTransform));
            area.transform.SetParent(root.transform, false);
            buttonArea = area.GetComponent<RectTransform>();
            Place(buttonArea, 0, TOP, W, BH + PAD);
        }

        public void SetTitle(string text) => title.text = text;
        public void SetStatus(string text) => status.text = text;

        /// <summary>The buttons now, three to a row; the panel grows to fit them.</summary>
        public void SetButtons(IList<Item> items)
        {
            foreach (var b in buttons) UnityEngine.Object.Destroy(b);
            buttons.Clear();
            int rows = Mathf.Max(1, Mathf.CeilToInt(items.Count / (float)COLS));
            float bw = (W - PAD * (COLS + 1)) / (float)COLS;
            for (int i = 0; i < items.Count; i++)
            {
                int col = i % COLS, row = i / COLS;
                buttons.Add(MakeButton(items[i], PAD + col * (bw + PAD), PAD + row * (BH + PAD), bw, BH));
            }
            float h = TOP + PAD + rows * (BH + PAD);
            rect.sizeDelta = new Vector2(W, h);
            Place(buttonArea, 0, TOP, W, rows * (BH + PAD) + PAD);
        }

        /// <summary>Keep the menu ahead and a little low, catching up when you turn.</summary>
        public void Follow(Transform head)
        {
            var dir = head.forward;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) dir = Vector3.forward;
            dir.Normalize();
            var want = head.position + dir * AheadM + Vector3.down * BelowEyesM;
            var toMenu = root.transform.position - head.position;
            toMenu.y = 0;
            float off = Vector3.Angle(toMenu, dir);
            if (!placed)
            {
                root.transform.position = want;
                placed = true;
            }
            else if (off > 35f || Vector3.Distance(root.transform.position, want) > 0.45f)
            {
                moving = true;
            }
            if (moving)
            {
                root.transform.position = Vector3.Lerp(root.transform.position, want, 0.08f);
                if (Vector3.Distance(root.transform.position, want) < 0.03f) moving = false;
            }
            // Face your eyes (a canvas shows its front along -forward).
            root.transform.rotation = Quaternion.LookRotation(root.transform.position - head.position, Vector3.up);
        }

        /// <summary>Put the menu straight in front again (after a big change).</summary>
        public void Recentre() => placed = false;

        GameObject MakeButton(Item item, float x, float y, float w, float h)
        {
            var go = new GameObject(item.Label, typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(buttonArea, false);
            Place(go.GetComponent<RectTransform>(), x, y, w, h);
            var img = go.GetComponent<Image>();
            var normal = item.Danger ? BtnExit : item.On ? BtnOn : Btn;
            img.color = Color.white;
            var button = go.GetComponent<Button>();
            var colours = button.colors;
            colours.normalColor = normal;
            colours.highlightedColor = BtnHover;
            colours.selectedColor = normal;
            colours.pressedColor = BtnPress;
            colours.fadeDuration = 0.05f;
            button.colors = colours;
            button.targetGraphic = img;
            var press = item.OnPress;
            button.onClick.AddListener(() =>
            {
                // Clear the selection so the next button lights up from fresh.
                if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(null);
                press?.Invoke();
            });

            var label = MakeText("Label", go.transform, 40, FontStyle.Bold, Color.white);
            label.alignment = TextAnchor.MiddleCenter;
            label.resizeTextForBestFit = true;
            label.resizeTextMinSize = 24;
            label.resizeTextMaxSize = 40;
            label.text = item.Label;
            var lr = label.rectTransform;
            lr.anchorMin = Vector2.zero;
            lr.anchorMax = Vector2.one;
            lr.offsetMin = new Vector2(12, 8);
            lr.offsetMax = new Vector2(-12, -8);
            return go;
        }

        Text MakeText(string name, Transform parent, int size, FontStyle style, Color colour)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            var t = go.GetComponent<Text>();
            t.font = font;
            t.fontSize = size;
            t.fontStyle = style;
            t.color = colour;
            t.alignment = TextAnchor.MiddleLeft;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Truncate;
            t.raycastTarget = false;
            return t;
        }

        // Place a box by its top-left corner, in panel pixels.
        static void Place(RectTransform r, float x, float y, float w, float h)
        {
            r.anchorMin = r.anchorMax = new Vector2(0, 1);
            r.pivot = new Vector2(0, 1);
            r.anchoredPosition = new Vector2(x, -y);
            r.sizeDelta = new Vector2(w, h);
        }

        // Buttons are pressed through the XR UI input module (hand ray + pinch).
        static void EnsureEventSystem()
        {
            var es = UnityEngine.Object.FindObjectOfType<EventSystem>();
            if (es == null)
            {
                new GameObject("EventSystem", typeof(EventSystem), typeof(XRUIInputModule));
                return;
            }
            if (es.GetComponent<XRUIInputModule>() == null)
            {
                foreach (var m in es.GetComponents<BaseInputModule>()) m.enabled = false;
                es.gameObject.AddComponent<XRUIInputModule>();
            }
        }
    }
}
