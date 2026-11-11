import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * invoiceProfilesService — Settings → Tax / Invoice (admin): read the invoice
 * details and save them.
 *
 * The design backend's /invoice-profiles routes. Errors are returned, not
 * thrown, as { error, message, fields } so the page can put each message under
 * its field.
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

const authCfg = () => ({
  headers: { Authorization: `Bearer ${getAccessToken()}` },
});

const run = async (fn) => {
  try {
    const res = await fn();
    return { data: res.data };
  } catch (err) {
    const body = err?.response?.data;
    if (body && typeof body === "object") {
      return { error: body.error || "failed", message: body.message || "Something went wrong.", fields: body.fields || {} };
    }
    return { error: "network", message: "Could not reach the server. Check your connection and try again.", fields: {} };
  }
};

const path = (id) => `${DESIGN}/invoice-profiles/${encodeURIComponent(id)}`;

export const listInvoiceProfiles = () => run(() => axios.get(`${DESIGN}/invoice-profiles`, authCfg()));
export const updateInvoiceProfile = (id, values) => run(() => axios.put(path(id), values, authCfg()));
