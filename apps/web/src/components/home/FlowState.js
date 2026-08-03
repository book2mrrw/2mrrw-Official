"use client";

import { memo } from "react";

function FlowState({ activeFlowMode, currentSlide, showOwnTrackConversion, onAddToCart }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        position: "relative",
        borderRadius: 22,
        overflow: "hidden",
        background: "linear-gradient(160deg,#060606 0%,#0a0808 100%)",
        border: `1px solid ${
          activeFlowMode === "conversion"
            ? `${currentSlide.tagColor}50`
            : activeFlowMode === "nowplaying"
              ? `${currentSlide.tagColor}28`
              : "#161616"
        }`,
        boxShadow:
          activeFlowMode === "conversion"
            ? `0 0 40px ${currentSlide.tagColor}20`
            : activeFlowMode === "nowplaying"
              ? `0 0 50px ${currentSlide.tagColor}12`
              : "none",
        transition: "border-color 0.7s,box-shadow 0.7s",
        minHeight: 320,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          right: 16,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 7, fontWeight: 900, letterSpacing: 3.5, color: "#222", textTransform: "uppercase" }}>
          FLOW STATE
        </div>
        <div
          style={{
            fontSize: 7,
            fontWeight: 900,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: activeFlowMode !== "idle" ? currentSlide.tagColor : "#1e1e1e",
            transition: "color 0.5s",
          }}
        >
          {activeFlowMode === "nowplaying" ? "NOW PLAYING" : activeFlowMode === "conversion" ? "ACQUIRE" : "STANDBY"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: activeFlowMode === "idle" ? 1 : 0,
          pointerEvents: activeFlowMode === "idle" ? "auto" : "none",
          transition: "opacity 0.6s",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
          textAlign: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at 40% 55%,rgba(0,255,255,0.03) 0%,transparent 65%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div
            style={{
              fontSize: 40,
              fontWeight: 900,
              letterSpacing: 10,
              color: "rgba(255,255,255,0.055)",
              animation: "flowIdlePulse 5s ease-in-out infinite",
              lineHeight: 1,
            }}
          >
            2MRRW
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "rgba(0,255,255,0.18)",
                  animation: `flowIdleDot 2.4s ease-in-out ${i * 0.5}s infinite`,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 8, color: "#1c1c1c", letterSpacing: 5, textTransform: "uppercase", fontWeight: 700 }}>
            ARTIST PRESENCE
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: activeFlowMode === "nowplaying" ? 1 : 0,
          pointerEvents: activeFlowMode === "nowplaying" ? "auto" : "none",
          transition: "opacity 0.6s",
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <img
            src={currentSlide.cover}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(32px) brightness(0.18) saturate(1.6)",
              transform: "scale(1.15)",
              transition: "all 0.9s",
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 50% 40%,${currentSlide.tagColor}20 0%,transparent 65%)`,
            transition: "background 0.9s",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "28px 20px",
            gap: 14,
            textAlign: "center",
          }}
        >
          <img
            src={currentSlide.cover}
            alt={currentSlide.title}
            style={{
              width: 88,
              height: 88,
              borderRadius: 12,
              objectFit: "cover",
              boxShadow: `0 8px 32px ${currentSlide.tagColor}55`,
              transition: "all 0.7s",
            }}
          />
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 2, lineHeight: 1.2, color: "#fff" }}>{currentSlide.title}</div>
          <div
            style={{
              fontSize: 9,
              color: currentSlide.tagColor,
              letterSpacing: 4,
              fontWeight: 700,
              textTransform: "uppercase",
              opacity: 0.85,
            }}
          >
            NOW PLAYING
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 22 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  width: 3,
                  borderRadius: 2,
                  background: currentSlide.tagColor,
                  animation: `eqBar${((i - 1) % 4) + 1} ${0.38 + i * 0.09}s ease-in-out infinite alternate`,
                  boxShadow: `0 0 8px ${currentSlide.tagColor}88`,
                }}
              />
            ))}
          </div>
          <div
            style={{
              marginTop: 4,
              padding: "4px 14px",
              background: `${currentSlide.tagColor}18`,
              border: `1px solid ${currentSlide.tagColor}30`,
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 700,
              color: currentSlide.tagColor,
              letterSpacing: 1.5,
            }}
          >
            {currentSlide.tag}
          </div>
        </div>
      </div>
      {showOwnTrackConversion ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: activeFlowMode === "conversion" ? 1 : 0,
            pointerEvents: activeFlowMode === "conversion" ? "auto" : "none",
            transition: "opacity 0.45s",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse at 50% 45%,${currentSlide.tagColor}16 0%,transparent 60%)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px 20px",
              gap: 12,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 9, color: currentSlide.tagColor, letterSpacing: 4, fontWeight: 900, textTransform: "uppercase" }}>
              OWN THIS TRACK
            </div>
            <img
              src={currentSlide.cover}
              alt={currentSlide.title}
              style={{
                width: 72,
                height: 72,
                borderRadius: 10,
                objectFit: "cover",
                boxShadow: `0 6px 24px ${currentSlide.tagColor}55`,
              }}
            />
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 1, color: "#fff", lineHeight: 1.2 }}>{currentSlide.title}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: currentSlide.tagColor, letterSpacing: 1, lineHeight: 1 }}>
              ${currentSlide.price.toFixed(2)}
            </div>
            <button
              onClick={() =>
                onAddToCart({
                  title: currentSlide.title,
                  slug: currentSlide.slug,
                  cover: currentSlide.cover,
                  price: currentSlide.price,
                })
              }
              style={{
                padding: "11px 28px",
                background: currentSlide.tagColor,
                color: "#000",
                fontWeight: 900,
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
                letterSpacing: 1,
                boxShadow: `0 0 28px ${currentSlide.tagColor}50`,
                transition: "opacity 0.2s,transform 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.85";
                e.currentTarget.style.transform = "scale(1.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Add to Cart
            </button>
            <div style={{ fontSize: 10, color: "#444", letterSpacing: 1, marginTop: 2 }}>Digital download · Instant access</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(FlowState);
