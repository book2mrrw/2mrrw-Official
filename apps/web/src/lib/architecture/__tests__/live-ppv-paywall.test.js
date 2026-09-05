import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { LIVE_PPV_PRESET_CENTS, isAllowedLivePpvAmount } from "@/lib/live/ppv-pricing.js";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("LIVE_PPV_PRESET_CENTS only allows the agreed name-your-price presets", () => {
  assert.deepEqual(LIVE_PPV_PRESET_CENTS, [
    500, 1000, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
    25000, 40000, 75000, 100000,
  ]);
  assert.equal(isAllowedLivePpvAmount(500), true);
  assert.equal(isAllowedLivePpvAmount(100000), true);
  // Any amount not on the preset list — including one just off a real preset —
  // must be rejected. This is what stands between a client-controlled amount
  // and an arbitrary Stripe charge.
  assert.equal(isAllowedLivePpvAmount(501), false);
  assert.equal(isAllowedLivePpvAmount(0), false);
  assert.equal(isAllowedLivePpvAmount(-500), false);
  assert.equal(isAllowedLivePpvAmount("500"), true, "numeric string form of a real preset still resolves");
});

test("resolveLiveBroadcastAccess grants free access only to admin, subscriber, or collector_card", () => {
  const src = read("src/lib/server/live-access.js");
  assert.match(src, /isAdminUser\(user\)/);
  assert.match(src, /entitlements\.subscriber/);
  assert.match(src, /entitlements\.collector_card/);
  // A guest-session cookie (no real account) must be turned away before any
  // entitlement or purchase check runs — signup is required first.
  const guestCheckAt = src.indexOf("user.isGuest");
  const entitlementCheckAt = src.indexOf("getUserEntitlements(");
  assert.ok(guestCheckAt > -1 && entitlementCheckAt > guestCheckAt,
    "the guest/no-account check must run before entitlements are ever consulted");
});

test("resolveLiveBroadcastAccess checks for a paid purchase scoped to this exact broadcast", () => {
  const src = read("src/lib/server/live-access.js");
  assert.match(src, /from\(\s*"live_broadcast_purchases"\s*\)/);
  assert.match(src, /\.eq\(\s*"broadcast_id",\s*broadcast\.id\s*\)/);
  assert.match(src, /\.eq\(\s*"status",\s*"paid"\s*\)/);
  // Falling through to payment_required (not silently granting access) is the
  // only correct outcome when no free tier and no purchase record exist.
  assert.match(src, /payment_required/);
});

test("live checkout route rejects amounts outside the preset list before touching Stripe", () => {
  const src = read("src/app/api/live/checkout/route.js");
  const validateAt = src.indexOf("isAllowedLivePpvAmount");
  const stripeCreateAt = src.indexOf("stripe.paymentIntents.create");
  assert.ok(validateAt > -1 && stripeCreateAt > validateAt,
    "amount validation must happen before a Stripe PaymentIntent is created");
});

