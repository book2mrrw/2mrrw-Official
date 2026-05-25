/** Documented public R2 dev URL (previews/, artwork/, images/). */
export const R2_PUBLIC_CDN_FALLBACK = "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev";

/**
 * Base URL for browser-loadable public objects (no signing).
 * Uses NEXT_PUBLIC_R2_PUBLIC_URL when set; otherwise the documented fallback CDN.
 */
export function getPublicCdnBase() {
  const env = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "").replace(/\/$/, "");
  return env || R2_PUBLIC_CDN_FALLBACK.replace(/\/$/, "");
}

let warnedPublicCdnMismatch = false;

/** Dev-only hint when env public CDN differs from the known-good fallback (often 401 without R2 public access). */
export function warnPublicCdnEnvMismatch() {
  if (warnedPublicCdnMismatch || process.env.NODE_ENV === "production") return;
  const env = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "").replace(/\/$/, "");
  const fallback = R2_PUBLIC_CDN_FALLBACK.replace(/\/$/, "");
  if (env && env !== fallback) {
    warnedPublicCdnMismatch = true;
    console.warn(
      "[2MRRW Storefront] NEXT_PUBLIC_R2_PUBLIC_URL differs from documented public CDN. " +
        "If previews or covers return 401, point env at the public r2.dev URL with bucket public access enabled."
    );
  }
}
