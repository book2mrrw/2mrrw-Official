import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Every Stripe-touching purchase flow in this app must stay on the same page
// — a plain Stripe Checkout Session redirects the browser away to a
// Stripe-hosted URL and back, which is exactly what must never happen here.
// Tickets and Live PPV used to do this; both are now converted to the same
// in-page PaymentIntent + <Elements>/<PaymentElement> pattern Donate,
// Subscribe, and the main cart checkout already used.

test("no route in the app creates a Stripe Checkout Session any more", () => {
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.name === "route.js" ? [target] : [];
  });
  const routeFiles = walk(path.join(root, "src/app/api"));
  const offenders = routeFiles.filter((file) => fs.readFileSync(file, "utf8").includes("checkout.sessions.create"));
  assert.deepEqual(offenders, [], "no API route may call stripe.checkout.sessions.create — every purchase flow must stay in-page");
});

test("the dead, unused Checkout Session route is gone, not just unreferenced", () => {
  assert.ok(!fs.existsSync(path.join(root, "src/app/api/checkout/session/route.js")));
});

test("tickets checkout creates an in-page PaymentIntent and forbids redirect-only payment methods", () => {
  const src = read("src/app/api/tickets/checkout/route.js");
  assert.match(src, /stripe\.paymentIntents\.create\(/);
  assert.match(src, /allow_redirects:\s*"never"/);
  assert.match(src, /\{ clientSecret: paymentIntent\.client_secret \}/);
  assert.doesNotMatch(src, /checkout\.sessions\.create/);
  assert.doesNotMatch(src, /\burl:\s*session\.url\b/);
});

test("the ticket buy button renders Stripe Elements in-page instead of redirecting via window.location", () => {
  const src = read("src/app/HomeClient.js");
  const fnAt = src.indexOf("function TicketCheckoutButton({ event, onClose }) {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 2200);
  assert.doesNotMatch(body, /window\.location\.href/);
  assert.match(body, /data\.clientSecret/);
  assert.match(body, /<Elements[\s\S]{0,200}clientSecret/);
  assert.match(body, /<CheckoutForm onSuccess=\{\(\) => setPurchased\(true\)\}/);
});

test("live PPV checkout creates an in-page PaymentIntent and forbids redirect-only payment methods", () => {
  const src = read("src/app/api/live/checkout/route.js");
  assert.match(src, /stripe\.paymentIntents\.create\(/);
  assert.match(src, /allow_redirects:\s*"never"/);
  assert.match(src, /\{ clientSecret: paymentIntent\.client_secret \}/);
});

test("donate and subscribe already forbid redirect-only payment methods (regression guard, not a new fix)", () => {
  const donate = read("src/app/api/donations/create-payment-intent/route.js");
  assert.match(donate, /allow_redirects:\s*"never"/);
  assert.doesNotMatch(donate, /checkout\.sessions\.create/);

  const subscribe = read("src/app/api/memberships/checkout/route.js");
  assert.match(subscribe, /stripe\.subscriptions\.create/);
  assert.doesNotMatch(subscribe, /checkout\.sessions\.create/);
});

test("the webhook fulfills tickets and live PPV from payment_intent.succeeded, not checkout.session.completed", () => {
  const src = read("src/lib/commerce/handle-stripe-webhook.js");
  const piCaseAt = src.indexOf('case "payment_intent.succeeded": {');
  const sessionCaseAt = src.indexOf('case "checkout.session.completed": {');
  assert.ok(piCaseAt > -1 && sessionCaseAt > piCaseAt);
  const piCaseBody = src.slice(piCaseAt, sessionCaseAt);
  assert.match(piCaseBody, /pi\.metadata\?\.payment_kind === "ticket"/);
  assert.match(piCaseBody, /fulfillTicketPurchase\(admin, pi\)/);
  assert.match(piCaseBody, /pi\.metadata\?\.payment_kind === "live_ppv"/);
  assert.match(piCaseBody, /fulfillLivePpvPurchase\(admin, pi\)/);

  // The old checkout.session.completed branch must no longer dispatch either
  // kind — nothing creates a Checkout Session for them any more, and the
  // fulfillment functions were rewritten to expect a PaymentIntent shape, not
  // a Checkout Session shape (different field names), so a stale dispatch
  // here would silently pass the wrong-shaped object if it ever fired.
  const sessionCaseEnd = src.indexOf("\n      case ", sessionCaseAt + 10);
  const sessionCaseBody = src.slice(sessionCaseAt, sessionCaseEnd);
  assert.doesNotMatch(sessionCaseBody, /fulfillTicketPurchase/);
  assert.doesNotMatch(sessionCaseBody, /fulfillLivePpvPurchase/);
});

test("fulfillTicketPurchase and fulfillLivePpvPurchase read PaymentIntent fields, not Checkout Session fields", () => {
  const src = read("src/lib/commerce/handle-stripe-webhook.js");

  const ticketAt = src.indexOf("async function fulfillTicketPurchase(admin, pi) {");
  assert.ok(ticketAt > -1);
  const ticketBody = src.slice(ticketAt, ticketAt + 2200);
  assert.match(ticketBody, /stripe_payment_intent_id: pi\.id,/);
  assert.match(ticketBody, /pi\.receipt_email \|\| meta\.email \|\| null/);
  assert.doesNotMatch(ticketBody, /stripe_session_id:/);
  assert.doesNotMatch(ticketBody, /session\.customer_details/);

  const livePpvAt = src.indexOf("async function fulfillLivePpvPurchase(admin, pi) {");
  assert.ok(livePpvAt > -1);
  const livePpvBody = src.slice(livePpvAt, livePpvAt + 1000);
  assert.match(livePpvBody, /stripe_payment_intent_id: pi\.id,/);
  assert.doesNotMatch(livePpvBody, /stripe_checkout_session_id:/);
});

test("a retried ticket webhook delivery is treated as idempotent, not a failure", () => {
  const src = read("src/lib/commerce/handle-stripe-webhook.js");
  const ticketAt = src.indexOf("async function fulfillTicketPurchase(admin, pi) {");
  const body = src.slice(ticketAt, ticketAt + 1600);
  assert.match(body, /insertErr\.code === "23505"/);
  assert.match(body, /already fulfilled \(idempotent retry\)/);
});

test("the migration relaxes the now-obsolete session-id NOT NULL constraints and keys ticket idempotency on the payment intent", () => {
  const migrationsDir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes("tickets_live_ppv_payment_intent"));
  assert.equal(files.length, 1);
  const sql = fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
  assert.match(sql, /alter table if exists public\.ticket_purchases\s*\n\s*alter column stripe_session_id drop not null;/);
  assert.match(sql, /create unique index if not exists ticket_purchases_payment_intent_uidx/);
  assert.match(sql, /alter table if exists public\.live_broadcast_purchases\s*\n\s*alter column stripe_checkout_session_id drop not null;/);
});

test("the route-authority audit matrix stays in sync with the real route count after deleting the dead route", () => {
  const matrix = JSON.parse(read("docs/audit/E1M-ROUTE-AUTHORITY-MATRIX-2026-08-25.json"));
  assert.ok(!matrix.routes.some((item) => item.route === "/api/checkout/session"));
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.name === "route.js" ? [target] : [];
  });
  const files = walk(path.join(root, "src/app/api"));
  assert.equal(matrix.total, files.length);
});