test("live checkout creates an in-page PaymentIntent, never a redirect-based Checkout Session", () => {
  const src = read("src/app/api/live/checkout/route.js");
  assert.match(src, /stripe\.paymentIntents\.create\(/);
  assert.match(src, /allow_redirects:\s*"never"/,
    "must forbid payment methods that would redirect the fan off this app");
  assert.doesNotMatch(src, /checkout\.sessions\.create/);
  assert.doesNotMatch(src, /\burl:\s*session\.url\b/);
});

test("live checkout route turns away guests/unauthenticated requests before any purchase logic", () => {
  const src = read("src/app/api/live/checkout/route.js");
  const guestCheckAt = src.indexOf("user.isGuest");
  const rateLimitAt = src.indexOf("checkRateLimit(");
  assert.ok(guestCheckAt > -1 && guestCheckAt < rateLimitAt,
    "the no-account check must be the very first gate in the route");
});

test("live checkout scopes the Stripe metadata to exactly one broadcast, not a broader entitlement", () => {
  const src = read("src/app/api/live/checkout/route.js");
  assert.match(src, /payment_kind:\s*"live_ppv"/);
  assert.match(src, /broadcast_id:\s*broadcast\.id/);
  // It must not write anything resembling a purchaser-tier upgrade — this
  // purchase unlocks one broadcast and nothing else.
  assert.doesNotMatch(src, /purchaser/i);
});

test("Stripe webhook fulfills live_ppv purchases idempotently, scoped per broadcast", () => {
  const src = read("src/lib/commerce/handle-stripe-webhook.js");
  assert.match(src, /payment_kind === "live_ppv"/);
  assert.match(src, /fulfillLivePpvPurchase/);
  // A retried webhook delivery hits the paid-unique index (23505) — that must
  // be treated as success, not surfaced as a failure that triggers Stripe retries.
  const fulfillAt = src.indexOf("async function fulfillLivePpvPurchase");
  const idempotentAt = src.indexOf('insertErr.code === "23505"', fulfillAt);
  assert.ok(fulfillAt > -1 && idempotentAt > fulfillAt,
    "fulfillLivePpvPurchase must treat a duplicate-purchase constraint violation as idempotent, not an error");
});

test("live_broadcast_purchases migration enforces one paid access record per user per broadcast", () => {
  const migrationDir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(migrationDir).filter((f) => f.includes("live_broadcast_purchases"));
  assert.equal(files.length, 1, "expected exactly one live_broadcast_purchases migration");
  const sql = fs.readFileSync(path.join(migrationDir, files[0]), "utf8");
  assert.match(sql, /unique index.*live_broadcast_purchases_paid_unique_idx/is);
  assert.match(sql, /\(broadcast_id, user_id\)/);
  assert.match(sql, /where \(status = 'paid'\)/);
});

test("the price picker renders the exact same presets the backend will accept, not a hand-duplicated list", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /import\s*\{\s*LIVE_PPV_PRESET_CENTS,\s*formatLivePpvAmount\s*\}\s*from\s*"@\/lib\/live\/ppv-pricing"/);
  assert.match(src, /LIVE_PPV_PRESET_CENTS\.map/);
});

test("the price picker posts to the live checkout route and renders Stripe Elements in-page, never redirecting off the app", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /fetch\(\s*"\/api\/live\/checkout"/);
  assert.doesNotMatch(src, /window\.location\.href/,
    "payment must stay on this page — no redirect to a Stripe-hosted URL");
  assert.match(src, /data\.clientSecret/);
  assert.match(src, /<Elements[\s\S]{0,200}clientSecret/);
  assert.match(src, /<CheckoutForm onSuccess=\{handleSuccess\}/);
});

test("a successful live PPV payment refreshes live access state instead of relying on a full page reload", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /const \{ refreshLiveState \} = useLiveBroadcast\(\);/);
  const successAt = src.indexOf("const handleSuccess = () => {");
  assert.ok(successAt > -1);
  const body = src.slice(successAt, successAt + 400);
  assert.match(body, /refreshLiveState\(\);/);
});

test("the signup-required gate sends the viewer to real account creation, not the guest-session flow", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /href="\/join\?returnTo=\/"/);
});

test("the locked-state branch renders the access gate instead of the iframe, and the iframe never renders unconditionally", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /<LiveAccessGate access=\{liveAccess\} broadcastTitle=\{liveTitle\} \/>/);
  const iframeAt = src.indexOf("<iframe");
  const canViewGuardAt = src.lastIndexOf("canViewLive ?", iframeAt);
  assert.ok(canViewGuardAt > -1 && canViewGuardAt < iframeAt,
    "the Twitch iframe must stay behind the canViewLive check");
});

test("public livestream status route no longer hard-401s an unauthenticated visitor", () => {
  const src = read("src/app/api/public/livestream/route.js");
  assert.doesNotMatch(src, /Authentication required/,
    "an anonymous visitor must receive a structured access state, not a blunt 401");
  assert.match(src, /signup_required/);
  assert.match(src, /resolveLiveBroadcastAccess/);
});
