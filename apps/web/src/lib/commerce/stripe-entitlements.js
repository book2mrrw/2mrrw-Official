import { getAdminClient } from "@/lib/supabase/admin";
import { isCollectorAccessSlug, isVaultPassSlug } from "@/lib/commerce/entitlements";
import { grantEntitlementFlag, revokeAllUserEntitlements, revokeEntitlementFlag } from "@/lib/entitlements";
import {
  invalidateEntitlementTierCache,
  invalidateUserEntitlementCache,
} from "@/lib/server/entitlement-cache";

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
  // Collector status change → tier cache must be invalidated immediately so the
  // next play event reflects full catalog access rather than serving a stale entry.
  invalidateEntitlementTierCache(userId).catch(() => {});
}

export async function upsertMembershipFromSubscription(subscription) {
  const userId = subscription.metadata?.guest_user_id || subscription.metadata?.user_id;
  if (!userId) {
    console.warn(`${LOG_PREFIX} subscription missing user_id`, subscription.id);
    return null;
  }

  const admin = getAdminClient();
  const status = String(subscription.status || "").toLowerCase();
  const active = status === "active" || status === "trialing";
  const revokeSubscriber = !active || status === "past_due" || status === "canceled" || status === "unpaid";

  // Captured at webhook time rather than trusted from a hardcoded constant, so
  // MRR reporting (get_subscription_stats) stays correct if pricing changes or
  // a second tier is added later.
  const subscriptionPrice = subscription.items?.data?.[0]?.price;

  const row = {
    user_id: userId,
    tier: subscription.metadata?.tier || "inner_circle",
    status: active ? status : status === "past_due" ? "past_due" : "canceled",
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    stripe_subscription_id: subscription.id,
    price_cents: subscriptionPrice?.unit_amount ?? null,
    currency: subscriptionPrice?.currency || null,
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

  // Membership status changed → tier cache must be invalidated so the next play event
  // re-derives subscriber status from DB rather than serving a stale canStreamAll=true entry.
  // grantEntitlementFlag / revokeEntitlementFlag already invalidate user_entitlements-derived
  // tier cache; this invalidation covers the memberships table path in userCanStreamProduct().
  invalidateEntitlementTierCache(userId).catch(() => {});

  return { userId, active };
}

export async function assignCollectorCardFromPurchase({ userId, slugs = [], purchaseId = null }) {
  if (!slugs?.length || !userId) return null;

  const admin = getAdminClient();

  // Resolve collector products via DB column (authoritative) rather than slug pattern.
  // is_collector_product == null means the column doesn't exist yet (migration pending):
  // fall back to slug-pattern check so existing behaviour is preserved during transition.
  const { data: slugRows } = await admin
    .from("products")
    .select("slug, is_collector_product")
    .in("slug", slugs);

  const collectorSlugs = (slugRows || [])
    .filter((p) => p.is_collector_product === true || (p.is_collector_product == null && isCollectorAccessSlug(p.slug)))
    .map((p) => p.slug);

  if (!collectorSlugs.length) return null;

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
  const admin = getAdminClient();
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

  const admin = getAdminClient();
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
  // Dispute full revoke: wipe the entire entitlement cache for this user so no cached
  // grant (tier or per-slug) can be served after credentials have been revoked.
  invalidateUserEntitlementCache(userId).catch(() => {});
}
