import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

export async function getOwnedSlugs(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("library_items")
    .select("product_id, products(slug)")
    .eq("user_id", userId);

  if (error) throw error;
  return new Set((data || []).map((row) => row.products?.slug).filter(Boolean));
}

export async function userOwnsProduct(userId, productSlug) {
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("slug", productSlug).single();
  if (!product) return false;

  const { data } = await admin
    .from("library_items")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", product.id)
    .maybeSingle();

  return !!data;
}

export async function grantLibraryItems({ userId, purchaseId, slugs, source = "purchase" }) {
  const admin = createAdminClient();
  const { data: products, error: pErr } = await admin.from("products").select("id, slug").in("slug", slugs);
  if (pErr) throw pErr;

  const resolved = products || [];
  const requested = (slugs || []).filter(Boolean);
  const matchedSlugs = new Set(resolved.map((p) => p.slug));
  const missingSlugs = requested.filter((slug) => !matchedSlugs.has(slug));

  if (requested.length && missingSlugs.length === requested.length) {
    console.warn(`grantLibraryItems: no products found for slugs: ${missingSlugs.join(", ")}`);
  } else if (missingSlugs.length) {
    console.warn(`grantLibraryItems: missing products for slugs: ${missingSlugs.join(", ")}`);
  }

  if (!resolved.length) return [];

  const rows = resolved.map((p) => ({
    user_id: userId,
    product_id: p.id,
    purchase_id: purchaseId,
    source,
  }));

  const { data, error } = await admin
    .from("library_items")
    .upsert(rows, { onConflict: "user_id,product_id", ignoreDuplicates: true })
    .select("*, products(slug, title, product_type, cover_url)");

  if (error) throw error;
  return data || [];
}

export async function createAccessToken({ userId, productId, purchaseId, ttlHours = 168 }) {
  const admin = createAdminClient();
  const raw = crypto.randomBytes(32).toString("hex");
  const token_hash = crypto.createHash("sha256").update(raw).digest("hex");
  const expires_at = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const { error } = await admin.from("access_tokens").insert({
    user_id: userId,
    product_id: productId,
    purchase_id: purchaseId,
    token_hash,
    expires_at,
  });

  if (error) throw error;
  return raw;
}

export async function verifyAccessToken(rawToken) {
  const admin = createAdminClient();
  const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const { data, error } = await admin
    .from("access_tokens")
    .select("*, products(*)")
    .eq("token_hash", token_hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data;
}

const VAULT_TIER_RANK = {
  public: 0,
  inner_circle: 1,
  vault_pass: 2,
};

export function isMissingSupabaseTable(error) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

export function isMissingSupabaseColumn(error) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  return code === "42703" || /column .* does not exist/i.test(message);
}

export function isSchemaUnavailableError(error) {
  return isMissingSupabaseTable(error) || isMissingSupabaseColumn(error);
}

export function isMissingCollectorOwnershipsTable(error) {
  return isMissingSupabaseTable(error);
}

export function isVaultPassSlug(slug) {
  return slug === "vault-pass" || slug === "vault_pass";
}

export function isCollectorAccessSlug(slug) {
  if (!slug || typeof slug !== "string") return false;
  return (
    slug.startsWith("exc-bundle") ||
    slug.startsWith("exc-card") ||
    slug.startsWith("collector-") ||
    slug.includes("collector")
  );
}

export function isDigitalProduct(product) {
  const type = product?.product_type || product?.type;
  return type === "digital" || type === "audio" || type === "single" || type === "album";
}

export function membershipHasPremiumAccess(membership) {
  if (!membership) return false;
  const status = String(membership.status || "").toLowerCase();
  return status === "active" || status === "trialing";
}

export function vaultTierFor({ hasVaultPass = false, hasInnerCircleAccess = false } = {}) {
  if (hasVaultPass) return "vault_pass";
  if (hasInnerCircleAccess) return "inner_circle";
  return "public";
}

export function canAccessVaultTier(userTier, contentTier) {
  const userRank = VAULT_TIER_RANK[userTier] ?? 0;
  const contentRank = VAULT_TIER_RANK[contentTier] ?? 0;
  if (contentTier === "public") return true;
  return userRank >= contentRank;
}

export async function getActiveMembership(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("memberships")
    .select("tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, started_at, canceled_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) return null;
    throw error;
  }
  return data || null;
}

export async function getCollectorAccessState(admin, userId, legacyOwnedSlugs = []) {
  const slugs = new Set(legacyOwnedSlugs || []);
  const hasSlugAccess = [...slugs].some(isCollectorAccessSlug);

  if (!admin || !userId) {
    return { hasCollectorAccess: hasSlugAccess, records: [] };
  }

  const { data, error } = await admin
    .from("collector_ownerships")
    .select("id, product_slug, verification_status, entitlement_status")
    .eq("user_id", userId);

  if (error) {
    if (isMissingCollectorOwnershipsTable(error)) {
      return { hasCollectorAccess: hasSlugAccess, records: [] };
    }
    throw error;
  }

  const records = data || [];
  const hasCollectorAccess =
    hasSlugAccess ||
    records.some((row) => {
      const status = String(row.entitlement_status || row.verification_status || "").toLowerCase();
      return status === "active" || status === "verified" || status === "granted";
    });

  return { hasCollectorAccess, records };
}

export async function getVaultPassAccessState(admin, userId, legacyOwnedSlugs = []) {
  const slugs = new Set(legacyOwnedSlugs || []);
  const hasSlugAccess = [...slugs].some(isVaultPassSlug);

  if (!admin || !userId) {
    return { hasVaultPass: hasSlugAccess, entitlement: null };
  }

  const { data, error } = await admin
    .from("vault_entitlements")
    .select("*")
    .eq("user_id", userId)
    .eq("entitlement_type", "vault_pass")
    .eq("status", "active")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      return { hasVaultPass: hasSlugAccess, entitlement: null };
    }
    throw error;
  }

  return { hasVaultPass: hasSlugAccess || Boolean(data), entitlement: data || null };
}
