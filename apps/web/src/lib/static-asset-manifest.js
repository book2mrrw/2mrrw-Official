/**
 * Static asset policy — one declaration, every enforcement point.
 *
 * WHY THIS EXISTS
 *
 * Four places independently answered "is this a static asset?", and they
 * disagreed:
 *
 *   - src/lib/auth/route-access-policy.js  knew about /images/
 *   - next.config.mjs headers()            did not — only /environment/:path*
 *   - public/sw.js                         did not
 *   - middleware.js matcher                did not — only /_next/*
 *
 * The result was cover art that skipped the auth lookup correctly, carried no
 * cache policy at all, never entered the service worker cache, and invoked an
 * edge function on every single request. Each file was individually defensible;
 * the drift between them was the defect.
 *
 * Adding a prefix is now one edit here. The enforcement points either import
 * this directly (route-access-policy, next.config) or are pinned to it by a
 * contract test (middleware's matcher and sw.js, both of which must stay
 * statically analysable — Next parses the matcher at build time, and sw.js is
 * served verbatim to the browser).
 *
 * Deliberately dependency-free: imported by Edge middleware, by the Node build
 * (next.config.mjs, via a relative path — the `@/` alias does not exist there),
 * and by tests.
 */

/**
 * `maxAge` is seconds, or null to leave the platform default alone.
 *
 * On the TTLs: every prefix whose filenames carry no content hash gets a
 * bounded TTL, never `immutable`. Replacing the bytes at a stable path —
 * /images/albums/ad.JPG, say — would otherwise serve the old asset for the
 * whole TTL. Only /_next/static/ is content-hashed by the build, which is why
 * it is the one entry that may be immutable (and Next already sets that).
 */
export const STATIC_ASSET_POLICY = Object.freeze([
  {
    prefix: "/_next/static/",
    // Build-hashed filenames; Next already sets immutable. Do not override.
    maxAge: null,
    // Deliberately NOT cache-first, and do not "fix" this. These files are
    // already immutable and content-hashed, so a second cache buys no hit rate
    // — while a service-worker miss on a JS chunk turns a recoverable network
    // blip into a ChunkLoadError in the route error boundary. Caching them was
    // strictly worse than not. See public/sw.js.
    swStrategy: "network",
  },
  {
    // No trailing slash: the optimizer is requested as `/_next/image?url=...`,
    // so its pathname is exactly `/_next/image`. A trailing slash here matches
    // nothing — which is what previously left it classified default-protected.
    prefix: "/_next/image",
    // The optimizer sets its own Cache-Control from images.minimumCacheTTL.
    maxAge: null,
    swStrategy: "cache-first",
  },
  { prefix: "/icons/", maxAge: 86400, swStrategy: "cache-first" },
  { prefix: "/fonts/", maxAge: 31536000, swStrategy: "cache-first" },
  { prefix: "/images/", maxAge: 86400, swStrategy: "cache-first" },
  { prefix: "/videos/", maxAge: 86400, swStrategy: "network" },
  { prefix: "/audio/", maxAge: 86400, swStrategy: "network" },
  {
    // Background environment assets (star/sun/moon/earth/galaxy video +
    // posters). These are the precedent for this whole module: omitting them
    // from the auth prefix list did not merely skip an optimisation — the
    // fail-closed default classified them AUTHENTICATED_CONSUMER, so every
    // byte-range request ran a Supabase auth.getUser() in middleware and came
    // back with `private, no-store` stamped over the `immutable` Cache-Control
    // next.config sets for exactly these files, and an auth blip handed a
    // <video> element a 307 to /login. They change only under a new deploy,
    // which Vercel keys separately, so immutable is safe here.
    prefix: "/environment/",
    maxAge: 31536000,
    immutable: true,
    swStrategy: "network",
  },
]);

/** Exact paths that are static assets but are not prefixes. */
export const STATIC_ASSET_EXACT = Object.freeze([
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
  "/file.svg",
  "/globe.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

/** Prefixes for route classification — every entry above is a static asset. */
export const STATIC_ASSET_PREFIXES = Object.freeze(
  STATIC_ASSET_POLICY.map((entry) => entry.prefix)
);

/** Prefixes the service worker should serve cache-first. */
export const SW_CACHE_FIRST_PREFIXES = Object.freeze(
  STATIC_ASSET_POLICY.filter((e) => e.swStrategy === "cache-first").map((e) => e.prefix)
);

/** Header rules for next.config.mjs `headers()`. Entries with no TTL are skipped. */
export function staticAssetCacheHeaders() {
  return STATIC_ASSET_POLICY.filter((entry) => entry.maxAge != null).map((entry) => ({
    // next.config matches on a source pattern, not a prefix string.
    source: `${entry.prefix.replace(/\/$/, "")}/:path*`,
    headers: [
      {
        key: "Cache-Control",
        value: `public, max-age=${entry.maxAge}${entry.immutable ? ", immutable" : ""}`,
      },
    ],
  }));
}

/**
 * Prefixes the middleware matcher must exclude. Only the `_next/*` entries are
 * listed today: excluding a path here means middleware never runs for it, so
 * anything that could ever need an auth decision must not appear. The
 * remaining static prefixes are still matched, and short-circuit inside
 * middleware via the STATIC_ASSET class.
 */
export const MIDDLEWARE_EXEMPT_PREFIXES = Object.freeze([
  "_next/static",
  "_next/image",
]);
