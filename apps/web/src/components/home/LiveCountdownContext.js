"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const LiveCountdownContext = createContext(null);

function computeLiveState(targetDate) {
  const diff = targetDate.getTime() - Date.now();
  if (diff <= 0) {
    return {
      liveIsLive: true,
      liveCountdown: { days: 0, hours: 0, minutes: 0, seconds: 0 },
    };
  }
  return {
    liveIsLive: false,
    liveCountdown: {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((diff % (1000 * 60)) / 1000),
    },
  };
}

/**
 * Isolates 1 Hz countdown ticks from page.js so the storefront shell does not re-render every second.
 */
export function LiveCountdownProvider({ targetDate, children }) {
  const targetMs = targetDate instanceof Date ? targetDate.getTime() : new Date(targetDate).getTime();
  const [snapshot, setSnapshot] = useState(() => computeLiveState(new Date(targetMs)));

  useEffect(() => {
    const target = new Date(targetMs);
    const tick = () => setSnapshot(computeLiveState(target));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  const value = useMemo(
    () => ({
      liveIsLive: snapshot.liveIsLive,
      liveCountdown: snapshot.liveCountdown,
    }),
    [snapshot.liveIsLive, snapshot.liveCountdown]
  );

  return <LiveCountdownContext.Provider value={value}>{children}</LiveCountdownContext.Provider>;
}

export function useLiveCountdown() {
  const ctx = useContext(LiveCountdownContext);
  if (!ctx) {
    throw new Error("useLiveCountdown must be used within LiveCountdownProvider");
  }
  return ctx;
}
