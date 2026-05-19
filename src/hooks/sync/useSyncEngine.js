"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeEvents } from "./useRealtimeEvents";

const DEFAULT_DEBOUNCE_MS = 250;

export function useSyncEngine({
  resourceKey,
  fetcher,
  fallbackData,
  eventTypes = [],
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) {
  const [data, setData] = useState(fallbackData);
  const [source, setSource] = useState("fallback");
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const mountedRef = useRef(false);
  const debounceRef = useRef(null);
  const eventTypeSet = useMemo(() => new Set(eventTypes), [eventTypes]);

  const runFetch = useCallback(async ({ reason = "manual" } = {}) => {
    if (!enabled || typeof fetcher !== "function") return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetcher({ reason, resourceKey });
      if (!mountedRef.current) return;
      const nextData = next?.data ?? next;
      const hasUsableData = Array.isArray(nextData) ? nextData.length > 0 : Boolean(nextData);
      setData(hasUsableData ? nextData : fallbackData);
      setSource(hasUsableData ? next?.source || "control-system" : "fallback");
      setVersion((value) => value + 1);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err);
      setData(fallbackData);
      setSource("fallback");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, fallbackData, fetcher, resourceKey]);

  const resync = useCallback((reason = "manual") => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      runFetch({ reason });
    }, debounceMs);
  }, [debounceMs, runFetch]);

  const { status, events } = useRealtimeEvents({
    enabled,
    onEvent: (event) => {
      if (eventTypeSet.has(event.type)) resync(event.type);
    },
  });

  useEffect(() => {
    mountedRef.current = true;
    runFetch({ reason: "initial" });
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [runFetch]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleFocus = () => resync("focus");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") resync("visibility");
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, resync]);

  return {
    data,
    source,
    loading,
    error,
    version,
    resync,
    realtime: status,
    events,
  };
}
