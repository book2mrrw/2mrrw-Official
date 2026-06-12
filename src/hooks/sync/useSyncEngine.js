"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeEvents } from "./useRealtimeEvents";

const DEFAULT_DEBOUNCE_MS = 250;
const CIRCUIT_OPEN_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 30_000;

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
  const failureCountRef = useRef(0);
  const circuitOpenUntilRef = useRef(0);
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
      failureCountRef.current = 0;
      circuitOpenUntilRef.current = 0;
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err);
      setData(fallbackData);
      setSource("fallback");
      failureCountRef.current += 1;
      if (failureCountRef.current >= CIRCUIT_OPEN_THRESHOLD) {
        circuitOpenUntilRef.current = Date.now() + CIRCUIT_RESET_MS;
      }
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

  const guardedResync = useCallback(
    (reason = "manual") => {
      if (reason === "focus" || reason === "visibility") {
        if (Date.now() < circuitOpenUntilRef.current) return;
      }
      resync(reason);
    },
    [resync]
  );

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
    const handleFocus = () => guardedResync("focus");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") guardedResync("visibility");
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, guardedResync]);

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
