import axios from "axios";

export const AuthService = {
  getUser: async () => {
    try {
      const accessToken = localStorage.getItem("pazl-access-token");
      const response = await axios.get(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.debug("authService.ts ~ getUser ~ response", response);
      if (
        response?.data?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        localStorage.setItem(
          "pazl-current-user",
          JSON.stringify(response.data.data[0])
        );
        return response.data.data[0];
      }
      return null;
    } catch (err) {
      console.error("🚀 ~ file: authService.ts:24 ~ getUser ~ err:", err);
      return null;
    }
  },

  getUserById: async (userId: string) => {
    try {
      const accessToken = localStorage.getItem("pazl-access-token");
      const response = await axios.get(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.debug("authService.ts ~ getUserById ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error("🚀 ~ file: authService.ts:24 ~ getUserById ~ err:", err);
      return null;
    }
  },

  getUserByEmailId: async (emailId: string) => {
    try {
      const accessToken = localStorage.getItem("pazl-access-token");
      const response = await axios.get(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
        {
          params: {
            "$and[0][email]": emailId,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.debug("authService.ts ~ getUserByEmailId ~ response", response);
      if (
        response?.data?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        localStorage.setItem(
          "pazl-current-user",
          JSON.stringify(response.data.data[0])
        );
        return response.data.data[0];
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: authService.ts:24 ~ getUserByEmailId ~ err:",
        err
      );
      return null;
    }
  },

  getAllArchitectUsers: async () => {
    try {
      const accessToken = localStorage.getItem("pazl-access-token");
      const response = await axios.get(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
        {
          params: {
            "$and[0][permissions]": "architect",
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.debug(
        "authService.ts ~ getAllArchitectUsers ~ response",
        response
      );
      if (
        response?.data?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        return response.data.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: authService.ts:24 ~ getAllArchitectUsers ~ err:",
        err
      );
      return null;
    }
  },

  // The admin users (permissions === "admin") — used to show the real admin
  // recipients on the architect's "Send to admin" composer. Same shape/endpoint
  // as getAllArchitectUsers. Returns [] on failure so the caller can fall back.
  getAllAdminUsers: async () => {
    try {
      const accessToken = localStorage.getItem("pazl-access-token");
      const response = await axios.get(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
        {
          params: {
            "$and[0][permissions]": "admin",
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (
        response?.data?.data?.length &&
        response?.status >= 200 &&
        response?.status < 300
      ) {
        return response.data.data;
      }
      return [];
    } catch (err) {
      console.error(
        "🚀 ~ file: authService.ts ~ getAllAdminUsers ~ err:",
        err
      );
      return [];
    }
  },

  signOut: () => {
    localStorage.removeItem("pazl-current-user");
    localStorage.removeItem("pazl-access-token");
  },

  getAccessToken: () => {
    return localStorage.getItem("pazl-access-token");
  },

  setAccessToken: (token: string) => {
    return localStorage.setItem("pazl-access-token", token);
  },

  getCurrentProjectId: () => {
    return localStorage.getItem("pazl-current-project-id");
  },

  setCurrentProjectId: (id: string) => {
    return localStorage.setItem("pazl-current-project-id", id);
  },

  getCurrentUser: () => {
    const user = localStorage.getItem("pazl-current-user");
    return user ? JSON.parse(user) : null;
  },

  clearsessionStorage: () => {
    return localStorage.clear();
  },
};
