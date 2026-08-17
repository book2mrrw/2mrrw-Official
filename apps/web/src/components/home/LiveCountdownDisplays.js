"use client";

import { memo } from "react";
import LivePanel from "@/components/home/LivePanel";
import { useLiveCountdown } from "@/components/home/LiveCountdownContext";

export const LiveCountdownDesktopPanel = memo(function LiveCountdownDesktopPanel({
  liveStreamDate,
  liveStreamTime,
}) {
  const { liveIsLive, liveCountdown } = useLiveCountdown();
  return (
    <LivePanel
      liveIsLive={liveIsLive}
      liveStreamDate={liveStreamDate}
      liveStreamTime={liveStreamTime}
      liveCountdown={liveCountdown}
    />
  );
});

export const LiveCountdownMobileHomeStrip = memo(function LiveCountdownMobileHomeStrip() {
  const { liveIsLive, liveCountdown } = useLiveCountdown();
  return (
    <div
      style={{
        marginTop: 14,
        background: "linear-gradient(135deg,rgba(8,8,8,0.92),rgba(13,13,13,0.95))",
        border: "1px solid rgba(0,255,255,0.15)",
        borderRadius: 16,
        padding: "20px 18px",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#444",
          letterSpacing: 3,
          marginBottom: 10,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
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
              animation: "pulse 1.2s infinite",
            }}
          />
          <div style={{ fontSize: 20, fontWeight: 900, color: "#00ffff", letterSpacing: 3 }}>LIVE NOW</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { v: liveCountdown.days, l: "D" },
            { v: liveCountdown.hours, l: "H" },
            { v: liveCountdown.minutes, l: "M" },
            { v: liveCountdown.seconds, l: "S" },
          ].map((u) => (
            <div
              key={u.l}
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.5)",
                border: "1px solid #1a1a1a",
                borderRadius: 10,
                padding: "10px 4px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  color: "#00ffff",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {String(u.v).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1.5, marginTop: 3 }}>{u.l}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const LiveCountdownHomeSection = memo(function LiveCountdownHomeSection({
  isMobile,
  liveStreamDate,
  liveStreamTime,
}) {
  const { liveIsLive, liveCountdown } = useLiveCountdown();
  return (
    <div id="home-live">
      <h2 className="section-heading" style={{ marginBottom: 16 }}>
        2MRRW LIVE
      </h2>
      <div
        style={{
          background: "linear-gradient(135deg,#080808,#0d0d0d)",
          border: "1px solid rgba(0,255,255,0.1)",
          borderRadius: 20,
          padding: isMobile ? "20px 16px" : "32px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 8 }}>NEXT LIVE STREAM</div>
        <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, marginBottom: 4 }}>2MRRW LIVE – Dallas</div>
        <div style={{ fontSize: 13, color: "#aaa", marginBottom: 24 }}>
          {liveStreamDate} · {liveStreamTime}
        </div>
        {liveIsLive ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              fontSize: 22,
              fontWeight: 900,
              color: "#00ffff",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#00ffff",
                animation: "pulse 1.2s infinite",
              }}
            />
            LIVE NOW
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: isMobile ? 8 : 14,
              flexWrap: "wrap",
            }}
          >
            {[
              { v: liveCountdown.days, l: "Days" },
              { v: liveCountdown.hours, l: "Hours" },
              { v: liveCountdown.minutes, l: "Min" },
              { v: liveCountdown.seconds, l: "Sec" },
            ].map((u) => (
              <div
                key={u.l}
                style={{
                  background: "#0a0a0a",
                  border: "1px solid #1e1e1e",
                  borderRadius: 14,
                  padding: isMobile ? "12px 10px" : "16px 20px",
                  minWidth: isMobile ? 52 : 68,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: isMobile ? 24 : 32,
                    fontWeight: 900,
                    color: "#00ffff",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {String(u.v).padStart(2, "0")}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "#444",
                    letterSpacing: 2,
                    marginTop: 5,
                    textTransform: "uppercase",
                  }}
                >
                  {u.l}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export const LiveCountdownLiveTab = memo(function LiveCountdownLiveTab({
  isMobile,
  liveStreamDate,
  liveStreamTime,
}) {
  const { liveIsLive, liveCountdown, liveChannel, liveTitle, liveGoesLiveAt } = useLiveCountdown();

  const displayDate = liveGoesLiveAt
    ? new Date(liveGoesLiveAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : liveStreamDate;
  const displayTime = liveGoesLiveAt
    ? new Date(liveGoesLiveAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : liveStreamTime;

  const channel = liveChannel || "callme2mrrw";
  // Twitch embeds require the parent domain. Works on production (www.2mrrw.com).
  const isProduction = typeof window !== "undefined" && window.location.hostname !== "localhost";
  const twitchParent = typeof window !== "undefined"
    ? window.location.hostname
    : "www.2mrrw.com";
  const twitchSrc = `https://player.twitch.tv/?channel=${channel}&parent=${twitchParent}&autoplay=true&muted=false`;

  return (
    <>
      {/* Header card — countdown when offline, LIVE NOW when live */}
      <div
        style={{
          background: "linear-gradient(135deg,#080808,#0d0d0d)",
          border: liveIsLive ? "1px solid rgba(0,255,255,0.35)" : "1px solid rgba(0,255,255,0.12)",
          borderRadius: 20,
          padding: isMobile ? "20px 16px" : "36px 32px",
          marginBottom: 28,
          textAlign: "center",
          transition: "border-color 0.4s",
        }}
      >
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 6, textTransform: "uppercase" }}>
          {liveIsLive ? "On Air Now" : "Next Live Stream"}
        </div>
        <div style={{ fontSize: isMobile ? 17 : 22, fontWeight: 800, marginBottom: 4 }}>
          {liveTitle || "2MRRW LIVE"}
        </div>
        {!liveIsLive && (
          <div style={{ fontSize: 13, color: "#aaa", marginBottom: 28 }}>
            {displayDate} · {displayTime}
          </div>
        )}
        {liveIsLive ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12 }}>
            <div
              style={{
                width: 12, height: 12, borderRadius: "50%", background: "#00ffff",
                boxShadow: "0 0 14px rgba(0,255,255,0.9)", animation: "pulse 1.2s infinite",
              }}
            />
            <div style={{ fontSize: 28, fontWeight: 900, color: "#00ffff", letterSpacing: 4 }}>LIVE NOW</div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? 8 : 16, flexWrap: "wrap" }}>
            {[
              { v: liveCountdown.days, l: "Days" },
              { v: liveCountdown.hours, l: "Hours" },
              { v: liveCountdown.minutes, l: "Min" },
              { v: liveCountdown.seconds, l: "Sec" },
            ].map((u) => (
              <div
                key={u.l}
                style={{
                  background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 14,
                  padding: isMobile ? "12px 10px" : "18px 22px", minWidth: isMobile ? 52 : 74, textAlign: "center",
                }}
              >
                <div style={{ fontSize: isMobile ? 26 : 36, fontWeight: 900, color: "#00ffff", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {String(u.v).padStart(2, "0")}
                </div>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginTop: 6, textTransform: "uppercase" }}>{u.l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player area — Twitch embed when live, offline placeholder when not */}
      <div
        style={{
          background: "#0d0d0d",
          border: liveIsLive ? "1px solid rgba(0,255,255,0.2)" : "1px solid #1e1e1e",
          borderRadius: 20,
          overflow: "hidden",
          marginBottom: 28,
          transition: "border-color 0.4s",
        }}
      >
        <div style={{ position: "relative", paddingBottom: "56.25%", background: "#050505" }}>
          {liveIsLive && isProduction ? (
            <iframe
              src={twitchSrc}
              title="2MRRW Live Stream"
              allowFullScreen
              allow="autoplay; fullscreen"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          ) : (
            <div
              style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 16,
              }}
            >
              <div
                style={{
                  width: 70, height: 70, borderRadius: "50%", border: "1px solid #222",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg viewBox="0 0 24 24" fill="#333" width="32" height="32">
                  <circle cx="12" cy="12" r="4" />
                  <path
                    d="M20.188 10.934a8.999 8.999 0 0 0-16.376 0M23.472 9.16a13.5 13.5 0 0 0-22.944 0M16.905 12.7a4.5 4.5 0 0 0-9.81 0M12 17v-1m0 5v-2"
                    stroke="#333" strokeWidth="1.5" fill="none"
                  />
                </svg>
              </div>
              <div style={{ fontSize: 14, color: "#333", fontWeight: 700, letterSpacing: 2 }}>OFFLINE</div>
              <div style={{ fontSize: 12, color: "#2a2a2a" }}>Stream will appear here when live</div>
            </div>
          )}
        </div>
        <div style={{ padding: "16px 20px", borderTop: "1px solid #111" }}>
          <div style={{ fontSize: 13, color: "#444" }}>
            {liveIsLive
              ? `Streaming live · Also at twitch.tv/${channel}`
              : "Live streams broadcast here and on Twitch. You'll be notified when 2MRRW goes live."}
          </div>
        </div>
      </div>
    </>
  );
});
