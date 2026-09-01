import { buildControlSystemUrl } from "./client";
import { telemetry } from "@/system/telemetry/telemetry";
import { PLAYBACK_EVENT_TYPES, mapControlSystemEventType } from "@/system/telemetry/playback-event-types";

const PLAYBACK_EVENTS = new Set(["play", "progress", "complete", "replay", "pause", "seek", "save", "queue_add"]);
const BACKEND_PLAYBACK_EVENTS = new Set(["play", "progress", "complete", "pause", "skip"]);

const DEDUPE_MS = {
  progress: 15000,
  play: 3000,
  pause: 3000,
  seek: 2000,
  replay: 3000,
  complete: 10000,
  default: 3000,
};

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 400;

const lastSentAt = new Map();
let telemetrySuppressed = false;
let inFlightCount = 0;

function isPlaybackEventsDebug() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_DEBUG_PLAYBACK_EVENTS === "1"
  );
}

function debugLog(message, extra) {
  if (!isPlaybackEventsDebug()) return;
  if (extra !== undefined) {
    console.debug(`[playback/events] ${message}`, extra);
  } else {
    console.debug(`[playback/events] ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function controlSessionId() {
  if (typeof window === "undefined") return "";
  const key = "2mrrw_control_session_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const generated = window.crypto?.randomUUID?.() || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, generated);
  return generated;
}

function backendPlaybackEvent(eventType) {
  const normalized = normalizePlaybackEvent(eventType);
  if (normalized === "replay") return "play";
  if (normalized === "seek" || normalized === "save" || normalized === "queue_add") return "progress";
  return BACKEND_PLAYBACK_EVENTS.has(normalized) ? normalized : "progress";
}

export function normalizePlaybackEvent(eventType) {
  const normalized = String(eventType || "").toLowerCase();
  return PLAYBACK_EVENTS.has(normalized) ? normalized : "progress";
}

export function playbackEventPayload(track = {}, eventType = "progress", details = {}) {
  const trackId = track.metadata?.controlSystemTrackId || track.trackId || track.id || track.slug || null;
  const releaseId = track.metadata?.controlSystemReleaseId || track.releaseId || null;
  return {
    eventType: backendPlaybackEvent(eventType),
    trackId,
    releaseId,
    slug: track.slug || null,
    title: track.title || null,
    artist: track.artist || "2MRRW",
    source: track.source || "unknown",
    mediaType: details.mediaType || "audio",
    positionSeconds: Number.isFinite(details.positionSeconds) ? details.positionSeconds : 0,
    durationSeconds: Number.isFinite(details.durationSeconds) ? details.durationSeconds : 0,
    completed: Boolean(details.completed || eventType === "complete"),
    controlSystemReleaseId: releaseId,
    controlSystemTrackId: trackId,
    playbackAccess: track.metadata?.playbackAccess || null,
    clientRecordedAt: new Date().toISOString(),
    metadata: details.metadata || {},
  };
}

function dedupeKey(track, eventType) {
  const slug = track?.slug || track?.id || track?.trackId || "unknown";
  return `${slug}:${normalizePlaybackEvent(eventType)}`;
}

function shouldDispatch(track, eventType) {
  const normalized = normalizePlaybackEvent(eventType);

  if (normalized === "play" || normalized === "replay") {
    telemetrySuppressed = false;
  }

  if (telemetrySuppressed) {
    if (normalized === "progress" || normalized === "pause" || normalized === "seek") {
      debugLog("suppressed", { eventType: normalized, slug: track?.slug });
      return false;
    }
  }

  if (normalized === "complete") {
    telemetrySuppressed = true;
  }

  const key = dedupeKey(track, normalized);
  const windowMs = DEDUPE_MS[normalized] || DEDUPE_MS.default;
  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last != null && now - last < windowMs) {
    debugLog("deduped", { key, ageMs: now - last, windowMs });
    return false;
  }

  lastSentAt.set(key, now);
  return true;
}

/** Clears dedupe state and re-enables telemetry (e.g. audio listener teardown). */
export function resetPlaybackTelemetry() {
  telemetrySuppressed = false;
  lastSentAt.clear();
  debugLog("reset");
}

/** Dev-only snapshot of telemetry guard state. */
export function getPlaybackTelemetryDiagnostics() {
  return {
    suppressed: telemetrySuppressed,
    inFlight: inFlightCount,
    dedupeEntries: lastSentAt.size,
  };
}

async function postPlaybackEvent(target, body, attempt = 0) {
  try {
    const response = await fetch(target.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-control-session-id": controlSessionId(),
      },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify(body),
    });

    if (response.ok) return true;

    const status = response.status;
    debugLog("telemetry failed", { status, attempt });

    if (status >= 400 && status < 500) return false;
    if (attempt >= MAX_RETRIES) return false;

    await sleep(RETRY_BASE_MS * (attempt + 1));
    return postPlaybackEvent(target, body, attempt + 1);
  } catch {
    debugLog("telemetry network error", { attempt });
    if (attempt >= MAX_RETRIES) return false;
    await sleep(RETRY_BASE_MS * (attempt + 1));
    return postPlaybackEvent(target, body, attempt + 1);
  }
}

async function dispatchPlaybackEvent(track, eventType, details = {}) {
  const target = buildControlSystemUrl("/api/playback/events");
  if (!target || !track) return;

  const normalized = normalizePlaybackEvent(eventType);
  if (!shouldDispatch(track, normalized)) return;

  inFlightCount += 1;
  debugLog("dispatch", {
    eventType: normalized,
    slug: track.slug,
    inFlight: inFlightCount,
    ...getPlaybackTelemetryDiagnostics(),
  });

  // Mirror to platform telemetry using canonical event type constants.
  const canonicalType = mapControlSystemEventType(normalized) || PLAYBACK_EVENT_TYPES.PROGRESS;
  telemetry.log({
    type: canonicalType,
    slug: track.slug || null,
    title: track.title || null,
    artist: track.artist || "2MRRW",
    source: track.source || "unknown",
    positionSeconds: Number.isFinite(details.positionSeconds) ? details.positionSeconds : 0,
    durationSeconds: Number.isFinite(details.durationSeconds) ? details.durationSeconds : 0,
    completed: Boolean(details.completed || eventType === "complete"),
  });

  try {
    await postPlaybackEvent(target, playbackEventPayload(track, normalized, details));
  } finally {
    inFlightCount = Math.max(0, inFlightCount - 1);
  }
}

/**
 * Fire-and-forget Control System playback analytics.
 * Never throws; never blocks the audio hot path.
 */
export function sendControlSystemPlaybackEvent(track, eventType, details = {}) {
  void dispatchPlaybackEvent(track, eventType, details);
}
