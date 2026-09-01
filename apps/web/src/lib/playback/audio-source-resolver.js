/**
 * AudioSourceResolver — source classification and resolution abstraction.
 *
 * The playback engine must not make assumptions about network topology.
 * All source URL analysis routes through this module so that future
 * offline / cached / CDN-edge variants can be added in one place.
 */

export const SOURCE_KIND = Object.freeze({
  CDN: "cdn",                      // Direct CDN URL — no auth, directly bufferable
  LIBRARY_STREAM: "library_stream", // /api/library/stream — requires signed-URL fetch
  REDIRECT: "redirect",            // /api/library/stream?redirect=1 — fast-path redirect
  PREVIEW: "preview",              // /api/media/preview — unauthenticated clip
  UNKNOWN: "unknown",
});

/**
 * Classify a source URL into a SOURCE_KIND without network I/O.
 * Uses URL pathname for matching so query-parameter values cannot spoof the kind.
 * @param {string} src
 * @returns {keyof typeof SOURCE_KIND}
 */
export function classifySourceUrl(src) {
  if (!src || typeof src !== "string") return SOURCE_KIND.UNKNOWN;
  let pathname = src;
  let redirect = false;
  try {
    const parsed = new URL(src, "http://localhost");
    pathname = parsed.pathname;
    redirect = parsed.searchParams.get("redirect") === "1";
  } catch {
    // Malformed URL — fall through with raw string
    redirect = src.includes("redirect=1");
  }
  if (pathname === "/api/library/stream" || pathname.endsWith("/api/library/stream")) {
    return redirect ? SOURCE_KIND.REDIRECT : SOURCE_KIND.LIBRARY_STREAM;
  }
  if (pathname.includes("/api/media/preview")) return SOURCE_KIND.PREVIEW;
  return SOURCE_KIND.CDN;
}

/**
 * True when the browser can buffer this source in a hidden Audio element
 * without first obtaining a separate signed URL.
 * @param {keyof typeof SOURCE_KIND} kind
 */
export function isDirectlyBufferable(kind) {
  return kind === SOURCE_KIND.CDN || kind === SOURCE_KIND.PREVIEW || kind === SOURCE_KIND.REDIRECT;
}

/**
 * True when the source must be resolved to a signed URL before buffering.
 * @param {keyof typeof SOURCE_KIND} kind
 */
export function requiresSignedUrlFetch(kind) {
  return kind === SOURCE_KIND.LIBRARY_STREAM;
}
