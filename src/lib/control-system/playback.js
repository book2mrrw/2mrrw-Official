import { buildControlSystemUrl } from "./client";

const PLAYBACK_EVENTS = new Set(["play", "progress", "complete", "replay", "pause", "seek", "save", "queue_add"]);
const BACKEND_PLAYBACK_EVENTS = new Set(["play", "progress", "complete", "pause", "skip"]);

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

export async function sendControlSystemPlaybackEvent(track, eventType, details = {}) {
  const target = buildControlSystemUrl("/api/playback/events");
  if (!target) return false;

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
      body: JSON.stringify(playbackEventPayload(track, eventType, details)),
    });
    if (!response.ok && process.env.NODE_ENV === "development") {
      console.debug("[playback/events] telemetry failed:", response.status);
    }
    return response.ok;
  } catch {
    if (process.env.NODE_ENV === "development") {
      console.debug("[playback/events] telemetry network error");
    }
    return false;
  }
}
