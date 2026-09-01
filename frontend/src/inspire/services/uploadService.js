// Image upload helper — POSTs a file directly to the backend's /upload
// endpoint (multipart/form-data). Replaces the old "get presigned URL → PUT
// to DigitalOcean Spaces" flow now that images are hosted server-side.
//
// Returns the same { key } shape the caller already saves to MongoDB, so
// the existing image-record code paths keep working unchanged.

import axios from "./api";
import { getAccessToken } from "./authService";

// Upload a single image file. `file` is a Blob/File. `onProgress` is an
// optional callback called with a 0–100 number during the upload.
//
// Returns: { key, url, size, mimetype, originalName } on success, or null.
export const uploadImage = async (file, onProgress) => {
  try {
    const accessToken = getAccessToken();
    const formData = new FormData();
    formData.append("file", file, file.name || "upload");
    const response = await axios.post("/upload", formData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Don't set Content-Type — let axios add the multipart boundary.
      },
      onUploadProgress: (evt) => {
        if (onProgress && evt.total) {
          onProgress(Math.round((evt.loaded * 100) / evt.total));
        }
      },
    });
    if (response?.data && response.status >= 200 && response.status < 300) {
      return response.data;
    }
    return null;
  } catch (error) {
    return null;
  }
};

// Backwards-compat shim — kept so any caller still using the old name
// keeps compiling. It now performs the actual multipart upload instead of
// returning a presigned URL. Callers that need the new behaviour should
// migrate to `uploadImage(file, onProgress)`.
export const getPreSignedUrlToUpload = uploadImage;
