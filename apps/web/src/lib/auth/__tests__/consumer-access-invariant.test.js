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
import { normalizeSupabaseUrl } from "../../supabase/supabase-url.js";

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("Supabase URLs strip invisible-prefix deployment corruption centrally", () => {
  assert.equal(
    normalizeSupabaseUrl("\uFEFF  https://project.supabase.co/  "),
    "https://project.supabase.co"
  );
  assert.equal(
    normalizeSupabaseUrl("\u200Bhttps://project.supabase.co"),
    "https://project.supabase.co"
  );
});

test("CONSUMER_ACCESS_INVARIANT protects every consumer page by default", () => {
  for (const route of [
    "/", "/music", "/singles", "/features", "/albums",
    "/mixtapes-and-eps", "/videos", "/shop", "/vault",
    "/community", "/today", "/shows", "/song/hour-glass",
    "/feature/2-heavy", "/album/tbh", "/future-surface",
  ]) {
    assert.equal(classifyRouteAccess(route), RouteAccessClass.AUTHENTICATED_CONSUMER, route);
    assert.equal(
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
  ]) {
    const decision = resolveRouteAccessDecision({ pathname: route, hasVerifiedPrincipal: false });
    assert.equal(decision.accessClass, RouteAccessClass.AUTHENTICATED_CONSUMER, route);
    assert.equal(decision.responseKind, "api_401", route);
  }
});

test("possession-proof and machine routes remain explicit", () => {
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

test("middleware and server components enforce authority before protected reads", () => {
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

test("admin show scheduling, pricing, inventory, Stripe checkout, and sign-out remain wired", () => {
  const home = read("src/app/HomeClient.js");
  const adminShows = read("src/app/api/admin/shows/route.js");
  const checkout = read("src/app/api/tickets/checkout/route.js");

  assert.match(home, /function InlineShowsAdmin/);
  assert.match(home, /auth\.isAdminStable && \([\s\S]*<InlineShowsAdmin/);
  assert.match(home, /PRESET_PRICES/);
  assert.match(home, /price_cents/);
  assert.match(home, /tickets_available/);
  assert.match(adminShows, /getAdminSessionUser/);
  assert.match(adminShows, /isAdminUser/);
  assert.match(adminShows, /venue_timezone/);
  assert.match(adminShows, /price_cents/);
  assert.match(adminShows, /tickets_available/);
  assert.match(checkout, /stripe\.paymentIntents\.create/);
  assert.match(checkout, /const unitAmount = show\.price_cents/);
  assert.match(home, /handleSignOut[\s\S]*router\.replace\("\/login"\)/);
});
