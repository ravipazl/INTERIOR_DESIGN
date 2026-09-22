import React from "react";

// The app's single toast look (originally inline in TrackerAdmin). Shared so
// every screen shows the SAME success/error toast instead of its own variant.
// "info" = neutral progress note (e.g. "Reading plan…"); success/error as before.
export type ToastState =
  | { type: "success" | "error" | "info"; text: string }
  | null;

// `top` (px) lets a screen with a top toolbar drop the toast below it so it
// doesn't cover the toolbar's buttons. Default 20 = unchanged everywhere else.
const Toast: React.FC<{ toast: ToastState; top?: number }> = ({
  toast,
  top = 20,
}) => {
  if (!toast) return null;
  return (
    <div
      style={{
        position: "fixed",
        top,
        right: 20,
        zIndex: 11000,
        background:
          toast.type === "success"
            ? "#0F6E56"
            : toast.type === "info"
            ? "#414063"
            : "#b91c1c",
        color: "#fff",
        padding: "12px 16px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: 360,
      }}
    >
      <span style={{ fontSize: 15 }} aria-hidden="true">
        {toast.type === "success" ? "✓" : toast.type === "info" ? "…" : "⚠"}
      </span>
      <span>{toast.text}</span>
    </div>
  );
};

export default Toast;
