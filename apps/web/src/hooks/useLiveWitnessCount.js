"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// A client only reports a NEW local high, and never more often than this —
// the point is "no per-viewer database write," not "no write ever." Most
// connected clients will never see a count above what's already known and
// will never call the report endpoint at all.
const PEAK_REPORT_MIN_INTERVAL_MS = 15_000;

/**
 * Current live "witness" (viewer) count via Supabase Realtime Presence —
 * zero database rows per viewer. Presence membership lives entirely on
 * Supabase's Realtime server and disappears automatically when a tab
 * disconnects; nothing here ever inserts a row keyed to an individual viewer.
 *
 * Only tracks presence while `active` is true — a locked/paywalled viewer
 * who cannot actually see the stream is not a witness.
 */
export function useLiveWitnessCount({ broadcastId, active }) {
  const [count, setCount] = useState(0);
  const lastReportedPeakRef = useRef(0);
  const lastReportAtRef = useRef(0);

  useEffect(() => {
    if (!active || !broadcastId) {
      setCount(0);
      return undefined;
    }

    const supabase = createClient();
    const presenceKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(`live-witnesses:${broadcastId}`, {
      config: { presence: { key: presenceKey } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const current = Object.keys(state).length;
      setCount(current);

      const now = Date.now();
      if (
        current > lastReportedPeakRef.current &&
        now - lastReportAtRef.current > PEAK_REPORT_MIN_INTERVAL_MS
      ) {
        lastReportedPeakRef.current = current;
        lastReportAtRef.current = now;
        fetch("/api/live/witness-peak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ broadcastId, count: current }),
        }).catch(() => {});
      }
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({ at: Date.now() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [broadcastId, active]);

  return count;
}
