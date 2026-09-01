import { getAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";
import {
  invalidateEntitlementTierCache,
  invalidateUserEntitlementCache,
} from "@/lib/server/entitlement-cache";

export const ENTITLEMENT_TYPES = ["vault_access", "subscriber", "collector_card"];

/**
 * Entitlement matrix (stream / vault / full digital catalog)
 *
 * | Capability              | Owned (purchase/gift) | Subscriber | Collector card | Vault gift/pass | Admin |
 * |-------------------------|----------------------|------------|----------------|-----------------|-------|
 * | Stream owned slug       | yes                  | —          | yes            | —               | yes   |
 * | Stream full catalog     | —                    | yes        | yes            | —               | yes   |
 * | Vault tier content      | —                    | inner*     | yes            | yes             | yes   |
 * | Full digital (all SKUs) | —                    | —          | yes            | —               | yes   |
 *
 * * Subscriber inner_circle vault tier via membership; vault_pass requires vault_access or collector.
 *
 * Legacy rule: library_items from purchase/gift/grant are never removed when subscription ends.
 */
export const ENTITLEMENT_MATRIX = {
  streamOwned: ["owned", "collector_card", "admin"],
  streamCatalog: ["subscriber", "collector_card", "admin"],
  vault: ["vault_access", "collector_card", "admin"],
  fullDigital: ["collector_card", "admin"],
};

const LOG_PREFIX = "[entitlements]";

export function hasEntitlement(row, type) {
  if (!row || !type) return false;
  if (type === "vault_access") return Boolean(row.vault_access);
  if (type === "subscriber") return Boolean(row.subscriber);
  if (type === "collector_card") return Boolean(row.collector_card);
  return false;
}

export function hasVaultAccess(row) {
  return hasEntitlement(row, "vault_access");
}

/** Full digital catalog unlock — collector card (or admin) only per product spec. */
export function hasDigitalAccess(row) {
  if (!row) return false;
  return Boolean(row.collector_card);
}

export async function getUserEntitlements(userId, admin = null) {
  if (!userId) {
    return {
      user_id: null,
      vault_access: false,
      subscriber: false,
      collector_card: false,
      collector_card_id: null,
      stripe_subscription_id: null,
      metadata: {},
    };
  }

  const client = admin || getAdminClient();
  const { data, error } = await client
    .from("user_entitlements")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      return deriveEntitlementsFromLegacy(client, userId);
    }
    throw error;
  }

  if (data) return data;
  return deriveEntitlementsFromLegacy(client, userId);
}

