// PAZL ON THE REAL WALL — the HoloLens 2 app.
//
// Sign in with your Pazl account, pick a project, pick a unit (or the whole
// run of units on its wall), then point at an empty real wall. The HoloLens'
// room scan finds the wall; the unit stands against it, at real size on the
// real floor, following your hand. Air-tap to drop it. The menu says whether
// it fits: how wide it is, how wide the wall is, and the space left on each
// side. Slide it, snap it to either end, or move it to another wall.
//
// Put this on one GameObject in a scene with the MRTK XR Rig (see README).
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Pazl
{
    public class PazlApp : MonoBehaviour
    {
        [Tooltip("The Pazl API, as the website uses it.")]
        public string apiBase = "https://design.pazl.info/api";
        [Tooltip("The Pazl site, for model files the API does not serve.")]
        public string siteBase = "https://design.pazl.info";

        const float SlideM = 0.05f;
        const float PreviewAheadM = 2.0f;
        const float FitSlackM = 0.005f; // 5 mm: a fit, not a clash
        const int ProjectsPerPage = 6;

        enum Step { SignIn, Projects, Loading, Choose, Aim, Placed }

        PazlApi api;
        HoloMenu menu;
        WallFinder walls;
        HandRays hands;
        ModelCache cache;
        Transform head;
        Step step;

        // sign in
        string email = "";
        string password = "";
        TouchScreenKeyboard keyboard;
        bool typingPassword;

        // project and units
        List<PazlProject> projects = new List<PazlProject>();
        int page;
        PazlProject project;
        List<PazlUnit> units = new List<PazlUnit>();
        int chosen;
        bool wholeRun;
        UnitRun run;
        int buildNo;
        bool turned;
        bool showScan;

        // on the wall
        WallInfo wall;
        float along; // the run's middle, along the wall from its centre (m)
        float floorY;

        void Start()
        {
            head = Camera.main != null ? Camera.main.transform : transform;
            api = new PazlApi(apiBase, siteBase);
            menu = new HoloMenu();
            walls = gameObject.AddComponent<WallFinder>();
            walls.Begin();
            hands = new HandRays();
            cache = new ModelCache();
            if (api.SignedIn) LoadProjects();
            else ShowSignIn();
        }

        void OnDestroy()
        {
            cache?.Dispose();
        }

        void Update()
        {
            menu.Follow(head);
            TypeOnKeyboard();
            if (step == Step.Choose) ShowPreview();
            else if (step == Step.Aim) AimAtWall();
            else if (step == Step.Placed) TapToMove();
        }

        // --- 1. sign in -----------------------------------------------------------
        void ShowSignIn(string message = null)
        {
            step = Step.SignIn;
            menu.Recentre();
            menu.SetTitle("Pazl · sign in");
            menu.SetStatus(message ?? "Your Pazl email and password, as on the website");
            menu.SetButtons(new[]
            {
                new HoloMenu.Item("Sign in with a code", StartCodeSignIn, on: true),
                new HoloMenu.Item(string.IsNullOrEmpty(email) ? "Email…" : email, () => OpenKeyboard(false)),
                new HoloMenu.Item(string.IsNullOrEmpty(password) ? "Password…" : new string('•', password.Length), () => OpenKeyboard(true)),
                new HoloMenu.Item("Sign in", SignIn),
                new HoloMenu.Item("Exit", Application.Quit, danger: true),
            });
        }

        void OpenKeyboard(bool forPassword)
        {
            typingPassword = forPassword;
            keyboard = TouchScreenKeyboard.Open(forPassword ? "" : email,
                forPassword ? TouchScreenKeyboardType.Default : TouchScreenKeyboardType.EmailAddress,
                false, false, forPassword);
        }

        void TypeOnKeyboard()
        {
            if (keyboard == null) return;
            if (keyboard.status == TouchScreenKeyboard.Status.Visible) return;
            if (keyboard.status == TouchScreenKeyboard.Status.Done)
            {
                if (typingPassword) password = keyboard.text;
                else email = keyboard.text.Trim();
            }
            keyboard = null;
            if (step == Step.SignIn) ShowSignIn();
        }

        async void SignIn()
        {
            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
            {
                menu.SetStatus("Type the email and the password first");
                return;
            }
            menu.SetStatus("Signing in…");
            try
            {
                await api.SignIn(email, password);
                password = ""; // not kept: only the sign-in token is
                LoadProjects();
            }
            catch (Exception e)
            {
                ShowSignIn("Could not sign in · " + e.Message);
            }
        }

        // Sign in with a code: no typing on the headset. It shows a code; you
        // type it on the Pazl website (the headset button at the top right);
        // the headset checks every few seconds and signs in once you have.
        int codeRun;

        async void StartCodeSignIn()
        {
            var run = ++codeRun;
            menu.SetTitle("Sign in with a code");
            menu.SetStatus("Getting a code…");
            menu.SetButtons(new[] { new HoloMenu.Item("◀ Back", () => { codeRun++; ShowSignIn(); }) });
            (string code, string secret, float interval, float expiresIn) c;
            try
            {
                c = await api.StartCode();
            }
            catch (Exception e)
            {
                if (run == codeRun) ShowSignIn("Could not get a code · " + e.Message);
                return;
            }
            var shown = c.code.Length == 6 ? c.code.Substring(0, 3) + " " + c.code.Substring(3) : c.code;
            menu.SetTitle("Code:  " + shown);
            menu.SetStatus("On your PC: Pazl website → headset button (top right) → type this code");
            menu.SetButtons(new[]
            {
                new HoloMenu.Item("New code", StartCodeSignIn),
                new HoloMenu.Item("◀ Back", () => { codeRun++; ShowSignIn(); }),
            });

            var until = Time.realtimeSinceStartup + c.expiresIn;
            while (run == codeRun && Time.realtimeSinceStartup < until)
            {
                var wait = Time.realtimeSinceStartup + Mathf.Max(2f, c.interval);
                while (run == codeRun && Time.realtimeSinceStartup < wait) await System.Threading.Tasks.Task.Yield();
                if (run != codeRun) return;
                try
                {
                    if (await api.CheckCode(c.code, c.secret))
                    {
                        if (run != codeRun) return;
                        codeRun++;
                        LoadProjects();
                        return;
                    }
                }
                catch (Exception e)
                {
                    if (run != codeRun) return;
                    // Expired or used up: a fresh one is a tap away.
                    menu.SetStatus("This code has ended · " + e.Message);
                    return;
                }
            }
            if (run == codeRun) menu.SetStatus("This code has expired · press New code");
        }

        // --- 2. project -------------------------------------------------------------
        async void LoadProjects()
        {
            step = Step.Loading;
            menu.SetTitle("Pazl · projects");
            menu.SetStatus("Loading your projects…");
            menu.SetButtons(new HoloMenu.Item[0]);
            try
            {
                projects = await api.Projects();
                page = 0;
                ShowProjects();
            }
            catch (UnauthorizedAccessException)
            {
                ShowSignIn("Please sign in again");
            }
            catch (Exception e)
            {
                menu.SetStatus("Could not load projects · " + e.Message);
                menu.SetButtons(new[] { new HoloMenu.Item("Try again", LoadProjects), new HoloMenu.Item("Sign out", SignOut, danger: true) });
            }
        }

        void ShowProjects()
        {
            step = Step.Projects;
            ClearRun();
            menu.Recentre();
            menu.SetTitle("Pazl · choose a project");
            menu.SetStatus(projects.Count == 0 ? "No projects on this account" : "Air-tap a project");
            var items = new List<HoloMenu.Item>();
            foreach (var p in projects.Skip(page * ProjectsPerPage).Take(ProjectsPerPage))
            {
                var pick = p;
                var label = string.IsNullOrEmpty(p.Client) ? p.Name : p.Name + " · " + p.Client;
                items.Add(new HoloMenu.Item(label, () => OpenProject(pick)));
            }
            if ((page + 1) * ProjectsPerPage < projects.Count) items.Add(new HoloMenu.Item("More ▶", () => { page++; ShowProjects(); }));
            if (page > 0) items.Add(new HoloMenu.Item("◀ Back", () => { page--; ShowProjects(); }));
            items.Add(new HoloMenu.Item("Sign out", SignOut, danger: true));
            menu.SetButtons(items);
        }

        void SignOut()
        {
            api.SignOut();
            ClearRun();
            ShowSignIn();
        }

        async void OpenProject(PazlProject p)
        {
            project = p;
            step = Step.Loading;
            menu.SetTitle(p.Name);
            menu.SetStatus("Loading the design…");
            menu.SetButtons(new HoloMenu.Item[0]);
            try
            {
                units = (await api.Units(p.Id)).OrderBy(u => u.RoomName).ThenBy(u => u.Name).ToList();
            }
            catch (Exception e)
            {
                menu.SetStatus("Could not load the design · " + e.Message);
                menu.SetButtons(new[] { new HoloMenu.Item("Try again", () => OpenProject(p)), new HoloMenu.Item("Projects", ShowProjects) });
                return;
            }
            if (units.Count == 0)
            {
                menu.SetStatus("No units in this design yet");
                menu.SetButtons(new[] { new HoloMenu.Item("Projects", ShowProjects) });
                return;
            }
            chosen = 0;
            wholeRun = false;
            turned = false;
            Choose();
        }

        // --- 3. unit ----------------------------------------------------------------
        async void Choose()
        {
            step = Step.Choose;
            menu.Recentre();
            ShowChooseMenu("Loading the model…");
            var no = ++buildNo;
            var picked = UnitRun.Pick(units, units[chosen], wholeRun);
            UnitRun built;
            try
            {
                built = await UnitRun.Build(api, cache, picked);
            }
            catch (Exception e)
            {
                if (no == buildNo) ShowChooseMenu("Could not load the model · " + e.Message);
                return;
            }
            if (no != buildNo) { built.Destroy(); return; } // chosen again meanwhile
            ClearRun();
            run = built;
            run.SetTurned(turned);
            ShowChooseMenu(null);
        }

        void ShowChooseMenu(string message)
        {
            var u = units[chosen];
            var what = run != null && step == Step.Choose ? run.Name + " · " + run.WidthMm + " mm wide" : u.Name;
            menu.SetTitle((chosen + 1) + " of " + units.Count + (string.IsNullOrEmpty(u.RoomName) ? "" : " · " + u.RoomName));
            menu.SetStatus(message ?? what);
            menu.SetButtons(new[]
            {
                new HoloMenu.Item("◀ Previous", () => { chosen = (chosen + units.Count - 1) % units.Count; Choose(); }),
                new HoloMenu.Item("Next ▶", () => { chosen = (chosen + 1) % units.Count; Choose(); }),
                new HoloMenu.Item(wholeRun ? "Whole run" : "One unit", () => { wholeRun = !wholeRun; Choose(); }, on: wholeRun),
                new HoloMenu.Item("Place on wall ▶", StartAim),
                new HoloMenu.Item(showScan ? "Scan: shown" : "Scan: hidden", ToggleScan, on: showScan),
                new HoloMenu.Item("Projects", ShowProjects),
            });
        }

        void ToggleScan()
        {
            showScan = !showScan;
            walls.ShowSurfaces(showScan);
            if (step == Step.Choose) ShowChooseMenu(null);
            else if (step == Step.Placed) ShowPlacedMenu();
        }

        /// <summary>While choosing: the unit stands on the floor a little ahead of you.</summary>
        void ShowPreview()
        {
            if (run == null || run.Root == null) return;
            var dir = head.forward;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            var at = head.position + dir * PreviewAheadM;
            at.y = walls.FloorY(head);
            // As if against a wall behind it: its front towards you.
            run.Root.transform.SetPositionAndRotation(at, Quaternion.LookRotation(-dir, Vector3.up));
            run.Root.SetActive(true);
        }

        // --- 4. point at a real wall ---------------------------------------------------
        void StartAim()
        {
            if (run == null) return;
            step = Step.Aim;
            wall = null;
            run.Root.SetActive(false);
            menu.SetTitle("Point at an empty wall");
            menu.SetButtons(new[]
            {
                new HoloMenu.Item("◀ Back", Choose),
                new HoloMenu.Item(showScan ? "Scan: shown" : "Scan: hidden", ToggleScan, on: showScan),
            });
        }

        void AimAtWall()
        {
            floorY = walls.FloorY(head);
            WallInfo found = null;
            Vector3 point = Vector3.zero;
            bool tapped = false;
            foreach (var h in hands.Poll())
            {
                if (h.OverMenu) continue;
                if (walls.Aim(h.Ray, head, out var w, out var p))
                {
                    found = w;
                    point = p;
                    tapped = h.Tapped;
                    break;
                }
            }
            if (found == null)
            {
                walls.Light(null);
                run.Root.SetActive(false);
                menu.SetStatus(walls.WallCount == 0
                    ? "Look around slowly so the HoloLens can find the walls"
                    : "Point your hand at a wall · it lights up when found");
                return;
            }
            wall = found;
            Stand(wall.AlongOf(point));
            menu.SetStatus(FitText() + " · air-tap to drop it here");
            if (tapped) Drop();
        }

        void Drop()
        {
            step = Step.Placed;
            walls.Light(null);
            ShowPlacedMenu();
        }

        /// <summary>The run against the wall: back on its face, on the floor, its middle at `at`.</summary>
        void Stand(float at)
        {
            along = at;
            var p = wall.OnFace(wall.Centre + wall.Along * along);
            p.y = floorY;
            // Front out of the wall towards you; the run's right is then your right.
            run.Root.transform.SetPositionAndRotation(p, Quaternion.LookRotation(wall.Normal, Vector3.up));
            run.Root.SetActive(true);
        }

        // --- 5. on the wall: does it fit? -----------------------------------------------
        void ShowPlacedMenu()
        {
            menu.SetTitle(run.Name);
            menu.SetStatus(FitText());
            menu.SetButtons(new[]
            {
                new HoloMenu.Item("◀ 5 cm", () => Slide(SlideM)),
                new HoloMenu.Item("5 cm ▶", () => Slide(-SlideM)),
                new HoloMenu.Item("Move", StartAim),
                new HoloMenu.Item("Left end", () => SnapTo(wall.Max - run.WidthM / 2f)),
                new HoloMenu.Item("Centre", () => SnapTo((wall.Min + wall.Max) / 2f)),
                new HoloMenu.Item("Right end", () => SnapTo(wall.Min + run.WidthM / 2f)),
                new HoloMenu.Item("Turn 180°", () => { turned = !turned; run.SetTurned(turned); }, on: turned),
                new HoloMenu.Item("Other unit", Choose),
                new HoloMenu.Item("Projects", ShowProjects),
            });
        }

        // `Along` is your left as you face the wall, so "◀" adds.
        void Slide(float m) => SnapTo(along + m);

        void SnapTo(float at)
        {
            Stand(at);
            menu.SetStatus(FitText());
        }

        /// <summary>Placed: air-tap another spot (or wall) to move it there.</summary>
        void TapToMove()
        {
            foreach (var h in hands.Poll())
            {
                if (!h.Tapped || h.OverMenu) continue;
                if (walls.Aim(h.Ray, head, out var w, out var p))
                {
                    wall = w;
                    floorY = walls.FloorY(head);
                    Stand(wall.AlongOf(p));
                    walls.Light(null);
                    menu.SetStatus(FitText());
                }
                return;
            }
        }

        /// <summary>How the run sits on the wall: fits (and the gaps), or by how much it does not.</summary>
        string FitText()
        {
            if (wall == null || run == null) return "";
            int needMm = run.WidthMm;
            int wallMm = Mathf.RoundToInt(wall.Width * 1000f);
            float half = run.WidthM / 2f;
            float leftGap = wall.Max - (along + half);   // towards your left
            float rightGap = (along - half) - wall.Min;  // towards your right
            if (wall.Width < run.WidthM - FitSlackM)
                return "Too wide by " + (needMm - wallMm) + " mm · " + needMm + " mm on a " + wallMm + " mm wall";
            if (leftGap < -FitSlackM)
                return "Past the wall's left end by " + Mm(-leftGap) + " mm · slide ▶";
            if (rightGap < -FitSlackM)
                return "Past the wall's right end by " + Mm(-rightGap) + " mm · slide ◀";
            return "Fits · " + needMm + " mm on " + wallMm + " mm · left " + Mm(leftGap) + " · right " + Mm(rightGap) + " mm";
        }

        static int Mm(float m) => Mathf.Max(0, Mathf.RoundToInt(m * 1000f));

        void ClearRun()
        {
            buildNo++;
            if (run != null) run.Destroy();
            run = null;
        }
    }
}
