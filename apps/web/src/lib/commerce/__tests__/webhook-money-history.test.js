import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";

register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,n){return n(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);

// The real Stripe webhook handler, with Stripe and the database faked, to prove
// what happens to money history on refund and dispute events.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
let event;
const log = [];
let refundList = [];

function from(table) {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain,
    maybeSingle: async () => ({ data: table === "purchases" ? { id: "pur-1", user_id: "fan-1" } : null, error: null }),
    insert: async () => { log.push(`insert:${table}`); return { error: null }; },
    upsert: async (rows) => { log.push(`upsert:${table}:${rows.map((r) => `${r.kind}:${r.amount_cents}`).join(",")}`); return { error: null }; },
    update: () => { log.push(`update:${table}`); return chain; },
    delete: () => { log.push(`delete:${table}`); return chain; },
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
}

mock.module("@/lib/commerce/stripe", { namedExports: { getStripe: () => ({
  webhooks: { constructEvent: () => event },
  refunds: { list: async () => ({ data: refundList }) },
}) } });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => ({ from }) } });
mock.module("@/lib/observability/server-events", { namedExports: { emitServerEvent: () => {} } });
mock.module("@/lib/commerce/fulfill-purchase", { namedExports: { fulfillCheckoutSession: async () => {}, fulfillPaymentIntent: async () => {} } });
mock.module("@/lib/commerce/revoke-entitlements", { namedExports: { revokeExtendedEntitlementsForPurchase: async () => { log.push("revoke:extended"); return {}; } } });
mock.module("@/lib/commerce/stripe-entitlements", { namedExports: {
  handleCheckoutEntitlements: async () => {}, upsertMembershipFromSubscription: async () => {},
  revokeAllEntitlementsForDispute: async () => { log.push("revoke:dispute"); },
} });
mock.module("@/lib/commerce/tickets", { namedExports: { decrementShowStock: async () => {}, sendTicketConfirmation: async () => {} } });
const noop = async () => {};
mock.module("@/lib/server/entitlement-cache", { namedExports: {
  getEntitlementGeneration: async () => null, bumpEntitlementGeneration: noop,
  getCachedTier: async () => undefined, setCachedTier: noop,
  getCachedSlugResult: async () => undefined, setCachedSlugResult: noop,
  getCachedOwnershipResult: async () => undefined, setCachedOwnershipResult: noop,
  withInflight: async (_key, fn) => fn(),
  invalidateEntitlementTierCache: noop, invalidateEntitlementSlugCache: noop, invalidateUserEntitlementCache: noop,
} });
mock.module("@/lib/server/email", { namedExports: {
  sendTransactionalEmail: async () => {}, buildPurchaseConfirmationEmail: () => ({}), buildMembershipWelcomeEmail: () => ({}),
} });

const { handleStripeWebhook } = await import("@/lib/commerce/handle-stripe-webhook");

async function deliver(type, object) {
  event = { id: `evt_${type}`, type, data: { object } };
  log.length = 0;
  const res = await handleStripeWebhook(new Request("https://www.2mrrw.com/api/webhook", {
    method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}",
  }));
  return res.status;
}

test("a refund is written to the ledger before access is revoked", async () => {
  refundList = [{ id: "re_1", amount: 299, status: "succeeded", created: 1780000000, currency: "usd" }];
  assert.equal(await deliver("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 299 }), 200);
  const ledgerAt = log.indexOf("upsert:purchase_adjustments:refund:-299");
  const statusAt = log.indexOf("update:purchases");
  assert.ok(ledgerAt > -1, `refund recorded (${log.join(" | ")})`);
  assert.ok(statusAt > ledgerAt, "the ledger row comes first");
});

test("a canceled payment moved no money and records no adjustment", async () => {
  assert.equal(await deliver("payment_intent.canceled", { id: "pi_1" }), 200);
  assert.ok(!log.some((l) => l.startsWith("upsert:purchase_adjustments")));
});

test("an opened dispute is recorded as money out; a won dispute as money back", async () => {
  assert.equal(await deliver("charge.dispute.created", { id: "du_1", amount: 299, payment_intent: "pi_1", currency: "usd", created: 1780000000 }), 200);
  assert.ok(log.includes("upsert:purchase_adjustments:dispute:-299"));
  assert.equal(await deliver("charge.dispute.closed", { id: "du_1", amount: 299, payment_intent: "pi_1", status: "won" }), 200);
  assert.ok(log.includes("upsert:purchase_adjustments:dispute_reversal:299"));
  assert.equal(await deliver("charge.dispute.closed", { id: "du_2", amount: 299, payment_intent: "pi_1", status: "lost" }), 200);
  assert.ok(!log.some((l) => l.startsWith("upsert:purchase_adjustments")), "a lost dispute adds nothing (the money left when it opened)");
});
