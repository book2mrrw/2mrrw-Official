import { createAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { grantCollectorOwnerships } from "@/lib/commerce/collector-ownerships";
import { grantVaultPassEntitlement } from "@/lib/commerce/vault-entitlements";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";

export async function fulfillCheckoutSession(session) {
  const userId = session.metadata?.guest_user_id || session.metadata?.user_id;
  if (!userId) {
    throw new Error(`checkout session ${session.id} missing metadata.user_id`);
  }

  let slugs = [];
  try {
    slugs = JSON.parse(session.metadata.slugs || "[]");
  } catch {
    slugs = [];
  }

  let items = [];
  try {
    items = JSON.parse(session.metadata.items || "[]");
  } catch {
    items = [];
  }

  const admin = createAdminClient();
  const amountCents = session.amount_total ?? 0;

  const { data: purchase, error: purchaseErr } = await admin
    .from("purchases")
    .upsert(
      {
        user_id: userId,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent || null,
        amount_cents: amountCents,
        currency: session.currency || "usd",
        status: "completed",
        items,
        receipt_url: session.receipt_url || null,
        purchased_at: new Date().toISOString(),
      },
      { onConflict: "stripe_checkout_session_id" }
    )
    .select("id")
    .single();

  if (purchaseErr) throw purchaseErr;

  if (slugs.length > 0) {
    await Promise.all([
      grantLibraryItems({ userId, purchaseId: purchase.id, slugs, source: "purchase" }),
      grantCollectorOwnerships({ userId, purchaseId: purchase.id, slugs, items, payment: session }),
      grantVaultPassEntitlement({ userId, purchaseId: purchase.id, slugs, items, payment: session }),
    ]);
  }

  invalidateAccountStateCache(userId).catch(() => {});
  return { purchaseId: purchase.id, slugs };
}

export async function fulfillPaymentIntent(paymentIntent) {
  if (paymentIntent.status !== "succeeded") {
    return null;
  }

  const userId = paymentIntent.metadata?.guest_user_id || paymentIntent.metadata?.user_id;
  if (!userId) {
    throw new Error(`payment_intent ${paymentIntent.id} missing metadata.user_id`);
  }

  let slugs = [];
  try {
    slugs = JSON.parse(paymentIntent.metadata.slugs || "[]");
  } catch {
    slugs = [];
  }

  let items = [];
  try {
    items = JSON.parse(paymentIntent.metadata.items || "[]");
  } catch {
    items = [];
  }

  const admin = createAdminClient();

  const { data: purchase, error: purchaseErr } = await admin
    .from("purchases")
    .upsert(
      {
        user_id: userId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: paymentIntent.amount_received ?? paymentIntent.amount,
        currency: paymentIntent.currency || "usd",
        status: "completed",
        items,
        purchased_at: new Date().toISOString(),
      },
      { onConflict: "stripe_payment_intent_id" }
    )
    .select("id")
    .single();

  if (purchaseErr) throw purchaseErr;

  if (slugs.length > 0) {
    await Promise.all([
      grantLibraryItems({ userId, purchaseId: purchase.id, slugs, source: "purchase" }),
      grantCollectorOwnerships({ userId, purchaseId: purchase.id, slugs, items, payment: paymentIntent }),
      grantVaultPassEntitlement({ userId, purchaseId: purchase.id, slugs, items, payment: paymentIntent }),
    ]);
  }

  invalidateAccountStateCache(userId).catch(() => {});
  return { purchaseId: purchase.id, slugs, items };
}
