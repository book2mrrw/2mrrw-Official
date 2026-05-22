"use client";

import { useEffect } from "react";
import { benefitsForCard, editionLabel } from "./collectorCardCatalog";
import { addCollectorCardToCart } from "@/lib/collectors-cards/purchase";

export function CollectorCardModal({ card, remaining, onClose, isMobile }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!card) return null;

  const soldOut = remaining <= 0;
  const benefits = benefitsForCard(card);

  const handlePurchase = () => {
    if (soldOut) return;
    const ok = addCollectorCardToCart({
      ...card,
      cover: card.artwork,
    });
    if (!ok) {
      console.warn("[collectors-cards] Purchase: cart unavailable; open shop from home.");
      window.location.href = "/";
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="collector-card-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 16 : 24,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#0d0d0d",
          border: `1px solid ${card.accentColor}33`,
          borderRadius: 24,
          padding: isMobile ? 20 : 28,
          boxShadow: `0 0 60px ${card.accentColor}18`,
        }}
      >
        <div style={{ position: "relative", marginBottom: 16 }}>
          {card.faceType === "video" && card.videoSrc ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              data-cinematic-video="true"
              src={card.videoSrc}
              poster={card.artwork}
              style={{
                width: "100%",
                height: 220,
                objectFit: "cover",
                borderRadius: 14,
                display: "block",
              }}
            />
          ) : (
            <img
              src={card.artwork}
              alt=""
              style={{
                width: "100%",
                height: 220,
                objectFit: "cover",
                borderRadius: 14,
                display: "block",
              }}
            />
          )}
        </div>

        <h2
          id="collector-card-modal-title"
          style={{
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: 1,
            margin: "0 0 6px",
          }}
        >
          {card.modalTitle}
        </h2>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: card.accentColor }}>${card.price.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: soldOut ? "#ff4d4d" : "#888" }}>
            {soldOut ? "Sold out" : `${remaining} remaining · ${editionLabel(card)}`}
          </div>
        </div>

        <ul
          style={{
            listStyle: "none",
            margin: "0 0 20px",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {benefits.map((line) => (
            <li
              key={line}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
                color: "#ccc",
                lineHeight: 1.5,
                borderBottom: "1px solid #111",
                paddingBottom: 8,
              }}
            >
              <span style={{ color: card.accentColor, flexShrink: 0 }}>✓</span>
              {line}
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={handlePurchase}
            disabled={soldOut}
            style={{
              flex: 1,
              padding: "12px 20px",
              background: soldOut ? "#222" : card.accentColor,
              color: soldOut ? "#555" : "#000",
              fontWeight: 900,
              border: "none",
              borderRadius: 10,
              cursor: soldOut ? "not-allowed" : "pointer",
              fontSize: 14,
              letterSpacing: 1,
            }}
          >
            {soldOut ? "Sold Out" : "Purchase"}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "12px 18px",
              background: "transparent",
              color: "#888",
              border: "1px solid #333",
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
