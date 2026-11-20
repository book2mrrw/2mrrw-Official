import assert from "node:assert/strict";
import test from "node:test";
import {
  disputeAdjustment,
  recordChargeRefunds,
  recordDispute,
  recordPurchaseAdjustments,
  refundAdjustments,
} from "@/lib/commerce/purchase-adjustments";
import { recordPurchaseItems } from "@/lib/commerce/fulfill-purchase";

// A fake Supabase admin client that records every call.
function fakeAdmin({ purchaseId = "pur-1", existingItems = 0, adjustmentsError = null } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, filters: [] };
    const chain = {
      select: (cols, opts) => { q.select = cols; q.opts = opts; return chain; },
      eq: (c, v) => { q.filters.push([c, v]); return chain; },
      in: () => chain,
      maybeSingle: async () => ({ data: table === "purchases" && purchaseId ? { id: purchaseId } : null, error: null }),
      upsert: async (rows, opts) => { calls.push({ table, op: "upsert", rows, opts }); return { error: adjustmentsError }; },
      insert: async (rows) => { calls.push({ table, op: "insert", rows }); return { error: null }; },
      delete: () => { calls.push({ table, op: "delete" }); return chain; },
      then: (resolve) => resolve(table === "purchase_items" && q.opts?.head
        ? { count: existingItems, error: null }
        : { data: table === "products" ? [{ id: "prod-w2d", slug: "w2d" }] : [], error: null }),
    };
    return chain;
  };
  return { calls, from };
}

const refund = (id, amount, status = "succeeded", created = 1780000000) => ({ id, amount, status, created, currency: "USD", reason: "requested_by_customer" });

test("each refund that moved money becomes one negative adjustment, dated when Stripe made it", () => {
  const rows = refundAdjustments({
    purchaseId: "pur-1", paymentIntentId: "pi_1",
    refunds: [refund("re_1", 100), refund("re_2", 199, "pending"), refund("re_3", 50, "failed"), refund("re_4", 50, "canceled")],
  });
  assert.deepEqual(rows.map((r) => [r.stripe_object_id, r.amount_cents, r.kind]), [["re_1", -100, "refund"], ["re_2", -199, "refund"]]);
  assert.equal(rows[0].occurred_at, new Date(1780000000 * 1000).toISOString());
  assert.equal(rows[0].currency, "usd");
});

test("a dispute withdraws the amount; a won dispute returns it", () => {
  const d = { id: "du_1", amount: 299, currency: "usd", reason: "fraudulent", status: "needs_response", created: 1780000000 };
  assert.equal(disputeAdjustment({ purchaseId: "p", dispute: d }).amount_cents, -299);
  const back = disputeAdjustment({ purchaseId: "p", dispute: { ...d, status: "won" }, reversal: true });
  assert.deepEqual([back.kind, back.amount_cents], ["dispute_reversal", 299]);
  assert.equal(disputeAdjustment({ purchaseId: "p", dispute: { id: "du_0", amount: 0 } }), null);
});

test("adjustments are stored once per Stripe object (retries never double-record)", async () => {
  const admin = fakeAdmin();
  await recordPurchaseAdjustments(admin, refundAdjustments({ purchaseId: "pur-1", refunds: [refund("re_1", 100)] }));
  const call = admin.calls.find((c) => c.table === "purchase_adjustments");
  assert.deepEqual(call.opts, { onConflict: "kind,stripe_object_id", ignoreDuplicates: true });
});

test("before the migration, recording is a quiet no-op; any other error is raised", async () => {
  assert.deepEqual(await recordPurchaseAdjustments(fakeAdmin({ adjustmentsError: { code: "42P01", message: 'relation "purchase_adjustments" does not exist' } }),
    [{ kind: "refund" }]), { recorded: 0, missingTable: true });
  await assert.rejects(recordPurchaseAdjustments(fakeAdmin({ adjustmentsError: { code: "08006", message: "down" } }), [{ kind: "refund" }]));
});

test("a refunded charge without an embedded refund list fetches the refunds from Stripe", async () => {
  const admin = fakeAdmin();
  const asked = [];
  const stripe = { refunds: { list: async (params) => { asked.push(params); return { data: [refund("re_9", 299)] }; } } };
  await recordChargeRefunds(admin, stripe, { id: "ch_1", payment_intent: "pi_1", amount_refunded: 299 });
  assert.deepEqual(asked, [{ payment_intent: "pi_1", limit: 100 }]);
  const rows = admin.calls.find((c) => c.table === "purchase_adjustments").rows;
  assert.deepEqual(rows.map((r) => [r.purchase_id, r.stripe_object_id, r.amount_cents]), [["pur-1", "re_9", -299]]);
});

test("if Stripe cannot be reached the error propagates, so the webhook retries instead of skipping money history", async () => {
  const stripe = { refunds: { list: async () => { throw new Error("stripe down"); } } };
  await assert.rejects(recordChargeRefunds(fakeAdmin(), stripe, { id: "ch_1", payment_intent: "pi_1" }), /stripe down/);
});

test("a refund or dispute for an unknown payment is ignored, not invented", async () => {
  const admin = fakeAdmin({ purchaseId: null });
  assert.equal((await recordChargeRefunds(admin, { refunds: { list: async () => ({ data: [refund("re_1", 1)] }) } }, { payment_intent: "pi_x" })).recorded, 0);
  assert.equal((await recordDispute(admin, { id: "du_1", amount: 1, payment_intent: "pi_x" })).recorded, 0);
  assert.equal(admin.calls.filter((c) => c.table === "purchase_adjustments").length, 0);
});

test("line items are written once: a webhook retry never deletes and rewrites them", async () => {
  const fresh = fakeAdmin({ existingItems: 0 });
  await recordPurchaseItems(fresh, { purchaseId: "pur-1", items: [{ slug: "w2d", title: "W2D" }], totalAmountCents: 299 });
  assert.equal(fresh.calls.filter((c) => c.table === "purchase_items" && c.op === "insert").length, 1);
  const retry = fakeAdmin({ existingItems: 1 });
  await recordPurchaseItems(retry, { purchaseId: "pur-1", items: [{ slug: "w2d", title: "W2D" }], totalAmountCents: 299 });
  assert.equal(retry.calls.filter((c) => c.table === "purchase_items").length, 0, "no insert and no delete on retry");
  assert.ok(!fresh.calls.some((c) => c.op === "delete") && !retry.calls.some((c) => c.op === "delete"));
});
