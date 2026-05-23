import { createAdminClient } from "@/lib/supabase/admin";
import { isCollectorAccessSlug, isMissingCollectorOwnershipsTable, isMissingSupabaseTable, isVaultPassSlug } from "@/lib/commerce/entitlements";

const MEMBERSHIP_PRODUCT_SLUGS = new Set([
  "inner_circle_membership",
  "inner-circle",
  "inner_circle",
  "membership",
]);

export async function revokeCollectorOwnershipsByPurchase(purchaseId) {
  if (!purchaseId) return { revoked: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("collector_ownerships")
    .delete()
    .eq("purchase_id", purchaseId)
    .select("id");

  if (error) {
    if (isMissingCollectorOwnershipsTable(error)) {
      return { revoked: 0, skipped: true };
    }
    throw error;
  }
  return { revoked: (data || []).length };
}

export async function revokeVaultEntitlementsByPurchase(purchaseId) {
  if (!purchaseId) return { revoked: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vault_entitlements")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("purchase_id", purchaseId)
    .eq("status", "active")
    .select("id");

  if (error) {
    if (isMissingSupabaseTable(error)) {
      return { revoked: 0, skipped: true };
    }
    throw error;
  }
  return { revoked: (data || []).length };
}

export async function revokeMembershipByPurchaseContext({ userId, slugs = [] }) {
  if (!userId) return { revoked: false };
  const hasMembershipSku = (slugs || []).some((slug) => MEMBERSHIP_PRODUCT_SLUGS.has(slug));
  if (!hasMembershipSku) return { revoked: false };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("memberships")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .select("id");

  if (error) {
    if (isMissingSupabaseTable(error)) {
      return { revoked: false, skipped: true };
    }
    throw error;
  }
  return { revoked: (data || []).length > 0, count: (data || []).length };
}

export async function revokeExtendedEntitlementsForPurchase({ purchaseId, userId, slugs = [] }) {
  const collector = await revokeCollectorOwnershipsByPurchase(purchaseId);
  const vault = await revokeVaultEntitlementsByPurchase(purchaseId);
  const membership = await revokeMembershipByPurchaseContext({ userId, slugs });

  const normalizedSlugs = (slugs || []).filter(Boolean);
  const hadCollectorSku = normalizedSlugs.some(isCollectorAccessSlug);
  const hadVaultSku = normalizedSlugs.some(isVaultPassSlug);

  return {
    collector,
    vault,
    membership,
    hadCollectorSku,
    hadVaultSku,
  };
}
