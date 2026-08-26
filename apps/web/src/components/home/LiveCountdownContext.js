"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const LiveCountdownContext = createContext(null);

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

const POLL_MS = 30_000; // check DB state every 30 seconds

/**
 * Fetches live broadcast state from the DB and drives the countdown.
 * When is_live = true, liveIsLive is forced true regardless of countdown math.
 * Isolates 1 Hz ticks from the storefront shell so it doesn't re-render every second.
 */
export function LiveCountdownProvider({ targetDate, children }) {
  // Fallback target from prop (may be overridden by DB goes_live_at).
  const [fallbackMs] = useState(() => targetDate instanceof Date
    ? targetDate.getTime()
    : new Date(targetDate || Date.now()).getTime());

  const [dbState, setDbState] = useState({ isLive: false, goesLiveAt: null, channel: "callme2mrrw", title: "2MRRW Live" });
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // DB poll — fetch current broadcast state.
  useEffect(() => {
    let cancelled = false;

    async function fetchState() {
      try {
        const res = await fetch("/api/public/livestream", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const b = json.broadcast;
        if (cancelled) return;
        setDbState({
          isLive:     Boolean(b?.is_live),
          goesLiveAt: b?.goes_live_at || null,
          channel:    b?.channel || "callme2mrrw",
          title:      b?.title || "2MRRW Live",
          broadcastId: b?.id || null,
        });
      } catch {
        // Non-fatal — keeps showing hardcoded countdown
      }
    }

    fetchState();
    const pollId = setInterval(fetchState, POLL_MS);
    return () => { cancelled = true; clearInterval(pollId); };
  }, []);

  // Countdown tick — 1 Hz, uses DB goes_live_at if present, else prop.
  useEffect(() => {
    const targetMs = dbState.goesLiveAt
      ? new Date(dbState.goesLiveAt).getTime()
      : fallbackMs;

    const tick = () => setCountdown(computeCountdown(targetMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dbState.goesLiveAt]);

  const value = useMemo(
    () => ({
      liveIsLive:  dbState.isLive,
      liveCountdown: countdown,
      liveChannel: dbState.channel,
      liveTitle:   dbState.title,
      liveBroadcastId: dbState.broadcastId || null,
      liveGoesLiveAt:  dbState.goesLiveAt || null,
    }),
    [dbState.isLive, countdown, dbState.channel, dbState.title, dbState.broadcastId, dbState.goesLiveAt]
  );

  return <LiveCountdownContext.Provider value={value}>{children}</LiveCountdownContext.Provider>;
}

export function useLiveCountdown() {
  const ctx = useContext(LiveCountdownContext);
  if (!ctx) throw new Error("useLiveCountdown must be used within LiveCountdownProvider");
  return ctx;
}
