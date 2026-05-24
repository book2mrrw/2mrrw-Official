"use client";

import { useEffect, useState } from "react";

function redemptionLabel(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "claimed") return "Redeemed";
  if (s === "expired") return "Expired";
  if (s === "revoked") return "Revoked";
  return "Pending";
}

/**
 * Admin gifts sent list — used in Account and My Music Collection.
 */
export default function GiftsSentSection({ compact = false, title = "GIFTS SENT" }) {
  const [gifts, setGifts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/gifts/sent", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load gifts");
        if (!cancelled) setGifts(data.gifts || []);
      })
      .catch(() => {
        if (!cancelled) setGifts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        background: "#0d0d0d",
        border: "1px solid rgba(212, 168, 83, 0.22)",
        borderRadius: compact ? 14 : 20,
        padding: compact ? "14px 16px" : "18px 24px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#d4a853",
          letterSpacing: 3,
          marginBottom: 12,
          fontWeight: 800,
        }}
      >
        {title}
      </div>
      {loading ? (
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>Loading…</p>
      ) : gifts.length === 0 ? (
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>No gifts sent yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 12 }}>
          {gifts.map((gift) => (
            <div
              key={gift.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                paddingBottom: compact ? 8 : 10,
                borderBottom: "1px solid #1a1a1a",
              }}
            >
              {gift.coverUrl ? (
                <img
                  src={gift.coverUrl}
                  alt=""
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: "#1a1a1a",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {gift.title}
                </div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                  {gift.recipientEmail}
                  {gift.recipientPhone ? ` · ${gift.recipientPhone}` : ""}
                </div>
                <div style={{ fontSize: 10, color: "#888", marginTop: 4, letterSpacing: 0.5 }}>
                  {redemptionLabel(gift.status)}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#555", flexShrink: 0, textAlign: "right" }}>
                {gift.createdAt
                  ? new Date(gift.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
