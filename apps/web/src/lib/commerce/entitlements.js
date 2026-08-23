import { getAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";
import { isAdminUser } from "@/lib/auth/constants";
import { isAdminUserId } from "@/lib/auth/admin-authority";
import { userOwnsProductViaEntitlements } from "@/lib/commerce/unified-entitlements";
import { resolveOwnedSlugs } from "@/lib/commerce/ownership-authority";
import {
  getCachedTier,
  setCachedTier,
  getCachedSlugResult,
  setCachedSlugResult,
  withInflight,
  invalidateUserEntitlementCache,
} from "@/lib/server/entitlement-cache";

export {
  ENTITLEMENT_TYPES,
  hasEntitlement,
  hasVaultAccess,
  hasDigitalAccess,
  getUserEntitlements,
  grantEntitlementFlag,
  revokeEntitlementFlag,
  revokeAllUserEntitlements,
  getCheckoutDiscountPercent,
  getActiveCardBenefits,
  hasVaultAccessForUser,
  hasDigitalAccessForUser,
  isMerchOrVinylProduct,
  shouldGateProduct,
} from "@/lib/entitlements";

async function slugsFromEntitlements(admin, userId) {
  const { data, error } = await admin
    .from("entitlements")
    .select("resource_id")
    .eq("user_id", userId)
    .eq("resource_type", "product")
    .eq("status", "active");

  if (error) {
    if (error.code === "42P01" || /relation .* does not exist/i.test(String(error.message || ""))) {
      return null;
    }
    throw error;
  }

  const productIds = (data || []).map((row) => row.resource_id).filter(Boolean);
  if (!productIds.length) return [];

  const { data: products, error: productError } = await admin
    .from("products")
    .select("slug")
    .in("id", productIds);

  if (productError) throw productError;
  return (products || []).map((row) => row.slug).filter(Boolean);
}

/**
 * Owned product slugs for a user.
 *
 * INV-ENT-10 (ENT-06): the source of truth is an EXPLICIT authority state, not
 * inferred from whether the entitlements table happens to exist. Previously an
 * existing-but-unbackfilled entitlements table produced an authoritative
 * "owns nothing", silently under-reporting ownership.
 *
 * Both sources are read and handed to the authority resolver, which decides
 * according to LEGACY_LIBRARY / DUAL_VERIFY / ENTITLEMENTS_CANONICAL. The
 * default, DUAL_VERIFY, unions them so no user is ever denied because one side
 * lags behind the other.
 */
export async function getOwnedSlugs(userId) {
  const admin = getAdminClient();

  const [fromEntitlements, libraryResult] = await Promise.all([
    slugsFromEntitlements(admin, userId),
    admin.from("library_items").select("product_id, products(slug)").eq("user_id", userId),
  ]);

  if (libraryResult.error) throw libraryResult.error;
  const fromLibrary = (libraryResult.data || [])
    .map((row) => row.products?.slug)
    .filter(Boolean);

  const { slugs } = await resolveOwnedSlugs(admin, userId, { fromEntitlements, fromLibrary });
  return slugs;
}

export async function userOwnsProduct(userId, productSlug) {
  const admin = getAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("slug", productSlug).single();
  if (!product) return false;

  const entitled = await userOwnsProductViaEntitlements(admin, userId, product.id);
  if (entitled === true) return true;
  if (entitled === false) {
    const { data } = await admin
      .from("library_items")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", product.id)
      .maybeSingle();
    return !!data;
  }

  const { data } = await admin
    .from("library_items")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", product.id)
    .maybeSingle();

  return !!data;
}

/**
 * Resolve admin authority for a bare user id.
 *
 * INV-ENT-2: reads the server-controlled admin_principals table plus
 * deployment-pinned identity. It no longer derives authority from
 * profiles.role, which the profiles_update_own RLS policy allowed the user to
 * set on themselves (ENT-01) — that made this function a direct
 * privilege-escalation sink for the streaming gate.
 *
 * Fails closed: any lookup error resolves to false.
 */
async function resolveAdminAuthority(admin, userId) {
  return isAdminUserId(userId, admin);
}

/** True when the user may stream full audio for this catalog slug (purchase, membership, or collector). */
export async function userCanStreamProduct(userId, productSlug, user = null) {
  if (!userId || !productSlug) return false;
  // Admin fast-path: checked against the user object already in hand — zero DB cost.
  if (user && isAdminUser(user)) return true;

  // Coalesce concurrent calls for the same (userId, slug) pair behind a single
  // computation. At cold start under load, 1000 simultaneous play events for the
  // same track by the same user produce exactly 1 DB round-trip.
  return withInflight(`${userId}:${productSlug}`, async () => {
    // ── L1/L2 slug cache (fastest path after first resolution) ────────────────
    const cachedSlug = await getCachedSlugResult(userId, productSlug);
    if (cachedSlug !== null) return cachedSlug;

    // ── Tier cache short-circuit (SUBSCRIBER / COLLECTOR) ────────────────────
    // If we already know this user can stream the full catalog, only the product
    // type check remains — one DB read instead of 4–8.
    const cachedTier = await getCachedTier(userId);
    if (cachedTier?.canStreamAll) {
      const admin = getAdminClient();
      const { data: product } = await admin
        .from("products")
        .select("id, product_type")
        .eq("slug", productSlug)
        .maybeSingle();
      const result = Boolean(product && isDigitalProduct(product));
      await setCachedSlugResult(userId, productSlug, result);
      return result;
    }

    // ── Cache miss: full DB entitlement computation ───────────────────────────
    const admin = getAdminClient();

    const [isAdmin, owns] = await Promise.all([
      resolveAdminAuthority(admin, userId),
      userOwnsProduct(userId, productSlug),
    ]);

    if (isAdmin) {
      await Promise.all([
        setCachedTier(userId, { canStreamAll: true, isAdmin: true }),
        setCachedSlugResult(userId, productSlug, true),
      ]);
      return true;
    }

    if (owns) {
      // PURCHASER: owns this specific slug. Cache slug=true only — tier cannot be
      // inferred (user may own just this one item and be entry-level for everything else).
      await setCachedSlugResult(userId, productSlug, true);
      return true;
    }

    // Membership and owned slugs are independent — run concurrently.
    const [membership, ownedSlugs] = await Promise.all([
      getActiveMembership(userId),
      getOwnedSlugs(userId),
    ]);
    const collector = await getCollectorAccessState(admin, userId, [...ownedSlugs]);
    const isSubscriber = membershipHasPremiumAccess(membership);
    const isCollector  = collector.hasCollectorAccess;

    if (isSubscriber || isCollector) {
      // Cache tier so ALL future play events for this user (any slug) skip the DB.
      await setCachedTier(userId, { canStreamAll: true, isSubscriber, isCollector });
      const { data: product } = await admin
        .from("products")
        .select("id, product_type")
        .eq("slug", productSlug)
        .maybeSingle();
      const result = Boolean(product && isDigitalProduct(product));
      await setCachedSlugResult(userId, productSlug, result);
      return result;
    }

    // ENTRY: no access. Cache slug=false — repeated plays of the same track cost 0 DB.
    await setCachedSlugResult(userId, productSlug, false);
    return false;
  });
}

export async function grantLibraryItems({ userId, purchaseId, slugs, source = "purchase", entitlementMetadata = null }) {
  const admin = getAdminClient();
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

  const { grantEntitlementsForProducts } = await import("@/lib/commerce/unified-entitlements");
  await grantEntitlementsForProducts({
    admin,
    userId,
    purchaseId,
    products: resolved,
    source,
    metadataExtra: entitlementMetadata,
  });

  // Invalidate entitlement cache for all granted slugs so the next play event
  // reflects the new ownership immediately rather than waiting for TTL expiry.
  // Fire-and-forget: a failed invalidation is recoverable (TTL expires within 5 min).
  invalidateUserEntitlementCache(userId, slugs).catch(() => {});

  return data || [];
}

export async function createAccessToken({ userId, productId, purchaseId, ttlHours = 168 }) {
  const admin = getAdminClient();
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
  const admin = getAdminClient();
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
  // Explicit prefix patterns only. slug.includes("collector") was removed because
  // it granted collector privileges to any product whose slug contained the word
  // "collector" — a privilege-escalation risk if naming conventions drift.
  // The authoritative source for collector status is products.is_collector_product (DB column).
  // This function is retained as a legacy fallback for the getCollectorAccessState()
  // slug-ownership check path; grant paths use the DB column directly.
  return (
    slug.startsWith("exc-bundle") ||
    slug.startsWith("exc-card") ||
    slug.startsWith("collector-")
  );
}

export function isDigitalProduct(product) {
  const type = product?.product_type || product?.type;
  return (
    type === "digital" ||
    type === "audio" ||
    type === "single" ||
    type === "album" ||
    type === "ep" ||
    type === "feature"
  );
}

export function membershipHasPremiumAccess(membership) {
  if (!membership) return false;
  const status = String(membership.status || "").toLowerCase();
  return status === "active" || status === "trialing";
}

/** Client entitlement gate for Subscribe CTAs — mirrors subscribe page logic. */
export function resolveSubscriptionEntitlements(accountState = {}, membership = null) {
  const resolvedMembership = membership ?? accountState?.membership ?? null;
  const isSubscriber =
    Boolean(accountState?.subscriberActive) || membershipHasPremiumAccess(resolvedMembership);
  const isLifetimeOwner = Boolean(accountState?.collectorCard);
  const showSubscribe = !isSubscriber && !isLifetimeOwner;
  return { isSubscriber, isLifetimeOwner, showSubscribe, isEligible: showSubscribe };
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
  const admin = getAdminClient();
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

/**
 * Does the user own any product flagged as a collector product?
 *
 * INV-ENT-6: catalog naming conventions cannot independently grant capability.
 * Authority comes from the typed products.is_collector_product column. The
 * historical slug-prefix heuristic (exc-bundle / exc-card / collector-) is used
 * ONLY when the column is absent — i.e. the E0 migration has not been applied
 * yet — so behaviour is preserved during rollout and then becomes inert.
 *
 * Fails closed: a query error grants nothing.
 */
async function ownsCollectorProduct(admin, ownedSlugs) {
  if (!ownedSlugs.length) return false;
  try {
    const { data, error } = await admin
      .from("products")
      .select("slug, is_collector_product")
      .in("slug", ownedSlugs);

    if (error) {
      if (isMissingSupabaseColumn(error)) {
        // Column not migrated yet — legacy prefix behaviour, transitional only.
        return ownedSlugs.some(isCollectorAccessSlug);
      }
      console.error("[entitlements] collector product lookup failed", error.message);
      return false;
    }

    return (data || []).some((p) =>
      p.is_collector_product === true ||
      // NULL means the row predates the backfill; fall back for that row only.
      (p.is_collector_product == null && isCollectorAccessSlug(p.slug))
    );
  } catch (err) {
    console.error("[entitlements] collector product lookup threw", err?.message);
    return false;
  }
}

export async function getCollectorAccessState(admin, userId, legacyOwnedSlugs = []) {
  const slugs = [...new Set((legacyOwnedSlugs || []).filter(Boolean))];

  if (!admin || !userId) {
    // No client to consult — cannot resolve typed authority, so deny.
    return { hasCollectorAccess: false, records: [] };
  }

  const hasSlugAccess = await ownsCollectorProduct(admin, slugs);

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
