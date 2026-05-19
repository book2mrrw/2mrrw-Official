"use client";

import { useMemo } from "react";
import { useRealtimeEvents } from "./useRealtimeEvents";

export function useConnectionHealth() {
  const { status } = useRealtimeEvents();
  return useMemo(() => ({
    connected: Boolean(status.connected),
    connecting: Boolean(status.connecting),
    degraded: Boolean(status.error && !status.connected),
    lastEventAt: status.lastEventAt,
    lastEventId: status.lastEventId,
    replayed: Boolean(status.replayed),
    error: status.error,
  }), [status]);
}
