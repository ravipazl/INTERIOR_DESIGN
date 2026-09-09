import axios from "axios";

/**
 * Serialise query params the way the Feathers backend expects.
 *
 * axios 0.x turns a NESTED param into JSON in the URL:
 *
 *     { $sort: { createdAt: -1 } }   ->   $sort={"createdAt":-1}
 *
 * The server (qs) then reads `$sort` as a STRING, the projects query schema
 * expects an object, validation fails, and the whole request comes back 400.
 * That is what stopped the admin Projects list loading.
 *
 * Feathers wants bracket notation instead:
 *
 *     $sort[createdAt]=-1
 *
 * Doing it here fixes every caller at once. Call sites that already hand-wrote
 * the flattened form (e.g. `"$sort[createdAt]": -1` in projectWorkspaceService)
 * keep working unchanged — a flat string key with a primitive value serialises
 * to exactly the same thing.
 *
 * Written out rather than pulling in `qs`: qs is only present transitively here,
 * so depending on it directly would break on a clean install with a different
 * dependency tree.
 */
function serializeParams(params) {
  const parts = [];
  const add = (key, value) => {
    if (value === undefined || value === null) return; // omit, don't send "null"
    if (value instanceof Date) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.toISOString())}`);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => add(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => add(`${key}[${k}]`, v));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  };
  Object.entries(params || {}).forEach(([k, v]) => add(k, v));
  return parts.join("&");
}

const _axios = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  validateStatus: (status) => status < 500,
  paramsSerializer: serializeParams,
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
