"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/commerce/stripe-client";
import CheckoutForm from "@/components/payments/CheckoutForm";
import LivePanel from "@/components/home/LivePanel";
import { useLiveBroadcast, useLiveCountdown, useTwitchEmbedConfig } from "@/components/home/LiveCountdownContext";
import { LIVE_PPV_PRESET_CENTS, formatLivePpvAmount } from "@/lib/live/ppv-pricing";
import { useLiveWitnessCount } from "@/hooks/useLiveWitnessCount";
import { useLiveChat } from "@/hooks/useLiveChat";

function LivePpvPricePicker({ broadcastTitle }) {
  const { refreshLiveState } = useLiveBroadcast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [unlocked, setUnlocked] = useState(false);

  const handleSelect = async (amountCents) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/live/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Checkout failed"); return; }
      if (data.clientSecret) setClientSecret(data.clientSecret);
    } catch {
      setErr("Network error — try again");
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = () => {
    setUnlocked(true);
    setClientSecret(null);
    // Webhook fulfillment lands asynchronously — refresh now, and once more
    // shortly after, rather than waiting on the 15s background poll.
    refreshLiveState();
    setTimeout(refreshLiveState, 2000);
  };

  if (unlocked) {
    return (
      <div style={{ fontSize: 13, color: "#00ffff", fontWeight: 700, textAlign: "center" }}>
        ✓ Unlocked — loading the stream…
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ padding: "12px 22px", background: "#00ffff", color: "#000", fontWeight: 700, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, letterSpacing: 0.4 }}
      >
        Unlock This Live
      </button>
    );
  }

  // Payment stays on this same page — no redirect to a Stripe-hosted checkout page.
  if (clientSecret) {
    return (
      <div style={{ width: "100%", maxWidth: 380 }}>
        <Elements
          stripe={getStripeClient()}
          options={{
            clientSecret,
            appearance: {
              theme: "night",
              variables: { colorPrimary: "#00ffff", colorBackground: "#0a0a0a", colorText: "#ffffff", borderRadius: "8px" },
            },
          }}
        >
          <CheckoutForm onSuccess={handleSuccess} requiresShipping={false} submitLabel="Unlock" />
        </Elements>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, maxWidth: 380 }}>
      <div style={{ fontSize: 12, color: "#aaa", textAlign: "center" }}>
        Choose what to pay to watch {broadcastTitle || "this live"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, width: "100%" }}>
        {LIVE_PPV_PRESET_CENTS.map((cents) => (
          <button
            key={cents}
            disabled={loading}
            onClick={() => handleSelect(cents)}
            style={{ padding: "10px 0", background: loading ? "#1a1a1a" : "#141414", color: loading ? "#555" : "#00ffff", border: "1px solid rgba(0,255,255,0.25)", borderRadius: 6, cursor: loading ? "wait" : "pointer", fontSize: 12, fontWeight: 600 }}
          >
            {formatLivePpvAmount(cents)}
          </button>
        ))}
      </div>
      {err && <div style={{ fontSize: 12, color: "#ef4444", textAlign: "center" }}>{err}</div>}
      <button
        onClick={() => setOpen(false)}
        disabled={loading}
        style={{ background: "none", border: "none", color: "#666", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
      >
        Cancel
      </button>
    </div>
  );
}

function LiveAccessGate({ access, broadcastTitle }) {
  if (access === "signup_required") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", maxWidth: 320 }}>
          Create a free account to watch {broadcastTitle || "2MRRW Live"}.
        </div>
        <a
          href="/join?returnTo=/"
          style={{ padding: "12px 22px", background: "#00ffff", color: "#000", fontWeight: 700, borderRadius: 8, fontSize: 13, textDecoration: "none", letterSpacing: 0.4 }}
        >
          Create Account
        </a>
      </div>
    );
  }
  if (access === "payment_required") {
    return <LivePpvPricePicker broadcastTitle={broadcastTitle} />;
  }
  return (
    <div style={{ fontSize: 13, color: "#888", textAlign: "center", maxWidth: 320 }}>
      This livestream is reserved for eligible members of the announced audience.
    </div>
  );
}

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
          padding: "clamp(20px, 4cqi, 32px)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 8 }}>NEXT LIVE STREAM</div>
        <div style={{ fontSize: "clamp(16px, 2.6cqi, 20px)", fontWeight: 800, marginBottom: 4 }}>2MRRW LIVE – Dallas</div>
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
              gap: "clamp(8px, 2cqi, 14px)",
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
                  padding: "clamp(12px, 2cqi, 16px) clamp(10px, 2.6cqi, 20px)",
                  minWidth: "clamp(52px, 10cqi, 68px)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "clamp(24px, 4cqi, 32px)",
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

