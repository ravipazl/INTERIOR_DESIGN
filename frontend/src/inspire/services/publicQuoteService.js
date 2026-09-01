import axios from "axios";

/**
 * publicQuoteService — fetch the client's LOGIN-FREE quote bundle by its share
 * token. The endpoint (design backend /public-quote/:token) is fully public, so
 * this sends NO Authorization header. Returns the bundle, or { error }.
 */

const DESIGN = process.env.REACT_APP_PAZL_DESIGN_API_BASE_URL;

const msg = (e, fallback) =>
  e?.response?.status === 404
    ? "This quote link is invalid or has expired."
    : e?.response?.data?.message || e?.message || fallback;

export const getPublicQuote = async (token) => {
  if (!token) return { error: "This quote link is missing its code." };
  try {
    const res = await axios.get(
      `${DESIGN}/public-quote/${encodeURIComponent(token)}`
    );
    return res?.data || { error: "No response from the server." };
  } catch (e) {
    return { error: msg(e, "Sorry — we couldn't load your quote.") };
  }
};

// Accept the quote from the public page (no login). Records acceptance + emails
// the team.
export const acceptPublicQuote = async (token) => {
  try {
    const res = await axios.post(
      `${DESIGN}/public-quote/${encodeURIComponent(token)}/accept`
    );
    return res?.data?.ok ? { ok: true } : { error: "Could not accept the quote." };
  } catch (e) {
    return { error: msg(e, "Could not accept the quote. Please try again.") };
  }
};

// Request a change from the public page (no login). Creates a change request +
// emails the team; the admin then sends a revised quote.
export const requestPublicChange = async (token, note) => {
  try {
    const res = await axios.post(
      `${DESIGN}/public-quote/${encodeURIComponent(token)}/change`,
      { note }
    );
    return res?.data?.ok ? { ok: true } : { error: "Could not send your change request." };
  } catch (e) {
    return { error: msg(e, "Could not send your change request. Please try again.") };
  }
};

// Reject the quote from the public page (no login). Marks it rejected + emails
// the team, who can then send a revised quote or close the project. The reason
// is optional.
export const rejectPublicQuote = async (token, reason) => {
  try {
    const res = await axios.post(
      `${DESIGN}/public-quote/${encodeURIComponent(token)}/reject`,
      { reason: reason || "" }
    );
    return res?.data?.ok ? { ok: true } : { error: "Could not reject the quote." };
  } catch (e) {
    return { error: msg(e, "Could not reject the quote. Please try again.") };
  }
};
