import axios from "axios";

const _axios = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  validateStatus: (status) => status < 500,
});

_axios.interceptors.response.use(
  function (response) {
    if (response.status === 401 || response.status === 403) {
      localStorage.clear();
      window.location.reload();
    }
    return response;
  },
  function (error) {
    // No response at all (network error / timeout): keep the original error so
    // the caller can tell the user what happened, instead of crashing here.
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      localStorage.clear();
    }
    return Promise.reject(error);
  }
);

export default _axios;
