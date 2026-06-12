"use client";

import { useReducedMotion } from "framer-motion";

export function CollectorCardItem({ card, remaining, onSelect, isMobile }) {
  const reduceMotion = useReducedMotion();
  const soldOut = remaining <= 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      className="collector-card-item"
      style={{
        width: "100%",
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      }}
      aria-label={`${card.title} collector card, $${card.price.toFixed(2)}`}
    >
      <div
        className={reduceMotion ? "collector-card-frame" : "collector-card-frame collector-card-sheen"}
        style={{
          position: "relative",
          borderRadius: isMobile ? 14 : 18,
          overflow: "hidden",
          aspectRatio: "3 / 4",
          border: `1px solid ${card.accentColor}44`,
          boxShadow: `0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset`,
          background: "#0a0a0a",
        }}
      >
        {card.faceType === "video" && card.videoSrc ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            data-cinematic-video="true"
            src={card.videoSrc}
            poster={card.artwork}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <img
            src={card.artwork}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.85) 100%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 2,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1,
            padding: "4px 8px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.72)",
            color: soldOut ? "#ff4d4d" : "#fff",
            backdropFilter: "blur(6px)",
          }}
        >
          {soldOut ? "Sold Out" : `${remaining} Left`}
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            padding: isMobile ? "12px 12px 14px" : "14px 16px 18px",
          }}
        >
          <div
            style={{
              fontSize: isMobile ? 13 : 15,
              fontWeight: 800,
              letterSpacing: 0.5,
              lineHeight: 1.25,
              marginBottom: 6,
              color: "#fff",
            }}
          >
            {card.title}
          </div>
          <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, color: card.accentColor }}>
            ${card.price.toFixed(2)}
          </div>
        </div>
      </div>
    </button>
  );
}
