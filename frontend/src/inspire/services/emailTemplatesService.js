import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * emailTemplatesService — Settings → Email Templates (admin), plus the two
 * team calls the email composers use (options, fill).
 *
 * Talks to the DESIGN backend's /email-templates routes. Errors are returned,
 * not thrown, as { error, message, fields } so the page can put each message
 * under its field.
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

const run = async (fn) => {
  try {
    const res = await fn();
    return { data: res.data };
  } catch (err) {
    return asError(err);
  }
};

const path = (key) => `${DESIGN}/email-templates/${encodeURIComponent(key)}`;

export const listEmailTemplates = () => run(() => axios.get(`${DESIGN}/email-templates`, authCfg()));
export const getEmailTemplate = (key) => run(() => axios.get(path(key), authCfg()));
export const createEmailTemplate = (values) => run(() => axios.post(`${DESIGN}/email-templates`, values, authCfg()));
export const updateEmailTemplate = (key, values) => run(() => axios.put(path(key), values, authCfg()));
export const deleteEmailTemplate = (key) => run(() => axios.delete(path(key), authCfg()));
export const resetEmailTemplate = (key) => run(() => axios.post(`${path(key)}/reset`, {}, authCfg()));
export const previewEmailTemplate = (values) => run(() => axios.post(`${DESIGN}/email-templates/preview`, values, authCfg()));
export const testEmailTemplate = (values) =>
  run(() => axios.post(`${DESIGN}/email-templates/test`, values, { ...authCfg(), timeout: 45000 }));

// For the email composers (admin, super admin, architect).
export const listEmailTemplateOptions = () => run(() => axios.get(`${DESIGN}/email-templates/options`, authCfg()));
export const fillEmailTemplate = (key, projectId) =>
  run(() => axios.post(`${DESIGN}/email-templates/fill`, { key, projectId }, authCfg()));
