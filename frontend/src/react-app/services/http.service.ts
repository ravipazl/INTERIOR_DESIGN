import axios from "axios";

const axiosInstance = axios.create({
  baseURL: "http://localhost:5001",
});

// we need to write interceptors if required wil write it once api is completed

export default axiosInstance;
