import { createAdminClient } from "@/lib/supabase/admin";
import { isCollectorAccessSlug, isVaultPassSlug } from "@/lib/commerce/entitlements";
import { grantEntitlementFlag, revokeAllUserEntitlements, revokeEntitlementFlag } from "@/lib/entitlements";

const LOG_PREFIX = "[stripe-webhook-entitlements]";

async function grantCollectorAccessForCard(admin, { userId, card }) {
  const accessTier = card.access_tier || "collector";
  const { error } = await admin.from("collector_access").upsert({
    user_id: userId,
    collector_card_id: card.id,
    streaming_access: true,
    vault_access: true,
    livestream_access: true,
    collector_status: accessTier === "vault_collector" ? "vault_collector" : "verified_collector",
    perks_json: { source: "stripe_checkout", visibleSerial: card.visible_serial },
    revoked_at: null,
  }, { onConflict: "user_id,collector_card_id" });
  if (error) throw error;
}

export async function upsertMembershipFromSubscription(subscription) {
  const userId = subscription.metadata?.guest_user_id || subscription.metadata?.user_id;
  if (!userId) {
    console.warn(`${LOG_PREFIX} subscription missing user_id`, subscription.id);
    return null;
  }

  const admin = createAdminClient();
  const status = String(subscription.status || "").toLowerCase();
  const active = status === "active" || status === "trialing";
  const revokeSubscriber = !active || status === "past_due" || status === "canceled" || status === "unpaid";

  const row = {
    user_id: userId,
    tier: subscription.metadata?.tier || "inner_circle",
    status: active ? status : status === "past_due" ? "past_due" : "canceled",
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    stripe_subscription_id: subscription.id,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    canceled_at: active ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("memberships").upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) {
    console.warn(`${LOG_PREFIX} membership upsert failed`, subscription.id, error.message);
    throw error;
  }

  if (active && !revokeSubscriber) {
    await grantEntitlementFlag(admin, userId, "subscriber", "stripe_subscription", {
      stripe_subscription_id: subscription.id,
    });
    console.log(`${LOG_PREFIX} subscriber granted`, userId, subscription.id);
  } else {
    await revokeEntitlementFlag(admin, userId, "subscriber");
    console.log(`${LOG_PREFIX} subscriber revoked`, userId, subscription.id, status);
  }

  return { userId, active };
}

export async function assignCollectorCardFromPurchase({ userId, slugs = [], purchaseId = null }) {
  const collectorSlugs = [...new Set((slugs || []).filter(isCollectorAccessSlug))];
  if (!collectorSlugs.length || !userId) return null;

  const admin = createAdminClient();
  const productSlug = collectorSlugs[0];

  const { data: card, error } = await admin
    .from("collector_cards")
    .select("id, hidden_secure_id, visible_serial, claimed, claimed_by_user_id, product_slug, verification_status, revoked_at")
    .eq("product_slug", productSlug)
    .eq("claimed", false)
    .is("revoked_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`${LOG_PREFIX} card pool lookup failed`, error.message);
    return null;
  }

  let assignedCard = card;
  if (card) {
    const { data: updated, error: claimError } = await admin
      .from("collector_cards")
      .update({
        claimed: true,
        claimed_by_user_id: userId,
        verification_status: "claimed",
        claim_timestamp: new Date().toISOString(),
        digital_access_granted: true,
      })
      .eq("id", card.id)
      .eq("claimed", false)
      .select("id, visible_serial, access_tier")
      .maybeSingle();

    if (claimError) {
      console.warn(`${LOG_PREFIX} card claim update failed`, claimError.message);
    } else if (updated) {
      assignedCard = updated;
      await grantCollectorAccessForCard(admin, { userId, card: updated });
    }
  }

  await grantEntitlementFlag(admin, userId, "collector_card", "stripe_checkout", {
    collector_card_id: assignedCard?.id || null,
    metadata: { purchase_id: purchaseId, product_slug: productSlug },
  });

  console.log(`${LOG_PREFIX} collector_card entitlement`, { userId, cardId: assignedCard?.id, purchaseId });
  return assignedCard;
}

export async function grantVaultFromPurchaseSlugs({ userId, slugs = [], purchaseId = null }) {
  if (!(slugs || []).some(isVaultPassSlug) || !userId) return null;
  const admin = createAdminClient();
  await grantEntitlementFlag(admin, userId, "vault_access", "stripe_purchase", {
    metadata: { purchase_id: purchaseId },
  });
  console.log(`${LOG_PREFIX} vault_access granted`, userId, purchaseId);
  return true;
}

export async function handleCheckoutEntitlements({ userId, slugs, purchaseId }) {
  try {
    await Promise.all([
      assignCollectorCardFromPurchase({ userId, slugs, purchaseId }),
      grantVaultFromPurchaseSlugs({ userId, slugs, purchaseId }),
    ]);
  } catch (err) {
    console.warn(`${LOG_PREFIX} checkout entitlements error`, err.message);
    throw err;
  }
}

export async function revokeAllEntitlementsForDispute({ userId, paymentIntentId }) {
  if (!userId) {
    console.warn(`${LOG_PREFIX} dispute revoke skipped — no user`);
    return;
  }

  const admin = createAdminClient();
  await revokeAllUserEntitlements(admin, userId, "charge_dispute");

  const { data: accessRows } = await admin
    .from("collector_access")
    .select("collector_card_id")
    .eq("user_id", userId)
    .is("revoked_at", null);

  const cardIds = (accessRows || []).map((r) => r.collector_card_id).filter(Boolean);

  if (cardIds.length) {
    await admin
      .from("collector_access")
      .update({ revoked_at: new Date().toISOString(), collector_status: "revoked" })
      .eq("user_id", userId)
      .is("revoked_at", null);

    await admin
      .from("collector_cards")
      .update({
        verification_status: "revoked",
        revoked_at: new Date().toISOString(),
        digital_access_granted: false,
      })
      .in("id", cardIds);
  }

  await admin
    .from("memberships")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due"]);

  console.warn(`${LOG_PREFIX} dispute full revoke`, { userId, paymentIntentId, cardIds: cardIds.length });
}
