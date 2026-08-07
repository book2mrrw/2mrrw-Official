/** Client helpers for /api/library/stream signed URL lifecycle. */

import { logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";
import { logStreamLifecycle } from "@/lib/diagnostics/playback-trace";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";

export const LIBRARY_STREAM_PATH = "/api/library/stream";
export const STREAM_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const AUDIO_CONTENT_TYPE_RE = /^(audio\/|application\/octet-stream)/i;
const HEAD_VALIDATION_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { contentType: string, validatedAt: number }>} */
const signedUrlHeadValidationCache = new Map();

function headValidationCacheKey(slug, sessionId = null) {
  // Cache by slug+sessionId, NOT by the full signed URL. R2 signed URLs include
  // expiry tokens that rotate on every /api/library/stream fetch, which would
  // cause a HEAD request on every signed-URL refresh (50–200 ms latency each time).
  // The R2 object key (and therefore content-type) doesn't change between refreshes,
  // so once-per-track-per-session validation is sufficient.
  return `${slug || ""}:${sessionId || ""}`;
}

function createStreamClientError(message, details = {}) {
  const err = new Error(message);
  Object.assign(err, details);
  return err;
}

function assertJsonContentType(res, slug) {
  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("application/json")) {
    throw createStreamClientError("library_stream_invalid_content_type", {
      code: "INVALID_STREAM_CONTENT_TYPE",
      slug,
      status: res.status,
      contentType: type || null,
    });
  }
}

async function assertSignedAudioUrl(url, { slug, signal, sessionId = null } = {}) {
  const cacheKey = headValidationCacheKey(slug, sessionId);
  const cached = signedUrlHeadValidationCache.get(cacheKey);
  if (cached && Date.now() - cached.validatedAt < HEAD_VALIDATION_TTL_MS) {
    // Reinsert to move this entry to the tail so FIFO eviction keeps recently-used entries.
    signedUrlHeadValidationCache.delete(cacheKey);
    signedUrlHeadValidationCache.set(cacheKey, cached);
    return cached.contentType;
  }

  const res = await fetch(url, {
    method: "HEAD",
    credentials: isLibraryStreamSrc(url) ? "include" : "omit",
    signal,
  });
  if (!res.ok) {
    throw createStreamClientError("signed_stream_unreachable", {
      code: "SIGNED_STREAM_UNREACHABLE",
      slug,
      status: res.status,
    });
  }
  const type = String(res.headers.get("content-type") || "");
  if (!AUDIO_CONTENT_TYPE_RE.test(type)) {
    throw createStreamClientError("signed_stream_invalid_content_type", {
      code: "SIGNED_STREAM_INVALID_CONTENT_TYPE",
      slug,
      status: res.status,
      contentType: type || null,
    });
  }
  signedUrlHeadValidationCache.set(cacheKey, { contentType: type, validatedAt: Date.now() });
  while (signedUrlHeadValidationCache.size > 128) {
    const oldest = signedUrlHeadValidationCache.keys().next().value;
    if (oldest) signedUrlHeadValidationCache.delete(oldest);
    else break;
  }
  return type;
}