async function deriveEntitlementsFromLegacy(admin, userId) {
  const [membershipResult, collectorAccessResult, vaultResult] = await Promise.all([
    admin
      .from("memberships")
      .select("status, stripe_subscription_id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("collector_access")
      .select("id, collector_card_id")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle(),
    admin
      .from("vault_entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  const membership = membershipResult.data;
  const subscriber = ["active", "trialing"].includes(String(membership?.status || "").toLowerCase());
  const collectorCard = Boolean(collectorAccessResult.data);
  const vaultAccess = Boolean(vaultResult.data) || collectorCard;

  return {
    user_id: userId,
    vault_access: vaultAccess,
    subscriber,
    collector_card: collectorCard,
    collector_card_id: collectorAccessResult.data?.collector_card_id || null,
    stripe_subscription_id: membership?.stripe_subscription_id || null,
    metadata: { derived: "legacy" },
  };
}

export async function upsertUserEntitlements(admin, userId, patch = {}) {
  if (!userId) throw new Error("userId required for entitlement upsert");

  const row = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };

  for (const key of ["vault_access", "subscriber", "collector_card"]) {
    if (typeof patch[key] === "boolean") row[key] = patch[key];
  }
  for (const key of ["vault_source", "subscriber_source", "collector_source", "stripe_subscription_id"]) {
    if (patch[key] !== undefined) row[key] = patch[key];
  }
  if (patch.collector_card_id !== undefined) row.collector_card_id = patch.collector_card_id;
  if (patch.metadata !== undefined) row.metadata = patch.metadata;

  const { data, error } = await admin
    .from("user_entitlements")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      console.warn(`${LOG_PREFIX} user_entitlements table missing; skipping upsert`);
      return null;
    }
    throw error;
  }

  console.log(`${LOG_PREFIX} upsert`, { userId, vault: data.vault_access, subscriber: data.subscriber, collector: data.collector_card });
  // Any write to user_entitlements changes tier state. Invalidate immediately so the
  // next play event re-derives the correct tier rather than serving a stale cache entry.
  invalidateEntitlementTierCache(userId).catch(() => {});
  return data;
}

export async function grantEntitlementFlag(admin, userId, type, source = null, extra = {}) {
  if (!ENTITLEMENT_TYPES.includes(type)) {
    throw new Error(`Unknown entitlement type: ${type}`);
  }

  // Supabase upsert with onConflict only updates columns included in the patch —
  // existing columns not in the patch are left unchanged. No pre-read needed, and
  // the read-modify-write pattern it replaced had a race: two concurrent grants
  // could each read stale data and the second write would clobber the first.
  const patch = { [type]: true, ...extra };
  if (type === "vault_access" && source) patch.vault_source = source;
  if (type === "subscriber" && source) patch.subscriber_source = source;
  if (type === "collector_card" && source) patch.collector_source = source;

  return upsertUserEntitlements(admin, userId, patch);
}

export async function revokeEntitlementFlag(admin, userId, type) {
  if (!ENTITLEMENT_TYPES.includes(type)) {
    throw new Error(`Unknown entitlement type: ${type}`);
  }

  const patch = { [type]: false };
  if (type === "vault_access") patch.vault_source = null;
  if (type === "subscriber") {
    patch.subscriber_source = null;
    patch.stripe_subscription_id = null;
  }
  if (type === "collector_card") {
    patch.collector_source = null;
    patch.collector_card_id = null;
  }

  return upsertUserEntitlements(admin, userId, patch);
}

export async function revokeAllUserEntitlements(admin, userId, reason = "revoked") {
  const { data, error } = await admin
    .from("user_entitlements")
    .upsert({
      user_id: userId,
      vault_access: false,
      subscriber: false,
      collector_card: false,
      vault_source: null,
      subscriber_source: null,
      collector_source: null,
      collector_card_id: null,
      stripe_subscription_id: null,
      metadata: { revoked_at: new Date().toISOString(), reason },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      console.warn(`${LOG_PREFIX} revokeAll skipped — table missing`);
      return null;
    }
    throw error;
  }

  console.warn(`${LOG_PREFIX} revoked all`, { userId, reason });
  // Full revoke: wipe the tier key and all slug keys for this user so the next
  // play event hits the DB and gets correctly denied rather than serving a cached grant.
  invalidateUserEntitlementCache(userId).catch(() => {});
  return data;
}

export async function getActiveCardBenefits(admin, entitlementType = "collector_card") {
  const { data, error } = await admin
    .from("card_benefits")
    .select("*")
    .eq("requires_entitlement", entitlementType)
    .eq("active", true);

  if (error) {
    if (isMissingSupabaseTable(error)) return [];
    throw error;
  }
  return data || [];
}

export async function getCheckoutDiscountPercent(userId, admin = null) {
  const client = admin || getAdminClient();
  const row = await getUserEntitlements(userId, client);
  if (!hasEntitlement(row, "collector_card")) return 0;

  const benefits = await getActiveCardBenefits(client, "collector_card");
  const discount = benefits.find((b) => b.benefit_type === "checkout_discount");
  return Number(discount?.value_numeric || 0);
}

export function isMerchOrVinylProduct(productType) {
  const type = String(productType || "").toLowerCase();
  return type === "merch" || type === "vinyl";
}

export function shouldGateProduct(productType) {
  return !isMerchOrVinylProduct(productType);
}

export async function hasVaultAccessForUser(userId) {
  const row = await getUserEntitlements(userId);
  return hasVaultAccess(row);
}

export async function hasDigitalAccessForUser(userId) {
  const row = await getUserEntitlements(userId);
  return hasDigitalAccess(row);
}
