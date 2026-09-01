/**
 * Phase 5.2.13 — Direct public CDN preview (bypass /api/media/preview redirect).
 *
 * Default OFF. When disabled, preview URLs match pre–5.2.13 behavior exactly.
 *
 * Rollback: set env vars to 0 or unset and redeploy — no code change.
 */

import { readHybridStreamingEnvBool } from "@/lib/feature-flags/hybrid-streaming";

/** @type {readonly string[]} */
export const DIRECT_PREVIEW_ENV_VARS = Object.freeze([
  "DIRECT_PREVIEW_ENABLED",
  "NEXT_PUBLIC_DIRECT_PREVIEW_CDN",
]);

/**
 * Client + SSR: `NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1`
 * Server supplement: `DIRECT_PREVIEW_ENABLED=1` (not exposed to browser bundle alone)
 *
 * @returns {boolean}
 */
export function isDirectPreviewCdnEnabled() {
  if (readHybridStreamingEnvBool(process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN)) {
    return true;
  }
  if (typeof window === "undefined") {
    return readHybridStreamingEnvBool(process.env.DIRECT_PREVIEW_ENABLED);
  }
  return false;
}

/**
 * @returns {{
 *   directPreviewCdnEnabled: boolean,
 *   nextPublicDirectPreviewCdn: boolean,
 *   directPreviewEnabledServer: boolean,
 * }}
 */
export function getDirectPreviewFeatureFlags() {
  const nextPublicDirectPreviewCdn = readHybridStreamingEnvBool(
    process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN
  );
  const directPreviewEnabledServer =
    typeof window === "undefined"
      ? readHybridStreamingEnvBool(process.env.DIRECT_PREVIEW_ENABLED)
      : false;
  return {
    directPreviewCdnEnabled: isDirectPreviewCdnEnabled(),
    nextPublicDirectPreviewCdn,
    directPreviewEnabledServer,
  };
}
