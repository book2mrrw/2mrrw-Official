/** Site-origin API paths — must never be prefixed with the R2 public CDN base. */

const R2_DEV_HOST_RE = /^pub-[a-z0-9]+\.r2\.dev$/i;
const R2_DEV_API_URL_RE = /^https?:\/\/pub-[a-z0-9]+\.r2\.dev\/(api\/.*)$/i;

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

export function isR2PublicCdnBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!raw) return false;
  if (R2_DEV_HOST_RE.test(raw.replace(/^https?:\/\//i, ""))) return true;
  return /^https?:\/\/pub-[a-z0-9]+\.r2\.dev$/i.test(raw);
}
