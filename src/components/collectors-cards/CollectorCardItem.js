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
      {/* Outer shell carries the drop shadow so it's not clipped */}
      <div
        style={{
          borderRadius: isMobile ? 14 : 18,
          boxShadow: `0 20px 50px rgba(0,0,0,0.72), 0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px ${card.accentColor}22`,
          transition: "transform 0.28s ease, box-shadow 0.28s ease",
        }}
        className="collector-card-outer"
      >
        {/* Card frame — overflow hidden keeps sheen clipped */}
        <div
          className={reduceMotion ? "collector-card-frame" : "collector-card-frame collector-card-sheen"}
          style={{
            position: "relative",
            borderRadius: isMobile ? 14 : 18,
            overflow: "hidden",
            aspectRatio: "3 / 4",
            border: `2px solid ${card.accentColor}66`,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.14)`,
            background: "#0a0a0a",
          }}
        >
          {/* Cover art */}
          {card.faceType === "video" && card.videoSrc ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
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

          {/* Top accent strip — card header band */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: isMobile ? 22 : 28,
              background: `linear-gradient(90deg, ${card.accentColor}cc 0%, ${card.accentColor}55 60%, transparent 100%)`,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              paddingLeft: isMobile ? 8 : 10,
              gap: 5,
            }}
          >
            <span
              style={{
                fontSize: isMobile ? 7 : 8,
                fontWeight: 900,
                letterSpacing: 2.5,
                color: "#fff",
                textTransform: "uppercase",
                opacity: 0.9,
              }}
            >
              2MRRW
            </span>
            <span
              style={{
                fontSize: isMobile ? 6 : 7,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: "rgba(255,255,255,0.6)",
                textTransform: "uppercase",
              }}
            >
              · Collector
            </span>
          </div>

          {/* Gloss highlight — top-third coating feel */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "38%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />

          {/* Bottom gradient */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.92) 100%)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />

          {/* Remaining / sold out badge */}
          <div
            style={{
              position: "absolute",
              top: isMobile ? 28 : 36,
              right: isMobile ? 7 : 9,
              zIndex: 4,
              fontSize: isMobile ? 8 : 9,
              fontWeight: 800,
              letterSpacing: 0.8,
              padding: isMobile ? "3px 6px" : "4px 8px",
              borderRadius: 6,
              background: "rgba(0,0,0,0.75)",
              color: soldOut ? "#ff4d4d" : "rgba(255,255,255,0.75)",
              backdropFilter: "blur(6px)",
              border: soldOut ? "1px solid #ff4d4d44" : `1px solid ${card.accentColor}44`,
            }}
          >
            {soldOut ? "Sold Out" : `${remaining} left`}
          </div>

          {/* Bottom info panel */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 4,
              padding: isMobile ? "10px 10px 13px" : "12px 14px 16px",
              borderTop: `1px solid ${card.accentColor}33`,
            }}
          >
            <div
              style={{
                fontSize: isMobile ? 11 : 13,
                fontWeight: 800,
                letterSpacing: 0.3,
                lineHeight: 1.25,
                color: "#fff",
                marginBottom: isMobile ? 5 : 7,
              }}
            >
              {card.title}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  fontSize: isMobile ? 15 : 17,
                  fontWeight: 900,
                  color: card.accentColor,
                  letterSpacing: -0.3,
                }}
              >
                ${card.price.toFixed(2)}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 8 : 9,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  color: "rgba(255,255,255,0.38)",
                  textTransform: "uppercase",
                }}
              >
                Ed. {card.editionSize}
              </div>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
