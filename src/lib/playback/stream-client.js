/** Client helpers for /api/library/stream signed URL lifecycle. */

export const LIBRARY_STREAM_PATH = "/api/library/stream";
export const STREAM_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const AUDIO_CONTENT_TYPE_RE = /^(audio\/|application\/octet-stream)/i;

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

async function assertSignedAudioUrl(url, { slug, signal } = {}) {
  const res = await fetch(url, {
    method: "HEAD",
    credentials: "omit",
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

/** True when the browser can load the stream URL directly (302 to signed R2) without a JSON prefetch. */
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
  { force = false, sessionId = null, signal = undefined } = {}
) {
  const params = new URLSearchParams({ slug });
  if (force) params.set("force", "true");
  if (sessionId) params.set("sessionId", sessionId);

  const res = await fetch(`${LIBRARY_STREAM_PATH}?${params.toString()}`, {
    credentials: "include",
    signal,
  });

  if (res.status === 403 || res.status === 401) {
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
  if (res.status === 404) {
    const err = new Error("Stream asset not found");
    err.status = 404;
    err.slug = slug;
    throw err;
  }
  if (!res.ok) {
    assertJsonContentType(res, slug);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Stream request failed (${res.status})`);
  }

  assertJsonContentType(res, slug);
  const body = await res.json();
  if (!body?.url || typeof body.url !== "string") {
    throw createStreamClientError("signed_stream_missing_url", {
      code: "SIGNED_STREAM_MISSING_URL",
      slug,
    });
  }
  const contentType = await assertSignedAudioUrl(body.url, { slug, signal });
  return {
    ...body,
    contentType,
  };
}

export async function clearLibraryStreamSession(slug, sessionId) {
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
