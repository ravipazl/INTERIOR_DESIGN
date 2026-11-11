import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * appSettingsService — the admin Settings page (SMTP, Tripo, Claude, Render).
 *
 * Talks to the DESIGN backend's /app-settings routes (admin only). Keys go up
 * when saved and never come back: the server answers with whether a key is
 * set and its last 4 characters. A blank key field means "keep the saved one".
 *
 * Errors are returned, not thrown, as { error, message, fields } so the page
 * can put each message under its field.
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

const authCfg = () => ({
  headers: { Authorization: `Bearer ${getAccessToken()}` },
});

const asError = (err) => {
  const body = err?.response?.data;
  if (body && typeof body === "object") {
    return { error: body.error || "failed", message: body.message || "Something went wrong.", fields: body.fields || {} };
  }
  return { error: "network", message: "Could not reach the server. Check your connection and try again.", fields: {} };
};

export const getAppSettings = async () => {
  try {
    const res = await axios.get(`${DESIGN}/app-settings`, authCfg());
    return { data: res.data };
  } catch (err) {
    return asError(err);
  }
};

export const saveAppSettings = async (section, values) => {
  try {
    const res = await axios.put(`${DESIGN}/app-settings/${section}`, values, authCfg());
    return { data: res.data };
  } catch (err) {
    return asError(err);
  }
};

export const testAppSettings = async (section, values) => {
  try {
    const res = await axios.post(`${DESIGN}/app-settings/${section}/test`, values, {
      ...authCfg(),
      // Email waits on the SMTP server; give it longer than a normal call.
      timeout: 45000,
    });
    return { data: res.data };
  } catch (err) {
    return asError(err);
  }
};
