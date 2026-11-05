// One-click set-up and build for HoloLens 2 (menu "Pazl", or from the command
// line with -executeMethod). Does by script what the README lists by hand:
// UWP / ARM64, OpenXR with the HoloLens features, the app's capabilities,
// glTF's shaders kept in the build, and the scene (MRTK XR Rig + Pazl App).
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;

namespace Pazl.EditorTools
{
    public static class PazlSetup
    {
        const string ScenePath = "Assets/Scenes/Pazl.unity";
        const string BuildPath = "Builds/UWP";
        const string HoloLensFeatureSet = "com.microsoft.openxr.featureset.hololens";
        const string OpenXRLoader = "UnityEngine.XR.OpenXR.OpenXRLoader";

        [MenuItem("Pazl/1. Set up for HoloLens")]
        public static void Setup()
        {
            Platform();
            Player();
            XR();
            Mrtk();
            Shaders();
            Scene();
            AssetDatabase.SaveAssets();
            Debug.Log("Pazl: set-up done.");
        }

        [MenuItem("Pazl/2. Build for HoloLens")]
        public static void Build()
        {
            if (!File.Exists(ScenePath)) Setup();
            // A new version each build, so Device Portal installs it as an update.
            var v = PlayerSettings.WSA.packageVersion;
            PlayerSettings.WSA.packageVersion = new System.Version(v.Major, v.Minor, v.Build + 1, 0);
            Debug.Log("Pazl: version " + PlayerSettings.WSA.packageVersion);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = BuildPath,
                target = BuildTarget.WSAPlayer,
                targetGroup = BuildTargetGroup.WSA,
                options = BuildOptions.None,
            });
            var s = report.summary;
            Debug.Log("Pazl: build " + s.result + " · " + s.totalErrors + " errors · " + s.outputPath);
            if (s.result == BuildResult.Succeeded)
            {
                DropMobileSdk();
                SyncManifestVersion();
            }
            if (Application.isBatchMode && s.result != BuildResult.Succeeded) EditorApplication.Exit(1);
        }

        // Unity's Visual Studio project asks for the old "Windows Mobile" SDK
        // add-on, which HoloLens does not use and Visual Studio no longer
        // installs; packaging fails on it. Take that one reference out.
        static void DropMobileSdk()
        {
            foreach (var proj in Directory.GetFiles(BuildPath, "*.vcxproj", SearchOption.AllDirectories))
            {
                var lines = File.ReadAllLines(proj);
                var kept = lines.Where(l => !l.Contains("SDKReference Include=\"WindowsMobile")).ToArray();
                if (kept.Length == lines.Length) continue;
                File.WriteAllLines(proj, kept);
                Debug.Log("Pazl: removed the Windows Mobile SDK reference from " + proj);
            }
        }

        // Unity leaves an existing Visual Studio project's app manifest alone, so
        // its version would stay at the first build's. Bring it up to date.
        static void SyncManifestVersion()
        {
            var version = PlayerSettings.WSA.packageVersion.ToString();
            foreach (var manifest in Directory.GetFiles(BuildPath, "Package.appxmanifest", SearchOption.AllDirectories))
            {
                var text = File.ReadAllText(manifest);
                var updated = System.Text.RegularExpressions.Regex.Replace(
                    text, "(<Identity\\b[^>]*\\bVersion=\")[^\"]*(\")", "${1}" + version + "${2}");
                if (updated == text) continue;
                File.WriteAllText(manifest, updated);
                Debug.Log("Pazl: app version " + version + " in " + manifest);
            }
        }

        static void Platform()
        {
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WSAPlayer)
                EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WSA, BuildTarget.WSAPlayer);
            EditorUserBuildSettings.wsaArchitecture = "ARM64";
            EditorUserBuildSettings.wsaUWPBuildType = WSAUWPBuildType.D3D;
        }

        static void Player()
        {
            PlayerSettings.companyName = "Pazl";
            PlayerSettings.productName = "Pazl Real Wall";
            PlayerSettings.WSA.packageName = "PazlRealWall";
            PlayerSettings.WSA.applicationDescription = "See Pazl units on your real walls";
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.WSA, ScriptingImplementation.IL2CPP);
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.SpatialPerception, true);
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.InternetClient, true);
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.InternetClientServer, true);
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.PrivateNetworkClientServer, true);

            // MRTK3 reads hands through the Input System; keep the old one too.
            var ps = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset").FirstOrDefault();
            if (ps != null)
            {
                var so = new SerializedObject(ps);
                var input = so.FindProperty("activeInputHandler");
                if (input != null && input.intValue != 2)
                {
                    input.intValue = 2; // Both
                    so.ApplyModifiedProperties();
                }
            }

            // A signing certificate for the app package (made by the build script).
            const string pfx = "Assets/Pazl/Editor/PazlTest.pfx";
            if (File.Exists(pfx)) PlayerSettings.WSA.SetCertificate(pfx, "pazl");
        }

        static void XR()
        {
            // XR Plug-in Management: OpenXR for UWP.
            EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget perTarget);
            if (perTarget == null)
            {
                Directory.CreateDirectory("Assets/XR");
                perTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                AssetDatabase.CreateAsset(perTarget, "Assets/XR/XRGeneralSettingsPerBuildTarget.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, perTarget, true);
            }
            if (!perTarget.HasManagerSettingsForBuildTarget(BuildTargetGroup.WSA))
                perTarget.CreateDefaultManagerSettingsForBuildTarget(BuildTargetGroup.WSA);
            var manager = perTarget.ManagerSettingsForBuildTarget(BuildTargetGroup.WSA);
            XRPackageMetadataStore.AssignLoader(manager, OpenXRLoader, BuildTargetGroup.WSA);
            var general = perTarget.SettingsForBuildTarget(BuildTargetGroup.WSA);
            if (general != null) general.InitManagerOnStart = true;

            // OpenXR: the HoloLens feature group, hands and eyes; never remoting
            // (that would make the app a remote viewer instead of running on the device).
            var set = OpenXRFeatureSetManager.GetFeatureSetWithId(BuildTargetGroup.WSA, HoloLensFeatureSet);
            if (set != null)
            {
                set.isEnabled = true;
                OpenXRFeatureSetManager.SetFeaturesFromEnabledFeatureSets(BuildTargetGroup.WSA);
            }
            else Debug.LogWarning("Pazl: HoloLens feature group not found; turning features on one by one.");
            var openxr = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.WSA);
            if (openxr != null)
            {
                foreach (var f in openxr.GetFeatures<OpenXRFeature>())
                {
                    var n = f.GetType().FullName ?? "";
                    if (n.Contains("Remoting")) { f.enabled = false; continue; }
                    if (n.StartsWith("Microsoft.MixedReality.OpenXR") || n.Contains("EyeGaze") ||
                        n.Contains("HandInteraction") || n.Contains("MicrosoftHand") ||
                        n.Contains("HandTracking") || n.Contains("HandCommonPoses"))
                        f.enabled = true;
                }
                openxr.renderMode = OpenXRSettings.RenderMode.SinglePassInstanced;
                openxr.depthSubmissionMode = OpenXRSettings.DepthSubmissionMode.Depth16Bit;
                EditorUtility.SetDirty(openxr);
            }
            EditorUtility.SetDirty(perTarget);
        }

        // MRTK3 builds only with a profile for the platform: its default one.
        static void Mrtk()
        {
            const string settingsPath = "Assets/MRTK.Generated/MRTKSettings.asset";
            var settings = AssetDatabase.LoadAssetAtPath<MixedReality.Toolkit.Editor.MRTKSettings>(settingsPath);
            if (settings == null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(settingsPath));
                settings = ScriptableObject.CreateInstance<MixedReality.Toolkit.Editor.MRTKSettings>();
                AssetDatabase.CreateAsset(settings, settingsPath);
            }
            var profilePath = AssetDatabase.FindAssets("MRTKProfile t:MixedReality.Toolkit.MRTKProfile")
                .Select(AssetDatabase.GUIDToAssetPath)
                .FirstOrDefault(p => p.Contains("Default Profiles"));
            var profile = profilePath != null ? AssetDatabase.LoadAssetAtPath<MixedReality.Toolkit.MRTKProfile>(profilePath) : null;
            if (profile == null)
            {
                Debug.LogError("Pazl: MRTK's default profile was not found.");
                return;
            }
            settings.SetProfileForBuildTarget(BuildTargetGroup.WSA, profile);
            settings.SetProfileForBuildTarget(BuildTargetGroup.Standalone, profile);
            EditorUtility.SetDirty(settings);
            Debug.Log("Pazl: MRTK profile " + profilePath);
        }

        // glTF materials use glTFast's built-in-pipeline shaders, found by name at
        // run time; keep them in the build (else the models show pink).
        static void Shaders()
        {
            var gs = GraphicsSettings.GetGraphicsSettings();
            var so = new SerializedObject(gs);
            var list = so.FindProperty("m_AlwaysIncludedShaders");
            if (list == null) return;
            foreach (var guid in AssetDatabase.FindAssets("t:Shader glTF"))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.Replace('\\', '/').Contains("/Shader/Built-In/")) continue;
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
                if (shader == null) continue;
                bool there = false;
                for (int i = 0; i < list.arraySize; i++)
                    if (list.GetArrayElementAtIndex(i).objectReferenceValue == shader) there = true;
                if (there) continue;
                list.InsertArrayElementAtIndex(list.arraySize);
                list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
                Debug.Log("Pazl: keeping " + path + " in the build");
            }
            // An export-only collection added by an earlier set-up is not needed.
            var pre = so.FindProperty("m_PreloadedShaders");
            for (int i = pre.arraySize - 1; i >= 0; i--)
            {
                var o = pre.GetArrayElementAtIndex(i).objectReferenceValue;
                if (o != null && AssetDatabase.GetAssetPath(o).Contains("glTFExport"))
                {
                    pre.GetArrayElementAtIndex(i).objectReferenceValue = null;
                    pre.DeleteArrayElementAtIndex(i);
                }
            }
            so.ApplyModifiedProperties();
        }

        static void Scene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var rigGuid = AssetDatabase.FindAssets("MRTK XR Rig t:Prefab").FirstOrDefault();
            if (rigGuid == null)
            {
                Debug.LogError("Pazl: the MRTK XR Rig prefab was not found. Is org.mixedrealitytoolkit.input installed?");
            }
            else
            {
                var rig = AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(rigGuid));
                PrefabUtility.InstantiatePrefab(rig, scene);
            }

            // Light for the models (the room light is the real one, this shapes them).
            var light = new GameObject("Light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1f;
            light.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.55f, 0.55f, 0.55f);

            new GameObject("Pazl").AddComponent<Pazl.PazlApp>();

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }
    }
}
