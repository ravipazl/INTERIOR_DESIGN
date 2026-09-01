import axios from "axios";

export const getAccessToken = () => {
  return localStorage.getItem("pazl-access-token");
};

export const getCurrentUser = () => {
  const user = localStorage.getItem("pazl-current-user");
  return user ? JSON.parse(user) : null;
};

const AUTH_BASE = () => process.env.REACT_APP_AUTH_SERVICE_BASE_URL;

// --- Invite / set-password ---------------------------------------------------
// Replaces "admin types a password and shares it". The admin only supplies an
// email + role; the person sets their own password from an emailed one-time
// link. Backed by the auth-backend `invite` service.

// ADMIN ONLY. Creates the account with NO password and emails the invite link.
// `permissions` is 'client' | 'architect' | 'admin' (the backend maps
// client -> 'user'). Requires the caller's admin token — the backend forces
// 'user' for anyone who can't prove they're an admin.
export const inviteUser = async ({ email, name, permissions }) => {
  try {
    const { data } = await axios.post(
      `${AUTH_BASE()}/invite`,
      { email, name, permissions },
      { headers: { Authorization: `Bearer ${getAccessToken()}` } }
    );
    return data;
  } catch (err) {
    return err?.response?.data || { message: "Could not send the invite." };
  }
};

// PUBLIC. The emailed token IS the credential, so no auth header here.
export const setPassword = async (token, password) => {
  try {
    const { data } = await axios.patch(`${AUTH_BASE()}/invite`, {
      token,
      password,
    });
    return data;
  } catch (err) {
    return (
      err?.response?.data || {
        message: "This link is invalid or has expired. Please ask for a new one.",
      }
    );
  }
};

// PUBLIC "forgot password". Always resolves the same way — the backend never
// reveals whether an email exists, so we must not either.
export const requestPasswordReset = async (email) => {
  try {
    await axios.post(`${AUTH_BASE()}/invite`, { reset: true, email });
  } catch (err) {
    // swallow — reporting failure here would leak which emails exist
  }
  return { success: true };
};

export default class AuthService {
  static fetchedTeamMembers = false;
  static accessToken = "";

  constructor() {
    this.teamMembers = [];
    this.allArchitects = [];
    this.accessToken = `Bearer ${this.getAccessToken}`;
  }

  async signIn(credentials) {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/authentication`,
        {
          ...credentials,
          strategy: "local",
        }
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        if (response.data.accessToken) {
          this.setAccessToken(response.data.accessToken);
        }
        if (response.data.user) {
          this.saveCurrentUser({
            ...response.data.user,
          });
          return {
            ...response.data.user,
            accessToken: response.data.accessToken,
          };
        }
        return null;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  async signUp(credentials) {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
        credentials
      );
      console.log(
        "🚀 ~ file: authService.js:33 ~ signUp ~ response:",
        response
      );
      if (response?.status >= 200 && response?.status < 300) {
        const res = await this.signIn(credentials);
        return res;
      }
    } catch (err) {
      console.log("🚀 ~ file: authService.js:38 ~ signUp ~ err:", err);
      return err.response;
    }
  }

  async getTeamMembers(refresh = false) {
    if (refresh || !this.fetchedTeamMembers) {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
          {
            headers: {
              Authorization: this.accessToken,
            },
          }
        );
        if (
          response?.data &&
          response?.status >= 200 &&
          response?.status < 300
        ) {
          this.teamMembers = response?.data;
          return response.data;
        }

        return null;
      } catch (err) {
        console.log(
          "🚀 ~ file: authService.js:38 ~ getTeamMembers ~ err:",
          err
        );
        return null;
      } finally {
        this.fetchedTeamMembers = true;
      }
    } else {
      return this.teamMembers;
    }
  }

  async getAllArchitects(refresh = false) {
    if (refresh || !this.fetchedTeamMembers) {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
          {
            params: {
              "[$and][0][permissions]": "architect",
            },
            headers: {
              Authorization: this.accessToken,
            },
          }
        );
        if (
          response?.data &&
          response?.status >= 200 &&
          response?.status < 300
        ) {
          this.allArchitects = response?.data;
          return response.data;
        }
        return null;
      } catch (err) {
        console.log(
          "🚀 ~ file: authService.js:38 ~ getAllArchitects ~ err:",
          err
        );
        return null;
      } finally {
        this.fetchedTeamMembers = true;
      }
    }
  }

  async createUser(data) {
    //console.log('data', data);
    try {
      // Admin "create member with a role" flow. The token proves this is an
      // admin so the backend will honour the requested `permissions`; without
      // it the backend forces 'user' (see auth-backend users.js create hook).
      const accessToken = getAccessToken();
      const response = await axios.post(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users`,
        data,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.log("🚀 ~ file: authService.js:38 ~ createUser ~ err:", err);
      return err.response;
    }
  }

  async updateUser(userId, data) {
    try {
      const accessToken = getAccessToken();
      const response = await axios.patch(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users/${userId}`,
        {
          ...data,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.log("🚀 ~ file: authService.js:38 ~ deleteUser ~ err:", err);
      return null;
    }
  }

  async deleteUser(userId) {
    try {
      //console.log('userId', userId);
      const accessToken = getAccessToken();
      const response = await axios.delete(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      //console.log('responseUSER', response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.log("🚀 ~ file: authService.js:38 ~ deleteUser ~ err:", err);
      return null;
    }
  }

  async signInGuestUser() {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_AUTH_SERVICE_BASE_URL}/authentication`,
        {
          strategy: "anonymous",
        }
      );
      console.log(
        "🚀 ~ file: authService.js:214 ~ AuthService ~ signInGuestUser ~ response:",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        if (response.data.accessToken) {
          this.setAccessToken(response.data.accessToken);
          return {
            ...response.data,
          };
        }
        return null;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  signOut() {
    localStorage.removeItem("pazl-current-user");
    localStorage.removeItem("pazl-access-token");
  }

  get getAccessToken() {
    return localStorage.getItem("pazl-access-token");
  }

  setAccessToken(token) {
    return localStorage.setItem("pazl-access-token", token);
  }

  saveCurrentUser(user) {
    return localStorage.setItem("pazl-current-user", JSON.stringify(user));
  }

  getCurrentUser() {
    const user = localStorage.getItem("pazl-current-user");
    return user ? JSON.parse(user) : null;
  }

  clearsessionStorage() {
    return localStorage.clear();
  }
}
