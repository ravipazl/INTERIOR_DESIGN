import axios from "axios";
import { getAccessToken } from "./authService";

/**
 * deviceLoginService — approve the code a headset (the Pazl HoloLens app)
 * shows, so it signs in as you without anyone typing on its keyboard. The
 * backend's `device-login` service holds the codes; approving needs your
 * website sign-in.
 */
const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

// "k7p 2qm", "K7P-2QM" → "K7P2QM"
export const cleanCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const approveHeadsetCode = async (code) => {
  try {
    const res = await axios.patch(
      `${DESIGN}/device-login/${cleanCode(code)}`,
      {},
      { headers: { Authorization: `Bearer ${getAccessToken()}` } }
    );
    return res.data;
  } catch (e) {
    const msg = e?.response?.data?.message;
    throw new Error(msg || "Could not connect. Check the code and try again.");
  }
};
