import { Finishing, Texture } from "../entities";
import axios from "./apiService";
import { AuthService } from "./authService";
import { v4 as uuidv4 } from "uuid";

export const TexturesService = {
  getAllTextures: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/textures", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug("texturesService.ts ~ getAllTextures ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getAllTextures ~ err:",
        err
      );
      return null;
    }
  },
  getAllCoreMaterialTypes: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/corematerialtypes", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "texturesService.ts ~ getAllCoreMaterialTypes ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getAllCoreMaterialTypes ~ err:",
        err
      );
      return null;
    }
  },
  getAllCoreMaterialBrands: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/corematerialbrands", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "texturesService.ts ~ getAllCoreMaterialBrands ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getAllCoreMaterialBrands ~ err:",
        err
      );
      return null;
    }
  },
  getAllFinishingCategories: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/finishingcategories", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "texturesService.ts ~ getAllFinishingCategories ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getAllFinishingCategories ~ err:",
        err
      );
      return null;
    }
  },
  getFinishingsByCategoryId: async (
    categoryId: string,
    finishingType: string
  ) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/finishings", {
        params: {
          "$and[0][categoryId]": categoryId,
          "$and[1][type]": finishingType,
        },
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "texturesService.ts ~ getFinishingsByCategoryId ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getFinishingsByCategoryId ~ err:",
        err
      );
      return null;
    }
  },
  getAllFinishings: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/finishings", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "texturesService.ts ~ getAllFinishings ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getAllFinishings ~ err:",
        err
      );
      return null;
    }
  },
  saveFinishingsToLocalStorage: (data: Finishing[]) => {
    localStorage.setItem("pazl-finishings", JSON.stringify(data));
  },
  getFinishingsFromLocalStorage: () => {
    const data = localStorage.getItem("pazl-finishings");
    if (data) {
      return JSON.parse(data);
    }
  },
  saveFinishingCategoriesToLocalStorage: (data: Texture[]) => {
    localStorage.setItem("pazl-finishing-categories", JSON.stringify(data));
  },
  getFinishingCategoriesFromLocalStorage: () => {
    const data = localStorage.getItem("pazl-finishing-categories");
    if (data) {
      return JSON.parse(data);
    }
  },
  saveCoreMaterialBrandsToLocalStorage: (data: Texture[]) => {
    localStorage.setItem("pazl-core-material-brands", JSON.stringify(data));
  },
  getCoreMaterialBrandsFromLocalStorage: () => {
    const data = localStorage.getItem("pazl-core-material-brands");
    if (data) {
      return JSON.parse(data);
    }
  },
  getAllTextureCategories: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await axios.get("/texturecategories", {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      console.debug(
        "texturesService.ts ~ getAllTextureCategories ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: texturesService.ts ~ getAllTextureCategories ~ err:",
        err
      );
      return null;
    }
  },
};
