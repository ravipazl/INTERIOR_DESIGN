// Talks to the Pazl backend (the same API the website uses): sign in, the
// projects you can see, the units placed in a project, and each unit's model.
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Pazl
{
    /// <summary>One project, as the list shows it.</summary>
    public class PazlProject
    {
        public string Id;
        public string Name;
        public string Client;
    }

    /// <summary>A catalogue category (KITCHEN, BEDROOM…, and their sub-categories).</summary>
    public class PazlCategory
    {
        public string Id;
        public string Name;
        public string ParentId; // null for a main category
    }

    /// <summary>
    /// One unit placed in the design: where it stands (cm, the 3D view's own
    /// right-handed space), its turn (degrees about up) and its size (mm).
    /// </summary>
    public class PazlUnit
    {
        public string Id;
        public string ModelId;
        public string Name;
        public string ModelUrl;
        public Vector3 PositionCm;     // the middle of the unit
        public float TurnDeg;          // about up, as the 3D view turns it
        public float HeightMm;         // dimensions[0]
        public float WidthMm;          // dimensions[1]
        public float DepthMm;          // dimensions[2]
        public string RoomName;
    }

    public class PazlApi
    {
        const string TokenKey = "pazl.token";

        readonly string apiBase;   // e.g. https://design.pazl.info/api
        readonly string siteBase;  // e.g. https://design.pazl.info (model files, as a fallback)
        string token;

        public PazlApi(string apiBase, string siteBase)
        {
            this.apiBase = apiBase.TrimEnd('/');
            this.siteBase = siteBase.TrimEnd('/');
            token = PlayerPrefs.GetString(TokenKey, "");
        }

        public bool SignedIn => !string.IsNullOrEmpty(token);

        public void SignOut()
        {
            token = "";
            PlayerPrefs.DeleteKey(TokenKey);
            PlayerPrefs.Save();
        }

        /// <summary>Sign in with the Pazl email and password. Only the token is kept.</summary>
        public async Task SignIn(string email, string password)
        {
            var body = JsonConvert.SerializeObject(new { strategy = "local", email, password });
            var json = await Send("POST", "/authentication", body, false);
            token = (string)json["accessToken"];
            if (string.IsNullOrEmpty(token)) throw new Exception("Sign in failed. Check the email and password.");
            PlayerPrefs.SetString(TokenKey, token);
            PlayerPrefs.Save();
        }

        /// <summary>
        /// Sign in with a code instead: the backend makes a short code (shown on
        /// the headset) and a secret only this headset holds. You approve the
        /// code on the website; <see cref="CheckCode"/> then collects the sign-in.
        /// </summary>
        public async Task<(string code, string secret, float interval, float expiresIn)> StartCode()
        {
            var body = JsonConvert.SerializeObject(new { device = "HoloLens · Pazl Real Wall" });
            var json = await Send("POST", "/device-login", body, false);
            return ((string)json["code"], (string)json["secret"],
                (float?)json["interval"] ?? 3f, (float?)json["expiresIn"] ?? 600f);
        }

        /// <summary>True once the code is approved (and this headset signed in); false while waiting.</summary>
        public async Task<bool> CheckCode(string code, string secret)
        {
            var json = await Send("GET", "/device-login/" + Uri.EscapeDataString(code) +
                                         "?secret=" + Uri.EscapeDataString(secret), null, false);
            if ((string)json["status"] != "approved") return false;
            token = (string)json["accessToken"];
            if (string.IsNullOrEmpty(token)) return false;
            PlayerPrefs.SetString(TokenKey, token);
            PlayerPrefs.Save();
            return true;
        }

        public async Task<List<PazlProject>> Projects()
        {
            var json = await Send("GET", "/projects?$limit=50&$sort[updatedAt]=-1", null, true);
            var list = new List<PazlProject>();
            foreach (var p in Rows(json))
            {
                list.Add(new PazlProject
                {
                    Id = (string)p["_id"],
                    Name = (string)p["name"] ?? "Project",
                    Client = (string)p["clientName"] ?? "",
                });
            }
            return list;
        }

        /// <summary>The units placed in a project, with their model names and files.</summary>
        public async Task<List<PazlUnit>> Units(string projectId)
        {
            var json = await Send("GET", "/furnishedmodels?projectId=" + Uri.EscapeDataString(projectId) + "&$limit=500", null, true);
            var units = new List<PazlUnit>();
            var models = new Dictionary<string, JToken>();
            foreach (var r in Rows(json))
            {
                var pos = r["position"] as JArray;
                var rot = r["rotation"] as JArray;
                var dim = r["dimensions"] as JArray;
                if (pos == null || pos.Count < 3 || dim == null || dim.Count < 3) continue;
                var modelId = (string)r["modelId"];
                if (string.IsNullOrEmpty(modelId)) continue;
                if (!models.ContainsKey(modelId))
                {
                    try { models[modelId] = await Send("GET", "/models/" + Uri.EscapeDataString(modelId), null, true); }
                    catch (Exception e) { Debug.LogWarning("Pazl: model " + modelId + " not found: " + e.Message); models[modelId] = null; }
                }
                var m = models[modelId];
                var file = m != null ? (string)m["modelFileUrl"] : null;
                // A unit whose model was taken out of the catalogue still has its
                // place and size: it is listed, and shown as a box of that size.
                units.Add(new PazlUnit
                {
                    Id = (string)r["_id"],
                    ModelId = modelId,
                    Name = m != null ? ((string)m["name"] ?? "Unit") : "Removed model",
                    ModelUrl = file ?? "",
                    PositionCm = new Vector3((float)pos[0], (float)pos[1], (float)pos[2]),
                    TurnDeg = rot != null && rot.Count > 1 ? (float)rot[1] : 0f,
                    HeightMm = (float)dim[0],
                    WidthMm = (float)dim[1],
                    DepthMm = (float)dim[2],
                    RoomName = (string)r["roomName"] ?? "",
                });
            }
            return units;
        }

        /// <summary>The catalogue's categories: main ones have no parent.</summary>
        public async Task<List<PazlCategory>> Categories()
        {
            var json = await Send("GET", "/categories?$limit=1000", null, true);
            var list = new List<PazlCategory>();
            foreach (var c in Rows(json))
            {
                if (c["invisible"] != null && c["invisible"].Type == JTokenType.Boolean && (bool)c["invisible"]) continue;
                list.Add(new PazlCategory
                {
                    Id = (string)c["_id"],
                    Name = (string)c["name"] ?? "Category",
                    ParentId = c["parentCategoryId"] != null && c["parentCategoryId"].Type == JTokenType.String
                        ? (string)c["parentCategoryId"] : null,
                });
            }
            return list;
        }

        /// <summary>The catalogue's items in one category, as units ready to stand on a wall.</summary>
        public async Task<List<PazlUnit>> CatalogueItems(string categoryId)
        {
            var json = await Send("GET", "/models?categoryId=" + Uri.EscapeDataString(categoryId) +
                                         "&$limit=200&$sort[name]=1", null, true);
            var list = new List<PazlUnit>();
            foreach (var m in Rows(json))
            {
                var dim = m["dimensions"] as JArray;
                var file = (string)m["modelFileUrl"];
                if (dim == null || dim.Count < 3 || string.IsNullOrEmpty(file)) continue;
                float h = (float)dim[0], w = (float)dim[1], d = (float)dim[2];
                if (h <= 0 || w <= 0 || d <= 0) continue;
                list.Add(new PazlUnit
                {
                    Id = (string)m["_id"],
                    ModelId = (string)m["_id"],
                    Name = (string)m["name"] ?? "Item",
                    ModelUrl = file,
                    // Standing on the floor at the origin, facing forward.
                    PositionCm = new Vector3(0, h / 20f, 0),
                    TurnDeg = 0,
                    HeightMm = h,
                    WidthMm = w,
                    DepthMm = d,
                    RoomName = "",
                });
            }
            return list;
        }

        /// <summary>Full addresses to try for a model file: the API's, then the site's.</summary>
        public IEnumerable<string> ModelAddresses(string file)
        {
            if (file.StartsWith("http")) { yield return file; yield break; }
            var path = file.StartsWith("/") ? file : "/" + file;
            yield return apiBase + path;
            yield return siteBase + path;
        }

        // A list answer is either an array or { data: [...] } (paged).
        static IEnumerable<JToken> Rows(JToken json)
        {
            if (json is JArray a) return a;
            if (json["data"] is JArray d) return d;
            return new JToken[0];
        }

        async Task<JToken> Send(string method, string path, string body, bool auth)
        {
            using (var req = new UnityWebRequest(apiBase + path, method))
            {
                req.downloadHandler = new DownloadHandlerBuffer();
                if (body != null)
                {
                    req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
                    req.SetRequestHeader("Content-Type", "application/json");
                }
                if (auth && SignedIn) req.SetRequestHeader("Authorization", "Bearer " + token);
                req.timeout = 30;
                var op = req.SendWebRequest();
                while (!op.isDone) await Task.Yield();

                if (req.responseCode == 401 && auth)
                {
                    SignOut();
                    throw new UnauthorizedAccessException("Signed out. Please sign in again.");
                }
                if (req.result != UnityWebRequest.Result.Success)
                {
                    var why = req.downloadHandler != null ? req.downloadHandler.text : "";
                    throw new Exception(req.responseCode + " " + req.error + (string.IsNullOrEmpty(why) ? "" : " · " + Short(why)));
                }
                return JToken.Parse(req.downloadHandler.text);
            }
        }

        static string Short(string s)
        {
            try
            {
                var j = JToken.Parse(s);
                var msg = (string)j["message"];
                if (!string.IsNullOrEmpty(msg)) return msg;
            }
            catch { /* not JSON */ }
            return s.Length > 120 ? s.Substring(0, 120) : s;
        }
    }
}