export function isLibraryStreamSrc(src) {
  if (!src || typeof src !== "string") return false;
  try {
    const url = src.startsWith("/api/")
      ? { href: src, pathname: src.split("?")[0], searchParams: new URLSearchParams(src.split("?")[1] || "") }
      : new URL(src, typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost");
    return url.pathname === LIBRARY_STREAM_PATH;
  } catch {
    return src.includes(LIBRARY_STREAM_PATH);
  }
}

/** True when the browser can load the stream URL directly (same-origin proxy) without a JSON prefetch. */
export function isLibraryStreamRedirectSrc(src) {
  if (!isLibraryStreamSrc(src)) return false;
  try {
    const url = src.startsWith("/api/")
      ? { href: src, pathname: src.split("?")[0], searchParams: new URLSearchParams(src.split("?")[1] || "") }
      : new URL(src, typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost");
    return url.searchParams.get("redirect") === "1";
  } catch {
    return String(src).includes("redirect=1");
  }
}

export function parseStreamSlugFromSrc(src) {
  if (!src) return null;
  try {
    const url = src.startsWith("/api/")
      ? { href: src, pathname: src.split("?")[0], searchParams: new URLSearchParams(src.split("?")[1] || "") }
      : new URL(src, typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost");
    return url.searchParams.get("slug");
  } catch {
    const match = String(src).match(/[?&]slug=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

export function parseStreamTrackSlugFromSrc(src) {
  if (!src) return null;
  try {
    const url = src.startsWith("/api/")
      ? { href: src, pathname: src.split("?")[0], searchParams: new URLSearchParams(src.split("?")[1] || "") }
      : new URL(src, typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost");
    return url.searchParams.get("trackSlug");
  } catch {
    const match = String(src).match(/[?&]trackSlug=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

export function streamUrlNeedsRefresh(meta, now = Date.now()) {
  if (!meta?.url || !meta?.fetchedAt) return true;
  const expiresInMs = (meta.expiresIn || 3600) * 1000;
  const expiresAt = meta.fetchedAt + expiresInMs;
  return expiresAt - now <= STREAM_REFRESH_BEFORE_EXPIRY_MS;
}

/**
 * Fetch signed stream URL JSON from library/stream.
 * @returns {Promise<{ url: string, expiresIn: number, streamEventId?: string, sessionId?: string }>}
 */
export async function fetchLibraryStream(
  slug,
  { force = false, sessionId = null, trackSlug = null, signal = undefined } = {}
) {
  perfMark(MARKS.PLAYBACK_RESOLVER_START);
  logStreamLifecycle("start", { source: "stream-client", slug, force, trackSlug });
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        logStreamLifecycle("abort", { source: "stream-client", slug, trackSlug });
      },
      { once: true }
    );
  }
  const params = new URLSearchParams({ slug });
  if (force) params.set("force", "true");
  if (sessionId) params.set("sessionId", sessionId);
  if (trackSlug) params.set("trackSlug", String(trackSlug));

  const res = await fetch(`${LIBRARY_STREAM_PATH}?${params.toString()}`, {
    credentials: "include",
    signal,
  });

  if (res.status === 403 || res.status === 401) {
    logPlaybackResilience("stream-auth-denied", {
      source: "stream-client",
      code: res.status === 401 ? "AUTHENTICATION_REQUIRED" : "ACCESS_DENIED",
      slug,
      status: res.status,
    });
    console.error(
      `[stream-client] library stream ${res.status} for slug=${slug}`
    );
    import("@/system/telemetry")
      .then(({ telemetry }) => {
        telemetry.log({
          type: "signed.url.expired",
          assetId: slug,
          context: "library_stream",
          status: res.status,
        });
      })
      .catch((error) => {
        console.warn("[stream-client] telemetry import failed", {
          slug,
          status: res.status,
          message: error?.message || String(error),
        });
      });
    const err = new Error(
      res.status === 401 ? "authentication_required" : "access_denied"
    );
    err.code = "ACCESS_DENIED";
    err.status = res.status;
    err.slug = slug;
    throw err;
  }
  if (res.status === 409) {
    assertJsonContentType(res, slug);
    const body = await res.json().catch(() => ({}));
    const err = new Error("concurrent_stream");
    err.code = "CONCURRENT_STREAM";
    err.sessionId = body.sessionId || null;
    throw err;
  }
  if (res.status === 404 || res.status === 422) {
    let body = {};
    try {
      assertJsonContentType(res, slug);
      body = await res.json();
    } catch {
      body = {};
    }
    logPlaybackResilience("stream-unavailable", {
      source: "stream-client",
      code: body.code || "MEDIA_UNAVAILABLE",
      slug,
      status: res.status,
    });
    const err = new Error(body.error || "Stream asset not found");
    err.code = body.code || "MEDIA_UNAVAILABLE";
    err.status = res.status;
    err.slug = slug;
    throw err;
  }
  if (!res.ok) {
    assertJsonContentType(res, slug);
    const body = await res.json().catch(() => ({}));
    logPlaybackResilience("stream-request-failed", {
      source: "stream-client",
      code: body.code || "STREAM_REQUEST_FAILED",
      slug,
      status: res.status,
    });
    const err = new Error(body.error || `Stream request failed (${res.status})`);
    err.code = body.code || null;
    err.status = res.status;
    err.slug = slug;
    throw err;
  }

  assertJsonContentType(res, slug);
  const body = await res.json();
  if (!body?.url || typeof body.url !== "string") {
    logPlaybackResilience("stream-missing-url", {
      source: "stream-client",
      code: "SIGNED_STREAM_MISSING_URL",
      slug,
    });
    throw createStreamClientError("signed_stream_missing_url", {
      code: "SIGNED_STREAM_MISSING_URL",
      slug,
    });
  }
  perfMark(MARKS.PLAYBACK_RESOLVER_END);
  // Same-origin proxy URLs (/api/library/stream?redirect=1) always return audio — skip HEAD
  // validation for them. assertSignedAudioUrl was designed for direct signed R2 URLs; calling
  // it with a proxy URL makes a redundant authenticated request that creates an extra session.
  let contentType = "audio/mpeg";
  if (!isLibraryStreamSrc(body.url)) {
    contentType = await assertSignedAudioUrl(body.url, {
      slug,
      signal,
      sessionId: body.sessionId || sessionId || null,
    });
  }
  perfMark(MARKS.PLAYBACK_SIGNED_URL);
  logStreamLifecycle("ready", {
    source: "stream-client",
    slug,
    trackSlug,
    hasSession: Boolean(body.sessionId),
  });
  return {
    ...body,
    contentType,
  };
}

export async function clearLibraryStreamSession(slug, sessionId) {
  logStreamLifecycle("replace", {
    source: "stream-client",
    slug,
    phase: "clear-session",
    sessionId: sessionId || null,
  });
  const params = new URLSearchParams({ slug });
  if (sessionId) params.set("sessionId", sessionId);
  await fetch(`${LIBRARY_STREAM_PATH}?${params.toString()}`, {
    method: "DELETE",
    credentials: "include",
  }).catch((error) => {
    console.warn("[stream-client] clear session failed", {
      slug,
      sessionId: sessionId || null,
      message: error?.message || String(error),
    });
  });
}

export async function endStreamAnalytics(payload) {
  await fetch("/api/stream/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.warn("[stream-client] end analytics failed", {
      streamEventId: payload?.streamEventId || null,
      sessionId: payload?.sessionId || null,
      message: error?.message || String(error),
    });
  });
}
