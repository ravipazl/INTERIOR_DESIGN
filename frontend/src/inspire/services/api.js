import axios from "axios";

const _axios = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  validateStatus: (status) => status < 500,
});

_axios.interceptors.response.use(
  function (response) {
    if (response.status === 401 || response.status === 403) {
      localStorage.clear();
      window.location = `${window.location.origin}/signin`;
    }
    return response;
  },
  function (error) {
    if (error.response.status === 401 || error.response.status === 403) {
      localStorage.clear();
    }
    return Promise.reject(error);
  }
);

export default _axios;
