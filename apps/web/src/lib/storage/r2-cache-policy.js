/**
 * Cache policy for R2 objects — one declaration, every write path.
 *
 * WHY THIS EXISTS
 *
 * R2 returns whatever `CacheControl` an object was written with, and nothing
 * else. Measured 2026-09-27 against the public CDN: catalog media came back
 * with **no Cache-Control header at all** — so every cover, every motion cover
 * and every preview was re-downloaded on every visit, forever.
 *
 * next.config's `headers()` cannot fix this. It only applies to responses
 * Next.js itself serves; an object fetched straight from the R2 public CDN
 * never passes through the app. The header has to be on the object.
 *
 * The codebase already knew this — `poster-extract.js` and the hls-transcoder
 * worker's `poster.js` both set `immutable` on the posters they upload. But
 * the two highest-volume write paths, the admin presigned PUT and the
 * publish-time canonicalizing copy, set nothing. Two of four, each hardcoded
 * inline. This module is what the four now share.
 *
 * FAIL CLOSED
 *
 * This is an allow-list. A key that matches no rule returns null and its
 * caller must not stamp it. That is a security boundary, not an oversight:
 * `digital-assets/` holds the paid masters, served only through signed GET
 * URLs, and marking one `public` would make it cacheable by any intermediary
 * that ever saw it. Adding a prefix here is a deliberate act.
 */

/**
 * Why nothing here is `immutable`:
 *
 * These keys are stable and overwritten in place — `buildR2Key` maps a cover
 * to `images/<folder>/<slug>/<slug>.<ext>`, so re-uploading artwork for a
 * release reuses the exact same key. An immutable TTL would serve the old
 * bytes until it expired. One day is long enough to eliminate the repeat-visit
 * cost and short enough that replacing an asset propagates on its own.
 *
 * The same reasoning, and the same 86400, as the static-asset manifest uses
 * for same-origin /images/ and /videos/ — deliberately consistent, so an asset
 * behaves the same whichever origin serves it.
 *
 * Posters are the exception that proves it: their keys are version-scoped, so
 * the two poster upload paths can and do use `immutable`. They are not
 * restamped here.
 */
const PUBLIC_CATALOG_MEDIA = "public, max-age=86400";

const R2_CACHE_POLICY = Object.freeze([
  // Release cover artwork. Public, and the source the image optimizer fetches.
  { prefix: "images/", cacheControl: PUBLIC_CATALOG_MEDIA },
  // Motion/animated cover art. Public, rendered in muted looping <video>.
  { prefix: "videos/", cacheControl: PUBLIC_CATALOG_MEDIA },
  // Free preview audio — deliberately public; these are the samples anyone
  // can play without entitlement, which is why they may carry a public header.
  { prefix: "previews/", cacheControl: PUBLIC_CATALOG_MEDIA },
  // Audio Visualz DISPLAY ART ONLY.
  //
  // This one is a pattern rather than a prefix, and that is the whole point.
  // "2MRRW Studios/<type>/<slug>/" holds three things: poster.<ext> and
  // motion-cover.<ext>, which are public display art, and
  // master-<timestamp>.<ext>, which is the actual video people pay for.
  // Allowing the folder would have made every master publicly cacheable by
  // any intermediary that ever saw it. Only the two display basenames match.
  {
    pattern: /^2MRRW Studios\/[^/]+\/(?:.+\/)?(?:poster|motion-cover)\.[a-z0-9]+$/i,
    cacheControl: PUBLIC_CATALOG_MEDIA,
  },
]);

/**
 * Keys that must NEVER receive a public cache header, listed explicitly so the
 * intent survives someone later "tidying up" the allow-list above. The
 * allow-list already fails closed on all of these; this is defence in depth,
 * because the cost of getting it wrong is publishing paid content.
 */
export const R2_NEVER_PUBLIC_PREFIXES = Object.freeze([
  "digital-assets/", // paid release masters, signed-URL access only
  // Vault content — entitlement-gated, delivered as encrypted HLS through
  // /api/vault/video/{key,manifest,variant}. It sits under videos/ purely by
  // folder convention, so the blanket videos/ rule would otherwise have swept
  // it into a public cache. Caught by the first dry run against the real
  // bucket, which listed videos/vault/private-releases/ among the writes.
  "videos/vault/",
]);

/** Audio Visualz master objects — paid video content. Never public. */
const AV_MASTER_RE = /^2MRRW Studios\/.*\/master-\d+\.[a-z0-9]+$/i;

/**
 * Cache-Control for an R2 key, or null when the key is not covered.
 * Callers MUST treat null as "do not set any cache header".
 *
 * @param {string | null | undefined} key
 * @returns {string | null}
 */
export function cacheControlForR2Key(key) {
  const normalized = String(key || "").trim().replace(/^\/+/, "");
  if (!normalized) return null;
  // Zero-byte folder markers. Nothing ever fetches one, so stamping them is
  // pure API noise — the first dry run showed 20+ of these.
  if (normalized.endsWith("/")) return null;
  if (R2_NEVER_PUBLIC_PREFIXES.some((p) => normalized.startsWith(p))) return null;
  if (AV_MASTER_RE.test(normalized)) return null;
  const rule = R2_CACHE_POLICY.find((r) =>
    r.prefix ? normalized.startsWith(r.prefix) : r.pattern.test(normalized)
  );
  return rule?.cacheControl ?? null;
}

/**
 * Top-level prefixes the backfill should LIST. Not the same as what gets
 * stamped: "2MRRW Studios/" is listed so its display art is reachable, while
 * cacheControlForR2Key still refuses every master inside it.
 */
export const R2_SCAN_PREFIXES = Object.freeze([
  "images/",
  "videos/",
  "previews/",
  "2MRRW Studios/",
]);

/** Simple prefixes this policy stamps wholesale — for tests. */
export const R2_CACHEABLE_PREFIXES = Object.freeze(
  R2_CACHE_POLICY.filter((r) => r.prefix).map((r) => r.prefix)
);
