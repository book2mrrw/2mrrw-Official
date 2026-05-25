"use client";

import Link from "next/link";
import { memo, useCallback } from "react";

const WRAP_STYLE = {
  marginTop: 8,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid rgba(0,255,255,0.25)",
  background: "rgba(0,255,255,0.06)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const BTN_BASE = {
  flex: 1,
  minWidth: 120,
  padding: "10px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

function PreviewEndedCTA({ priceLabel, showPurchase, onContinueListening, onUnlock }) {
  const handleUnlock = useCallback(() => {
    onUnlock?.();
  }, [onUnlock]);

  if (!showPurchase) return null;

  return (
    <div className="modal-immersive-preview-unlock" role="status" style={WRAP_STYLE}>
      <p style={{ margin: 0, fontSize: 12, color: "#aaa", lineHeight: 1.5 }}>
        Preview ended. Unlock the full track or subscribe for unlimited streaming.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleUnlock}
          style={{
            ...BTN_BASE,
            background: "#0a0a0a",
            color: "#00ffff",
            border: "1px solid #00ffff",
          }}
        >
          {priceLabel ? `Unlock · ${priceLabel}` : "Unlock full track"}
        </button>
        <Link
          href="/subscribe"
          style={{
            ...BTN_BASE,
            background: "#a259ff",
            color: "#fff",
            border: "none",
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Subscribe
        </Link>
        <button
          type="button"
          onClick={onContinueListening}
          style={{
            ...BTN_BASE,
            background: "transparent",
            color: "#888",
            border: "1px solid #2a2a2a",
          }}
        >
          Continue Listening
        </button>
      </div>
    </div>
  );
}

export default memo(PreviewEndedCTA);
