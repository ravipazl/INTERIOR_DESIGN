# Pazl on the real wall: HoloLens 2 app

A native HoloLens 2 app. It **recognises the real walls** of the room (with
the HoloLens room scan) and stands a Pazl unit, or the whole run of units on
its wall, against an empty real wall at real size, so you can see whether it
fits.

1. Sign in with your Pazl email and password, the same as on the website.
2. Choose a project, then a unit. **Whole run** takes every unit on that wall.
3. **Place on wall**, then point your hand at an empty wall. It lights up when
   the HoloLens has found it, and the unit stands against it, following your hand.
4. Air-tap to drop it. The menu shows the fit:
   `Fits · 1200 mm on 2430 mm · left 600 · right 630 mm`, or `Too wide by 80 mm`.
5. Use **◀ 5 cm / 5 cm ▶** to slide it, **Left end / Centre / Right end** to
   snap it, **Move** to choose another wall, and **Turn 180°** if a model faces
   the wall.

Real walls also **hide** holograms behind them.

The app reads the design only (units, sizes, models). It never changes a project.

---

## What you need

- A Windows PC with **Unity 2022.3 LTS**. In Unity Hub, add the **Universal
  Windows Platform Build Support** module.
- **Visual Studio 2022** with the workloads *Universal Windows Platform
  development* and *Game development with Unity*, plus *C++ (v143) Universal
  Windows Platform tools*.
- The **Mixed Reality Feature Tool**, from Microsoft (free).
- The HoloLens on the same Wi-Fi, with **Developer Mode** and **Device Portal**
  on. You already did this.

## One-time setup (about 30–60 minutes)

1. **Create the project.** In Unity Hub: *New project → 3D (Built-in Render
   Pipeline)*, Unity 2022.3. Then copy this folder's `Assets/Pazl` into the new
   project's `Assets` folder, or create the project *in* this folder.
2. **Add Microsoft's packages** with the *Mixed Reality Feature Tool*. Point it
   at the project and select:
   - **Platform Support → Mixed Reality OpenXR Plugin** (latest)
   - **MRTK3 → MRTK Input** (it brings MRTK Core and the XR Interaction Toolkit)
   - Press *Get features → Import → Approve*, then go back to Unity.
3. **Add Unity's packages.** In *Window → Package Manager → + → Add package by name*:
   - `com.unity.xr.arfoundation` (version 5.1.x)
   - `com.unity.cloud.gltfast`
   - `com.unity.nuget.newtonsoft-json`
4. **Switch to HoloLens.** In *File → Build Settings*: choose **Universal
   Windows Platform**, then *Switch Platform*. Set Architecture to **ARM64** and
   Build configuration to **Release**.
5. **Turn on OpenXR for HoloLens.** In *Edit → Project Settings → XR Plug-in
   Management → UWP tab*:
   - Tick **OpenXR** and the **Microsoft HoloLens feature group**.
   - Under *OpenXR → Features (UWP)*, make sure all **Microsoft HoloLens**
     features are ticked. They include hand tracking and the scene/plane
     features that find walls.
   - Open *Project Validation* and press **Fix All**.
6. **Allow the room scan and the internet.** In *Project Settings → Player →
   UWP → Publishing Settings → Capabilities*, tick **SpatialPerception**,
   **InternetClient** and **InternetClientServer**.
7. **Keep glTF's shaders in the build.** In *Project Settings → Graphics →
   Preloaded Shaders*, add the glTFast shader-variant collection
   (`glTFShaderVariantsBuiltIn`, inside the glTFast package). Without it,
   models can show pink on the device.
8. **Make the scene.**
   - Create a new scene and delete its *Main Camera*.
   - Drag in **MRTK XR Rig**: *Packages → MRTK Input → Assets → Prefabs*.
   - For testing in the editor, also drag in **MRTKInputSimulator**.
   - *GameObject → Create Empty*, name it `Pazl`, and *Add Component →
     Pazl App*.
   - The API address is already the live site
     (`https://design.pazl.info/api`). Change it on the component to test
     against another server.
   - Save the scene and add it in *Build Settings → Scenes In Build*.

## Put it on the HoloLens

1. *File → Build Settings → Build*. Choose an empty folder, such as `Builds`.
2. Open the `.sln` that Unity made in Visual Studio. Set the configuration to
   **Release / ARM64** and the target to **Device** (USB) or **Remote
   Machine** (the HoloLens' IP address on Wi-Fi).
3. Use *Debug → Start Without Debugging*. The first time, the HoloLens asks for
   a PIN from *Settings → Update & Security → For developers → Pair*.
4. You can also make an app package with *Project → Publish → Create App
   Packages* and install it from **Device Portal → Views → Apps → Deploy apps**.

## Using it well

- When the app starts, **look around the room slowly for 10–20 seconds**, so
  the HoloLens finds the walls and the floor. **Scan: shown** lets you see what
  it has found.
- Empty, flat, well-lit walls are found best. Glass, mirrors and very dark
  walls are found poorly.
- The found wall stops where the scan sees a door, a window or furniture, so
  **"Fits … left … right"** is the free space of that wall as scanned. For a
  tight fit (under about 2 cm), confirm with a tape measure.

## What can't be tested off the device

- The editor has **no room scan**, so walls and floor are only found on the
  HoloLens.
- With the input simulator you can still check sign-in, projects, choosing a
  unit and the preview.
- For faster tries, *Holographic Remoting for Play Mode* (in the Mixed Reality
  OpenXR Plugin settings) runs the editor on the HoloLens without building.

## Files

| File | What it does |
|---|---|
| `Assets/Pazl/Scripts/PazlApp.cs` | The steps: sign in → project → unit → point at a wall → fit check |
| `Assets/Pazl/Scripts/PazlApi.cs` | Talks to the Pazl API: sign in, projects, the design's units, model files |
| `Assets/Pazl/Scripts/WallFinder.cs` | The room scan: walls, floor, hiding holograms behind real walls, lighting the wall you point at |
| `Assets/Pazl/Scripts/UnitRun.cs` | Loads the models (glTFast), sizes them to the real size, lays out a whole run |
| `Assets/Pazl/Scripts/HandRays.cs` | Hand rays and air-taps from the MRTK3 rig |
| `Assets/Pazl/Scripts/HoloMenu.cs` | The floating menu |
| `Assets/Pazl/Resources/*.shader` | "Hide what is behind" for real walls, and the wall highlight |

## Notes for whoever builds it

- Units come from `GET /furnishedmodels?projectId=…`: their position in cm,
  rotation in degrees and dimensions in mm (height, width, depth). Models
  come from `GET /models/:id` (`modelFileUrl`).
- The 3D view is right-handed and Unity is left-handed. glTFast mirrors x,
  so positions mirror x and turns reverse (`UnitRun.ToUnity`). If every model
  comes in facing the wall, press Turn 180°. If a whole run comes in mirrored
  left↔right, flip `ToUnity` to mirror z instead.
- Only the sign-in token is kept on the HoloLens (in `PlayerPrefs`), never the
  password.
