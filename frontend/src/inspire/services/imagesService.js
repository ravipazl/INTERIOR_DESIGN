import axios from "./api";
import { getAccessToken } from "./authService";

// export const saveImageInfo = async (data) => {
//   try {
//     const accessToken = getAccessToken();
//     const response = await axios.post(
//       "/images",
//       { ...data },
//       {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//         },
//       }
//     );
//     if (response?.data && response?.status >= 200 && response?.status < 300) {
//       return response.data;
//     }
//     return null;
//   } catch (err) {
//     return null;
//   }
// };

// export const getImages = async (projectID, isGuestUser) => {
//   return getImagesByType(projectID, "input", isGuestUser);
// };

// export const getGeneratedImages = async (projectID, isGuestUser) => {
//   return await getImagesByType(projectID, "generated", isGuestUser);
// };

// export const getImagesByType = async (projectID, imageType, isGuestUser) => {
//   try {
//     const accessToken = getAccessToken();
//     const response = await axios.get("/images", {
//       params: {
//         "$and[0][imageType]": imageType,
//         "$and[1][projectID]": projectID,
//       },
//       headers: isGuestUser
//         ? {
//             Authorization: `Bearer ${accessToken}`,
//             "user-type": "anonymous",
//           }
//         : {
//             Authorization: `Bearer ${accessToken}`,
//           },
//     });

//     if (response?.data && response?.status >= 200 && response?.status < 300) {
//       return response.data;
//     }
//     return null;
//   } catch (err) {
//     return null;
//   }
// };

