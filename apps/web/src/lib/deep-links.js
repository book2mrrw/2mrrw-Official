const POST_AUTH_KEY = "postAuthRedirect";
const PENDING_KEY = "pendingDeepLink";

export function parseDeepLink(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const colon = trimmed.indexOf(":");
  if (colon < 1) return null;
  const type = trimmed.slice(0, colon).toLowerCase();
  const slug = trimmed.slice(colon + 1).trim();
  if (!slug) return null;
  if (!["song", "album", "feature"].includes(type)) return null;
  return { type, slug };
}

export function buildDeepLinkPath({ type, slug }) {
  if (!type || !slug) return "/";
  const segment = type === "song" ? "song" : type === "album" ? "album" : "feature";
  return `/${segment}/${encodeURIComponent(slug)}`;
}

export function buildShareUrl({ type, slug }, origin) {
  if (!origin && typeof window === "undefined") return null;
  const base = origin || window.location.origin;
  return `${base}${buildDeepLinkPath({ type, slug })}`;
}

export function setPostAuthRedirect(path) {
  if (typeof window === "undefined" || !path) return;
  sessionStorage.setItem(POST_AUTH_KEY, path);
}

export function consumePostAuthRedirect() {
  if (typeof window === "undefined") return null;
  const path = sessionStorage.getItem(POST_AUTH_KEY);
  if (path) sessionStorage.removeItem(POST_AUTH_KEY);
  return path;
}

export function setPendingDeepLink(value) {
  if (typeof window === "undefined" || !value) return;
  sessionStorage.setItem(PENDING_KEY, value);
}

export function consumePendingDeepLink() {
  if (typeof window === "undefined") return null;
  const value = sessionStorage.getItem(PENDING_KEY);
  if (value) sessionStorage.removeItem(PENDING_KEY);
  return value;
}

export function deepLinkToHomeQuery(parsed) {
  if (!parsed?.type || !parsed?.slug) return null;
  return `deepLink=${parsed.type}:${encodeURIComponent(parsed.slug)}`;
}
