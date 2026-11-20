/**
 * Playback analytics — event schema v1. Pure and isomorphic: no imports, no
 * I/O, so the browser sender, the ingest route and the tests share one
 * definition of what an event is.
 *
 * Owner rules this encodes (2026-11-19):
 *  - Analytics are a permanent career record; events are never deleted.
 *  - "Downloads" are in-app offline saves, never files on the phone.
 *  - A qualified play is 30 seconds of actual listening, or the whole song
 *    when the song is shorter than that. (Default; change QUALIFIED_PLAY_SECONDS.)
 */

export const ANALYTICS_SCHEMA_VERSION = 1;
export const QUALIFIED_PLAY_SECONDS = 30;
export const MAX_EVENTS_PER_REQUEST = 50;

/** Every event type schema v1 can store. */
export const PLAYBACK_EVENT_TYPES = Object.freeze([
  "play", "qualified", "progress", "pause", "seek", "skip", "complete",
  "replay", "save", "download", "download_remove",
]);

/** The only types the pre-v1 table check constraint accepts. */
export const LEGACY_EVENT_TYPES = Object.freeze(["play", "progress", "complete", "replay", "save"]);

export const MEDIA_TYPES = Object.freeze(["audio", "video", "livestream", "vault"]);
export const PLATFORMS = Object.freeze(["web", "ios", "android"]);
export const ACCESS_TIERS = Object.freeze(["full", "preview", "admin"]);
export const DEVICE_CLASSES = Object.freeze(["phone", "tablet", "desktop"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CLIENT_SKEW_MS = 5 * 60 * 1000;            // client clock ahead of server
const MAX_OFFLINE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // oldest offline event accepted

export function cleanUuid(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

export function cleanSlug(value) {
  return String(value ?? "").trim().slice(0, 160);
}

function cleanText(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function cleanSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function cleanEventType(value) {
  const s = String(value || "").toLowerCase();
  return PLAYBACK_EVENT_TYPES.includes(s) ? s : "progress";
}

/** How a v1 event type is stored when the v1 migration is not applied yet. */
export function legacyEventType(eventType) {
  if (LEGACY_EVENT_TYPES.includes(eventType)) return eventType;
  if (eventType === "download" || eventType === "download_remove") return null; // not storable pre-v1
  return "progress"; // qualified / pause / seek / skip were always stored as progress before v1
}

/**
 * True once a listen counts as a qualified play: QUALIFIED_PLAY_SECONDS of
 * real listening, or (for a song shorter than that) listening to all of it.
 */
export function isQualifiedListen(listenedSeconds, durationSeconds) {
  const listened = cleanSeconds(listenedSeconds);
  if (listened <= 0) return false;
  if (listened >= QUALIFIED_PLAY_SECONDS) return true;
  const duration = cleanSeconds(durationSeconds);
  return duration > 0 && duration < QUALIFIED_PLAY_SECONDS && listened >= duration - 1;
}

/**
 * Counts seconds actually heard for the current listen. Only forward movement
 * of at most MAX_STEP_SECONDS between samples counts — seeks, scrubs and
 * stalls add nothing — so a listener can't qualify a play by dragging the
 * scrubber. One instance per player; begin() starts a new listen.
 */
const MAX_STEP_SECONDS = 2.5;
export function createListenTracker(randomId = () => null) {
  let state = { key: null, listenId: null, lastPosition: 0, listened: 0, qualifiedSent: false };
  return {
    begin(key, position = 0) {
      state = { key, listenId: randomId(), lastPosition: cleanSeconds(position), listened: 0, qualifiedSent: false };
      return state.listenId;
    },
    /** Feed the current position. Returns true exactly once, when the listen first qualifies. */
    advance(key, position, { playing = true, durationSeconds = 0 } = {}) {
      if (key !== state.key) return false;
      const pos = cleanSeconds(position);
      const step = pos - state.lastPosition;
      state.lastPosition = pos;
      if (playing && step > 0 && step <= MAX_STEP_SECONDS) state.listened += step;
      if (!state.qualifiedSent && isQualifiedListen(state.listened, durationSeconds)) {
        state.qualifiedSent = true;
        return true;
      }
      return false;
    },
    /** Re-anchor after a seek so the jump itself is not counted. */
    reanchor(key, position) {
      if (key === state.key) state.lastPosition = cleanSeconds(position);
    },
    snapshot() {
      return { key: state.key, listenId: state.listenId, listenedSeconds: Math.round(state.listened * 100) / 100, qualified: state.qualifiedSent };
    },
  };
}

function clientRecordedAt(value, now) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  if (t > now + MAX_CLIENT_SKEW_MS || t < now - MAX_OFFLINE_AGE_MS) return null;
  return new Date(t).toISOString();
}

function decodeHeader(value) {
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * Where the listener is, from Vercel's edge geolocation headers. Vercel names
 * the region header x-vercel-ip-country-region (ISO 3166-2 subdivision code,
 * e.g. "TX"); the old code read x-vercel-ip-region, which does not exist, so
 * region was empty on every event.
 */
export function geoFromHeaders(headers) {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : null);
  return {
    country: cleanText(get("x-vercel-ip-country"), 8),
    region: cleanText(get("x-vercel-ip-country-region"), 16),
    city: cleanText(decodeHeader(get("x-vercel-ip-city")), 120),
  };
}

/**
 * Rate-limit identity for the ingest route: the signed-in listener, else
 * undefined so the limiter falls back to the client IP. Never the song —
 * keying by song made every anonymous listener of a track share one bucket.
 * Device IDs are client-chosen, so they are not trusted for limiting.
 */
export function rateLimitIdentity(user) {
  return user?.id ? `user:${user.id}` : undefined;
}

/**
 * Turn one client event into the stored row. `user` comes from the session on
 * the server (never from the body); admins are flagged server-side.
 * Returns { row, legacyRow } — legacyRow is what fits the pre-v1 table, or
 * null when the event cannot be stored there at all.
 */
export function buildPlaybackEventRow({ body = {}, user = null, geo = {}, productId = null, now = Date.now() } = {}) {
  const eventType = body.completed === true ? "complete" : cleanEventType(body.eventType);
  const positionSeconds = Math.floor(cleanSeconds(body.positionSeconds));
  const durationSeconds = Math.floor(cleanSeconds(body.durationSeconds));
  const completionRate = durationSeconds > 0 ? Math.max(0, Math.min(1, positionSeconds / durationSeconds)) : null;
  const mediaType = MEDIA_TYPES.includes(body.mediaType) ? body.mediaType : "audio";
  const isInternal = Boolean(user?.isAdmin);
  const requestedTier = ACCESS_TIERS.includes(body.accessTier) ? body.accessTier : "full";
  const accessTier = isInternal ? "admin" : (requestedTier === "admin" ? "full" : requestedTier);
  const listened = cleanSeconds(body.listenedSeconds);

  const legacy = {
    user_id: user?.id || null,
    product_slug: cleanSlug(body.slug),
    product_id: productId,
    event_type: eventType,
    media_type: mediaType,
    position_seconds: positionSeconds,
    duration_seconds: durationSeconds,
    completion_rate: completionRate,
    country: geo.country ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    metadata: {
      title: cleanText(body.title, 200),
      source: cleanText(body.source, 60) || "web-player",
    },
  };

  const row = {
    ...legacy,
    event_id: cleanUuid(body.eventId),
    device_id: cleanUuid(body.deviceId),
    session_id: cleanUuid(body.sessionId),
    listen_id: cleanUuid(body.listenId),
    release_slug: cleanText(body.releaseSlug, 160),
    track_slug: cleanText(body.trackSlug, 160),
    listened_seconds: listened > 0 ? Math.round(Math.min(listened, 24 * 3600) * 100) / 100 : null,
    platform: PLATFORMS.includes(body.platform) ? body.platform : null,
    device_class: DEVICE_CLASSES.includes(body.deviceClass) ? body.deviceClass : null,
    access_tier: accessTier,
    is_internal: isInternal,
    offline: body.offline === true,
    client_recorded_at: clientRecordedAt(body.clientRecordedAt, now),
    schema_version: ANALYTICS_SCHEMA_VERSION,
  };

  const legacyType = legacyEventType(eventType);
  const legacyRow = legacyType ? { ...legacy, event_type: legacyType } : null;
  return { row, legacyRow };
}

/** Postgres / PostgREST errors that mean "the v1 migration is not applied yet". */
export function isPreV1SchemaError(error) {
  const code = String(error?.code || "");
  if (["42703", "PGRST204", "23514", "42P10"].includes(code)) return true;
  return /column .* does not exist|Could not find the '.*' column|violates check constraint|no unique or exclusion constraint/i.test(String(error?.message || ""));
}
