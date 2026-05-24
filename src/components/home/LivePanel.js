"use client";

import { memo } from "react";

function LivePanel({ liveIsLive, liveStreamDate, liveStreamTime, liveCountdown }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg,rgba(8,8,8,0.92),rgba(13,13,13,0.95))",
        border: "1px solid rgba(0,255,255,0.15)",
        borderRadius: 18,
        padding: "28px 26px",
        backdropFilter: "blur(12px)",
        boxShadow: "0 0 30px rgba(0,255,255,0.06)",
        position: "relative",
        overflow: "hidden",
        minWidth: 220,
        width: 248,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 120,
          height: 1,
          background: "linear-gradient(90deg,transparent,rgba(0,255,255,0.3),transparent)",
          pointerEvents: "none",
        }}
      />
      <div style={{ fontSize: 11, color: "#444", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase", fontWeight: 700 }}>
        2MRRW LIVE
      </div>
      {liveIsLive ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#00ffff",
              boxShadow: "0 0 10px rgba(0,255,255,0.9)",
              animation: "pulse 1.2s infinite",
            }}
          />
          <div style={{ fontSize: 20, fontWeight: 900, color: "#00ffff", letterSpacing: 3 }}>LIVE NOW</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 14, color: "#888", marginBottom: 4 }}>{liveStreamDate}</div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>{liveStreamTime}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { v: liveCountdown.days, l: "D" },
              { v: liveCountdown.hours, l: "H" },
              { v: liveCountdown.minutes, l: "M" },
              { v: liveCountdown.seconds, l: "S" },
            ].map((u) => (
              <div
                key={u.l}
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid #1a1a1a",
                  borderRadius: 12,
                  padding: "11px 8px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 900,
                    color: "#00ffff",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {String(u.v).padStart(2, "0")}
                </div>
                <div style={{ fontSize: 10, color: "#444", letterSpacing: 1.5, marginTop: 4 }}>{u.l}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default memo(LivePanel);
