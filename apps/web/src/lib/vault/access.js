import {
  canAccessVaultTier,
  getCollectorAccessState,
  getVaultPassAccessState,
  isMissingSupabaseTable,
  membershipHasPremiumAccess,
  vaultTierFor,
} from "@/lib/commerce/entitlements";

export function mapVaultContent(row, userTier = "public") {
  const unlocked = canAccessVaultTier(userTier, row.access_tier);
  const thumbnailUrl = row.thumbnail_url || row.metadata?.thumbnail_url || row.cover_url || null;
  const previewUrl = row.preview_url || row.metadata?.preview_url || null;
  const contentUrl = row.content_url || row.metadata?.content_url || null;
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    title: row.title,
    desc: row.description,
    description: row.description,
    accessTier: row.access_tier,
    mediaType: row.media_type,
    behavior: row.behavior || row.media_type,
    atmosphere: row.atmosphere,
    cover: thumbnailUrl,
    thumbnailUrl,
    previewUrl,
    contentUrl: unlocked ? contentUrl : null,
    accent: row.metadata?.accent || "#00ffff",
    sortOrder: row.sort_order,
    feature: row.featured,
    visibility: row.visibility,
    durationSeconds: row.duration_seconds,
    unlocked,
    accessLabel: unlocked ? (row.access_tier === "public" ? "Preview Open" : "Access Granted") : row.access_tier === "vault_pass" ? "Vault Pass" : "Inner Circle",
    hasPreview: Boolean(previewUrl || row.preview_storage_path),
    hasMedia: Boolean(contentUrl || row.media_storage_path),
  };
}

export async function getUserVaultAccess(admin, userId, membership = null, legacyOwnedSlugs = []) {
  if (!userId) {
    return {
      tier: "public",
      hasInnerCircleAccess: false,
      hasVaultPass: false,
      selectedAccess: false,
      fullAccess: false,
    };
  }

  const [collectorAccess, vaultPassAccess] = await Promise.all([
    getCollectorAccessState(admin, userId, legacyOwnedSlugs),
    getVaultPassAccessState(admin, userId, legacyOwnedSlugs),
  ]);
  const hasInnerCircleAccess = membershipHasPremiumAccess(membership) || collectorAccess.hasCollectorAccess;
  const hasVaultPass = vaultPassAccess.hasVaultPass || collectorAccess.hasCollectorAccess;
  const tier = vaultTierFor({ hasVaultPass, hasInnerCircleAccess });

  return {
    tier,
    hasInnerCircleAccess,
    hasVaultPass,
    selectedAccess: tier === "inner_circle" || tier === "vault_pass",
    fullAccess: tier === "vault_pass",
    collectorAccess,
    vaultPassEntitlement: vaultPassAccess.entitlement,
  };
}

export async function loadPublishedVaultContent(admin, userTier = "public") {
  const { data, error } = await admin
    .from("vault_content")
    .select("*")
    .eq("visibility", "published")
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingSupabaseTable(error)) return [];
    throw error;
  }

  return (data || []).map((row) => mapVaultContent(row, userTier));
}

export async function loadVaultContentBySlug(admin, slug) {
  const { data, error } = await admin
    .from("vault_content")
    .select("*")
    .eq("slug", slug)
    .eq("visibility", "published")
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) return null;
    throw error;
  }

  return data || null;
}
