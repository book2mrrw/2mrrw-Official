/**
 * Phase 5.2 — Hybrid master / stream feature flags (server-side only).
 *
 * All flags default OFF. When unset or false, platform behavior is identical
 * to pre–Phase 5.2 master-only playback and upload paths.
 *
 * Rollback: set env vars to 0 or false (or remove) and redeploy — no code change.
 */

/** @type {readonly string[]} */
export const HYBRID_STREAMING_ENV_VARS = Object.freeze([
  "HYBRID_STREAMING_ENABLED",
  "STREAM_PLAYBACK_PREFERRED",
  "AUTO_GENERATE_STREAM_ASSETS",
]);

/**
 * Parse a server env var as boolean.
 * Truthy: "1", "true" (case-insensitive). Everything else is false.
 *
 * @param {string | undefined} raw
 * @returns {boolean}
 */
export function readHybridStreamingEnvBool(raw) {
  if (raw == null || raw === "") return false;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * Master switch for all hybrid streaming code paths (resolver, upload transcode, etc.).
 * Default: false.
 *
 * @returns {boolean}
 */
export function isHybridStreamingEnabled() {
  return readHybridStreamingEnvBool(process.env.HYBRID_STREAMING_ENABLED);
}

/**
 * Prefer stream renditions over masters when a stream asset exists.
 * Gated by {@link isHybridStreamingEnabled}. Default: false.
 *
 * @returns {boolean}
 */
export function isStreamPlaybackPreferred() {
  return isHybridStreamingEnabled() && readHybridStreamingEnvBool(process.env.STREAM_PLAYBACK_PREFERRED);
}

/**
 * Allow upload pipeline to auto-generate stream renditions after master ingest.
 * Gated by {@link isHybridStreamingEnabled}. Default: false.
 *
 * @returns {boolean}
 */
export function isAutoGenerateStreamAssetsEnabled() {
  return (
    isHybridStreamingEnabled() &&
    readHybridStreamingEnvBool(process.env.AUTO_GENERATE_STREAM_ASSETS)
  );
}

/**
 * Snapshot of hybrid streaming flags for diagnostics and future admin surfaces.
 * Safe to log — contains no secrets.
 *
 * @returns {{
 *   hybridStreamingEnabled: boolean,
 *   streamPlaybackPreferred: boolean,
 *   autoGenerateStreamAssets: boolean,
 * }}
 */
export function getHybridStreamingFeatureFlags() {
  return {
    hybridStreamingEnabled: isHybridStreamingEnabled(),
    streamPlaybackPreferred: isStreamPlaybackPreferred(),
    autoGenerateStreamAssets: isAutoGenerateStreamAssetsEnabled(),
  };
}
