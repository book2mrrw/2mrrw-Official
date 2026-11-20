/**
 * Browser side of playback analytics (schema v1).
 *
 * Fire-and-forget: nothing here touches React state, the audio element or the
 * render tree, and nothing is awaited on the playback path. Events that can't
 * be delivered (offline listening in the app, a dropped connection, a 5xx)
 * wait in a small on-device outbox and are sent later with their original
 * timestamps, so offline listening still counts.
 */
import { ANALYTICS_SCHEMA_VERSION, MAX_EVENTS_PER_REQUEST, createListenTracker } from "@/lib/analytics/playback-events";
import { isAppShell } from "@/lib/platform/app-shell";
import { nativeAudioPlatform } from "@/lib/playback/native-audio";

const ENDPOINT = "/api/media/playback";
const DEVICE_KEY = "2mrrw_analytics_device";
const OUTBOX_KEY = "2mrrw_analytics_outbox";
const OUTBOX_MAX = 1000;

let sessionId = null;
let flushing = false;
let listenersInstalled = false;

function storage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

export function randomId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  return null; // server stores null rather than a weak id
}

/**
 * Anonymous, first-party, per-install ID — no fingerprinting. In the app the
 * native layer owns it, so web and native events from one phone are one
 * listener.
 */
export function analyticsDeviceId() {
  const nativeId = nativeAudioPlatform()?.analyticsDeviceId;
  if (typeof nativeId === "string" && nativeId) return nativeId;
  const store = storage();
  try {
    const existing = store?.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = randomId();
    if (created) store?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** One ID per page load (one listening session). */
export function analyticsSessionId() {
  if (!sessionId) sessionId = randomId();
  return sessionId;
}

/**
 * phone | tablet | desktop — splits mobile web from desktop web (and phones
 * from tablets in the app). From the user agent plus touch support, since
 * iPadOS reports a desktop Safari user agent.
 */
export function analyticsDeviceClass() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  const touchPoints = Number(navigator.maxTouchPoints) || 0;
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1)) return "tablet";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "phone" : "tablet";
  if (/iphone|ipod|mobile|windows phone/i.test(ua)) return "phone";
  return "desktop";
}

/**
 * True when the app's native player records listening itself (it keeps
 * counting on the lock screen and in the background, where this web layer is
 * suspended). The web layer then sends no playback events, so nothing is
 * counted twice.
 */
export function nativeRecordsPlayback() {
  return nativeAudioPlatform()?.recordsPlaybackAnalytics === true;
}

const PLAYBACK_EVENTS = new Set(["play", "qualified", "progress", "pause", "seek", "skip", "complete", "replay", "save"]);

export function analyticsPlatform() {
  if (!isAppShell()) return "web";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod|macintosh/i.test(ua)) return "ios";
  return "web";
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * The recording a track plays: release slug + song slug inside it. Mirrors
 * streamIdentityForTrack (stream-client.js) without throwing.
 */
export function recordingIdentity(track = {}) {
  const meta = track.metadata || {};
  const albumSlug = track.albumSlug || meta.albumSlug || null;
  const trackSlug = track.trackSlug || meta.trackSlug || meta.track_slug || null;
  const releaseSlug = albumSlug || track.slug || null;
  return { releaseSlug, trackSlug: trackSlug || (albumSlug && track.slug && track.slug !== albumSlug ? track.slug : null), albumSlug };
}

/** Stable key for "this recording" — the listen tracker resets when it changes. */
export function listenKey(track) {
  const { releaseSlug, trackSlug } = recordingIdentity(track || {});
  return `${releaseSlug || ""}:${trackSlug || ""}`;
}

/** The player's one listen tracker (there is one player per page). */
export const listenTracker = createListenTracker(randomId);

/** True when this track's events must not count as a fan's listen. */
export function isNonCountingTrack(track) {
  const access = track?.metadata?.access;
  return Boolean(access?.previewOnly || access?.admin);
}

