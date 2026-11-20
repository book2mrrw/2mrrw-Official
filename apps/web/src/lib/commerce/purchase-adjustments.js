/**
 * Money that moves after a sale — refunds, disputes, dispute reversals — is
 * recorded as its own dated row in purchase_adjustments (append-only in the
 * database, migration 20261119230000). The original sale is never rewritten,
 * so a September sale refunded in November stays in September's gross sales
 * and shows as a November refund.
 */
import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";

const MONEY_MOVED_REFUND_STATUSES = new Set(["succeeded", "pending"]);

function isoFromUnix(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function currencyOf(obj) {
  return String(obj?.currency || "usd").toLowerCase();
}

/** One adjustment per refund that actually returned (or is returning) money. */
export function refundAdjustments({ purchaseId, paymentIntentId, refunds }) {
  return (Array.isArray(refunds) ? refunds : [])
    .filter((r) => r?.id && MONEY_MOVED_REFUND_STATUSES.has(r.status) && Number(r.amount) > 0)
    .map((r) => ({
      purchase_id: purchaseId,
      kind: "refund",
      amount_cents: -Math.abs(Number(r.amount)),
      currency: currencyOf(r),
      stripe_object_id: r.id,
      stripe_payment_intent_id: paymentIntentId || null,
      reason: r.reason || null,
      occurred_at: isoFromUnix(r.created),
      metadata: { stripe_status: r.status },
    }));
}

/** A dispute withdraws the disputed amount; a won dispute returns it. */
export function disputeAdjustment({ purchaseId, paymentIntentId, dispute, reversal = false, occurredAt = null }) {
  const amount = Math.abs(Number(dispute?.amount) || 0);
  if (!dispute?.id || amount <= 0) return null;
  return {
    purchase_id: purchaseId,
    kind: reversal ? "dispute_reversal" : "dispute",
    amount_cents: reversal ? amount : -amount,
    currency: currencyOf(dispute),
    stripe_object_id: dispute.id,
    stripe_payment_intent_id: paymentIntentId || null,
    reason: dispute.reason || null,
    occurred_at: occurredAt || isoFromUnix(dispute.created),
    metadata: { stripe_status: dispute.status || null },
  };
}

/**
 * Store adjustments once each (unique on kind + Stripe object id), so webhook
 * retries never double-record. Before the migration is applied this is a
 * no-op rather than an error.
 */
export async function recordPurchaseAdjustments(admin, rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return { recorded: 0 };
  const { error } = await admin
    .from("purchase_adjustments")
    .upsert(list, { onConflict: "kind,stripe_object_id", ignoreDuplicates: true });
  if (error) {
    if (isMissingSupabaseTable(error)) return { recorded: 0, missingTable: true };
    throw error;
  }
  return { recorded: list.length };
}

export async function findPurchaseIdByPaymentIntent(admin, paymentIntentId) {
  if (!paymentIntentId) return null;
  const { data, error } = await admin
    .from("purchases")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

/**
 * Record every refund on a refunded charge. Current Stripe API versions do not
 * embed the refund list in charge events, so it is fetched; if that fetch
 * fails this throws, the webhook releases its claim, and Stripe retries —
 * money history is never silently skipped.
 */
export async function recordChargeRefunds(admin, stripe, charge) {
  const paymentIntentId = typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id || null;
  const purchaseId = await findPurchaseIdByPaymentIntent(admin, paymentIntentId);
  if (!purchaseId) return { recorded: 0, reason: "no_purchase" };
  let refunds = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : null;
  if (!refunds) {
    const listed = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
    refunds = listed?.data || [];
  }
  return recordPurchaseAdjustments(admin, refundAdjustments({ purchaseId, paymentIntentId, refunds }));
}

export async function recordDispute(admin, dispute, { reversal = false } = {}) {
  const paymentIntentId = typeof dispute?.payment_intent === "string" ? dispute.payment_intent : dispute?.payment_intent?.id || null;
  const purchaseId = await findPurchaseIdByPaymentIntent(admin, paymentIntentId);
  if (!purchaseId) return { recorded: 0, reason: "no_purchase" };
  return recordPurchaseAdjustments(admin, [
    disputeAdjustment({ purchaseId, paymentIntentId, dispute, reversal, occurredAt: reversal ? new Date().toISOString() : null }),
  ]);
}