export const getFavoriteImages = async (projectID) => {
  try {
    const accessToken = getAccessToken();
    const response = await axios.get("/images", {
      params: {
        "$and[0][isFavorite]": true,
        "$and[1][projectID]": projectID,
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

export const getFavoriteImagesCount = async (projectID) => {
  try {
    const accessToken = getAccessToken();
    const response = await axios.get("/images", {
      params: {
        "$and[0][isFavorite]": true,
        "$and[1][projectID]": projectID,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response?.data && response?.status >= 200 && response?.status < 300) {
      return response.data.total; // Use total property to get the count
    }
    return null;
  } catch (err) {
    return null;
  }
};

// export const getHistoryCount = async (projectID) => {
//   return await getImagesCountByType(projectID, "generated");
// };

// export const getImagesCountByType = async (projectID, imageType) => {
//   try {
//     const accessToken = getAccessToken();
//     const response = await axios.get("/images", {
//       params: {
//         "$and[0][imageType]": imageType,
//         "$and[1][projectID]": projectID,
//       },
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//       },
//     });
//     console.log(
//       "🚀 ~ file: imagesService.js:119 ~ getImagesCountByType ~ response:",
//       response
//     );

//     if (response?.data && response?.status >= 200 && response?.status < 300) {
//       console.log(
//         "🚀 ~ file: imagesService.js:122 ~ getImagesCountByType ~ response.data.total:",
//         response.data.total
//       );

//       return response.data.total; // Use total property to get the count
//     }
//     return null;
//   } catch (err) {
//     return null;
//   }
// };

// export const updateImageInfo = async (imageId, data) => {
//   try {
//     const accessToken = getAccessToken();
//     const response = await axios.patch(
//       `/images/${imageId}`,
//       {
//         ...data,
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//         },
//       }
//     );
//     if (response?.data && response?.status >= 200 && response?.status < 300) {
//       return response.data;
//     }
//     return null;
//   } catch (err) {
//     return null;
//   }
// };

// export const deleteImageInfo = async (imageId) => {
//   try {
//     const accessToken = getAccessToken();
//     const response = await axios.delete(`/images/${imageId}`, {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//       },
//     });

//     if (response?.data && response?.status >= 200 && response?.status < 300) {
//       return response.data;
//     }
//     return null;
//   } catch (err) {
//     return null;
//   }
// };

// export const getAIImages = async (data) => {
//   try {
//     const accessToken = getAccessToken();
//     const response = await axios.post(
//       "/generator",
//       { ...data },
//       {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//         },
//       }
//     );
//     if (response?.data && response?.status >= 200 && response?.status < 300) {
//       return response.data;
//     }
//     return null;
//   } catch (err) {
//     return null;
//   }
// };

export default class ImagesServices {
  static fetchedUploadedImages = false;
  static fetchedGeneratedImages = false;
  static fetchedHistoryCount = false;
  static accessToken = ""

  constructor() {
    this.accessToken = `Bearer ${getAccessToken()}`;
    this.uploadedImages = [];
    this.generatedImages = [];
    this.HistoryCount = [];

  }

  async saveImageInfo(data) {
    try {
      // const accessToken = getAccessToken();
      const response = await axios.post(
        "/images",
        { ...data },
        {
          headers: {
            Authorization: this.accessToken,
          },
        }
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  async getImages(projectID, isGuestUser, refresh = false) {
    try {
      if (refresh || !this.fetchedUploadedImages) {
        this.uploadedImages = await this.getImagesByType(projectID, "input", isGuestUser);
      }
      return this.uploadedImages;
    } catch (err) {
      console.error("Error while fetching images:", err);
      throw err;
    } finally {
      this.fetchedUploadedImages = true;
    }
  };

  async getGeneratedImages(projectID, isGuestUser, refresh = false) {
    try {
      if (refresh || !this.fetchedGeneratedImages) {
        this.generatedImages = await this.getImagesByType(projectID, "generated", isGuestUser);
      }
      return this.generatedImages;
    } catch (err) {
      console.error("Error while fetching images:", err);
      throw err;
    } finally {
      this.fetchedGeneratedImages = true;
    }
  };

  async getImagesByType(projectID, imageType, isGuestUser) {
    try {
      const accessToken = getAccessToken();
      const response = await axios.get("/images", {
        params: {
          "$and[0][imageType]": imageType,
          "$and[1][projectID]": projectID,
        },
        headers: isGuestUser
          ? {
            Authorization: accessToken,
            "user-type": "anonymous",
          }
          : {
            Authorization: accessToken,
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

  // async getFavoriteImages(projectID){
  //   try {
  //     // const accessToken = getAccessToken();
  //     const response = await axios.get("/images", {
  //       params: {
  //         "$and[0][isFavorite]": true,
  //         "$and[1][projectID]": projectID,
  //       },
  //       headers: {
  //         Authorization: this.accessToken,
  //       },
  //     });

  //     if (response?.data && response?.status >= 200 && response?.status < 300) {
  //       return response.data;
  //     }
  //     return null;
  //   } catch (err) {
  //     return null;
  //   }
  // };

  // async getFavoriteImagesCount(projectID){
  //   try {
  //     // const accessToken = getAccessToken();
  //     const response = await axios.get("/images", {
  //       params: {
  //         "$and[0][isFavorite]": true,
  //         "$and[1][projectID]": projectID,
  //       },
  //       headers: {
  //         Authorization: this.accessToken,
  //       },
  //     });

  //     if (response?.data && response?.status >= 200 && response?.status < 300) {
  //       return response.data.total; // Use total property to get the count
  //     }
  //     return null;
  //   } catch (err) {
  //     return null;
  //   }
  // };

  async getHistoryCount(projectID, refresh = false) {
    try {
      if (refresh || !this.fetchedHistoryCount) {
        this.HistoryCount = await this.getImagesCountByType(projectID, "generated");
      }
      return this.HistoryCount;
    }
    catch (err) {
      console.error("Error while fetching images:", err);
      throw err;
    } finally {
      this.fetchedHistoryCount = true;
    }
  };

  async getImagesCountByType(projectID, imageType) {
    try {
      // const accessToken = getAccessToken();
      const response = await axios.get("/images", {
        params: {
          "$and[0][imageType]": imageType,
          "$and[1][projectID]": projectID,
        },
        headers: {
          Authorization: this.accessToken,
        },
      });
      console.log(
        "🚀 ~ file: imagesService.js:119 ~ getImagesCountByType ~ response:",
        response
      );

      if (response?.data && response?.status >= 200 && response?.status < 300) {
        console.log(
          "🚀 ~ file: imagesService.js:122 ~ getImagesCountByType ~ response.data.total:",
          response.data.total
        );

        return response.data.total; // Use total property to get the count
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  async updateImageInfo(imageId, data) {
    try {
      const accessToken = getAccessToken();
      const response = await axios.patch(
        `/images/${imageId}`,
        {
          ...data,
        },
        {
          headers: {
            Authorization: this.accessToken,
          },
        }
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  async deleteImageInfo(imageId) {
    try {
      // const accessToken = getAccessToken();
      const response = await axios.delete(`/images/${imageId}`, {
        headers: {
          Authorization: this.accessToken,
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

  async getAIImages(data) {
    try {
      // const accessToken = getAccessToken();
      const response = await axios.post(
        "/generator",
        { ...data },
        {
          headers: {
            Authorization: this.accessToken,
          },
        }
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      return null;
    }
  };
}