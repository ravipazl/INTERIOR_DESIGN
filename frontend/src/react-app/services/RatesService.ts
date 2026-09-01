import axios from "./apiService";
import { AuthService } from "./authService";

/**
 * RatesService — read/write access to the BOQ rate-card master tables.
 *
 * These are the SAME collections the 3D editor's pickers read from
 * (core material types/brands, finishing categories/brands). The master
 * screens here add the create/update/delete side so an admin can maintain
 * prices in one place; the 3D dropdowns and the BOQ both use them.
 *
 * - Material rate  -> `corematerialpricing` keyed by type + grade + thickness + brand
 * - Coating rate   -> `finishingpricing`   keyed by category + brand
 */

const auth = () => ({
  headers: { Authorization: `${AuthService.getAccessToken()}` },
});

// Feathers `find` returns a paginated object ({ data, total, ... }); normalise
// to a plain array so callers don't have to know.
const asArray = (res: any): any[] => {
  const body = res?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
};

const ok = (res: any) => res?.status >= 200 && res?.status < 300;

export interface CoreMaterialPricing {
  _id?: string;
  coreMaterialTypeId: string;
  grade: string;
  thickness?: number; // retired from the rate key; kept optional for old rows
  brandId: string;
  pricePerSqft: number;
}

export interface FinishingPricing {
  _id?: string;
  finishingCategoryId: string;
  finishingBrandId: string;
  pricePerSqft: number;
}

export const RatesService = {
  // ---- dropdown sources (catalog the 3D editor already uses) ----
  getCoreMaterialTypes: async () => {
    try {
      return asArray(await axios.get("/corematerialtypes", auth()));
    } catch (e) {
      console.error("RatesService.getCoreMaterialTypes", e);
      return [];
    }
  },
  getCoreMaterialBrands: async () => {
    try {
      return asArray(await axios.get("/corematerialbrands", auth()));
    } catch (e) {
      console.error("RatesService.getCoreMaterialBrands", e);
      return [];
    }
  },
  getFinishingCategories: async () => {
    try {
      return asArray(await axios.get("/finishingcategories", auth()));
    } catch (e) {
      console.error("RatesService.getFinishingCategories", e);
      return [];
    }
  },
  getFinishingBrands: async () => {
    try {
      return asArray(await axios.get("/finishingbrands", auth()));
    } catch (e) {
      console.error("RatesService.getFinishingBrands", e);
      return [];
    }
  },

  // ---- material rates (corematerialpricing) ----
  listMaterialRates: async () => {
    try {
      return asArray(
        await axios.get("/corematerialpricing", {
          params: { $limit: 1000 },
          ...auth(),
        })
      );
    } catch (e) {
      console.error("RatesService.listMaterialRates", e);
      return [];
    }
  },
  createMaterialRate: async (data: CoreMaterialPricing) => {
    const res = await axios.post("/corematerialpricing", data, auth());
    return ok(res) ? res.data : null;
  },
  updateMaterialRate: async (id: string, data: Partial<CoreMaterialPricing>) => {
    const res = await axios.patch(`/corematerialpricing/${id}`, data, auth());
    return ok(res) ? res.data : null;
  },
  removeMaterialRate: async (id: string) => {
    const res = await axios.delete(`/corematerialpricing/${id}`, auth());
    return ok(res);
  },

  // ---- coating rates (finishingpricing) ----
  listCoatingRates: async () => {
    try {
      return asArray(
        await axios.get("/finishingpricing", {
          params: { $limit: 1000 },
          ...auth(),
        })
      );
    } catch (e) {
      console.error("RatesService.listCoatingRates", e);
      return [];
    }
  },
  createCoatingRate: async (data: FinishingPricing) => {
    const res = await axios.post("/finishingpricing", data, auth());
    return ok(res) ? res.data : null;
  },
  updateCoatingRate: async (id: string, data: Partial<FinishingPricing>) => {
    const res = await axios.patch(`/finishingpricing/${id}`, data, auth());
    return ok(res) ? res.data : null;
  },
  removeCoatingRate: async (id: string) => {
    const res = await axios.delete(`/finishingpricing/${id}`, auth());
    return ok(res);
  },

  // ---- hardware master (hardware) ----
  listHardware: async () => {
    try {
      return asArray(
        await axios.get("/hardware", { params: { $limit: 1000 }, ...auth() })
      );
    } catch (e) {
      console.error("RatesService.listHardware", e);
      return [];
    }
  },
  createHardware: async (data: { name: string; price: number }) => {
    const res = await axios.post("/hardware", data, auth());
    return ok(res) ? res.data : null;
  },
  updateHardware: async (
    id: string,
    data: Partial<{ name: string; price: number }>
  ) => {
    const res = await axios.patch(`/hardware/${id}`, data, auth());
    return ok(res) ? res.data : null;
  },
  removeHardware: async (id: string) => {
    const res = await axios.delete(`/hardware/${id}`, auth());
    return ok(res);
  },

  // ---- global installation rate (settings, key = installationRatePerSqft) ----
  getInstallationRate: async (): Promise<number> => {
    try {
      const res = await axios.get("/settings/installationRatePerSqft", auth());
      return Number(res?.data?.value) || 0;
    } catch (e) {
      return 0; // not set yet
    }
  },
  setInstallationRate: async (
    value: number
  ): Promise<{ ok: boolean; error?: string }> => {
    const key = "installationRatePerSqft";
    const msgOf = (e: any) =>
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      "Unknown error";
    try {
      // Upsert the singleton settings row (_id = key).
      await axios.patch(`/settings/${key}`, { value }, auth());
      return { ok: true };
    } catch (e) {
      try {
        await axios.post("/settings", { _id: key, key, value }, auth());
        return { ok: true };
      } catch (e2) {
        // Surface the real backend error instead of hiding it, so a failed
        // save never looks successful in the UI.
        console.error("RatesService.setInstallationRate", e2);
        return { ok: false, error: msgOf(e2) };
      }
    }
  },
};
