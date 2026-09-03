import { getAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { grantCollectorOwnerships } from "@/lib/commerce/collector-ownerships";
import { grantVaultPassEntitlement } from "@/lib/commerce/vault-entitlements";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";

/**
 * Allocate a purchase's real charged total across its cart items,
 * proportional to each item's list price (item.price, in dollars, as stored
 * in the Stripe metadata at checkout — see checkout/session/route.js and
 * create-payment-intent/route.js). The last item absorbs the rounding
 * remainder so the sum always exactly equals totalAmountCents, even when a
 * collector discount was applied to the checkout as a whole and the list
 * total no longer matches what was actually charged.
 */
function allocatePurchaseItemPrices(items, totalAmountCents) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length || !Number.isFinite(totalAmountCents) || totalAmountCents < 0) return [];

  const listPrices = list.map((item) => Math.max(0, Math.round((Number(item?.price) || 0) * 100)));
  const listTotal = listPrices.reduce((sum, cents) => sum + cents, 0);

  let allocated = 0;
  return list.map((item, i) => {
    const isLast = i === list.length - 1;
    let unitPriceCents;
    if (isLast) {
      unitPriceCents = Math.max(0, totalAmountCents - allocated);
    } else if (listTotal > 0) {
      unitPriceCents = Math.round((listPrices[i] / listTotal) * totalAmountCents);
    } else {
      // No usable list-price data — split evenly rather than drop the item.
      unitPriceCents = Math.floor(totalAmountCents / list.length);
    }
    allocated += unitPriceCents;
    return { item, unitPriceCents };
  });
}

/**
 * Populate purchase_items for a fulfilled purchase. Never blocks or fails
 * entitlement granting — a failure here means a revenue-reporting gap for
 * this purchase, not a customer losing access to what they paid for, so it
 * is logged and swallowed rather than thrown.
 *
 * Idempotent: replaces any existing rows for this purchase_id first, so a
 * Stripe webhook retry (the purchases upsert above already tolerates this)
 * cannot create duplicate line items.
 */
async function recordPurchaseItems(admin, { purchaseId, items, totalAmountCents }) {
  try {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return;

    const slugs = [...new Set(list.map((item) => item?.slug).filter(Boolean))];
    const { data: products } = slugs.length
      ? await admin.from("products").select("id, slug").in("slug", slugs)
      : { data: [] };
    const productIdBySlug = new Map((products || []).map((p) => [p.slug, p.id]));

    const allocations = allocatePurchaseItemPrices(list, totalAmountCents);
    const rows = allocations
      .filter(({ item }) => item?.slug)
      .map(({ item, unitPriceCents }) => ({
        purchase_id: purchaseId,
        product_id: productIdBySlug.get(item.slug) || null,
        product_slug: item.slug,
        title: item.title || null,
        item_type: item.type === "merch" ? "merch" : "digital",
        access_type: item.access_type || null,
        release_id: item.release_id || null,
        unit_price_cents: unitPriceCents,
        quantity: 1,
      }));
    if (!rows.length) return;

    await admin.from("purchase_items").delete().eq("purchase_id", purchaseId);
    const { error } = await admin.from("purchase_items").insert(rows);
    if (error) throw error;
  } catch (err) {
    console.warn("[fulfill-purchase] purchase_items recording failed (non-fatal)", purchaseId, err?.message);
  }
}

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

  const admin = getAdminClient();
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

  await recordPurchaseItems(admin, { purchaseId: purchase.id, items, totalAmountCents: amountCents });

  if (slugs.length > 0) {
    await Promise.all([
      grantLibraryItems({
        userId,
        purchaseId: purchase.id,
        slugs,
        source: "purchase",
        entitlementMetadata: {
          access_type: items.some((item) => item?.access_type === "preorder") ? "preorder" : "purchase",
          release_ids: items.map((item) => item?.release_id).filter(Boolean),
          purchased_at: new Date().toISOString(),
          early_access_eligible: items.some((item) => item?.access_type === "preorder"),
        },
      }),
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

  const admin = getAdminClient();
  const amountCents = paymentIntent.amount_received ?? paymentIntent.amount;

  const { data: purchase, error: purchaseErr } = await admin
    .from("purchases")
    .upsert(
      {
        user_id: userId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: amountCents,
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

  await recordPurchaseItems(admin, { purchaseId: purchase.id, items, totalAmountCents: amountCents });

  if (slugs.length > 0) {
    await Promise.all([
      grantLibraryItems({
        userId,
        purchaseId: purchase.id,
        slugs,
        source: "purchase",
        entitlementMetadata: {
          access_type: items.some((item) => item?.access_type === "preorder") ? "preorder" : "purchase",
          release_ids: items.map((item) => item?.release_id).filter(Boolean),
          purchased_at: new Date().toISOString(),
          early_access_eligible: items.some((item) => item?.access_type === "preorder"),
        },
      }),
      grantCollectorOwnerships({ userId, purchaseId: purchase.id, slugs, items, payment: paymentIntent }),
      grantVaultPassEntitlement({ userId, purchaseId: purchase.id, slugs, items, payment: paymentIntent }),
    ]);
  }

  invalidateAccountStateCache(userId).catch(() => {});
  return { purchaseId: purchase.id, slugs, items };
}
