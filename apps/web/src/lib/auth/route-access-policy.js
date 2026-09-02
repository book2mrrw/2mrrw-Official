/**
 * CONSUMER_ACCESS_INVARIANT
 *
 * A route is anonymous only when this module says it is. Every unknown page
 * and API route is authenticated by default. Keep this module Edge-safe: the
 * Next.js middleware, client login flow, audits, and tests all consume it.
 */

export const RouteAccessClass = Object.freeze({
  ANONYMOUS_AUTH: "ANONYMOUS_AUTH",
  TOKEN_SCOPED: "TOKEN_SCOPED",
  AUTHENTICATED_CONSUMER: "AUTHENTICATED_CONSUMER",
  ADMIN: "ADMIN",
  ADMIN_OR_SERVICE: "ADMIN_OR_SERVICE",
  SERVICE_INTERNAL: "SERVICE_INTERNAL",
  LEGACY_RETIREMENT: "LEGACY_RETIREMENT",
  SYSTEM_PUBLIC: "SYSTEM_PUBLIC",
  STATIC_ASSET: "STATIC_ASSET",
});

const ANONYMOUS_PAGE_ROUTES = new Set([
  "/login",
  "/join",
  "/verify-otp",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/callback",
]);

const ANONYMOUS_AUTH_API_METHODS = new Map([
  ["/api/auth/login-step1", new Set(["POST"])],
  ["/api/auth/login-step2", new Set(["POST"])],
  ["/api/auth/lookup-email", new Set(["POST"])],
  ["/api/auth/lookup-phone", new Set(["POST"])],
  ["/api/auth/signup", new Set(["POST"])],
  ["/api/auth/callback", new Set(["GET", "POST"])],
]);

const LEGACY_RETIREMENT_API_METHODS = new Map([
  ["/api/guest/session", new Set(["GET", "DELETE"])],
  ["/api/register-user", new Set(["POST"])],
]);

const TOKEN_SCOPED_ROUTES = [
  { pattern: /^\/gift\/[^/]+$/, methods: new Set(["GET"]) },
  { pattern: /^\/api\/access\/[^/]+$/, methods: new Set(["GET"]) },
  { pattern: /^\/api\/gifts\/preview\/[^/]+$/, methods: new Set(["GET"]) },
  { pattern: /^\/api\/gifts\/claim\/[^/]+$/, methods: new Set(["POST"]) },
  { pattern: /^\/api\/gifts\/claim-signup$/, methods: new Set(["POST"]) },
  { pattern: /^\/api\/collector-card\/verify$/, methods: new Set(["POST"]) },
  { pattern: /^\/api\/collector\/cards\/verify$/, methods: new Set(["POST"]) },
  { pattern: /^\/api\/library\/hls\/(?:key|variant)$/, methods: new Set(["GET", "OPTIONS"]) },
  { pattern: /^\/api\/vault\/video\/(?:key|variant)$/, methods: new Set(["GET", "OPTIONS"]) },
];

// These routes authenticate machines with their own signature, cron secret,
// or one exact service capability in the route handler. Consumer cookies are
// neither required nor accepted as a substitute for that authority.
const SERVICE_INTERNAL_API_METHODS = new Map([
  ["/api/admin/catalog/r2-ingest", new Set(["POST"])],
  ["/api/admin/diagnostics/entitlements-parity", new Set(["GET"])],
  ["/api/admin/hls/complete", new Set(["POST"])],
  ["/api/admin/sync/catalog", new Set(["POST"])],
  ["/api/admin/sync/drop-notification", new Set(["POST"])],
  ["/api/cron/account-lifecycle", new Set(["GET"])],
  ["/api/cron/expire-gifts", new Set(["GET", "POST"])],
  ["/api/cron/finalize-draft-dumps", new Set(["GET"])],
  ["/api/cron/gift-reminders", new Set(["GET", "POST"])],
  ["/api/cron/hls-stale-jobs", new Set(["GET"])],
  ["/api/cron/livestream-notifications", new Set(["GET"])],
  ["/api/cron/twitch-live-reconcile", new Set(["GET"])],
  ["/api/cron/publish-scheduled", new Set(["GET"])],
  ["/api/cron/purge-stream-events", new Set(["GET", "POST"])],
  ["/api/stripe/webhook", new Set(["POST"])],
  ["/api/webhook", new Set(["POST"])],
  ["/api/webhooks/stripe", new Set(["POST"])],
  ["/api/webhooks/twitch", new Set(["POST"])],
]);

const ADMIN_OR_SERVICE_API_METHODS = new Map([
  ["/api/admin/apply-r2-cors", new Set(["GET", "POST"])],
  ["/api/admin/backfill-playback-keys", new Set(["GET", "POST"])],
  ["/api/admin/catalog/revalidate", new Set(["POST"])],
  ["/api/admin/fulfill-recovery", new Set(["POST"])],
  ["/api/admin/seed-products", new Set(["POST"])],
]);

