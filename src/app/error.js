"use client";

import { useEffect } from "react";
import { clientLog } from "@/lib/observability/client-log";

export default function Error({ error, reset }) {
  useEffect(() => {
    clientLog("error", "app_route_error", {
      message: error?.message,
      digest: error?.digest,
    });
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "24px 20px max(32px, env(safe-area-inset-bottom))",
        background: "#0a0a0a",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 11,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "rgba(0, 220, 210, 0.75)",
        }}
      >
        2MRRW
      </p>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: 0.04 }}>
        Something went wrong
      </h1>
      <p style={{ margin: 0, maxWidth: 360, fontSize: 14, lineHeight: 1.5, color: "#888" }}>
        The page hit an unexpected error. You can try again without leaving the app.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          marginTop: 8,
          padding: "12px 28px",
          borderRadius: 10,
          border: "1px solid rgba(0, 220, 210, 0.45)",
          background: "rgba(0, 220, 210, 0.12)",
          color: "#00dcd2",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