const LiveCountdownHeader = memo(function LiveCountdownHeader({
  liveStreamDate,
  liveStreamTime,
}) {
  const { liveIsLive, liveCountdown, liveTitle, liveGoesLiveAt } = useLiveCountdown();

  const displayDate = liveGoesLiveAt
    ? new Date(liveGoesLiveAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : liveStreamDate;
  const displayTime = liveGoesLiveAt
    ? new Date(liveGoesLiveAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : liveStreamTime;

  return (
    <div
      style={{
        background: "linear-gradient(135deg,#080808,#0d0d0d)",
        border: liveIsLive ? "1px solid rgba(0,255,255,0.35)" : "1px solid rgba(0,255,255,0.12)",
        borderRadius: 20,
        padding: "clamp(20px, 4cqi, 36px) clamp(16px, 4cqi, 32px)",
        marginBottom: 28,
        textAlign: "center",
        transition: "border-color 0.4s",
      }}
    >
      <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 6, textTransform: "uppercase" }}>
        {liveIsLive ? "On Air Now" : "Next Live Stream"}
      </div>
      <div style={{ fontSize: "clamp(17px, 3cqi, 22px)", fontWeight: 800, marginBottom: 4 }}>
        {liveTitle || "2MRRW LIVE"}
      </div>
      {!liveIsLive && (
        <div style={{ fontSize: 13, color: "#aaa", marginBottom: 28 }}>
          {displayDate} · {displayTime}
        </div>
      )}
      {liveIsLive ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#00ffff", boxShadow: "0 0 14px rgba(0,255,255,0.9)", animation: "pulse 1.2s infinite" }} />
          <div style={{ fontSize: 28, fontWeight: 900, color: "#00ffff", letterSpacing: 4 }}>LIVE NOW</div>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "center", gap: "clamp(8px, 2cqi, 16px)", flexWrap: "wrap" }}>
          {[
            { v: liveCountdown.days, l: "Days" },
            { v: liveCountdown.hours, l: "Hours" },
            { v: liveCountdown.minutes, l: "Min" },
            { v: liveCountdown.seconds, l: "Sec" },
          ].map((u) => (
            <div key={u.l} style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 14, padding: "clamp(12px, 2.4cqi, 18px) clamp(10px, 3cqi, 22px)", minWidth: "clamp(52px, 11cqi, 74px)", textAlign: "center" }}>
              <div style={{ fontSize: "clamp(26px, 5cqi, 36px)", fontWeight: 900, color: "#00ffff", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {String(u.v).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginTop: 6, textTransform: "uppercase" }}>{u.l}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function LiveChatPanel({ broadcastId }) {
  const { messages, sendMessage, sending, error } = useLiveChat({ broadcastId, active: true });
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    const body = draft;
    setDraft("");
    await sendMessage(body);
  };

  return (
    <div style={{ borderTop: "1px solid #111", display: "flex", flexDirection: "column", height: 260 }}>
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: "#555", textAlign: "center", marginTop: 20 }}>
            No messages yet — say something.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ fontSize: 13, lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700, color: m.is_creator ? "#00ffff" : "#9146ff" }}>{m.display_name}</span>
            {m.badge && (
              <span style={{ fontSize: 9, color: "#888", marginLeft: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>
                {m.badge}
              </span>
            )}
            <span style={{ color: "#ddd" }}>: {m.body}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderTop: "1px solid #111" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !sending && draft.trim()) handleSend(); }}
          maxLength={500}
          placeholder="Say something…"
          style={{ flex: 1, background: "#141414", border: "1px solid #222", borderRadius: 6, color: "#eee", padding: "8px 10px", fontSize: 13 }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          style={{ padding: "8px 16px", background: sending || !draft.trim() ? "#1a1a1a" : "#00ffff", color: sending || !draft.trim() ? "#555" : "#000", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: sending || !draft.trim() ? "default" : "pointer" }}
        >
          Send
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: "#ef4444", padding: "0 16px 8px" }}>{error}</div>}
    </div>
  );
}

