"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const LiveBroadcastContext = createContext(null);
const LiveClockContext = createContext(null);
const TwitchEmbedConfigContext = createContext(null);

function computeCountdown(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days:    Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours:   Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  };
}

const POLL_MS = 15_000;

const INITIAL_BROADCAST_STATE = Object.freeze({
  isLive: false,
  goesLiveAt: null,
  channel: "callme2mrrw",
  title: "2MRRW Live",
  broadcastId: null,
  providerStatus: "unknown",
  stateStatus: "loading",
  canView: false,
  access: "loading",
});

function sameBroadcastState(left, right) {
  return Object.keys(INITIAL_BROADCAST_STATE).every((key) => left[key] === right[key]);
}

/**
 * Single application authority for Twitch broadcast state and the countdown clock.
 * Broadcast state and the 1 Hz clock use separate contexts: countdown ticks can
 * update countdown labels without reconciling the persistent Twitch player.
 */
export function LiveCountdownProvider({ targetDate, embedParent = "www.2mrrw.com", broadcasterLogin = "callme2mrrw", children }) {
  // Fallback target from prop (may be overridden by DB goes_live_at).
  const [fallbackMs] = useState(() => targetDate instanceof Date
    ? targetDate.getTime()
    : new Date(targetDate || Date.now()).getTime());

  const [dbState, setDbState] = useState(INITIAL_BROADCAST_STATE);
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const requestInFlightRef = useRef(false);

  const fetchState = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      const res = await fetch("/api/public/livestream", { cache: "no-store" });
      if (!res.ok) throw new Error(`livestream state ${res.status}`);
      const json = await res.json();
      const b = json.broadcast;
      const next = {
        isLive: Boolean(b?.is_live),
        goesLiveAt: b?.goes_live_at || null,
        channel: b?.channel || "callme2mrrw",
        title: b?.title || "2MRRW Live",
        broadcastId: b?.id || null,
        providerStatus: json.providerStatus || (b?.is_live ? "live" : "offline"),
        stateStatus: "ready",
        canView: json.canView === true,
        access: json.access || "none",
      };
      setDbState((current) => sameBroadcastState(current, next) ? current : next);
    } catch {
      setDbState((current) => current.stateStatus === "unavailable"
        ? current
        : { ...current, stateStatus: "unavailable" });
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const initialPollId = window.setTimeout(fetchState, 0);
    const pollId = setInterval(fetchState, POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchState();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearTimeout(initialPollId);
      clearInterval(pollId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchState]);

  // Countdown tick — 1 Hz, uses DB goes_live_at if present, else prop.
  useEffect(() => {
    const targetMs = dbState.goesLiveAt
      ? new Date(dbState.goesLiveAt).getTime()
      : fallbackMs;

    const tick = () => setCountdown(computeCountdown(targetMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dbState.goesLiveAt, fallbackMs]);

  const broadcastValue = useMemo(
    () => ({
      liveIsLive:  dbState.isLive,
      liveChannel: dbState.channel,
      liveTitle:   dbState.title,
      liveBroadcastId: dbState.broadcastId || null,
      liveGoesLiveAt:  dbState.goesLiveAt || null,
      liveProviderStatus: dbState.providerStatus,
      liveStateStatus: dbState.stateStatus,
      canViewLive: dbState.canView,
      liveAccess: dbState.access,
      refreshLiveState: fetchState,
    }),
    [dbState, fetchState]
  );
  const embedConfig = useMemo(() => ({
    parent: /^[a-z0-9.-]+$/i.test(embedParent) ? embedParent : "www.2mrrw.com",
    channel: /^[a-zA-Z0-9_]{1,25}$/.test(broadcasterLogin) ? broadcasterLogin : "callme2mrrw",
  }), [broadcasterLogin, embedParent]);

  return (
    <TwitchEmbedConfigContext.Provider value={embedConfig}>
      <LiveBroadcastContext.Provider value={broadcastValue}>
        <LiveClockContext.Provider value={countdown}>{children}</LiveClockContext.Provider>
      </LiveBroadcastContext.Provider>
    </TwitchEmbedConfigContext.Provider>
  );
}

export function useLiveBroadcast() {
  const ctx = useContext(LiveBroadcastContext);
  if (!ctx) throw new Error("useLiveBroadcast must be used within LiveCountdownProvider");
  return ctx;
}

export function useTwitchEmbedConfig() {
  const ctx = useContext(TwitchEmbedConfigContext);
  if (!ctx) throw new Error("useTwitchEmbedConfig must be used within LiveCountdownProvider");
  return ctx;
}

export function useLiveCountdown() {
  const broadcast = useLiveBroadcast();
  const countdown = useContext(LiveClockContext);
  if (!countdown) throw new Error("useLiveCountdown must be used within LiveCountdownProvider");
  return useMemo(
    () => ({ ...broadcast, liveCountdown: countdown }),
    [broadcast, countdown]
  );
}
