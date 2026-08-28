import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  RouteAccessClass,
  classifyRouteAccess,
  loginRedirectPath,
  resolveRouteAccessDecision,
  sanitizeReturnTo,
} from "../route-access-policy.js";

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("CONSUMER_ACCESS_INVARIANT protects every consumer page by default", () => {
  for (const route of [
    "/", "/music", "/singles", "/features", "/albums",
    "/mixtapes-and-eps", "/videos", "/shop", "/vault",
    "/community", "/today", "/shows", "/song/hour-glass",
    "/feature/2-heavy", "/album/tbh", "/future-surface",
  ]) {
    assert.equal(classifyRouteAccess(route), RouteAccessClass.AUTHENTICATED_CONSUMER, route);
    assert.deepEqual(
      resolveRouteAccessDecision({ pathname: route, hasVerifiedPrincipal: false }).responseKind,
      "login_redirect",
      route
    );
  }
});

test("anonymous auth, registration, and recovery pages remain reachable", () => {
  for (const route of [
    "/login", "/join", "/verify-otp", "/forgot-password",
    "/reset-password", "/auth/callback",
  ]) {
    const decision = resolveRouteAccessDecision({ pathname: route, hasVerifiedPrincipal: false });
    assert.equal(decision.accessClass, RouteAccessClass.ANONYMOUS_AUTH, route);
    assert.equal(decision.allowed, true, route);
  }
});

test("consumer APIs are 401 by default, including legacy public namespaces", () => {
  for (const route of [
    "/api/catalog/releases", "/api/catalog/hydrate", "/api/library",
    "/api/public/events", "/api/public/livestream", "/api/public/vault",
    "/api/media/visual", "/api/media/preview", "/api/future-surface",
    "/api/report.jpg",
  ]) {
    const decision = resolveRouteAccessDecision({ pathname: route, hasVerifiedPrincipal: false });
    assert.equal(decision.accessClass, RouteAccessClass.AUTHENTICATED_CONSUMER, route);
    assert.equal(decision.responseKind, "api_401", route);
  }
});

test("valid verified consumers pass while missing, expired, malformed, or revoked sessions fail", () => {
  const allowed = resolveRouteAccessDecision({ pathname: "/", hasVerifiedPrincipal: true });
  assert.equal(allowed.allowed, true);
  for (const state of ["missing", "expired", "malformed", "revoked", "deleted"]) {
    const denied = resolveRouteAccessDecision({ pathname: "/", hasVerifiedPrincipal: false });
    assert.equal(denied.allowed, false, state);
  }
});

test("possession-proof and machine routes are explicit rather than accidentally public", () => {
  assert.equal(classifyRouteAccess("/gift/opaque-token"), RouteAccessClass.TOKEN_SCOPED);
  assert.equal(classifyRouteAccess("/api/access/opaque-token"), RouteAccessClass.TOKEN_SCOPED);
  assert.equal(classifyRouteAccess("/api/library/hls/key"), RouteAccessClass.TOKEN_SCOPED);
  assert.equal(classifyRouteAccess("/api/webhook", "POST"), RouteAccessClass.SERVICE_INTERNAL);
  assert.equal(classifyRouteAccess("/api/cron/publish-scheduled"), RouteAccessClass.SERVICE_INTERNAL);
  assert.equal(classifyRouteAccess("/api/admin/catalog/revalidate", "POST"), RouteAccessClass.ADMIN_OR_SERVICE);
  assert.equal(classifyRouteAccess("/api/health"), RouteAccessClass.SYSTEM_PUBLIC);
  assert.equal(classifyRouteAccess("/images/auth-background.jpg"), RouteAccessClass.STATIC_ASSET);
  assert.equal(classifyRouteAccess("/api/cron/new-unclassified-job"), RouteAccessClass.AUTHENTICATED_CONSUMER);
});

test("return paths are same-origin, non-looping, and normalized", () => {
  assert.equal(sanitizeReturnTo("/?tab=mixtapes"), "/?tab=mixtapes");
  assert.equal(sanitizeReturnTo("/album/tbh"), "/album/tbh");
  assert.equal(sanitizeReturnTo("https://evil.example/"), "/");
  assert.equal(sanitizeReturnTo("//evil.example/"), "/");
  assert.equal(sanitizeReturnTo("/\\evil"), "/");
  assert.equal(sanitizeReturnTo("/login?returnTo=/"), "/");
  assert.equal(loginRedirectPath("/?tab=mixtapes"), "/login?returnTo=%2F%3Ftab%3Dmixtapes");
});

test("middleware and server components enforce the authority before protected data reads", () => {
  const middleware = read("middleware.js");
  const sessionMiddleware = read("src/lib/supabase/middleware.js");
  const home = read("src/app/page.js");
  const adminLayout = read("src/app/admin/layout.js");

  assert.match(middleware, /resolveRouteAccessDecision/);
  assert.match(middleware, /CONSUMER_AUTH_REQUIRED/);
  assert.match(middleware, /NextResponse\.redirect\(loginUrl, 307\)/);
  assert.doesNotMatch(middleware, /api\/public\/\.\*|api\/guest\/\.\*/);
  assert.match(sessionMiddleware, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(sessionMiddleware, /auth\.getSession\(\)/);
  assert.match(home, /dynamic = "force-dynamic"/);
  assert.ok(home.indexOf("requireConsumerPrincipal()") < home.indexOf("getStorefrontCatalogFromDB(),"));
  assert.match(adminLayout, /requireAdminActor/);
});

test("service worker cannot replay authenticated catalog or media after sign-out", () => {
  const serviceWorker = read("public/sw.js");
  assert.doesNotMatch(serviceWorker, /\/api\/catalog\/releases|\/api\/public\/events/);
  assert.doesNotMatch(serviceWorker, /\/api\/media\/preview/);
  assert.match(serviceWorker, /2mrrw-api-/);
  assert.match(serviceWorker, /caches\.delete/);
});

test("release metadata and detail rendering are dynamically server-gated", () => {
  for (const route of ["song", "feature", "album"]) {
    const source = read(`src/app/${route}/[slug]/page.js`);
    assert.match(source, /dynamic = "force-dynamic"/);
    assert.match(source, /generateMetadata[\s\S]*requireConsumerPrincipal\(\)/);
    assert.match(source, /export default async function[\s\S]*requireConsumerPrincipal\(\)/);
  }
});

test("anonymous metadata and discovery surfaces do not expose the protected catalog", () => {
  const layout = read("src/app/layout.js");
  const robots = read("public/robots.txt");
  const sitemap = read("src/app/sitemap.js");

  assert.doesNotMatch(layout, /lovehz\.jpg|ad\.JPG|tbh\.jpg/i);
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(robots, /Disallow:\s*\//);
  assert.match(sitemap, /requireConsumerPrincipal\(\)/);
  assert.match(sitemap, /dynamic = "force-dynamic"/);
});
