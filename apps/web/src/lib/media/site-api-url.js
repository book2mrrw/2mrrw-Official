/** Site-origin API paths — must never be prefixed with the R2 public CDN base. */

const R2_DEV_HOST_RE = /^pub-[a-z0-9]+\.r2\.dev$/i;
const R2_DEV_API_URL_RE = /^https?:\/\/pub-[a-z0-9]+\.r2\.dev\/(api\/.*)$/i;
const LEGACY_PUBLIC_MEDIA_RE = /^\/?(images|videos|audio)\//;

function pathLooksLikeSiteApi(path) {
  const normalized = String(path || "")
    .replace(/^\//, "")
    .trim();
  if (!normalized) return false;
  return (
    normalized.startsWith("api/media/") ||
    normalized.startsWith("api/library/") ||
    normalized.startsWith("/api/media/") ||
    normalized.startsWith("/api/library/")
  );
}

/** True when value is a storefront API route (relative or absolute same-origin). */
export function isSiteApiMediaPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (pathLooksLikeSiteApi(raw)) return true;
  try {
    const url = new URL(raw);
    if (R2_DEV_HOST_RE.test(url.hostname) && url.pathname.startsWith("/api/")) return true;
    if (url.pathname.startsWith("/api/media/") || url.pathname.startsWith("/api/library/")) {
      return true;
    }
  } catch {
    /* not a URL */
  }
  return false;
}

/** Rewrite `https://pub-*.r2.dev/api/...` → `/api/...`. */
export function repairMisboundR2ApiUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const direct = raw.match(R2_DEV_API_URL_RE);
  if (direct?.[1]) return `/${direct[1]}`;

  try {
    const url = new URL(raw);
    if (R2_DEV_HOST_RE.test(url.hostname) && url.pathname.startsWith("/api/")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    /* ignore */
  }

  return raw;
}

/** Normalize to a same-origin relative API path (`/api/media/...`). */
export function ensureRelativeSiteApiPath(value) {
  const repaired = repairMisboundR2ApiUrl(value);
  const raw = String(repaired || "").trim();
  if (!raw || !isSiteApiMediaPath(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return `/${raw.replace(/^\//, "")}`;
}

/**
 * True when value is a legacy Next.js public/ directory asset (images/, videos/,
 * or audio/, with or without a leading slash) — these ship with the app bundle
 * and are served same-origin. They were never uploaded to R2 and must never be
 * prefixed with the R2 CDN base, the same way a site-API path never is.
 *
 * This is the single source of truth for that distinction. Every catalog media
 * URL builder in media-urls.js must route through it rather than re-deriving
 * its own version of this check — a prior drift (one builder had the guard,
 * four others didn't) was the root cause of the release cover / player-bar /
 * lock-screen artwork bug this comment accompanies the fix for.
 */
export function isLegacyPublicMediaPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (LEGACY_PUBLIC_MEDIA_RE.test(raw)) return true;
  try {
    return LEGACY_PUBLIC_MEDIA_RE.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

export function isR2PublicCdnBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!raw) return false;
  if (R2_DEV_HOST_RE.test(raw.replace(/^https?:\/\//i, ""))) return true;
  return /^https?:\/\/pub-[a-z0-9]+\.r2\.dev$/i.test(raw);
}
