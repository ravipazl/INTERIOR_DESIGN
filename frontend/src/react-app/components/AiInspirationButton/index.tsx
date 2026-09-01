import React, { useState } from "react";
import { InspirationService } from "../../services/InspirationService";
import { AuthService } from "../../services/authService";

/**
 * AiInspirationButton — a self-contained floating button that captures the
 * current 3D design, uploads it to the AI Inspiration app as an "input" image,
 * then opens the AI app so the user can style their ACTUAL room (instead of
 * having to upload a photo there). Mounted next to the Render button.
 *
 * Fully additive — styling is inline so it's robust to Tailwind purge.
 */
const AiInspirationButton: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get("projectId") || "";

      let userId = "";
      try {
        const u: any = await AuthService.getUser();
        userId = u?._id || u?.id || u?.data?._id || "";
      } catch (_) {
        /* userId is optional */
      }

      const res = await InspirationService.sendDesignToInspiration({
        projectId,
        userId,
      });

      if (res.ok) {
        const base = (process.env.REACT_APP_PAZL_INSPIRE_URL || "").replace(
          /\/$/,
          ""
        );
        window.location.href = `${base}/project-detail/${projectId}`;
      } else {
        setError(res.error || "Could not send to AI Inspiration");
        setBusy(false);
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        // Inline on the LEFT, in one row with Snap (left:16) and Render — sits
        // just to the right of the Snap pill at the same bottom level.
        left: 116,
        bottom: 16,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      {error && (
        <div
          style={{
            maxWidth: 260,
            padding: "6px 10px",
            borderRadius: 6,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={go}
        disabled={busy}
        title="Send your 3D design to AI Inspiration"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 20,
          border: "none",
          background: busy ? "#9ca3af" : "#7c3aed",
          color: "#fff",
          boxShadow: "0 4px 14px rgba(124,58,237,0.4)",
          cursor: busy ? "not-allowed" : "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 15 }}>✨</span>
        {busy ? "Sending design…" : "AI Inspiration"}
      </button>
    </div>
  );
};

export default AiInspirationButton;