const PersistentTwitchPlayer = memo(function PersistentTwitchPlayer() {
  const { liveIsLive, liveProviderStatus, liveStateStatus, canViewLive, liveAccess, liveTitle, liveBroadcastId } = useLiveBroadcast();
  const { channel, parent } = useTwitchEmbedConfig();
  const witnessCount = useLiveWitnessCount({
    broadcastId: liveBroadcastId,
    active: canViewLive && liveIsLive,
  });
  const twitchSrc = useMemo(() => {
    const params = new URLSearchParams({
      channel,
      parent,
      autoplay: "true",
      muted: "true",
    });
    return `https://player.twitch.tv/?${params.toString()}`;
  }, [channel, parent]);

  return (
    <div style={{ background: "#0d0d0d", border: liveIsLive ? "1px solid rgba(0,255,255,0.2)" : "1px solid #1e1e1e", borderRadius: 20, overflow: "hidden", marginBottom: 28, transition: "border-color 0.4s" }}>
      <div style={{ overflowX: "auto", background: "#050505" }}>
        {canViewLive ? (
          <div style={{ position: "relative", width: "max(100%, 400px)", minHeight: 300, aspectRatio: "16 / 9" }}>
            <iframe
              src={twitchSrc}
              title="2MRRW Live Stream"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          </div>
        ) : (
          <div style={{ minHeight: 300, display: "grid", placeItems: "center", padding: 24 }}>
            <LiveAccessGate access={liveAccess} broadcastTitle={liveTitle} />
          </div>
        )}
      </div>
      <div style={{ padding: "16px 20px", borderTop: "1px solid #111", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: liveIsLive ? "#8ff" : "#666" }}>
          {!canViewLive
            ? liveAccess === "signup_required"
              ? "Create an account to unlock this live."
              : liveAccess === "payment_required"
                ? "Pay once to unlock this specific live event."
                : liveAccess === "loading"
                  ? "Checking your access…"
                  : "Your account does not currently include access to this broadcast."
            : liveStateStatus === "unavailable"
            ? "Live status is reconnecting. The Twitch player remains available."
            : liveIsLive
              ? "Streaming live on 2MRRW"
              : liveProviderStatus === "unknown" ? "Checking Twitch status…" : "Twitch is currently offline"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {canViewLive && liveIsLive && witnessCount > 0 && (
            <div style={{ fontSize: 12, color: "#8ff" }}>
              👁 {witnessCount.toLocaleString("en-US")} {witnessCount === 1 ? "witness" : "witnesses"}
            </div>
          )}
          {canViewLive && (
            <a href={`https://www.twitch.tv/${channel}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#9146ff", textDecoration: "none" }}>
              Open Twitch ↗
            </a>
          )}
        </div>
      </div>
      {canViewLive && liveIsLive && liveBroadcastId && (
        <LiveChatPanel broadcastId={liveBroadcastId} />
      )}
    </div>
  );
});

function formatVodDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function PastLivesSection() {
  const [vods, setVods] = useState([]);
  const [openVodId, setOpenVodId] = useState(null);
  const { parent } = useTwitchEmbedConfig();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/live-vods", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => { if (!cancelled && Array.isArray(data.vods)) setVods(data.vods); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!vods.length) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", color: "rgba(255,255,255,.4)", marginBottom: 10, textTransform: "uppercase" }}>
        Past Lives
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {vods.map((vod) => (
          <div key={vod.id} style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 14, overflow: "hidden" }}>
            <button
              onClick={() => setOpenVodId((current) => (current === vod.id ? null : vod.id))}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
            >
              <div>
                <div style={{ fontSize: 13, color: "#eee", fontWeight: 600 }}>{vod.title}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                  {new Date(vod.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {formatVodDuration(vod.durationSeconds) ? ` · ${formatVodDuration(vod.durationSeconds)}` : ""}
                </div>
              </div>
              <div style={{ fontSize: 11, color: vod.access === "free" ? "#00ffff" : "#888", fontWeight: 700, whiteSpace: "nowrap" }}>
                {vod.access === "free" ? (openVodId === vod.id ? "Close ✕" : "Watch ▶") : "Locked 🔒"}
              </div>
            </button>
            {openVodId === vod.id && (
              vod.access === "free" && vod.twitchVideoId ? (
                <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
                  <iframe
                    src={`https://player.twitch.tv/?video=${encodeURIComponent(vod.twitchVideoId)}&parent=${encodeURIComponent(parent)}&autoplay=true`}
                    title={vod.title}
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                  />
                </div>
              ) : (
                <div style={{ padding: "8px 16px 18px" }}>
                  <LiveAccessGate access={vod.access} broadcastTitle={vod.title} />
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export const LiveCountdownLiveTab = memo(function LiveCountdownLiveTab({
  liveStreamDate,
  liveStreamTime,
}) {
  return (
    <>
      <LiveCountdownHeader liveStreamDate={liveStreamDate} liveStreamTime={liveStreamTime} />
      <PersistentTwitchPlayer />
      <PastLivesSection />
    </>
  );
});
