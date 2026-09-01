import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * boqService — read the project's BOQ (Bill of Quantity) for the client-facing
 * BOQ screen. The BOQ is computed on the DESIGN backend from the 3D scene, so
 * this talks to REACT_APP_PAZL_DESIGN_API_BASE_URL (same pattern as ratesService
 * / projectWorkspaceService). Two calls: resolve the project's floor plan, then
 * generate the BOQ line items for it.
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

const authCfg = (extra = {}) => ({
  headers: { Authorization: `Bearer ${getAccessToken()}`, ...(extra.headers || {}) },
  ...extra,
});

export const getBoqForProject = async (projectId) => {
  if (!projectId) return { items: [], error: "Missing project." };
  try {
    const fp = await axios.get(`${DESIGN}/floorplans`, {
      params: { "$and[0][projectId]": projectId },
      ...authCfg(),
    });
    const floorPlanId = fp?.data?.data?.[0]?._id;
    if (!floorPlanId) {
      return { items: [], error: "No 3D design found for this project yet." };
    }
    const res = await axios.post(
      `${DESIGN}/generateboq`,
      { floorPlanId },
      authCfg()
    );
    const items = Array.isArray(res?.data) ? res.data : [];
    return { items };
  } catch (e) {
    console.error("boqService.getBoqForProject", e);
    return {
      items: [],
      error: e?.response?.data?.message || e?.message || "Could not load the BOQ.",
    };
  }
};