const SYSTEM_PUBLIC_ROUTES = new Set(["/robots.txt"]);

const STATIC_PREFIXES = [
  "/_next/static/",
  "/_next/image/",
  "/icons/",
  "/fonts/",
  "/images/",
  "/videos/",
  "/audio/",
];

const STATIC_EXACT = new Set([
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
  "/file.svg",
  "/globe.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

function normalizePathname(pathname) {
  const value = typeof pathname === "string" ? pathname.trim() : "";
  if (!value || !value.startsWith("/") || value.includes("\\")) return "/__invalid__";
  if (value === "/") return value;
  return value.replace(/\/+$/, "") || "/";
}

function methodAllowed(methodMap, pathname, method) {
  return methodMap.get(pathname)?.has(method) === true;
}

function isStaticAsset(pathname) {
  return STATIC_EXACT.has(pathname) || STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function classifyRouteAccessWithRule(pathname, requestMethod = "GET") {
  const path = normalizePathname(pathname);
  const method = String(requestMethod || "GET").toUpperCase();

  if (isStaticAsset(path)) {
    return { accessClass: RouteAccessClass.STATIC_ASSET, rule: "explicit-static-asset" };
  }
  if (SYSTEM_PUBLIC_ROUTES.has(path) || path === "/api/health" || path.startsWith("/api/health/")) {
    return { accessClass: RouteAccessClass.SYSTEM_PUBLIC, rule: "explicit-system-public" };
  }
  if (ANONYMOUS_PAGE_ROUTES.has(path) && method === "GET") {
    return { accessClass: RouteAccessClass.ANONYMOUS_AUTH, rule: "explicit-anonymous-auth-page" };
  }
  if (methodAllowed(ANONYMOUS_AUTH_API_METHODS, path, method)) {
    return { accessClass: RouteAccessClass.ANONYMOUS_AUTH, rule: "explicit-anonymous-auth-api" };
  }
  if (methodAllowed(LEGACY_RETIREMENT_API_METHODS, path, method)) {
    return { accessClass: RouteAccessClass.LEGACY_RETIREMENT, rule: "explicit-retirement-route" };
  }
  if (TOKEN_SCOPED_ROUTES.some(({ pattern, methods }) => pattern.test(path) && methods.has(method))) {
    return { accessClass: RouteAccessClass.TOKEN_SCOPED, rule: "explicit-possession-proof-route" };
  }
  if (methodAllowed(SERVICE_INTERNAL_API_METHODS, path, method)) {
    return { accessClass: RouteAccessClass.SERVICE_INTERNAL, rule: "explicit-service-authority-route" };
  }
  if (methodAllowed(ADMIN_OR_SERVICE_API_METHODS, path, method)) {
    return { accessClass: RouteAccessClass.ADMIN_OR_SERVICE, rule: "explicit-admin-or-service-route" };
  }
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) {
    return { accessClass: RouteAccessClass.ADMIN, rule: "admin-namespace" };
  }

  // The permanent contract: omission cannot publish a route.
  return { accessClass: RouteAccessClass.AUTHENTICATED_CONSUMER, rule: "default-protected" };
}

export function classifyRouteAccess(pathname, requestMethod = "GET") {
  return classifyRouteAccessWithRule(pathname, requestMethod).accessClass;
}

export function routeRequiresVerifiedPrincipal(accessClass) {
  return accessClass === RouteAccessClass.AUTHENTICATED_CONSUMER ||
    accessClass === RouteAccessClass.ADMIN;
}

export function isApiPath(pathname) {
  return normalizePathname(pathname).startsWith("/api/");
}

export function resolveRouteAccessDecision({ pathname, method = "GET", hasVerifiedPrincipal = false }) {
  const policy = classifyRouteAccessWithRule(pathname, method);
  if (routeRequiresVerifiedPrincipal(policy.accessClass) && !hasVerifiedPrincipal) {
    return {
      ...policy,
      allowed: false,
      responseKind: isApiPath(pathname) ? "api_401" : "login_redirect",
    };
  }
  return { ...policy, allowed: true, responseKind: "allow" };
}

/** Same-origin redirect target for post-auth navigation; auth loops fail safe. */
export function sanitizeReturnTo(value, fallback = "/") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  try {
    const parsed = new URL(raw, "https://return.2mrrw.invalid");
    if (parsed.origin !== "https://return.2mrrw.invalid") return fallback;
    const accessClass = classifyRouteAccess(parsed.pathname, "GET");
    if (accessClass === RouteAccessClass.ANONYMOUS_AUTH) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function loginRedirectPath(value) {
  const returnTo = sanitizeReturnTo(value, "/");
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
