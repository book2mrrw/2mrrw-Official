"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { buildControlSystemUrl, getControlSystemApiUrl } from "@/lib/control-system/client";

const EVENT_TYPES = [
  "release.created",
  "release.updated",
  "release.published",
  "release.deleted",
  "media.uploaded",
  "media.replaced",
  "hero.updated",
  "vault.updated",
  "audio_visuals.updated",
  "release_created",
  "release_updated",
  "release_published",
  "release_deleted",
  "media_updated",
  "media_replaced",
  "hero_updated",
];

const LEGACY_EVENT_TYPES = {
  release_created: "release.created",
  release_updated: "release.updated",
  release_published: "release.published",
  release_deleted: "release.deleted",
  media_updated: "media.uploaded",
  media_replaced: "media.replaced",
  hero_updated: "hero.updated",
};

const STORAGE_KEY = "2mrrw_control_last_event_time";
const RECONNECT_BASE_MS = 1200;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 8;
const MIN_HEALTHY_CONNECTION_MS = 5000;

let source = null;
let refCount = 0;
let reconnectTimer = null;
let reconnectAttempt = 0;
let connectionOpenedAt = 0;
let status = {
  connected: false,
  connecting: false,
  error: null,
  lastEventAt: null,
  lastEventId: null,
  replayed: false,
};
let snapshot = { status, events: [] };
const listeners = new Set();

function notify() {
  snapshot = { status, events: snapshot.events };
  listeners.forEach((listener) => listener());
}

function updateStatus(nextStatus) {
  status = { ...status, ...nextStatus };
  notify();
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const normalizedType = LEGACY_EVENT_TYPES[event.type] || event.type;
  return {
    ...event,
    type: normalizedType,
    rawType: event.type,
    timestamp: Number(event.timestamp) || Date.now(),
  };
}

function rememberEvent(event) {
  if (!event) return;
  const createdAt = event.createdAt || new Date(event.timestamp).toISOString();
  try {
    window.localStorage?.setItem(STORAGE_KEY, createdAt);
  } catch {}
  status = {
    ...status,
    lastEventAt: createdAt,
    lastEventId: event.id || status.lastEventId,
  };
}

function emit(event) {
  const normalized = normalizeEvent(event);
  if (!normalized) return;
  rememberEvent(normalized);
  snapshot = {
    status,
    events: [normalized, ...snapshot.events].slice(0, 100),
  };
  notify();
}

function parseMessage(message) {
  try {
    emit(JSON.parse(message.data));
  } catch {
    updateStatus({ error: "Realtime event payload could not be parsed." });
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (refCount <= 0 || reconnectTimer) return;
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    console.warn("[sync] SSE: max reconnect attempts reached, going silent");
    updateStatus({ connected: false, connecting: false, error: "Realtime connection paused after repeated failures." });
    return;
  }
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function replayMissedEvents() {
  const target = buildControlSystemUrl("/api/sync/replay", {
    lastEventTime: window.localStorage?.getItem(STORAGE_KEY) || undefined,
    limit: 100,
  });
  if (!target) return;
  try {
    const response = await fetch(target.href, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    const payload = await response.json();
    const events = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    events.forEach(emit);
    updateStatus({ replayed: true });
  } catch {
    // Replay is opportunistic; EventSource reconnect remains the primary path.
  }
}

function connect() {
  if (typeof window === "undefined" || source || !getControlSystemApiUrl()) return;
  const target = buildControlSystemUrl("/api/sync/stream");
  if (!target) return;

  updateStatus({ connecting: true, error: null });
  const previousConnectionHealthy =
    connectionOpenedAt > 0 && Date.now() - connectionOpenedAt >= MIN_HEALTHY_CONNECTION_MS;
  if (previousConnectionHealthy) {
    void replayMissedEvents();
  }

  source = new EventSource(target.href, { withCredentials: true });
  connectionOpenedAt = Date.now();
  source.addEventListener("connected", (message) => {
    reconnectAttempt = 0;
    connectionOpenedAt = Date.now();
    updateStatus({ connected: true, connecting: false, error: null });
    parseMessage(message);
  });
  source.addEventListener("heartbeat", () => {
    updateStatus({ connected: true, connecting: false, error: null });
  });
  EVENT_TYPES.forEach((type) => {
    source.addEventListener(type, parseMessage);
  });
  source.onmessage = parseMessage;
  source.onerror = () => {
    source?.close();
    source = null;
    connectionOpenedAt = 0;
    updateStatus({ connected: false, connecting: false, error: "Realtime connection lost." });
    scheduleReconnect();
  };
}

function disconnect() {
  clearReconnectTimer();
  source?.close();
  source = null;
  updateStatus({ connected: false, connecting: false });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return { status, events: [] };
}

export function useRealtimeEvents({ enabled = true, onEvent } = {}) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const deliveredEventIdRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    refCount += 1;
    connect();
    return () => {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) disconnect();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof onEvent !== "function") return undefined;
    const unsubscribe = subscribe(() => {
      const event = getSnapshot().events[0];
      const eventId = event?.id || `${event?.type}:${event?.timestamp}`;
      if (event && eventId !== deliveredEventIdRef.current) {
        deliveredEventIdRef.current = eventId;
        onEvent(event);
      }
    });
    return unsubscribe;
  }, [enabled, onEvent]);

  return state;
}

export { EVENT_TYPES };
