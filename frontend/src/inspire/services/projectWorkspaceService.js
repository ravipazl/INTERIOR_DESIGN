import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * projectWorkspaceService — the per-project workspace (documents/media, change
 * requests, tasks, discussions). The data lives in the DESIGN backend
 * (`/projectitems`), where the 3D app writes it. Projects share the same _id
 * across both apps, so filtering by projectId here returns the same records the
 * team created in the 3D app.
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

const authCfg = (extra = {}) => ({
  headers: {
    Authorization: `Bearer ${getAccessToken()}`,
    ...(extra.headers || {}),
  },
  ...extra,
});

const asArray = (res) => {
  const body = res?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
};
const ok = (res) => res?.status >= 200 && res?.status < 300;

// Read the DESIGN backend project's quote flags. `changeRequestPending` is set
// there (by the change-request hook) and cleared there when a revised quote is
// sent — the AI backend doesn't track it — so the client's quote bar must read
// it from here to hide correctly after a change request.
export const getProjectFlags = async (projectId) => {
  try {
    const res = await axios.get(`${DESIGN}/projects/${projectId}`, authCfg());
    const p = res?.data || {};
    return {
      changeRequestPending: !!p.changeRequestPending,
      status: p.status,
    };
  } catch (e) {
    return { changeRequestPending: false, status: undefined };
  }
};

// The set of project ids that currently have a pending client change request
// (design backend is the source of truth). Used to badge admin project rows.
export const getChangeRequestedProjectIds = async () => {
  try {
    const res = await axios.get(`${DESIGN}/projects`, {
      ...authCfg(),
      params: { status: "quotation_sent", $limit: 1000 },
    });
    const arr = res?.data?.data || (Array.isArray(res?.data) ? res.data : []) || [];
    return new Set(
      arr.filter((p) => p?.changeRequestPending).map((p) => String(p._id))
    );
  } catch (e) {
    console.error("projectWorkspaceService.getChangeRequestedProjectIds", e);
    return new Set();
  }
};

export const listItems = async (projectId, kind) => {
  try {
    const res = await axios.get(`${DESIGN}/projectitems`, {
      ...authCfg(),
      params: { projectId, kind, $limit: 500, "$sort[createdAt]": -1 },
    });
    return asArray(res);
  } catch (e) {
    console.error("projectWorkspaceService.listItems", e);
    return [];
  }
};

export const createItem = async (data) => {
  const res = await axios.post(`${DESIGN}/projectitems`, data, authCfg());
  return ok(res) ? res.data : null;
};

export const updateItem = async (id, data) => {
  const res = await axios.patch(`${DESIGN}/projectitems/${id}`, data, authCfg());
  return ok(res) ? res.data : null;
};

export const removeItem = async (id) => {
  const res = await axios.delete(`${DESIGN}/projectitems/${id}`, authCfg());
  return ok(res);
};

// Send a custom email to the client for a tracker step (subject + message + cc +
// optional attachment). Uses the design backend's /send-tracker-mail route.
export const sendStepMail = async ({ projectId, stage, subject, message, cc, file }) => {
  try {
    const fd = new FormData();
    fd.append("projectId", projectId);
    if (stage) fd.append("stage", stage);
    fd.append("subject", subject);
    fd.append("message", message);
    if (cc) fd.append("cc", cc);
    if (file) fd.append("file", file);
    const res = await axios.post(`${DESIGN}/send-tracker-mail`, fd, authCfg());
    return res?.data || { sent: false, error: "No response" };
  } catch (e) {
    return {
      sent: false,
      error: e?.response?.data?.message || e?.message || "Send failed",
    };
  }
};

export const uploadFile = async (projectId, file) => {
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    // No manual Content-Type — the browser adds the multipart boundary.
    const res = await axios.post(`${DESIGN}/project-file-upload`, fd, authCfg());
    return ok(res) ? res.data : null;
  } catch (e) {
    console.error("projectWorkspaceService.uploadFile", e);
    return null;
  }
};

// Files are served by the design frontend (localhost:3031), so prefix relative
// URLs with its origin (derived from the design API base by dropping the API
// port), else fall back to the design API host.
export const fileUrl = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${DESIGN}${url}`;
};
