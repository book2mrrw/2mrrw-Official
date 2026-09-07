import { getAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { grantCollectorOwnerships } from "@/lib/commerce/collector-ownerships";
import { grantVaultPassEntitlement } from "@/lib/commerce/vault-entitlements";
import { grantAudioVisualEntitlements } from "@/lib/audio-visual/entitlements";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";
import { getFulfillmentProvider } from "@/lib/fulfillment/get-fulfillment-provider";

/**
 * Audio Visual items carry no slug (audio_visuals is a stable-ID-only
 * table) so they never enter the slugs.length-gated grant branch below —
 * they're granted separately, keyed on video_id.
 */
async function grantAudioVisualItemsIfAny(admin, { userId, purchaseId, items }) {
  const audioVisualItems = (items || []).filter((item) => item?.type === "audio_visual" && item?.video_id);
  if (!audioVisualItems.length) return;
  await grantAudioVisualEntitlements({ userId, purchaseId, items: audioVisualItems, admin });
}

/**
 * Actually places the Printful order for any merch in this purchase — the
 * missing half of "customer paid for merch" that neither fulfillPaymentIntent
 * nor fulfillCheckoutSession did on their own before this. Every backend
 * piece it calls (product_variants, FulfillmentPort/PrintfulFulfillmentAdapter,
 * merch_fulfillments) already existed and was already tested; this is the
 * first thing that actually wires them together.
 *
 * Deliberately never throws — a Printful outage must not block the
 * customer's digital entitlements or purchase record from completing in the
 * same webhook call. On failure it writes merch_fulfillments.status =
 * "failed" (visible via a direct DB query, same as how earlier fulfillment
 * gaps were diagnosed this session) rather than leaving the order silently
 * unsubmitted; an admin retry/resubmit action is a reasonable fast-follow,
 * not part of this pass.
 */
async function fulfillMerchItemsIfAny(admin, { purchaseId, items, shipping }) {
  const merchItems = (items || []).filter((item) => item?.type === "merch" && item?.external_variant_id);
  if (!merchItems.length) return;

  const address = shipping?.address || {};
  const recipient = {
    name: shipping?.name || "Customer",
    address1: address.line1 || "",
    address2: address.line2 || undefined,
    city: address.city || "",
    state: address.state || "",
    country: address.country || "",
    zip: address.postal_code || "",
    phone: shipping?.phone || undefined,
  };

  try {
    const missing = ["address1", "city", "state", "country", "zip"].filter((f) => !recipient[f]);
    if (missing.length) {
      throw new Error(`Missing shipping fields for merch order: ${missing.join(", ")}`);
    }

    const result = await getFulfillmentProvider().createOrder({
      recipient,
      items: merchItems.map((item) => ({
        catalogVariantId: item.catalog_variant_id,
        externalVariantId: item.external_variant_id,
        quantity: 1,
      })),
      externalOrderId: purchaseId,
    });

    await admin.from("merch_fulfillments").upsert(
      { purchase_id: purchaseId, provider: "printful", external_order_id: result.externalOrderId, status: "submitted" },
      { onConflict: "purchase_id" }
    );
    await admin.from("purchases").update({ shipping_address: recipient }).eq("id", purchaseId);
  } catch (err) {
    console.error("[fulfill-purchase] merch fulfillment failed (non-fatal)", purchaseId, err?.message);
    try {
      await admin.from("merch_fulfillments").upsert(
        { purchase_id: purchaseId, provider: "printful", status: "failed" },
        { onConflict: "purchase_id" }
      );
    } catch {
      /* the failure itself is already logged above; never let recording it throw further */
    }
  }
}

/**
 * Allocate a purchase's real charged total across its cart items,
 * proportional to each item's list price (item.price, in dollars, as stored
 * in the Stripe metadata at checkout — see create-payment-intent/route.js).
 * The last item absorbs the rounding
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
    // An item identifies what was purchased either by catalog slug (merch/
    // digital music) or by Audio Visual video_id (audio_visuals has no
    // slug — see the schema's own header comment) — never neither, or it
    // would silently vanish from purchase_items rather than merely
    // misrecording its type (the exact P1 finding this filter used to miss).
    const rows = allocations
      .filter(({ item }) => item?.slug || item?.video_id)
      .map(({ item, unitPriceCents }) => ({
        purchase_id: purchaseId,
        product_id: item.slug ? productIdBySlug.get(item.slug) || null : null,
        product_slug: item.slug || null,
        audio_visual_id: item.type === "audio_visual" ? item.video_id : null,
        title: item.title || null,
        item_type: item.type === "merch" ? "merch" : item.type === "audio_visual" ? "audio_visual" : "digital",
        access_type: item.access_type || null,
        release_id: item.release_id || null,
        variant_id: item.variant_id || null,
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
  await grantAudioVisualItemsIfAny(admin, { userId, purchaseId: purchase.id, items });
  await fulfillMerchItemsIfAny(admin, { purchaseId: purchase.id, items, shipping: session.shipping_details || session.customer_details });

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
  await grantAudioVisualItemsIfAny(admin, { userId, purchaseId: purchase.id, items });
  await fulfillMerchItemsIfAny(admin, { purchaseId: purchase.id, items, shipping: paymentIntent.shipping });

  invalidateAccountStateCache(userId).catch(() => {});
  return { purchaseId: purchase.id, slugs, items };
}
