import { Category } from "../entities";
import axios from "./apiService";
import { AuthService } from "./authService";

export const CategoriesService = {
  getAllCategories: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/categories", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "categoriesService.ts ~ getAllCategories ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: categoriesService.js:32 ~ getAllCategories ~ err:",
        err
      );
      return null;
    }
  },
  getCategoryById: async (id: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get(`/categories/${id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "categoriesService.ts ~ getCategoryById ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: categoriesService.js:32 ~ getCategoryById ~ err:",
        err
      );
      return null;
    }
  },
  saveCategoriesToLocalStorage: (data: Category[]) => {
    localStorage.setItem("pazl-items-categories", JSON.stringify(data));
  },
  getCategoriesFromLocalStorage: () => {
    const data = localStorage.getItem("pazl-items-categories");
    if (data) {
      return JSON.parse(data);
    }
  },

  /**
   * Create a new category. Pass parentCategoryId=null for a main category, or
   * the _id of an existing main category to nest a sub-category beneath it.
   * Backend rejects duplicates via Mongo unique index? No — we check on the
   * frontend before calling. Backend validators only enforce required fields.
   */
  createCategory: async (input: {
    name: string;
    parentCategoryId: string | null;
  }) => {
    const accessToken = AuthService.getAccessToken();
    const payload = {
      name: input.name.trim(),
      parentCategoryId: input.parentCategoryId,
      invisible: false,
      thumbnail: "",
    };
    const response = await axios.post("/categories", payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response?.status < 200 || response?.status >= 300) {
      const msg =
        response?.data?.message ||
        response?.data?.error ||
        `HTTP ${response?.status} from /categories`;
      throw new Error(msg);
    }
    return response.data;
  },

  /**
   * Refetch all categories from the API and overwrite the localStorage cache.
   * Call after creating a category so the catalog tree picks up the new entry
   * on the next render without a full page reload.
   */
  refreshCategoriesCache: async () => {
    const resp = await CategoriesService.getAllCategories();
    const data = resp?.data ?? resp;
    if (Array.isArray(data) && data.length) {
      CategoriesService.saveCategoriesToLocalStorage(data);
    }
    return data;
  },
};
