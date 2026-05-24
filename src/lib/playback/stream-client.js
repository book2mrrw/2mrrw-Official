/** Client helpers for /api/library/stream signed URL lifecycle. */

export const LIBRARY_STREAM_PATH = "/api/library/stream";
export const STREAM_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

export function isLibraryStreamSrc(src) {
  if (!src || typeof src !== "string") return false;
  try {
    const url = new URL(src, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return url.pathname === LIBRARY_STREAM_PATH;
  } catch {
    return src.includes(LIBRARY_STREAM_PATH);
  }
}

export function parseStreamSlugFromSrc(src) {
  if (!src) return null;
  try {
    const url = new URL(src, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return url.searchParams.get("slug");
  } catch {
    const match = String(src).match(/[?&]slug=([^&]+)/);
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
export async function fetchLibraryStream(slug, { force = false, sessionId = null } = {}) {
  const params = new URLSearchParams({ slug });
  if (force) params.set("force", "true");
  if (sessionId) params.set("sessionId", sessionId);

  const res = await fetch(`${LIBRARY_STREAM_PATH}?${params.toString()}`, {
    credentials: "include",
  });

  if (res.status === 403) {
    const err = new Error("access_denied");
    err.code = "ACCESS_DENIED";
    throw err;
  }
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("concurrent_stream");
    err.code = "CONCURRENT_STREAM";
    err.sessionId = body.sessionId || null;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Stream request failed (${res.status})`);
  }

  return res.json();
}

export async function clearLibraryStreamSession(slug, sessionId) {
  const params = new URLSearchParams({ slug });
  if (sessionId) params.set("sessionId", sessionId);
  await fetch(`${LIBRARY_STREAM_PATH}?${params.toString()}`, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {});
}

export async function endStreamAnalytics(payload) {
  await fetch("/api/stream/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify(payload),
  }).catch(() => {});
}