export function accessTierForTrack(track = {}) {
  const access = track.metadata?.access || {};
  if (access.admin) return "admin"; // the server decides admin from the session regardless
  if (access.previewOnly) return "preview";
  return "full";
}

/** Build one v1 event for a track. */
export function buildClientEvent(track, eventType, details = {}) {
  const { releaseSlug, trackSlug, albumSlug } = recordingIdentity(track);
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    eventId: randomId(),
    eventType,
    slug: track.slug,
    albumSlug,
    releaseSlug,
    trackSlug,
    title: track.title || null,
    source: track.source || null,
    mediaType: details.mediaType || "audio",
    positionSeconds: Number.isFinite(details.positionSeconds) ? details.positionSeconds : 0,
    durationSeconds: Number.isFinite(details.durationSeconds) ? details.durationSeconds : 0,
    listenedSeconds: Number.isFinite(details.listenedSeconds) ? details.listenedSeconds : undefined,
    listenId: details.listenId || null,
    completed: eventType === "complete",
    accessTier: accessTierForTrack(track),
    deviceId: analyticsDeviceId(),
    sessionId: analyticsSessionId(),
    platform: analyticsPlatform(),
    deviceClass: analyticsDeviceClass(),
    offline: isOffline(),
    clientRecordedAt: new Date().toISOString(),
    ...(details.extra || {}),
  };
}

// ── Outbox ────────────────────────────────────────────────────────────────────

export function readOutbox() {
  try {
    const parsed = JSON.parse(storage()?.getItem(OUTBOX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(events) {
  try {
    const store = storage();
    if (!store) return;
    if (events.length) store.setItem(OUTBOX_KEY, JSON.stringify(events.slice(-OUTBOX_MAX)));
    else store.removeItem(OUTBOX_KEY);
  } catch { /* quota or blocked storage: drop silently, never break playback */ }
}

export function enqueueEvent(event) {
  writeOutbox([...readOutbox(), event]);
}

function post(body, { keepalive = true } = {}) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive,
    body: JSON.stringify(body),
  });
}

/** Retry later on network failure, 429 and 5xx; drop on other 4xx (bad event). */
function shouldRetry(status) {
  return status === 0 || status === 429 || status >= 500;
}

/** Send queued events in batches. Safe to call often; one flush at a time. */
export async function flushOutbox() {
  if (flushing || isOffline()) return;
  if (!readOutbox().length) return;
  flushing = true;
  try {
    // Sent events are always at the head of the outbox and new ones are only
    // appended, so after each batch exactly that many entries come off the head.
    for (let round = 0; round < 40; round += 1) {
      const batch = readOutbox().slice(0, MAX_EVENTS_PER_REQUEST);
      if (!batch.length) break;
      let status = 0;
      try {
        // Batches can exceed keepalive's 64 KB budget; flushes happen while the page is alive.
        status = (await post({ events: batch }, { keepalive: false })).status;
      } catch {
        status = 0;
      }
      if (shouldRetry(status)) break;
      writeOutbox(readOutbox().slice(batch.length));
    }
  } finally {
    flushing = false;
  }
}

function installListeners() {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("online", () => { void flushOutbox(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushOutbox();
  });
}

/**
 * Send one event now, or queue it. Never throws, never blocks.
 * @param {object} event from buildClientEvent
 * @param {(error: unknown) => void} [onFailure] diagnostics hook
 */
export function sendPlaybackEvent(event, onFailure) {
  installListeners();
  if (!event?.slug) return;
  if (PLAYBACK_EVENTS.has(event.eventType) && nativeRecordsPlayback()) return;
  if (isOffline()) {
    enqueueEvent(event);
    return;
  }
  post(event)
    .then((res) => {
      if (shouldRetry(res.status)) enqueueEvent(event);
      else if (res.ok && readOutbox().length) void flushOutbox();
    })
    .catch((error) => {
      enqueueEvent(event);
      onFailure?.(error);
    });
}
