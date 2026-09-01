import React from "react";

// The app's single toast look (originally inline in TrackerAdmin). Shared so
// every screen shows the SAME success/error toast instead of its own variant.
export type ToastState = { type: "success" | "error"; text: string } | null;

const Toast: React.FC<{ toast: ToastState }> = ({ toast }) => {
  if (!toast) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 11000,
        background: toast.type === "success" ? "#0F6E56" : "#b91c1c",
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
      <span style={{ fontSize: 15 }}>
        {toast.type === "success" ? "✓" : "⚠"}
      </span>
      <span>{toast.text}</span>
    </div>
  );
};

export default Toast;
