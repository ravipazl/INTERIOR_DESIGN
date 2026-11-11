import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * brandingService — Settings → Branding (admin): the app logo and name.
 * Reading is done by the shared BrandingService (public, cached); this saves.
 * Errors are returned, not thrown, as { error, message, fields }.
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

export const getBrandingSettings = async () => {
  try {
    const res = await axios.get(`${DESIGN}/branding`);
    return { data: res.data };
  } catch (err) {
    return { error: "network", message: "Could not load the branding. Check your connection and try again.", fields: {} };
  }
};

export const saveBranding = async (values) => {
  try {
    const res = await axios.put(`${DESIGN}/branding`, values, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    return { data: res.data };
  } catch (err) {
    const body = err?.response?.data;
    if (body && typeof body === "object") {
      return { error: body.error || "failed", message: body.message || "Something went wrong.", fields: body.fields || {} };
    }
    return { error: "network", message: "Could not reach the server. Check your connection and try again.", fields: {} };
  }
};
