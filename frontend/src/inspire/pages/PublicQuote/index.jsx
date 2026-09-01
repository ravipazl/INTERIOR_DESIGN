import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Spinner, Form } from "react-bootstrap";
import {
  getPublicQuote,
  acceptPublicQuote,
  requestPublicChange,
  rejectPublicQuote,
} from "../../services/publicQuoteService";
import RendersVideos from "../ProjectDetail/RendersVideos";
import BoqView from "../../components/BoqView";
import pazlLogo from "../../assets/images/pazl_logo.svg";

/**
 * PublicQuote — the client's LOGIN-FREE quote page, opened from the email link
 * (/quote/:token). Fetches one public bundle (renders/videos + BOQ snapshot) by
 * the unguessable token and renders it. The client can ACCEPT or REQUEST A
 * CHANGE right here — no login — which triggers the same team notifications the
 * in-app flow does.
 */
function PublicQuote() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Action state.
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState(null); // "accepted" | "change" | "rejected" | null
  const [showChange, setShowChange] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [actErr, setActErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const res = await getPublicQuote(token);
      if (cancelled) return;
      if (res?.error) setError(res.error);
      else setData(res);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);


  const centered = (node) => (
    <div
      className="d-flex flex-column align-items-center justify-content-center text-center"
      style={{ minHeight: "70vh", padding: "0 20px" }}
    >
      {node}
    </div>
  );

  if (loading) {
    return centered(
      <div>
        <Spinner animation="border" size="sm" className="me-2" />
        Loading your quotation…
      </div>
    );
  }
  if (error) {
    return centered(
      <div>
        <img src={pazlLogo} alt="PAZL" width={56} height={56} />
        <p className="mt-3" style={{ color: "#b91c1c", maxWidth: 420 }}>
          {error}
        </p>
      </div>
    );
  }

  const project = data?.project || {};
  const status = data?.status;
  const changePending = data?.changeRequestPending;

  const doAccept = async () => {
    setActing(true);
    setActErr("");
    const r = await acceptPublicQuote(token);
    setActing(false);
    if (r.ok) setDone("accepted");
    else setActErr(r.error);
  };
  const doChange = async () => {
    if (!note.trim()) {
      setActErr("Please describe the change you want.");
      return;
    }
    setActing(true);
    setActErr("");
    const r = await requestPublicChange(token, note.trim());
    setActing(false);
    if (r.ok) setDone("change");
    else setActErr(r.error);
  };
  const doReject = async () => {
    setActing(true);
    setActErr("");
    const r = await rejectPublicQuote(token, reason.trim());
    setActing(false);
    if (r.ok) setDone("rejected");
    else setActErr(r.error);
  };

  const banner = (bg, border, color, text) => (
    <div
      className="mt-4 p-3 rounded text-center"
      style={{ background: bg, border: `1px solid ${border}`, color, fontSize: 14 }}
    >
      {text}
    </div>
  );

  // What to show under the quote: a confirmation, or the accept / change actions.
  let actionArea;
  if (done === "accepted" || status === "quotation_accepted") {
    actionArea = banner(
      "#f0fdf4",
      "#bbf7d0",
      "#166534",
      "✓ You've accepted this quotation. Thank you — our team will be in touch shortly."
    );
  } else if (done === "rejected" || status === "quotation_rejected") {
    actionArea = banner(
      "#fef2f2",
      "#fecaca",
      "#991b1b",
      "You've declined this quotation. Our team has been notified and will be in touch."
    );
  } else if (done === "change" || changePending) {
    actionArea = banner(
      "#fff7ed",
      "#fed7aa",
      "#9a3412",
      "✓ Your change request has been received. We'll send you a revised quotation shortly."
    );
  } else if (status === "closed") {
    actionArea = banner("#f3f4f6", "#e5e7eb", "#374151", "This project is completed.");
  } else {
    actionArea = (
      <div
        className="mt-4 p-3 rounded"
        style={{ background: "#eef6ff", border: "1px solid #d6e4f5" }}
      >
        {showChange ? (
          <div>
            <div style={{ color: "#1f2033", fontSize: 14, fontWeight: 600 }}>
              What would you like changed?
            </div>
            <Form.Control
              as="textarea"
              rows={3}
              className="mt-2"
              placeholder="Describe the change you'd like…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={acting}
            />
            <div className="d-flex justify-content-end gap-2 mt-2">
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setShowChange(false);
                  setNote("");
                  setActErr("");
                }}
                disabled={acting}
              >
                Cancel
              </Button>
              <Button onClick={doChange} disabled={acting} variant="primary">
                {acting ? "Sending…" : "Send change request"}
              </Button>
            </div>
          </div>
        ) : showReject ? (
          <div>
            <div style={{ color: "#1f2033", fontSize: 14, fontWeight: 600 }}>
              Reject this quotation?
            </div>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: 2 }}>
              You can tell us why (optional) — it helps us improve.
            </div>
            <Form.Control
              as="textarea"
              rows={3}
              className="mt-2"
              placeholder="Reason for rejecting (optional)…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={acting}
            />
            <div className="d-flex justify-content-end gap-2 mt-2">
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setShowReject(false);
                  setReason("");
                  setActErr("");
                }}
                disabled={acting}
              >
                Cancel
              </Button>
              <Button onClick={doReject} disabled={acting} variant="danger">
                {acting ? "Rejecting…" : "Confirm reject"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span style={{ color: "#1f2033", fontSize: 14 }}>
              Happy with this quotation, or want a change?
            </span>
            <div className="d-flex flex-wrap gap-2">
              <Button
                variant="outline-danger"
                onClick={() => {
                  setShowReject(true);
                  setActErr("");
                }}
                disabled={acting}
              >
                Reject
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setShowChange(true);
                  setActErr("");
                }}
                disabled={acting}
              >
                Request a change
              </Button>
              <Button
                onClick={doAccept}
                disabled={acting}
                style={{ background: "#059669", borderColor: "#059669" }}
              >
                {acting ? "Accepting…" : "Accept quote"}
              </Button>
            </div>
          </div>
        )}
        {actErr ? (
          <div className="mt-2" style={{ color: "#b91c1c", fontSize: 13 }}>
            {actErr}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    // Own full-height scroll container — the Inspire app locks body scrolling
    // globally, so this long public page must scroll inside its own div.
    <div style={{ height: "100vh", overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 16px 72px" }}>
      {/* Public header — brand + project. */}
      <div
        className="d-flex flex-wrap align-items-center py-3 mb-2"
        style={{ borderBottom: "1px solid #ececf1", gap: 12 }}
      >
        <img src={pazlLogo} alt="PAZL" width={48} height={48} />
        <div>
          <div style={{ fontWeight: 700, color: "#414063", fontSize: 16 }}>
            {project.name || "Your quotation"}
          </div>
          <div style={{ fontSize: 12, color: "#8a8d9f" }}>
            Prepared for {project.clientName || "you"}
          </div>
        </div>
      </div>

      {/* Renders & videos gallery (published deliverables). */}
      <RendersVideos
        prefetched={{ renders: data.renders || [], videos: data.videos || [] }}
      />

      {/* The Bill of Quantity (snapshot taken when the quote was sent). */}
      <div className="mt-4">
        <BoqView
          project={project}
          quoteNumber={data.quoteNumber}
          prefetched={{
            items: data.boqItems || [],
            installRate: data.installRate || 0,
            pdfUrl: "",
          }}
        />
      </div>

      {/* Accept / Request-a-change — decided right here, no login. Sticky to the
          bottom of the screen so the decision buttons stay visible instead of
          being buried under the (long) BOQ. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 20,
          background: "#fff",
          boxShadow: "0 -8px 20px rgba(0,0,0,0.08)",
          paddingBottom: 6,
        }}
      >
        {actionArea}
      </div>
      </div>
    </div>
  );
}

export default PublicQuote;
