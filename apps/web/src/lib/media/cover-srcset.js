/**
 * Responsive cover delivery — the single place a cover URL becomes a set of
 * right-sized derivatives.
 *
 * WHY THIS EXISTS
 *
 * Covers shipped their masters straight into the grid: `ad.JPG` is 1600x1600 /
 * 200 KB rendered into a 220-330 px cell, roughly 6x the pixels needed. Nothing
 * resized them, because no surface owned cover delivery — each one just handed
 * the raw catalog URL to an `<img>`.
 *
 * Next's built-in optimizer already solves this; it was simply never pointed at
 * the covers. Measured on `ad.JPG` (200,772 bytes original):
 *
 *     w=256  ->   4,578 bytes  (2.2%)
 *     w=384  ->   7,288 bytes  (3.6%)
 *     w=640  ->  12,030 bytes  (5.9%)
 *
 * Format is negotiated from the request's `Accept` header, so a browser that
 * takes AVIF gets AVIF and everything else falls back to WebP then the
 * original — no per-format branching here.
 *
 * This builds `srcSet` for the existing `<img>` rather than swapping in
 * `next/image`. The layout of every cover surface is already CSS-driven and
 * correct (`aspectRatio`, `width: 100%`, parent-sized heroes), and the two
 * things `next/image` would add on top — a blur placeholder and an
 * already-loaded check — are both already built here as `ArtworkSkeleton`'s
 * shimmer and `useCoverReady`. Taking its required `width`/`height` props would
 * mean asserting an intrinsic ratio for five differently-styled surfaces, which
 * is layout risk bought for nothing.
 */

import { getPublicCdnBase } from "@/lib/storage/r2-public-cdn";

/** Next's optimizer endpoint. Excluded from the middleware matcher already. */
const OPTIMIZER_PATH = "/_next/image";

/**
 * Candidate widths. Every value MUST appear in `images.imageSizes` or
 * `images.deviceSizes` in next.config.mjs, or the optimizer rejects the
 * request. These are all Next defaults.
 */
export const COVER_WIDTHS = [256, 384, 640, 750, 1080];

/**
 * The only quality any optimizer URL may use.
 *
 * Next 16 validates `q` against `images.qualities`, which defaults to `[75]`
 * and is not widened in next.config. Anything else returns 400 — silently, as
 * a broken image rather than an error you would notice. So quality is fixed
 * here rather than exposed as a per-call option, and a test asserts it matches
 * what the config permits.
 */
export const COVER_QUALITY = 75;

/**
 * Deliberately conservative: it must not under-declare for the hero surfaces
 * (the radio slide renders a full-width static image), and no surface is given
 * a layout width here — so this errs toward a larger candidate rather than a
 * soft image. Callers with a known narrower box can pass their own.
 */
export const COVER_SIZES = "(max-width: 768px) 100vw, 50vw";

/** Same-origin public artwork, or artwork on the public R2 CDN. */
const LOCAL_IMAGE_RE = /^\/images\//i;
const R2_PUBLIC_IMAGE_RE = /^https:\/\/[^/]*\.r2\.dev\//i;
const RASTER_EXT_RE = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;

/**
 * The configured public CDN, which is not necessarily an r2.dev host — moving
 * to a custom domain would otherwise silently stop every cover being
 * optimized, with no error anywhere. next.config adds the same host to
 * `images.remotePatterns`, so the two stay symmetric.
 */
function configuredCdnPrefix() {
  const base = getPublicCdnBase();
  return base && /^https?:\/\//i.test(base) ? `${base.replace(/\/+$/, "")}/` : null;
}

/**
 * True when the optimizer can serve this source. Motion sources, discovery
 * redirects (`/api/media/visual`), data/blob URLs and already-optimized URLs
 * are all excluded — passing any of them through would either fail or
 * double-optimize.
 */
export function isOptimizableCoverSrc(src) {
  const raw = String(src || "").trim();
  if (!raw) return false;
  if (raw.startsWith(OPTIMIZER_PATH)) return false;
  const cdnPrefix = configuredCdnPrefix();
  const known =
    LOCAL_IMAGE_RE.test(raw) ||
    R2_PUBLIC_IMAGE_RE.test(raw) ||
    (cdnPrefix ? raw.startsWith(cdnPrefix) : false);
  if (!known) return false;
  return RASTER_EXT_RE.test(raw);
}

/**
 * `srcSet` for a cover, or null when the source cannot be optimized — callers
 * pass null straight to the attribute so the `<img>` is left exactly as it was.
 *
 * @param {string | null | undefined} src
 * @param {{ widths?: number[] }} [options]
 * @returns {string | null}
 */
export function coverSrcSet(src, options = {}) {
  if (!isOptimizableCoverSrc(src)) return null;
  const widths = options.widths?.length ? options.widths : COVER_WIDTHS;
  const encoded = encodeURIComponent(String(src).trim());
  return widths
    .map((w) => `${OPTIMIZER_PATH}?url=${encoded}&w=${w}&q=${COVER_QUALITY} ${w}w`)
    .join(", ");
}

/**
 * A single optimized URL at one width, for the places that cannot take a
 * `srcSet` — `<video poster>` most of all, which accepts exactly one source.
 * Format is still negotiated from `Accept`, so this returns AVIF to browsers
 * that take it.
 *
 * Returns the source unchanged when it cannot be optimized, so a caller can
 * always use the result directly.
 *
 * `width` must be one of COVER_WIDTHS; quality is fixed (see COVER_QUALITY).
 *
 * @param {string | null | undefined} src
 * @param {{ width?: number }} [options]
 * @returns {string}
 */
export function optimizedImageUrl(src, options = {}) {
  const raw = String(src || "").trim();
  if (!isOptimizableCoverSrc(raw)) return raw;
  const width = COVER_WIDTHS.includes(options.width) ? options.width : 1080;
  return `${OPTIMIZER_PATH}?url=${encodeURIComponent(raw)}&w=${width}&q=${COVER_QUALITY}`;
}
