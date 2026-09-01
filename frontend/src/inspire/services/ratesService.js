import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * ratesService — read/write access to the BOQ rate-card master tables.
 *
 * These collections live in the DESIGN backend (the 3D editor's material /
 * coating pickers read the very same rows), so this talks to
 * REACT_APP_PAZL_DESIGN_API_BASE_URL — exactly the pattern
 * projectWorkspaceService already uses. The design backend's CORS config
 * already allows this origin and accepts the Inspire token, so moving the Rate
 * Card screen here needs NO backend change.
 *
 *   Material rate -> `corematerialpricing`  (type + grade + brand)
 *   Coating rate  -> `finishingpricing`     (category + brand)
 *   Hardware      -> `hardware`
 *   Installation  -> `settings`             (key = installationRatePerSqft)
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

const authCfg = (extra = {}) => ({
  headers: {
    Authorization: `Bearer ${getAccessToken()}`,
    ...(extra.headers || {}),
  },
  ...extra,
});

// Feathers `find` returns a paginated object ({ data, total, ... }); normalise
// to a plain array so callers don't have to know which shape came back.
const asArray = (res) => {
  const body = res?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
};

const ok = (res) => res?.status >= 200 && res?.status < 300;

// ---- dropdown sources (the same catalog the 3D editor reads) ----

export const getCoreMaterialTypes = async () => {
  try {
    return asArray(await axios.get(`${DESIGN}/corematerialtypes`, authCfg()));
  } catch (e) {
    console.error("ratesService.getCoreMaterialTypes", e);
    return [];
  }
};

export const getCoreMaterialBrands = async () => {
  try {
    return asArray(await axios.get(`${DESIGN}/corematerialbrands`, authCfg()));
  } catch (e) {
    console.error("ratesService.getCoreMaterialBrands", e);
    return [];
  }
};

export const getFinishingCategories = async () => {
  try {
    return asArray(await axios.get(`${DESIGN}/finishingcategories`, authCfg()));
  } catch (e) {
    console.error("ratesService.getFinishingCategories", e);
    return [];
  }
};

export const getFinishingBrands = async () => {
  try {
    return asArray(await axios.get(`${DESIGN}/finishingbrands`, authCfg()));
  } catch (e) {
    console.error("ratesService.getFinishingBrands", e);
    return [];
  }
};

// ---- material rates (corematerialpricing) ----

export const listMaterialRates = async () => {
  try {
    return asArray(
      await axios.get(
        `${DESIGN}/corematerialpricing`,
        authCfg({ params: { $limit: 1000 } })
      )
    );
  } catch (e) {
    console.error("ratesService.listMaterialRates", e);
    return [];
  }
};

export const createMaterialRate = async (data) => {
  const res = await axios.post(`${DESIGN}/corematerialpricing`, data, authCfg());
  return ok(res) ? res.data : null;
};

export const updateMaterialRate = async (id, data) => {
  const res = await axios.patch(
    `${DESIGN}/corematerialpricing/${id}`,
    data,
    authCfg()
  );
  return ok(res) ? res.data : null;
};

export const removeMaterialRate = async (id) => {
  const res = await axios.delete(
    `${DESIGN}/corematerialpricing/${id}`,
    authCfg()
  );
  return ok(res);
};

// ---- coating rates (finishingpricing) ----

export const listCoatingRates = async () => {
  try {
    return asArray(
      await axios.get(
        `${DESIGN}/finishingpricing`,
        authCfg({ params: { $limit: 1000 } })
      )
    );
  } catch (e) {
    console.error("ratesService.listCoatingRates", e);
    return [];
  }
};

export const createCoatingRate = async (data) => {
  const res = await axios.post(`${DESIGN}/finishingpricing`, data, authCfg());
  return ok(res) ? res.data : null;
};

export const updateCoatingRate = async (id, data) => {
  const res = await axios.patch(
    `${DESIGN}/finishingpricing/${id}`,
    data,
    authCfg()
  );
  return ok(res) ? res.data : null;
};

export const removeCoatingRate = async (id) => {
  const res = await axios.delete(`${DESIGN}/finishingpricing/${id}`, authCfg());
  return ok(res);
};

// ---- hardware master (hardware) ----

export const listHardware = async () => {
  try {
    return asArray(
      await axios.get(`${DESIGN}/hardware`, authCfg({ params: { $limit: 1000 } }))
    );
  } catch (e) {
    console.error("ratesService.listHardware", e);
    return [];
  }
};

export const createHardware = async (data) => {
  const res = await axios.post(`${DESIGN}/hardware`, data, authCfg());
  return ok(res) ? res.data : null;
};

export const updateHardware = async (id, data) => {
  const res = await axios.patch(`${DESIGN}/hardware/${id}`, data, authCfg());
  return ok(res) ? res.data : null;
};

export const removeHardware = async (id) => {
  const res = await axios.delete(`${DESIGN}/hardware/${id}`, authCfg());
  return ok(res);
};

// ---- global installation rate (settings, key = installationRatePerSqft) ----

export const getInstallationRate = async () => {
  try {
    const res = await axios.get(
      `${DESIGN}/settings/installationRatePerSqft`,
      authCfg()
    );
    return Number(res?.data?.value) || 0;
  } catch (e) {
    return 0; // not set yet
  }
};

export const setInstallationRate = async (value) => {
  const key = "installationRatePerSqft";
  const msgOf = (e) =>
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    "Unknown error";
  try {
    // Upsert the singleton settings row (_id = key).
    await axios.patch(`${DESIGN}/settings/${key}`, { value }, authCfg());
    return { ok: true };
  } catch (e) {
    try {
      await axios.post(`${DESIGN}/settings`, { _id: key, key, value }, authCfg());
      return { ok: true };
    } catch (e2) {
      // Surface the real backend error instead of hiding it, so a failed save
      // never looks successful in the UI.
      console.error("ratesService.setInstallationRate", e2);
      return { ok: false, error: msgOf(e2) };
    }
  }
};
