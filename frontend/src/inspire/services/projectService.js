import axios from "axios";
import apiService from "./api";
import { getAccessToken } from "./authService";

export const createProject = async (data) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.post(
      "/projects",
      { ...data },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    const created = response?.data;
    // Mirror the project into the design backend with the SAME _id, so cross-app
    // updates (e.g. "Request quote" → PATCH :3334/projects/<id>) resolve to the
    // same project in both databases. Previously each backend assigned its own
    // _id, so the design copy was unreachable by the AI-side id (→ 404).
    // Best-effort: a failure here must not break project creation.
    if (created?._id) {
      try {
        await axios.post(
          `${process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL}/projects`,
          { ...data, _id: created._id },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
      } catch (mirrorErr) {
        console.error(
          "createProject: design-backend mirror failed",
          mirrorErr?.response?.status || mirrorErr?.message
        );
      }
    }
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
};

export const getProjectById = async (id) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.get(`/projects/${id}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
};

export const getProject = async (userId) => {
  //console.log('userId', userId);
  try {
    const accessToken = getAccessToken();
    const response = await apiService.get("/projects", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
};

export const getOpenProjectsCount = async () => {
  return await getProjectsCountByStatus("open");
};

export const getClosedProjectsCount = async () => {
  return await getProjectsCountByStatus("closed");
};

export const getQuotationRequestedProjectsCount = async () => {
  return await getProjectsCountByStatus("quotation_requested");
};

export const getQuotationSentProjectsCount = async () => {
  return await getProjectsCountByStatus("quotation_sent");
};

export const getProjectsCountByStatus = async (status) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.get("/projects", {
      params: {
        "$and[0][status]": status,
        $limit: 0,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (
      response?.data?.total &&
      response?.status >= 200 &&
      response?.status < 300
    ) {
      return response.data.total;
    }
    return 0;
  } catch (err) {
    return null;
  }
};

// Marks a quotation request as read by the admin (the header bell). Reuses the
// normal project PATCH — no separate notifications service or collection.
export const markQuoteRequestRead = async (projectId) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.patch(
      `/projects/${projectId}`,
      { quoteRequestReadAt: new Date().toISOString() },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response?.data || null;
  } catch (err) {
    console.error("markQuoteRequestRead failed", err?.response?.status || err?.message);
    return null;
  }
};

// Marks an architect's assignment as read (their header bell). The backend
// permits an architect to write ONLY this field, and only on a project assigned
// to them — see ai-backend projects.class.js patch().
export const markAssignmentRead = async (projectId) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.patch(
      `/projects/${projectId}`,
      { architectAssignmentReadAt: new Date().toISOString() },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response?.data || null;
  } catch (err) {
    console.error("markAssignmentRead failed", err?.response?.status || err?.message);
    return null;
  }
};

// Marks an architect "team update" (their quote sent / accepted / project
// closed) as read. Like markAssignmentRead, the backend permits an architect to
// write ONLY this field, and only on a project assigned to them.
export const markArchitectUpdateRead = async (projectId) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.patch(
      `/projects/${projectId}`,
      { architectUpdateReadAt: new Date().toISOString() },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response?.data || null;
  } catch (err) {
    console.error("markArchitectUpdateRead failed", err?.response?.status || err?.message);
    return null;
  }
};

// Marks a tracker "step move" notification as read (the header bell item for a
// project that advanced a workflow step). `field` defaults to stepMoveReadAt.
export const markStepMoveRead = async (projectId, field = "stepMoveReadAt") => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.patch(
      `/projects/${projectId}`,
      { [field]: new Date().toISOString() },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response?.data || null;
  } catch (err) {
    console.error("markStepMoveRead failed", err?.response?.status || err?.message);
    return null;
  }
};

export const getProjectsByStatus = async (status) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.get("/projects", {
      params: {
        "$and[0][status]": status,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response;
    }
    return null;
  } catch (err) {
    return null;
  }
};

export const getAllProjects = async (limit, skip) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.get("/projects", {
      params: {
        $limit: limit,
        $skip: skip,
        $sort: {
          createdAt: -1,
        },
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
};

export const getProjectByShareId = async (shareId, accessToken) => {
  try {
    const response = await apiService.get("/projects", {
      params: {
        "$and[0][shareId]": shareId,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "user-type": "anonymous",
      },
    });
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
};

export const updateProject = async (projectId, data) => {
  const accessToken = getAccessToken();

  // Primary update on the AI backend.
  let aiResult = null;
  try {
    const response = await apiService.patch(
      `/projects/${projectId}`,
      { ...data },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      // The backend answers a REFUSED write with 200 + `[]` (see ai-backend
      // projects.class.js). An empty array is truthy in JS, so callers used to
      // treat that as success — e.g. "Get Quote" showed "Quotation requested!"
      // while nothing had been saved. Treat it as the failure it is.
      const denied = Array.isArray(response.data) && response.data.length === 0;
      aiResult = denied ? null : response.data;
    }
  } catch (err) {
    console.error("updateProject: AI-backend update failed", err);
    return null;
  }

  // Mirror to the design backend — BEST-EFFORT. Projects created before id-sync
  // exist there under a different _id (or not at all), so this PATCH can 404.
  // That must NOT fail the whole action (e.g. "Request quote"): the AI-side
  // update is the source of truth, so we still return its result.
  //
  // Strip AI-only fields: the design projects schema is strict
  // (additionalProperties:false) and would 400 on them, which would knock out
  // the status mirror too. `rejectReason` is AI-only (the design side hears the
  // reason via the reject email, not this field) — leaving it in was why a client
  // rejection never reached the design app, so its "Close" bar never appeared.
  // The design app doesn't use any of these fields.
  const { quoteImageUrl, quoteImageId, rejectReason, ...designData } = data;
  try {
    await axios.patch(
      `${process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL}/projects/${projectId}`,
      { ...designData },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch (designErr) {
    // The PATCH 404'd — the project isn't in the design backend yet (its create
    // mirror missed). Create it there now with the SAME _id + the full project,
    // so updates like "Assign Architect" or status ALWAYS reach the 3D app/BOQ.
    try {
      // Nothing authoritative to mirror: the AI-side write was refused or the
      // project does not exist there. Creating from an empty source produced a
      // nameless POST that the design backend rejected with
      // "must have required property 'name'" — noise from an action that had
      // already failed. Bail out instead.
      if (!aiResult?._id) {
        return aiResult;
      }
      const src = aiResult;
      const allowed = [
        "name",
        "clientName",
        "address",
        "status",
        "architectUserId",
        "ownerUserId",
        "shareId",
        "defaultUnits",
        "sharedUserIDs",
        "boqNumber",
        "revisedBoqNumber",
        "clientGSTNumber",
        "clientEmail",
        "clientPhoneNumber",
      ];
      const payload = { _id: projectId };
      for (const f of allowed) if (src[f] !== undefined) payload[f] = src[f];
      await axios.post(
        `${process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL}/projects`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    } catch (createErr) {
      console.error(
        "updateProject: design-backend create fallback failed",
        createErr?.response?.status || createErr?.message
      );
    }
  }

  return aiResult;
};

export const deleteProject = async (id) => {
  try {
    const accessToken = getAccessToken();
    const response = await apiService.delete(`/projects/${id}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const response2 = await axios.delete(
      `${process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL}/projects/${id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data;
    }
  } catch (err) {
    return null;
  }
};
